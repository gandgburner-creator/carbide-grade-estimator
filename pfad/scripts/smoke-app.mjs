/**
 * Browser smoke test of the laboratory app (small, non-judged Universe A runs only).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-app.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency). It loads the app, runs the
 * quick static-pressure box to completion, checks the record, the library entry, a field
 * legend, the analysis tabs and the exports, runs a short UB-0 instrument run with a
 * checkpoint, and confirms that Universe B is locked. Screenshots go to out-dir.
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
    // a global installation
    const root = (await import('node:child_process')).execSync('npm root -g').toString().trim();
    ({ chromium } = req(join(root, 'playwright')));
  }
} catch {
  console.error('playwright is not installed; install it to run this smoke test');
  process.exit(2);
}
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const expectText = async (text, timeout = 10000) => page.getByText(text, { exact: false }).first().waitFor({ timeout });
const button = (name) => page.getByRole('button', { name, exact: true });
const download = async (name) => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), button(name).first().click()]);
  const p = join(out, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};

await page.goto(url);
await expectText('PFAD LABORATORY');
step('loaded the app');

// 1. quick static-pressure box, end to end
await button('LOAD').click();
await page.waitForFunction(() => document.querySelector('.phase')?.textContent === 'LOADED');
await page.selectOption('select[aria-label="field"]', 'kT');
await button('RUN').click();
await page.waitForFunction(() => document.querySelector('.phase')?.textContent === 'FINISHED', null, { timeout: 180000 });
step('static box finished');
await expectText('Measured (');
await expectText('MEASURED wall pressure');
await shot('1-static-box-finished');
const legend = await page.locator('.legend').innerText();
if (!/kT₀/.test(legend) || !/MEASURED/.test(legend) || !/time-averaged|instantaneous/.test(legend)) throw new Error(`field legend lacks units/origin/averaging: ${legend}`);
step('field legend states units, origin and averaging');

const json = await download('RECORD JSON');
const csv = await download('MEASURED CSV');
step(`exported ${json} and ${csv}`);
const fs = await import('node:fs');
const rec = JSON.parse(fs.readFileSync(json, 'utf8'));
if (rec.experimentType !== 'static-box' || !rec.labProvenance?.codeVersion) throw new Error('exported record lacks type or provenance');
if (!/^# codeVersion: /m.test(fs.readFileSync(csv, 'utf8'))) throw new Error('CSV lacks provenance header');
await download('FIELD CSV');
await download('PNG');
step('field CSV and view PNG exported');

// analysis tabs
await button('Wall momentum transfer').click();
await expectText('P_wall [kT₀/d²]');
await button('Near-wall profile').click();
await page.locator('.analysis input[type=checkbox]').first().check();
await page.waitForTimeout(300);
await shot('2-profile-tab');
await button('Time series').click();
step('analysis tabs render');

// zoom and pan
const canvas = page.locator('.canvas-host canvas');
const box = await canvas.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(200);
const fit = await page.locator('button:has-text("fit (")').count();
if (!fit) throw new Error('zoom did not register');
await shot('3-zoomed');
step('zoom works');

// library
await page.getByRole('button', { name: /^Library/ }).click();
await expectText('COMPLETED');
await shot('4-library');
step('run is in the library');

// 2. UB-0 instrument (Universe A), short, with a checkpoint
await page.getByRole('button', { name: /UB-0 INSTRUMENT/ }).click();
await expectText('N_c = 1 (Universe A)');
await button('LOAD').click();
await page.waitForFunction(() => document.querySelector('.phase')?.textContent === 'LOADED');
await button('RUN').click();
// pause early: the quick instrument run takes about a second, so a long wait could outlast it
await page.waitForTimeout(250);
await button('PAUSE').click();
await button('CHECKPOINT').click();
await expectText('Checkpoint stored');
await shot('5-instrument-checkpoint');
step('instrument checkpoint stored');
await button('STOP').click();
await expectText('STOPPED');

// resume the checkpoint from the library and finish it
await page.getByRole('button', { name: /^Library/ }).click();
await page.locator('.lib-item', { hasText: 'CHECKPOINT' }).first().getByRole('button', { name: 'RESUME', exact: true }).click();
await expectText('Resumed checkpoint');
await button('RUN').click();
await page.waitForFunction(() => document.querySelector('.phase')?.textContent === 'FINISHED', null, { timeout: 180000 });
await expectText('mean ± SE over seeds');
step('checkpoint resumed from the library and finished with a record');

// import repository records and compare two of them
await page.getByRole('button', { name: /^Library/ }).click();
const here = new URL('.', import.meta.url).pathname;
await page.locator('.lib-item, .section').first().waitFor();
await page.setInputFiles('input[type=file][multiple]', [join(here, '..', 'results', 'static-box_reference_seed7.json'), join(here, '..', 'results', 'viscosity_reference.json')]);
await expectText('Imported 2 record(s)');
await expectText('IMPORTED');
step('imported two repository records');
await page.getByRole('button', { name: 'Compare', exact: true }).click();
const selects = page.locator('.field select');
const opts = await selects.first().locator('option').allTextContents();
const staticOpts = opts.filter((o) => /Static box/i.test(o));
if (staticOpts.length < 2) throw new Error(`expected two static-box records to compare, got ${staticOpts.join(' | ')}`);
await selects.nth(0).selectOption({ label: staticOpts[0] });
await selects.nth(1).selectOption({ label: staticOpts[1] });
await expectText('not a hypothesis test');
await page.locator('.table-scroll table tbody tr').first().waitFor();
await shot('7-compare');
step('compared two static-box records');

// 3. Universe B is locked
await page.getByRole('button', { name: /UNIVERSE B/ }).click();
await expectText('Locked. UB-0 is preregistered and blind');
if (await button('LOAD').count()) throw new Error('Universe B offers a LOAD button');
await shot('6-universe-b-locked');
step('Universe B is locked');

// 4. phone-sized screen: the run controls must be on screen without scrolling, and a run must work by touch
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ph = await ctx.newPage();
  ph.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`));
  await ph.goto(url);
  await ph.getByText('PFAD LABORATORY', { exact: false }).first().waitFor({ timeout: 10000 });
  const onScreen = (label) =>
    ph.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t);
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.width > 30 && r.height > 30;
    }, label);
  for (const label of ['LOAD', 'RUN', 'PAUSE', 'STOP']) {
    if (!(await onScreen(label))) throw new Error(`phone: the ${label} button is not on screen`);
  }
  await ph.getByRole('button', { name: 'LOAD', exact: true }).tap();
  await ph.waitForFunction(() => document.querySelector('.phase')?.textContent === 'LOADED');
  await ph.getByRole('button', { name: 'RUN', exact: true }).tap();
  await ph.waitForFunction(() => document.querySelector('.phase')?.textContent === 'FINISHED', null, { timeout: 180000 });
  const sideways = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sideways > 1) throw new Error(`phone: the page scrolls sideways by ${sideways}px`);
  await ph.evaluate(() => document.querySelector('.view-toolbar').scrollIntoView());
  await ph.screenshot({ path: join(out, '8-phone.png') });
  step('phone layout: controls on screen, run by touch, no sideways scroll');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('smoke test passed');
