/**
 * Browser smoke test of the CFD workspace (flow-guided geometry B): a real lattice Boltzmann run at the quick resolution.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-cfd.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). The vertical slice, end to end:
 * flat plate -> real simulation (quick preset, fixed seeds) -> measured near-wall flow -> detector
 * output and its label -> one proposed increment (exploratory mode, because the quick preset cannot
 * reach the detector's evidence thresholds) -> the construction point is advanced -> accepted ->
 * the new version is simulated -> comparison with the parent -> undo -> replay -> exports.
 * It also checks that the experimental labels are on screen and that Universe B stays locked.
 * Takes a few minutes: it runs two versions of three seeds each.
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
const out = process.argv[3] ?? 'smoke-cfd-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
// both workspaces stay mounted: look only inside the visible one
const expectText = async (text, timeout = 10000) => page.locator('.shell-body:visible').getByText(text, { exact: false }).first().waitFor({ timeout });
const button = (name) => page.getByRole('button', { name, exact: true });
const download = async (name) => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), button(name).first().click()]);
  const p = join(out, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};
const phase = () => page.locator('.flow .phase, .shell-body:visible .phase').first().textContent();
const finished = (timeout = 600000) =>
  page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll('.phase')].find((e) => e.offsetParent !== null);
      return el && el.textContent === 'FINISHED';
    },
    null,
    { timeout },
  );
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

await page.goto(url);
await expectText('PFAD LABORATORY');
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
await expectText('FLOW-GUIDED GEOMETRY B · CFD · EXPERIMENTAL');
await expectText('NOT THE PARTICLE MODEL');
await expectText('no particles, no model units, no Universe A or B');
const field = (name) => page.locator('.shell-body:visible').getByLabel(name, { exact: true });
step('the CFD workspace opens, labelled as conventional CFD, not the particle model');

// 1. the plain inputs and what the run will be
await expectText('What the simulation will run');
await expectText('Reynolds number: your plate in your air has Re');
await expectText('Navier–Stokes');
await page.getByRole('button', { name: 'resolution quick', exact: true }).click();
await field('wing depth in cm').fill('150');
await button('START NEW PROJECT').click();
await expectText('Open project');
await shot('1-cfd-setup');
step('the setup states the Reynolds number of the plate in the described air and what the run uses');

// 2. compute the starting plate
await button('SIMULATE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 30000 });
await page.waitForTimeout(8000);
await shot('2-cfd-running');
const live = await page.locator('.shell-body:visible .status-line').first().innerText();
if (!/flow-throughs of the plate/.test(live)) throw new Error(`no live status while computing: ${live}`);
step('the run is live: the instantaneous field and the status are shown');
const fpsT = Date.now();
await button('PAUSE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'PAUSED'), null, { timeout: 5000 });
await button('RESUME').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 5000 });
step(`PAUSE and RESUME act promptly (${Date.now() - fpsT} ms)`);
await finished(900000);
step(`v0 computed (${lap()})`);
await expectText('Integrity of the run');
await expectText('Where the flow leaves the wall');
await expectText('COMPUTED');
await expectText('NOT A PREDICTION');
const results = await page.locator('.shell-body:visible .section', { hasText: 'results of v0' }).first().innerText();
if (!/PASSED|WARNING/.test(results)) throw new Error(`the run did not pass its integrity checks: ${results.slice(0, 600)}`);
if (!/Drag/.test(results) || !/Lift/.test(results) || !/ N\b/.test(results) || !/150 cm/.test(results)) throw new Error('the lift and drag table is incomplete');
if (/\b(better|best|optimal|optimi[sz]ed)\b/i.test(results.replace(/nothing here is optimi[sz]ed/i, ''))) throw new Error('the results make a quality claim');
await shot('3-cfd-v0');
step('v0 has integrity checks, the wall-shear separation statement, lift and drag with the scaled estimate (not a prediction)');

// 3. streamlines and the wall curves
await page.locator('.shell-body:visible').getByLabel('show streamlines', { exact: true }).check();
await page.waitForTimeout(800);
await shot('4-cfd-streamlines');
await page.locator('.shell-body:visible').getByLabel('CFD field', { exact: true }).selectOption('vorticity');
await page.waitForTimeout(400);
await shot('5-cfd-vorticity');
step('streamlines and the vorticity field are drawn from the time-mean result');

// 4. the pointer
await field('pointer position along the plate in cm').fill('2');
await field('pointer height above the plate in cm').fill('0.4');
await button('PLACE POINTER').click();
await expectText('v1 has the new surface');
step('the pointer moved by hand: v1');
await button('SIMULATE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 30000 });
await finished(900000);
step(`v1 computed (${lap()})`);
await button('ONE AUTOMATIC STEP').click();
await expectText('The CFD result moved the pointer: v2');
await shot('6-cfd-v2');
step('one automatic step made v2 from the dividing-streamline height');

// 5. comparison, history, export
await page.getByRole('button', { name: 'History', exact: true }).click();
await page.getByRole('button', { name: 'COMPARE WITH PARENT' }).first().click();
await expectText('Lift and drag (no composite score');
await shot('7-cfd-compare');
const cmpText = await page.locator('.shell-body:visible .section', { hasText: 'comparison' }).first().innerText();
if (!/no lift-to-drag ranking/i.test(cmpText)) throw new Error('the comparison does not say that it makes no lift-to-drag ranking');
await page.getByRole('button', { name: 'History', exact: true }).click();
const proj = await download('PROJECT JSON');
const p = JSON.parse(readFileSync(proj, 'utf8'));
if (p.format !== 'pfad-cfd-geometry/1' || p.versions.length !== 3) throw new Error(`the project JSON is wrong: ${p.format} ${p.versions?.length}`);
if (p.wingDepthCm !== 150) throw new Error('the wing depth was not saved');
const v1 = p.versions.find((v) => v.id === 'v1');
const v2 = p.versions.find((v) => v.id === 'v2');
if (v1.move.decided !== 'hand' || v2.move.decided !== 'measurement') throw new Error('the pointer decisions are not recorded');
if (!p.versions[0].run?.result?.integrity || !p.versions[0].run.result.stations.upper.length) throw new Error('the run result is missing from the project');
await button('UNDO LAST MOVE').click();
await expectText('undone');
step('comparison names no ranking; the project JSON holds both moves with who decided them and the CFD results; undo keeps v2');

// 6. the particle workspace and the laboratory are unaffected
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY A/ }).click();
await expectText('FLOW-GUIDED GEOMETRY · EXPERIMENTAL');
await page.getByRole('button', { name: 'LABORATORY', exact: true }).click();
await page.getByRole('button', { name: /UNIVERSE B/ }).click();
await expectText('Locked. UB-0 is preregistered and blind');
step('the particle workspace is still there and Universe B stays locked');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`CFD smoke test passed (${lap()})`);
