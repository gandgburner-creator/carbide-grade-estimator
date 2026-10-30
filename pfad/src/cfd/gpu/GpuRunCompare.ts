import { CFD_BASE, CfdRun, type CfdParams, type CfdResult } from '../CfdRun';
import { flatPlate } from '../../geometry/SurfaceGeometry';
import { GpuCfdRun } from './GpuCfdRun';
import { openGpu } from './LbmGpu';

/**
 * A whole CFD run, on the CPU and on the graphics card, from the same parameters: the forces, the integrity checks and the time-mean
 * fields side by side. Used by scripts/gpu-selftest.mjs and by the in-app test to show that the two engines agree to within the
 * rounding of 32-bit arithmetic and the chaos of the flow (a steady flow agrees closely; a shedding one in its mean).
 */
export interface RunComparison {
  cpu: CfdResult;
  gpu: CfdResult;
  cpuSeconds: number;
  gpuSeconds: number;
  /** relative differences of the drag and lift coefficients (GPU − CPU) / |CPU|, and the largest difference of the mean speed field in units of U */
  dragDiff: number;
  liftDiff: number;
  speedDiff: number;
  adapter: string;
}

export function comparisonParams(cells: number, reynolds: number, alphaDeg: number, warmup: number, average: number): CfdParams {
  return { geometry: flatPlate(30, 5), alphaDeg, cells, reynolds, ...CFD_BASE, warmup, average };
}

export async function compareRuns(p: CfdParams): Promise<RunComparison | null> {
  const gpu = await openGpu();
  if (!gpu) return null;
  const t0 = performance.now();
  const g = await GpuCfdRun.create(p, gpu.device, gpu.info);
  while (g.phase !== 'done') await g.advance(200);
  const gres = g.result();
  const gpuSeconds = (performance.now() - t0) / 1000;
  await g.destroy();
  gpu.device.destroy();
  const t1 = performance.now();
  const c = new CfdRun(p);
  while (c.phase !== 'done') c.advance(200);
  const cres = c.result();
  const cpuSeconds = (performance.now() - t1) / 1000;
  const rel = (a: number, b: number) => (a - b) / Math.max(1e-9, Math.abs(b));
  let speedDiff = 0;
  const n = Math.min(gres.grid.ux.length, cres.grid.ux.length);
  for (let i = 0; i < n; i++) {
    if (gres.grid.solid[i] || cres.grid.solid[i]) continue;
    speedDiff = Math.max(speedDiff, Math.abs(Math.hypot(gres.grid.ux[i], gres.grid.uy[i]) - Math.hypot(cres.grid.ux[i], cres.grid.uy[i])));
  }
  return { cpu: cres, gpu: gres, cpuSeconds, gpuSeconds, dragDiff: rel(gres.forces.dragCoeff.mean, cres.forces.dragCoeff.mean), liftDiff: rel(gres.forces.liftCoeff.mean, cres.forces.liftCoeff.mean), speedDiff, adapter: gres.engine?.adapter ?? '' };
}
