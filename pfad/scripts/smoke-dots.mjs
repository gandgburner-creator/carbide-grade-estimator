/**
 * Browser smoke test of the red dot, the pointer, the green dot and the arc directions, and of the two plate diameters,
 * in both construction workspaces (no simulation is run):
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-dots.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency).
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

let chromium;
try {
  const req = createRequire(import.meta.url);
  try {
    ({ chromium } = req('playwright'));
  } catch {
    const root = (await import('node:child_process')).execSync('npm root -g').toString().trim();
    ({ chromium } = req(join(root, 'playwright')));
  }
} catch {
  console.error('playwright is not installed; install it to run this smoke test');
  process.exit(2);
}
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-dots-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const vis = page.locator('.shell-body:visible');
const field = (name) => vis.getByLabel(name, { exact: true });
const expectText = (text, timeout = 10000) => vis.getByText(text, { exact: false }).first().waitFor({ timeout });
const button = (name) => page.getByRole('button', { name, exact: true });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });

await page.goto(url);

async function dots(label, tab, canvasLabel) {
  await page.getByRole('button', { name: tab }).click();
  // two diameters: the leading end 2 cm across (the default), the trailing end 1 cm
  await field('trailing edge thickness in cm').fill('1');
  await button('START NEW PROJECT').click();
  await expectText('Draw with the pointer');
  await expectText('trailing end');
  await expectText('Round ends: the leading end is 2 cm across, the trailing end 1 cm');
  step(`${label}: a plate with a 2 cm leading and a 1 cm trailing end is drawn`);
  await shot(`${label}-1-two-diameters`);

  // the red dot, the pointer, the green dot, and the arc directions
  await vis.getByText('Red dot, green dot and the arc between them').waitFor();
  await field('green dot position along the plate in cm').fill('12');
  await field('green dot height above the plate in cm').fill('0.6');
  await field('direction of the curve at the pointer in degrees').fill('20');
  await field('pointer position along the plate in cm').fill('6');
  await field('pointer height above the plate in cm').fill('0.4');
  await expectText('Applying this:');
  await expectText('the green dot (anchor) moves');
  if (!(await button('PLACE POINTER').isEnabled())) throw new Error(`${label}: PLACE POINTER should be enabled for these values`);
  await field('direction of the curve at the pointer in degrees').fill('85');
  await expectText('80°');
  if (await button('PLACE POINTER').isEnabled()) throw new Error(`${label}: a direction beyond 80° must be refused`);
  await field('direction of the curve at the pointer in degrees').fill('20');
  await shot(`${label}-2-preview`);
  step(`${label}: green dot, pointer and arc direction are read together, previewed and checked`);

  // drag the green dot: find its marker on the canvas (the densest cluster of its colour) and pull it
  const c = vis.locator(`canvas[aria-label*="${canvasLabel}"]`).first();
  const box = await c.boundingBox();
  const pos = await c.evaluate((cv) => {
    const g = cv.getContext('2d');
    const w = cv.width;
    const h = cv.height;
    const d = g.getImageData(0, 0, w, h).data;
    const near = (i) => Math.abs(d[i] - 126) < 30 && Math.abs(d[i + 1] - 231) < 30 && Math.abs(d[i + 2] - 135) < 30;
    let best = 0;
    let at = null;
    const S = 6;
    for (let y = S; y < h - S; y += 2) {
      for (let x = S; x < w - S; x += 2) {
        let n = 0;
        for (let dy = -S; dy <= S; dy += 2) for (let dx = -S; dx <= S; dx += 2) if (near(4 * ((y + dy) * w + x + dx))) n++;
        if (n > best) {
          best = n;
          at = [x, y];
        }
      }
    }
    return at ? { x: at[0] / (w / cv.clientWidth), y: at[1] / (h / cv.clientHeight), n: best } : null;
  });
  if (!pos) throw new Error(`${label}: could not find the green dot on the canvas`);
  const before = await field('green dot position along the plate in cm').inputValue();
  await page.mouse.move(box.x + pos.x, box.y + pos.y);
  await page.mouse.down();
  await page.mouse.move(box.x + pos.x - 40, box.y + pos.y - 20, { steps: 6 });
  await page.mouse.up();
  const after = await field('green dot position along the plate in cm').inputValue();
  if (before === after) throw new Error(`${label}: dragging the green dot did not change its box (${before})`);
  step(`${label}: dragging the green dot on the picture changed its box (${before} → ${after} cm)`);
  await shot(`${label}-3-dragged`);

  // put the typed values back to something valid and place it
  await field('green dot position along the plate in cm').fill('12');
  await field('green dot height above the plate in cm').fill('0.6');
  await field('pointer position along the plate in cm').fill('6');
  await field('pointer height above the plate in cm').fill('0.4');
  await button('PLACE POINTER').click();
  await expectText('v1 has the new surface');
  step(`${label}: placing it made version v1`);
  await shot(`${label}-4-placed`);

  // the red dot is now the last placed point: it can be moved, and a direction set, as another version
  await field('red dot height above the plate in cm').fill('0.5');
  await field('direction of the curve at the red dot in degrees').fill('10');
  await field('pointer position along the plate in cm').fill('');
  await field('pointer height above the plate in cm').fill('');
  await expectText('the red dot moves');
  await button('APPLY CHANGES').click();
  await expectText('v2 has the new surface');
  step(`${label}: moving the red dot and setting its direction made version v2`);
}

await dots('particles', /FLOW-GUIDED GEOMETRY A/, 'Particle view');
await dots('cfd', /FLOW-GUIDED GEOMETRY B/, 'CFD field view');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('dots smoke test passed');
