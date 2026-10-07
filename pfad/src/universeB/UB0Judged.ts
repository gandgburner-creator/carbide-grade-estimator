import { mean, std } from '../measurements/Statistics';
import {
  armRatio,
  bulkVerdict,
  centralDifference,
  failureLabels,
  overallCategory,
  pq1,
  pq2,
  pq3,
  pq4,
  pq5,
  pq6c,
  pq7,
  pq8,
  wallConfig,
  wallVerdict,
  type BulkOutcomes,
  type NcKey,
  type RunGate,
} from './UB0Analysis';
import type { ShearEstimate, SoundEstimate, StaticEstimate, WallEstimate } from './UB0Estimators';
import { ens, type Stat } from './UB0Stage0';

/**
 * From per-run estimates of the judged Universe B runs to the UB-0 outcomes
 * (design §6–§7; amendment A1). Group names are those of UB0Plans.ub0Groups.
 * Pure function; tested on synthetic estimates (tests/universeB.judged.test.ts).
 */
export interface StaticRun {
  est: StaticEstimate;
  /** finite-k weighted pressure (P_kin + P_coll)/T + W̃(k_L h) P_occ for PQ3 (k_L of the L = 160 D box) */
  qSound: number;
}

export interface JudgedInputs {
  level: Record<string, number>; // per primary key: 0.95, or 0.975 after the single extension
  /** Stage 0 (Universe A) statistics, molecular units */
  A: {
    nuL80: Stat;
    nuL160: Stat;
    /** K_T,A = n kT · K_T,A/(n kT) */
    KT: Stat;
    SA: Stat[];
  };
  /** frozen G3 predictions */
  P: {
    judgedGamma: Record<NcKey, [number, number]>;
    /** (N_c − 1) K_T,A/(n kT): the RPA occupancy strength n_p k_s a /kT */
    rpaStrength: Record<4 | 16, number>;
    /** W̃(kh) at the two lowest shells of the L = 80 D box */
    WhatShells: Record<4 | 16, [number, number]>;
    rho: number;
  };
  static: Record<string, StaticRun[]>;
  shear: Record<string, ShearEstimate[]>;
  sound: Record<string, SoundEstimate[]>;
  wall: Record<string, WallEstimate[]>;
  gates: RunGate[];
  /** ensemble-mean shear amplitude check per baseline group: true if oscillatory (mean U < −2 SE inside the window) */
  oscillatory: Record<string, boolean>;
  exclusionsOver10pct: boolean;
  /** primary keys forced INCONCLUSIVE by the run-halves rule (design §11.5.1), e.g. 'pq2.16' */
  inconclusive?: string[];
}

/** Primary keys of the bulk verdict, as used by `level`, `inconclusive` and the extension. */
export const PRIMARY_KEYS = [
  'pq1.4', 'pq1.16', 'pq1.64',
  'pq2.4', 'pq2.16', 'pq2.64',
  'pq3.4', 'pq3.16', 'pq3.64',
  'pq4.4', 'pq4.16', 'pq4.64',
  'pq5.4', 'pq5.16',
  'pq6a.4', 'pq6a.16', 'pq6b', 'pq6c', 'pq7d',
  'pq8.4', 'pq8.16', 'pq8.64',
  'pq1.arm', 'pq2.arm',
] as const;
export type PrimaryKey = (typeof PRIMARY_KEYS)[number];

/** Set one primary's outcome (and its point estimate where BulkOutcomes keeps one). */
export function setOutcome(o: BulkOutcomes, key: string, outcome: string, estimate?: number): void {
  const [name, sub] = key.split('.');
  const rec = o as unknown as Record<string, unknown>;
  if (name === 'pq1' && sub === 'arm') o.pq1ArmC4 = outcome as BulkOutcomes['pq1ArmC4'];
  else if (name === 'pq2' && sub === 'arm') o.pq2ArmC4 = outcome as BulkOutcomes['pq2ArmC4'];
  else if (sub === undefined) rec[name] = outcome;
  else (rec[name] as Record<string, string>)[sub] = outcome;
  if (estimate !== undefined && sub !== undefined && sub !== 'arm' && (name === 'pq1' || name === 'pq2' || name === 'pq8')) {
    (rec[`${name}Estimate`] as Record<string, number>)[sub] = estimate;
  }
}

export function getOutcome(o: BulkOutcomes, key: string): string {
  const [name, sub] = key.split('.');
  if (name === 'pq1' && sub === 'arm') return o.pq1ArmC4;
  if (name === 'pq2' && sub === 'arm') return o.pq2ArmC4;
  const v = (o as unknown as Record<string, unknown>)[name];
  return sub === undefined ? (v as string) : (v as Record<string, string>)[sub];
}

/** Labels and verdicts from (possibly merged) outcomes. */
export function finalize(o: BulkOutcomes) {
  const labels = failureLabels(o);
  return { labels, bulk: bulkVerdict(o, labels), overall: overallCategory(o, labels) };
}

const lv = (i: JudgedInputs, k: string) => i.level[k] ?? 0.95;

export interface Eligibility {
  estimate: number;
  inside: boolean;
}
const inside = (x: number, m: [number, number]) => x >= m[0] && x <= m[1];
const elig = (estimate: number, m: [number, number]): Eligibility => ({ estimate, inside: inside(estimate, m) });

function K(i: JudgedInputs, key: string, pick: (r: StaticRun) => number): Stat {
  return centralDifference(i.static[`${key}p18`].map(pick), i.static[`${key}p22`].map(pick));
}

export function judge(i: JudgedInputs) {
  const nuOf = (g: string) => i.shear[g].map((e) => e.nu_p);
  const NC: NcKey[] = [4, 16, 64];
  const skKey = (n: NcKey) => `SK${n}c2`;
  const tBase = (n: NcKey) => (n === 64 ? 'T64a1' : `T${n}a1`);
  const nuARef = (n: NcKey) => (n === 64 ? i.A.nuL160 : i.A.nuL80);
  const d: Record<string, unknown> = {};

  const r1 = Object.fromEntries(NC.map((n) => [n, pq1(nuOf(tBase(n)), nuARef(n), lv(i, `pq1.${n}`))])) as Record<NcKey, ReturnType<typeof pq1>>;
  const KB = Object.fromEntries(NC.map((n) => [n, K(i, skKey(n), (r) => r.est.Pnorm)])) as Record<NcKey, Stat>;
  const r2 = Object.fromEntries(NC.map((n) => [n, pq2(KB[n], i.A.KT, lv(i, `pq2.${n}`))])) as Record<NcKey, ReturnType<typeof pq2>>;
  const KBk = Object.fromEntries(NC.map((n) => [n, K(i, skKey(n), (r) => r.qSound)])) as Record<NcKey, Stat>;
  const cB = Object.fromEntries(NC.map((n) => [n, ens(i.sound[`L${n}`].map((e) => e.c))])) as Record<NcKey, Stat>;
  const r3 = Object.fromEntries(NC.map((n) => [n, pq3(cB[n], KBk[n], i.P.rho, i.P.judgedGamma[n], lv(i, `pq3.${n}`))])) as Record<NcKey, ReturnType<typeof pq3>>;
  const eqRuns = (n: NcKey) => [...i.static[`${skKey(n)}p20`].map((r) => r.est), ...(n === 64 ? [] : (i.static[`SL${n}`] ?? []).map((r) => r.est))];
  const r4 = Object.fromEntries(
    NC.map((n) => [n, pq4(eqRuns(n).map((e) => e.TkinOverTint), eqRuns(n).map((e) => e.a2), lv(i, `pq4.${n}`))]),
  ) as Record<NcKey, ReturnType<typeof pq4>>;
  const r5 = Object.fromEntries(
    ([4, 16] as const).map((n) => {
      const sl = i.static[`SL${n}`].map((r) => r.est);
      return [n, pq5([sl.map((e) => e.S[0]), sl.map((e) => e.S[1])], i.A.SA, i.P.rpaStrength[n], i.P.WhatShells[n], lv(i, `pq5.${n}`))];
    }),
  ) as Record<4 | 16, ReturnType<typeof pq5>>;
  const r6a = Object.fromEntries(([4, 16] as const).map((n) => [n, armRatio(nuOf(`T${n}a1`), nuOf(`T${n}a05`), [0.95, 1.05], lv(i, `pq6a.${n}`))])) as Record<
    4 | 16,
    ReturnType<typeof armRatio>
  >;
  const r6b = armRatio(nuOf('T16e08'), nuOf('T16e095'), [0.95, 1.05], lv(i, 'pq6b'));
  const KC4 = K(i, 'SK4c4', (r) => r.est.Pnorm);
  const r6c = pq6c(nuOf('T4c4'), nuOf('T4a1'), KC4, KB[4], lv(i, 'pq6c'));
  const arm1 = pq1(nuOf('T4c4'), i.A.nuL80, lv(i, 'pq1.arm'));
  const arm2 = pq2(KC4, i.A.KT, lv(i, 'pq2.arm'));
  const r7 = pq7(
    i.gates,
    i.shear.T16a1.map((e) => e.driftOverWave),
    i.shear.T16dt.map((e) => e.driftOverWave),
    nuOf('T16a1'),
    nuOf('T16dt'),
    lv(i, 'pq7d'),
  );
  const r8 = Object.fromEntries(NC.map((n) => [n, pq8(i.shear[tBase(n)].map((e) => e.occShare), lv(i, `pq8.${n}`))])) as Record<NcKey, ReturnType<typeof pq8>>;
  const psi6 = ([4, 16] as const).map((n) => mean((i.static[`SL${n}`] ?? []).map((r) => r.est.psi6 ?? 0)));
  const ordering = psi6.some((p) => p > 0.3) || ['T4a1', 'T16a1', 'T64a1'].some((g) => i.oscillatory[g]);

  const o: BulkOutcomes = {
    pq1: { 4: r1[4].outcome, 16: r1[16].outcome, 64: r1[64].outcome },
    pq1Estimate: { 4: r1[4].interval.estimate, 16: r1[16].interval.estimate, 64: r1[64].interval.estimate },
    pq2: { 4: r2[4].outcome, 16: r2[16].outcome, 64: r2[64].outcome },
    pq2Estimate: { 4: r2[4].interval.estimate, 16: r2[16].interval.estimate, 64: r2[64].interval.estimate },
    pq2ArmC4: arm2.outcome,
    pq1ArmC4: arm1.outcome,
    pq3: { 4: r3[4].outcome, 16: r3[16].outcome, 64: r3[64].outcome },
    pq4: { 4: r4[4].outcome, 16: r4[16].outcome, 64: r4[64].outcome },
    pq5: { 4: r5[4].outcome, 16: r5[16].outcome },
    pq6a: { 4: r6a[4].outcome, 16: r6a[16].outcome },
    pq6b: r6b.outcome,
    pq6c: r6c.outcome,
    pq8: { 4: r8[4].outcome, 16: r8[16].outcome, 64: r8[64].outcome },
    pq8Estimate: { 4: r8[4].interval.estimate, 16: r8[16].interval.estimate, 64: r8[64].interval.estimate },
    pq7Violations: r7.violations.length,
    pq7c: r7.c,
    pq7d: r7.d.outcome,
    exclusionsOver10pct: i.exclusionsOver10pct,
    orderingFlag: ordering,
  };
  for (const key of i.inconclusive ?? []) setOutcome(o, key, 'INCONCLUSIVE');
  const fin = finalize(o);
  const wallCfg = (g: string) => wallConfig(i.wall[g].map((e) => ({ gw1: e.gw1, gw2: e.gw2, gw3: e.gw3, R: e.R })), lv(i, `wall.${g}`));
  const w4 = wallCfg('W4c2');
  const w16 = wallCfg('W16c2');
  const wArm = wallCfg('W4c4');
  Object.assign(d, { r1, r2, KB, KBk, cB, r3, r4, r5, r6a, r6b, r6c, arm1, arm2, r7, r8, psi6 });
  const primaries: Record<string, Eligibility> = {};
  for (const n of NC) {
    primaries[`pq1.${n}`] = elig(r1[n].interval.estimate, r1[n].margin);
    primaries[`pq2.${n}`] = elig(r2[n].interval.estimate, r2[n].margin);
    primaries[`pq3.${n}`] = elig(r3[n].interval.estimate, [r3[n].judged[0], r3[n].judged[1]]);
    primaries[`pq4.${n}`] = { estimate: r4[n].ratio.interval.estimate, inside: inside(r4[n].ratio.interval.estimate, [0.97, 1.03]) && inside(r4[n].a2.interval.estimate, [-0.03, 0.03]) };
    primaries[`pq8.${n}`] = { estimate: r8[n].interval.estimate, inside: r8[n].interval.estimate < 0.2 };
  }
  for (const n of [4, 16] as const) {
    primaries[`pq5.${n}`] = { estimate: r5[n].shells[0].interval.estimate, inside: r5[n].shells.every((s) => inside(s.interval.estimate, [0.9, 1.1])) };
    primaries[`pq6a.${n}`] = elig(r6a[n].interval.estimate, r6a[n].margin);
  }
  primaries.pq6b = elig(r6b.interval.estimate, r6b.margin);
  primaries.pq6c = { estimate: r6c.nu.interval.estimate, inside: inside(r6c.nu.interval.estimate, r6c.nu.margin) && inside(r6c.K.interval.estimate, r6c.K.margin) };
  primaries.pq7d = elig(r7.d.interval.estimate, r7.d.margin);
  primaries['pq1.arm'] = elig(arm1.interval.estimate, arm1.margin);
  primaries['pq2.arm'] = elig(arm2.interval.estimate, arm2.margin);
  return {
    outcomes: o,
    ...fin,
    /** per primary: point estimate and whether it lies inside the margin (extension eligibility, §11.7) */
    primaries,
    wall: { verdict: wallVerdict(w4, w16), W4c2: w4, W16c2: w16, W4c4: wArm },
    details: d,
  };
}

/**
 * Oscillation check for SQ13/F4 (fixed before data): the ensemble mean of the
 * shear amplitude U(t), sampled on the common grid, is oscillatory if it falls
 * below −2 standard errors anywhere inside the fit window.
 */
export function oscillatoryEnsemble(series: { t: number[]; U: number[] }[], window: [number, number]): boolean {
  if (series.length < 2) return false;
  const n = Math.min(...series.map((s) => s.t.length));
  for (let k = 0; k < n; k++) {
    const t = series[0].t[k];
    if (t < window[0] || t > window[1]) continue;
    const v = series.map((s) => s.U[k]);
    const m = mean(v);
    const se = std(v) / Math.sqrt(v.length);
    if (m < -2 * se) return true;
  }
  return false;
}
