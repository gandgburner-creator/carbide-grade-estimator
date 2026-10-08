/**
 * UB-0 timestep strategy and energy-drift gates (amendment A2, D1).
 *
 * Replaces A1 §4.3's single-Courant rule ("a pilot over its gate at 0.025 ⇒ 0.0125
 * throughout"; A1 is not edited, and A2 §1.1 quotes the rule it supersedes).
 *
 *   PQ7(b) gate, by drift class:
 *     wave  (shear waves)          |ΔE| over the measured window ≤ 1 % of the imposed wave energy
 *     rate  (static boxes, standing |ΔE|/E ≤ 2 × 10⁻⁷ per D/σ_v of measured window
 *            sound waves, wall boxes) — the design's 10⁻⁴ per 500 D/σ_v (the S-K window)
 *                                      written as a rate, so that a long statistical window
 *                                      no longer tightens the numerical tolerance
 *   Courant selection: each comparability group runs at the largest Courant number in
 *     LADDER at which every member's drift, measured or extrapolated at second order from
 *     the finest measured Courant, is ≤ ¼ of its gate (SELECT_FRACTION).
 *   Pilot rule: a pilot above ½ of its gate (PILOT_FRACTION) halves its comparability
 *     group once; above ½ again, a halt, an instrument defect, or a pilot dt-arm drift
 *     ratio < 2.5 ⇒ review (nothing changes automatically).
 *
 * Pure functions and committed tables; tests/universeB.timestep.test.ts locks the
 * table to the rule applied to results/ub0/implementation/drift_check.json.
 */
import type { UB0Spec } from './UB0Run';

export const WAVE_GATE = 0.01;
export const RATE_GATE = 2e-7;
export const LADDER = [0.025, 0.0125, 0.00625] as const;
export const SELECT_FRACTION = 0.25;
export const PILOT_FRACTION = 0.5;
/** PQ7(c): mean |drift|(dt) / mean |drift|(dt/2) ≥ 2.5 */
export const DT_ARM_RATIO_MIN = 2.5;

export type DriftClass = 'wave' | 'rate';

export function driftClass(kind: UB0Spec['kind']): DriftClass {
  if (kind === 'shear') return 'wave';
  if (kind === 'static' || kind === 'sound' || kind === 'wall') return 'rate';
  throw new Error(`no UB-0 drift gate for kind '${kind}' (Couette is deferred to UB-0W, A2 §1.6)`);
}

export function gateLimit(kind: UB0Spec['kind']): number {
  return driftClass(kind) === 'wave' ? WAVE_GATE : RATE_GATE;
}

/**
 * The PQ7(b) statistic of one run's measured window.
 *   wave: |ΔE| / imposed wave energy;  rate: |ΔE/E0| / (measured window in D/σ_v).
 */
export function driftStatistic(
  kind: UB0Spec['kind'],
  measureWindow: number,
  ledger: { energyResidual: number; relativeEnergyResidual: number },
  imposedKineticEnergy: number,
): number {
  return driftClass(kind) === 'wave'
    ? Math.abs(ledger.energyResidual / imposedKineticEnergy)
    : Math.abs(ledger.relativeEnergyResidual) / measureWindow;
}

// ───────────────────────── comparability groups ─────────────────────────

/**
 * Every set of runs compared or pooled in one primary shares one Courant number
 * (A2 §1.4). Universe A references for these comparisons are measured at the same
 * Courant number (Stage 0b, `matchedReferences`), except K_T,A, the frozen mapping input.
 */
export const COMPARABILITY: Record<string, string[]> = {
  'N4-static': ['SK4c2p18', 'SK4c2p20', 'SK4c2p22', 'SK4c4p18', 'SK4c4p20', 'SK4c4p22', 'SL4', 'L4'],
  'N4-shear': ['T4a1', 'T4a05', 'T4c4'],
  W4c2: ['W4c2'],
  W4c4: ['W4c4'],
  W16c2: ['W16c2'],
  'N16-static': ['SK16c2p18', 'SK16c2p20', 'SK16c2p22', 'SL16', 'L16'],
  'N16-shear': ['T16a1', 'T16a05', 'T16e08', 'T16e095'],
  'N64-static': ['SK64c2p18', 'SK64c2p20', 'SK64c2p22', 'L64'],
  'N64-shear': ['T64a1'],
};

/** The dt arm (PQ7c, PQ7d) runs at half its partner group's Courant number; it moves with it. */
export const DT_ARM = { group: 'T4dt', partner: 'N4-shear', reference: 'T4a1' } as const;

export function comparabilityOf(runGroup: string): string {
  if (runGroup === DT_ARM.group) return DT_ARM.partner;
  for (const [cg, members] of Object.entries(COMPARABILITY)) if (members.includes(runGroup)) return cg;
  throw new Error(`run group ${runGroup} belongs to no comparability group`);
}

/**
 * Universe A references each comparability group is compared with, at its Courant
 * number (A2 §1.4; Stage 0b protocol §3). K_T,A is not listed: it is the frozen
 * mapping input from Stage 0 at Courant 0.025, checked at the finer Courant numbers
 * by Stage 0b (protocol §5.3).
 */
export const MATCHED_REFERENCES: Record<string, string[]> = {
  'N4-static': ['S_A (L 80 d)', 'c_A (L 160 d)'],
  'N4-shear': ['nu_A (L 80 d, U0 = c_th)'],
  'N16-static': ['S_A (L 80 d)', 'c_A (L 160 d)'],
  'N16-shear': ['nu_A (L 80 d, U0 = c_th)'],
  'N64-static': ['c_A (L 160 d)'],
  'N64-shear': ['nu_A (L 160 d, U0 = c_th)'],
  W4c2: [],
  W4c4: [],
  W16c2: [],
};

// ───────────────────────── evidence and the assignment ─────────────────────────

/** One row of results/ub0/implementation/drift_check.json (scripts/ub0-drift-check.ts). */
export interface DriftEvidenceRow {
  case: string;
  courant: number;
  /** wave cases: residual/wave energy per D/σ_v; others: residual/E0 per D/σ_v */
  ratePerDsigma: number;
}

/**
 * Which drift-check case is the evidence for each run group, and the proxies used
 * where the check had no matching case (A2 §1.3, each disclosed):
 *   L{4,16,64}  the standing sound waves were not in the check: the static box of the same
 *               N_c and c_h (same local stiffness; the wave adds 0.06–0.25 σ_v of flow)
 *   T4c4        the N_c 4, c_h 2 shear wave (c_h 4 drifts ≈ 30× less in every static case)
 *   T16a05      T16a1 × the measured N_c 4 ratio a0.5/a1 at the same Courant number
 *   T16e08/095  T16a1 (restitution enters the reservoir exchange, not the force integration)
 *   T64a1       T16a1's rate over T64a1's own window (drift falls with N_c in every family)
 *   T4dt        T4a1 (the dt arm is assigned by its partner, not by its own evidence)
 * Each wave entry carries the judged measured window over which its rate accumulates.
 */
interface Evidence {
  case: string;
  /** multiplies the evidence case's rate; a function of the Courant number for the a0.5/a1 ratio proxy */
  scale?: (rows: DriftEvidenceRow[], courant: number) => number;
  /** wave runs: judged measured window (D/σ_v) */
  window?: number;
}

const NU_D_EVIDENCE = 0.351 / (0.2 / (Math.PI / 4));
const tau = (L: number) => (L * L) / (4 * Math.PI * Math.PI * NU_D_EVIDENCE);
const W80 = 1.5 * tau(80);
const W160 = 1.5 * tau(160);
const a05Ratio = (rows: DriftEvidenceRow[], c: number) =>
  Math.abs(rateAt(rows, 'T N4 a0.5 (1.5τD80)', c)) / Math.abs(rateAt(rows, 'T N4 a1 (1.5τD80)', c));

export const EVIDENCE: Record<string, Evidence> = {
  SK4c2p18: { case: 'SK N4 c2 (500)' },
  SK4c2p20: { case: 'SK N4 c2 (500)' },
  SK4c2p22: { case: 'SK N4 c2 (500)' },
  SK4c4p18: { case: 'SK N4 c4 (500)' },
  SK4c4p20: { case: 'SK N4 c4 (500)' },
  SK4c4p22: { case: 'SK N4 c4 (500)' },
  SL4: { case: 'SL N4 c2 (4200)' },
  L4: { case: 'SK N4 c2 (500)' },
  T4a1: { case: 'T N4 a1 (1.5τD80)', window: W80 },
  T4a05: { case: 'T N4 a0.5 (1.5τD80)', window: W80 },
  T4c4: { case: 'T N4 a1 (1.5τD80)', window: W80 },
  W4c2: { case: 'W N4 c2 (2000)' },
  W4c4: { case: 'W N4 c4 (2000)' },
  W16c2: { case: 'W N16 c2 (2000)' },
  SK16c2p18: { case: 'SL/SK N16 c2 (4200)' },
  SK16c2p20: { case: 'SL/SK N16 c2 (4200)' },
  SK16c2p22: { case: 'SL/SK N16 c2 (4200)' },
  SL16: { case: 'SL/SK N16 c2 (4200)' },
  L16: { case: 'SL/SK N16 c2 (4200)' },
  T16a1: { case: 'T N16 a1 (1.5τD80)', window: W80 },
  T16a05: { case: 'T N16 a1 (1.5τD80)', window: W80, scale: a05Ratio },
  T16e08: { case: 'T N16 a1 (1.5τD80)', window: W80 },
  T16e095: { case: 'T N16 a1 (1.5τD80)', window: W80 },
  SK64c2p18: { case: 'SK N64 c2 (500)' },
  SK64c2p20: { case: 'SK N64 c2 (500)' },
  SK64c2p22: { case: 'SK N64 c2 (500)' },
  L64: { case: 'SK N64 c2 (500)' },
  T64a1: { case: 'T N16 a1 (1.5τD80)', window: W160 },
};

function rateAt(rows: DriftEvidenceRow[], c: string, courant: number): number {
  const r = rows.find((x) => x.case === c && Math.abs(x.courant - courant) < 1e-12);
  if (r) return r.ratePerDsigma;
  // second-order extrapolation from the finest measured Courant number
  const measured = rows.filter((x) => x.case === c).sort((a, b) => a.courant - b.courant);
  if (!measured.length) throw new Error(`no drift evidence for case '${c}'`);
  const f = measured[0];
  return f.ratePerDsigma * (courant / f.courant) ** 2;
}

/** Predicted PQ7(b) statistic of a run group at a Courant number, and whether it was measured there. */
export function predictedDrift(rows: DriftEvidenceRow[], runGroup: string, courant: number): { drift: number; measured: boolean; limit: number } {
  const ev = EVIDENCE[runGroup];
  if (!ev) throw new Error(`no evidence entry for ${runGroup}`);
  const rate = Math.abs(rateAt(rows, ev.case, courant)) * (ev.scale ? ev.scale(rows, courant) : 1);
  const measured = rows.some((x) => x.case === ev.case && Math.abs(x.courant - courant) < 1e-12);
  return ev.window !== undefined ? { drift: rate * ev.window, measured, limit: WAVE_GATE } : { drift: rate, measured, limit: RATE_GATE };
}

export interface GroupAssignment {
  comparability: string;
  courant: number;
  /** per member at the chosen Courant: predicted drift / gate */
  fractions: Record<string, number>;
}

/** The A2 selection rule: the largest LADDER Courant at which every member is ≤ ¼ of its gate. */
export function assignCourant(rows: DriftEvidenceRow[]): Record<string, GroupAssignment> {
  const out: Record<string, GroupAssignment> = {};
  for (const [cg, members] of Object.entries(COMPARABILITY)) {
    let chosen: GroupAssignment | null = null;
    for (const c of LADDER) {
      const fractions = Object.fromEntries(members.map((m) => {
        const p = predictedDrift(rows, m, c);
        return [m, p.drift / p.limit];
      }));
      if (Object.values(fractions).every((f) => f <= SELECT_FRACTION)) {
        chosen = { comparability: cg, courant: c, fractions };
        break;
      }
    }
    if (!chosen) throw new Error(`comparability group ${cg}: no Courant number in the ladder meets ¼ of the gate — review (A2 §1.3)`);
    out[cg] = chosen;
  }
  return out;
}

/**
 * The committed assignment (A2 §1.3, Table 1.3) — the output of `assignCourant` on
 * results/ub0/implementation/drift_check.json (2900d89). A test asserts equality.
 */
export const COURANT_ASSIGNMENT: Record<string, number> = {
  'N4-static': 0.00625,
  'N4-shear': 0.0125,
  W4c2: 0.00625,
  W4c4: 0.0125,
  W16c2: 0.0125,
  'N16-static': 0.025,
  'N16-shear': 0.025,
  'N64-static': 0.025,
  'N64-shear': 0.025,
};

/**
 * Courant number of a run group: the committed assignment, halved once for each
 * comparability group listed in `halved` (the pilot rule's only automatic action).
 */
export function courantOf(runGroup: string, halved: readonly string[] = []): number {
  const cg = comparabilityOf(runGroup);
  const base = COURANT_ASSIGNMENT[cg];
  if (base === undefined) throw new Error(`no Courant assignment for ${cg}`);
  const c = halved.includes(cg) ? base / 2 : base;
  return runGroup === DT_ARM.group ? c / 2 : c;
}

// ───────────────────────── the pilot rule (A2 §1.5) ─────────────────────────

export interface PilotGateA2 {
  id: string;
  /** judged run group */
  group: string;
  courant: number;
  halted: boolean;
  drift: number;
  limit: number;
  /** drift / limit */
  fraction: number;
  /** recorded defects: PQ7(a), PQ7(e), lost events, failure flags, missing measure phase */
  defects: string[];
}

export type PilotDecision =
  | { kind: 'proceed'; halved: string[] }
  | { kind: 'halve'; halve: string[]; trigger: string[] }
  | { kind: 'review'; reasons: string[] };

/**
 * Round 1 (`alreadyHalved` empty): a pilot above ½ of its gate halves its comparability
 * group once, and that group's pilots are repeated at the halved Courant number (round 2).
 * Round 2: any pilot of a halved group above ½ of its gate again ⇒ review. In either
 * round a halt or defect ⇒ review (an implementation defect decides nothing about dt),
 * and so does a dt-arm pilot pair whose drift ratio is below 2.5 (PQ7c would void UB-0).
 * `dtArmDrift` is [drift of the reference pilot (dt), drift of the dt arm pilot (dt/2)],
 * when both ran in this round at their paired Courant numbers.
 */
export function pilotDecision(gates: PilotGateA2[], alreadyHalved: readonly string[] = [], dtArmDrift?: [number, number]): PilotDecision {
  const reasons: string[] = [];
  for (const g of gates) {
    if (g.halted) reasons.push(`${g.id}: halted`);
    for (const d of g.defects) reasons.push(`${g.id}: ${d}`);
  }
  if (dtArmDrift && !(Math.abs(dtArmDrift[0]) / Math.abs(dtArmDrift[1]) >= DT_ARM_RATIO_MIN)) {
    reasons.push(`dt-arm pilot drift ratio ${(Math.abs(dtArmDrift[0]) / Math.abs(dtArmDrift[1])).toFixed(2)} < ${DT_ARM_RATIO_MIN} (PQ7c)`);
  }
  const over = gates.filter((g) => !(g.fraction <= PILOT_FRACTION));
  // a group halves at most once: in round 2 (some group already halved) every pilot over ½ is a review
  const round2 = alreadyHalved.length > 0;
  for (const g of round2 ? over : []) reasons.push(`${g.id}: drift ${g.fraction.toFixed(2)} of its gate after one halving (Courant ${g.courant})`);
  if (reasons.length) return { kind: 'review', reasons };
  const fresh = [...new Set(over.map((g) => comparabilityOf(g.group)))];
  if (fresh.length) return { kind: 'halve', halve: fresh, trigger: over.map((g) => g.id) };
  return { kind: 'proceed', halved: [...alreadyHalved] };
}
