import type { Est } from '../measurements/SeparationDetector';
import type { RunSummary } from './History';

/**
 * LIFT AND DRAG AS MEASURED IN THE SIMULATION.
 *
 * The body is held fixed in a stream along +x, and every particle that hits it gives it momentum, so the force
 * on the body is simply the measured momentum-transfer rate (the body's own impulse tallies, per unit time; see
 * walls/SolidBody). Resolved along and across the free stream:
 *
 *   drag  the force along the stream (+x, downstream)
 *   lift  the force across the stream (+y; for a body at a positive angle of attack, which is nose-up, this is upward)
 *
 * The simulation is two-dimensional, so these are forces PER UNIT DEPTH. Nothing classical enters: no pressure
 * distribution is integrated, no coefficient formula is used. A force is made dimensionless only by dividing it by
 * the simulation's own reference force, the free stream's dynamic pressure times the chord,
 *
 *   F_ref = ½ · ρ∞ · U∞² · c      with ρ∞ = n∞ m (the density the experiment imposes) and U∞ the imposed stream speed,
 *
 * which gives the DRAG and LIFT COEFFICIENTS of this simulated gas (per unit depth). They are measurements of this
 * particle gas at its own Reynolds, Mach and Knudsen numbers: they need not carry over to any other regime.
 */
export interface ForceMeasure {
  /** measured momentum-transfer rate on the body, per unit depth [m·d/τ²] */
  drag: Est;
  lift: Est;
  /** the same divided by the reference force (dimensionless) */
  dragCoeff: Est;
  liftCoeff: Est;
  /** ½ ρ∞ U∞² c in simulation units [m·d/τ²] */
  reference: number;
  chord: number;
}

const scale = (e: Est, k: number): Est => ({ mean: e.mean * k, se: Math.abs(k) * e.se, n: e.n });

/** The reference force of a run, or null if its conditions do not say what it was. */
export function referenceForce(conditions: Record<string, unknown>, chord: number): number | null {
  const phi = Number(conditions.areaFraction);
  const r = Number(conditions.radius);
  const m = Number(conditions.mass);
  const U = Number(conditions.speed);
  if (![phi, r, m, U, chord].every((v) => Number.isFinite(v) && v > 0)) return null;
  const rho = (phi / (Math.PI * r * r)) * m;
  return 0.5 * rho * U * U * chord;
}

/** Drag, lift and their coefficients from a finished run. `chord` is the chord of the body that was simulated [d]. */
export function measuredForces(run: Pick<RunSummary, 'forces' | 'conditions'>, chord: number): ForceMeasure | null {
  const ref = referenceForce(run.conditions, chord);
  if (ref === null) return null;
  const drag = run.forces.fx;
  const lift = run.forces.fy;
  return { drag, lift, dragCoeff: scale(drag, 1 / ref), liftCoeff: scale(lift, 1 / ref), reference: ref, chord };
}
