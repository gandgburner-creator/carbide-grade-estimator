import { describe, expect, it } from 'vitest';
import { CFD_BASE, CFD_PRESETS, CfdRun, GPU_PRESETS, presetWork, reynoldsCap, type CfdParams } from '../src/cfd/CfdRun';
import { LbmSolver, fillInitialPopulations } from '../src/cfd/Lbm';
import { gpuBytes, isIntegrated, WGSL } from '../src/cfd/gpu/LbmGpu';
import { flatPlate } from '../src/geometry/SurfaceGeometry';
import { cfdScale } from '../src/ui/flow/cfdPalette';
import { Tracers } from '../src/ui/flow/Tracers';

/**
 * What can be checked without a graphics card: the plumbing that a run on the card relies on (the shared starting state, the way a
 * time block measured elsewhere is closed, the sizes), and the pictures' helpers. The solver on the card itself is compared with the CPU
 * solver in the browser (scripts/gpu-selftest.mjs, scripts/gpu-compare.mjs, scripts/smoke-gpu.mjs).
 */
const params = (): CfdParams => ({ geometry: flatPlate(30, 5), alphaDeg: 25, cells: 16, reynolds: 90, ...CFD_BASE, warmup: 3, average: 4 });

describe('the pieces a run on the graphics card shares with the CPU', () => {
  it('the starting populations are the ones the CPU solver starts from', () => {
    const cfg = { nx: 30, ny: 20, tau: 0.6, uIn: 0.05, noise: 0.01, seed: 5 };
    const solid = new Uint8Array(30 * 20);
    solid[3 * 30 + 4] = 1;
    const cpu = new LbmSolver({ ...cfg, solid });
    const f = new Float32Array(9 * 600);
    fillInitialPopulations({ ...cfg, solid }, solid, f);
    for (const n of [0, 17, 250, 599]) {
      const m = cpu.macro(n);
      let r = 0;
      let mx = 0;
      for (let k = 0; k < 9; k++) {
        r += f[k * 600 + n];
        mx += [0, 1, 0, -1, 0, 1, -1, -1, 1][k] * f[k * 600 + n];
      }
      expect(r).toBeCloseTo(m.rho, 6);
      expect(mx / r).toBeCloseTo(m.ux, 6);
    }
  });

  it('a block that was measured elsewhere is closed exactly like a CPU block: the same run result', () => {
    const p = params();
    const cpu = new CfdRun(p);
    while (cpu.phase !== 'done') cpu.advance(1000);
    const a = cpu.result();

    // drive a second run "from outside": the same solver, stepped by hand, the sums handed over block by block
    const ext = new CfdRun(p, { external: true });
    expect(() => ext.solver.step()).toThrow(/graphics card/);
    const solver = new LbmSolver(ext.lbmConfig());
    const N = ext.nx * ext.ny;
    const rho = new Float64Array(N);
    const ux = new Float64Array(N);
    const uy = new Float64Array(N);
    let t = 0;
    for (let k = 0; k < p.blocks; k++) {
      const sums = { rho: new Float64Array(N), ux: new Float64Array(N), uy: new Float64Array(N) };
      const fxs: number[] = [];
      const fys: number[] = [];
      const serFx: number[] = [];
      const serFy: number[] = [];
      let sinceFx = 0;
      let sinceFy = 0;
      let sinceN = 0;
      const probe: number[] = [];
      let samples = 0;
      let fluxIn = 0;
      let fluxOut = 0;
      let maxSpeed = 0;
      let rhoMin = Infinity;
      let rhoMax = -Infinity;
      const steps = k === 0 ? ext.warmSteps + ext.blockSteps : ext.blockSteps;
      for (let s = 0; s < steps; s++) {
        solver.step();
        t++;
        if (t <= ext.warmSteps) continue;
        fxs.push(solver.fx);
        fys.push(solver.fy);
        sinceFx += solver.fx;
        sinceFy += solver.fy;
        sinceN++;
        if ((t - ext.warmSteps) % p.sampleEvery === 0) {
          serFx.push(sinceFx / sinceN);
          serFy.push(sinceFy / sinceN);
          sinceFx = sinceFy = sinceN = 0;
          solver.fields(rho, ux, uy);
          for (let n = 0; n < N; n++) {
            sums.rho[n] += rho[n];
            sums.ux[n] += ux[n];
            sums.uy[n] += uy[n];
          }
          samples++;
          probe.push(rho[ext.probeNode]);
          for (let j = 0; j < ext.ny; j++) {
            fluxIn += rho[j * ext.nx + 4] * ux[j * ext.nx + 4];
            fluxOut += rho[j * ext.nx + ext.nx - 6] * ux[j * ext.nx + ext.nx - 6];
          }
          for (let n = 0; n < N; n += 3) {
            if (solver.solid[n]) continue;
            maxSpeed = Math.max(maxSpeed, Math.hypot(ux[n], uy[n]));
            rhoMin = Math.min(rhoMin, rho[n]);
            rhoMax = Math.max(rhoMax, rho[n]);
          }
        }
      }
      const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
      ext.solver.steps = t;
      ext.ingestBlock({ series: { fx: serFx, fy: serFy }, rho: sums.rho, ux: sums.ux, uy: sums.uy, samples, fx: mean(fxs), fy: mean(fys), probe: probe.reduce((x, y) => x + y, 0), fluxIn, fluxOut, maxSpeed, rhoMin, rhoMax });
    }
    ext.phase = 'done';
    const b = ext.result();
    expect(b.steps).toBe(a.steps);
    expect(b.forces.dragCoeff.mean).toBeCloseTo(a.forces.dragCoeff.mean, 12);
    expect(b.forces.liftCoeff.mean).toBeCloseTo(a.forces.liftCoeff.mean, 12);
    expect(b.rhoInf).toBeCloseTo(a.rhoInf, 12);
    expect(b.grid.ux).toEqual(a.grid.ux);
    expect(b.integrity.checks.map((c) => c.value)).toEqual(a.integrity.checks.map((c) => c.value));
    expect(b.separation.upper.note).toBe(a.separation.upper.note);
    expect(b.stations.upper[3].cf.mean).toBeCloseTo(a.stations.upper[3].cf.mean, 12);
    expect(b.shedding).toEqual(a.shedding);
    expect(a.shedding!.cycles + 1).toBeGreaterThanOrEqual(0);
    expect(a.engine?.kind).toBe('cpu');
  }, 120000);

  it('the finest presets are meant for the card and fit in its memory', () => {
    expect(GPU_PRESETS).toEqual(['finer', 'ultra', 'max']);
    for (const k of GPU_PRESETS) expect(CFD_PRESETS[k].cells).toBeGreaterThanOrEqual(128);
    // the 256-cell lattice: 9 plate lengths × 6 plate lengths
    const nx = 9 * 256;
    const ny = 6 * 256;
    expect(gpuBytes(nx, ny) / 1048576).toBeLessThan(600);
    // a population buffer of that lattice fits the 256 MiB that WebGPU guarantees to every device
    expect((36 * nx * ny) / 1048576).toBeLessThan(256);
    expect(reynoldsCap(256)).toBeCloseTo(2048, 6);
    expect(reynoldsCap(24)).toBeCloseTo(192, 6);
  });

  it('the work of a preset: nodes and steps, for the time estimates', () => {
    expect(presetWork('fine')).toEqual({ nodes: 864 * 576, steps: 64000 });
    expect(presetWork('max').nodes).toBe(2304 * 1536);
    expect(presetWork('max').steps).toBeCloseTo(170667, -1);
    // quick: 24 000 steps on 124 000 nodes, as measured on the CPU
    expect(presetWork('quick')).toEqual({ nodes: 432 * 288, steps: 30 * 800 });
  });

  it('integrated graphics are told from separate cards by what the adapter reports', () => {
    expect(isIntegrated({ vendor: 'intel', architecture: 'gen-12lp', device: '', description: '' })).toBe(true);
    expect(isIntegrated({ vendor: 'intel', architecture: 'xe-lpg', description: 'Intel(R) Graphics' })).toBe(true);
    expect(isIntegrated({ vendor: 'intel', architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770' })).toBe(false);
    expect(isIntegrated({ vendor: 'nvidia', architecture: 'ada-lovelace', description: 'NVIDIA GeForce RTX 4060' })).toBe(false);
    expect(isIntegrated({ vendor: 'google', architecture: 'swiftshader' })).toBe(false);
  });

  it('the shader source has every entry point and binding the host code relies on', () => {
    for (const entry of ['collide', 'stream', 'outflow', 'accumulate', 'snapshot']) expect(WGSL).toMatch(new RegExp(`fn ${entry}\\(`));
    for (let b = 0; b <= 11; b++) expect(WGSL).toContain(`@binding(${b})`);
    // the force and the fluxes are summed as integers
    expect(WGSL).toMatch(/atomic<i32>/);
    expect(WGSL).not.toMatch(/atomic<f32>/);
  });
});

describe('the pictures', () => {
  it('the colour scales have 256 entries; a signed scale is dark at zero, a sequential one runs from black to pale', () => {
    const seq = cfdScale(0, 2, false);
    const sig = cfdScale(-1, 1, true);
    expect(seq.lut.length).toBe(1024);
    expect(Array.from(seq.lut.slice(0, 3))).toEqual([0, 0, 4]);
    expect(seq.lut[1020]).toBeGreaterThan(240);
    const mid = Array.from(sig.lut.slice(4 * 127, 4 * 127 + 3));
    expect(Math.max(...mid)).toBeLessThan(60);
    expect(sig.color(-1)[2]).toBeGreaterThan(200); // negative: cool
    expect(sig.color(1)[0]).toBeGreaterThan(200); // positive: warm
    expect(sig.css).toMatch(/^linear-gradient/);
    expect(seq.color(5)).toEqual(seq.color(2)); // clipped
  });

  it('tracers are carried by the velocity, die in the body and are reborn', () => {
    const nx = 20;
    const ny = 10;
    const valid = new Array(nx * ny).fill(true);
    for (let j = 3; j < 7; j++) for (let i = 8; i < 12; i++) valid[j * nx + i] = false;
    const field = { nx, ny, x0: 0, y0: 0, cw: 10, ch: 10, ux: new Array(nx * ny).fill(1), uy: new Array(nx * ny).fill(0), valid };
    const t = new Tracers(400);
    t.setField(field, { w: 200, h: 100 });
    const before = (t as unknown as { x: Float32Array }).x.slice();
    t.tick();
    const x = (t as unknown as { x: Float32Array }).x;
    let moved = 0;
    for (let i = 0; i < 400; i++) if (Math.abs(x[i] - before[i] - 1.2) < 1e-4) moved++;
    expect(moved).toBeGreaterThan(300); // carried by u = 1 at 1.2 plate units per frame (the rest were reborn)
    // none ever sits in the body after many frames
    for (let k = 0; k < 120; k++) t.tick();
    const y = (t as unknown as { y: Float32Array }).y;
    for (let i = 0; i < 400; i++) {
      const inBody = x[i] >= 80 && x[i] < 120 && y[i] >= 30 && y[i] < 70;
      expect(inBody && Math.abs(x[i] - 100) < 15 && Math.abs(y[i] - 50) < 15).toBe(false);
    }
  });
});
