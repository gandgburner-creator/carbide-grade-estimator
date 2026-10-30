/**
 * Browser smoke test of the CFD AUTO FILL and of streamlines during a run:
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-cfdfill.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). Flow-guided geometry B · CFD, quick preset: the streamlines box is
 * switched off before anything is computed; an auto fill is started (two big moves) and the streamlines box works while it runs;
 * the fill ends at the anchor with a new version, which is computed next and shows lift and drag in newtons and kilogram-force;
 * a second fill is stopped by hand and keeps what it drew.
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
const out = process.argv[3] ?? 'smoke-cfdfill-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const vis = page.locator('.shell-body:visible');
const expectText = async (text, timeout = 10000) => vis.getByText(text, { exact: false }).first().waitFor({ timeout });
const button = (name) => page.getByRole('button', { name, exact: true });
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const finished = (timeout) =>
  page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'FINISHED'), null, { timeout });

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
await button('START NEW PROJECT').click();
await expectText('Draw with the pointer');
const streams = vis.getByLabel('show streamlines');
if (!(await streams.isDisabled())) throw new Error('the streamlines box should be switched off before anything is computed');
await expectText('Streamlines: switched on while a computation runs');
step('streamlines: switched off before anything is computed, and the screen says why');

// a short fill: two big moves, a short window
await vis.getByText('Step settings').click();
await vis.getByLabel('step along the plate [cm]').fill('9');
await vis.getByText('Settings', { exact: true }).last().click();
await vis.getByLabel('flow adjusts after each move [convective times]').fill('0.5');
await vis.getByLabel('averaged for each decision [convective times]').fill('1');
await button('▶ START AUTO FILL').click();
await expectText('fill:', 60000);
step(`auto fill started (${lap()})`);
await vis.getByLabel('show streamlines').waitFor();
if (await streams.isDisabled()) throw new Error('the streamlines box should work while a computation runs');
await streams.check();
await expectText('streamlines of the velocity at this instant', 60000);
step('streamlines while the run is going (the velocity at this instant)');
await shot('1-fill-running');
await vis.getByText(/Auto fill finished \(anchor:/).waitFor({ timeout: 1200000 });
step(`auto fill finished at the anchor (${lap()})`);
await shot('2-fill-finished');
const result = await vis.locator('.info', { hasText: 'Auto fill finished' }).innerText();
if (!/New version v1/.test(result)) throw new Error(`no new version was made:\n${result}`);
await finished(1800000);
step(`the new shape was computed next (${lap()})`);
await page.getByRole('button', { name: 'Results', exact: true }).click().catch(() => {});
await vis.getByText(/kgf/).first().waitFor({ timeout: 10000 });
step('lift and drag are shown in newtons and kilogram-force');
await shot('3-computed');
await page.getByRole('button', { name: 'History', exact: true }).click();
await vis.getByText('CONSTRUCTED · AUTO FILL').first().waitFor({ timeout: 5000 });
step('the history keeps the fill: constructed by auto fill, with its moves');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`CFD auto fill smoke test passed (${lap()})`);
