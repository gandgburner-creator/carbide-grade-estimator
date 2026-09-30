/**
 * Numerical-safety monitor (Master prompt §34).
 *
 * Detects NaN/∞, negative mass, particle explosion, excessive overlap,
 * out-of-domain particles, energy blow-up and momentum-accounting drift.
 * A failure HALTS the simulation and is reported. Nothing is repaired.
 */
export type SafetyCode =
  | 'NAN_OR_INFINITE'
  | 'NEGATIVE_MASS'
  | 'PARTICLE_EXPLOSION'
  | 'EXCESSIVE_OVERLAP'
  | 'OUT_OF_DOMAIN'
  | 'ENERGY_BLOW_UP'
  | 'MOMENTUM_DRIFT'
  | 'DEGENERATE_CONTACT'
  | 'INITIAL_OVERLAP'
  | 'LATE_CONTACT_UNEXPLAINED'
  | 'OCCUPANCY_COLLAPSE'
  | 'TIMESTEP_FLOOR'
  | 'INSIDE_BODY';

export interface SafetyFlag {
  code: SafetyCode;
  severity: 'warning' | 'failure';
  message: string;
  time: number;
  step: number;
}

export interface SafetyLimits {
  /** max speed allowed, as a multiple of the reference speed sqrt(kT_ref/m) */
  maxSpeedFactor: number;
  /** relative energy-accounting residual that counts as failure */
  energyTolerance: number;
  /** relative momentum-accounting residual that counts as failure */
  momentumTolerance: number;
  /** overlap depth / contact distance: warning and failure levels */
  overlapWarning: number;
  overlapFailure: number;
  /** how often (steps) the O(N) checks run; NaN checks run at the same cadence */
  checkInterval: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxSpeedFactor: 60,
  energyTolerance: 1e-6,
  momentumTolerance: 1e-6,
  overlapWarning: 0.25,
  overlapFailure: 0.6,
  checkInterval: 10,
};
