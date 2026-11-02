/**
 * Browser smoke test of the reference airfoils in the CFD workspace: the list, loading a section as a fixed body, a computed run, the
 * airfoil study (two sections × two angles), a section added by code and one pasted as a coordinate file. A coarse DRAFT resolution is
 * used so that it takes about two minutes on a computer without a graphics card.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-airfoil.mjs [http://localhost:4173/] [out-dir]
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

let chromium;
const req = createRequire(import.meta.url);
try {
  ({ chromium } = req('playwright'));
} catch {
  const root = (await import('node:child_process')).execSync('npm root -g').toString().trim();
  ({ chromium } = req(join(root, 'playwright')));
}
const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-airfoil-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept());
const step = (s) => console.log(`· ${s}`);
const fail = (m) => {
  throw new Error(m);
};
const vis = page.locator('.shell-body:visible');
const button = (name) => page.getByRole('button', { name, exact: true });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), timeout: 60000 });
const finished = (timeout = 400000) => page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && /FINISHED|FAILED/.test(e.textContent)), null, { timeout });

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
const panel = vis.getByTestId('airfoil-panel');
await panel.waitFor();
const cards = await panel.locator('.airfoil-card').count();
if (cards < 15) fail(`expected the preset list, found ${cards} cards`);
const card4412 = panel.locator('[data-airfoil="NACA 4412"]');
const text4412 = await card4412.textContent();
if (!/12\.0 % thick at 30 % of the chord, 3\.\d % camber at 4\d %/.test(text4412)) fail(`the NACA 4412 card should show its measured numbers: ${text4412}`);
step(`${cards} sections; 4412: ${text4412.match(/\d+\.\d % thick[^.]*/)?.[0]}`);

// filters
await vis.getByLabel('airfoil list filter').selectOption('symmetric');
const sym = await panel.locator('.airfoil-card').count();
if (sym !== 4) fail(`the symmetric filter should show 4 sections, not ${sym}`);
await vis.getByLabel('airfoil list filter').selectOption('designed');
const designed = await panel.locator('.airfoil-card').allTextContents();
if (designed.length !== 3 || !designed.every((t, i) => t.includes(`Claude airfoil ${'ABC'[i]}`) && /HYPOTHESIS/.test(t) && /Drawn for an angle of attack of 18° and a flow of 350 km\/h/.test(t))) fail(`the designed filter should show Claude airfoil A, B and C with their conditions: ${designed.map((t) => t.slice(0, 60)).join(' | ')}`);
await vis.getByLabel('airfoil list filter').selectOption('all');
step('the list filters by aim; Claude airfoil A, B and C show their design condition');

// a coarse resolution; a designed section sets the condition it was drawn for
await button('resolution draft').click();
await vis.getByLabel('angle of attack in °', { exact: true }).fill('6');
await button('use Claude airfoil A').click();
await vis.getByTestId('fixed-body-note').waitFor();
const angleNow = await vis.getByLabel('angle of attack in °', { exact: true }).inputValue();
if (angleNow !== '18') fail(`using a designed section should set the angle to 18°, not ${angleNow}`);
const speedNow = await vis.getByLabel('wind speed in km/h', { exact: true }).inputValue();
if (speedNow !== '350') fail(`using a designed section should set the speed to 350 km/h, not ${speedNow}`);
step('Claude airfoil A is the body at 18° and 350 km/h');
await vis.getByLabel('angle of attack in °', { exact: true }).fill('6');
await button('use NACA 4412').click();
await vis.getByTestId('fixed-body-note').waitFor();
const note = await vis.getByTestId('fixed-body-note').textContent();
if (!/fixed body/.test(note)) fail('the pointer section should explain the fixed body');
step('NACA 4412 is the body: the pointer section says it is a fixed body');
await shot('1-loaded');

// a run on the CPU (no graphics card in this browser)
await button('SIMULATE').click();
await finished();
if ((await page.locator('.phase:visible').first().textContent()) !== 'FINISHED') fail('the run did not finish');
await vis.getByText('Lift and drag of v0', { exact: false }).first().waitFor();
step('the section was computed');
await shot('2-computed');

// the study: two sections, two angles
await panel.locator('[data-airfoil="NACA 4412"]').getByLabel('study NACA 4412').check();
await panel.locator('[data-airfoil="NACA 0012"]').getByLabel('study NACA 0012').check();
await vis.getByLabel('study angles').fill('0, 8');
await button('run the airfoil study').click();
await page.waitForFunction(() => document.querySelectorAll('[data-study-row]').length >= 4, null, { timeout: 600000 });
const rows = await vis.locator('[data-study-row]').allTextContents();
step(`the study table: ${rows.map((r) => r.replace(/\s+/g, ' ')).join(' | ')}`);
if (rows.length !== 4) fail(`expected 4 study rows, got ${rows.length}`);
const ld = (r) => Number(r.match(/(-?\d+\.\d)(?:\s*±|$|\s)/)?.[1]);
await shot('3-study');
const csv = await vis.getByLabel('download the study as CSV').isEnabled();
if (!csv) fail('the CSV button should be enabled');

// a section by code, and one from pasted coordinates
await vis.getByLabel('section code').fill('2415');
await button('add section by code').click();
await vis.getByText('NACA 2415 is already in the list', { exact: false }).first().waitFor();
await vis.getByLabel('section code').fill('NACA 4415');
await button('add section by code').click();
await panel.locator('[data-airfoil="NACA 4415"]').waitFor();
if ((await panel.locator('[data-airfoil="NACA 4415"]').count()) !== 1) fail('a section added twice');
await vis.getByLabel('section code').fill('4012');
await button('add section by code').click();
await vis.getByText('position of maximum camber', { exact: false }).first().waitFor();
step('a code adds a section; a bad code is refused in words');
const pts = [];
for (let i = 0; i <= 30; i++) pts.push([1 - i / 30, 0.06 * 2 * Math.sqrt((1 - i / 30) * (i / 30))]);
for (let i = 1; i <= 30; i++) pts.push([i / 30, -0.06 * 2 * Math.sqrt((i / 30) * (1 - i / 30))]);
const dat = ['TEST ELLIPSE 12%', ...pts.map(([x, y]) => `${x.toFixed(5)} ${y.toFixed(5)}`)].join('\n');
await vis.getByLabel('pasted airfoil coordinates').fill(dat);
await button('add section from pasted coordinates').click();
await panel.locator('[data-airfoil="TEST ELLIPSE 12%"]').waitFor();
const ell = await panel.locator('[data-airfoil="TEST ELLIPSE 12%"]').textContent();
if (!/imported|Selig/.test(ell) || !/12\.\d % thick/.test(ell)) fail(`the pasted section should be listed with its measured thickness: ${ell}`);
step('a pasted Selig file adds a section with its measured thickness');
await shot('4-added');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-airfoil: OK');
void ld;
