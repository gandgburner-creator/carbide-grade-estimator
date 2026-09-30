/**
 * Record of particle–particle collisions.
 *
 * Every collision is recorded twice:
 *  1. into running aggregates (count, Σ|J|, ΣΔKE, …) that cover the whole run, and
 *  2. into a fixed-size ring buffer holding the most recent `capacity` events in
 *     full detail (time, pair, contact point, normal, v_n, J, Δp, ΔKE, rewind τ).
 *
 * The ring buffer serves the particle inspector and the tests; the aggregates
 * serve long experiments without unbounded memory. Set capacity ≥ the expected
 * number of collisions to keep a complete history.
 */
export interface CollisionEvent {
  t: number;
  i: number;
  j: number;
  /** contact point */
  x: number;
  y: number;
  /** unit normal, pointing from j to i */
  nx: number;
  ny: number;
  /** pre-collision normal relative velocity (v_i - v_j)·n  (< 0 = approaching) */
  vn: number;
  /** impulse magnitude J = -(1+e) v_n / (1/m_i + 1/m_j) */
  J: number;
  /** momentum change of particle i (particle j receives the negative) */
  dpx: number;
  dpy: number;
  /** kinetic-energy change of the pair, measured from the velocities (≤ 0) */
  dKE: number;
  /** how far the pair was rewound to the contact instant (0 if not rewound) */
  tau: number;
}

export class CollisionLog {
  readonly capacity: number;
  private head = 0;
  private size = 0;

  private readonly t: Float64Array;
  private readonly pi: Int32Array;
  private readonly pj: Int32Array;
  private readonly cx: Float64Array;
  private readonly cy: Float64Array;
  private readonly nx: Float64Array;
  private readonly ny: Float64Array;
  private readonly vn: Float64Array;
  private readonly J: Float64Array;
  private readonly dpx: Float64Array;
  private readonly dpy: Float64Array;
  private readonly dKE: Float64Array;
  private readonly tau: Float64Array;

  // whole-run aggregates
  count = 0;
  sumImpulse = 0;
  sumDKE = 0;
  sumVn2 = 0;
  /** contacts whose overlap predates the current step (rewind τ clamped to dt) */
  lateContacts = 0;
  /** collisions in which a participant had already collided earlier in the same step */
  multiCollisions = 0;
  /** coincident centres — normal undefined, collision NOT resolved, flagged */
  degenerateContacts = 0;
  /** largest overlap depth seen at detection, as a fraction of the contact distance */
  maxOverlapFraction = 0;

  constructor(capacity = 65536) {
    this.capacity = Math.max(1, capacity);
    const n = this.capacity;
    this.t = new Float64Array(n);
    this.pi = new Int32Array(n);
    this.pj = new Int32Array(n);
    this.cx = new Float64Array(n);
    this.cy = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.ny = new Float64Array(n);
    this.vn = new Float64Array(n);
    this.J = new Float64Array(n);
    this.dpx = new Float64Array(n);
    this.dpy = new Float64Array(n);
    this.dKE = new Float64Array(n);
    this.tau = new Float64Array(n);
  }

  record(
    t: number,
    i: number,
    j: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
    vn: number,
    J: number,
    dpx: number,
    dpy: number,
    dKE: number,
    tau: number,
  ): void {
    const k = this.head;
    this.t[k] = t;
    this.pi[k] = i;
    this.pj[k] = j;
    this.cx[k] = x;
    this.cy[k] = y;
    this.nx[k] = nx;
    this.ny[k] = ny;
    this.vn[k] = vn;
    this.J[k] = J;
    this.dpx[k] = dpx;
    this.dpy[k] = dpy;
    this.dKE[k] = dKE;
    this.tau[k] = tau;
    this.head = (k + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.count++;
    this.sumImpulse += Math.abs(J);
    this.sumDKE += dKE;
    this.sumVn2 += vn * vn;
  }

  /** Number of events currently held in the ring buffer. */
  get retained(): number {
    return this.size;
  }

  /** k-th most recent event (0 = newest). */
  recent(k: number): CollisionEvent {
    if (k < 0 || k >= this.size) throw new RangeError(`event ${k} not retained`);
    const idx = (this.head - 1 - k + this.capacity * 2) % this.capacity;
    return {
      t: this.t[idx],
      i: this.pi[idx],
      j: this.pj[idx],
      x: this.cx[idx],
      y: this.cy[idx],
      nx: this.nx[idx],
      ny: this.ny[idx],
      vn: this.vn[idx],
      J: this.J[idx],
      dpx: this.dpx[idx],
      dpy: this.dpy[idx],
      dKE: this.dKE[idx],
      tau: this.tau[idx],
    };
  }

  /** Retained events in chronological order. */
  events(): CollisionEvent[] {
    const out: CollisionEvent[] = [];
    for (let k = this.size - 1; k >= 0; k--) out.push(this.recent(k));
    return out;
  }

  /** Most recent retained events involving particle `p`, newest first. */
  eventsInvolving(p: number, max = 20): CollisionEvent[] {
    const out: CollisionEvent[] = [];
    for (let k = 0; k < this.size && out.length < max; k++) {
      const idx = (this.head - 1 - k + this.capacity * 2) % this.capacity;
      if (this.pi[idx] === p || this.pj[idx] === p) out.push(this.recent(k));
    }
    return out;
  }

  summary() {
    return {
      count: this.count,
      sumImpulse: this.sumImpulse,
      sumDKE: this.sumDKE,
      meanVn2: this.count > 0 ? this.sumVn2 / this.count : 0,
      lateContacts: this.lateContacts,
      multiCollisions: this.multiCollisions,
      degenerateContacts: this.degenerateContacts,
      maxOverlapFraction: this.maxOverlapFraction,
    };
  }
}
