import type { Domain } from '../core/Domain';
import type { ParticleStore } from '../core/ParticleStore';

/**
 * Coarse-grained fields on a regular grid (Bible §4, level 3).
 *
 * Occupancy is the 2D area fraction (docs/MODEL_ASSUMPTIONS.md A-02):
 *   φ_cell = Σ_{i in cell} π r_i² / A_cell
 * assigned by particle centre (nearest-grid-point). Also accumulates number,
 * mass density, mean velocity and the kinetic temperature proxy per cell.
 *
 * This is a MEASUREMENT of the particle state. It does not feed back into the
 * dynamics (the occupancy force hypothesis lives in OccupancyModel).
 */
export class OccupancyField {
  readonly nx: number;
  readonly ny: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly domain: Domain;
  readonly count: Float64Array;
  readonly phi: Float64Array;
  readonly density: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  /** per-cell kT proxy = ⟨½ m |v − u|²⟩ (2D: one kT per particle) */
  readonly kT: Float64Array;
  private readonly mom2: Float64Array;

  constructor(domain: Domain, nx: number, ny: number) {
    this.domain = domain;
    this.nx = Math.max(1, Math.floor(nx));
    this.ny = Math.max(1, Math.floor(ny));
    this.cellW = domain.width / this.nx;
    this.cellH = domain.height / this.ny;
    const n = this.nx * this.ny;
    this.count = new Float64Array(n);
    this.phi = new Float64Array(n);
    this.density = new Float64Array(n);
    this.ux = new Float64Array(n);
    this.uy = new Float64Array(n);
    this.kT = new Float64Array(n);
    this.mom2 = new Float64Array(n);
  }

  /** Grid whose cells hold `perCell` particles on average (for noise-controlled diagnostics). */
  static withMeanOccupancy(domain: Domain, particleCount: number, perCell: number): OccupancyField {
    const cells = Math.max(1, particleCount / perCell);
    const aspect = domain.width / domain.height;
    const nx = Math.max(1, Math.round(Math.sqrt(cells * aspect)));
    const ny = Math.max(1, Math.round(cells / nx));
    return new OccupancyField(domain, nx, ny);
  }

  cellIndex(x: number, y: number): number {
    let cx = Math.floor((x - this.domain.xmin) / this.cellW);
    let cy = Math.floor((y - this.domain.ymin) / this.cellH);
    if (cx < 0) cx = 0;
    else if (cx >= this.nx) cx = this.nx - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.ny) cy = this.ny - 1;
    return cy * this.nx + cx;
  }

  compute(store: ParticleStore): void {
    this.count.fill(0);
    this.phi.fill(0);
    this.density.fill(0);
    this.ux.fill(0);
    this.uy.fill(0);
    this.kT.fill(0);
    this.mom2.fill(0);
    const { x, y, vx, vy, mass, radius } = store;
    for (let i = 0; i < store.count; i++) {
      const c = this.cellIndex(x[i], y[i]);
      const m = mass[i];
      this.count[c] += 1;
      this.phi[c] += Math.PI * radius[i] * radius[i];
      this.density[c] += m;
      this.ux[c] += m * vx[i];
      this.uy[c] += m * vy[i];
      this.mom2[c] += 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i]);
    }
    const A = this.cellW * this.cellH;
    for (let c = 0; c < this.phi.length; c++) {
      const M = this.density[c];
      if (M > 0) {
        this.ux[c] /= M;
        this.uy[c] /= M;
        // peculiar kinetic energy per particle: Σ½m v² − ½ M u²
        const ke = this.mom2[c] - 0.5 * M * (this.ux[c] ** 2 + this.uy[c] ** 2);
        this.kT[c] = ke / this.count[c];
      }
      this.phi[c] /= A;
      this.density[c] /= A;
    }
  }

  stats() {
    let pmin = Infinity;
    let pmax = -Infinity;
    let psum = 0;
    let dmin = Infinity;
    let dmax = -Infinity;
    for (let c = 0; c < this.phi.length; c++) {
      const p = this.phi[c];
      const d = this.density[c];
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      psum += p;
    }
    return { phiMin: pmin, phiMax: pmax, phiMean: psum / this.phi.length, densityMin: dmin, densityMax: dmax };
  }
}
