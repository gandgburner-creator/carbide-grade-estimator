import { statCI, type Interval, type RunGate } from './UB0Analysis';
import { driftStatistic, gateLimit } from './UB0Timestep';
import type { PlannedRun } from './UB0Plans';
import type { UB0Result } from './UB0Run';
import { ens } from './UB0Stage0';

/**
 * Run selection for the judged UB-0 analysis (design §11.5–§11.7; amendments A1, A2).
 * Pure functions, fixed before any Universe B judged run; tested on synthetic
 * records (tests/universeB.selection.test.ts).
 */

// ───────────────────────── per-run checks (§11.6) ─────────────────────────

export interface RunCheck {
  id: string;
  /** automatic exclusion: halt, non-finite state, PQ7(a), PQ7(b) (the A2 gate of its kind), lost collision events */
  excludeReasons: string[];
  /** for PQ7 over the INCLUDED runs: (e) unexplained late contacts is not an exclusion; it voids (F0) */
  gate: RunGate;
  /** design §11.6 stiffness diagnostic: max ω·dt over sample steps (report only; NaN at N_c = 1) */
  maxOmegaDt: number;
}

interface PhaseLedger {
  energyResidual: number;
  relativeEnergyResidual: number;
  momentumResidual: { x: number; y: number };
  lateContactsUnexplained: number;
  flags: { severity: string }[];
  halted: boolean;
}

export function checkRun(r: UB0Result): RunCheck {
  const why: string[] = [];
  const halted = r.info.halted === 1;
  if (halted) why.push('halted');
  const NMs = r.info.parcels * r.map.mass * r.map.sigmaV;
  let mom = 0;
  let late = 0;
  let finite = true;
  for (const raw of Object.values(r.phaseLedgers)) {
    const p = raw as PhaseLedger;
    mom = Math.max(mom, Math.hypot(p.momentumResidual.x, p.momentumResidual.y) / NMs);
    late += p.lateContactsUnexplained;
    if (!Number.isFinite(p.energyResidual) || !Number.isFinite(p.momentumResidual.x) || !Number.isFinite(p.momentumResidual.y)) finite = false;
    if (p.flags.some((f) => f.severity === 'failure') && !halted) why.push('safety failure flag');
  }
  for (const s of r.samples) for (const v of Object.values(s)) if (!Number.isFinite(v)) finite = false;
  if (!finite) why.push('non-finite state');
  if (!(mom <= 1e-9)) why.push(`PQ7(a) momentum residual ${mom.toExponential(2)} N M σ_v`);
  const m = r.phaseLedgers.measure as PhaseLedger | undefined;
  // A2 §1.2: shear waves |ΔE|/wave energy ≤ 1 %; static, sound and wall boxes |ΔE/E| ≤ 2e-7 per D/σ_v
  const driftLimit = gateLimit(r.spec.kind);
  const drift = m ? driftStatistic(r.spec.kind, r.spec.measure, m, r.info.imposedKineticEnergy) : Number.NaN;
  if (!m) why.push('no measure phase');
  else if (!(drift <= driftLimit)) why.push(`PQ7(b) energy drift ${drift.toExponential(2)} > ${driftLimit}${r.spec.kind === 'shear' ? ' of the wave energy' : ' per D/σ_v'}`);
  if (r.lostEvents > 0) why.push(`${r.lostEvents} lost collision events`);
  const om = r.samples.map((s) => s.omegaDt).filter((x) => x !== undefined);
  return {
    id: r.spec.id,
    excludeReasons: [...new Set(why)],
    gate: { id: r.spec.id, momentumResidual: mom, drift, driftLimit, unexplainedLateContacts: late, halted },
    maxOmegaDt: om.length ? Math.max(...om) : Number.NaN,
  };
}

// ───────────────────────── reserves and the extension (§11.6, §11.7) ─────────────────────────

export interface GroupSelection {
  group: string;
  /** planned count n; the target is n, or 2n for an extended group */
  n: number;
  target: number;
  /** ids entering the analysis, in seed order */
  used: string[];
  excluded: { id: string; reasons: string[] }[];
  /** ids that must be run before this group can be analysed */
  toRun: string[];
  /** target not reachable: the reserve is exhausted */
  shortfall: number;
  /**
   * more than max(1, 10 %) of the runs examined were excluded ⇒ F0 for this configuration
   * (A2 §4): a single exclusion, replaced from the reserve, never voids a group by itself
   */
  excessExclusions: boolean;
}

/**
 * The A2 exclusion rule (§4): F0 only when the excluded runs exceed max(1, 10 % of the
 * runs examined). It replaces the design's "> 10 % excluded", under which one exclusion
 * in a group of 4–8 runs (20 %, 11 %) voided the whole bulk verdict.
 */
export function excessExclusions(excluded: number, examined: number): boolean {
  return examined > 0 && excluded > Math.max(1, 0.1 * examined);
}

/**
 * Seeds are taken in seed order: the planned block, then the reserve. An excluded
 * run is replaced by the next reserve seed; an extended group (target 2n) takes
 * the next reserve seeds after any replacements. Nothing is skipped or reordered.
 */
export function selectGroup(runs: PlannedRun[], checks: Map<string, RunCheck>, extended = false): GroupSelection {
  const sorted = [...runs].sort((a, b) => a.seed - b.seed);
  const n = sorted.filter((r) => r.planned).length;
  const target = extended ? 2 * n : n;
  const used: string[] = [];
  const excluded: { id: string; reasons: string[] }[] = [];
  const toRun: string[] = [];
  for (const r of sorted) {
    if (used.length + toRun.length >= target) break;
    const c = checks.get(r.id);
    if (!c) {
      toRun.push(r.id);
      continue;
    }
    if (c.excludeReasons.length) excluded.push({ id: r.id, reasons: c.excludeReasons });
    else used.push(r.id);
  }
  const examined = used.length + excluded.length;
  return {
    group: sorted[0]?.group ?? '',
    n,
    target,
    used,
    excluded,
    toRun,
    shortfall: Math.max(0, target - used.length - toRun.length),
    excessExclusions: excessExclusions(excluded.length, examined),
  };
}

/**
 * Universe B configurations entering each primary. The single extension (§11.7)
 * doubles all of them; only the extended primary uses the doubled data, at the
 * 97.5 % level. Every other primary keeps its first-look verdict.
 */
export const PRIMARY_GROUPS: Record<string, string[]> = {
  'pq1.4': ['T4a1'],
  'pq1.16': ['T16a1'],
  'pq1.64': ['T64a1'],
  'pq2.4': ['SK4c2p18', 'SK4c2p22'],
  'pq2.16': ['SK16c2p18', 'SK16c2p22'],
  'pq2.64': ['SK64c2p18', 'SK64c2p22'],
  'pq3.4': ['L4', 'SK4c2p18', 'SK4c2p22'],
  'pq3.16': ['L16', 'SK16c2p18', 'SK16c2p22'],
  'pq3.64': ['L64', 'SK64c2p18', 'SK64c2p22'],
  'pq4.4': ['SK4c2p20', 'SL4'],
  'pq4.16': ['SK16c2p20', 'SL16'],
  'pq4.64': ['SK64c2p20'],
  'pq5.4': ['SL4'],
  'pq5.16': ['SL16'],
  'pq6a.4': ['T4a1', 'T4a05'],
  'pq6a.16': ['T16a1', 'T16a05'],
  pq6b: ['T16e08', 'T16e095'],
  pq6c: ['T4c4', 'T4a1', 'SK4c4p18', 'SK4c4p22', 'SK4c2p18', 'SK4c2p22'],
  pq7d: ['T4dt', 'T4a1'],
  'pq8.4': ['T4a1'],
  'pq8.16': ['T16a1'],
  'pq8.64': ['T64a1'],
};

/** §11.7: one extension, for a primary that is INCONCLUSIVE with its point estimate inside the margin. */
export function extensionCandidates(outcomes: Record<string, string>, inside: Record<string, boolean>): string[] {
  return Object.keys(PRIMARY_GROUPS).filter((k) => outcomes[k] === 'INCONCLUSIVE' && inside[k] === true);
}

// ───────────────────────── run halves (§11.5.1) ─────────────────────────

/** First- and second-half means of a per-sample series (the first sample, a partial interval, dropped). */
export function halves(xs: number[]): [number, number] {
  const v = xs.slice(1);
  const h = Math.floor(v.length / 2);
  const m = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  return [m(v.slice(0, h)), m(v.slice(h))];
}

/**
 * NON-STATIONARY if the CI of the seed-averaged (first − second) difference
 * excludes zero by more than `threshold` (⅓ of the margin, in the quantity's units).
 */
export function nonStationary(pairs: [number, number][], threshold: number, level = 0.95): { diff: Interval; flag: boolean } {
  const diff = statCI(ens(pairs.map(([a, b]) => a - b)), level);
  return { diff, flag: diff.ci[0] > threshold || diff.ci[1] < -threshold };
}

/**
 * Thresholds (⅓ of each primary's margin, in the per-group quantity), fixed from
 * frozen quantities only:
 *   Pnorm at φ = 0.18 or 0.22 (PQ2, PQ3, PQ6c-K): a shift δ in one group moves K by
 *     (φ/Δφ)δ = 5δ; ⅓ of 10 % of K_T,A ⇒ δ = K_T,A/150;
 *   T_kin/T_int (PQ4): ⅓ × 3 % = 0.01;
 *   S at a shell (PQ5): ⅓ × 10 % of the frozen S_RPA prediction.
 */
export function stationarityThresholds(KA: number, sRPAshells: [number, number]) {
  return { Pnorm: KA / 150, TkinOverTint: 0.01, S: [sRPAshells[0] / 30, sRPAshells[1] / 30] as [number, number] };
}

/** Which primaries a NON-STATIONARY static group makes INCONCLUSIVE. */
export function primariesOfStaticGroup(group: string, quantity: 'Pnorm' | 'TkinOverTint' | 'S'): string[] {
  const sk = /^SK(\d+)c(\d)p(\d+)$/.exec(group);
  const sl = /^SL(\d+)$/.exec(group);
  if (sk) {
    const [, n, ch, p] = sk;
    if (quantity === 'Pnorm' && p !== '20') return ch === '2' ? [`pq2.${n}`, `pq3.${n}`, ...(n === '4' ? ['pq6c'] : [])] : ['pq6c', 'pq2.arm'];
    if (quantity === 'TkinOverTint' && p === '20' && ch === '2') return [`pq4.${n}`];
    return [];
  }
  if (sl) {
    if (quantity === 'TkinOverTint') return [`pq4.${sl[1]}`];
    if (quantity === 'S') return [`pq5.${sl[1]}`];
  }
  return [];
}
