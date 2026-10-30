import { LbmSolver } from '../Lbm';
import { circlePolygon, rasterize } from '../Raster';
import { GpuLbm, openGpu, type GpuInfo } from './LbmGpu';

/**
 * THE GPU SELF-TEST: the classical cases that the CPU solver is validated on (tests/cfd.lbm.test.ts), run on this computer's graphics
 * card, with the same thresholds, so that a person can see that the GPU solver gives the right answers on THEIR card, and how fast it is.
 *
 *   channel     Poiseuille flow between two walls, against the exact parabola of the Navier–Stokes equations (and against the CPU solver)
 *   cylinder    a circular cylinder in a channel at Re = 20 (steady wake, drag coefficient near the published 2.05) and at Re = 100
 *               (vortex shedding: Strouhal number near the published 0.165, mean drag near 1.34, lift amplitude near 0.33)
 *   speed       the node updates per second on a lattice of the size of a CFD run
 *
 * A pass means the GPU solver reproduces what the CPU solver does on the same case; it says nothing about airfoils.
 */
export interface SelfTestLine {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  info: GpuInfo | null;
  lines: SelfTestLine[];
  /** million lattice-node updates per second on the speed test (the number to compare cards by) */
  mlups?: number;
  /** wall-clock seconds */
  seconds: number;
}

async function channelGpu(device: GPUDevice, H: number, tau: number, g: number, steps: number) {
  const nx = 8;
  const ny = H + 2;
  const solid = new Uint8Array(nx * ny);
  const wallQ = new Float32Array(9 * nx * ny);
  for (let i = 0; i < nx; i++) {
    solid[i] = 1;
    solid[(ny - 1) * nx + i] = 1;
  }
  for (let j = 1; j < ny - 1; j++)
    for (let i = 0; i < nx; i++)
      for (let k = 1; k < 9; k++) {
        const sj = j + [0, 0, 1, 0, -1, 1, 1, -1, -1][k];
        if (sj === 0 || sj === ny - 1) wallQ[k * nx * ny + j * nx + i] = 0.5;
      }
  const cfg = { nx, ny, tau, uIn: 0, solid, wallQ, xMode: 'periodic', yMode: 'periodic', bodyForce: [g, 0] as [number, number], rest: true } as const;
  const gpu = await GpuLbm.create(device, { ...cfg });
  await gpu.advance(steps);
  const f = await gpu.fields();
  gpu.destroy();
  const cpu = new LbmSolver({ ...cfg });
  for (let t = 0; t < steps; t++) cpu.step();
  const nu = (tau - 0.5) / 3;
  let worstExact = 0;
  let worstCpu = 0;
  const scale = ((g / (2 * nu)) * H * H) / 4;
  for (let j = 1; j <= H; j++) {
    const y = j - 0.5;
    const exact = (g / (2 * nu)) * y * (H - y);
    const u = f.ux[j * nx + 3];
    worstExact = Math.max(worstExact, Math.abs(u - exact) / scale);
    worstCpu = Math.max(worstCpu, Math.abs(u - cpu.macro(j * nx + 3).ux) / scale);
  }
  return { worstExact, worstCpu };
}

interface CylinderResult {
  dragCoeff: number;
  clAmp: number;
  St: number;
  peaks: number[];
  steps: number;
  seconds: number;
  finite: boolean;
}

/** a circular cylinder of diameter D in a 30 D × 14 D box, as in the CPU validation: the same set-up on the card */
async function cylinderGpu(device: GPUDevice, Re: number, D: number, spin: number, avg: number, chunk: number, sponge?: { cells: number; tau: number }): Promise<CylinderResult> {
  const U = 0.1;
  const tau = (3 * U * D) / Re + 0.5;
  const nx = Math.round(30 * D);
  const ny = Math.round(14 * D);
  const r = rasterize(nx, ny, circlePolygon(8 * D, ny / 2 + 0.2, D / 2, 128));
  const gpu = await GpuLbm.create(device, { nx, ny, tau, uIn: U, solid: r.solid, wallQ: r.wallQ, noise: 0.01, seed: 3, sponge, probe: (ny >> 1) * nx + 3 * D });
  const t0 = performance.now();
  const dragC: number[] = [];
  const liftC: number[] = [];
  const rho: number[] = [];
  let finite = true;
  for (let t = 0; t < spin + avg; t += chunk) {
    await gpu.advance(chunk, chunk);
    const s = await gpu.readSummary(true);
    if (!Number.isFinite(s.fx) || !Number.isFinite(s.fy)) {
      finite = false;
      break;
    }
    if (t >= spin) {
      rho.push(s.probe / Math.max(1, s.samples));
      dragC.push(s.fx / (0.5 * U * U * D));
      liftC.push(s.fy / (0.5 * U * U * D));
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  gpu.destroy();
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rhoInf = rho.length ? mean(rho) : 1;
  const dragN = dragC.map((v) => v / rhoInf);
  const liftN = liftC.map((v) => v / rhoInf);
  const m = liftN.length ? mean(liftN) : 0;
  const up: number[] = [];
  for (let i = 1; i < liftN.length; i++) if (liftN[i - 1] < m && liftN[i] >= m) up.push(i);
  const period = up.length > 1 ? ((up[up.length - 1] - up[0]) / (up.length - 1)) * chunk : Number.NaN;
  const clAmp = liftN.length ? Math.SQRT2 * Math.sqrt(mean(liftN.map((v) => (v - m) ** 2))) : 0;
  const peaks: number[] = [];
  for (let i = 1; i < liftN.length - 1; i++) if (liftN[i] > liftN[i - 1] && liftN[i] >= liftN[i + 1] && liftN[i] > m + 0.1) peaks.push(liftN[i] - m);
  return { dragCoeff: dragN.length ? mean(dragN) : Number.NaN, clAmp, St: D / (period * U), peaks, steps: spin + avg, seconds, finite };
}

async function speedGpu(device: GPUDevice, nx: number, ny: number, steps: number): Promise<{ mlups: number; bytesMiB: number }> {
  const U = 0.06;
  const r = rasterize(nx, ny, circlePolygon(nx * 0.3, ny / 2, ny / 12, 96));
  const gpu = await GpuLbm.create(device, { nx, ny, tau: 0.56, uIn: U, solid: r.solid, wallQ: r.wallQ, noise: 0.01, seed: 1, sponge: { cells: Math.round(nx / 5), tau: 1.2 } });
  await gpu.advance(10);
  const t0 = performance.now();
  await gpu.advance(steps);
  const dt = (performance.now() - t0) / 1000;
  gpu.destroy();
  return { mlups: (nx * ny * steps) / dt / 1e6, bytesMiB: (36 * nx * ny * 3) / 1048576 };
}

export interface SelfTestOptions {
  /** compare with the CPU solver on the channel (cheap) */
  compareCpu?: boolean;
  /** run the two cylinder cases (a minute on a graphics card, several on software) */
  cylinders?: boolean;
  /** lattice size of the speed test */
  speedSize?: [number, number];
  speedSteps?: number;
  onLine?: (l: SelfTestLine) => void;
}

export async function runGpuSelfTest(o: SelfTestOptions = {}): Promise<SelfTestResult> {
  const t0 = performance.now();
  const lines: SelfTestLine[] = [];
  const push = (l: SelfTestLine) => {
    lines.push(l);
    o.onLine?.(l);
  };
  const gpu = await openGpu();
  if (!gpu) {
    push({ id: 'webgpu', label: 'WebGPU is available', ok: false, detail: 'this browser has no WebGPU adapter (use a recent Chrome or Edge, with hardware acceleration on); the CFD runs on the CPU' });
    return { info: null, lines, seconds: (performance.now() - t0) / 1000 };
  }
  const { device, info } = gpu;
  push({ id: 'webgpu', label: 'WebGPU adapter', ok: true, detail: `${info.description || info.device || info.vendor || 'unnamed adapter'}${info.software ? ' (SOFTWARE implementation: correct but slow)' : ''}; largest buffer ${(Math.min(info.maxStorageBufferBindingSize, info.maxBufferSize) / 1048576).toFixed(0)} MiB` });
  try {
    const ch = await channelGpu(device, 24, 0.8, 1e-6, 12000);
    push({ id: 'channel', label: 'Channel flow follows the exact parabola', ok: ch.worstExact < 0.02, detail: `largest deviation ${(100 * ch.worstExact).toFixed(2)} % of the centre velocity (limit 2 %); ${o.compareCpu === false ? '' : `the CPU solver differs from the GPU by ${(100 * ch.worstCpu).toFixed(3)} % (limit 1 %)`}` });
    if (o.compareCpu !== false) push({ id: 'channel-cpu', label: 'GPU and CPU solvers agree on the channel', ok: ch.worstCpu < 0.01, detail: `${(100 * ch.worstCpu).toFixed(3)} % of the centre velocity` });
    if (o.cylinders) {
      const a = await cylinderGpu(device, 20, 10, 6000, 3000, 50);
      push({ id: 'cyl20', label: 'Cylinder at Re = 20: steady wake, drag near 2.05', ok: a.finite && a.clAmp < 1e-3 && a.dragCoeff > 1.95 && a.dragCoeff < 2.45, detail: `C_d = ${a.dragCoeff.toFixed(3)} (accepted 1.95 … 2.45), lift oscillation ${a.clAmp.toExponential(1)} (limit 1e-3), ${a.seconds.toFixed(1)} s` });
      const b = await cylinderGpu(device, 100, 10, 8000, 6000, 10, { cells: 80, tau: 1.0 });
      push({ id: 'cyl100', label: 'Cylinder at Re = 100: vortex shedding near St = 0.165, drag near 1.34', ok: b.finite && b.St > 0.15 && b.St < 0.2 && b.dragCoeff > 1.3 && b.dragCoeff < 1.65 && b.clAmp > 0.3 && b.clAmp < 0.55, detail: `St = ${b.St.toFixed(3)} (accepted 0.15 … 0.20), C_d = ${b.dragCoeff.toFixed(3)} (1.30 … 1.65), lift amplitude ${b.clAmp.toFixed(3)} (0.30 … 0.55), ${b.seconds.toFixed(1)} s` });
    }
    const [sx, sy] = o.speedSize ?? [576, 384];
    const sp = await speedGpu(device, sx, sy, o.speedSteps ?? 200);
    push({ id: 'speed', label: 'Speed', ok: true, detail: `${sp.mlups.toFixed(0)} million node updates per second on a ${sx} × ${sy} lattice (${(sp.mlups * 1e6 / (sx * sy)).toFixed(0)} steps per second; ${sp.bytesMiB.toFixed(0)} MiB of device memory)` });
    return { info, lines, mlups: sp.mlups, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    push({ id: 'error', label: 'The self-test stopped', ok: false, detail: (e as Error).message });
    return { info, lines, seconds: (performance.now() - t0) / 1000 };
  } finally {
    device.destroy();
  }
}
