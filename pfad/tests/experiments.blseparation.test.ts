import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import type { GridSumsData } from '../src/measurements/GridSums';
import { absoluteAgreement, agreement, analyse, variantX } from '../src/experiments/BLSeparationReport';
import { BLS_VALIDATION, type BLSParams } from '../src/experiments/BoundaryLayerSeparationExperiment';
import { dividingHeight, runsOf, separatedRegions, streamFunction, summarizeCase, type ObservableOptions } from '../src/experiments/WallFlowAnalysis';
import { wallFlowGeometry, type WallFlowConfig, type WallFlowRunResult } from '../src/experiments/WallFlowRun';

/**
 * Synthetic raw runs: a prescribed mean velocity field u(x, y) sampled by a
 * fixed number of particles per cell, plus Gaussian per-seed noise. These test
 * the analysis (detection, null handling, recirculation, classification) with
 * a known answer; they are not physics.
 */
const base: WallFlowConfig = { ...BLS_VALIDATION.base };
const C = BLS_VALIDATION.criteria;
const opt: ObservableOptions = C.observable;

function grid(x0: number, y1: number, cw: number, ch: number, L: number, snapshots: number, u: (x: number, y: number) => number, n: number, noise: () => number, ceiling: (x: number) => number): GridSumsData {
  const nx = Math.round(L / cw);
  const ny = Math.round(y1 / ch);
  const count: number[] = [];
  const px: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cw;
      const y = (j + 0.5) * ch;
      const inside = y < ceiling(x);
      const c = inside ? n * cw * ch * snapshots : 0;
      count.push(c);
      px.push(inside ? c * (u(x, y) + noise()) : 0);
    }
  }
  return { x0, y0: 0, cellW: cw, cellH: ch, nx, ny, snapshots, count, px, py: count.map(() => 0) };
}

function syntheticRun(label: string, seed: number, cfg: WallFlowConfig, u: (x: number, y: number) => number, tau: (x: number) => number, sigma: number): WallFlowRunResult {
  const rng = new Rng(seed, 99);
  const g = wallFlowGeometry(cfg);
  const L = cfg.length;
  const T = cfg.measurementTime;
  const n = 0.25;
  const nz = () => sigma * rng.gaussian();
  const seedShift = sigma * rng.gaussian(); // seed-to-seed variation of the whole field
  const uu = (x: number, y: number) => u(x, y) + seedShift * 0.3;
  const nearWall = grid(0, cfg.nearWallHeight, cfg.cellX, cfg.nearWallCellY, L, T, uu, n, () => 0, g.ceiling);
  const outer = grid(0, Math.ceil(g.heightOut / cfg.outerCellY) * cfg.outerCellY, cfg.cellX, cfg.outerCellY, L, T, uu, n, () => 0, g.ceiling);
  const blocks = Array.from({ length: cfg.blocks }, () => grid(0, cfg.blockHeight, cfg.cellX, cfg.blockCellY, L, T / cfg.blocks, uu, n, nz, g.ceiling));
  // per-seed noise on the time-integrated near-wall field, consistent with the blocks
  for (let c = 0; c < nearWall.px.length; c++) nearWall.px[c] += nearWall.count[c] * (sigma / Math.sqrt(cfg.blocks)) * rng.gaussian();
  const bins = L / cfg.wallBin;
  const tan = Array.from({ length: bins }, (_, b) => {
    const x = (b + 0.5) * cfg.wallBin;
    // a specular plate (tau ≡ 0) transfers exactly no tangential momentum
    return x > cfg.plate[0] && x < cfg.plate[1] && tau(x) !== 0 ? (tau(x) + 0.002 * rng.gaussian()) * T * cfg.wallBin : 0;
  });
  const nor = Array.from({ length: bins }, (_, b) => (0.4 + ((b * cfg.wallBin) / L) * 0.05 + 0.002 * rng.gaussian()) * T * cfg.wallBin);
  const zero = Array.from({ length: bins }, () => 0);
  return {
    label,
    seed,
    config: { ...cfg, label },
    particles: 1000,
    fluidArea: g.fluidArea,
    numberDensity: n,
    heightOut: g.heightOut,
    measurementStart: cfg.startupTime,
    measurementTime: T,
    steps: 1,
    wallSeconds: 0,
    nearWall,
    outer,
    fine: nearWall,
    blocks,
    floor: { bin: cfg.wallBin, total: { hits: zero.map(() => 100), normalImpulse: nor, tangentialImpulse: tan, energyIn: zero, incidentTangential: zero, emittedTangential: zero, diffuseHits: zero }, blocks: [] },
    ceiling: [],
    fringe: { energyIn: 0, momentumX: 0, momentumY: 0, resamplings: 0, moves: 0, energyInTotal: 0, momentumXTotal: 0, drift: 1, exitDrift: 1 },
    massFlux: { measured: 17.8, target: 17.8 },
    series: { t: [0], kinetic: [1], kT: [1], plateImpulseX: [0], fringeMomentumX: [0], fringeEnergy: [0], ceilingImpulseX: [0], energyResidual: [0], tControl: [], uf: [], ub: [], massFlux: [] },
    ledger: {} as WallFlowRunResult['ledger'],
    conservation: { maxAbsRelativeEnergyResidual: 1e-14, maxRelativeMomentumResidual: 1e-15 } as WallFlowRunResult['conservation'],
    collisions: {} as WallFlowRunResult['collisions'],
    emptySpace: { flag: null } as WallFlowRunResult['emptySpace'],
    safetyFlags: [],
    halted: false,
    frames: [],
  };
}

// attached boundary-layer-like profile on the plate, uniform elsewhere
const blProfile = (aw: number) => (x: number, y: number) => (x > base.plate[0] && x < base.plate[1] && aw > 0 ? 1 - 0.85 * aw * Math.exp(-y / 8) : 1);
// reversed layer under forward flow over x ∈ (300, 400)
const separated = (x: number, y: number) => {
  const attached = blProfile(1)(x, y);
  if (x > 300 && x < 400) return y < 6 ? -0.06 : attached * Math.min(1, (y - 6) / 20);
  return attached;
};
const tauAttached = () => 0.02;
const tauSeparated = (x: number) => (x > 300 && x < 400 ? -0.006 : 0.02);

function dataset(sigma: number, strong: (x: number, y: number) => number, strongTau: (x: number) => number) {
  const runs: WallFlowRunResult[] = [];
  const add = (key: string, overrides: Partial<WallFlowConfig>, seeds: number[], u: (x: number, y: number) => number, tau: (x: number) => number) => {
    for (const s of seeds) runs.push(syntheticRun(key, s, { ...base, ...overrides }, u, tau, sigma));
  };
  const s8 = [1, 2, 3, 4, 5, 6, 7, 8];
  add('A1-r1', { expansion: 1 }, s8, blProfile(1), tauAttached);
  add('A1-r1.5', { expansion: 1.5 }, s8, blProfile(1), tauAttached);
  add('A1-r2', { expansion: 2 }, s8, blProfile(1), tauAttached);
  add('A1-r2.5', { expansion: 2.5 }, s8, strong, strongTau);
  add('A05-r1', { expansion: 1, accommodation: 0.5 }, [11, 12, 13, 14, 15, 16], blProfile(0.5), tauAttached);
  add('A0-r1', { expansion: 1, accommodation: 0 }, [21, 22, 23, 24], blProfile(0), () => 0);
  add('A0-r2.5', { expansion: 2.5, accommodation: 0 }, [21, 22, 23, 24], blProfile(0), () => 0);
  return runs;
}

const params: BLSParams = { ...BLS_VALIDATION, cases: BLS_VALIDATION.cases.filter((c) => c.role !== 'variant') };

describe('reverse-flow detection on synthetic fields', () => {
  it('finds the planted separated region, and nothing in the attached control (null)', () => {
    const runs = dataset(0.02, separated, tauSeparated);
    const s = summarizeCase('A1-r2.5', runs.filter((r) => r.label === 'A1-r2.5'), opt);
    const regs = separatedRegions(s, C.searchWindow[0], C.searchWindow[1], C.alphaColumn, C.minColumns);
    expect(regs).toHaveLength(1);
    expect(regs[0].from).toBeGreaterThanOrEqual(300);
    expect(regs[0].to).toBeLessThanOrEqual(400);
    expect(regs[0].uWall.mean).toBeLessThan(0);
    expect(regs[0].tauW.mean).toBeLessThan(0);
    const a = summarizeCase('A1-r1', runs.filter((r) => r.label === 'A1-r1'), opt);
    expect(separatedRegions(a, C.searchWindow[0], C.searchWindow[1], C.alphaColumn, C.minColumns)).toHaveLength(0);
  });

  it('pure noise around zero mean is not reported as separation', () => {
    let found = 0;
    for (let trial = 0; trial < 20; trial++) {
      const runs = Array.from({ length: 8 }, (_, k) => syntheticRun('Z', 1000 * trial + k, { ...base, expansion: 2.5 }, () => 0, () => 0, 0.03));
      const s = summarizeCase('Z', runs, opt);
      found += separatedRegions(s, C.searchWindow[0], C.searchWindow[1], C.alphaColumn, C.minColumns).length;
    }
    // expected false 2-column runs ≈ 18 × 0.005² per trial
    expect(found).toBeLessThanOrEqual(1);
  });

  it('stream function: dividing height above a reversed wall layer', () => {
    const runs = dataset(0.0, separated, tauSeparated).filter((r) => r.label === 'A1-r2.5');
    const s = summarizeCase('A1-r2.5', runs, opt);
    const psi = streamFunction(s.nearWall);
    const i = s.x.findIndex((x) => x === 350);
    const h = dividingHeight(psi.psi[i], psi.yTop);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBeGreaterThan(6);
    expect(h).toBeLessThan(30);
    const j = s.x.findIndex((x) => x === 210);
    expect(Number.isNaN(dividingHeight(psi.psi[j], psi.yTop))).toBe(true);
  });

  it('runsOf finds maximal runs', () => {
    expect(runsOf([false, true, true, false, true])).toEqual([
      { from: 1, to: 2 },
      { from: 4, to: 4 },
    ]);
  });
});

describe('classification on synthetic data', () => {
  it('separated strong case, attached null, specular controls: Part II checks pass where the data say so', () => {
    const A = analyse(params, dataset(0.02, separated, tauSeparated), C);
    const v = (id: string) => A.checks.find((c) => c.id === id)?.verdict;
    expect(v('II2-local-reversal')).toBe('PASS');
    expect(v('II4-null')).toBe('PASS');
    expect(v('II5-wall-signature')).toBe('PASS');
    expect(v('II6-recirculation')).toBe('PASS');
    expect(v('II11-specular-falsification')).toBe('PASS');
    expect(v('I1-structure-A1-r1')).toBe('PASS');
    expect(v('I2-specular-control')).toBe('PASS');
  });

  it('a demonstrably attached strong case FAILS the reversal check', () => {
    const A = analyse(params, dataset(0.01, blProfile(1), tauAttached), C);
    expect(A.checks.find((c) => c.id === 'II2-local-reversal')?.verdict).toBe('FAIL');
    expect(A.partII).toBe('FAIL');
  });

  it('a stalled strong case (u ≈ 0, no significant reversal) is INCONCLUSIVE, not PASS', () => {
    const stall = (x: number, y: number) => (x > 280 && x < 480 ? (y < 15 ? 0 : blProfile(1)(x, y)) : blProfile(1)(x, y));
    const A = analyse(params, dataset(0.03, stall, (x) => (x > 280 && x < 480 ? 0 : 0.02)), C);
    expect(A.checks.find((c) => c.id === 'II2-local-reversal')?.verdict).toBe('INCONCLUSIVE');
    expect(A.partII).toBe('INCONCLUSIVE');
  });
});

describe('agreement rule and variant mapping', () => {
  const st = (mean: number, se: number) => ({ mean, se, sd: se * 2, n: 4, t: mean / se });
  it('equivalence: PASS (CI inside the margin), FAIL (CI outside), INCONCLUSIVE (straddles)', () => {
    expect(agreement(st(10, 0.1), st(10.3, 0.1), 0.1).verdict).toBe('PASS');
    expect(agreement(st(10, 0.1), st(14, 0.1), 0.1).verdict).toBe('FAIL');
    expect(agreement(st(10, 1), st(10.5, 1), 0.1).verdict).toBe('INCONCLUSIVE');
    // a precise but small systematic difference passes an equivalence test (it fails a significance test)
    expect(agreement(st(10, 0.01), st(10.5, 0.01), 0.1).verdict).toBe('PASS');
    expect(absoluteAgreement(st(0.001, 0.002), st(-0.004, 0.002), 0.02).verdict).toBe('PASS');
    expect(absoluteAgreement(st(0.001, 0.002), st(0.1, 0.002), 0.02).verdict).toBe('FAIL');
  });
  it('height variant positions scale with the diffuser; other variants map identically', () => {
    const ref = { diffuser: [180, 400] as [number, number] };
    const v = { diffuser: [180, 510] as [number, number] };
    expect(variantX(ref, v, 'height', 150)).toBe(150);
    expect(variantX(ref, v, 'height', 400)).toBeCloseTo(510, 9);
    expect(variantX(ref, v, 'timestep', 400)).toBe(400);
  });
});
