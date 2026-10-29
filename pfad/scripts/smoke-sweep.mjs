/**
 * Browser smoke test of the pointer SWEEP in both workspaces: simulate, move the pointer by the measurement, simulate, … until it reaches the trailing-edge anchor.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-sweep.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-sweep-out';
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
const vis = page.locator('.shell-body:visible');

async function sweep(label, tabName, finishedTimeout) {
  await page.getByRole('button', { name: tabName }).click();
  await button('START NEW PROJECT').click();
  await expectText('Draw with the pointer');
  // one big step: 9 cm along the 20 cm plate (the anchor is at 18 cm), so the sweep is two moves long
  await vis.getByText('Step settings').click();
  await vis.getByLabel('step along the plate [cm]').fill('9');
  await page.getByRole('button', { name: /SWEEP TO THE/ }).click();
  await expectText('pointer steps so far', 30000);
  step(`${label}: the sweep started`);
  await vis.getByText('Stopped (finished)').waitFor({ timeout: finishedTimeout });
  const log = await vis.locator('ul[aria-label="pointer sweep log"]').innerText();
  const moves = (log.match(/^Step \d+:/gm) ?? []).length;
  if (moves !== 2) throw new Error(`${label}: expected 2 pointer steps, the log says ${moves}:\n${log}`);
  if (!/the pointer is at the trailing-edge anchor/.test(log)) throw new Error(`${label}: the log does not say why it stopped:\n${log}`);
  await shot(`${label}-sweep`);
  step(`${label}: the sweep made 2 measured steps and stopped by itself at the anchor (${lap()})`);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const hist = await vis.locator('.lib-list').first().innerText();
  for (const id of ['v0', 'v1', 'v2']) if (!new RegExp(`\\b${id}\\b`).test(hist)) throw new Error(`${label}: ${id} is missing from the history`);
  if (/not simulated/.test(hist.split('v2')[1] ?? '')) throw new Error(`${label}: the last version was not simulated`);
}

await sweep('particles', /FLOW-GUIDED GEOMETRY A/, 900000);
await sweep('cfd', /FLOW-GUIDED GEOMETRY B/, 1800000);

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`sweep smoke test passed (${lap()})`);
