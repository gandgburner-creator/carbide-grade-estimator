/**
 * Browser smoke test of the graphics-card path of the CFD workspace: a real run on WebGPU (a coarse DRAFT, so it is quick even on the
 * software WebGPU of a machine without a card), the engine recorded in the result, the field drawn by WebGL, the animated tracers, and
 * the in-app GPU self-test.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/smoke-gpu.mjs [http://localhost:4173/] [out-dir]
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
const out = process.argv[3] ?? 'smoke-gpu-out';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = (s) => console.log(`· ${s}`);
const vis = page.locator('.shell-body:visible');
const expectText = (text, timeout = 10000) => vis.getByText(text, { exact: false }).first().waitFor({ timeout });
const shot = async (name) => {
  const t = Date.now();
  await page.screenshot({ path: join(out, `${name}.png`), timeout: 120000 });
  step(`screenshot ${name} (${Date.now() - t} ms)`);
};
const fail = (m) => {
  throw new Error(m);
};
const button = (name) => page.getByRole('button', { name, exact: true });

await page.goto(url);
await page.getByRole('button', { name: /FLOW-GUIDED GEOMETRY B/ }).click();
await expectText('Graphics card:');
step(`GPU panel: ${(await vis.getByTestId('gpu-panel').textContent()).slice(0, 110)}…`);

await button('compute on the graphics card').click();
await button('resolution draft').click();
await expectText('Resolution: 24 cells');
await vis.getByLabel('wind speed in km/h', { exact: true }).fill('3');
await button('START NEW PROJECT').click();
await expectText('24 cells along the plate');
await button('SIMULATE').click();
step('SIMULATE on the graphics card (draft, 24 cells)');
const t0 = Date.now();
await page.waitForFunction(() => [...document.querySelectorAll('.phase')].some((e) => e.offsetParent !== null && /FINISHED|FAILED/.test(e.textContent)), null, { timeout: 1500000 });
const phase = await page.locator('.phase:visible').first().textContent();
if (phase !== 'FINISHED') fail(`the run ended ${phase}: ${await vis.locator('.error, .warn').first().textContent().catch(() => '')}`);
step(`finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await expectText('on the graphics card');
const banner = await vis.locator('.exp-banner').filter({ hasText: 'CFD result of' }).first().textContent();
if (!/32-bit/.test(banner)) fail(`the result does not record the engine: ${banner}`);
step(`result banner: …${banner.slice(banner.indexOf('Computed'))}`);
await expectText('Pressures and Bernoulli check');
await shot('1-result');

// the field is drawn by WebGL: the canvas must not be the flat background, and the tracers can be switched on
await vis.getByLabel('show animated tracers').check();
await page.waitForTimeout(2500);
await shot('2-tracers');
const lit = await vis.locator('canvas[aria-label="CFD field view"]').evaluate((c) => {
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
  return seen.size;
});
if (lit < 12) fail(`the field view looks blank (${lit} colours)`);
step(`field view: ${lit} distinct colour classes`);

// the in-app self-test (the channel case on this card)
await button('test the graphics card').click();
await expectText('Channel flow follows the exact parabola', 240000);
await vis.getByText('Speed', { exact: false }).first().waitFor({ timeout: 120000 });
step(`self-test: ${(await vis.getByTestId('gpu-panel').textContent()).replace(/\s+/g, ' ').slice(-330)}`);
await shot('3-selftest');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
await browser.close();
console.log('smoke-gpu: OK');
