/**
 * Browser smoke test of the fluid controls and the physics sheet of the CFD workspace (no simulation is run):
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-fluids.mjs [http://localhost:4173/] [out-dir]
 *
 * Needs Playwright with a Chromium (not a project dependency).
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
const out = process.argv[3] ?? 'smoke-fluids-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const vis = page.locator('.shell-body:visible');
const field = (name) => vis.getByLabel(name, { exact: true });
const expectText = (text, timeout = 10000) => vis.getByText(text, { exact: false }).first().waitFor({ timeout });
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const props = () => vis.getByTestId('fluid-properties').textContent();
const row = (name) => vis.locator('.physics-sheet .prow', { hasText: name }).first();
const fail = (m) => {
  throw new Error(m);
};

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
await expectText('Physics sheet');

// air at the default height: ISA sea level
let p = await props();
if (!/Air \(dry\) at 15 °C/.test(p) || !/density 1\.22\d+ kg\/m³/.test(p)) fail(`air at 15 °C: unexpected properties: ${p}`);
step('air, 15 °C, sea level: density 1.225 kg/m³');

// the height gives the pressure
await field('height above sea level in m').fill('5000');
p = await props();
if (!/54\.02 kPa/.test(p)) fail(`air at 5000 m should be at about 54.0 kPa: ${p}`);
await vis.getByRole('button', { name: /USE THE STANDARD-ATMOSPHERE TEMPERATURE AT THIS HEIGHT/ }).click();
if ((await field('fluid temperature in °C').inputValue()) !== '-17.5') fail('ISA temperature at 5000 m is −17.5 °C');
step('height 5000 m: ISA pressure 54 kPa, and the button sets −17.5 °C');

// a typed pressure
await vis.getByLabel('pressure source').selectOption('absolute');
await field('pressure in kPa').fill('20');
p = await props();
if (!/20\.00 kPa as given/.test(p)) fail(`typed pressure not used: ${p}`);
step('air at a typed pressure of 20 kPa');

// water
await vis.getByLabel('fluid', { exact: true }).selectOption('water');
if ((await field('fluid temperature in °C').inputValue()) !== '20') fail('choosing water should set 20 °C');
p = await props();
if (!/Fresh water at 20 °C/.test(p) || !/density 998\.\d+ kg\/m³/.test(p) || !/viscosity 1\.0×10⁻³ Pa·s/.test(p)) fail(`water properties: ${p}`);
await vis.getByLabel('pressure source').selectOption('depth');
await field('depth in m').fill('10');
p = await props();
if (!/199\.2 kPa at 10 m depth/.test(p)) fail(`pressure at 10 m depth: ${p}`);
await expectText('Cavitation number');
const sigma = await row('Cavitation number').textContent();
step(`water, 20 °C, 10 m deep: ${p.slice(0, 120)}… · cavitation row: ${sigma.slice(0, 60)}…`);
await shot('1-water');

// temperature out of range
await field('fluid temperature in °C').fill('130');
await expectText('fluid temperature must be between 0 and 100');
await field('fluid temperature in °C').fill('20');
step('130 °C water is refused in words');

// fast wind in air -> compressible warning
await vis.getByLabel('fluid', { exact: true }).selectOption('air');
await vis.getByLabel('pressure source').selectOption('altitude');
await field('height above sea level in m').fill('0');
await field('fluid temperature in °C').fill('15');
await field('wind speed in km/h').fill('600');
await expectText('no compressibility correction is applied');
if (!/⚠|ⓘ/.test(await row('Mach number').textContent())) fail('the Mach row should be marked');
step('600 km/h in air: the Mach number is flagged compressible, no correction applied');
await field('wind speed in km/h').fill('36');

// custom fluid
await vis.getByLabel('fluid', { exact: true }).selectOption('custom');
await field('custom density in kg/m³').fill('1260');
await field('custom viscosity in mPa·s').fill('1410');
p = await props();
if (!/density 1260\.00 kg\/m³/.test(p)) fail(`custom fluid: ${p}`);
step('custom fluid (glycerol-like): density 1260, viscosity 1410 mPa·s');
await shot('2-custom');

// helium
await vis.getByLabel('fluid', { exact: true }).selectOption('helium');
p = await props();
if (!/Helium at 20 °C/.test(p) || !/speed of sound 10\d\d m\/s/.test(p)) fail(`helium: ${p}`);
step('helium: speed of sound about 1007 m/s');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-fluids: OK');
