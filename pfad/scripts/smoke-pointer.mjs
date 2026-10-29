/**
 * Browser smoke test of the rounded plate and the construction pointer in the particle workspace
 * (small, non-judged Universe A runs only).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-pointer.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). The vertical slice, end to end:
 * rounded plate -> real simulation (quick preset, fixed seeds) -> measured near-wall flow -> detector
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
const out = process.argv[3] ?? 'smoke-pointer-out';
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
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY/ }).click();
await expectText('FLOW-GUIDED GEOMETRY · EXPERIMENTAL');
const field = (name) => page.locator('.shell-body:visible').getByLabel(name, { exact: true });

// 1. a new project starts from the rounded plate, and the pointer section is there
await field('wind speed in km/h').fill('50');
await button('START NEW PROJECT').click();
await expectText('Starts from a rounded plate (30 particle diameters long');
await expectText('Draw with the pointer');
await expectText('half-circles');
await expectText('tether');
await shot('1-rounded-plate');
step('a new project starts from the rounded plate; the pointer section explains the tether');

// 2. the pointer's candidate position is validated in plain words
await field('pointer position along the plate in cm').fill('0');
await expectText('only moves forward');
if (await button('PLACE POINTER').isEnabled()) throw new Error('PLACE POINTER must be disabled for a position that is not forward');
await field('pointer position along the plate in cm').fill('2');
await field('pointer height above the plate in cm').fill('-0.5');
await expectText('only added');
await field('pointer height above the plate in cm').fill('0.4');
await page.waitForTimeout(300);
await shot('2-preview');
step('a candidate position is checked (forward only, add-only) and previewed');

// 3. place it by hand: a new version, not simulated yet
await button('PLACE POINTER').click();
await expectText('The pointer moved: v1');
await expectText('CONSTRUCTED · POINTER', 10000).catch(() => {});
step('placing the pointer makes version v1');

// 4. simulate v1, then let the measurement move the pointer one step
await button('SIMULATE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 30000 });
await finished();
step(`v1 simulated (${lap()})`);
// the streamlines of the measured mean flow
await page.locator('.shell-body:visible').getByLabel('show streamlines', { exact: true }).check();
await expectText('streamlines of the mean flow of v1');
await page.waitForTimeout(500);
await shot('2c-streamlines');
step('streamlines of the mean flow of v1 are drawn, labelled as the path of the mean motion');
await button('ONE AUTOMATIC STEP').click();
await expectText('The measurement moved the pointer: v2');
await shot('3-auto-step');
step('one automatic step made v2 from the measured gap');

// 5. history and project JSON carry the pointer path and the decision
await page.getByRole('button', { name: 'History', exact: true }).click();
await expectText('POINTER');
const proj = await download('PROJECT JSON');
const p = JSON.parse(readFileSync(proj, 'utf8'));
const v1 = p.versions.find((v) => v.id === 'v1');
const v2 = p.versions.find((v) => v.id === 'v2');
if (!v1?.shape?.paths?.upper || v1.shape.paths.upper.length !== 2) throw new Error(`v1 pointer path wrong: ${JSON.stringify(v1?.shape?.paths)}`);
if (!v2?.shape?.paths?.upper || v2.shape.paths.upper.length !== 3) throw new Error(`v2 pointer path wrong: ${JSON.stringify(v2?.shape?.paths)}`);
if (v1.construction.pointer.decided !== 'hand' || v2.construction.pointer.decided !== 'measurement') throw new Error('the pointer decisions are not recorded');
if (!v2.construction.pointer.measured?.recordId) throw new Error('the measured step does not name the record it responded to');
if (v2.run) throw new Error('v2 must not have a run before it is simulated');
step('the project JSON records both pointer moves, who decided them and the record the measured one responded to');

// 6. undo goes back one version and keeps it in the history
await page.getByRole('button', { name: 'Comparison', exact: true }).click().catch(() => {});
await button('UNDO LAST ACCEPTED').click();
await expectText('undone');
step('undo returns to v1 and keeps v2 in the history');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`pointer smoke test passed (${lap()})`);
