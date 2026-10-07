import type { Domain } from '../core/Domain';
import type { ParticleStore } from '../core/ParticleStore';
import type { ForceModel } from '../core/Simulation';
import { SpatialGrid } from '../core/SpatialGrid';
import { lucyDW, lucyW, OCCUPANCY_MODEL_VERSION, type OccupancyModelConfig } from '../occupancy/OccupancyModel';

/**
 * The A-15 occupancy force (occupancy/OccupancyModel) for UB-0.
 *
 * `computeForces` is a line-for-line copy of OccupancyForce.computeForces: same
 * pair loop, kernel and floating-point operation order. A test checks that forces
 * and potential energy are bit-identical to OccupancyForce.
 *
 * Stress diagnostics are a SEPARATE, read-only pass (`measure`) over the same
 * pairs. It never writes forces and never feeds back into the dynamics. With
 * r_ij = x_i − x_j (minimum image) and f_ij = force on i from j it returns:
 *   pair virial         W_αβ = Σ_{i<j} r_ij,α f_ij,β
 *   shear projection    C = Σ f_ij,x y_ij cos(k ȳ) sinc(k y_ij/2),  S = … sin(k ȳ) …,
 *                       ȳ = y_j + y_ij/2 (exact pair form of the Fourier stress)
 *   method of planes    flux(y₀) += f |y_ij| for each plane y₀ between y_j and y_i
 */
export interface OccupancyMeasurement {
  wxx: number;
  wyy: number;
  wxy: number;
  projCos: number;
  projSin: number;
}

export class UBOccupancyForce implements ForceModel {
  readonly name = 'occupancy';
  readonly version = OCCUPANCY_MODEL_VERSION;
  readonly config: OccupancyModelConfig;
  private grid: SpatialGrid | null = null;
  private mgrid: SpatialGrid | null = null;

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

  /**
   * Read-only diagnostic pass at the current positions.
   * kY: shear-projection wavenumber (0 = off). planes: method-of-planes tallies
   * (bounded y only), flux added into `planes.flux`.
   */
  measure(
    store: ParticleStore,
    domain: Domain,
    kY: number,
    planes: { y0: number; spacing: number; flux: Float64Array } | null = null,
  ): OccupancyMeasurement {
    const { ks, h } = this.config;
    const out = { wxx: 0, wyy: 0, wxy: 0, projCos: 0, projSin: 0 };
    if (ks === 0) return out;
    if (!this.mgrid || this.mgrid.cellItems.length < store.capacity) {
      this.mgrid = new SpatialGrid(domain, h, store.capacity);
    }
    this.mgrid.build(store);
    const { radius, y } = store;
    const nPlanes = planes ? planes.flux.length : 0;
    this.mgrid.forEachPairWithin(store, h, (i, j, dx, dy, r2) => {
      const r = Math.sqrt(r2);
      if (r === 0) return;
      const a = 0.5 * Math.PI * (radius[i] * radius[i] + radius[j] * radius[j]);
      const f = (-ks * a * lucyDW(r, h)) / r;
      out.wxx += f * dx * dx;
      out.wyy += f * dy * dy;
      out.wxy += f * dx * dy;
      if (kY !== 0) {
        const ybar = y[j] + 0.5 * dy;
        const u = 0.5 * kY * dy;
        const sinc = u === 0 ? 1 : Math.sin(u) / u;
        const w = f * dx * dy * sinc;
        out.projCos += w * Math.cos(kY * ybar);
        out.projSin += w * Math.sin(kY * ybar);
      }
      if (planes) {
        const lo = Math.min(y[i], y[j]);
        const hi = Math.max(y[i], y[j]);
        let p = Math.ceil((lo - planes.y0) / planes.spacing);
        if (p < 0) p = 0;
        const fv = f * Math.abs(dy);
        for (; p < nPlanes; p++) {
          if (planes.y0 + p * planes.spacing >= hi) break;
          planes.flux[p] += fv;
        }
      }
    });
    return out;
  }

  /**
   * Read-only stiffness diagnostic (design §11.6): the largest occupancy angular
   * frequency over parcels, ω_i = √(|λ|_max(K_i)/M_i), with K_i = Σ_j the Hessian
   * of k_s a W(r_ij): φ″ n̂n̂ + (φ′/r)(1 − n̂n̂). Lucy: W″ = −60/(π h⁴)(1 − q)(1 − 3q).
   * The caller multiplies by dt; the design requires max ω·dt ≤ 0.02 on sample steps.
   */
  maxOmega(store: ParticleStore, domain: Domain): number {
    const { ks, h } = this.config;
    if (ks === 0) return 0;
    if (!this.mgrid || this.mgrid.cellItems.length < store.capacity) {
      this.mgrid = new SpatialGrid(domain, h, store.capacity);
    }
    this.mgrid.build(store);
    const n = store.count;
    const kxx = new Float64Array(n);
    const kyy = new Float64Array(n);
    const kxy = new Float64Array(n);
    const { radius, mass } = store;
    const c2 = -60 / (Math.PI * h * h * h * h);
    this.mgrid.forEachPairWithin(store, h, (i, j, dx, dy, r2) => {
      const r = Math.sqrt(r2);
      if (r === 0) return;
      const a = 0.5 * Math.PI * (radius[i] * radius[i] + radius[j] * radius[j]);
      const q = r / h;
      const d1 = ks * a * lucyDW(r, h);
      const d2 = ks * a * c2 * (1 - q) * (1 - 3 * q);
      const nx = dx / r;
      const ny = dy / r;
      const t = d1 / r;
      const hxx = d2 * nx * nx + t * (1 - nx * nx);
      const hyy = d2 * ny * ny + t * (1 - ny * ny);
      const hxy = (d2 - t) * nx * ny;
      kxx[i] += hxx;
      kyy[i] += hyy;
      kxy[i] += hxy;
      kxx[j] += hxx;
      kyy[j] += hyy;
      kxy[j] += hxy;
    });
    let w2 = 0;
    for (let i = 0; i < n; i++) {
      const m = 0.5 * (kxx[i] + kyy[i]);
      const d = Math.hypot(0.5 * (kxx[i] - kyy[i]), kxy[i]);
      const lam = Math.max(Math.abs(m + d), Math.abs(m - d));
      if (lam / mass[i] > w2) w2 = lam / mass[i];
    }
    return Math.sqrt(w2);
  }
}
