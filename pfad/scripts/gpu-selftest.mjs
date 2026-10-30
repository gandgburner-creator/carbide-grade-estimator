/**
 * Run the GPU self-test (src/cfd/gpu/GpuSelfTest.ts) in a headless Chromium, against the Vite development server:
 *
 *   npx vite --port 5174 &
 *   node scripts/gpu-selftest.mjs [http://localhost:5174/gpu-test.html] [--cylinders] [--size 576x384]
 *
 * In a sandbox without a graphics card Chromium runs WebGPU on a software implementation (SwiftShader): the answers are
 * the same, only slower. Needs Playwright with a Chromium (not a project dependency).
 */
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
const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5174/gpu-test.html';
const cylinders = args.includes('--cylinders');
const sizeArg = args.find((a) => /^\d+x\d+$/.test(a)) ?? (args.includes('--size') ? args[args.indexOf('--size') + 1] : null);
const speedSize = sizeArg ? sizeArg.split('x').map(Number) : undefined;

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__gpuTest, null, { timeout: 60000 });
const out = await page.evaluate((o) => window.__gpuTest.run(o), { cylinders, speedSize, speedSteps: 100, compareCpu: true });
console.log(JSON.stringify(out.info));
for (const l of out.lines) console.log(`${l.ok ? 'PASS' : 'FAIL'}  ${l.label}: ${l.detail}`);
console.log(`${out.seconds.toFixed(1)} s`);
await browser.close();
process.exit(out.lines.every((l) => l.ok) ? 0 : 1);
