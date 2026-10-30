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

  // find a marker on the canvas (the densest cluster of its colour)
  const c = vis.locator(`canvas[aria-label*="${canvasLabel}"]`).first();
  const box = await c.boundingBox();
  const find = (rgb) =>
    c.evaluate((cv, want) => {
      const g = cv.getContext('2d');
      const w = cv.width;
      const h = cv.height;
      const d = g.getImageData(0, 0, w, h).data;
      const near = (i) => Math.abs(d[i] - want[0]) < 30 && Math.abs(d[i + 1] - want[1]) < 30 && Math.abs(d[i + 2] - want[2]) < 30;
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
    }, rgb);
  const drag = async (rgb, dx, dy, name) => {
    const pos = await find(rgb);
    if (!pos) throw new Error(`${label}: could not find the ${name} on the canvas`);
    await page.mouse.move(box.x + pos.x, box.y + pos.y);
    await page.mouse.down();
    await page.mouse.move(box.x + pos.x + dx, box.y + pos.y + dy, { steps: 8 });
    await page.mouse.up();
  };

  // the red dot starts on the leading circle: it can be pulled along the wall (the box follows; its height is the wall's)
  const redBox = field('red dot position along the plate in cm');
  const redBefore = await redBox.inputValue();
  await drag([255, 77, 77], 70, 38, 'red dot');
  const redAfter = await redBox.inputValue();
  if (redBefore === redAfter) throw new Error(`${label}: dragging the red dot did not move it along the wall (${redBefore})`);
  await expectText('on the wall there:');
  await shot(`${label}-2-red-dragged`);
  step(`${label}: the red dot slid along the wall under the mouse (${redBefore} → ${redAfter} cm)`);

  // the green dot slides along the plate's own wall
  const greenBox = field('green dot position along the plate in cm');
  const greenBefore = await greenBox.inputValue();
  await drag([126, 231, 135], -40, -22, 'green dot');
  const greenAfter = await greenBox.inputValue();
  if (greenBefore === greenAfter) throw new Error(`${label}: dragging the green dot did not change its box (${greenBefore})`);
  step(`${label}: the green dot slid along the wall (${greenBefore} → ${greenAfter} cm)`);

  // an arc from the red dot to a pointer above the wall, with a direction, and the rope down to the green dot
  const r = Number(await redBox.inputValue());
  await field('pointer position along the plate in cm').fill(String(r + 3));
  await field('pointer height above the plate in cm').fill('0.5');
  await field('direction of the curve at the pointer in degrees').fill('20');
  await expectText('Applying this:');
  await expectText('red dot slides along the wall');
  if (!(await button('PLACE POINTER').isEnabled())) throw new Error(`${label}: PLACE POINTER should be enabled for these values`);
  await field('direction of the curve at the pointer in degrees').fill('85');
  await expectText('80°');
  if (await button('PLACE POINTER').isEnabled()) throw new Error(`${label}: a direction beyond 80° must be refused`);
  await field('direction of the curve at the pointer in degrees').fill('20');
  await shot(`${label}-3-preview`);
  await button('PLACE POINTER').click();
  await expectText('v1 has the new surface');
  step(`${label}: red dot on the wall, an arc to the pointer, the rope to the green dot: version v1`);
  await shot(`${label}-4-placed`);

  // as it is built: the red dot is now on the built surface; slide it back along what was drawn and set a direction
  const built = Number(await redBox.inputValue());
  await redBox.fill(String(Math.max(0.5, built - 1.0)));
  await field('direction of the curve at the red dot in degrees').fill('10');
  await field('pointer position along the plate in cm').fill('');
  await field('pointer height above the plate in cm').fill('');
  await expectText('the red dot slides along the wall');
  await button('APPLY CHANGES').click();
  await expectText('v2 has the new surface');
  step(`${label}: after building, the red dot slid along the built surface and a direction was set: version v2`);
}

await dots('particles', /FLOW-GUIDED GEOMETRY A/, 'Particle view');
await dots('cfd', /FLOW-GUIDED GEOMETRY B/, 'CFD field view');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('dots smoke test passed');
