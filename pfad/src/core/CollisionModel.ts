import type { CollisionLog } from './CollisionLog';
import type { Domain } from './Domain';
import type { Ledger } from './Ledger';
import type { ParticleStore } from './ParticleStore';
import type { SpatialGrid } from './SpatialGrid';

/**
 * Hard-disk impulse collision law (Bible §9, Master prompt §8), exactly:
 *
 *   n   = (x_i − x_j)/|x_i − x_j|          (at contact)
 *   v_r = v_i − v_j,  v_n = v_r·n
 *   J   = −(1+e) v_n / (1/m_i + 1/m_j)
 *   v_i' = v_i + (J/m_i) n
 *   v_j' = v_j − (J/m_j) n
 *
 * A collision is processed when two disks overlap AND approach (v_n < 0).
 * Momentum is conserved by construction; for e = 1 kinetic energy is conserved
 * exactly in real arithmetic. For e < 1 the analytic loss
 *   ΔE = (1 − e²) · ½ μ v_n²,  μ = m_i m_j/(m_i + m_j)
 * is routed to one of two explicit destinations (`dissipationTarget`):
 *   'external' — energy leaves the model and is accumulated in Ledger.dissipatedExternal
 *   'internal' — Universe B reservoir: split equally into the two particles' `energy`
 *
 * Contact timing (numerical, NOT physical — see docs/MODEL_ASSUMPTIONS.md):
 * with a finite timestep, overlaps are detected after they occur.
 *   'rewind-to-contact'   : move the pair back along its straight-line motion to
 *                           the contact instant τ ago, apply the impulse there,
 *                           then advance by τ with the new velocities. Exact for
 *                           an isolated binary collision inside one step.
 *   'impulse-at-detection': apply the impulse at the overlapped positions. Cruder;
 *                           kept as a competing numerical model for convergence
 *                           studies.
 */
export type ContactResolution = 'rewind-to-contact' | 'impulse-at-detection';
export type DissipationTarget = 'external' | 'internal';

export interface CollisionConfig {
  enabled: boolean;
  restitution: number;
  contact: ContactResolution;
  dissipationTarget: DissipationTarget;
}

export const COLLISION_MODEL_VERSION = 'hard-disk-impulse/1';

export class HardDiskCollider {
  readonly config: CollisionConfig;
  /** step index of each particle's most recent pair collision (multi-collision diagnostic) */
  private lastStep: Int32Array;
  /** step index of each particle's most recent pair OR wall event (shared with walls) */
  readonly lastEventStep: Int32Array;

  constructor(config: CollisionConfig, capacity: number) {
    if (!(config.restitution >= 0 && config.restitution <= 1)) {
      throw new Error(`restitution must be in [0, 1], got ${config.restitution}`);
    }
    this.config = config;
    this.lastStep = new Int32Array(capacity).fill(-10);
    this.lastEventStep = new Int32Array(capacity).fill(-10);
  }

  /**
   * Detect and resolve all overlapping, approaching pairs.
   * Returns the number of collisions processed.
   */
  resolveAll(
    store: ParticleStore,
    grid: SpatialGrid,
    domain: Domain,
    dt: number,
    time: number,
    step: number,
    log: CollisionLog,
    ledger: Ledger,
    contactCutoff: number,
  ): number {
    const e = this.config.restitution;
    const rewind = this.config.contact === 'rewind-to-contact';
    const toInternal = this.config.dissipationTarget === 'internal';
    const { x, y, vx, vy, mass, radius, energy, collisions } = store;
    const lastStep = this.lastStep;
    const lastEvent = this.lastEventStep;
    let processed = 0;

    grid.forEachPairWithin(store, contactCutoff, (i, j, dx0, dy0, r2) => {
      const R = radius[i] + radius[j];
      if (r2 >= R * R) return;
      if (r2 === 0) {
        log.degenerateContacts++;
        return;
      }
      let dx = dx0;
      let dy = dy0;
      const dvx = vx[i] - vx[j];
      const dvy = vy[i] - vy[j];
      const b = dx * dvx + dy * dvy;
      if (b >= 0) return; // overlapping but already separating
      const overlap = (R - Math.sqrt(r2)) / R;
      if (overlap > log.maxOverlapFraction) log.maxOverlapFraction = overlap;

      let tau = 0;
      if (rewind) {
        const v2 = dvx * dvx + dvy * dvy;
        const c = r2 - R * R;
        tau = (b + Math.sqrt(b * b - v2 * c)) / v2;
        if (!(tau <= dt)) {
          tau = dt;
          log.lateContacts++;
          if (lastEvent[i] < step - 1 && lastEvent[j] < step - 1) log.lateContactsUnexplained++;
        }
        x[i] -= vx[i] * tau;
        y[i] -= vy[i] * tau;
        x[j] -= vx[j] * tau;
        y[j] -= vy[j] * tau;
        dx = domain.imageDx(x[i] - x[j]);
        dy = domain.imageDy(y[i] - y[j]);
      }
      if (lastStep[i] === step || lastStep[j] === step) log.multiCollisions++;
      lastStep[i] = step;
      lastStep[j] = step;
      lastEvent[i] = step;
      lastEvent[j] = step;

      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;
      const mi = mass[i];
      const mj = mass[j];
      const vn = dvx * nx + dvy * ny;
      // after a clamped rewind the pair can, in principle, already be separating
      // along the recomputed normal; then no impulse is applied.
      let J = 0;
      let dKE = 0;
      if (vn < 0) {
        J = (-(1 + e) * vn) / (1 / mi + 1 / mj);
        const kePre = 0.5 * mi * (vx[i] * vx[i] + vy[i] * vy[i]) + 0.5 * mj * (vx[j] * vx[j] + vy[j] * vy[j]);
        vx[i] += (J / mi) * nx;
        vy[i] += (J / mi) * ny;
        vx[j] -= (J / mj) * nx;
        vy[j] -= (J / mj) * ny;
        const kePost = 0.5 * mi * (vx[i] * vx[i] + vy[i] * vy[i]) + 0.5 * mj * (vx[j] * vx[j] + vy[j] * vy[j]);
        dKE = kePost - kePre;
        if (e < 1) {
          const mu = (mi * mj) / (mi + mj);
          const loss = (1 - e * e) * 0.5 * mu * vn * vn;
          if (toInternal) {
            energy[i] += 0.5 * loss;
            energy[j] += 0.5 * loss;
            ledger.dissipatedToInternal += loss;
          } else {
            ledger.dissipatedExternal += loss;
          }
        }
        collisions[i]++;
        collisions[j]++;
        processed++;
        const rj = radius[j];
        log.record(
          time - tau,
          i,
          j,
          domain.wrapX(x[j] + nx * rj),
          domain.wrapY(y[j] + ny * rj),
          nx,
          ny,
          vn,
          J,
          J * nx,
          J * ny,
          dKE,
          tau,
        );
      }
      if (rewind) {
        x[i] += vx[i] * tau;
        y[i] += vy[i] * tau;
        x[j] += vx[j] * tau;
        y[j] += vy[j] * tau;
      }
    });
    return processed;
  }
}
