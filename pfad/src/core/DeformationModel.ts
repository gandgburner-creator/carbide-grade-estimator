import type { Domain } from './Domain';
import type { ParticleStore } from './ParticleStore';
import type { ForceModel } from './Simulation';
import { SpatialGrid } from './SpatialGrid';

/**
 * SOFT-CONTACT DEFORMATION MODEL (Bible §10): a replaceable alternative to the
 * rigid impulse law.
 *
 *   overlap δ = (r_i + r_j) − |x_i − x_j|  (> 0 in contact)
 *   F = K δ n,   E_deformation = ½ K δ²
 *
 * Purely elastic (no damping), so it conserves energy up to the O(dt²)
 * velocity-Verlet error, which the ledger measures. When this model is active
 * the hard-disk collider must be disabled (collision.enabled = false): the two
 * contact laws are alternatives, not additions. As K → ∞ it should approach
 * the rigid model; that limit is an experiment, not an assumption.
 *
 * `deformation[i]` holds the largest overlap currently acting on particle i.
 * The contact must be resolved by the timestep: contact time ≈ π √(μ/K).
 */
export const DEFORMATION_MODEL_VERSION = 'soft-contact-linear-spring/1';

export class SoftContactForce implements ForceModel {
  readonly name = 'soft-contact';
  readonly version = DEFORMATION_MODEL_VERSION;
  readonly K: number;
  private grid: SpatialGrid | null = null;
  private cutoff = 0;
  /** number of contacts in the last force evaluation */
  contacts = 0;
  /** largest δ/(r_i + r_j) seen in any evaluation */
  maxRelativeOverlap = 0;

  constructor(K: number) {
    if (!(K > 0)) throw new Error(`stiffness K must be > 0, got ${K}`);
    this.K = K;
  }

  /** Shortest binary contact duration for this stiffness and the lightest pair. */
  static contactTime(K: number, minMass: number): number {
    return Math.PI * Math.sqrt(minMass / 2 / K);
  }

  computeForces(store: ParticleStore, domain: Domain): number {
    if (!this.grid || this.grid.cellItems.length < store.capacity) {
      this.cutoff = 2 * store.maxRadius();
      this.grid = new SpatialGrid(domain, this.cutoff, store.capacity);
    }
    this.grid.build(store);
    const { fx, fy, radius, deformation } = store;
    deformation.fill(0, 0, store.count);
    const K = this.K;
    let U = 0;
    let contacts = 0;
    this.grid.forEachPairWithin(store, this.cutoff, (i, j, dx, dy, r2) => {
      const R = radius[i] + radius[j];
      if (r2 >= R * R) return;
      const r = Math.sqrt(r2);
      if (r === 0) return;
      const delta = R - r;
      contacts++;
      U += 0.5 * K * delta * delta;
      const f = (K * delta) / r;
      fx[i] += f * dx;
      fy[i] += f * dy;
      fx[j] -= f * dx;
      fy[j] -= f * dy;
      if (delta > deformation[i]) deformation[i] = delta;
      if (delta > deformation[j]) deformation[j] = delta;
      if (delta / R > this.maxRelativeOverlap) this.maxRelativeOverlap = delta / R;
    });
    this.contacts = contacts;
    return U;
  }
}
