/**
 * Browser smoke test of the Flow-Guided Geometry workspace (small, non-judged Universe A runs only).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-flow.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-flow-out';
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
await expectText('NOT AN OPTIMISER');
await expectText('Starts from a flat plate');
step('workspace opens on a flat plate, labelled experimental / not an optimiser / not validated');

// conditions: a large angle of attack, the only regime where this model shows any backflow
const alpha = page.getByLabel('angle of attack [°]');
if ((await alpha.inputValue()) !== '65') {
  await alpha.fill('65');
  await button('APPLY CHANGES').click();
}
await shot('1-v0-before');

// 1. simulate v0 with the real engine
await button('SIMULATE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 30000 });
step('v0 is running');

// responsiveness while the worker simulates: animation frames keep coming, and PAUSE / RESUME act promptly
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = (t) => {
        n++;
        if (t - t0 >= 2000) resolve((1000 * n) / (t - t0));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
if (fps < 8) throw new Error(`the page renders only ${fps.toFixed(1)} frames/s while a simulation runs`);
const tPause = Date.now();
await button('PAUSE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'PAUSED'), null, { timeout: 5000 });
const pauseMs = Date.now() - tPause;
await button('RESUME').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 5000 });
step(`responsive while simulating: ${fps.toFixed(0)} frames/s, pause took ${pauseMs} ms`);
await finished();
step(`v0 finished (${lap()})`);
await expectText('near-wall measurements of v0');
await expectText('EXPERIMENTAL');
await shot('2-v0-measured');
const detectorText = await page.locator('.section', { hasText: 'near-wall measurements of v0' }).innerText();
if (!/provisional|experimental/i.test(detectorText)) throw new Error('detector panel does not label itself provisional/experimental');
if (/(an?|the|is) optimi[sz]ed (geometry|airfoil|shape|profile)|validated airfoil|separation (is )?confirmed/i.test(detectorText)) throw new Error('detector panel makes an optimisation/validation/confirmation claim');
step('measurements and the detector label are shown');

// 2. propose an increment (exploratory) and trace it
await page.getByText('Exploratory', { exact: true }).first().click();
await button('PROPOSE INCREMENT').click();
await expectText('EXPLORATORY PROPOSAL');
await expectText('HYPOTHESIS');
await shot('3-proposal');
step('an exploratory proposal appears, labelled below evidence, with a stated hypothesis');
for (let i = 0; i < 4; i++) await button('ADVANCE ▶').click();
await expectText('construction point 4 /');
await expectText('MEASURED');
await shot('4-construction-point');
await button('TO END').click();
step('construction point advanced along the proposal');

// 3. accept and simulate the new version
await button('ACCEPT ALL').click();
await expectText('v1');
step('accepted: version v1 created');
await button('SIMULATE').click();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && e.textContent === 'RUNNING'), null, { timeout: 30000 });
await finished();
step(`v1 finished (${lap()})`);
await shot('5-v1-measured');

// 4. comparison
await page.getByRole('button', { name: 'Comparison', exact: true }).click();
await expectText('no single score', 10000).catch(() => {});
await expectText('hypothesis');
await shot('6-comparison');
const cmpText = await page.locator('.section', { hasText: 'comparison' }).first().innerText();
if (/lift|drag coefficient|L\/D|efficiency score/i.test(cmpText.replace(/not (a )?(lift|drag)[^.]*\./gi, ''))) console.log('  note: comparison text mentions lift/drag words; check wording:', cmpText.match(/.{40}(lift|drag|L\/D).{40}/i)?.[0]);
step('comparison with the parent is shown');

// 5. history, replay, exports
await page.getByRole('button', { name: 'History', exact: true }).click();
await expectText('v0');
await expectText('v1');
await shot('7-history');
await page.getByRole('button', { name: /▶ REPLAY/ }).click();
await expectText('frame 1 /');
await page.getByRole('button', { name: /▶ PLAY/ }).click();
await page.waitForTimeout(1500);
await shot('8-replay');
await button('EXIT REPLAY').click();
step('replay plays through the accepted versions');

const proj = await download('PROJECT JSON');
const svg = await download('GEOMETRY SVG');
const csv = await download('SURFACE CSV');
const p = JSON.parse(readFileSync(proj, 'utf8'));
if (!p.versions || p.versions.length < 2) throw new Error('project JSON lacks the versions');
const v1 = p.versions.find((v) => v.id === 'v1');
if (!v1?.parent || !v1.reason || !v1.acceptance || !v1.proposal) throw new Error(`v1 history is incomplete: ${JSON.stringify(Object.keys(v1 ?? {}))}`);
if (!p.versions[0].run?.runId || !p.versions[0].run?.conditions?.seeds && !p.conditions?.seeds) throw new Error('v0 run lacks the run id / seeds');
if (!/<svg/.test(readFileSync(svg, 'utf8'))) throw new Error('SVG export is not SVG');
if (!/^# /m.test(readFileSync(csv, 'utf8'))) throw new Error('surface CSV lacks a provenance header');
step(`exported project JSON (${p.versions.length} versions), SVG and surface CSV`);

// 6. undo returns to the parent, and the undone version stays in the history
await page.getByRole('button', { name: 'Comparison', exact: true }).click();
await button('UNDO LAST ACCEPTED').click();
await expectText('undone');
await shot('9-undone');
step('undo returns to v0 and keeps v1 in the history');

// 7. Universe B stays locked
await page.getByRole('button', { name: 'LABORATORY', exact: true }).click();
await page.getByRole('button', { name: /UNIVERSE B/ }).click();
await expectText('Locked. UB-0 is preregistered and blind');
step('Universe B is locked');

// 8. phone-sized screen: no sideways scroll
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`));
  await ph.goto(url);
  await ph.getByRole('button', { name: /FLOW-GUIDED GEOMETRY/ }).tap();
  await ph.getByText('NOT AN OPTIMISER', { exact: false }).first().waitFor({ timeout: 10000 });
  const sideways = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sideways > 1) throw new Error(`phone: the page scrolls sideways by ${sideways}px`);
  await ph.screenshot({ path: join(out, '10-phone.png') });
  step('phone layout: no sideways scroll');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`flow smoke test passed (${lap()})`);
