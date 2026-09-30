import type { CollisionLog } from '../core/CollisionLog';
import type { Domain } from '../core/Domain';
import type { ParticleStore } from '../core/ParticleStore';

/**
 * Time-averaged coarse-grained fields on a regular grid (Bible §4 level 3,
 * Master prompt §21 temporal + spatial averaging).
 *
 * Each `add()` accumulates, per cell: particle count, disk area, mass,
 * momentum and kinetic energy. Averages are ratios of the accumulated sums:
 *   φ    = Σ area / (snapshots · A_cell)
 *   ρ    = Σ m / (snapshots · A_cell)
 *   u    = Σ m v / Σ m
 *   kT   = (Σ ½m|v|² − ½|Σ m v|²/Σ m) / Σ count   (peculiar w.r.t. the averaged u)
 * The number of snapshots and the mean particles per cell per snapshot are
 * reported with every field so that noise is never mistaken for structure.
 *
 * Local stress (pressure and shear) is the particle stress tensor
 *   P_αβ = [Σ m (v−u)_α (v−u)_β] / (snapshots · A_cell)          kinetic part
 *        + [Σ_collisions d n_α J n_β] / (T_c · A_cell)            collisional part
 * where each logged pair collision (contact normal n, impulse J, contact
 * distance d) is assigned to the cell of its contact point and T_c is the time
 * spanned by the consumed collision events (`addCollisions`). Pressure is
 * (P_xx + P_yy)/2, shear is τ_xy = −P_xy. Without collision events only the
 * kinetic part is present, which the caller must say. Wall impulses remain
 * the measurement used for reported wall pressure and shear.
 */
export type FieldName = 'occupancy' | 'occupancyGradient' | 'density' | 'speed' | 'ux' | 'uy' | 'kT' | 'pressure' | 'shear';

export class FieldAverager {
  readonly nx: number;
  readonly ny: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly domain: Domain;
  snapshots = 0;
  private readonly count: Float64Array;
  private readonly area: Float64Array;
  private readonly mass: Float64Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly ke: Float64Array;
  private readonly sxx: Float64Array;
  private readonly syy: Float64Array;
  private readonly sxy: Float64Array;
  private readonly cxx: Float64Array;
  private readonly cyy: Float64Array;
  private readonly cxy: Float64Array;
  private logCursor = -1;
  private collisionStart = 0;
  /** time spanned by the collision events consumed so far */
  collisionTime = 0;
  collisionsUsed = 0;
  /** events that left the collision log's ring buffer before they were consumed */
  collisionsLost = 0;

  constructor(domain: Domain, nx: number, ny: number) {
    this.domain = domain;
    this.nx = Math.max(1, Math.floor(nx));
    this.ny = Math.max(1, Math.floor(ny));
    this.cellW = domain.width / this.nx;
    this.cellH = domain.height / this.ny;
    const n = this.nx * this.ny;
    this.count = new Float64Array(n);
    this.area = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.ke = new Float64Array(n);
    this.sxx = new Float64Array(n);
    this.syy = new Float64Array(n);
    this.sxy = new Float64Array(n);
    this.cxx = new Float64Array(n);
    this.cyy = new Float64Array(n);
    this.cxy = new Float64Array(n);
  }

  private cellOf(px: number, py: number): number {
    const d = this.domain;
    let cx = Math.floor((px - d.xmin) / this.cellW);
    let cy = Math.floor((py - d.ymin) / this.cellH);
    if (cx < 0) cx = 0;
    else if (cx >= this.nx) cx = this.nx - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.ny) cy = this.ny - 1;
    return cy * this.nx + cx;
  }

  /**
   * Consume pair-collision events logged since the previous call (the first
   * call only sets the starting point). `diameter` is the contact distance.
   */
  addCollisions(log: CollisionLog, diameter: number, time: number): void {
    if (this.logCursor < 0) {
      this.logCursor = log.count;
      this.collisionStart = time;
      return;
    }
    const fresh = log.count - this.logCursor;
    const avail = Math.min(fresh, log.retained);
    this.collisionsLost += fresh - avail;
    for (let k = 0; k < avail; k++) {
      const e = log.recent(k);
      const c = this.cellOf(e.x, e.y);
      this.cxx[c] += diameter * e.nx * e.dpx;
      this.cyy[c] += diameter * e.ny * e.dpy;
      this.cxy[c] += diameter * e.nx * e.dpy;
    }
    this.collisionsUsed += avail;
    this.logCursor = log.count;
    this.collisionTime = time - this.collisionStart;
  }

  /** Grid with about `perCell` particles per cell per snapshot, matching the domain aspect ratio. */
  static forParticlesPerCell(domain: Domain, particles: number, perCell: number): FieldAverager {
    const cells = Math.max(1, particles / Math.max(1, perCell));
    const aspect = domain.width / domain.height;
    const nx = Math.max(1, Math.round(Math.sqrt(cells * aspect)));
    const ny = Math.max(1, Math.round(cells / nx));
    return new FieldAverager(domain, nx, ny);
  }

  add(store: ParticleStore): void {
    const { x, y, vx, vy, mass, radius } = store;
    const d = this.domain;
    for (let i = 0; i < store.count; i++) {
      let cx = Math.floor((x[i] - d.xmin) / this.cellW);
      let cy = Math.floor((y[i] - d.ymin) / this.cellH);
      if (cx < 0) cx = 0;
      else if (cx >= this.nx) cx = this.nx - 1;
      if (cy < 0) cy = 0;
      else if (cy >= this.ny) cy = this.ny - 1;
      const c = cy * this.nx + cx;
      const m = mass[i];
      this.count[c] += 1;
      this.area[c] += Math.PI * radius[i] * radius[i];
      this.mass[c] += m;
      this.px[c] += m * vx[i];
      this.py[c] += m * vy[i];
      this.ke[c] += 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i]);
      this.sxx[c] += m * vx[i] * vx[i];
      this.syy[c] += m * vy[i] * vy[i];
      this.sxy[c] += m * vx[i] * vy[i];
    }
    this.snapshots++;
  }

  meanParticlesPerCell(): number {
    let t = 0;
    for (let c = 0; c < this.count.length; c++) t += this.count[c];
    return this.snapshots > 0 ? t / this.snapshots / this.count.length : 0;
  }

  field(name: FieldName): Float64Array {
    const n = this.nx * this.ny;
    const out = new Float64Array(n);
    const A = this.cellW * this.cellH * Math.max(1, this.snapshots);
    for (let c = 0; c < n; c++) {
      const M = this.mass[c];
      const ux = M > 0 ? this.px[c] / M : 0;
      const uy = M > 0 ? this.py[c] / M : 0;
      switch (name) {
        case 'occupancy':
        case 'occupancyGradient':
          out[c] = this.area[c] / A;
          break;
        case 'density':
          out[c] = M / A;
          break;
        case 'speed':
          out[c] = Math.hypot(ux, uy);
          break;
        case 'ux':
          out[c] = ux;
          break;
        case 'uy':
          out[c] = uy;
          break;
        case 'kT':
          out[c] = this.count[c] > 0 ? (this.ke[c] - (0.5 * (this.px[c] ** 2 + this.py[c] ** 2)) / M) / this.count[c] : 0;
          break;
        case 'pressure':
        case 'shear': {
          const Ac = this.cellW * this.cellH;
          const kxx = M > 0 ? (this.sxx[c] - M * ux * ux) / A : 0;
          const kyy = M > 0 ? (this.syy[c] - M * uy * uy) / A : 0;
          const kxy = M > 0 ? (this.sxy[c] - M * ux * uy) / A : 0;
          const T = this.collisionTime;
          const pxx = kxx + (T > 0 ? this.cxx[c] / (T * Ac) : 0);
          const pyy = kyy + (T > 0 ? this.cyy[c] / (T * Ac) : 0);
          const pxy = kxy + (T > 0 ? this.cxy[c] / (T * Ac) : 0);
          out[c] = name === 'pressure' ? 0.5 * (pxx + pyy) : -pxy;
          break;
        }
      }
    }
    if (name === 'occupancyGradient') {
      const phi = out.slice();
      const at = (x: number, y: number) => phi[Math.min(this.ny - 1, Math.max(0, y)) * this.nx + Math.min(this.nx - 1, Math.max(0, x))];
      for (let cy = 0; cy < this.ny; cy++) {
        for (let cx = 0; cx < this.nx; cx++) {
          const gx = (at(cx + 1, cy) - at(cx - 1, cy)) / (2 * this.cellW);
          const gy = (at(cx, cy + 1) - at(cx, cy - 1)) / (2 * this.cellH);
          out[cy * this.nx + cx] = Math.hypot(gx, gy);
        }
      }
    }
    return out;
  }
}
