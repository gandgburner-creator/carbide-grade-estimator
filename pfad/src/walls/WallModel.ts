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
  /**
   * Optional segments along the wall (tangential coordinate interval) with their
   * own interaction parameters, e.g. a diffuse plate inside a specular floor.
   * Positions outside every segment use the wall's own parameters.
   */
  segments?: WallSegment[];
}

export interface WallSegment {
  from: number;
  to: number;
  accommodation: number;
  temperature?: number;
  tangentialVelocity?: number;
}

export const WALL_MODEL_VERSION = 'maxwell-accommodation-plane/2';

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
  /** kinetic energy carried in by incident particles / carried out by re-emitted ones */
  readonly incidentEnergy: Float64Array;
  readonly emittedEnergy: Float64Array;
  /** tangential momentum (lab frame, along +tangent) carried in / out */
  readonly incidentTangential: Float64Array;
  readonly emittedTangential: Float64Array;
  /** interactions that were diffuse re-emissions (realised accommodation) */
  readonly diffuseHits: Float64Array;
  /** interactions whose rewind exceeded the step (particle was already inside the wall) */
  lateContacts = 0;

  constructor(config: PlaneWallConfig, domain: Domain) {
    const bins = config.bins ?? 1;
    const Aw = config.accommodation;
    if (!(Aw >= 0 && Aw <= 1)) throw new Error(`accommodation must be in [0,1], got ${Aw}`);
    if (Aw > 0 && !(config.temperature !== undefined && config.temperature > 0)) {
      throw new Error('a wall with accommodation > 0 needs a positive temperature');
    }
    for (const sg of config.segments ?? []) {
      if (!(sg.accommodation >= 0 && sg.accommodation <= 1)) throw new Error('segment accommodation must be in [0,1]');
      if (sg.accommodation > 0 && !(sg.temperature !== undefined && sg.temperature > 0)) {
        throw new Error('a wall segment with accommodation > 0 needs a positive temperature');
      }
      if (!(sg.to > sg.from)) throw new Error('wall segment needs to > from');
    }
    this.config = {
      side: config.side,
      accommodation: Aw,
      temperature: config.temperature ?? 0,
      tangentialVelocity: config.tangentialVelocity ?? 0,
      bins,
      segments: config.segments ?? [],
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
    this.incidentEnergy = new Float64Array(bins);
    this.emittedEnergy = new Float64Array(bins);
    this.incidentTangential = new Float64Array(bins);
    this.emittedTangential = new Float64Array(bins);
    this.diffuseHits = new Float64Array(bins);
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

  /** wall events whose contact-instant velocity was already leaving (forces only; v_½ used instead) */
  contactFallbacks = 0;

  /**
   * Resolve every particle that overlaps this wall and moves into it.
   * Returns the number of interactions.
   *
   * With continuous forces (forcesActive) the stored velocities are the
   * velocity-Verlet half-step velocities v_½. As for pair collisions (model
   * p0.2), the wall law is then evaluated with the velocity AT THE CONTACT
   * INSTANT, v_c = v_½ + (F/m)(dt/2 − τ), and the resulting velocity change is
   * applied to v_½. Using v_½ leaves an energy error F·Δv·(dt/2 − τ) per wall
   * event, first order in dt (model p0.5; docs/MODEL_CHANGELOG.md). Without
   * forces the operations are exactly those of /1.
   */
  interact(
    store: ParticleStore,
    dt: number,
    rng: Rng,
    ledger: Ledger,
    eventStep?: Int32Array,
    step = 0,
    forcesActive = false,
  ): number {
    const { x, y, vx, vy, fx, fy, mass, radius, wallHits } = store;
    const { nx, ny, tx, ty } = this;
    const Aw = this.config.accommodation;
    const kTw = this.config.temperature;
    const Uw = this.config.tangentialVelocity;
    const segments = this.config.segments;
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
      // velocity at the contact instant (differs from v_½ only when forces act)
      let cvx = vx[i];
      let cvy = vy[i];
      let cvn = vn;
      if (forcesActive) {
        const shift = 0.5 * dt - tau;
        const ax = cvx + (fx[i] / m) * shift;
        const ay = cvy + (fy[i] / m) * shift;
        const an = ax * nx + ay * ny;
        if (an < 0) {
          cvx = ax;
          cvy = ay;
          cvn = an;
        } else {
          this.contactFallbacks++;
        }
      }
      const vt = cvx * tx + cvy * ty;
      let aw = Aw;
      let kt = kTw;
      let uw = Uw;
      if (segments.length > 0) {
        const at = tx !== 0 ? px : py;
        for (const sg of segments) {
          if (at >= sg.from && at < sg.to) {
            aw = sg.accommodation;
            kt = sg.temperature ?? 0;
            uw = sg.tangentialVelocity ?? 0;
            break;
          }
        }
      }
      let vn2: number;
      let vt2: number;
      let diffuse = false;
      if (aw > 0 && rng.next() < aw) {
        diffuse = true;
        const sigma = Math.sqrt(kt / m);
        vn2 = Math.sqrt(-2 * (kt / m) * Math.log(rng.nextOpen()));
        vt2 = uw + sigma * rng.gaussian();
      } else {
        vn2 = -cvn;
        vt2 = vt;
      }
      const nvx = vn2 * nx + vt2 * tx;
      const nvy = vn2 * ny + vt2 * ty;
      const dpx = m * (nvx - cvx);
      const dpy = m * (nvy - cvy);
      const dE = 0.5 * m * (cvx * cvx + cvy * cvy - nvx * nvx - nvy * nvy);
      if (cvx === vx[i] && cvy === vy[i]) {
        vx[i] = nvx;
        vy[i] = nvy;
      } else {
        vx[i] += nvx - cvx;
        vy[i] += nvy - cvy;
      }
      x[i] = px + vx[i] * tau;
      y[i] = py + vy[i] * tau;

      // bookkeeping: impulse on the wall is −Δp_particle
      const along = (tx !== 0 ? px : py) - this.t0;
      let b = Math.floor(along / bw);
      if (b < 0) b = 0;
      else if (b >= bins) b = bins - 1;
      this.hits[b] += 1;
      this.normalImpulse[b] += m * (vn2 - cvn); // pushes the wall outward (> 0)
      this.tangentialImpulse[b] += m * (vt - vt2); // along +tangent, on the wall
      this.energyIn[b] += dE;
      this.incidentEnergy[b] += 0.5 * m * (cvn * cvn + vt * vt);
      this.emittedEnergy[b] += 0.5 * m * (vn2 * vn2 + vt2 * vt2);
      this.incidentTangential[b] += m * vt;
      this.emittedTangential[b] += m * vt2;
      if (diffuse) this.diffuseHits[b] += 1;
      ledger.wallImpulseX += dpx;
      ledger.wallImpulseY += dpy;
      ledger.wallEnergyOut += dE;
      wallHits[i]++;
      if (eventStep) eventStep[i] = step;
      count++;
    }
    return count;
  }

  totals() {
    const sum = (a: Float64Array) => {
      let t = 0;
      for (let b = 0; b < a.length; b++) t += a[b];
      return t;
    };
    return {
      hits: sum(this.hits),
      normalImpulse: sum(this.normalImpulse),
      tangentialImpulse: sum(this.tangentialImpulse),
      energyIn: sum(this.energyIn),
      incidentEnergy: sum(this.incidentEnergy),
      emittedEnergy: sum(this.emittedEnergy),
      incidentTangential: sum(this.incidentTangential),
      emittedTangential: sum(this.emittedTangential),
      diffuseHits: sum(this.diffuseHits),
    };
  }
}
