/**
 * Browser smoke test of the drawing pad of the CFD workspace: paper with a cm grid faded over the field, the construction drawn in
 * ink on thick paper, remembered between visits.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-pad.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-pad-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const fail = (m) => {
  throw new Error(m);
};
await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
const vis = page.locator('.shell-body:visible');
const canvas = vis.locator('canvas[aria-label="CFD field view"]');
const slider = vis.getByLabel('drawing pad opacity');
const setPad = async (v) => {
  await slider.evaluate((el, value) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(250);
};
const pixel = (x, y) => canvas.evaluate((c, [px, py]) => Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data), [x, y]);
const clusters = (test) =>
  canvas.evaluate((c, src) => {
    const f = new Function('r', 'g', 'b', `return ${src}`);
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++;
    return n;
  }, test);

// no paper: the flow background, and the construction in its pale colours
await shot('0-none');
const dark = await pixel(40, 40);
if (dark[0] > 60) fail(`without paper the corner should be the dark background: ${dark}`);
const redBefore = await clusters('r > 235 && g > 60 && g < 95 && b > 60 && b < 95');
if (redBefore < 20) fail(`the red dot should be visible without paper (${redBefore} px)`);
step(`no paper: dark background, red dot ${redBefore} px of its own colour`);

// thin paper: both pictures are there
await setPad(35);
await shot('1-thin');
const mix = await pixel(40, 60);
step(`35 % paper: corner pixel ${mix}`);

// thick paper: sheet colour, grid, inked construction
await setPad(100);
await shot('2-thick');
const paper = await pixel(60, 90);
if (!(paper[0] > 200 && paper[1] > 200 && paper[2] > 180)) fail(`100 % paper should be light: ${paper}`);
const redAfter = await clusters('r > 235 && g > 60 && g < 95 && b > 60 && b < 95');
if (redAfter > redBefore / 4) fail(`on thick paper the red dot should be inked darker (still ${redAfter} px of the pale colour)`);
const inked = await clusters('r > 120 && r < 230 && g < 0.55 * r && b < 0.55 * r');
if (inked < 20) fail(`the red dot should appear in a darker red on thick paper (${inked} px)`);
const gridPx = await clusters('g > 120 && g < 190 && r < 150 && b < 150 && g > r + 20');
if (gridPx < 400) fail(`the grid lines should be drawn (${gridPx} px)`);
step(`100 % paper: sheet ${paper.slice(0, 3)}, grid ${gridPx} px, red dot in dark ink ${inked} px`);
await vis.getByLabel('drawing pad grid').selectOption('wind');
await page.waitForTimeout(200);
await shot('3-wind-grid');
await vis.getByLabel('drawing pad paper').selectOption('blueprint');
await page.waitForTimeout(200);
await shot('4-blueprint');
const blue = await pixel(60, 90);
if (!(blue[2] > blue[0] + 20 && blue[0] < 60)) fail(`blueprint paper should be dark blue: ${blue}`);
step(`blueprint: ${blue.slice(0, 3)}`);

// remembered
await page.reload();
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
const again = await vis.getByLabel('drawing pad opacity').inputValue();
if (again !== '100') fail(`the paper should be remembered (${again})`);
step('the settings are remembered after a reload');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-pad: OK');

async function shot(name) {
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 60000 });
}
