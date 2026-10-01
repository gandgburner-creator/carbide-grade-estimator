import { mean, tTwoSidedCritical } from '../measurements/Statistics';
import type { BLSCase, BLSParams } from './BoundaryLayerSeparationExperiment';
import {
  coarsen,
  dividingHeight,
  regionStats,
  seedStat,
  separatedRegions,
  streamFunction,
  summarizeCase,
  tOneSided,
  type CaseSummary,
  type ObservableOptions,
  type SeedStat,
  type SeparatedRegion,
} from './WallFlowAnalysis';
import type { WallFlowRunResult } from './WallFlowRun';

/**
 * Item 3 analysis and classification (docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md).
 * Pure functions of the raw runs and the pre-registered criteria; used by
 * scripts/report-bl-separation.ts. Nothing here is fitted to a continuum law.
 */
export type Verdict = 'PASS' | 'INCONCLUSIVE' | 'FAIL';

export interface BLSCriteria {
  observable: ObservableOptions;
  /** Part I stations (x) on the plate */
  stations: number[];
  /** lead-in column (specular floor, upstream of the plate) */
  upstreamStation: number;
  /** station upstream of the diffuser used for the numerical variants of Part I */
  variantStation: number;
  /** plate interior searched for separated regions */
  searchWindow: [number, number];
  /** wall-pressure rise = mean p_w over `pressureDownstream` − mean over `pressureUpstream` */
  pressureUpstream: [number, number];
  pressureDownstream: [number, number];
  /** region over which the near-wall response to deceleration is measured (Q4) */
  responseWindow: [number, number];
  /** station for the downstream momentum-deficit indicator (E) */
  deficitStation: number;
  tStructure: number;
  tWall: number;
  specularFraction: number;
  upstreamTolerance: number;
  splitZ: number;
  alphaColumn: number;
  minColumns: number;
  alphaPersist: number;
  blockFractionMin: number;
  seedsNegativeFraction: number;
  densityRatioMin: number;
  /** relative equivalence margin for convergence checks (95 % CI of the relative difference inside ±margin) */
  tolerance: number;
  /** absolute equivalence margins for the deceleration response (values near zero) */
  responseTolerance: { uWall: number; tauW: number };
  /** window behind the rib in which the positive control is searched */
  positiveWindow: [number, number];
  /** case keys with fixed roles */
  keys: {
    attached: string;
    weak: string;
    moderate: string;
    strong: string;
    attachedAw05: string;
    seriesAw05: string[];
    specularAttached: string;
    specularStrong: string;
    positiveControl: string;
  };
}

export interface Check {
  id: string;
  part: 'safety' | 'I' | 'II';
  question: string;
  criterion: string;
  measured: string;
  verdict: Verdict;
  /** reported only (never changes the classification) */
  reported?: boolean;
}

const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toPrecision(n) : 'n/a');
const fs = (s: SeedStat, n = 3) => `${f(s.mean, n)} ± ${f(s.se, 2)} (t ${f(s.t, 3)}, n ${s.n})`;

export function nearestColumn(s: CaseSummary, x: number): number {
  let best = 0;
  for (let i = 1; i < s.x.length; i++) if (Math.abs(s.x[i] - x) < Math.abs(s.x[best] - x)) best = i;
  return best;
}

export function columnsIn(s: CaseSummary, w: [number, number]): number[] {
  return s.x.map((x, i) => ({ x, i })).filter((q) => q.x > w[0] && q.x < w[1]).map((q) => q.i);
}

function welch(a: SeedStat, b: SeedStat) {
  const se = Math.hypot(a.se, b.se);
  return { diff: a.mean - b.mean, se, z: (a.mean - b.mean) / se };
}

/** Per-seed mean of a column field over a set of columns. */
function regionPerSeed(s: CaseSummary, field: keyof CaseSummary['perSeed'], cols: number[]): number[] {
  return s.perSeed[field].map((row) => mean(cols.map((i) => row[i])));
}

/** Seed subset of a summary's per-seed data (for split-half tests). */
function subset(runs: WallFlowRunResult[], parity: 0 | 1) {
  return runs.filter((_, k) => k % 2 === parity);
}

/**
 * Equivalence rule (relative): the 95 % CI of the relative difference
 * (variant − reference)/|reference| must lie inside ±margin for PASS, and
 * entirely outside it for FAIL; otherwise INCONCLUSIVE. Degrees of freedom:
 * the smaller ensemble minus one.
 */
export function agreement(ref: SeedStat, v: SeedStat, margin: number): { verdict: Verdict; rel: number; ci: [number, number] } {
  const w = welch(v, ref);
  const scale = Math.abs(ref.mean);
  const rel = w.diff / scale;
  const half = (tTwoSidedCritical(0.05, Math.max(1, Math.min(ref.n, v.n) - 1)) * w.se) / scale;
  const ci: [number, number] = [rel - half, rel + half];
  const verdict: Verdict = ci[0] >= -margin && ci[1] <= margin ? 'PASS' : ci[0] > margin || ci[1] < -margin ? 'FAIL' : 'INCONCLUSIVE';
  return { verdict, rel, ci };
}

/** Equivalence rule with an absolute margin (for quantities that may be near zero). */
export function absoluteAgreement(ref: SeedStat, v: SeedStat, margin: number): { verdict: Verdict; diff: number; ci: [number, number] } {
  const w = welch(v, ref);
  const half = tTwoSidedCritical(0.05, Math.max(1, Math.min(ref.n, v.n) - 1)) * w.se;
  const ci: [number, number] = [w.diff - half, w.diff + half];
  const verdict: Verdict = ci[0] >= -margin && ci[1] <= margin ? 'PASS' : ci[0] > margin || ci[1] < -margin ? 'FAIL' : 'INCONCLUSIVE';
  return { verdict, diff: w.diff, ci };
}

export interface BLSAnalysis {
  summaries: Record<string, CaseSummary>;
  regions: Record<string, SeparatedRegion[]>;
  checks: Check[];
  partI: Verdict;
  partII: Verdict;
  overall: Verdict;
  details: Record<string, unknown>;
}

export function analyse(params: BLSParams, runs: WallFlowRunResult[], C: BLSCriteria): BLSAnalysis {
  const byCase: Record<string, WallFlowRunResult[]> = {};
  for (const r of runs) (byCase[r.label] ??= []).push(r);
  for (const k of Object.keys(byCase)) byCase[k].sort((a, b) => a.seed - b.seed);
  const caseOf: Record<string, BLSCase> = Object.fromEntries(params.cases.map((c) => [c.key, c]));
  const summaries: Record<string, CaseSummary> = {};
  for (const [k, rs] of Object.entries(byCase)) summaries[k] = summarizeCase(k, rs, C.observable);
  const has = (k: string) => !!summaries[k];
  const S = (k: string) => {
    if (!summaries[k]) throw new Error(`case ${k} missing`);
    return summaries[k];
  };
  const checks: Check[] = [];
  const details: Record<string, unknown> = {};
  const add = (c: Check) => checks.push(c);
  const tP = (n: number) => tOneSided(C.alphaPersist, n - 1);
  const tC = (n: number) => tOneSided(C.alphaColumn, n - 1);

  // ------------------------------------------------------------ safety
  const halted = runs.filter((r) => r.halted).length;
  add({ id: 'S-safety', part: 'safety', question: 'numerical safety', criterion: 'no run halted', measured: `${halted} halted of ${runs.length}`, verdict: halted ? 'FAIL' : 'PASS' });
  const maxE = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
  const maxP = Math.max(...runs.map((r) => r.conservation.maxRelativeMomentumResidual));
  add({ id: 'S-energy', part: 'safety', question: 'energy accounting closes (kinetic, wall heat, fringe work)', criterion: 'max |relative residual| < 1e-9', measured: maxE.toExponential(2), verdict: maxE < 1e-9 ? 'PASS' : 'FAIL' });
  add({ id: 'S-momentum', part: 'safety', question: 'momentum accounting closes', criterion: 'max relative residual < 1e-9', measured: maxP.toExponential(2), verdict: maxP < 1e-9 ? 'PASS' : 'FAIL' });
  const flagged = runs.filter((r) => r.emptySpace.flag).length;
  add({ id: 'S-empty-space', part: 'safety', question: 'no empty space / particle loss', criterion: 'no POTENTIAL MODEL / NUMERICAL FAILURE flag; particle count constant', measured: `${flagged} flagged`, verdict: flagged ? 'FAIL' : 'PASS' });

  // ------------------------------------------------------------ Part I
  const A1 = S(C.keys.attached);
  const deficitPerSeed = (s: CaseSummary, i: number) => s.perSeed.Ue.map((ue, k) => ue[i] - s.perSeed.uWall[k][i]);
  const structure = (key: string) => {
    const s = S(key);
    const rows = C.stations.map((x) => {
      const i = nearestColumn(s, x);
      return { x: s.x[i], deficit: seedStat(deficitPerSeed(s, i)), delta1: s.stat.delta1[i], delta2: s.stat.delta2[i], yHalf: s.stat.yHalf[i], tauW: s.stat.tauW[i], uWall: s.stat.uWall[i], Ue: s.stat.Ue[i] };
    });
    return rows;
  };
  details.structure = {};
  for (const key of [C.keys.attached, C.keys.attachedAw05, C.keys.specularAttached]) if (has(key)) (details.structure as Record<string, unknown>)[key] = structure(key);
  for (const key of [C.keys.attached, C.keys.attachedAw05].filter(has)) {
    const rows = structure(key);
    const ok = rows.every((r) => r.deficit.t >= C.tStructure && r.delta1.t >= C.tStructure);
    // demonstrably absent: at every station the deficit's 95 % CI lies below the upstream tolerance
    const upper = (st: SeedStat) => st.mean + tTwoSidedCritical(0.05, Math.max(1, st.n - 1)) * st.se;
    const absent = rows.every((r) => upper(r.deficit) < C.upstreamTolerance);
    add({
      id: `I1-structure-${key}`,
      part: 'I',
      question: 'Q1/Q2: does the stationary wall create a near-wall region of lower mean streamwise velocity?',
      criterion: `at every station ${C.stations.join(', ')}: velocity deficit U_e − u_wall and deficit thickness δ₁ each with seed t ≥ ${C.tStructure} (FAIL if at every station the deficit's 95 % CI lies below ${C.upstreamTolerance})`,
      measured: rows.map((r) => `x ${r.x}: deficit ${fs(r.deficit)}, δ₁ ${fs(r.delta1)}`).join('; '),
      verdict: ok ? 'PASS' : absent ? 'FAIL' : 'INCONCLUSIVE',
    });
  }
  if (has(C.keys.specularAttached)) {
    const sp = structure(C.keys.specularAttached);
    const d = structure(C.keys.attached);
    // equivalence: the 95 % CI of the specular-wall deficit must lie inside ±fraction × the diffuse-wall deficit
    const rows = sp.map((r, k) => {
      const m = C.specularFraction * d[k].deficit.mean;
      const half = tTwoSidedCritical(0.05, Math.max(1, r.deficit.n - 1)) * r.deficit.se;
      const ci: [number, number] = [r.deficit.mean - half, r.deficit.mean + half];
      const verdict: Verdict = ci[0] >= -m && ci[1] <= m ? 'PASS' : ci[0] > m || ci[1] < -m ? 'FAIL' : 'INCONCLUSIVE';
      return { x: r.x, ci, m, verdict, mean: r.deficit.mean, ref: d[k].deficit.mean };
    });
    const tauZero = S(C.keys.specularAttached).perSeed.tauW.every((row) => row.every((v) => v === 0));
    const vs = rows.map((r) => r.verdict);
    add({
      id: 'I2-specular-control',
      part: 'I',
      question: 'falsification: is the near-wall structure caused by wall momentum transfer (absent for a specular wall)?',
      criterion: `Aw = 0: the 95 % CI of the deficit lies within ±${C.specularFraction} × the Aw = 1 deficit at every station (FAIL if entirely outside), and the floor's tangential impulse is exactly 0`,
      measured: rows.map((r) => `x ${r.x}: ${f(r.mean)} CI [${f(r.ci[0], 2)}, ${f(r.ci[1], 2)}] vs ±${f(r.m, 2)} (Aw=1 deficit ${f(r.ref)})`).join('; ') + `; tangential impulse exactly 0: ${tauZero}`,
      verdict: !tauZero || vs.includes('FAIL') ? 'FAIL' : vs.every((v) => v === 'PASS') ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // upstream control (all cases)
  {
    const rows = Object.values(summaries).map((s) => {
      const i = nearestColumn(s, C.upstreamStation);
      return { key: s.key, d: seedStat(deficitPerSeed(s, i)) };
    });
    const ok = rows.every((r) => Math.abs(r.d.mean) <= C.upstreamTolerance + 3 * r.d.se);
    add({
      id: 'I-upstream-control',
      part: 'I',
      question: 'is the inflow over the specular lead-in free of a near-wall deficit?',
      criterion: `|deficit| at x = ${C.upstreamStation} ≤ ${C.upstreamTolerance} + 3 SE in every case`,
      measured: rows.map((r) => `${r.key} ${f(r.d.mean, 2)}±${f(r.d.se, 1)}`).join('; '),
      verdict: ok ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // wall momentum transfer
  {
    const plateCols = columnsIn(A1, C.searchWindow);
    const rows = [C.keys.attached, C.keys.attachedAw05].filter(has).map((k) => ({ k, t: seedStat(regionPerSeed(S(k), 'tauW', plateCols)) }));
    const ok = rows.every((r) => r.t.t >= C.tWall);
    add({
      id: 'I3-wall-momentum-transfer',
      part: 'I',
      question: 'is the wall momentum transfer (tangential impulse) measurable?',
      criterion: `plate-mean τ_w (impulse per time per length) seed t ≥ ${C.tWall} for Aw = 1 and 0.5`,
      measured: rows.map((r) => `${r.k}: ${fs(r.t, 4)}`).join('; '),
      verdict: ok ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // split seeds
  {
    const rs = byCase[C.keys.attached];
    const h = [subset(rs, 0), subset(rs, 1)].map((x) => summarizeCase(C.keys.attached, x, C.observable));
    const rows = C.stations.map((x) => {
      const i = nearestColumn(h[0], x);
      const a = h[0].stat.delta1[i];
      const b = h[1].stat.delta1[i];
      const da = seedStat(deficitPerSeed(h[0], i));
      const db = seedStat(deficitPerSeed(h[1], i));
      return { x: h[0].x[i], z: welch(a, b).z, a, b, ta: da.t, tb: db.t };
    });
    const ok = rows.every((r) => Math.abs(r.z) < C.splitZ && r.ta >= 3 && r.tb >= 3);
    add({
      id: 'I4-seed-halves',
      part: 'I',
      question: 'Q2: is the structure reproducible across independent seeds?',
      criterion: `odd/even seed halves: δ₁ agree (|z| < ${C.splitZ}) and the deficit is significant (t ≥ 3) in each half, at every station`,
      measured: rows.map((r) => `x ${r.x}: δ₁ ${f(r.a.mean)} vs ${f(r.b.mean)} (z ${f(r.z, 2)}), deficit t ${f(r.ta, 2)}/${f(r.tb, 2)}`).join('; '),
      verdict: ok ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // time halves (sampling duration)
  {
    const s = A1;
    const rows = C.stations.map((x) => {
      const i = nearestColumn(s, x);
      const K = s.blockU[0].length;
      // paired (per-seed) relative change between the halves, with a 95 % CI
      const d = s.blockU.map((seed) => mean(seed.slice(K / 2).map((b) => b[i])) - mean(seed.slice(0, K / 2).map((b) => b[i])));
      const ds = seedStat(d);
      const m = Math.abs(s.stat.uWall[i].mean);
      const half = tTwoSidedCritical(0.05, ds.n - 1) * ds.se;
      const ci: [number, number] = [(ds.mean - half) / m, (ds.mean + half) / m];
      const verdict: Verdict = ci[0] >= -C.tolerance && ci[1] <= C.tolerance ? 'PASS' : ci[0] > C.tolerance || ci[1] < -C.tolerance ? 'FAIL' : 'INCONCLUSIVE';
      return { x: s.x[i], ci, rel: ds.mean / m, verdict, first: s.halves.first[i], second: s.halves.second[i] };
    });
    const vs = rows.map((r) => r.verdict);
    add({
      id: 'I5-sampling-duration',
      part: 'I',
      question: 'Q3: is the near-wall structure stationary over the measurement (sampling-duration convergence)?',
      criterion: `near-wall velocity, second vs first half of the measurement: the 95 % CI of the paired relative change lies within ±${C.tolerance} at every station (FAIL if entirely outside)`,
      measured: rows.map((r) => `x ${r.x}: ${f(r.first.mean)} → ${f(r.second.mean)} (rel ${f(r.rel, 2)}, CI [${f(r.ci[0], 2)}, ${f(r.ci[1], 2)}])`).join('; '),
      verdict: vs.includes('FAIL') ? 'FAIL' : vs.every((v) => v === 'PASS') ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // bin width
  {
    const alt: ObservableOptions = { ...C.observable, cellX: 2 * C.observable.cellX, cellY: 2 * C.observable.cellY };
    const fine: ObservableOptions = { ...C.observable, cellY: C.observable.cellY / 2 };
    const sAlt = summarizeCase(C.keys.attached, byCase[C.keys.attached], alt);
    const sFine = summarizeCase(C.keys.attached, byCase[C.keys.attached], fine);
    const rows = C.stations.map((x) => {
      const i = nearestColumn(A1, x);
      const j = nearestColumn(sAlt, x);
      const q = nearestColumn(sFine, x);
      const y = agreement(A1.stat.yHalf[i], sAlt.stat.yHalf[j], C.tolerance);
      const yf = agreement(A1.stat.yHalf[i], sFine.stat.yHalf[q], C.tolerance);
      const u = agreement(A1.stat.uWall[i], sAlt.stat.uWall[j], C.tolerance);
      return { x: A1.x[i], y, yf, u, ref: A1.stat.yHalf[i].mean, coarse: sAlt.stat.yHalf[j].mean, fineV: sFine.stat.yHalf[q].mean };
    });
    const vs = rows.flatMap((r) => [r.y.verdict, r.yf.verdict, r.u.verdict]);
    add({
      id: 'I6-bin-width',
      part: 'I',
      question: 'Q3: does the thickness depend on the spatial bin width?',
      criterion: `half-deficit height y½ and near-wall velocity at (Δx, Δy) = (${C.observable.cellX}, ${C.observable.cellY}) vs (${2 * C.observable.cellX}, ${2 * C.observable.cellY}), and y½ at Δy = ${C.observable.cellY / 2}: 95 % CI of each relative difference within ±${C.tolerance} (FAIL if entirely outside)`,
      measured: rows.map((r) => `x ${r.x}: y½ ${f(r.ref)} / ${f(r.coarse)} / ${f(r.fineV)} (rel ${f(r.y.rel, 2)} CI [${f(r.y.ci[0], 2)}, ${f(r.y.ci[1], 2)}], ${f(r.yf.rel, 2)}), u_wall rel ${f(r.u.rel, 2)}`).join('; '),
      verdict: vs.includes('FAIL') ? 'FAIL' : vs.every((v) => v === 'PASS') ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // Part I variants (numerical and domain)
  const variantRows: Record<string, unknown>[] = [];
  for (const c of params.cases.filter((q) => q.role === 'variant' && has(q.key) && q.reference && has(q.reference))) {
    const ref = S(c.reference!);
    const v = S(c.key);
    const xs = c.variant === 'height' && c.reference === C.keys.attached ? C.stations.slice(0, 2) : [C.variantStation];
    for (const x of xs) {
      const i = nearestColumn(ref, x);
      const j = nearestColumn(v, x);
      const physical = c.variant === 'resolution';
      const d1 = agreement(ref.stat.delta1[i], v.stat.delta1[j], C.tolerance);
      const tw = agreement(ref.stat.tauW[i], v.stat.tauW[j], C.tolerance);
      const dv = seedStat(deficitPerSeed(v, j));
      const persists = dv.t >= C.tStructure;
      const dvUpper = dv.mean + tTwoSidedCritical(0.05, Math.max(1, dv.n - 1)) * dv.se;
      const refDef = seedStat(deficitPerSeed(ref, i)).mean;
      variantRows.push({ key: c.key, variant: c.variant, x: ref.x[i], delta1: [ref.stat.delta1[i], v.stat.delta1[j]], tauW: [ref.stat.tauW[i], v.stat.tauW[j]], d1, tw, deficitT: dv.t });
      add({
        id: `I-variant-${c.key}-x${Math.round(ref.x[i])}`,
        part: 'I',
        question: physical ? 'Q3/falsification: does the structure survive higher particle resolution?' : `Q3: is the near-wall structure converged in ${c.variant}?`,
        criterion: physical
          ? `deficit still significant (t ≥ ${C.tStructure}); FAIL if its 95 % CI lies below ${C.specularFraction} × the reference deficit; thickness ratio reported`
          : `δ₁ and τ_w at x = ${ref.x[i]}: 95 % CI of each relative difference within ±${C.tolerance} (FAIL if entirely outside)`,
        measured: `δ₁ ${f(ref.stat.delta1[i].mean)} → ${f(v.stat.delta1[j].mean)} (rel ${f(d1.rel, 2)}, CI [${f(d1.ci[0], 2)}, ${f(d1.ci[1], 2)}]); τ_w ${f(ref.stat.tauW[i].mean, 3)} → ${f(v.stat.tauW[j].mean, 3)} (rel ${f(tw.rel, 2)}, CI [${f(tw.ci[0], 2)}, ${f(tw.ci[1], 2)}]); deficit t ${f(dv.t, 3)}`,
        verdict: physical ? (persists ? 'PASS' : dvUpper < C.specularFraction * refDef ? 'FAIL' : 'INCONCLUSIVE') : d1.verdict === 'FAIL' || tw.verdict === 'FAIL' ? 'FAIL' : d1.verdict === 'PASS' && tw.verdict === 'PASS' ? 'PASS' : 'INCONCLUSIVE',
      });
    }
  }
  details.partIVariants = variantRows;

  // ------------------------------------------------------------ Part II
  const regions: Record<string, SeparatedRegion[]> = {};
  for (const [k, s] of Object.entries(summaries)) regions[k] = separatedRegions(s, C.searchWindow[0], C.searchWindow[1], C.alphaColumn, C.minColumns);
  const T2 = S(C.keys.strong);
  const T2pre = () => T2;
  // Q4 response to deceleration
  for (const key of [C.keys.weak, C.keys.moderate, C.keys.strong].filter(has)) {
    const s = S(key);
    const up = columnsIn(s, C.pressureUpstream);
    const dn = columnsIn(s, C.pressureDownstream);
    const rise = seedStat(s.perSeed.pW.map((row) => mean(dn.map((i) => row[i])) - mean(up.map((i) => row[i]))));
    const resp = columnsIn(s, C.responseWindow);
    const uT = seedStat(regionPerSeed(s, 'uWall', resp));
    const uC = seedStat(regionPerSeed(A1, 'uWall', columnsIn(A1, C.responseWindow)));
    const w = welch(uT, uC);
    add({
      id: `II1-response-${key}`,
      part: 'II',
      question: 'Q4: does the deceleration create a measured wall-pressure rise, and does the near-wall flow respond?',
      criterion: `wall-pressure rise (impulse-measured) seed t ≥ 5, and near-wall velocity over x ∈ (${C.responseWindow.join(', ')}) lower than the attached control (Welch z ≤ −5)`,
      measured: `Δp_w ${fs(rise, 3)}; u_wall ${f(uT.mean)} vs ${f(uC.mean)} (z ${f(w.z, 3)})`,
      verdict: rise.t >= 5 && w.z <= -5 ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // convergence of the deceleration response itself (evaluated whether or not the flow reverses)
  for (const c of params.cases.filter((q) => q.role === 'variant' && q.reference === C.keys.strong && has(q.key))) {
    const v = S(c.key);
    const refCfg = byCase[C.keys.strong][0].config;
    const varCfg = byCase[c.key][0].config;
    const refCols = columnsIn(T2pre(), C.responseWindow);
    const cols = [...new Set(refCols.map((i) => nearestColumn(v, variantX(refCfg, varCfg, c.variant, T2pre().x[i]))))];
    const ru = seedStat(regionPerSeed(T2pre(), 'uWall', refCols));
    const vu = seedStat(regionPerSeed(v, 'uWall', cols));
    const rt = seedStat(regionPerSeed(T2pre(), 'tauW', refCols));
    const vt = seedStat(regionPerSeed(v, 'tauW', cols));
    const numerical = c.variant === 'timestep' || c.variant === 'length';
    const au = absoluteAgreement(ru, vu, C.responseTolerance.uWall);
    const at = absoluteAgreement(rt, vt, C.responseTolerance.tauW);
    const uC = seedStat(regionPerSeed(A1, 'uWall', columnsIn(A1, C.responseWindow)));
    const responds = welch(vu, uC).z <= -5;
    add({
      id: `II9-response-${c.key}`,
      part: 'II',
      question: `Q3/Q4: is the near-wall response to the deceleration converged in the ${c.variant} variant?`,
      criterion: numerical
        ? `response-window u_wall and τ_w: 95 % CI of the difference from the reference within ±${C.responseTolerance.uWall} and ±${C.responseTolerance.tauW} (FAIL if entirely outside)`
        : `the variant still responds (u_wall below the attached control, Welch z ≤ −5); differences reported`,
      measured: `u_wall ${f(ru.mean)} → ${f(vu.mean)} (Δ ${f(au.diff, 2)}, CI [${f(au.ci[0], 2)}, ${f(au.ci[1], 2)}]); τ_w ${f(rt.mean, 3)} → ${f(vt.mean, 3)} (Δ ${f(at.diff, 2)}, CI [${f(at.ci[0], 2)}, ${f(at.ci[1], 2)}]); vs attached z ${f(welch(vu, uC).z, 3)}`,
      verdict: numerical ? (au.verdict === 'FAIL' || at.verdict === 'FAIL' ? 'FAIL' : au.verdict === 'PASS' && at.verdict === 'PASS' ? 'PASS' : 'INCONCLUSIVE') : responds ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // positive control: geometric separation behind a floor rib, analysed with the same detector
  if (has(C.keys.positiveControl)) {
    const pc = S(C.keys.positiveControl);
    const regs = separatedRegions(pc, C.positiveWindow[0], C.positiveWindow[1], C.alphaColumn, C.minColumns);
    const top = regs.slice().sort((a, b) => b.columns.length - a.columns.length)[0];
    let measured = 'no separated region';
    let ok = false;
    if (top) {
      const psi = streamFunction(pc.nearWall);
      const hs = top.columns.map((i) => dividingHeight(psi.psi[i], psi.yTop));
      const bounded = hs.filter((h) => Number.isFinite(h)).length;
      ok = top.tauW.t <= -tP(top.tauW.n) && top.psiWall.t <= -tP(top.psiWall.n) && bounded > hs.length / 2;
      measured = `region [${top.from}, ${top.to}]: u_wall ${fs(top.uWall, 3)}, τ_w ${fs(top.tauW, 3)}, ψ_wall t ${f(top.psiWall.t, 3)}, bounded columns ${bounded}/${hs.length}`;
    }
    details.positiveControl = { regions: regs };
    add({
      id: 'PC-positive-control',
      part: 'II',
      question: 'detector sensitivity: does the same detector find the recirculation behind a floor rib (geometric separation)?',
      criterion: `a separated region in (${C.positiveWindow.join(', ')}) with region-mean τ_w and ψ_wall t ≤ −t_${C.alphaPersist} and a bounded return-flow layer in most columns`,
      measured,
      verdict: ok ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  const primary = (regions[C.keys.strong] ?? []).slice().sort((a, b) => b.columns.length - a.columns.length || a.uWall.mean - b.uWall.mean)[0];
  details.primaryRegion = primary ?? null;
  // Q5 local reversal
  {
    const win = columnsIn(T2, C.searchWindow);
    const minCol = win.reduce((b, i) => (T2.stat.uWall[i].mean < T2.stat.uWall[b].mean ? i : b), win[0]);
    const demonstrablyAttached = win.every((i) => T2.stat.uWall[i].t >= tC(T2.stat.uWall[i].n)) && win.every((i) => T2.stat.tauW[i].t >= tC(T2.stat.tauW[i].n));
    add({
      id: 'II2-local-reversal',
      part: 'II',
      question: 'Q5 / indicator A: does local reverse streamwise motion appear (strong deceleration)?',
      criterion: `≥ 1 run of ≥ ${C.minColumns} contiguous columns in (${C.searchWindow.join(', ')}) with seed-mean near-wall u < 0, one-sided p ≤ ${C.alphaColumn} each; FAIL if every column is significantly forward (u_wall and τ_w both t ≥ t_${C.alphaColumn})`,
      measured: primary
        ? `${regions[C.keys.strong].length} region(s); primary x ∈ [${primary.from}, ${primary.to}] (${primary.columns.length} columns), u_wall ${fs(primary.uWall, 3)}`
        : `none; most negative column x ${T2.x[minCol]}: u_wall ${fs(T2.stat.uWall[minCol], 3)}`,
      verdict: primary ? 'PASS' : demonstrablyAttached ? 'FAIL' : 'INCONCLUSIVE',
    });
  }
  // null distribution from the attached control
  const plateA1 = columnsIn(A1, C.searchWindow);
  const nullMaxBlockNeg = Math.max(...plateA1.map((i) => A1.blockNegative[i]));
  const nullMinT = Math.min(...plateA1.map((i) => A1.stat.uWall[i].t));
  details.null = { key: C.keys.attached, maxBlockNegative: nullMaxBlockNeg, minColumnT: nullMinT, regions: regions[C.keys.attached].length };
  add({
    id: 'II4-null',
    part: 'II',
    question: 'thermal-noise null: does the attached control produce apparent separation?',
    criterion: 'no separated region in the attached control (same rule as II2)',
    measured: `${regions[C.keys.attached].length} region(s); most negative column t ${f(nullMinT, 3)}; max fraction of negative block means ${f(nullMaxBlockNeg, 3)}`,
    verdict: regions[C.keys.attached].length === 0 ? 'PASS' : 'FAIL',
  });
  if (primary) {
    const n = primary.uWall.n;
    // Q6 persistence
    const temporal = primary.firstHalf.t <= -tP(n) && primary.secondHalf.t <= -tP(n);
    const blocks = primary.blockNegative >= C.blockFractionMin && primary.blockNegative > nullMaxBlockNeg;
    const seedsOk = primary.seedsNegative >= C.seedsNegativeFraction * n;
    const rs = byCase[C.keys.strong];
    const halves = [subset(rs, 0), subset(rs, 1)].map((x) => regionStats(summarizeCase(C.keys.strong, x, C.observable), primary.columns));
    const seedHalves = halves.every((h) => h.uWall.t <= -tOneSided(C.alphaPersist, h.uWall.n - 1));
    add({
      id: 'II3-persistence',
      part: 'II',
      question: 'Q6 / indicator B: does the reverse flow persist in time, space and across seeds?',
      criterion: `primary region ≥ ${C.minColumns} columns; region-mean u_wall t ≤ −t_${C.alphaPersist} in each half of the measurement and in each seed half; fraction of negative block means ≥ ${C.blockFractionMin} and above the attached control's maximum; ≥ ${C.seedsNegativeFraction * 100} % of seeds negative`,
      measured: `length ${primary.to - primary.from}; halves ${fs(primary.firstHalf)} / ${fs(primary.secondHalf)}; seed halves t ${f(halves[0].uWall.t, 3)} / ${f(halves[1].uWall.t, 3)}; negative blocks ${f(primary.blockNegative, 3)} (null max ${f(nullMaxBlockNeg, 3)}); seeds negative ${primary.seedsNegative}/${n}`,
      verdict: temporal && blocks && seedsOk && seedHalves ? 'PASS' : 'INCONCLUSIVE',
    });
    // D wall signature
    add({
      id: 'II5-wall-signature',
      part: 'II',
      question: 'indicator D: is the reversal seen independently in the wall momentum transfer?',
      criterion: `region-mean τ_w (floor impulses) t ≤ −t_${C.alphaPersist}`,
      measured: `τ_w ${fs(primary.tauW, 3)}`,
      verdict: primary.tauW.t <= -tP(primary.tauW.n) ? 'PASS' : 'INCONCLUSIVE',
    });
    // C recirculation
    const psi = streamFunction(T2.nearWall);
    const heights = primary.columns.map((i) => dividingHeight(psi.psi[i], psi.yTop));
    const bounded = heights.filter((h) => Number.isFinite(h)).length;
    details.recirculation = { dividingHeights: heights.map((h, k) => ({ x: T2.x[primary.columns[k]], h })), psiWall: primary.psiWall };
    add({
      id: 'II6-recirculation',
      part: 'II',
      question: 'indicator C: is there a return-flow layer under forward flow (closed recirculation)?',
      criterion: `region-mean near-wall mass flux ψ_wall t ≤ −t_${C.alphaPersist}, and in a majority of region columns the stream function returns to ψ ≥ 0 within the near-wall grid (forward flow above)`,
      measured: `ψ_wall ${fs(primary.psiWall, 3)}; bounded columns ${bounded}/${heights.length}; dividing heights ${heights.map((h) => f(h, 3)).join(', ')}`,
      verdict: primary.psiWall.t <= -tP(primary.psiWall.n) && bounded > heights.length / 2 ? 'PASS' : 'INCONCLUSIVE',
    });
    // density
    const dens = primary.columns.map((i) => {
      const g = T2.nearWall;
      let cnt = 0;
      for (let j = 0; j < Math.round(C.observable.nearWallBand / g.cellH); j++) cnt += g.count[j * g.nx + i];
      const n0 = cnt / (g.snapshots * g.cellW * C.observable.nearWallBand);
      return n0 / T2.stat.ne[i].mean;
    });
    const minRatio = Math.min(...dens);
    add({
      id: 'II8-population',
      part: 'II',
      question: 'is the reversed region a valid particle population (not depletion)?',
      criterion: `near-wall number density ≥ ${C.densityRatioMin} × core density in every region column`,
      measured: `min ratio ${f(minRatio, 3)}`,
      verdict: minRatio >= C.densityRatioMin ? 'PASS' : 'FAIL',
    });
    // Q7 transition reproduced in seed halves
    const c1h = [subset(byCase[C.keys.attached], 0), subset(byCase[C.keys.attached], 1)].map(
      (x) => separatedRegions(summarizeCase(C.keys.attached, x, C.observable), C.searchWindow[0], C.searchWindow[1], C.alphaColumn, C.minColumns).length,
    );
    add({
      id: 'II10-transition-reproduced',
      part: 'II',
      question: 'Q7: is the attached → separated transition reproduced in independent seed sets?',
      criterion: `in each seed half: attached control has no separated region and the strong case's primary-region u_wall t ≤ −t_${C.alphaPersist}`,
      measured: `attached regions ${c1h.join('/')}; strong t ${halves.map((h) => f(h.uWall.t, 3)).join('/')}`,
      verdict: c1h.every((v) => v === 0) && seedHalves ? 'PASS' : 'INCONCLUSIVE',
    });
    // variants: separation persists
    for (const c of params.cases.filter((q) => q.role === 'variant' && q.reference === C.keys.strong && has(q.key))) {
      const v = S(c.key);
      const refCfg = byCase[C.keys.strong][0].config;
      const varCfg = byCase[c.key][0].config;
      const cols = [...new Set(primary.columns.map((i) => nearestColumn(v, variantX(refCfg, varCfg, c.variant, T2.x[i]))))];
      const st = regionStats(v, cols);
      const numerical = c.variant === 'timestep' || c.variant === 'length';
      const ag = absoluteAgreement(primary.uWall, st.uWall, C.responseTolerance.uWall);
      const persists = st.uWall.t <= -tP(st.uWall.n);
      const vanished = st.uWall.t >= tP(st.uWall.n);
      add({
        id: `II9-variant-${c.key}`,
        part: 'II',
        question: `falsification: does the reverse flow survive the ${c.variant} variant?`,
        criterion: numerical
          ? `variant region-mean u_wall t ≤ −t_${C.alphaPersist} and its difference from the reference has a 95 % CI within ±${C.responseTolerance.uWall}; FAIL if significantly forward or the CI is entirely outside`
          : `variant region-mean u_wall t ≤ −t_${C.alphaPersist}; FAIL if significantly forward`,
        measured: `u_wall ${fs(st.uWall, 3)} vs reference ${fs(primary.uWall, 3)} (Δ CI [${f(ag.ci[0], 2)}, ${f(ag.ci[1], 2)}])`,
        verdict: vanished || (numerical && ag.verdict === 'FAIL') ? 'FAIL' : persists && (!numerical || ag.verdict === 'PASS') ? 'PASS' : 'INCONCLUSIVE',
      });
    }
    // bin width for the reversal
    {
      const alt: ObservableOptions = { ...C.observable, cellX: 2 * C.observable.cellX };
      const s2 = summarizeCase(C.keys.strong, byCase[C.keys.strong], alt);
      const r2 = separatedRegions(s2, C.searchWindow[0], C.searchWindow[1], C.alphaColumn, 1);
      const overlap = r2.some((r) => r.to > primary.from && r.from < primary.to);
      add({
        id: 'II9-bin-width',
        part: 'II',
        question: 'falsification: does the reversal survive a coarser column width?',
        criterion: `with Δx = ${2 * C.observable.cellX}, a significantly reversed column (p ≤ ${C.alphaColumn}) overlaps the primary region`,
        measured: r2.length ? r2.map((r) => `[${r.from}, ${r.to}] t ${f(r.uWall.t, 3)}`).join('; ') : 'none',
        verdict: overlap ? 'PASS' : 'INCONCLUSIVE',
      });
    }
    // specular falsification
    if (has(C.keys.specularStrong)) {
      const sp = S(C.keys.specularStrong);
      const cols = primary.columns.map((i) => nearestColumn(sp, T2.x[i]));
      const st = regionStats(sp, cols);
      const regs = regions[C.keys.specularStrong];
      add({
        id: 'II11-specular-falsification',
        part: 'II',
        question: 'falsification: does the same deceleration reverse the flow over a specular (no-shear) wall?',
        criterion: 'Aw = 0 at the strong deceleration: no separated region and region-mean u_wall not significantly negative',
        measured: `${regs.length} region(s); u_wall ${fs(st.uWall, 3)}`,
        verdict: regs.length === 0 && !(st.uWall.t <= -tP(st.uWall.n)) ? 'PASS' : 'FAIL',
      });
    }
  }
  // E downstream momentum deficit
  {
    const i = nearestColumn(T2, C.deficitStation);
    const j = nearestColumn(A1, C.deficitStation);
    const w = welch(T2.stat.delta2[i], A1.stat.delta2[j]);
    add({
      id: 'II7-downstream-deficit',
      part: 'II',
      question: 'indicator E: does a larger momentum deficit develop downstream of the deceleration?',
      criterion: `momentum-flux deficit thickness δ₂ at x = ${C.deficitStation}: strong case > attached control, Welch z ≥ 3`,
      measured: `δ₂ ${f(T2.stat.delta2[i].mean)} vs ${f(A1.stat.delta2[j].mean)} (z ${f(w.z, 3)})`,
      verdict: w.z >= 3 ? 'PASS' : 'INCONCLUSIVE',
    });
  }
  // threshold and accommodation (reported)
  const order = (key: string) => {
    if (!has(key)) return null;
    const s = S(key);
    const win = columnsIn(s, C.searchWindow);
    const ref = primary ? primary.columns.map((i) => nearestColumn(s, T2.x[i])) : columnsIn(s, C.responseWindow);
    return {
      key,
      expansion: caseOf[key]?.overrides.expansion ?? params.base.expansion,
      accommodation: caseOf[key]?.overrides.accommodation ?? params.base.accommodation,
      minColumnU: Math.min(...win.map((i) => s.stat.uWall[i].mean)),
      reversedLength: regions[key].reduce((a, r) => a + (r.to - r.from), 0),
      regionU: regionStats(s, ref).uWall,
      regionTau: regionStats(s, ref).tauW,
      regions: regions[key].map((r) => ({ from: r.from, to: r.to, u: r.uWall.mean, t: r.uWall.t })),
    };
  };
  details.threshold = {
    aw1: [C.keys.attached, C.keys.weak, C.keys.moderate, C.keys.strong].map(order),
    aw05: C.keys.seriesAw05.map(order),
    aw0: [C.keys.specularAttached, C.keys.specularStrong].map(order),
  };
  {
    const th = details.threshold as { aw1: ReturnType<typeof order>[]; aw05: ReturnType<typeof order>[] };
    const first = (rows: ReturnType<typeof order>[]) => rows.find((r) => r && r.regions.length > 0)?.expansion ?? null;
    const r1 = first(th.aw1);
    const r05 = first(th.aw05);
    const pairs = th.aw05.filter((r) => r && r.expansion > 1).map((r) => {
      const a1 = th.aw1.find((q) => q && q.expansion === r!.expansion);
      return a1 ? { r: r!.expansion, z: welch(r!.regionU, a1.regionU).z, aw05: r!.regionU.mean, aw1: a1.regionU.mean } : null;
    });
    add({
      id: 'Q8-accommodation-shift',
      part: 'II',
      question: 'Q8: does the separation threshold move when the wall accommodation changes?',
      criterion: 'reported: smallest expansion with a separated region for Aw = 1 and Aw = 0.5, and the region-mean near-wall velocity difference at equal expansion',
      measured: `threshold Aw=1: ${r1 ?? 'none in range'}; Aw=0.5: ${r05 ?? 'none in range'}; ${pairs.filter(Boolean).map((p) => `r ${p!.r}: ${f(p!.aw05)} vs ${f(p!.aw1)} (z ${f(p!.z, 3)})`).join('; ')}`,
      verdict: 'PASS',
      reported: true,
    });
  }

  const judged = (part: Check['part']) => checks.filter((c) => !c.reported && (c.part === part || c.part === 'safety'));
  const combine = (cs: Check[]): Verdict => (cs.some((c) => c.verdict === 'FAIL') ? 'FAIL' : cs.every((c) => c.verdict === 'PASS') ? 'PASS' : 'INCONCLUSIVE');
  const partI = combine(judged('I'));
  const partII = combine(judged('II'));
  const overall: Verdict = partI === 'FAIL' || partII === 'FAIL' ? 'FAIL' : partI === 'PASS' && partII === 'PASS' ? 'PASS' : 'INCONCLUSIVE';
  return { summaries, regions, checks, partI, partII, overall, details };
}

/**
 * Position in a variant that corresponds to x in the reference: identity,
 * except for a height variant whose diffuser is geometrically scaled, where
 * x ≥ x_d0 maps to x_d0 + (x − x_d0)·s with s the ratio of ramp lengths.
 */
export function variantX(ref: { diffuser: [number, number] }, v: { diffuser: [number, number] }, variant: string | undefined, x: number): number {
  if (variant !== 'height') return x;
  const s = (v.diffuser[1] - v.diffuser[0]) / (ref.diffuser[1] - ref.diffuser[0]);
  return x <= ref.diffuser[0] ? x : ref.diffuser[0] + (x - ref.diffuser[0]) * s;
}

/** Two-sided 95 % half-width multiplier for n seeds. */
export const t95 = (n: number) => tTwoSidedCritical(0.05, n - 1);
export { coarsen };
