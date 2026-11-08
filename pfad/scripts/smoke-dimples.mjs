/**
 * Browser smoke test of the dimpled sections and of saving and comparing studies in the CFD workspace: the dimple settings (size, depth,
 * density), their preview, a dimpled body, the study with a dimpled twin, saving two studies, comparing them (table, chart, differences),
 * keeping them across a reload, and exporting and importing them. A DRAFT resolution keeps it to a few minutes without a graphics card.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-dimples.mjs [http://localhost:4173/] [out-dir]
 */
import { mkdirSync, readFileSync } from 'node:fs';
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
const out = process.argv[3] ?? 'smoke-dimples-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 1200 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => d.accept());
const step = (s) => console.log(`· ${s}`);
const fail = (m) => {
  throw new Error(m);
};
const vis = () => page.locator('.shell-body:visible');
const button = (name) => vis().getByRole('button', { name, exact: true });
const shot = (name, el) => (el ?? page).screenshot({ path: join(out, `${name}.png`), timeout: 60000 });
const finished = (timeout = 500000) => page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && /FINISHED|FAILED/.test(e.textContent)), null, { timeout });
const countOf = async () => Number((await vis().getByTestId('dimple-readout').textContent()).match(/^\s*(\d+) dimples/)?.[1]);
const open = async () => {
  await page.goto(url);
  await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
  await vis().getByTestId('airfoil-panel').waitFor();
};

await open();
const box = vis().getByTestId('dimple-box');
await box.waitFor();
const n0 = await countOf();
if (!(n0 > 5)) fail(`the default settings should give a row of dimples, not ${n0}`);
step(`the dimple settings are there (${n0} dimples by default)`);

// size and density change the number of dimples
await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).fill('2');
const nSmall = await countOf();
if (!(nSmall > n0)) fail(`smaller dimples at the same density should be more: ${nSmall} against ${n0}`);
await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).fill('8');
await vis().getByLabel('dimple density in % covered', { exact: true }).fill('30');
const nSparse = await countOf();
await vis().getByLabel('dimple density in % covered', { exact: true }).fill('95');
const nDense = await countOf();
if (!(nDense > nSparse)) fail(`a higher density should give more dimples: ${nDense} against ${nSparse}`);
step(`size and density act: 2 % → ${nSmall} dimples, 8 % at 30 % cover → ${nSparse}, at 95 % → ${nDense}`);

// a bad value is refused in words and disables the button
await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).fill('0.1');
await vis().getByTestId('dimple-errors').waitFor();
if (!/outside/.test(await vis().getByTestId('dimple-errors').textContent())) fail('the error should say the value is outside the range');
if (await vis().getByLabel('use NACA 4412 with dimples').isEnabled()) fail('USE WITH DIMPLES should be disabled for invalid settings');
await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).fill('8');
await vis().getByLabel('dimple depth in % of the diameter', { exact: true }).fill('30');
await vis().getByLabel('dimple density in % covered', { exact: true }).fill('80');
await vis().getByLabel('dimple preview magnification').selectOption('4');
await vis().getByTestId('dimple-preview').waitFor();
await shot('1-dimples', box);
step('an invalid value is refused in words; the preview shows the dimples');

// the preset menu sets all the boxes
await vis().getByLabel('dimple settings preset').selectOption('golf');
if ((await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).inputValue()) !== '4') fail('the golf-ball preset should set the diameter to 4 %');
await vis().getByLabel('dimple settings preset').selectOption('custom').catch(() => {});
await vis().getByLabel('dimple diameter in % of the chord', { exact: true }).fill('8');
await vis().getByLabel('dimple depth in % of the diameter', { exact: true }).fill('30');
await vis().getByLabel('dimple density in % covered', { exact: true }).fill('80');

// a dimpled body in a project
await button('resolution draft').click();
await vis().getByLabel('angle of attack in °', { exact: true }).fill('4');
await button('use NACA 4412 with dimples').click();
await vis().getByTestId('dimple-note').waitFor();
const note = await vis().getByTestId('fixed-body-note').textContent();
if (!/dimpled version/i.test(note) || !/groove across the whole wing/.test(note)) fail('the project should say it is a dimpled version and what a dimple is in two dimensions');
await page.getByText('NACA 4412 + dimples', { exact: false }).first().waitFor();
step('NACA 4412 with dimples is the body of a project');
await shot('2-dimpled-body');

// a study of a plain section and its dimpled twin
const panel = vis().getByTestId('airfoil-panel');
await panel.locator('[data-airfoil="NACA 0012"]').getByLabel('study NACA 0012', { exact: true }).check();
await panel.locator('[data-airfoil="NACA 0012"]').getByLabel('study NACA 0012 with dimples').check();
await vis().getByLabel('study angles').fill('0');
await button('run the airfoil study').click();
await page.waitForFunction(() => document.querySelectorAll('[data-study-row]').length >= 2, null, { timeout: 500000 });
const rows = await vis().locator('[data-study-row]').allTextContents();
if (!rows.some((r) => /NACA 0012 \+ dimples \(⌀8 %, depth 30 %, 80 % cover/.test(r)) || !rows.some((r) => /^NACA 0012\d/.test(r))) fail(`the study should have the plain and the dimpled section: ${rows.join(' | ')}`);
step(`the study has the plain section and its dimpled twin: ${rows.map((r) => r.slice(0, 70)).join(' | ')}`);

// save it, run another study, save that too
await vis().getByLabel('name for the study to save').fill('0012 plain and dimpled');
await vis().getByLabel('save this study').click();
await vis().getByTestId('save-message').waitFor();
await vis().locator('[data-saved="0012 plain and dimpled"]').waitFor();
await panel.locator('[data-airfoil="NACA 0012"]').getByLabel('study NACA 0012', { exact: true }).uncheck();
await panel.locator('[data-airfoil="NACA 0012"]').getByLabel('study NACA 0012 with dimples').uncheck();
await panel.locator('[data-airfoil="NACA 4412"]').getByLabel('study NACA 4412', { exact: true }).check();
await vis().getByLabel('study angles').fill('0');
await button('run the airfoil study').click();
await page.waitForFunction(() => document.querySelectorAll('[data-study-row]').length === 1 && !document.body.textContent.includes('Run 1 of 1'), null, { timeout: 500000 });
await page.waitForFunction(() => document.querySelectorAll('[data-study-row]').length >= 1, null, { timeout: 500000 });
await vis().getByLabel('name for the study to save').fill('4412 alone');
await vis().getByLabel('save this study').click();
await vis().locator('[data-saved="4412 alone"]').waitFor();
step('two studies are saved');

// compare them
await vis().getByLabel('compare 0012 plain and dimpled').check();
await vis().getByLabel('compare 4412 alone').check();
const cmp = vis().getByTestId('compare-box');
await cmp.waitFor();
const heads = await cmp.locator('thead th').allTextContents();
if (heads.length !== 4 || !heads.some((h) => /NACA 4412/.test(h)) || !heads.some((h) => /dimples/.test(h))) fail(`the comparison should have a column for each of the three sections: ${heads.join(' | ')}`);
await vis().getByTestId('compare-chart').waitFor();
if ((await cmp.getByTestId('compare-legend').locator('button').count()) !== 3) fail('the legend should have three entries');
if (!/Δ/.test(await cmp.getByTestId('compare-table').textContent())) fail('the table should show the differences from the reference series');
if ((await cmp.getByTestId('compare-differ').count()) !== 0) fail('both studies were run under the same conditions: no warning expected');
await shot('3-compare', vis().getByTestId('saved-studies'));
await vis().getByLabel('comparison quantity').selectOption('drag');
if (!/0\.\d{4}/.test(await cmp.getByTestId('compare-table').textContent())) fail('C_d should be shown with four decimals');
// the comparison can be opened over the whole window, where the chart and the table have room
await cmp.getByLabel('enlarge the comparison').click();
const big = page.getByRole('dialog', { name: 'comparison of saved studies' });
await big.waitFor();
const bigWidth = await big.getByTestId('compare-chart').evaluate((e) => e.getBoundingClientRect().width);
if (bigWidth < 600) fail(`the enlarged chart should be wide, not ${bigWidth}px`);
await shot('4-compare-large', big);
await page.keyboard.press('Escape');
await cmp.waitFor();
await cmp.getByLabel('hide NACA 4412 — 4412 alone').click();
if ((await cmp.locator('thead th').count()) !== 3) fail('hiding a series should remove its column');
step('the comparison shows the three sections side by side, with the chart, the differences and no warning');

// persistence, export and import
await page.reload();
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
await vis().locator('[data-saved="4412 alone"]').waitFor();
if ((await vis().locator('[data-saved]').count()) !== 2) fail('the saved studies should survive a reload');
const [dl] = await Promise.all([page.waitForEvent('download'), vis().getByLabel('export the saved studies to a file').click()]);
const file = join(out, 'exported.json');
await dl.saveAs(file);
const exported = JSON.parse(readFileSync(file, 'utf8'));
if (exported.studies?.length !== 2) fail('the export should hold both studies');
await vis().getByLabel('delete 4412 alone').click();
if ((await vis().locator('[data-saved]').count()) !== 1) fail('delete should remove the study');
await vis().getByLabel('import saved studies from a file').setInputFiles(file);
await vis().locator('[data-saved="4412 alone"]').waitFor();
if (!/1 saved study was added, 1 already there/.test(await vis().getByTestId('save-message').textContent())) fail(`the import should say what it added: ${await vis().getByTestId('save-message').textContent()}`);
step('saved studies survive a reload, export to a file and import from it without duplicates');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-dimples: OK');
