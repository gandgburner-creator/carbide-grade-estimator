import { Rng } from '../core/Random';
import { normalCdf, tTwoSidedCritical } from '../measurements/Statistics';
import { DESIGN_COUNTS, type GroupDef } from './UB0Plans';
import type { Stat } from './UB0Stage0';

/**
 * The pre-registered power design of UB-0 (amendment A2, D3).
 *
 * Every seed count is computed here from UNIVERSE A per-seed scatter (Stage 0, pooled
 * with Stage 0b for the final plan). No Universe B result of any kind enters.
 *
 *   noise basis   per-seed SD of the Universe A estimator that the Universe B primary
 *                 uses (same estimator code, same box in its own units), pooled within
 *                 Courant cells: s² = Σ(n_i − 1)s_i² / Σ(n_i − 1), df = Σ(n_i − 1)
 *   uncertainty   the SD is itself estimated: the plan uses its one-sided 80 % upper
 *                 confidence bound s·√(df/χ²₀.₂₀(df)) (Wilson–Hilferty quantile)
 *   target        expected 95 % CI half-width ≤ f × margin half-width (log scale for
 *                 ratios): f = ⅓ for PQ1 and PQ2 (design §11.2), ½ for PQ3, PQ5, PQ6a–c
 *                 and the wall gates (A2 §3.2)
 *   n             the smallest integer meeting the target, t iterated with its
 *                 Welch–Satterthwaite df; never below the design count (DESIGN_COUNTS)
 *   false PASS    the CI-inside-margin rule is a two one-sided test at 2.5 % per side for
 *                 every n; the single extension (97.5 %) adds at most 1.25 % per side
 *                 (`falsePassMC` checks both by simulation)
 */

export type NcKey = 4 | 16 | 64;
const Z20 = -0.8416212335729143; // Φ⁻¹(0.20)

/** Wilson–Hilferty approximation to the χ² quantile with k df at standard-normal quantile z. */
export function chi2Quantile(z: number, k: number): number {
  const a = 2 / (9 * k);
  return k * (1 - a + z * Math.sqrt(a)) ** 3;
}

/** One-sided 80 % upper confidence factor for an SD estimated with `df` degrees of freedom. */
export function planningFactor(df: number): number {
  return Math.sqrt(df / chi2Quantile(Z20, df));
}

/** Two-sided 95 % interval for σ given s with df (Wilson–Hilferty), as factors of s. */
export function sdInterval95(df: number): [number, number] {
  return [Math.sqrt(df / chi2Quantile(1.959963984540054, df)), Math.sqrt(df / chi2Quantile(-1.959963984540054, df))];
}

export interface NoiseCell {
  label: string;
  values: number[];
}

export interface NoiseEstimate {
  /** per-seed SD; relative (to each cell's mean) when `relative` */
  sd: number;
  df: number;
  relative: boolean;
  source: string;
  cells: { label: string; n: number; mean: number; sd: number }[];
}

/** Pooled within-cell SD (relative to each cell's mean if `relative`). */
export function pooledSD(cells: NoiseCell[], relative: boolean, source: string): NoiseEstimate {
  let ss = 0;
  let df = 0;
  const out: NoiseEstimate['cells'] = [];
  for (const c of cells) {
    const v = c.values.filter(Number.isFinite);
    if (v.length < 2) continue;
    const m = v.reduce((a, x) => a + x, 0) / v.length;
    const s2 = v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1);
    const r2 = relative ? s2 / (m * m) : s2;
    ss += (v.length - 1) * r2;
    df += v.length - 1;
    out.push({ label: c.label, n: v.length, mean: m, sd: Math.sqrt(s2) });
  }
  if (!df) throw new Error(`no usable cells for ${source}`);
  return { sd: Math.sqrt(ss / df), df, relative, source, cells: out };
}

export function planningSD(e: NoiseEstimate): number {
  return e.sd * planningFactor(e.df);
}

// ───────────────────────── seed-count formulas ─────────────────────────

const t95 = (df: number) => tTwoSidedCritical(0.05, Math.max(1, df));

/** Welch df of Σ variance terms v_i with df_i. */
function welch(terms: { v: number; df: number }[]): number {
  const num = terms.reduce((a, x) => a + x.v, 0) ** 2;
  const den = terms.reduce((a, x) => a + (x.df > 0 && Number.isFinite(x.df) ? (x.v * x.v) / x.df : 0), 0);
  return den > 0 ? num / den : Number.POSITIVE_INFINITY;
}

export interface Requirement {
  n: number;
  feasible: boolean;
  halfWidth: number;
  df: number;
}

/**
 * The smallest integer n ≥ 4 with halfWidthAt(n) ≤ target, for a half-width that falls
 * with n (exponential search, then bisection). Infinity if not met by n = 10⁶.
 */
function smallestN(halfWidthAt: (n: number) => number, target: number): number {
  let hi = 4;
  while (halfWidthAt(hi) > target) {
    hi *= 2;
    if (hi > 1e6) return Number.POSITIVE_INFINITY;
  }
  let lo = Math.max(3, hi / 2);
  if (hi === 4) return 4;
  // halfWidthAt(lo) > target ≥ halfWidthAt(hi)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (halfWidthAt(mid) <= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * One Universe B group of n seeds (per-seed SD s) against a fixed variance F with dfF
 * (the frozen Universe A term, or a partner group already sized):
 *   t(df)·√(s²/n + F) ≤ target, df by Welch–Satterthwaite (≈ s²/((target/t)² − F) seeds).
 * `mult` multiplies the B term (4 for Γ ∝ c², i.e. var(2 ln c)).
 */
export function nAgainstFixed(s: number, target: number, F = 0, dfF = Number.POSITIVE_INFINITY, mult = 1): Requirement {
  const terms = (n: number) => [
    { v: (mult * s * s) / n, df: n - 1 },
    { v: F, df: dfF },
  ];
  const hw = (n: number) => halfWidth(terms(n));
  const n = smallestN(hw, target);
  if (!Number.isFinite(n)) return { n, feasible: false, halfWidth: Number.NaN, df: Number.NaN };
  return { n, feasible: true, halfWidth: hw(n), df: welch(terms(n)) };
}

/** Two Universe B arms with n₂ = r·n₁: the smallest n₁ with t·√(s₁²/n₁ + s₂²/(r n₁)) ≤ target (≈ (s₁² + s₂²/r)(t/target)²). */
export function nTwoArm(s1: number, s2: number, r: number, target: number): number {
  return smallestN(
    (n1) =>
      halfWidth([
        { v: (s1 * s1) / n1, df: n1 - 1 },
        { v: (s2 * s2) / (r * n1), df: r * n1 - 1 },
      ]),
    target,
  );
}

/** Expected 95 % half-width of a two-group comparison (or one group against a fixed term). */
export function halfWidth(terms: { v: number; df: number }[]): number {
  return t95(welch(terms)) * Math.sqrt(terms.reduce((a, x) => a + x.v, 0));
}

/**
 * Approximate operating characteristics of the equivalence rule for a log-ratio with
 * standard error se and CI half-width h = t·se, margin [1 − m, 1 + m]:
 *   P(PASS | true ratio ρ) = Φ((ln(1+m) − h − ln ρ)/se) − Φ((ln(1−m) + h − ln ρ)/se).
 */
export function passProbability(h: number, se: number, m: number, rho = 1): number {
  const up = Math.log(1 + m) - h - Math.log(rho);
  const lo = Math.log(1 - m) + h - Math.log(rho);
  return up > lo ? Math.max(0, normalCdf(up / se) - normalCdf(lo / se)) : 0;
}

export function failProbability(h: number, se: number, m: number, rho: number): number {
  // FAIL: CI entirely outside the margin
  return normalCdf((Math.log(1 - m) - h - Math.log(rho)) / se) + 1 - normalCdf((Math.log(1 + m) + h - Math.log(rho)) / se);
}

// ───────────────────────── the plan ─────────────────────────

export interface PowerInputs {
  status: 'provisional' | 'final';
  /** where the Universe A numbers come from (commits, files) */
  basis: Record<string, string>;
  noise: {
    /** ν per seed, L 80 d, U₀ = c_th (relative) */
    nuL80a1: NoiseEstimate;
    /** ν per seed, L 80 d, U₀ = c_th/2 (relative) */
    nuL80a05: NoiseEstimate;
    /** ν per seed, L 160 d, U₀ = c_th (relative) */
    nuL160a1: NoiseEstimate;
    /** c per seed at the selected standing-wave amplitude, L 160 d (relative) */
    c: NoiseEstimate;
    /** S per seed at the two lowest shells, L 80 d (relative) */
    S1: NoiseEstimate;
    S2: NoiseEstimate;
    /** temperature-normalised pressure per seed at φ = 0.18 and 0.22 (absolute, molecular units) */
    P18: NoiseEstimate;
    P22: NoiseEstimate;
    /** Universe A wall gates per seed (absolute ≈ relative; the identities are 1) */
    gw1: NoiseEstimate;
    gw2: NoiseEstimate;
    gw3: NoiseEstimate;
  };
  /** frozen Universe A references that enter a judged CI (matched per N_c) */
  refs: { nu: Record<NcKey, Stat>; KT: Stat; SA: Record<4 | 16, Stat[]> };
  judgedGamma: Record<NcKey, [number, number]>;
  rpaStrength: Record<4 | 16, number>;
  WhatShells: Record<4 | 16, [number, number]>;
}

export const TARGETS = { pq1: 1 / 3, pq2: 1 / 3, pq3: 1 / 2, pq5: 1 / 2, pq6a: 1 / 2, pq6b: 1 / 2, pq6c: 1 / 2, wall: 1 / 2 } as const;
export const MARGINS = { pq1: 0.1, pq2: 0.1, pq5: 0.1, pq6a: 0.05, pq6b: 0.05, pq6cNu: 0.07, pq6cK: 0.1, pq7d: 0.03 } as const;
export const WALL_TOLERANCES = { gw1: 0.01, gw2: 0.03, gw3: 0.02 } as const;
/** ratio of the PQ6a arms, n(σ_v/2) / n(σ_v): the design's 96 : 48 (≈ the optimum s₂/s₁ ≈ 2) */
export const PQ6A_RATIO = 2;
const PHI_OVER_DPHI = 0.2 / 0.04;

export interface PrimaryPower {
  key: string;
  statistic: string;
  groups: string[];
  noise: string[];
  /** planning SD(s) used */
  sPlan: number[];
  /** fixed variance from the frozen Universe A reference (relative², log scale) */
  F: number;
  margin: string;
  targetFraction: number | null;
  targetHalfWidth: number | null;
  required: Record<string, number>;
  /** at the final counts, with the planning SD and with the point SD */
  halfWidthPlan: number;
  halfWidthPoint: number;
  /** operating characteristics at the final counts (planning SD); ratio primaries only */
  pPassIfExact?: number;
  pPassIfThirdMargin?: number;
  pFailIfTwiceMargin?: number;
  note?: string;
}

export interface PowerPlan {
  status: 'provisional' | 'final';
  basis: Record<string, string>;
  noise: Record<string, NoiseEstimate & { planningFactor: number; sdPlan: number; sd95: [number, number] }>;
  primaries: PrimaryPower[];
  /** final planned seeds per judged group, and which primaries set them */
  groups: Record<string, { n: number; design: number; setBy: string[] }>;
  notPowered: { key: string; reason: string }[];
}

export function powerPlan(inp: PowerInputs): PowerPlan {
  const N = inp.noise;
  const sp = (e: NoiseEstimate) => planningSD(e);
  const rel2 = (s: Stat) => (s.se / s.value) ** 2;
  const groups: Record<string, { n: number; design: number; setBy: string[] }> = {};
  for (const [g, d] of Object.entries(DESIGN_COUNTS)) groups[g] = { n: d, design: d, setBy: ['design count (floor)'] };
  const need = (g: string, n: number, by: string) => {
    if (!Number.isFinite(n)) throw new Error(`${by}: target not reachable for ${g} (the Universe A reference term alone exceeds it) — review`);
    if (n > groups[g].n) groups[g] = { ...groups[g], n, setBy: [by] };
    else if (n === groups[g].n && !groups[g].setBy.includes(by)) groups[g].setBy.push(by);
  };
  const prim: PrimaryPower[] = [];
  const lnm = (m: number) => Math.log(1 + m);
  const op = (h: number, se: number, m: number) => ({
    pPassIfExact: passProbability(h, se, m, 1),
    pPassIfThirdMargin: passProbability(h, se, m, 1 + m / 3),
    pFailIfTwiceMargin: failProbability(h, se, m, 1 + 2 * m),
  });

  // ── PQ2 and PQ6c-K (static boxes): K = (φ/Δφ)(P̄₂₂ − P̄₁₈), relative to K ≈ K_T,A
  const KTabs = inp.refs.KT.value;
  const sP18 = sp(N.P18);
  const sP22 = sp(N.P22);
  const relK2 = (n: number) => (PHI_OVER_DPHI ** 2 * (sP18 * sP18 + sP22 * sP22)) / n / (KTabs * KTabs);
  const relK2point = (n: number) => (PHI_OVER_DPHI ** 2 * (N.P18.sd ** 2 + N.P22.sd ** 2)) / n / (KTabs * KTabs);
  for (const nc of [4, 16, 64] as const) {
    const target = TARGETS.pq2 * lnm(MARGINS.pq2);
    const sEff = (PHI_OVER_DPHI * Math.hypot(sP18, sP22)) / KTabs;
    const r = nAgainstFixed(sEff, target, rel2(inp.refs.KT), inp.refs.KT.df);
    need(`SK${nc}c2p18`, r.n, `pq2.${nc}`);
    need(`SK${nc}c2p22`, r.n, `pq2.${nc}`);
  }
  {
    const target = TARGETS.pq6c * lnm(MARGINS.pq6cK);
    const sEff = (PHI_OVER_DPHI * Math.hypot(sP18, sP22)) / KTabs;
    const n1 = nTwoArm(sEff, sEff, 1, target);
    for (const g of ['SK4c4p18', 'SK4c4p22', 'SK4c2p18', 'SK4c2p22']) need(g, n1, 'pq6c (K)');
  }
  for (const nc of [4, 16, 64] as const) {
    const n = groups[`SK${nc}c2p18`].n;
    const v = relK2(n);
    const h = halfWidth([{ v, df: 2 * n - 2 }, { v: rel2(inp.refs.KT), df: inp.refs.KT.df }]);
    const hp = halfWidth([{ v: relK2point(n), df: 2 * n - 2 }, { v: rel2(inp.refs.KT), df: inp.refs.KT.df }]);
    prim.push({
      key: `pq2.${nc}`,
      statistic: 'K_B/K_T,A',
      groups: [`SK${nc}c2p18`, `SK${nc}c2p22`],
      noise: ['P18', 'P22'],
      sPlan: [sP18, sP22],
      F: rel2(inp.refs.KT),
      margin: '[0.90, 1.10]',
      targetFraction: TARGETS.pq2,
      targetHalfWidth: TARGETS.pq2 * lnm(MARGINS.pq2),
      required: { [`SK${nc}c2p18`]: n, [`SK${nc}c2p22`]: n },
      halfWidthPlan: h,
      halfWidthPoint: hp,
      ...op(h, Math.sqrt(v + rel2(inp.refs.KT)), MARGINS.pq2),
    });
  }

  // ── PQ1 and PQ6a: T{4,16}a1 against ν_A, T{4,16}a1 against T{4,16}a05
  const s1 = sp(N.nuL80a1);
  const s05 = sp(N.nuL80a05);
  for (const nc of [4, 16] as const) {
    const ref = inp.refs.nu[nc];
    const r1 = nAgainstFixed(s1, TARGETS.pq1 * lnm(MARGINS.pq1), rel2(ref), ref.df);
    need(`T${nc}a1`, r1.n, `pq1.${nc}`);
    need(`T${nc}a1`, nTwoArm(s1, s05, PQ6A_RATIO, TARGETS.pq6a * lnm(MARGINS.pq6a)), `pq6a.${nc}`);
  }
  for (const nc of [4, 16] as const) {
    const na1 = groups[`T${nc}a1`].n;
    const r = nAgainstFixed(s05, TARGETS.pq6a * lnm(MARGINS.pq6a), (s1 * s1) / na1, na1 - 1);
    need(`T${nc}a05`, r.n, `pq6a.${nc}`);
  }
  // ── PQ6b: T16e08 against T16e095 (equal arms)
  {
    const n1 = nTwoArm(s1, s1, 1, TARGETS.pq6b * lnm(MARGINS.pq6b));
    need('T16e08', n1, 'pq6b');
    need('T16e095', n1, 'pq6b');
  }
  // ── PQ6c-ν: T4c4 against T4a1 (T4a1 already sized)
  {
    const na1 = groups.T4a1.n;
    const r = nAgainstFixed(s1, TARGETS.pq6c * lnm(MARGINS.pq6cNu), (s1 * s1) / na1, na1 - 1);
    need('T4c4', r.n, 'pq6c (ν)');
  }
  // ── PQ1.64: T64a1 against ν_A at L 160 d
  const s160 = sp(N.nuL160a1);
  {
    const ref = inp.refs.nu[64];
    need('T64a1', nAgainstFixed(s160, TARGETS.pq1 * lnm(MARGINS.pq1), rel2(ref), ref.df).n, 'pq1.64');
  }
  for (const nc of [4, 16, 64] as const) {
    const g = nc === 64 ? 'T64a1' : `T${nc}a1`;
    const s = nc === 64 ? s160 : s1;
    const sPoint = nc === 64 ? N.nuL160a1.sd : N.nuL80a1.sd;
    const ref = inp.refs.nu[nc];
    const n = groups[g].n;
    const h = halfWidth([{ v: (s * s) / n, df: n - 1 }, { v: rel2(ref), df: ref.df }]);
    prim.push({
      key: `pq1.${nc}`,
      statistic: 'ν_B/ν_A',
      groups: [g],
      noise: [nc === 64 ? 'nuL160a1' : 'nuL80a1'],
      sPlan: [s],
      F: rel2(ref),
      margin: '[0.90, 1.10]',
      targetFraction: TARGETS.pq1,
      targetHalfWidth: TARGETS.pq1 * lnm(MARGINS.pq1),
      required: { [g]: n },
      halfWidthPlan: h,
      halfWidthPoint: halfWidth([{ v: (sPoint * sPoint) / n, df: n - 1 }, { v: rel2(ref), df: ref.df }]),
      ...op(h, Math.sqrt((s * s) / n + rel2(ref)), MARGINS.pq1),
    });
  }
  const twoArm = (key: string, a: string, b: string, sa: number, sb: number, pa: number, pb: number, m: number, f: number, noise: string[], stat: string) => {
    const na = groups[a].n;
    const nb = groups[b].n;
    const h = halfWidth([{ v: (sa * sa) / na, df: na - 1 }, { v: (sb * sb) / nb, df: nb - 1 }]);
    prim.push({
      key,
      statistic: stat,
      groups: [a, b],
      noise,
      sPlan: [sa, sb],
      F: 0,
      margin: `[${(1 - m).toFixed(2)}, ${(1 + m).toFixed(2)}]`,
      targetFraction: f,
      targetHalfWidth: f * lnm(m),
      required: { [a]: na, [b]: nb },
      halfWidthPlan: h,
      halfWidthPoint: halfWidth([{ v: (pa * pa) / na, df: na - 1 }, { v: (pb * pb) / nb, df: nb - 1 }]),
      ...op(h, Math.sqrt((sa * sa) / na + (sb * sb) / nb), m),
    });
  };
  for (const nc of [4, 16] as const)
    twoArm(`pq6a.${nc}`, `T${nc}a1`, `T${nc}a05`, s1, s05, N.nuL80a1.sd, N.nuL80a05.sd, MARGINS.pq6a, TARGETS.pq6a, ['nuL80a1', 'nuL80a05'], 'ν(σ_v)/ν(σ_v/2)');
  twoArm('pq6b', 'T16e08', 'T16e095', s1, s1, N.nuL80a1.sd, N.nuL80a1.sd, MARGINS.pq6b, TARGETS.pq6b, ['nuL80a1'], 'ν(e 0.8)/ν(e 0.95)');
  twoArm('pq6c.nu', 'T4c4', 'T4a1', s1, s1, N.nuL80a1.sd, N.nuL80a1.sd, MARGINS.pq6cNu, TARGETS.pq6c, ['nuL80a1'], 'ν(c_h 4)/ν(c_h 2)');
  {
    const n4 = groups.SK4c4p18.n;
    const n2 = groups.SK4c2p18.n;
    const h = halfWidth([{ v: relK2(n4), df: 2 * n4 - 2 }, { v: relK2(n2), df: 2 * n2 - 2 }]);
    prim.push({
      key: 'pq6c.K',
      statistic: 'K(c_h 4)/K(c_h 2)',
      groups: ['SK4c4p18', 'SK4c4p22', 'SK4c2p18', 'SK4c2p22'],
      noise: ['P18', 'P22'],
      sPlan: [sP18, sP22],
      F: 0,
      margin: '[0.90, 1.10]',
      targetFraction: TARGETS.pq6c,
      targetHalfWidth: TARGETS.pq6c * lnm(MARGINS.pq6cK),
      required: { SK4c4p18: n4, SK4c2p18: n2 },
      halfWidthPlan: h,
      halfWidthPoint: halfWidth([{ v: relK2point(n4), df: 2 * n4 - 2 }, { v: relK2point(n2), df: 2 * n2 - 2 }]),
      ...op(h, Math.sqrt(relK2(n4) + relK2(n2)), MARGINS.pq6cK),
    });
  }
  // ── PQ7d: the dt arm keeps the design's count; its INCONCLUSIVE is a numerical caveat (design §11.2)
  {
    const na = groups.T4a1.n;
    const nd = groups.T4dt.n;
    const h = halfWidth([{ v: (s1 * s1) / nd, df: nd - 1 }, { v: (s1 * s1) / na, df: na - 1 }]);
    prim.push({
      key: 'pq7d',
      statistic: 'ν(dt/2)/ν(dt)',
      groups: ['T4dt', 'T4a1'],
      noise: ['nuL80a1'],
      sPlan: [s1, s1],
      F: 0,
      margin: '[0.97, 1.03]',
      targetFraction: null,
      targetHalfWidth: null,
      required: { T4dt: nd },
      halfWidthPlan: h,
      halfWidthPoint: halfWidth([{ v: N.nuL80a1.sd ** 2 / nd, df: nd - 1 }, { v: N.nuL80a1.sd ** 2 / na, df: na - 1 }]),
      pFailIfTwiceMargin: failProbability(h, Math.sqrt((s1 * s1) / nd + (s1 * s1) / na), MARGINS.pq7d, 1 + 2 * MARGINS.pq7d),
      note: 'not powered (design §11.2): a FAIL voids (F0), an INCONCLUSIVE is a numerical caveat; design count kept',
    });
  }

  // ── PQ5: S_B/S_RPA at the two lowest shells; the S_A term enters scaled by S_RPA/S_A
  for (const nc of [4, 16] as const) {
    const req: Record<string, number> = {};
    const Fs: number[] = [];
    for (const i of [0, 1]) {
      const SA = inp.refs.SA[nc][i];
      const sRPA = 1 / (1 / SA.value + inp.rpaStrength[nc] * inp.WhatShells[nc][i]);
      const F = (sRPA / SA.value) ** 2 * rel2(SA);
      Fs.push(F);
      const s = sp(i === 0 ? N.S1 : N.S2);
      const r = nAgainstFixed(s, TARGETS.pq5 * lnm(MARGINS.pq5), F, SA.df);
      req[`shell${i + 1}`] = r.n;
      need(`SL${nc}`, r.n, `pq5.${nc}`);
    }
    const n = groups[`SL${nc}`].n;
    const hs = [0, 1].map((i) => halfWidth([{ v: sp(i === 0 ? N.S1 : N.S2) ** 2 / n, df: n - 1 }, { v: Fs[i], df: inp.refs.SA[nc][i].df }]));
    const hp = [0, 1].map((i) => halfWidth([{ v: (i === 0 ? N.S1 : N.S2).sd ** 2 / n, df: n - 1 }, { v: Fs[i], df: inp.refs.SA[nc][i].df }]));
    const se1 = Math.sqrt(sp(N.S1) ** 2 / n + Fs[0]);
    prim.push({
      key: `pq5.${nc}`,
      statistic: 'S_B/S_RPA, shells 1 and 2',
      groups: [`SL${nc}`],
      noise: ['S1', 'S2'],
      sPlan: [sp(N.S1), sp(N.S2)],
      F: Fs[0],
      margin: '[0.90, 1.10] each shell',
      targetFraction: TARGETS.pq5,
      targetHalfWidth: TARGETS.pq5 * lnm(MARGINS.pq5),
      required: { [`SL${nc}`]: n, ...req },
      halfWidthPlan: Math.max(...hs),
      halfWidthPoint: Math.max(...hp),
      ...op(hs[0], se1, MARGINS.pq5),
      note: 'the binding shell is reported; F is the S_A term scaled by (S_RPA/S_A)², shell 1',
    });
  }

  // ── PQ3: Γ_self = ρc²/K_B(k) against the judged interval; var(ln Γ) = 4 var(ln c) + var(ln K_B(k))
  const sc = sp(N.c);
  for (const nc of [4, 16, 64] as const) {
    const [lo, hi] = inp.judgedGamma[nc];
    const target = (TARGETS.pq3 * (hi - lo)) / 2;
    const nSK = groups[`SK${nc}c2p18`].n;
    const relTarget = target / hi; // absolute half-width = Γ·t·se_rel; Γ taken at the interval's upper end (conservative)
    const r = nAgainstFixed(sc, relTarget, relK2(nSK), 2 * nSK - 2, 4);
    need(`L${nc}`, r.n, `pq3.${nc}`);
    const n = groups[`L${nc}`].n;
    prim.push({
      key: `pq3.${nc}`,
      statistic: 'Γ_self = ρc_B²/K_B(k)',
      groups: [`L${nc}`, `SK${nc}c2p18`, `SK${nc}c2p22`],
      noise: ['c', 'P18', 'P22'],
      sPlan: [sc],
      F: relK2(nSK),
      margin: `judged interval [${lo.toFixed(4)}, ${hi.toFixed(4)}]`,
      targetFraction: TARGETS.pq3,
      targetHalfWidth: target,
      required: { [`L${nc}`]: n },
      halfWidthPlan: hi * halfWidth([{ v: (4 * sc * sc) / n, df: n - 1 }, { v: relK2(nSK), df: 2 * nSK - 2 }]),
      halfWidthPoint: hi * halfWidth([{ v: (4 * N.c.sd * N.c.sd) / n, df: n - 1 }, { v: relK2point(nSK), df: 2 * nSK - 2 }]),
      note: 'absolute half-width in Γ; target ½ of the judged interval half-width',
    });
  }

  // ── wall gates (instrument identities, linear CI): W4c2 and W16c2; the c_h 4 arm is reported only
  for (const g of ['W4c2', 'W16c2']) {
    const req: Record<string, number> = {};
    for (const k of ['gw1', 'gw2', 'gw3'] as const) {
      const r = nAgainstFixed(sp(N[k]), TARGETS.wall * WALL_TOLERANCES[k]);
      req[k] = r.n;
      need(g, r.n, `wall gates (${g})`);
    }
    const n = groups[g].n;
    const hw = (['gw1', 'gw2', 'gw3'] as const).map((k) => halfWidth([{ v: sp(N[k]) ** 2 / n, df: n - 1 }]) / WALL_TOLERANCES[k]);
    prim.push({
      key: `wall.${g}`,
      statistic: 'G-W1, G-W2, G-W3 (fraction of tolerance)',
      groups: [g],
      noise: ['gw1', 'gw2', 'gw3'],
      sPlan: [sp(N.gw1), sp(N.gw2), sp(N.gw3)],
      F: 0,
      margin: 'tolerances ±1 %, ±3 %, ±2 %',
      targetFraction: TARGETS.wall,
      targetHalfWidth: TARGETS.wall,
      required: { [g]: n, ...req },
      halfWidthPlan: Math.max(...hw),
      halfWidthPoint: Math.max(...(['gw1', 'gw2', 'gw3'] as const).map((k) => halfWidth([{ v: N[k].sd ** 2 / n, df: n - 1 }]) / WALL_TOLERANCES[k])),
      note: 'half-widths as a fraction of each gate tolerance (binding gate reported); R (W-MF) has no Universe A analogue and takes the same seeds',
    });
  }

  const noise: PowerPlan['noise'] = {};
  for (const [k, e] of Object.entries(N)) noise[k] = { ...e, planningFactor: planningFactor(e.df), sdPlan: planningSD(e), sd95: sdInterval95(e.df).map((x) => x * e.sd) as [number, number] };
  return {
    status: inp.status,
    basis: inp.basis,
    noise,
    primaries: prim,
    groups,
    notPowered: [
      { key: 'pq4', reason: 'T_kin/T_int and a₂ have no Universe A analogue (no reservoir at N_c = 1); seeds are those of SK*c2p20 and SL*' },
      { key: 'pq8', reason: 'the occupancy stress share is zero in Universe A; seeds are those of T4a1, T16a1, T64a1' },
      { key: 'wall R', reason: 'the occupancy-stress deficit does not exist in Universe A; seeds are those the wall gates set' },
      { key: 'pq7d', reason: 'not powered by design (§11.2); its FAIL voids, its INCONCLUSIVE is a caveat; design count 48' },
      { key: 'pq1.arm, pq2.arm', reason: 'reported arms; seeds are those PQ6c sets' },
      { key: 'W4c4', reason: 'the c_h 4 wall arm is reported, not judged; design count' },
    ],
  };
}

/** Seed counts in the form UB0Plans.ub0Groups takes. */
export function countsOf(p: PowerPlan): { status: PowerPlan['status']; n: Record<string, number> } {
  return { status: p.status, n: Object.fromEntries(Object.entries(p.groups).map(([g, v]) => [g, v.n])) };
}

// ───────────────────────── cost (B0 model) ─────────────────────────

export interface B0Row {
  Nc: number;
  ch: number;
  L: number;
  N: number;
  stepUs: number;
  meanDtP: number | null;
}

/**
 * Core-hours per seed of a run spec from the B0 benchmark rows (scripts/ub0-b0.ts):
 * µs per parcel-step interpolated in N between the two box sizes; the timestep is
 * Universe A's in parcel units, scaled with the Courant number, reduced for the imposed
 * flow speed of waves (B0's projection rule). An ESTIMATE; pilots measure the real one.
 */
export function coreHoursPerSeed(b: GroupDef['base'], rows: B0Row[]): number {
  const box = b.kind === 'wall' || b.kind === 'couette' ? b.width! * b.height! : b.L! * b.L!;
  const N = (b.phi / (Math.PI / 4)) * box;
  const rs = rows.filter((r) => r.Nc === b.Nc && (b.Nc === 1 || r.ch === b.ch)).sort((x, y) => x.N - y.N);
  if (!rs.length) throw new Error(`no B0 row for N_c ${b.Nc}, c_h ${b.ch}`);
  let us = rs[rs.length - 1].stepUs;
  if (rs.length >= 2) {
    const [r1, r2] = [rs[0], rs[rs.length - 1]];
    const w = Math.min(1, Math.max(0, (N - r1.N) / (r2.N - r1.N)));
    us = r1.stepUs + w * (r2.stepUs - r1.stepUs);
  }
  const A = rows.find((r) => r.Nc === 1 && r.L === 160)!;
  const dtStatic = (A.meanDtP as number) * (b.courant / 0.025);
  const vmax = b.courant / dtStatic;
  const U = b.kind === 'shear' || b.kind === 'sound' ? (b.amplitude ?? 0) : b.kind === 'couette' ? 0.5 * (b.wallSpeed ?? 0) : 0;
  const dt = b.courant / (vmax + U);
  return (N * ((b.prep + b.settle + b.measure) / dt) * us) / 3.6e9;
}

// ───────────────────────── false-PASS check by simulation ─────────────────────────

/**
 * Monte Carlo of the decision rule for a log-ratio primary with the true ratio exactly at
 * the upper margin edge (the worst case for a false PASS): first look at 95 %; if
 * INCONCLUSIVE with the point estimate inside, the single extension doubles the Universe B
 * arms and re-tests at 97.5 % (design §11.7). Normal per-seed log-estimates; the Universe A
 * reference, when present, is a fixed estimate with its SE and df.
 */
export function falsePassMC(o: {
  nA: number;
  sA: number;
  nB?: number;
  sB?: number;
  ref?: { se: number; df: number };
  margin: number;
  reps: number;
  seed: number;
}): { firstLook: number; withExtension: number; extended: number } {
  const rng = new Rng(o.seed, 7);
  const edge = Math.log(1 + o.margin);
  const lo = Math.log(1 - o.margin);
  let pass1 = 0;
  let passAll = 0;
  let ext = 0;
  const draw = (n: number, s: number) => {
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const x = s * rng.gaussian();
      sum += x;
      sum2 += x * x;
    }
    return { sum, sum2, n };
  };
  const stats = (a: { sum: number; sum2: number; n: number }) => {
    const m = a.sum / a.n;
    return { m, v: (a.sum2 - a.n * m * m) / (a.n - 1) / a.n, df: a.n - 1 };
  };
  const merge = (a: { sum: number; sum2: number; n: number }, b: { sum: number; sum2: number; n: number }) => ({ sum: a.sum + b.sum, sum2: a.sum2 + b.sum2, n: a.n + b.n });
  for (let r = 0; r < o.reps; r++) {
    // the reference: a fixed estimate (drawn once per replicate), not extended
    const refErr = o.ref ? o.ref.se * rng.gaussian() : 0;
    const refV = o.ref ? o.ref.se ** 2 * (chi2Draw(rng, o.ref.df) / o.ref.df) : 0;
    const look = (A: ReturnType<typeof draw>, B: ReturnType<typeof draw> | null, level: number) => {
      const a = stats(A);
      const terms = [{ v: a.v, df: a.df }];
      let est = edge + a.m - refErr;
      if (B) {
        const b = stats(B);
        est -= b.m;
        terms.push({ v: b.v, df: b.df });
      }
      if (o.ref) terms.push({ v: refV, df: o.ref.df });
      const t = tTwoSidedCritical(1 - level, welch(terms));
      const h = t * Math.sqrt(terms.reduce((s, x) => s + x.v, 0));
      return { est, pass: est + h <= edge && est - h >= lo, inside: est <= edge && est >= lo };
    };
    const A1 = draw(o.nA, o.sA);
    const B1 = o.nB ? draw(o.nB, o.sB ?? o.sA) : null;
    const l1 = look(A1, B1, 0.95);
    if (l1.pass) {
      pass1++;
      passAll++;
      continue;
    }
    if (!l1.inside) continue;
    // INCONCLUSIVE with the estimate inside the margin (a FAIL needs the CI outside, which an inside estimate never is)
    ext++;
    const A2 = merge(A1, draw(o.nA, o.sA));
    const B2 = B1 ? merge(B1, draw(o.nB!, o.sB ?? o.sA)) : null;
    if (look(A2, B2, 0.975).pass) passAll++;
  }
  return { firstLook: pass1 / o.reps, withExtension: passAll / o.reps, extended: ext / o.reps };
}

function chi2Draw(rng: Rng, k: number): number {
  if (!Number.isFinite(k) || k > 1e6) return k;
  // Wilson–Hilferty transform of a normal draw (adequate for the reference's df ≥ 10)
  return Math.max(1e-9, chi2Quantile(rng.gaussian(), k));
}
