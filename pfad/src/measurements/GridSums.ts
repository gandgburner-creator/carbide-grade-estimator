import type { CollisionLog } from '../core/CollisionLog';
import type { ParticleStore } from '../core/ParticleStore';

/**
 * Raw per-cell sums of particle data on a regular grid covering a rectangular
 * region (measurement only; nothing here feeds back into a run).
 *
 * Unlike FieldAverager, a particle whose centre lies OUTSIDE the region is
 * skipped (not clamped into an edge cell), and the raw sums are exposed so
 * that seeds can be combined and grids coarsened exactly afterwards:
 *   count  Σ 1            px  Σ m v_x        py  Σ m v_y
 *   sxx    Σ m v_x²       syy Σ m v_y²       sxy Σ m v_x v_y
 * per cell, summed over `snapshots` snapshots. Optionally (`collisional`) the
 * pair-collision virial is accumulated from the collision log as in
 * FieldAverager: per event at contact point c with unit normal n (j → i),
 * contact distance d and momentum change Δp of particle i,
 *   cxx += d n_x Δp_x,  cyy += d n_y Δp_y,  cxy += d n_x Δp_y,
 * over the time `collisionTime` spanned by the consumed events.
 * Derived fields (all measured):
 *   n = count/(snapshots·A),  u = px/(m·count) for equal masses,
 *   kinetic stress P^k_αβ = (s_αβ − p_α p_β / M)/(snapshots·A),
 *   collisional stress P^c_αβ = c_αβ / (collisionTime·A).
 */
export interface GridSumsData {
  x0: number;
  y0: number;
  cellW: number;
  cellH: number;
  nx: number;
  ny: number;
  snapshots: number;
  count: number[];
  px: number[];
  py: number[];
  sxx?: number[];
  syy?: number[];
  sxy?: number[];
  cxx?: number[];
  cyy?: number[];
  cxy?: number[];
  collisionTime?: number;
  collisionsLost?: number;
}

export class GridSums {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly nx: number;
  readonly ny: number;
  readonly second: boolean;
  readonly collisional: boolean;
  snapshots = 0;
  readonly count: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly sxx: Float64Array;
  readonly syy: Float64Array;
  readonly sxy: Float64Array;
  readonly cxx: Float64Array;
  readonly cyy: Float64Array;
  readonly cxy: Float64Array;
  private logCursor = -1;
  private collisionStart = 0;
  collisionTime = 0;
  collisionsLost = 0;
  /** periodic length along x for wrapping collision contact points (0 = none) */
  private readonly periodX: number;

  constructor(
    region: { x0: number; y0: number; x1: number; y1: number },
    cellW: number,
    cellH: number,
    opts: { second?: boolean; collisional?: boolean; periodX?: number } = {},
  ) {
    this.x0 = region.x0;
    this.y0 = region.y0;
    this.x1 = region.x1;
    this.y1 = region.y1;
    this.nx = Math.round((region.x1 - region.x0) / cellW);
    this.ny = Math.round((region.y1 - region.y0) / cellH);
    if (this.nx < 1 || this.ny < 1) throw new Error('grid needs at least one cell');
    if (Math.abs(this.nx * cellW - (region.x1 - region.x0)) > 1e-9 || Math.abs(this.ny * cellH - (region.y1 - region.y0)) > 1e-9) {
      throw new Error('region must be a whole number of cells');
    }
    this.cellW = cellW;
    this.cellH = cellH;
    this.second = opts.second ?? true;
    this.collisional = opts.collisional ?? false;
    this.periodX = opts.periodX ?? 0;
    const n = this.nx * this.ny;
    const z = (on: boolean) => new Float64Array(on ? n : 0);
    this.count = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.sxx = z(this.second);
    this.syy = z(this.second);
    this.sxy = z(this.second);
    this.cxx = z(this.collisional);
    this.cyy = z(this.collisional);
    this.cxy = z(this.collisional);
  }

  /** Cell index of a point, or −1 outside the region. */
  cellOf(px: number, py: number): number {
    if (px < this.x0 || px >= this.x1 || py < this.y0 || py >= this.y1) return -1;
    let cx = Math.floor((px - this.x0) / this.cellW);
    let cy = Math.floor((py - this.y0) / this.cellH);
    if (cx >= this.nx) cx = this.nx - 1;
    if (cy >= this.ny) cy = this.ny - 1;
    return cy * this.nx + cx;
  }

  add(store: ParticleStore): void {
    const { x, y, vx, vy, mass } = store;
    const second = this.second;
    for (let i = 0; i < store.count; i++) {
      const c = this.cellOf(x[i], y[i]);
      if (c < 0) continue;
      const m = mass[i];
      const mx = m * vx[i];
      const my = m * vy[i];
      this.count[c] += 1;
      this.px[c] += mx;
      this.py[c] += my;
      if (second) {
        this.sxx[c] += mx * vx[i];
        this.syy[c] += my * vy[i];
        this.sxy[c] += mx * vy[i];
      }
    }
    this.snapshots++;
  }

  /** Consume pair-collision events logged since the previous call (the first call only sets the start). */
  addCollisions(log: CollisionLog, diameter: number, time: number): void {
    if (!this.collisional) return;
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
      let ex = e.x;
      if (this.periodX > 0) ex -= this.periodX * Math.floor(ex / this.periodX);
      const c = this.cellOf(ex, e.y);
      if (c < 0) continue;
      this.cxx[c] += diameter * e.nx * e.dpx;
      this.cyy[c] += diameter * e.ny * e.dpy;
      this.cxy[c] += diameter * e.nx * e.dpy;
    }
    this.logCursor = log.count;
    this.collisionTime = time - this.collisionStart;
  }

  data(digits = 7): GridSumsData {
    const r = (a: Float64Array) => Array.from(a, (v) => Number(v.toPrecision(digits)));
    const d: GridSumsData = {
      x0: this.x0,
      y0: this.y0,
      cellW: this.cellW,
      cellH: this.cellH,
      nx: this.nx,
      ny: this.ny,
      snapshots: this.snapshots,
      count: r(this.count),
      px: r(this.px),
      py: r(this.py),
    };
    if (this.second) {
      d.sxx = r(this.sxx);
      d.syy = r(this.syy);
      d.sxy = r(this.sxy);
    }
    if (this.collisional) {
      d.cxx = r(this.cxx);
      d.cyy = r(this.cyy);
      d.cxy = r(this.cxy);
      d.collisionTime = this.collisionTime;
      d.collisionsLost = this.collisionsLost;
    }
    return d;
  }
}
