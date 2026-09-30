/**
 * Timestep policies. The timestep is a NUMERICAL parameter; every experiment
 * records it and timestep-convergence studies vary it.
 *
 * fixed    : constant dt.
 * adaptive : dt = clamp(courant · d_min / v_max, dtMin, dtMax) — limits the
 *            largest displacement per step to a fraction `courant` of the
 *            smallest particle diameter. Deterministic (depends only on state).
 */
export type TimestepPolicy =
  | { kind: 'fixed'; dt: number }
  | { kind: 'adaptive'; courant: number; dtMax: number; dtMin: number };

export function chooseTimestep(policy: TimestepPolicy, maxSpeed: number, minDiameter: number): number {
  if (policy.kind === 'fixed') return policy.dt;
  if (!(maxSpeed > 0)) return policy.dtMax;
  const dt = (policy.courant * minDiameter) / maxSpeed;
  return Math.min(policy.dtMax, Math.max(policy.dtMin, dt));
}

export function validateTimestepPolicy(policy: TimestepPolicy): void {
  if (policy.kind === 'fixed') {
    if (!(policy.dt > 0)) throw new Error(`fixed dt must be > 0, got ${policy.dt}`);
    return;
  }
  if (!(policy.courant > 0 && policy.courant <= 1)) throw new Error(`courant must be in (0,1], got ${policy.courant}`);
  if (!(policy.dtMin > 0 && policy.dtMax >= policy.dtMin)) throw new Error('adaptive dt needs 0 < dtMin ≤ dtMax');
}
