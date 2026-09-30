/**
 * Structure-of-arrays particle storage.
 *
 * One typed array per field instead of one object per particle: this keeps the
 * hot loops allocation-free and lets snapshots be transferred to the render
 * thread cheaply. Float64 is used for all dynamical state because conservation
 * diagnostics (energy drift, momentum closure) are part of the measured result.
 *
 * Field meanings (model units, see docs/MODEL_ASSUMPTIONS.md):
 *  x, y          centre position
 *  vx, vy        velocity
 *  fx, fy        force accumulator (only non-zero when a force model is active)
 *  mass          m > 0
 *  radius        disk radius r (diameter d = 2r)
 *  energy        internal / parcel energy reservoir (Universe B). Zero and inert
 *                in Universe A.
 *  deformation   contact deformation δ. Zero for the hard-contact model; used by
 *                soft-contact (DeformationModel) variants.
 *  collisions    cumulative number of particle–particle collisions this particle
 *                took part in
 *  wallHits      cumulative number of wall interactions
 */
export interface ParticleInit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  energy?: number;
  deformation?: number;
}

export interface ParticleSnapshot {
  count: number;
  x: number[];
  y: number[];
  vx: number[];
  vy: number[];
  mass: number[];
  radius: number[];
  energy: number[];
  deformation: number[];
}

export class ParticleStore {
  readonly capacity: number;
  count = 0;

  readonly id: Uint32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  readonly mass: Float64Array;
  readonly radius: Float64Array;
  readonly energy: Float64Array;
  readonly deformation: Float64Array;
  readonly collisions: Uint32Array;
  readonly wallHits: Uint32Array;

  constructor(capacity: number) {
    if (!(capacity > 0) || !Number.isInteger(capacity)) {
      throw new Error(`ParticleStore capacity must be a positive integer, got ${capacity}`);
    }
    this.capacity = capacity;
    this.id = new Uint32Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.fx = new Float64Array(capacity);
    this.fy = new Float64Array(capacity);
    this.mass = new Float64Array(capacity);
    this.radius = new Float64Array(capacity);
    this.energy = new Float64Array(capacity);
    this.deformation = new Float64Array(capacity);
    this.collisions = new Uint32Array(capacity);
    this.wallHits = new Uint32Array(capacity);
  }

  add(p: ParticleInit): number {
    if (this.count >= this.capacity) throw new Error('ParticleStore is full');
    if (!(p.mass > 0)) throw new Error(`particle mass must be > 0, got ${p.mass}`);
    if (!(p.radius > 0)) throw new Error(`particle radius must be > 0, got ${p.radius}`);
    const i = this.count++;
    this.id[i] = i;
    this.x[i] = p.x;
    this.y[i] = p.y;
    this.vx[i] = p.vx;
    this.vy[i] = p.vy;
    this.fx[i] = 0;
    this.fy[i] = 0;
    this.mass[i] = p.mass;
    this.radius[i] = p.radius;
    this.energy[i] = p.energy ?? 0;
    this.deformation[i] = p.deformation ?? 0;
    this.collisions[i] = 0;
    this.wallHits[i] = 0;
    return i;
  }

  /** Total translational kinetic energy Σ ½ m |v|². */
  kineticEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) {
      e += 0.5 * this.mass[i] * (this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i]);
    }
    return e;
  }

  /** Total internal (parcel reservoir) energy Σ energy_i. */
  internalEnergy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) e += this.energy[i];
    return e;
  }

  momentum(): { x: number; y: number } {
    let px = 0;
    let py = 0;
    for (let i = 0; i < this.count; i++) {
      px += this.mass[i] * this.vx[i];
      py += this.mass[i] * this.vy[i];
    }
    return { x: px, y: py };
  }

  totalMass(): number {
    let m = 0;
    for (let i = 0; i < this.count; i++) m += this.mass[i];
    return m;
  }

  maxSpeed(): number {
    let v2 = 0;
    for (let i = 0; i < this.count; i++) {
      const s = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      if (s > v2) v2 = s;
    }
    return Math.sqrt(v2);
  }

  maxRadius(): number {
    let r = 0;
    for (let i = 0; i < this.count; i++) if (this.radius[i] > r) r = this.radius[i];
    return r;
  }

  minRadius(): number {
    let r = Infinity;
    for (let i = 0; i < this.count; i++) if (this.radius[i] < r) r = this.radius[i];
    return r;
  }

  /** Σ π r² — area covered by particles (2D occupancy numerator). */
  particleArea(): number {
    let a = 0;
    for (let i = 0; i < this.count; i++) a += Math.PI * this.radius[i] * this.radius[i];
    return a;
  }

  snapshot(): ParticleSnapshot {
    const n = this.count;
    const take = (a: Float64Array): number[] => Array.from(a.subarray(0, n));
    return {
      count: n,
      x: take(this.x),
      y: take(this.y),
      vx: take(this.vx),
      vy: take(this.vy),
      mass: take(this.mass),
      radius: take(this.radius),
      energy: take(this.energy),
      deformation: take(this.deformation),
    };
  }

  static fromSnapshot(s: ParticleSnapshot, capacity = s.count): ParticleStore {
    const store = new ParticleStore(Math.max(capacity, 1));
    for (let i = 0; i < s.count; i++) {
      store.add({
        x: s.x[i],
        y: s.y[i],
        vx: s.vx[i],
        vy: s.vy[i],
        mass: s.mass[i],
        radius: s.radius[i],
        energy: s.energy[i],
        deformation: s.deformation[i],
      });
    }
    return store;
  }

  clone(): ParticleStore {
    const c = new ParticleStore(this.capacity);
    c.count = this.count;
    c.id.set(this.id);
    c.x.set(this.x);
    c.y.set(this.y);
    c.vx.set(this.vx);
    c.vy.set(this.vy);
    c.fx.set(this.fx);
    c.fy.set(this.fy);
    c.mass.set(this.mass);
    c.radius.set(this.radius);
    c.energy.set(this.energy);
    c.deformation.set(this.deformation);
    c.collisions.set(this.collisions);
    c.wallHits.set(this.wallHits);
    return c;
  }
}
