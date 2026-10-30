/**
 * Run one whole CFD run on the CPU and on the graphics card from the same parameters and print the forces side by side:
 *
 *   npx vite --port 5174 &
 *   node scripts/gpu-compare.mjs [cells=16] [reynolds=100] [alphaDeg=25] [warmup=4] [average=6]
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
const [cells = 16, reynolds = 100, alphaDeg = 25, warmup = 4, average = 6] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto('http://localhost:5174/gpu-test.html');
await page.waitForFunction(() => window.__gpuTest, null, { timeout: 60000 });
const out = await page.evaluate((a) => window.__gpuTest.compare(a), { cells, reynolds, alphaDeg, warmup, average });
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!out) process.exit(2);
const ok = Math.abs(out.dragDiff) < 0.05 && Math.abs(out.liftDiff) < 0.1 && out.gpu.status !== 'FAILED';
console.log(ok ? 'AGREE' : 'DIFFER');
process.exit(ok ? 0 : 1);
