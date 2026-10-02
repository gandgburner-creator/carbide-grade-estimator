import type { GridSumsData } from '../measurements/GridSums';
import { mean, tTwoSidedCritical } from '../measurements/Statistics';
import { wallFlowGeometry, type WallFlowConfig, type WallFlowRunResult } from './WallFlowRun';

/**
 * Particle-derived wall-flow observables (Item 3). Every quantity here is a
 * ratio or sum of measured particle or wall-impulse data; no velocity profile,
 * thickness law, pressure law or separation criterion from continuum theory is
 * used. Conventional names are given only where the definition is a plain
 * integral of measured data, and are marked as such.
 */

/**
 * Coarsen a grid of raw sums by integer factors (exact: sums of sums).
 * A trailing strip of fewer than fx columns at the downstream end (a domain
 * length that is not a multiple of the coarse column width) is dropped; the
 * rows must divide exactly. Grids that divide exactly are unaffected.
 */
export function coarsen(g: GridSumsData, fx: number, fy: number): GridSumsData {
  if (!(Number.isInteger(fx) && Number.isInteger(fy) && fx >= 1 && fy >= 1)) throw new Error('integer factors ≥ 1');
  if (g.ny % fy !== 0) throw new Error(`grid ${g.nx}×${g.ny} rows are not divisible by ${fy}`);
  const nx = Math.floor(g.nx / fx);
  if (nx < 1) throw new Error(`grid ${g.nx}×${g.ny} has fewer than ${fx} columns`);
  const ny = g.ny / fy;
  const sum = (a?: number[]) => {
    if (!a) return undefined;
    const out = new Array<number>(nx * ny).fill(0);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < nx * fx; i++) out[Math.floor(j / fy) * nx + Math.floor(i / fx)] += a[j * g.nx + i];
    return out;
  };
  return {
    ...g,
    cellW: g.cellW * fx,
    cellH: g.cellH * fy,
    nx,
    ny,
    count: sum(g.count)!,
    px: sum(g.px)!,
    py: sum(g.py)!,
    sxx: sum(g.sxx),
    syy: sum(g.syy),
    sxy: sum(g.sxy),
    cxx: sum(g.cxx),
    cyy: sum(g.cyy),
    cxy: sum(g.cxy),
  };
}

/** Restrict a grid to rows [0, rows). */
export function lowerRows(g: GridSumsData, rows: number): GridSumsData {
  const n = g.nx * rows;
  const cut = (a?: number[]) => (a ? a.slice(0, n) : undefined);
  return { ...g, ny: rows, count: cut(g.count)!, px: cut(g.px)!, py: cut(g.py)!, sxx: cut(g.sxx), syy: cut(g.syy), sxy: cut(g.sxy), cxx: cut(g.cxx), cyy: cut(g.cyy), cxy: cut(g.cxy) };
}

/** Sum the raw sums of several grids (e.g. seeds, or time blocks). */
export function sumGrids(gs: GridSumsData[]): GridSumsData {
  const g0 = gs[0];
  const add = (key: keyof GridSumsData) => {
    if (!Array.isArray(g0[key])) return undefined;
    const out = (g0[key] as number[]).slice();
    for (let k = 1; k < gs.length; k++) {
      const a = gs[k][key] as number[];
      for (let c = 0; c < out.length; c++) out[c] += a[c];
    }
    return out;
  };
  return {
    ...g0,
    snapshots: gs.reduce((s, g) => s + g.snapshots, 0),
    count: add('count')!,
    px: add('px')!,
    py: add('py')!,
    sxx: add('sxx'),
    syy: add('syy'),
    sxy: add('sxy'),
    cxx: add('cxx'),
    cyy: add('cyy'),
    cxy: add('cxy'),
    collisionTime: g0.collisionTime !== undefined ? gs.reduce((s, g) => s + (g.collisionTime ?? 0), 0) : undefined,
  };
}

/** Mass-weighted mean velocity of the particles in a set of cells (equal masses). */
function meanVelocity(g: GridSumsData, cells: number[], comp: 'px' | 'py' = 'px', mass = 1): number {
  let p = 0;
  let n = 0;
  for (const c of cells) {
    p += g[comp][c];
    n += g.count[c];
  }
  return n > 0 ? p / (mass * n) : Number.NaN;
}

/** Column x-centres of a grid. */
export const columnCentres = (g: GridSumsData) => Array.from({ length: g.nx }, (_, i) => g.x0 + (i + 0.5) * g.cellW);

/** Cells of column i whose whole height lies in [y0, y1). */
function cellsIn(g: GridSumsData, i: number, y0: number, y1: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < g.ny; j++) {
    const a = g.y0 + j * g.cellH;
    if (a >= y0 - 1e-9 && a + g.cellH <= y1 + 1e-9) out.push(j * g.nx + i);
  }
  return out;
}

export interface ColumnObservables {
  x: number[];
  /** ceiling height at the column centre */
  height: number[];
  /** core (outer) velocity: mass-weighted u over the band [coreFrom, coreTo]·H(x) of the outer grid */
  Ue: number[];
  /** number density in the core band */
  ne: number[];
  /** near-wall velocity: mass-weighted u over y < nearWallHeight */
  uWall: number[];
  /** mass flux per unit width below y = nearWallHeight: Σ ρ u Δy */
  psiWall: number[];
  /** wall shear: tangential impulse on the floor per unit time and length (+x = flow drags the wall downstream) */
  tauW: number[];
  /** wall pressure: normal impulse on the floor per unit time and length */
  pW: number[];
  /** floor collision rate per unit length */
  hitRate: number[];
  /** mass-flux deficit thickness ∫(1 − ρu/(ρ_e U_e))dy over y < edge·H (the integral conventionally called δ*) */
  delta1: number[];
  /** momentum-flux deficit thickness ∫ρu(U_e − u)/(ρ_e U_e²)dy over y < edge·H (conventionally θ) */
  delta2: number[];
  /** half-deficit height: lowest y at which U_e − u falls to half of U_e − u(first row) */
  yHalf: number[];
}

export interface ObservableOptions {
  /** core band as fractions of the local ceiling height */
  coreFrom: number;
  coreTo: number;
  /** deficit integrals run over y < edge·H(x) */
  edge: number;
  /** height of the near-wall band for uWall and psiWall */
  nearWallBand: number;
  /** wall-normal cell size of the near-wall analysis grid (a multiple of the stored Δy) */
  cellY: number;
  /** column width (a multiple of the stored Δx and wall bin) */
  cellX: number;
}

/**
 * Column observables of ONE run (or of summed runs: pass the summed grids and
 * the summed wall tallies with the total measurement time).
 */
export function columnObservables(
  config: WallFlowConfig,
  nearWallIn: GridSumsData,
  outerIn: GridSumsData,
  floor: { tangential: number[]; normal: number[]; hits: number[]; bin: number },
  time: number,
  opt: ObservableOptions,
): ColumnObservables {
  const geo = wallFlowGeometry(config);
  const fxN = Math.round(opt.cellX / nearWallIn.cellW);
  const nearWall = coarsen(nearWallIn, fxN, Math.round(opt.cellY / nearWallIn.cellH));
  const outer = coarsen(outerIn, Math.round(opt.cellX / outerIn.cellW), 1);
  const xs = columnCentres(nearWall);
  const nx = nearWall.nx;
  const perBin = Math.round(opt.cellX / floor.bin);
  const o: ColumnObservables = { x: xs, height: [], Ue: [], ne: [], uWall: [], psiWall: [], tauW: [], pW: [], hitRate: [], delta1: [], delta2: [], yHalf: [] };
  const m = config.mass;
  for (let i = 0; i < nx; i++) {
    const x = xs[i];
    const H = geo.ceiling(x);
    o.height.push(H);
    const core = cellsIn(outer, i, opt.coreFrom * H, opt.coreTo * H);
    const Ue = meanVelocity(outer, core, 'px', m);
    let cn = 0;
    for (const c of core) cn += outer.count[c];
    const ne = cn / (outer.snapshots * outer.cellW * outer.cellH * core.length);
    o.Ue.push(Ue);
    o.ne.push(ne);
    const band = cellsIn(nearWall, i, 0, opt.nearWallBand);
    o.uWall.push(meanVelocity(nearWall, band, 'px', m));
    let psi = 0;
    for (const c of band) psi += nearWall.px[c] / (nearWall.snapshots * nearWall.cellW);
    o.psiWall.push(psi);
    let tan = 0;
    let nor = 0;
    let hits = 0;
    for (let k = 0; k < perBin; k++) {
      tan += floor.tangential[i * perBin + k];
      nor += floor.normal[i * perBin + k];
      hits += floor.hits[i * perBin + k];
    }
    o.tauW.push(tan / (time * opt.cellX));
    o.pW.push(nor / (time * opt.cellX));
    o.hitRate.push(hits / (time * opt.cellX));
    // deficit integrals over the near-wall grid (and the outer grid above it, if the edge is higher)
    const yEdge = opt.edge * H;
    const rhoUe = m * ne * Ue;
    let d1 = 0;
    let d2 = 0;
    const addCell = (g: GridSumsData, c: number, dy: number) => {
      const rhoU = g.px[c] / (g.snapshots * g.cellW * g.cellH);
      const u = g.count[c] > 0 ? g.px[c] / (m * g.count[c]) : 0;
      d1 += (1 - rhoU / rhoUe) * dy;
      d2 += ((rhoU * (Ue - u)) / (rhoUe * Ue)) * dy;
    };
    const top = Math.min(yEdge, nearWall.y0 + nearWall.ny * nearWall.cellH);
    for (const c of cellsIn(nearWall, i, 0, top)) addCell(nearWall, c, nearWall.cellH);
    if (yEdge > top) for (const c of cellsIn(outer, i, top, yEdge)) addCell(outer, c, outer.cellH);
    o.delta1.push(d1);
    o.delta2.push(d2);
    // half-deficit height on the near-wall profile
    const prof = cellsIn(nearWall, i, 0, top).map((c) => (nearWall.count[c] > 0 ? nearWall.px[c] / (m * nearWall.count[c]) : Number.NaN));
    const u0 = prof[0];
    const half = 0.5 * (Ue - u0);
    let yh = Number.NaN;
    for (let j = 1; j < prof.length; j++) {
      const a = Ue - prof[j - 1];
      const b = Ue - prof[j];
      if (b <= half) {
        const f = a !== b ? (a - half) / (a - b) : 0;
        yh = (j - 0.5 + f) * nearWall.cellH;
        break;
      }
    }
    o.yHalf.push(yh);
  }
  return o;
}

/** Floor tallies of a run, as used by columnObservables. */
export function floorOf(r: WallFlowRunResult) {
  return { tangential: r.floor.total.tangentialImpulse, normal: r.floor.total.normalImpulse, hits: r.floor.total.hits, bin: r.floor.bin };
}

// ---------------------------------------------------------------- ensembles

export interface SeedStat {
  mean: number;
  se: number;
  sd: number;
  n: number;
  t: number;
}

export function seedStat(values: number[]): SeedStat {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  const m = mean(v);
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : Number.NaN;
  const se = sd / Math.sqrt(n);
  return { mean: m, se, sd, n, t: m / se };
}

/** One-sided critical t for P(T ≤ −t) = alpha. */
export function tOneSided(alpha: number, dof: number): number {
  return tTwoSidedCritical(2 * alpha, dof);
}

// ---------------------------------------------------------------- stream function and reversal

/**
 * Mass stream function ψ(x, y) = ∫₀^y ρ u dy' (mass flux per unit width below
 * height y), at the top of every row of the near-wall grid, per column.
 * ψ < 0 just above the floor means net upstream mass flux there; a region
 * with ψ < 0 bounded above by ψ = 0 is the measured signature of a
 * recirculating (return-flow) layer under forward flow.
 */
export function streamFunction(g: GridSumsData): { x: number[]; yTop: number[]; psi: number[][] } {
  const x = columnCentres(g);
  const yTop = Array.from({ length: g.ny }, (_, j) => g.y0 + (j + 1) * g.cellH);
  const psi: number[][] = [];
  for (let i = 0; i < g.nx; i++) {
    let s = 0;
    const col: number[] = [];
    for (let j = 0; j < g.ny; j++) {
      s += g.px[j * g.nx + i] / (g.snapshots * g.cellW);
      col.push(s);
    }
    psi.push(col);
  }
  return { x, yTop, psi };
}

/** Height of the dividing streamline (ψ returns to 0) above a reversed wall layer, or NaN if ψ is not negative at the wall row. */
export function dividingHeight(psiCol: number[], yTop: number[]): number {
  if (!(psiCol[0] < 0)) return Number.NaN;
  for (let j = 1; j < psiCol.length; j++) {
    if (psiCol[j] >= 0) {
      const a = psiCol[j - 1];
      const b = psiCol[j];
      return yTop[j - 1] + ((0 - a) / (b - a)) * (yTop[j] - yTop[j - 1]);
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Contiguous runs of `true` (index ranges, inclusive). */
export function runsOf(flags: boolean[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const f = i < flags.length && flags[i];
    if (f && start < 0) start = i;
    if (!f && start >= 0) {
      out.push({ from: start, to: i - 1 });
      start = -1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- case summaries

export const COLUMN_FIELDS = ['Ue', 'ne', 'uWall', 'psiWall', 'tauW', 'pW', 'hitRate', 'delta1', 'delta2', 'yHalf'] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];

export interface CaseSummary {
  key: string;
  seeds: number[];
  x: number[];
  height: number[];
  /** seed ensemble per column */
  stat: Record<ColumnField, SeedStat[]>;
  /** per-seed column values [seed][column] */
  perSeed: Record<ColumnField, number[][]>;
  /** block-mean near-wall velocity [seed][block][column] (time-resolved) */
  blockU: number[][][];
  /** fraction of (seed, block) samples with negative block-mean near-wall velocity, per column */
  blockNegative: number[];
  /** near-wall velocity seed ensembles from the first and the second half of the measurement blocks */
  halves: { first: SeedStat[]; second: SeedStat[] };
  /** seed-summed grids (primary resolution) for maps and the stream function */
  nearWall: GridSumsData;
  outer: GridSumsData;
  measurementTime: number;
}

/** Near-wall velocity per column from a block grid (band y < band). */
function blockColumnU(g: GridSumsData, band: number, cellX: number, mass: number): number[] {
  const c = coarsen(g, Math.round(cellX / g.cellW), 1);
  const out: number[] = [];
  for (let i = 0; i < c.nx; i++) out.push(meanVelocity(c, cellsIn(c, i, 0, band), 'px', mass));
  return out;
}

export function summarizeCase(key: string, runs: WallFlowRunResult[], opt: ObservableOptions): CaseSummary {
  if (runs.length === 0) throw new Error(`case ${key} has no runs`);
  const cfg = runs[0].config;
  const per = runs.map((r) => columnObservables(r.config, r.nearWall, r.outer, floorOf(r), r.measurementTime, opt));
  const nx = per[0].x.length;
  const stat = {} as Record<ColumnField, SeedStat[]>;
  const perSeed = {} as Record<ColumnField, number[][]>;
  for (const f of COLUMN_FIELDS) {
    perSeed[f] = per.map((o) => o[f]);
    stat[f] = Array.from({ length: nx }, (_, i) => seedStat(per.map((o) => o[f][i])));
  }
  const blockU = runs.map((r) => r.blocks.map((b) => blockColumnU(b, opt.nearWallBand, opt.cellX, cfg.mass)));
  const K = blockU[0].length;
  const blockNegative = Array.from({ length: nx }, (_, i) => {
    let neg = 0;
    let n = 0;
    for (const s of blockU) for (const b of s) if (Number.isFinite(b[i])) {
      n++;
      if (b[i] < 0) neg++;
    }
    return n > 0 ? neg / n : Number.NaN;
  });
  const half = (from: number, to: number) =>
    Array.from({ length: nx }, (_, i) => seedStat(blockU.map((s) => mean(s.slice(from, to).map((b) => b[i])))));
  const fy = Math.round(opt.cellY / runs[0].nearWall.cellH);
  const fx = Math.round(opt.cellX / runs[0].nearWall.cellW);
  return {
    key,
    seeds: runs.map((r) => r.seed),
    x: per[0].x,
    height: per[0].height,
    stat,
    perSeed,
    blockU,
    blockNegative,
    halves: { first: half(0, Math.floor(K / 2)), second: half(Math.floor(K / 2), K) },
    nearWall: coarsen(sumGrids(runs.map((r) => r.nearWall)), fx, fy),
    outer: coarsen(sumGrids(runs.map((r) => r.outer)), Math.round(opt.cellX / runs[0].outer.cellW), 1),
    measurementTime: mean(runs.map((r) => r.measurementTime)),
  };
}

export interface SeparatedRegion {
  from: number;
  to: number;
  columns: number[];
  /** region-mean near-wall velocity (per seed, then ensemble) */
  uWall: SeedStat;
  /** region-mean wall shear */
  tauW: SeedStat;
  /** region-mean near-wall mass flux */
  psiWall: SeedStat;
  /** fraction of (seed, block, column) samples with negative block-mean near-wall velocity */
  blockNegative: number;
  /** region-mean near-wall velocity from the first / second half of the measurement */
  firstHalf: SeedStat;
  secondHalf: SeedStat;
  /** seeds whose region-mean near-wall velocity is negative */
  seedsNegative: number;
}

/** Region (column set) statistics of a case summary. */
export function regionStats(s: CaseSummary, columns: number[]): Omit<SeparatedRegion, 'from' | 'to' | 'columns'> {
  const rm = (vals: number[][]) => vals.map((row) => mean(columns.map((i) => row[i])));
  const u = rm(s.perSeed.uWall);
  const K = s.blockU[0].length;
  const halfU = (a: number, b: number) => s.blockU.map((seed) => mean(seed.slice(a, b).map((blk) => mean(columns.map((i) => blk[i])))));
  let neg = 0;
  let n = 0;
  for (const seed of s.blockU) for (const blk of seed) for (const i of columns) {
    if (!Number.isFinite(blk[i])) continue;
    n++;
    if (blk[i] < 0) neg++;
  }
  return {
    uWall: seedStat(u),
    tauW: seedStat(rm(s.perSeed.tauW)),
    psiWall: seedStat(rm(s.perSeed.psiWall)),
    blockNegative: n > 0 ? neg / n : Number.NaN,
    firstHalf: seedStat(halfU(0, Math.floor(K / 2))),
    secondHalf: seedStat(halfU(Math.floor(K / 2), K)),
    seedsNegative: u.filter((v) => v < 0).length,
  };
}

/**
 * Candidate separated regions: maximal runs of at least `minColumns`
 * contiguous columns inside [x0, x1] whose seed-ensemble near-wall velocity is
 * significantly negative (t ≤ −t_{alpha, n−1}, one-sided).
 */
export function separatedRegions(s: CaseSummary, x0: number, x1: number, alpha: number, minColumns: number): SeparatedRegion[] {
  const flags = s.x.map((x, i) => {
    const st = s.stat.uWall[i];
    return x > x0 && x < x1 && st.n > 1 && st.mean < 0 && st.t <= -tOneSided(alpha, st.n - 1);
  });
  return runsOf(flags)
    .filter((r) => r.to - r.from + 1 >= minColumns)
    .map((r) => {
      const columns = Array.from({ length: r.to - r.from + 1 }, (_, k) => r.from + k);
      const w = s.x[1] - s.x[0];
      return { from: s.x[r.from] - w / 2, to: s.x[r.to] + w / 2, columns, ...regionStats(s, columns) };
    });
}

/**
 * Fluctuation statistics of a set of cells of a raw-sum grid (equal masses m,
 * disk radius r): number density, mean velocities, velocity SDs, kinetic
 * momentum flux ρ⟨u′v′⟩, collisional shear stress, occupancy and local kT.
 * Fluctuations are reported as such; nothing here assumes turbulence.
 */
export function cellMoments(g: GridSumsData, cells: number[], mass: number, radius: number) {
  let N = 0;
  let px = 0;
  let py = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let cxy = 0;
  for (const c of cells) {
    N += g.count[c];
    px += g.px[c];
    py += g.py[c];
    sxx += g.sxx?.[c] ?? Number.NaN;
    syy += g.syy?.[c] ?? Number.NaN;
    sxy += g.sxy?.[c] ?? Number.NaN;
    cxy += g.cxy?.[c] ?? Number.NaN;
  }
  const area = cells.length * g.cellW * g.cellH;
  const M = N * mass;
  const u = px / M;
  const v = py / M;
  const varU = sxx / M - u * u;
  const varV = syy / M - v * v;
  const n = N / (g.snapshots * area);
  return {
    n,
    phi: n * Math.PI * radius * radius,
    u,
    v,
    sigmaU: Math.sqrt(Math.max(0, varU)),
    sigmaV: Math.sqrt(Math.max(0, varV)),
    /** kinetic momentum flux ρ⟨u′v′⟩ = (Σ m v_x v_y − M u v)/(samples · area) */
    kineticFlux: (sxy - M * u * v) / (g.snapshots * area),
    /** collisional shear stress −P^c_xy */
    collisionalShear: g.collisionTime ? -cxy / (g.collisionTime * area) : Number.NaN,
    kT: (mass * (varU + varV)) / 2,
  };
}
