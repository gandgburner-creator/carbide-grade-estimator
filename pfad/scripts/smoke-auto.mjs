/**
 * Browser smoke test of AUTO-BUILD in the flow-guided geometry workspace (small, non-judged Universe A runs).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-auto.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). Two cases on one project:
 *   1. detector evidence only: the first simulation measures nothing at the detector's evidence level,
 *      so auto-build must stop by itself and build nothing;
 *   2. weak measurements allowed: it must add two increments (v1, v2), simulating each, tag them
 *      exploratory, and stop as finished.
 * About six minutes: three simulations of three seeds each.
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
const out = process.argv[3] ?? 'smoke-auto-out';
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
const log = () => vis.locator('ul.auto-log').innerText();
const waitStopped = (timeout) => vis.locator('ul.auto-log li.stop').first().waitFor({ timeout });

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY/ }).click();
await vis.getByText('4 · Auto-build (experimental)').waitFor({ timeout: 10000 });
await vis.getByText('stops by itself when nothing is measured').first().waitFor();
step('the auto-build card is there and says what it does');

// 1. detector evidence only: nothing is measured at that level, so it must stop and build nothing
await vis.getByLabel('number of increments to add', { exact: true }).fill('1');
await vis.getByRole('checkbox', { name: /also build from weak measurements/ }).uncheck();
await page.getByRole('button', { name: /START AUTO-BUILD/ }).click();
await vis.getByText('Simulating v0').waitFor({ timeout: 10000 });
await waitStopped(600000);
let text = await log();
if (!/nothing is measured to respond to/.test(text) || !/switched off/.test(text)) throw new Error(`auto-build did not explain that nothing was measured:\n${text}`);
if (!/Nothing was built/.test(text)) throw new Error('auto-build should have built nothing');
await page.screenshot({ path: join(out, '1-stopped-nothing-measured.png') });
step(`detector evidence only: it simulated v0, found nothing to respond to, and stopped by itself (${lap()})`);

// 2. weak measurements allowed: two increments
await vis.getByLabel('number of increments to add', { exact: true }).fill('2');
await vis.getByRole('checkbox', { name: /also build from weak measurements/ }).check();
await page.getByRole('button', { name: /START AUTO-BUILD/ }).click();
await vis.getByText(/Increment 1 of 2/).first().waitFor({ timeout: 30000 });
await vis.getByText('EXPLORATORY, below the detector’s evidence').first().waitFor();
await page.screenshot({ path: join(out, '2-drawing-increment-1.png') });
step('increment 1 is chosen, labelled exploratory, and its construction point is being drawn');
await vis.getByText(/Accepted increment 1 of 2/).waitFor({ timeout: 60000 });
step(`increment 1 accepted automatically (${lap()})`);
await vis.getByText(/Increment 2 of 2/).first().waitFor({ timeout: 600000 });
await vis.getByText(/Accepted increment 2 of 2/).waitFor({ timeout: 60000 });
step(`increment 2 accepted automatically (${lap()})`);
await vis.getByText(/Stopped \(finished\)/).waitFor({ timeout: 600000 });
text = await log();
if (!/Built v1, v2 \(0 from detector evidence, 2 exploratory\)/.test(text)) throw new Error(`the summary of what was built is wrong:\n${text}`);
if (!/stated prediction/.test(text)) throw new Error('the log does not report the stated prediction after the re-simulations');
await page.screenshot({ path: join(out, '3-finished.png') });
step(`auto-build finished: v1 and v2 built, each simulated, tagged exploratory (${lap()})`);

// the history keeps everything
await page.getByRole('button', { name: 'History', exact: true }).click();
await vis.getByText('v2', { exact: false }).first().waitFor();
const hist = await vis.innerText();
if (!/auto-build increment 1 of 2/.test(hist) && !/accepted → v1/.test(hist)) throw new Error('the history does not show the automatic steps');
await page.screenshot({ path: join(out, '4-history.png') });
step('the history shows the automatic steps');

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`auto-build smoke test passed (${lap()})`);
