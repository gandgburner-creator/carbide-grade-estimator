import type { Domain } from '../core/Domain';
import type { Ledger } from '../core/Ledger';
import type { ParticleStore } from '../core/ParticleStore';
import type { Rng } from '../core/Random';

/**
 * Planar walls closing a bounded domain axis, with Maxwell-type accommodation.
 *
 * Accommodation coefficient Aw ∈ [0, 1] (Bible §14, Master prompt §15):
 *   with probability 1 − Aw the reflection is SPECULAR:  v_n' = −v_n, v_t' = v_t
 *   with probability Aw it is DIFFUSE: the particle is re-emitted from a wall
 *   Maxwellian at wall temperature kT_w moving with wall velocity U_w:
 *     v_n' = sqrt(−2 (kT_w/m) ln u)          (2D flux-weighted half-Maxwellian)
 *     v_t' = U_w + sqrt(kT_w/m) · g,  g ~ N(0,1)
 *
 * Aw is a microscopic wall-interaction parameter. It is NOT a viscosity or a
 * friction coefficient; any macroscopic drag it causes must be measured.
 *
 * Every interaction records, per measurement bin along the wall:
 *   hits, normal impulse into the wall, tangential impulse on the wall,
 *   and energy transferred from the gas to the wall.
 * These are cumulative; measurement code differences them between two times.
 *
 * Contact timing uses the same rewind-to-contact treatment as particle pairs:
 * the particle is moved back to the contact instant, re-emitted, and advanced
 * by the same time with its new velocity.
 */
export type WallSide = 'left' | 'right' | 'bottom' | 'top';

export interface PlaneWallConfig {
  side: WallSide;
  /** Aw: 0 = specular, 1 = fully diffuse */
  accommodation: number;
  /** kT_w used for diffuse re-emission (required if accommodation > 0) */
  temperature?: number;
  /** wall velocity along its tangent (+x for bottom/top, +y for left/right) */
  tangentialVelocity?: number;
  /** number of measurement bins along the wall */
  bins?: number;
}

export const WALL_MODEL_VERSION = 'maxwell-accommodation-plane/1';

export class PlaneWall {
  readonly config: Required<PlaneWallConfig>;
  /** wall coordinate along its normal axis */
  readonly position: number;
  /** inward unit normal */
  readonly nx: number;
  readonly ny: number;
  /** unit tangent (+x or +y) */
  readonly tx: number;
  readonly ty: number;
  /** extent along the tangent */
  readonly t0: number;
  readonly length: number;

  // cumulative per-bin measurements
  readonly hits: Float64Array;
  readonly normalImpulse: Float64Array;
  readonly tangentialImpulse: Float64Array;
  readonly energyIn: Float64Array;
  /** interactions whose rewind exceeded the step (particle was already inside the wall) */
  lateContacts = 0;

  constructor(config: PlaneWallConfig, domain: Domain) {
    const bins = config.bins ?? 1;
    const Aw = config.accommodation;
    if (!(Aw >= 0 && Aw <= 1)) throw new Error(`accommodation must be in [0,1], got ${Aw}`);
    if (Aw > 0 && !(config.temperature !== undefined && config.temperature > 0)) {
      throw new Error('a wall with accommodation > 0 needs a positive temperature');
    }
    this.config = {
      side: config.side,
      accommodation: Aw,
      temperature: config.temperature ?? 0,
      tangentialVelocity: config.tangentialVelocity ?? 0,
      bins,
    };
    switch (config.side) {
      case 'left':
        this.position = domain.xmin;
        [this.nx, this.ny, this.tx, this.ty] = [1, 0, 0, 1];
        this.t0 = domain.ymin;
        this.length = domain.height;
        break;
      case 'right':
        this.position = domain.xmax;
        [this.nx, this.ny, this.tx, this.ty] = [-1, 0, 0, 1];
        this.t0 = domain.ymin;
        this.length = domain.height;
        break;
      case 'bottom':
        this.position = domain.ymin;
        [this.nx, this.ny, this.tx, this.ty] = [0, 1, 1, 0];
        this.t0 = domain.xmin;
        this.length = domain.width;
        break;
      case 'top':
        this.position = domain.ymax;
        [this.nx, this.ny, this.tx, this.ty] = [0, -1, 1, 0];
        this.t0 = domain.xmin;
        this.length = domain.width;
        break;
    }
    if ((config.side === 'left' || config.side === 'right') && domain.periodicX) {
      throw new Error(`${config.side} wall on a periodic x axis`);
    }
    if ((config.side === 'bottom' || config.side === 'top') && domain.periodicY) {
      throw new Error(`${config.side} wall on a periodic y axis`);
    }
    this.hits = new Float64Array(bins);
    this.normalImpulse = new Float64Array(bins);
    this.tangentialImpulse = new Float64Array(bins);
    this.energyIn = new Float64Array(bins);
  }

  get binWidth(): number {
    return this.length / this.config.bins;
  }

  /** Signed distance of a point from the wall plane, positive inside the domain. */
  distance(px: number, py: number): number {
    const along = this.nx !== 0 ? px : py;
    const inward = this.nx !== 0 ? this.nx : this.ny;
    return (along - this.position) * inward;
  }

  /**
   * Resolve every particle that overlaps this wall and moves into it.
   * Returns the number of interactions.
   */
  interact(store: ParticleStore, dt: number, rng: Rng, ledger: Ledger): number {
    const { x, y, vx, vy, mass, radius, wallHits } = store;
    const { nx, ny, tx, ty } = this;
    const Aw = this.config.accommodation;
    const kTw = this.config.temperature;
    const Uw = this.config.tangentialVelocity;
    const bins = this.config.bins;
    const bw = this.length / bins;
    let count = 0;
    for (let i = 0; i < store.count; i++) {
      const s = this.distance(x[i], y[i]) - radius[i];
      if (s >= 0) continue;
      const vn = vx[i] * nx + vy[i] * ny;
      if (vn >= 0) continue; // overlapping but already leaving
      let tau = s / vn; // both negative → positive
      if (!(tau <= dt)) {
        tau = dt;
        this.lateContacts++;
      }
      // back to contact
      const px = x[i] - vx[i] * tau;
      const py = y[i] - vy[i] * tau;
      const m = mass[i];
      const vt = vx[i] * tx + vy[i] * ty;
      let vn2: number;
      let vt2: number;
      if (Aw > 0 && rng.next() < Aw) {
        const sigma = Math.sqrt(kTw / m);
        vn2 = Math.sqrt(-2 * (kTw / m) * Math.log(rng.nextOpen()));
        vt2 = Uw + sigma * rng.gaussian();
      } else {
        vn2 = -vn;
        vt2 = vt;
      }
      const nvx = vn2 * nx + vt2 * tx;
      const nvy = vn2 * ny + vt2 * ty;
      const dpx = m * (nvx - vx[i]);
      const dpy = m * (nvy - vy[i]);
      const dE = 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i] - nvx * nvx - nvy * nvy);
      vx[i] = nvx;
      vy[i] = nvy;
      x[i] = px + nvx * tau;
      y[i] = py + nvy * tau;

      // bookkeeping: impulse on the wall is −Δp_particle
      const along = (tx !== 0 ? px : py) - this.t0;
      let b = Math.floor(along / bw);
      if (b < 0) b = 0;
      else if (b >= bins) b = bins - 1;
      this.hits[b] += 1;
      this.normalImpulse[b] += m * (vn2 - vn); // pushes the wall outward (> 0)
      this.tangentialImpulse[b] += m * (vt - vt2); // along +tangent, on the wall
      this.energyIn[b] += dE;
      ledger.wallImpulseX += dpx;
      ledger.wallImpulseY += dpy;
      ledger.wallEnergyOut += dE;
      wallHits[i]++;
      count++;
    }
    return count;
  }

  totals() {
    let hits = 0;
    let normal = 0;
    let tangential = 0;
    let energy = 0;
    for (let b = 0; b < this.config.bins; b++) {
      hits += this.hits[b];
      normal += this.normalImpulse[b];
      tangential += this.tangentialImpulse[b];
      energy += this.energyIn[b];
    }
    return { hits, normalImpulse: normal, tangentialImpulse: tangential, energyIn: energy };
  }
}
