import type { UB0Result } from './UB0Run';

/**
 * The only record a blind Universe B run (a stability pilot, A1 §4.3) may store.
 *
 * A1 §4.3 allows wall-clock timing, ledgers, energy drift, halts and safety
 * flags; "no physics observable is computed, printed or stored". With
 * `observables: false` a run takes no samples and no tallies, but its full
 * record would still carry physics in passing:
 *   - per-wall impulse and heat totals (wall pressure, temperature jump);
 *   - the one-off rescale factors after preparation (T_kin and T_int: PQ4);
 *   - collision counts (collision frequency, i.e. contact density);
 *   - step counts and E0 (mean timestep → speed tail → T_kin; potential energy).
 * So the record is built from a whitelist: residuals as ratios only, the
 * numerical safety diagnostics, and seconds. Nothing else is copied.
 */
export interface BlindPhase {
  relativeEnergyResidual: number;
  /** measured window of a wave run: energy residual / imposed wave energy (PQ7b) */
  energyOverWave?: number;
  /** |momentum residual| / (N M σ_v) (PQ7a) */
  momentumOverNMs: number;
  lateContactsUnexplained: number;
  maxOverlapFraction: number;
  flags: { code: string; severity: string; message: string }[];
  halted: boolean;
}

export interface BlindRecord {
  blind: true;
  spec: UB0Result['spec'];
  halted: boolean;
  lostEvents: number;
  phases: Record<string, BlindPhase>;
  /** wall-clock seconds per phase (not data) */
  seconds: Record<string, number>;
}

interface LedgerPhase {
  energyResidual: number;
  relativeEnergyResidual: number;
  momentumResidual: { x: number; y: number };
  lateContactsUnexplained: number;
  maxOverlapFraction: number;
  flags: { code: string; severity: string; message: string }[];
  halted: boolean;
}

export function blindRecord(r: UB0Result): BlindRecord {
  const N = r.info.parcels;
  const NMs = N * r.map.mass * r.map.sigmaV;
  const wave = r.spec.kind === 'shear' || r.spec.kind === 'sound';
  const phases: Record<string, BlindPhase> = {};
  for (const [name, raw] of Object.entries(r.phaseLedgers)) {
    const p = raw as LedgerPhase;
    phases[name] = {
      relativeEnergyResidual: p.relativeEnergyResidual,
      ...(wave && name === 'measure' ? { energyOverWave: p.energyResidual / r.info.imposedKineticEnergy } : {}),
      momentumOverNMs: Math.hypot(p.momentumResidual.x, p.momentumResidual.y) / NMs,
      lateContactsUnexplained: p.lateContactsUnexplained,
      maxOverlapFraction: p.maxOverlapFraction,
      flags: p.flags.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
      halted: p.halted,
    };
  }
  const seconds: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.timing)) if (k.endsWith('Seconds')) seconds[k] = v;
  return { blind: true, spec: r.spec, halted: r.info.halted === 1, lostEvents: r.lostEvents, phases, seconds };
}

// ───────────────────────── stability-pilot gates (A1 §4.3) ─────────────────────────

/** PQ7(b) limits applied to the measured window (A1 §4.3) */
export const DRIFT_LIMIT_WAVE = 0.01;
export const DRIFT_LIMIT_STATIC = 1e-4;

export interface PilotGate {
  id: string;
  courant: number;
  halted: boolean;
  /** the drift statistic and its limit */
  drift: number;
  driftLimit: number;
  driftPass: boolean;
  /** recorded, not part of the timestep rule: PQ7(a), PQ7(e), lost events, failure flags */
  defects: string[];
}

export function pilotGate(r: BlindRecord): PilotGate {
  const m = r.phases.measure;
  const wave = r.spec.kind === 'shear' || r.spec.kind === 'sound';
  const driftLimit = wave ? DRIFT_LIMIT_WAVE : DRIFT_LIMIT_STATIC;
  const drift = m ? Math.abs(wave ? (m.energyOverWave ?? Number.NaN) : m.relativeEnergyResidual) : Number.NaN;
  const defects: string[] = [];
  if (!m) defects.push('no measure phase');
  for (const [name, p] of Object.entries(r.phases)) {
    if (!(p.momentumOverNMs <= 1e-9)) defects.push(`${name}: momentum residual ${p.momentumOverNMs.toExponential(2)} > 1e-9 N M σ_v`);
    if (p.lateContactsUnexplained > 0) defects.push(`${name}: ${p.lateContactsUnexplained} unexplained late contacts`);
    if (p.flags.some((f) => f.severity === 'failure')) defects.push(`${name}: safety failure flag`);
  }
  if (r.lostEvents > 0) defects.push(`${r.lostEvents} lost collision events`);
  return { id: r.spec.id, courant: r.spec.courant, halted: r.halted, drift, driftLimit, driftPass: drift <= driftLimit, defects };
}

export type TimestepDecision =
  | { kind: 'retain'; courant: number }
  | { kind: 'halve'; courant: number; trigger: string[] }
  | { kind: 'review'; reason: string; ids: string[] };

/**
 * The pre-declared timestep rule (A1 §4.3), committed before any pilot result:
 *   1. a pilot at the baseline Courant number over its drift gate ⇒ Courant base/2
 *      throughout UB-0 (Universe A inputs repeated with the same seeds and re-frozen;
 *      the dt arm moves to base/4);
 *   2. a pilot over its gate at base/2 (a second round, or the dt arm itself) ⇒
 *      nothing changes automatically; reported for review;
 *   3. a halt, or any PQ7(a)/(e) defect ⇒ an implementation defect; reported, never
 *      absorbed into a criterion.
 * Rule 3 is checked first: a defective implementation decides nothing about dt.
 * `base` is always the original baseline 0.025, also when a second pilot round runs
 * at 0.0125, so that rule 2 (not a further halving) applies to it.
 */
export function timestepDecision(gates: PilotGate[], base: number): TimestepDecision {
  const defective = gates.filter((g) => g.halted || g.defects.length > 0);
  if (defective.length) return { kind: 'review', reason: 'implementation defect (halt or PQ7 a/e)', ids: defective.map((g) => g.id) };
  const over = gates.filter((g) => !g.driftPass);
  const atBase = over.filter((g) => g.courant >= base);
  const below = over.filter((g) => g.courant < base);
  if (below.length) return { kind: 'review', reason: `drift gate exceeded at Courant < ${base}`, ids: below.map((g) => g.id) };
  if (atBase.length) return { kind: 'halve', courant: base / 2, trigger: atBase.map((g) => g.id) };
  return { kind: 'retain', courant: base };
}
