/**
 * Browser smoke test of streamlines during a run in the particle workspace: the box is switched off before anything is simulated,
 * works while a simulation runs (the running average), and the measured mean replaces it when the run ends.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-streams.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-streams-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const vis = page.locator('.shell-body:visible');
const t0 = Date.now();
const lap = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY A/ }).click();
await page.getByRole('button', { name: 'START NEW PROJECT', exact: true }).click();
await vis.getByText('Draw with the pointer').first().waitFor();
const box = vis.getByLabel('show streamlines');
if (!(await box.isDisabled())) throw new Error('the streamlines box should be switched off before anything is simulated');
await vis.getByText('Streamlines: switched on while a simulation runs').first().waitFor();
step('streamlines: switched off before anything is simulated, and the screen says why');
await page.getByRole('button', { name: 'SIMULATE', exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 60000 });
if (await box.isDisabled()) throw new Error('the streamlines box should work while a simulation runs');
await box.check();
await vis.getByText(/streamlines of the running average/).first().waitFor({ timeout: 120000 });
await page.screenshot({ path: join(out, '1-running.png') });
step(`streamlines of the running average while the run goes (${lap()})`);
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'FINISHED'), null, { timeout: 900000 });
await vis.getByText(/streamlines of the mean flow of v0/).first().waitFor({ timeout: 30000 });
await page.screenshot({ path: join(out, '2-finished.png') });
step(`when the run ends they are replaced by the measured mean (${lap()})`);
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`streamlines smoke test passed (${lap()})`);
