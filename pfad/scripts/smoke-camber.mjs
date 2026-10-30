/**
 * Browser smoke test of the CAMBER spline in both construction workspaces (no simulation is run):
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-camber.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-camber-out';
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

async function camber(label, tab, canvasLabel) {
  await page.getByRole('button', { name: tab }).click();
  await button('START NEW PROJECT').click();
  await expectText('Draw with the pointer');
  await expectText('No control points: the mid-line is straight.');
  if (await button('APPLY CAMBER').isEnabled()) throw new Error(`${label}: APPLY CAMBER must be disabled while nothing is changed`);
  step(`${label}: the plate starts with a straight mid-line`);

  // two control points, one typed
  await button('ADD CAMBER POINT').click();
  await button('ADD CAMBER POINT').click();
  await field('camber point 1 along the plate in cm').fill('6');
  await field('camber point 1 height above the chord line in cm').fill('1.2');
  await field('camber point 2 along the plate in cm').fill('13');
  await field('camber point 2 height above the chord line in cm').fill('0.8');
  await expectText('camber 1', 5000).catch(() => {});
  await shot(`${label}-1-two-points`);
  if (!(await button('APPLY CAMBER').isEnabled())) throw new Error(`${label}: APPLY CAMBER should be enabled once a point is raised`);
  step(`${label}: control points added and a height typed; the dashed outline previews the arched plate`);

  // drag the second diamond (purple) up
  const c = vis.locator(`canvas[aria-label*="${canvasLabel}"]`).first();
  const box = await c.boundingBox();
  const pos = await c.evaluate((cv) => {
    const g = cv.getContext('2d');
    const w = cv.width;
    const h = cv.height;
    const d = g.getImageData(0, 0, w, h).data;
    const near = (i) => Math.abs(d[i] - 194) < 24 && Math.abs(d[i + 1] - 151) < 24 && Math.abs(d[i + 2] - 255) < 24;
    // all clusters of the camber colour: take the one that belongs to point 2 (the right-most)
    const hits = [];
    for (let y = 6; y < h - 6; y += 2) for (let x = 6; x < w - 6; x += 2) if (near(4 * (y * w + x))) hits.push([x, y]);
    if (!hits.length) return null;
    // cluster by distance
    const clusters = [];
    for (const [x, y] of hits) {
      const k = clusters.find((q) => Math.hypot(q.x - x, q.y - y) < 14);
      if (k) {
        k.x = (k.x * k.n + x) / (k.n + 1);
        k.y = (k.y * k.n + y) / (k.n + 1);
        k.n++;
      } else clusters.push({ x, y, n: 1 });
    }
    const big = clusters.filter((q) => q.n >= 8).sort((a, b) => b.x - a.x).slice(0, 2);
    return big.map((q) => ({ x: q.x / (w / cv.clientWidth), y: q.y / (h / cv.clientHeight), n: q.n }));
  });
  if (!pos || pos.length < 1) throw new Error(`${label}: could not find the camber control points on the canvas`);
  const before = await field('camber point 2 height above the chord line in cm').inputValue();
  const target = pos[0];
  await page.mouse.move(box.x + target.x, box.y + target.y);
  await page.mouse.down();
  await page.mouse.move(box.x + target.x + 4, box.y + target.y - 12, { steps: 6 });
  await page.mouse.up();
  const afterX = await field('camber point 2 along the plate in cm').inputValue();
  const afterY = await field('camber point 2 height above the chord line in cm').inputValue();
  if (afterY === before && afterX === '13.00') throw new Error(`${label}: dragging a control point did not change its boxes`);
  step(`${label}: dragging a control point on the picture changed its boxes (height ${before} → ${afterY}, along ${afterX} cm)`);
  await shot(`${label}-2-dragged`);

  await button('APPLY CAMBER').click();
  await expectText('v1 has the new surface');
  await expectText('camber set: a spline through 2 control points');
  await shot(`${label}-3-applied`);
  step(`${label}: applying made version v1 with the camber`);

  // the plate is now arched: the red dot still slides along the wall and a pointer can be placed on it
  await field('pointer position along the plate in cm').fill('6');
  await field('pointer height above the plate in cm').fill('0.5');
  await expectText('Applying this:');
  await button('PLACE POINTER').click();
  await expectText('v2 has the new surface');
  await shot(`${label}-4-pointer-on-camber`);
  step(`${label}: a pointer placed on the arched plate: version v2`);

  // and straight again
  await button('STRAIGHT (NO CAMBER)').click();
  await button('APPLY CAMBER').click();
  await expectText('v3 has the new surface');
  await expectText('camber removed');
  step(`${label}: straight again: version v3`);
}

await camber('particles', /FLOW-GUIDED GEOMETRY A/, 'Particle view');
await camber('cfd', /FLOW-GUIDED GEOMETRY B/, 'CFD field view');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('camber smoke test passed');
