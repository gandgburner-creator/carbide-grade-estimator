/**
 * Browser smoke test of the CFD workspace on a phone: the picture has a height (a canvas whose height is a percentage of an automatic height
 * collapses to nothing), it draws the body, a swipe on it scrolls the page unless the person switches to moving the picture, and the
 * graphics-card panel starts folded so that the bar pinned to the bottom of the screen stays low.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-phone.mjs [http://localhost:4173/] [out-dir]
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

let chromium;
const req = createRequire(import.meta.url);
try {
  ({ chromium } = req('playwright'));
} catch {
  const root = (await import('node:child_process')).execSync('npm root -g').toString().trim();
  ({ chromium } = req(join(root, 'playwright')));
}
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-phone-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const fail = (m) => {
  throw new Error(m);
};
const step = (s) => console.log(`· ${s}`);

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
const canvas = page.locator('canvas[aria-label="CFD field view"]');
await canvas.waitFor();
await canvas.scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
const box = await canvas.boundingBox();
if (!box || box.height < 300 || box.width < 380) fail(`the picture should fill the width and be at least 300 px tall, not ${box?.width}×${box?.height}`);
step(`the picture is ${Math.round(box.width)}×${Math.round(box.height)} px`);

// it draws the body: light pixels (the outline of the plate) on the dark background
const light = await canvas.evaluate((c) => {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) n++;
  return n;
});
if (light < 500) fail(`the body should be drawn on the picture (${light} light pixels)`);
step(`the body is drawn (${light} light pixels)`);
await page.screenshot({ path: join(out, '1-phone.png') });

// touch: a vertical swipe scrolls the page by default; the button switches to moving the picture
const mode = () => canvas.evaluate((c) => getComputedStyle(c).touchAction);
if (!/pan-y/.test(await mode())) fail(`touch on the picture should scroll the page by default, not ${await mode()}`);
await page.getByLabel('touch moves the picture and the dots').click();
if ((await mode()) !== 'none') fail('after the switch touch should move the picture');
await page.getByLabel('touch scrolls the page').click();
step('a swipe scrolls the page; one button switches to moving the picture');

// the graphics-card panel is folded, the run buttons are within reach
const fold = page.getByTestId('gpu-fold');
if (await fold.evaluate((d) => d.open)) fail('the graphics-card panel should start folded on a phone');
const bar = await page.locator('.shell-body:visible .run-section').boundingBox();
if (!bar || bar.height > 240) fail(`the pinned run bar should be low, not ${bar?.height}px`);
step(`the pinned run bar is ${Math.round(bar.height)} px high, the graphics-card panel folded`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-phone: OK');
