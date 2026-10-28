/**
 * Browser smoke test of LIVE FILL in the flow-guided geometry workspace (small, non-judged Universe A runs).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-live.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). Plain inputs for a fast stream past a plate at 30°
 * (20 × 2 cm, 2000 km/h at 15 °C, which is Mach 1.6), then: simulate v0 and measure how the particles touch the
 * surface; start the live fill and watch the surface grow while the simulation runs; keep the new version;
 * simulate it; compare it with v0 on the prediction it stated. About eight minutes.
 */
import { mkdirSync, readFileSync } from 'node:fs';
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
const out = process.argv[3] ?? 'smoke-live-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const vis = page.locator('.shell-body:visible');
const field = (name) => vis.getByLabel(name, { exact: true });
const button = (name) => page.getByRole('button', { name, exact: true });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const phaseIs = (ph, timeout) => page.waitForFunction((x) => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === x), ph, { timeout });

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY/ }).click();
await vis.getByText('4 · Live fill (experimental)').waitFor({ timeout: 10000 });
await field('angle of attack in °').fill('30');
await field('wind speed in km/h').fill('2000');
await vis.getByText(/is Mach 1\.6\d in this air/).waitFor({ timeout: 5000 });
await button('START NEW PROJECT').click();
await vis.getByText('Starts from a flat plate (30 × 3 particle diameters').waitFor({ timeout: 10000 });
step('plate 20 × 2 cm at 30°, 2000 km/h (Mach 1.6): project started');

// v0: measure how the particles touch the flat plate
await button('SIMULATE').click();
await phaseIs('FINISHED', 600000);
step(`v0 simulated (${lap()})`);
await vis.getByText('particles touching the surface').first().waitFor({ timeout: 10000 });
await shot('1-v0-measured');
step('the measurement panel shows the contact-layer density and the void along the surface');

// live fill
await page.getByRole('button', { name: /START LIVE FILL/ }).click();
await vis.getByText('live fill', { exact: true }).first().waitFor({ timeout: 120000 });
await page.waitForTimeout(8000);
await shot('2-live-running');
step(`live fill is running: the surface grows while the simulation goes (${lap()})`);
const status = await vis.locator('.section', { hasText: '4 · Live fill' }).innerText();
if (!/separation point/.test(status) || !/front of the fill/.test(status)) throw new Error(`the live status is missing:\n${status}`);
await vis.getByText(/Live fill finished \(/).waitFor({ timeout: 900000 });
step(`live fill finished (${lap()})`);
await shot('3-live-finished');
const result = await vis.locator('.section', { hasText: '4 · Live fill' }).innerText();
if (!/New version v1/.test(result)) throw new Error(`no new version was made:\n${result}`);
if (!/not been measured/.test(result)) throw new Error('the result does not say that the new version is unmeasured');

// measure the new version
await button('SIMULATE').click();
await phaseIs('FINISHED', 900000);
step(`v1 simulated (${lap()})`);
await page.getByRole('button', { name: 'Comparison', exact: true }).click();
await vis.getByText('The stated prediction').waitFor({ timeout: 10000 });
const cmp = await vis.locator('.hyp').first().innerText();
console.log('  prediction:', cmp.replace(/\s+/g, ' ').slice(0, 330));
if (!/touch(es)? the (new )?surface|contact-layer density|particles touched|void/i.test(cmp)) throw new Error(`the comparison does not speak of the contact layer:\n${cmp}`);
await shot('4-comparison');
step('the comparison reports the prediction the live fill stated');

// history keeps it, and the export carries the story of the fill
await page.getByRole('button', { name: 'History', exact: true }).click();
await vis.getByText('LIVE FILL', { exact: false }).first().waitFor({ timeout: 5000 });
const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), button('PROJECT JSON').click()]);
const file = join(out, d.suggestedFilename());
await d.saveAs(file);
const proj = JSON.parse(readFileSync(file, 'utf8'));
const v1 = proj.versions.find((v) => v.id === 'v1');
if (v1?.construction?.mode !== 'live-fill' || !v1.construction.live?.trajectory?.length || !v1.construction.live.stop?.reason) throw new Error('the project export lacks the story of the live fill');
if (v1.run?.integrity?.status !== 'PASSED') throw new Error('v1 run did not pass its integrity checks');
step(`the project JSON keeps the live fill: ${v1.construction.live.trajectory.length} updates, stopped: ${v1.construction.live.stop.kind}`);

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`live fill smoke test passed (${lap()})`);
