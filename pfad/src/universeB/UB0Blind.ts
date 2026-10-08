import type { UB0Result } from './UB0Run';
import { driftStatistic, gateLimit, type PilotGateA2 } from './UB0Timestep';

/**
 * The only record a blind Universe B run (a stability pilot, A1 §4.3; A2 §1.5) may store.
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

// ───────────────────────── stability-pilot gates (A2 §1.5) ─────────────────────────

/**
 * The PQ7(b) statistic of a pilot against its A2 gate (UB0Timestep): shear waves
 * |ΔE| / wave energy against 1 %; static boxes, standing sound waves and wall boxes
 * |ΔE/E| per D/σ_v against 2 × 10⁻⁷. The pilot rule acts on the fraction of the gate
 * (½ ⇒ halve the comparability group once); the defects are listed for review.
 * The A1 §4.3 rule this replaces (absolute 10⁻⁴ of the total energy; one Courant number
 * for everything) is quoted in A2 §1.1 and is no longer implemented.
 */
export function pilotGate(r: BlindRecord, group = r.spec.id): PilotGateA2 {
  const m = r.phases.measure;
  const limit = gateLimit(r.spec.kind);
  const drift = m
    ? r.spec.kind === 'shear'
      ? Math.abs(m.energyOverWave ?? Number.NaN)
      : driftStatistic(r.spec.kind, r.spec.measure, { energyResidual: Number.NaN, relativeEnergyResidual: m.relativeEnergyResidual }, Number.NaN)
    : Number.NaN;
  const defects: string[] = [];
  if (!m) defects.push('no measure phase');
  for (const [name, p] of Object.entries(r.phases)) {
    if (!(p.momentumOverNMs <= 1e-9)) defects.push(`${name}: momentum residual ${p.momentumOverNMs.toExponential(2)} > 1e-9 N M σ_v`);
    if (p.lateContactsUnexplained > 0) defects.push(`${name}: ${p.lateContactsUnexplained} unexplained late contacts`);
    if (p.flags.some((f) => f.severity === 'failure')) defects.push(`${name}: safety failure flag`);
  }
  if (r.lostEvents > 0) defects.push(`${r.lostEvents} lost collision events`);
  return { id: r.spec.id, group, courant: r.spec.courant, halted: r.halted, drift, limit, fraction: drift / limit, defects };
}
