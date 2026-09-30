import type { Domain } from '../core/Domain';
import type { ParticleStore } from '../core/ParticleStore';
import type { ForceModel } from '../core/Simulation';
import { SpatialGrid } from '../core/SpatialGrid';

/**
 * OCCUPANCY-RESTORATION HYPOTHESIS (Bible §11, Master prompt §13)
 * — an experimental coarse-graining hypothesis, OFF by default.
 *
 *   F_i = −k_s ∇φ(x_i)
 *
 * φ is estimated with a smooth, compactly supported 2D kernel of width h
 * (Lucy kernel, ∫W dA = 1):
 *   φ_i = Σ_{j≠i} a_ij W(|x_i − x_j|; h),    a_ij = π (r_i² + r_j²)/2
 *   W(r; h) = 5/(π h²) · (1 + 3q)(1 − q)³,   q = r/h < 1
 * The pair weight a_ij is the mean disk area of the pair. For equal disks it is
 * exactly the particle area (φ is then the local area fraction); the symmetric
 * choice makes the force pairwise antisymmetric, so the model conserves
 * momentum, and conservative, with potential energy
 *   U = k_s Σ_{i<j} a_ij W(r_ij; h).
 * These are properties of THIS discretisation of the hypothesis, recorded in
 * docs/MODEL_ASSUMPTIONS.md (A-15), not claims about real gases.
 *
 * Integration: velocity Verlet kicks around the collision step (core/Simulation).
 * Energy is then conserved to O(dt²), not to round-off; the ledger residual
 * measures it.
 */
export interface OccupancyModelConfig {
  ks: number;
  /** kernel support radius h (model units) */
  h: number;
}

export const OCCUPANCY_MODEL_VERSION = 'occupancy-lucy-pairwise/1';

export function lucyW(r: number, h: number): number {
  const q = r / h;
  if (q >= 1) return 0;
  const a = 1 - q;
  return (5 / (Math.PI * h * h)) * (1 + 3 * q) * a * a * a;
}

/** dW/dr for the Lucy kernel: −60/(π h³) · q (1 − q)². */
export function lucyDW(r: number, h: number): number {
  const q = r / h;
  if (q >= 1) return 0;
  const a = 1 - q;
  return (-60 / (Math.PI * h * h * h)) * q * a * a;
}

export class OccupancyForce implements ForceModel {
  readonly name = 'occupancy';
  readonly version = OCCUPANCY_MODEL_VERSION;
  readonly config: OccupancyModelConfig;
  private grid: SpatialGrid | null = null;

  constructor(config: OccupancyModelConfig) {
    if (!(config.ks >= 0)) throw new Error(`ks must be ≥ 0, got ${config.ks}`);
    if (!(config.h > 0)) throw new Error(`kernel width h must be > 0, got ${config.h}`);
    this.config = config;
  }

  computeForces(store: ParticleStore, domain: Domain): number {
    const { ks, h } = this.config;
    if (ks === 0) return 0;
    if (!this.grid || this.grid.cellItems.length < store.capacity) {
      this.grid = new SpatialGrid(domain, h, store.capacity);
    }
    this.grid.build(store);
    const { fx, fy, radius } = store;
    let U = 0;
    this.grid.forEachPairWithin(store, h, (i, j, dx, dy, r2) => {
      const r = Math.sqrt(r2);
      if (r === 0) return;
      const a = 0.5 * Math.PI * (radius[i] * radius[i] + radius[j] * radius[j]);
      U += ks * a * lucyW(r, h);
      // F_i = −ks a dW/dr · (x_i − x_j)/r ;  F_j = −F_i
      const f = (-ks * a * lucyDW(r, h)) / r;
      fx[i] += f * dx;
      fy[i] += f * dy;
      fx[j] -= f * dx;
      fy[j] -= f * dy;
    });
    return U;
  }

  /** φ_i seen by each particle (self excluded), for diagnostics and the inspector. */
  occupancyAt(store: ParticleStore, domain: Domain, out: Float64Array): void {
    const h = this.config.h;
    if (!this.grid || this.grid.cellItems.length < store.capacity) this.grid = new SpatialGrid(domain, h, store.capacity);
    this.grid.build(store);
    out.fill(0, 0, store.count);
    const { radius } = store;
    this.grid.forEachPairWithin(store, h, (i, j, _dx, _dy, r2) => {
      const a = 0.5 * Math.PI * (radius[i] * radius[i] + radius[j] * radius[j]);
      const w = a * lucyW(Math.sqrt(r2), h);
      out[i] += w;
      out[j] += w;
    });
  }
}
