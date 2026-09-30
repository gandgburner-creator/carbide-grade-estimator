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
 * Universe B reservoir release (optional HYPOTHESIS, `reservoirRelease` ρ ∈ [0,1],
 * only with dissipationTarget 'internal'): after the inelastic impulse, a
 * fraction ρ of the pair's stored internal energy E_i + E_j is returned to
 * their normal relative motion by a second impulse along n:
 *   v_n'' = sqrt(v_n'² + 2ρ(E_i + E_j)/μ),   J₂ = μ (v_n'' − v_n')
 * Momentum and total energy (kinetic + internal) are conserved exactly; the
 * transfer is recorded in Ledger.releasedFromInternal. ρ = 0 is a pure sink.
 * This is analogous to translational/internal energy exchange in molecular
 * gases; whether it yields a stable, gas-like parcel universe is an experiment.
 *
 * With continuous forces (occupancy, external) the stored velocities are the
 * velocity-Verlet half-step velocities v_½. The collision law is then
 * evaluated with the velocities AT THE CONTACT INSTANT,
 *   v_c = v_½ + (F/m)(dt/2 − τ),   τ = time since contact,
 * and the resulting impulse is applied to v_½. Evaluating it with v_½ instead
 * leaves an energy error F·Δv·(τ₁ − τ₂)/2 per collision (first order in dt,
 * measured and removed in model 0.2.0-p0.2; docs/MODEL_CHANGELOG.md).
 * Momentum stays exactly conserved either way.
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
  /** Universe B: fraction of the pair's internal energy returned per collision (default 0) */
  reservoirRelease?: number;
}

export const COLLISION_MODEL_VERSION = 'hard-disk-impulse/1 (+ optional reservoir release/1)';

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
    const rho = config.reservoirRelease ?? 0;
    if (!(rho >= 0 && rho <= 1)) throw new Error(`reservoirRelease must be in [0, 1], got ${rho}`);
    if (rho > 0 && config.dissipationTarget !== 'internal') {
      throw new Error('reservoirRelease needs dissipationTarget "internal" (there is no reservoir otherwise)');
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
    forcesActive = false,
  ): number {
    const e = this.config.restitution;
    const rewind = this.config.contact === 'rewind-to-contact';
    const toInternal = this.config.dissipationTarget === 'internal';
    const release = this.config.reservoirRelease ?? 0;
    const { x, y, vx, vy, fx, fy, mass, radius, energy, collisions } = store;
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
      // straight-line relative motion during the drift (used for the rewind)
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
      // velocities at the contact instant (differ from v_½ only when forces act)
      const shift = forcesActive ? 0.5 * dt - tau : 0;
      const cvxi = vx[i] + (fx[i] / mi) * shift;
      const cvyi = vy[i] + (fy[i] / mi) * shift;
      const cvxj = vx[j] + (fx[j] / mj) * shift;
      const cvyj = vy[j] + (fy[j] / mj) * shift;
      const vn = (cvxi - cvxj) * nx + (cvyi - cvyj) * ny;
      // after a clamped rewind the pair can, in principle, already be separating
      // along the recomputed normal; then no impulse is applied.
      let J = 0;
      let dKE = 0;
      if (vn < 0) {
        J = (-(1 + e) * vn) / (1 / mi + 1 / mj);
        // kinetic energy change of the collision, evaluated at the contact instant
        const kePre = 0.5 * mi * (cvxi * cvxi + cvyi * cvyi) + 0.5 * mj * (cvxj * cvxj + cvyj * cvyj);
        vx[i] += (J / mi) * nx;
        vy[i] += (J / mi) * ny;
        vx[j] -= (J / mj) * nx;
        vy[j] -= (J / mj) * ny;
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
        if (release > 0) {
          const Eint = energy[i] + energy[j];
          if (Eint > 0) {
            const dE = release * Eint;
            const mu = (mi * mj) / (mi + mj);
            const vnPost = -e * vn;
            const J2 = mu * (Math.sqrt(vnPost * vnPost + (2 * dE) / mu) - vnPost);
            vx[i] += (J2 / mi) * nx;
            vy[i] += (J2 / mi) * ny;
            vx[j] -= (J2 / mj) * nx;
            vy[j] -= (J2 / mj) * ny;
            energy[i] -= dE * (energy[i] / Eint);
            energy[j] = Eint - dE - energy[i];
            ledger.releasedFromInternal += dE;
            J += J2;
          }
        }
        const pvxi = cvxi + (J / mi) * nx;
        const pvyi = cvyi + (J / mi) * ny;
        const pvxj = cvxj - (J / mj) * nx;
        const pvyj = cvyj - (J / mj) * ny;
        const kePost = 0.5 * mi * (pvxi * pvxi + pvyi * pvyi) + 0.5 * mj * (pvxj * pvxj + pvyj * pvyj);
        dKE = kePost - kePre;
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
