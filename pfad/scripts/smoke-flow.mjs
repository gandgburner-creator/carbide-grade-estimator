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

// the plain-unit inputs: plate in cm, air in °C and m, wind in km/h, angle in degrees
const field = (name) => page.locator('.shell-body:visible').getByLabel(name, { exact: true });
if ((await field('plate length in cm').inputValue()) !== '20' || (await field('angle of attack in °').inputValue()) !== '65') throw new Error('unexpected default inputs');
await expectText('What the simulation will run');
await expectText('cannot show a wind that slow'); // 36 km/h is far below what the particle model can resolve
await expectText('very different flow regime');
await expectText('does not predict how air flows around your plate');
// a wrong input is explained in plain words and blocks the start
await field('plate thickness in cm').fill('15');
await expectText('at least 2 times longer');
if (await button('START NEW PROJECT').isEnabled()) throw new Error('START NEW PROJECT must be disabled for an impossible plate');
await field('plate thickness in cm').fill('2');
// a different air state and wind: still the same simulation when the wind is below what the model can show
await field('air temperature in °C').fill('-5');
await field('height above sea level in m').fill('1500');
await field('wind speed in km/h').fill('50');
// the wing depth only scales lift and drag; a depth outside 1 cm - 50 m is explained and blocks the start
await field('wing depth in cm').fill('0');
await expectText('between 1 and 5000 cm');
if (await button('START NEW PROJECT').isEnabled()) throw new Error('START NEW PROJECT must be disabled for an impossible wing depth');
await field('wing depth in cm').fill('150');
await button('START NEW PROJECT').click();
await expectText('Starts from a flat plate (30 × 3 particle diameters');
step('plain inputs are checked, explained, and turned into the simulation setup (20 × 2 cm → 30 × 3 particle diameters)');
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
await expectText('Lift and drag of v0');
await expectText('SCALED ESTIMATE');
await expectText('NOT A PREDICTION');
const forcesText = await page.locator('.shell-body:visible .forces').first().innerText();
if (!/Drag/.test(forcesText) || !/Lift/.test(forcesText) || !/ N\b/.test(forcesText) || !/150 cm/.test(forcesText)) throw new Error(`the lift and drag table is incomplete: ${forcesText.slice(0, 300)}`);
const quality = forcesText.replace(/nothing here is optimi[sz]ed/i, '').match(/.{0,40}(\b(better|best|optimal|optimi[sz]ed)\b|\befficien).{0,40}/i);
if (quality) throw new Error(`the lift and drag panel makes a quality claim: ${quality[0]}`);
await page.locator('.shell-body:visible .forces').first().screenshot({ path: join(out, '2b-forces.png') });
step('lift and drag of v0 are shown as measured, as coefficients and as a scaled estimate for a 150 cm deep wing, labelled not a prediction');

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
const cmpText = await page.locator('.shell-body:visible .section', { has: page.getByRole('heading', { name: 'comparison', exact: true }) }).first().innerText();
if (!/no composite score/i.test(cmpText)) throw new Error('the comparison does not say that it has no composite score');
if (!/Lift and drag of A and B/i.test(cmpText) || !/drag coefficient/i.test(cmpText) || !/lift on your wing/i.test(cmpText) || !/no lift-to-drag ranking/i.test(cmpText)) throw new Error(`the comparison lacks the lift and drag table or its no-ranking statement: ${cmpText.slice(0, 400)}`);
await page.locator('.shell-body:visible table.compare').last().screenshot({ path: join(out, '6b-compare-forces.png') });
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
if (p.wingDepthCm !== 150) throw new Error(`the wing depth was not saved in the project (got ${p.wingDepthCm})`);
const v0 = p.versions.find((v) => v.id === 'v0');
const v1 = p.versions.find((v) => v.id === 'v1');
if (v1?.parent !== 'v0' || !v1.construction?.reason || !v1.construction.hypothesis || !v1.construction.basis?.summary || !v1.construction.points?.length) throw new Error(`v1 history is incomplete: ${JSON.stringify(v1?.construction ? Object.keys(v1.construction) : Object.keys(v1 ?? {}))}`);
if (!p.proposals?.some((e) => e.status === 'accepted' && e.acceptedVersion === 'v1')) throw new Error('the accepted proposal is not recorded');
for (const v of [v0, v1]) {
  const r = v?.run;
  if (!r?.recordId || !r.seeds?.length || !r.codeVersion || !r.modelVersion || !r.integrity?.status || !r.analysis?.upper?.label) throw new Error(`${v?.id} run provenance is incomplete: ${JSON.stringify(Object.keys(r ?? {}))}`);
}
if (JSON.stringify(v0.run.seeds) !== JSON.stringify(v1.run.seeds)) throw new Error('v0 and v1 were not run with the same seeds');
if (!Array.isArray(p.log) || !p.log.some((e) => e.type === 'accepted')) throw new Error('the event log lacks the acceptance');
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
