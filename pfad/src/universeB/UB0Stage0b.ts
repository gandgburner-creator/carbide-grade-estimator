import { UB0_PHI } from './CoarseGrainMap';
import { centralDifference, equivalence, ratioCI, type Interval } from './UB0Analysis';
import { shearEstimate, soundEstimate, staticEstimate, wallEstimate } from './UB0Estimators';
import { tauD, type PlannedRun, type SoundAmplitude } from './UB0Plans';
import { planningSD, pooledSD, type NoiseEstimate } from './UB0Power';
import type { UB0Result } from './UB0Run';
import { ens, type Stat } from './UB0Stage0';
import { COURANT_ASSIGNMENT } from './UB0Timestep';

/**
 * Stage 0b aggregation (docs/CRITERIA_UB0_STAGE0B.md). Universe A only.
 *
 * Stage 0b SUPPLEMENTS Stage 0: Stage 0's runs and its frozen mapping input K_T,A are
 * unchanged; reference groups run with Stage 0's exact specs are pooled with Stage 0's
 * used runs. Pure functions of per-run estimates, tested on synthetic values
 * (tests/universeB.stage0b.test.ts).
 */

/** Per-group per-run estimates. Keys are `s0:<group>` (Stage 0) and `s0b:<group>` (Stage 0b). */
export type Estimates = Record<string, { nu?: number[]; c?: number[]; S1?: number[]; S2?: number[]; Pnorm?: number[]; gw1?: number[]; gw2?: number[]; gw3?: number[]; lambda?: number[]; rate?: number[] }>;

/** Run the committed estimators on quality-gated runs (the caller has applied the gates and reserves). */
export function estimatesOf(runs: { plan: PlannedRun; result: UB0Result }[], prefix: 's0' | 's0b', into: Estimates = {}): Estimates {
  const push = (g: string, k: keyof Estimates[string], v: number) => {
    const key = `${prefix}:${g}`;
    into[key] ??= {};
    (into[key][k] ??= []).push(v);
  };
  for (const { plan, result } of runs) {
    const g = plan.group;
    if (plan.kind === 'shear') push(g, 'nu', shearEstimate(result, tauD(plan.L!)).nu_p);
    else if (plan.kind === 'sound') push(g, 'c', soundEstimate(result, plan.periodHint!).c);
    else if (plan.kind === 'static') {
      const e = staticEstimate(result);
      push(g, 'Pnorm', e.Pnorm);
      if (plan.extras) {
        push(g, 'S1', e.S[0]);
        push(g, 'S2', e.S[1]);
        push(g, 'lambda', e.lambda_p);
        push(g, 'rate', e.collisionRate_p);
      }
    } else if (plan.kind === 'wall') {
      const w = wallEstimate(result);
      push(g, 'gw1', w.gw1);
      push(g, 'gw2', w.gw2);
      push(g, 'gw3', w.gw3);
    }
  }
  return into;
}

const vals = (E: Estimates, keys: string[], q: keyof Estimates[string]) => keys.flatMap((k) => E[k]?.[q] ?? []);

/**
 * The Universe A cells, by quantity and Courant number. Stage 0's groups at 0.025 and
 * the Stage 0b groups with the same spec are one cell. `a` is the standing-wave
 * amplitude (fraction of c).
 */
/** Group-name suffix of a Courant number: '' at 0.025, else 'c' + its decimals (0.0125 → 'c0125'). */
export function courantSuffix(courant: number): string {
  return courant === 0.025 ? '' : `c${String(courant).replace(/^0\./, '')}`;
}

export function cellKeys(q: 'nuL80a1' | 'nuL80a05' | 'nuL160a1' | 'c' | 'S' | 'P18' | 'P22' | 'gw', courant: number, a: SoundAmplitude = 0.02): string[] {
  const c = courantSuffix(courant);
  switch (q) {
    case 'nuL80a1':
      return c ? [`s0b:T80a1${c}`] : ['s0:T80a1', 's0b:T80a1'];
    case 'nuL80a05':
      return c ? [] : ['s0:T80a05'];
    case 'nuL160a1':
      return c ? [`s0b:T160a1${c}`] : ['s0:T160a1', 's0b:T160a1'];
    case 'c':
      // phase 2 and the contingency run at the selected amplitude; at 0.025 the cell is that amplitude's
      return c ? [`s0b:L160${c}`] : a === 0.04 ? ['s0b:L160a04'] : ['s0:L160', 's0b:L160'];
    case 'S':
      return c ? [`s0b:SL${c}`] : ['s0:SL', 's0b:SL'];
    case 'P18':
      return c ? [`s0b:SK18${c}`] : ['s0:SK18'];
    case 'P22':
      return c ? [`s0b:SK22${c}`] : ['s0:SK22'];
    case 'gw':
      return c ? [] : ['s0:W40', 's0b:W40'];
  }
}

const COURANTS = [0.025, 0.0125, 0.00625, 0.003125];

// ───────────────────────── the amplitude decision (protocol §4) ─────────────────────────

export interface AmplitudeDecision {
  selected: SoundAmplitude;
  n: { a02: number; a04: number };
  /** per-seed relative SD and its planning value (80 % upper bound) at each amplitude, Courant 0.025 */
  sd: { a02: number; a04: number };
  sdPlan: { a02: number; a04: number };
  /** c(0.04)/c(0.02) with its 95 % CI (log scale, Welch) */
  ratio: Interval;
  rule: { precisionGain: boolean; ciContainsOne: boolean; shiftWithin1pct: boolean };
}

/**
 * Select 0.04 of c iff ALL hold, both amplitudes at Courant 0.025:
 *   (i)  sd_plan(0.04) ≤ 0.75 · sd_plan(0.02)   (a material precision gain)
 *   (ii) the 95 % CI of c(0.04)/c(0.02) contains 1   (no detected amplitude effect)
 *   (iii) |c(0.04)/c(0.02) − 1| ≤ 1 %   (no material shift in the point estimate)
 * otherwise keep the design's 0.02.
 */
export function amplitudeDecision(E: Estimates): AmplitudeDecision {
  const c02 = vals(E, cellKeys('c', 0.025, 0.02), 'c');
  const c04 = vals(E, cellKeys('c', 0.025, 0.04), 'c');
  if (c02.length < 2 || c04.length < 2) throw new Error('amplitude decision needs both amplitudes at Courant 0.025');
  const n02 = pooledSD([{ label: '0.02', values: c02 }], true, 'c at 0.02');
  const n04 = pooledSD([{ label: '0.04', values: c04 }], true, 'c at 0.04');
  const ratio = ratioCI(ens(c04), ens(c02));
  const rule = {
    precisionGain: planningSD(n04) <= 0.75 * planningSD(n02),
    ciContainsOne: ratio.ci[0] <= 1 && ratio.ci[1] >= 1,
    shiftWithin1pct: Math.abs(ratio.estimate - 1) <= 0.01,
  };
  return {
    selected: rule.precisionGain && rule.ciContainsOne && rule.shiftWithin1pct ? 0.04 : 0.02,
    n: { a02: c02.length, a04: c04.length },
    sd: { a02: n02.sd, a04: n04.sd },
    sdPlan: { a02: planningSD(n02), a04: planningSD(n04) },
    ratio,
    rule,
  };
}

// ───────────────────────── timestep checks (protocol §5) ─────────────────────────

/** The band of the Universe A timestep diagnostics: PQ7d's margin, the design's dt tolerance. */
export const DT_BAND: [number, number] = [0.97, 1.03];
/** The K check: ⅓ of PQ2's ± 10 % margin around the frozen K_T,A. */
export const K_BAND: [number, number] = [1 - 1 / 30, 1 + 1 / 30];

export interface DtCheck {
  quantity: string;
  courant: number;
  ratio: Interval;
  outcome: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  /** K: anything but PASS; ν, c, S: FAIL only (CI entirely outside the band) */
  review: boolean;
}

export function dtChecks(E: Estimates, KTred: Stat, a: SoundAmplitude, courants: number[] = [0.0125, 0.00625]): DtCheck[] {
  const out: DtCheck[] = [];
  const n = UB0_PHI / (Math.PI / 4);
  for (const c of courants) {
    // K at the finer Courant number against the frozen mapping input (reduced units)
    const p18 = vals(E, cellKeys('P18', c), 'Pnorm');
    const p22 = vals(E, cellKeys('P22', c), 'Pnorm');
    if (p18.length >= 2 && p22.length >= 2) {
      const K = centralDifference(p18, p22);
      const Kred: Stat = { ...K, value: K.value / n, se: K.se / n };
      const r = ratioCI(Kred, KTred);
      const o = equivalence(r.ci, K_BAND);
      out.push({ quantity: 'K_T/(n kT) vs frozen K_T,A', courant: c, ratio: r, outcome: o, review: o !== 'PASS' });
    }
    const diag = (label: string, q: Parameters<typeof cellKeys>[0], field: keyof Estimates[string]) => {
      const fine = vals(E, cellKeys(q, c, a), field);
      const base = vals(E, cellKeys(q, 0.025, a), field);
      if (fine.length < 2 || base.length < 2) return;
      const r = ratioCI(ens(fine), ens(base));
      const o = equivalence(r.ci, DT_BAND);
      out.push({ quantity: label, courant: c, ratio: r, outcome: o, review: o === 'FAIL' });
    };
    diag('ν (L 80 d, U₀ = c_th) vs Courant 0.025', 'nuL80a1', 'nu');
    diag(`c (L 160 d, amplitude ${a}) vs Courant 0.025`, 'c', 'c');
    diag('S shell 1 (L 80 d) vs Courant 0.025', 'S', 'S1');
    diag('S shell 2 (L 80 d) vs Courant 0.025', 'S', 'S2');
  }
  return out;
}

// ───────────────────────── matched references (A2 §1.4) ─────────────────────────

export interface MatchedReferences {
  /** ν_A per N_c at its shear group's Courant number: L 80 d (4, 16), L 160 d (64) */
  nu: Record<4 | 16 | 64, Stat>;
  /** c_A per N_c at its static group's Courant number, selected amplitude */
  cA: Record<4 | 16 | 64, Stat>;
  /** S_A shells 1, 2 per N_c at its static group's Courant number */
  SA: Record<4 | 16, Stat[]>;
  /** the Courant numbers used */
  courant: Record<string, number>;
}

function need(E: Estimates, keys: string[], field: keyof Estimates[string], what: string): Stat {
  const v = vals(E, keys, field);
  if (v.length < 2) throw new Error(`no matched Universe A reference for ${what} (cells ${keys.join(', ') || 'none'}): run the Stage 0b contingency (protocol §8)`);
  return ens(v);
}

/** `courant` is the comparability-group assignment, after any pilot halving (UB0Timestep). */
export function matchedReferences(E: Estimates, a: SoundAmplitude, courant: Record<string, number> = COURANT_ASSIGNMENT): MatchedReferences {
  const cs = (g: string) => courant[g];
  return {
    nu: {
      4: need(E, cellKeys('nuL80a1', cs('N4-shear')), 'nu', `ν_A at Courant ${cs('N4-shear')}`),
      16: need(E, cellKeys('nuL80a1', cs('N16-shear')), 'nu', `ν_A at Courant ${cs('N16-shear')}`),
      64: need(E, cellKeys('nuL160a1', cs('N64-shear')), 'nu', `ν_A (L 160 d) at Courant ${cs('N64-shear')}`),
    },
    cA: {
      4: need(E, cellKeys('c', cs('N4-static'), a), 'c', `c_A at Courant ${cs('N4-static')}`),
      16: need(E, cellKeys('c', cs('N16-static'), a), 'c', `c_A at Courant ${cs('N16-static')}`),
      64: need(E, cellKeys('c', cs('N64-static'), a), 'c', `c_A at Courant ${cs('N64-static')}`),
    },
    SA: {
      4: [need(E, cellKeys('S', cs('N4-static')), 'S1', 'S_A shell 1'), need(E, cellKeys('S', cs('N4-static')), 'S2', 'S_A shell 2')],
      16: [need(E, cellKeys('S', cs('N16-static')), 'S1', 'S_A shell 1'), need(E, cellKeys('S', cs('N16-static')), 'S2', 'S_A shell 2')],
    },
    courant: { ...courant },
  };
}

// ───────────────────────── the noise basis of the power plan (A2 §3) ─────────────────────────

/** Pooled within-Courant-cell per-seed SDs of every Universe A estimator the power plan uses. */
export function noiseBasis(E: Estimates, a: SoundAmplitude) {
  const cells = (q: Parameters<typeof cellKeys>[0], field: keyof Estimates[string], amp = a) =>
    COURANTS.map((c) => ({ label: `Courant ${c}: ${cellKeys(q, c, amp).join(' + ')}`, values: vals(E, cellKeys(q, c, amp), field) })).filter((x) => x.values.length >= 2);
  const N = (q: Parameters<typeof cellKeys>[0], field: keyof Estimates[string], relative: boolean, what: string) => pooledSD(cells(q, field), relative, what);
  return {
    nuL80a1: N('nuL80a1', 'nu', true, 'ν per seed, L 80 d, U₀ = c_th'),
    nuL80a05: N('nuL80a05', 'nu', true, 'ν per seed, L 80 d, U₀ = c_th/2'),
    nuL160a1: N('nuL160a1', 'nu', true, 'ν per seed, L 160 d, U₀ = c_th'),
    c: N('c', 'c', true, `c per seed, L 160 d, amplitude ${a} of c`),
    S1: N('S', 'S1', true, 'S per seed, shell 1, L 80 d'),
    S2: N('S', 'S2', true, 'S per seed, shell 2, L 80 d'),
    P18: N('P18', 'Pnorm', false, 'P/T per seed, φ = 0.18, L 80 d'),
    P22: N('P22', 'Pnorm', false, 'P/T per seed, φ = 0.22, L 80 d'),
    gw1: N('gw', 'gw1', false, 'G-W1 per seed, Universe A wall box 40 × 40 d'),
    gw2: N('gw', 'gw2', false, 'G-W2 per seed, Universe A wall box 40 × 40 d'),
    gw3: N('gw', 'gw3', false, 'G-W3 per seed, Universe A wall box 40 × 40 d'),
  } satisfies Record<string, NoiseEstimate>;
}

/** Pooled Courant-0.025 values that update the non-judged prediction inputs (λ, collision rate, ν, c). */
export function pooledReferences(E: Estimates, a: SoundAmplitude) {
  return {
    nuL80: ens(vals(E, cellKeys('nuL80a1', 0.025), 'nu')),
    cA: ens(vals(E, cellKeys('c', 0.025, a), 'c')),
    lambda: ens(vals(E, cellKeys('S', 0.025), 'lambda')),
    collisionRate: ens(vals(E, cellKeys('S', 0.025), 'rate')),
    wall: {
      gw1: ens(vals(E, cellKeys('gw', 0.025), 'gw1')),
      gw2: ens(vals(E, cellKeys('gw', 0.025), 'gw2')),
      gw3: ens(vals(E, cellKeys('gw', 0.025), 'gw3')),
    },
  };
}
