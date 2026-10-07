import { mean, tTwoSidedCritical } from '../measurements/Statistics';
import { ens, welchDf, type Stat } from './UB0Stage0';

/**
 * UB-0 decision rules (design review §6–§7, amendment A1 §2.4, §5).
 * Pure functions of per-seed estimates and frozen Universe A statistics; every
 * rule is exercised on synthetic data in tests/universeB.analysis.test.ts.
 *
 * Equivalence rule (design §6.1): PASS iff the CI lies inside the margin,
 * FAIL iff it lies entirely outside, INCONCLUSIVE otherwise.
 */
export type Outcome = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export function equivalence(ci: [number, number], margin: [number, number]): Outcome {
  if (!(Number.isFinite(ci[0]) && Number.isFinite(ci[1]))) return 'INCONCLUSIVE';
  if (ci[0] >= margin[0] && ci[1] <= margin[1]) return 'PASS';
  if (ci[1] < margin[0] || ci[0] > margin[1]) return 'FAIL';
  return 'INCONCLUSIVE';
}

export interface Interval {
  estimate: number;
  ci: [number, number];
  se: number;
  df: number;
}

/** CI of a Stat at a two-sided level (0.95; 0.975 after the single extension). */
export function statCI(s: Stat, level = 0.95): Interval {
  const t = tTwoSidedCritical(1 - level, s.df);
  return { estimate: s.value, ci: [s.value - t * s.se, s.value + t * s.se], se: s.se, df: s.df };
}

/** Ratio a/b with a CI on the log scale, Welch–Satterthwaite df from relative variances. */
export function ratioCI(a: Stat, b: Stat, level = 0.95): Interval {
  const ra = a.se / a.value;
  const rb = b.se / b.value;
  const se = Math.hypot(ra, rb);
  const df = welchDf([
    { c: 1 / a.value, s: a },
    { c: -1 / b.value, s: b },
  ]);
  const t = tTwoSidedCritical(1 - level, df);
  const r = a.value / b.value;
  return { estimate: r, ci: [r * Math.exp(-t * se), r * Math.exp(t * se)], se: r * se, df };
}

/** K = φ (Q̄(φ+) − Q̄(φ−)) / (φ+ − φ−) from per-seed Q at the two densities (design §11.3). */
export function centralDifference(qMinus: number[], qPlus: number[], phi = 0.2, dphi = 0.04): Stat {
  const a = ens(qMinus);
  const b = ens(qPlus);
  const c = phi / dphi;
  return {
    value: c * (b.value - a.value),
    se: c * Math.hypot(a.se, b.se),
    df: welchDf([
      { c, s: b },
      { c: -c, s: a },
    ]),
    n: a.n + b.n,
  };
}

// ───────────────────────── primaries ─────────────────────────

export interface PQResult {
  outcome: Outcome;
  interval: Interval;
  margin: [number, number];
}

const MARGIN10: [number, number] = [0.9, 1.1];

/** PQ1: ν_B/ν_A (Welch with the Universe A seeds). */
export function pq1(nuB: number[], nuA: Stat, level = 0.95): PQResult {
  const iv = ratioCI(ens(nuB), nuA, level);
  return { outcome: equivalence(iv.ci, MARGIN10), interval: iv, margin: MARGIN10 };
}

/** PQ2: K_B/K_T,A with the FULL Universe A SE in quadrature (A1 §5). */
export function pq2(KB: Stat, KA: Stat, level = 0.95): PQResult {
  const iv = ratioCI(KB, KA, level);
  return { outcome: equivalence(iv.ci, MARGIN10), interval: iv, margin: MARGIN10 };
}

export type PQ3Outcome = 'P-INC' | 'T-FAIL-high' | 'T-FAIL-low' | 'INCONCLUSIVE';

/**
 * PQ3: Γ_self = ρ c_B²/K_B(k), K_B(k) = K_kin + W̃(kh) K_occ, against the judged
 * interval (band from Δ_A's 95 % limits, ± 0.05; from the frozen G3 predictions).
 */
export function pq3(cB: Stat, KBk: Stat, rho: number, judged: [number, number], level = 0.95) {
  const G = (rho * cB.value * cB.value) / KBk.value;
  const rc = (2 * cB.se) / cB.value;
  const rk = KBk.se / KBk.value;
  const se = G * Math.hypot(rc, rk);
  const df = welchDf([
    { c: 2 / cB.value, s: cB },
    { c: -1 / KBk.value, s: KBk },
  ]);
  const t = tTwoSidedCritical(1 - level, df);
  const ci: [number, number] = [G - t * se, G + t * se];
  let outcome: PQ3Outcome = 'INCONCLUSIVE';
  if (ci[0] >= judged[0] && ci[1] <= judged[1]) outcome = 'P-INC';
  else if (ci[0] > judged[1]) outcome = 'T-FAIL-high';
  else if (ci[1] < judged[0]) outcome = 'T-FAIL-low';
  return { outcome, interval: { estimate: G, ci, se, df }, judged };
}

/** PQ4: T_kin/T_int ∈ [0.97, 1.03] and |a₂| ≤ 0.03 (both must PASS; either FAIL fails). */
export function pq4(ratio: number[], a2: number[], level = 0.95) {
  const r = statCI(ens(ratio), level);
  const a = statCI(ens(a2), level);
  const o1 = equivalence(r.ci, [0.97, 1.03]);
  const o2 = equivalence(a.ci, [-0.03, 0.03]);
  const outcome: Outcome = o1 === 'FAIL' || o2 === 'FAIL' ? 'FAIL' : o1 === 'PASS' && o2 === 'PASS' ? 'PASS' : 'INCONCLUSIVE';
  return { outcome, ratio: { outcome: o1, interval: r }, a2: { outcome: o2, interval: a } };
}

/**
 * RPA parcel structure factor: 1/S_p = 1/S_A(kD) + n_p k_s a W̃(kh)/kT (design §6.2 PQ5),
 * with S_A measured by Stage 0 at the same kD (matched box L/D).
 */
export function sRPA(SA: number, npKsA: number, What: number): number {
  return 1 / (1 / SA + npKsA * What);
}

/** PQ5: S_B/S_RPA at the two lowest shells; S_A's SE propagated (dS_RPA/dS_A = S_RPA²/S_A²). */
export function pq5(SB: number[][], SA: Stat[], npKsA: number, What: number[], level = 0.95) {
  const shells = [0, 1].map((i) => {
    const pred = sRPA(SA[i].value, npKsA, What[i]);
    const predSE = (pred * pred * SA[i].se) / (SA[i].value * SA[i].value);
    const iv = ratioCI(ens(SB[i]), { value: pred, se: predSE, df: SA[i].df, n: SA[i].n }, level);
    return { outcome: equivalence(iv.ci, MARGIN10), interval: iv, prediction: pred };
  });
  const outcome: Outcome = shells.some((s) => s.outcome === 'FAIL')
    ? 'FAIL'
    : shells.every((s) => s.outcome === 'PASS')
      ? 'PASS'
      : 'INCONCLUSIVE';
  return { outcome, shells };
}

/** PQ6a/PQ6b/PQ6c-ν style ratios between two Universe B arms. */
export function armRatio(a: number[], b: number[], margin: [number, number], level = 0.95): PQResult {
  const iv = ratioCI(ens(a), ens(b), level);
  return { outcome: equivalence(iv.ci, margin), interval: iv, margin };
}

/** PQ6c: ν(c_h = 4)/ν(c_h = 2) ∈ [0.93, 1.07] and K(c_h = 4)/K(c_h = 2) ∈ [0.90, 1.10]. */
export function pq6c(nuC4: number[], nuC2: number[], KC4: Stat, KC2: Stat, level = 0.95) {
  const nu = armRatio(nuC4, nuC2, [0.93, 1.07], level);
  const kiv = ratioCI(KC4, KC2, level);
  const K = { outcome: equivalence(kiv.ci, MARGIN10), interval: kiv, margin: MARGIN10 };
  const outcome: Outcome = nu.outcome === 'FAIL' || K.outcome === 'FAIL' ? 'FAIL' : nu.outcome === 'PASS' && K.outcome === 'PASS' ? 'PASS' : 'INCONCLUSIVE';
  return { outcome, nu, K };
}

/** PQ8: occupancy shear-stress share; PASS iff CI < 0.20, FAIL iff CI ≥ 0.20. */
export function pq8(shares: number[], level = 0.95) {
  const iv = statCI(ens(shares), level);
  const outcome: Outcome = iv.ci[1] < 0.2 ? 'PASS' : iv.ci[0] >= 0.2 ? 'FAIL' : 'INCONCLUSIVE';
  return { outcome, interval: iv };
}

export interface RunGate {
  id: string;
  momentumResidual: number;
  /** drift relative to the PQ7(b) reference: wave energy (waves) or total energy (static, wall, Couette) */
  drift: number;
  driftLimit: number;
  unexplainedLateContacts: number;
  halted: boolean;
}

/** PQ7: (a) momentum ≤ 1e-9, (b) drift ≤ its limit, (e) no unexplained late contacts; (c) drift ratio ≥ 2.5; (d) ν(dt/2)/ν(dt). */
export function pq7(gates: RunGate[], driftDt: number[], driftHalf: number[], nuDt: number[], nuHalf: number[], level = 0.95) {
  const violations = gates
    .map((g) => {
      const why: string[] = [];
      if (g.halted) why.push('halted');
      if (!(g.momentumResidual <= 1e-9)) why.push('momentum');
      if (!(g.drift <= g.driftLimit)) why.push('energy drift');
      if (g.unexplainedLateContacts > 0) why.push('unexplained late contacts');
      return { id: g.id, why };
    })
    .filter((v) => v.why.length);
  const ratio = mean(driftDt.map(Math.abs)) / mean(driftHalf.map(Math.abs));
  const c: Outcome = ratio >= 2.5 ? 'PASS' : 'FAIL';
  const d = armRatio(nuHalf, nuDt, [0.97, 1.03], level);
  return { violations, driftRatio: ratio, c, d };
}

// ───────────────────────── wall verdict (A1 §2.4) ─────────────────────────

export interface WallSeed {
  gw1: number;
  gw2: number;
  gw3: number;
  R: number;
}

export type WallVerdict = 'F5-impl' | 'F5-phys' | 'INCONCLUSIVE' | 'VOID';

export function wallConfig(seeds: WallSeed[], level = 0.95) {
  const g = (k: keyof WallSeed) => statCI(ens(seeds.map((s) => s[k])), level);
  const gates = {
    gw1: { interval: g('gw1'), outcome: equivalence(g('gw1').ci, [0.99, 1.01]) },
    gw2: { interval: g('gw2'), outcome: equivalence(g('gw2').ci, [0.97, 1.03]) },
    gw3: { interval: g('gw3'), outcome: equivalence(g('gw3').ci, [0.98, 1.02]) },
  };
  const R = { interval: g('R'), outcome: equivalence(g('R').ci, [0.9, 1.1]) };
  const gateFail = Object.values(gates).some((x) => x.outcome === 'FAIL');
  return { gates, R, gateFail };
}

/** Separate wall verdict: baseline N_c = 4 and 16 (c_h = 2) decide; the c_h = 4 arm is reported. */
export function wallVerdict(nc4: ReturnType<typeof wallConfig>, nc16: ReturnType<typeof wallConfig>): WallVerdict {
  if (nc4.gateFail || nc16.gateFail) return 'VOID';
  if (nc4.R.outcome === 'FAIL' || nc16.R.outcome === 'FAIL') return 'F5-phys';
  if (nc4.R.outcome === 'PASS' && nc16.R.outcome === 'PASS') return 'F5-impl';
  return 'INCONCLUSIVE';
}

// ───────────────────────── failure modes and the bulk verdict ─────────────────────────

export type NcKey = 4 | 16 | 64;

export interface BulkOutcomes {
  pq1: Record<NcKey, Outcome>;
  /** point estimates of ν_B/ν_A (for the F6 monotone-trend test) */
  pq1Estimate: Record<NcKey, number>;
  pq2: Record<NcKey, Outcome>;
  pq2Estimate: Record<NcKey, number>;
  /** PQ2 for the c_h = 4 arm at N_c = 4 */
  pq2ArmC4: Outcome;
  /** PQ1 for the c_h = 4 arm at N_c = 4 (ν_B(c_h 4)/ν_A) */
  pq1ArmC4: Outcome;
  pq3: Record<NcKey, PQ3Outcome>;
  pq4: Record<NcKey, Outcome>;
  pq5: Record<4 | 16, Outcome>;
  pq6a: Record<4 | 16, Outcome>;
  pq6b: Outcome;
  pq6c: Outcome;
  pq8: Record<NcKey, Outcome>;
  pq8Estimate: Record<NcKey, number>;
  /** PQ7: any run violation (a, b, e), (c) drift ratio, (d) dt arm */
  pq7Violations: number;
  pq7c: Outcome;
  pq7d: Outcome;
  /** > 10 % of a configuration's runs excluded */
  exclusionsOver10pct: boolean;
  /** SQ6/SQ13 flags at baseline: ψ₆ > 0.3, or an oscillatory ensemble-mean shear decay */
  orderingFlag: boolean;
}

export type FLabel = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F6' | 'T-FAIL';

const NCS: NcKey[] = [4, 16, 64];

/**
 * Design §7 triggers. Returns every triggered label, in the precedence order
 * F0 > F3 > F1 > F2 > T-FAIL > F4 > F6.
 *
 * Clarification (pre-registration, fixed before data): the design's F1/F2/F3
 * triggers say "at some N_c", which literally includes N_c = 64 and so overlaps
 * F6. Following design §6.4 (a monotone failure confined to 64 is a narrowing;
 * a non-monotone one is a FAIL), when the F6 condition holds the N_c = 64
 * failures it explains are labelled F6 only; F1/F2/F3 are then evaluated at N_c ≤ 16.
 */
export function failureLabels(o: BulkOutcomes): FLabel[] {
  const out = new Set<FLabel>();
  // F6 first: PASS at 4 and 16, FAIL at 64 in PQ1, PQ2 or PQ8, with a monotone trend
  const passLow = ([4, 16] as const).every((n) => o.pq1[n] === 'PASS' && o.pq2[n] === 'PASS' && o.pq8[n] === 'PASS');
  const failHigh = o.pq1[64] === 'FAIL' || o.pq2[64] === 'FAIL' || o.pq8[64] === 'FAIL';
  const mono = (v: Record<NcKey, number>, ref: number) => Math.abs(v[4] - ref) <= Math.abs(v[16] - ref) && Math.abs(v[16] - ref) <= Math.abs(v[64] - ref);
  const explained = (o.pq1[64] !== 'FAIL' || mono(o.pq1Estimate, 1)) && (o.pq2[64] !== 'FAIL' || mono(o.pq2Estimate, 1)) && (o.pq8[64] !== 'FAIL' || mono(o.pq8Estimate, 0));
  const f6 = passLow && failHigh && explained;
  const ncs: NcKey[] = f6 ? [4, 16] : NCS;
  if (o.pq7Violations > 0 || o.pq7c === 'FAIL' || o.pq7d === 'FAIL' || o.exclusionsOver10pct) out.add('F0');
  // F3: viscosity not emergent
  if (ncs.some((n) => o.pq8[n] === 'FAIL') || o.pq6b === 'FAIL' || ncs.some((n) => o.pq1[n] === 'FAIL' && o.pq8Estimate[n] >= 0.2)) out.add('F3');
  // F1: kinetic-level coarse-graining fails
  if (NCS.some((n) => o.pq4[n] === 'FAIL')) out.add('F1');
  if (ncs.some((n) => o.pq1[n] === 'FAIL' && o.pq8[n] === 'PASS' && o.pq6b !== 'FAIL' && o.pq6c === 'PASS')) out.add('F1');
  // F2: pressure closure fails
  if (o.pq2[4] === 'FAIL' && o.pq2ArmC4 === 'FAIL') out.add('F2');
  if (o.pq2[16] === 'FAIL' || (!f6 && o.pq2[64] === 'FAIL')) out.add('F2');
  if (([4, 16] as const).some((n) => o.pq5[n] === 'FAIL' && o.pq2[n] === 'PASS')) out.add('F2');
  if (NCS.some((n) => o.pq3[n] === 'T-FAIL-low')) out.add('F2');
  // T-FAIL: the sound theory refuted (high side; the low side is F2 above)
  if (NCS.some((n) => o.pq3[n] === 'T-FAIL-high')) out.add('T-FAIL');
  // F4: weak coupling fails at the baseline kernel
  if (o.pq6c === 'FAIL') out.add('F4');
  if ((o.pq1[4] === 'FAIL' && o.pq1ArmC4 === 'PASS') || (o.pq2[4] === 'FAIL' && o.pq2ArmC4 === 'PASS')) out.add('F4');
  if (o.orderingFlag) out.add('F4');
  if (f6) out.add('F6');
  const order: FLabel[] = ['F0', 'F3', 'F1', 'F2', 'T-FAIL', 'F4', 'F6'];
  return order.filter((l) => out.has(l));
}

export type BulkVerdict = 'PASS' | 'PASS-NARROW' | 'FAIL' | 'INCONCLUSIVE' | 'VOID';

/**
 * Design §6.4. PASS-NARROW is F6 alone (everything else passing at N_c ≤ 16).
 * A failure confined to N_c = 64 without the monotone trend is a FAIL.
 */
export function bulkVerdict(o: BulkOutcomes, labels = failureLabels(o)): BulkVerdict {
  if (labels.includes('F0')) return 'VOID';
  const all = (r: Record<number, Outcome>, ks: number[]) => ks.every((k) => r[k] === 'PASS');
  const low = [4, 16];
  const lowPass =
    all(o.pq1, low) && all(o.pq2, low) && all(o.pq4, low) && all(o.pq5, low) && all(o.pq6a, low) && all(o.pq8, low) &&
    o.pq6b === 'PASS' && o.pq6c === 'PASS' && low.every((n) => o.pq3[n as NcKey] === 'P-INC');
  const highPass = o.pq1[64] === 'PASS' && o.pq2[64] === 'PASS' && o.pq4[64] === 'PASS' && o.pq8[64] === 'PASS' && o.pq3[64] === 'P-INC';
  if (lowPass && highPass && labels.length === 0) return 'PASS';
  if (lowPass && labels.length === 1 && labels[0] === 'F6') return 'PASS-NARROW';
  if (labels.length > 0) return 'FAIL';
  const anyFail =
    NCS.some((n) => o.pq1[n] === 'FAIL' || o.pq2[n] === 'FAIL' || o.pq4[n] === 'FAIL' || o.pq8[n] === 'FAIL') ||
    ([4, 16] as const).some((n) => o.pq5[n] === 'FAIL' || o.pq6a[n] === 'FAIL');
  return anyFail ? 'FAIL' : 'INCONCLUSIVE';
}

export type OverallCategory = 'PASS' | 'PARTIAL PASS' | 'INCONCLUSIVE' | 'FAIL' | 'VOID';

/**
 * The reporting categories requested for UB-0, fixed before data. The F-labels
 * are always reported alongside and never collapsed.
 *   PASS          bulk verdict PASS
 *   PARTIAL PASS  some physics survives while a clearly isolated component fails:
 *                 PASS-NARROW (valid only for N_c ≤ 16), or failures confined to the
 *                 constitutive pressure closure (F2, T-FAIL) with H1 intact —
 *                 PQ1, PQ4, PQ8 PASS (at N_c ≤ 16, and at 64 unless F6) and PQ6a–c PASS
 *   FAIL          a core prediction falsified: F1, F3 or F4, or any H1 primary
 *                 (PQ1, PQ4, PQ6a–c, PQ8) FAILs
 *   INCONCLUSIVE  otherwise (including a constitutive failure while H1 is unresolved)
 *   VOID          F0
 * A pressure-closure failure is therefore never by itself a FAIL of the
 * coarse-graining; a viscosity-inheritance failure always is.
 */
export function overallCategory(o: BulkOutcomes, labels = failureLabels(o)): OverallCategory {
  const v = bulkVerdict(o, labels);
  if (v === 'VOID') return 'VOID';
  if (v === 'PASS') return 'PASS';
  if (v === 'PASS-NARROW') return 'PARTIAL PASS';
  if (labels.some((l) => l === 'F1' || l === 'F3' || l === 'F4')) return 'FAIL';
  const h1Fail =
    NCS.some((n) => o.pq1[n] === 'FAIL' || o.pq4[n] === 'FAIL' || o.pq8[n] === 'FAIL') ||
    ([4, 16] as const).some((n) => o.pq6a[n] === 'FAIL') ||
    o.pq6b === 'FAIL' ||
    o.pq6c === 'FAIL';
  const narrow = labels.includes('F6');
  const ncs: NcKey[] = narrow ? [4, 16] : NCS;
  if (h1Fail && !narrow) return 'FAIL';
  const h1Intact =
    ncs.every((n) => o.pq1[n] === 'PASS' && o.pq8[n] === 'PASS' && o.pq4[n] === 'PASS') &&
    ([4, 16] as const).every((n) => o.pq6a[n] === 'PASS') &&
    o.pq6b === 'PASS' &&
    o.pq6c === 'PASS';
  // what is left are failures of the constitutive pressure closure: F2, T-FAIL, or a
  // PQ2/PQ3/PQ5 failure that triggered no F-label (e.g. PQ2 at N_c = 4 with the c_h = 4 arm unresolved)
  const constitutive =
    labels.some((l) => l === 'F2' || l === 'T-FAIL') ||
    NCS.some((n) => o.pq2[n] === 'FAIL' || o.pq3[n] === 'T-FAIL-high' || o.pq3[n] === 'T-FAIL-low') ||
    ([4, 16] as const).some((n) => o.pq5[n] === 'FAIL');
  if (h1Intact && (constitutive || narrow)) return 'PARTIAL PASS';
  return 'INCONCLUSIVE';
}
