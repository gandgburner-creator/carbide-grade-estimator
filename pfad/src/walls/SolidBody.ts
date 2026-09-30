import type { Ledger } from '../core/Ledger';
import type { ParticleStore } from '../core/ParticleStore';
import type { Rng } from '../core/Random';

/**
 * SOLID POLYGON BODY held fixed inside the flow (A-19).
 *
 * A closed polygon of straight edges (vertices counter-clockwise, so the
 * outward normal of edge a→b is (t_y, −t_x) for unit tangent t). A disk
 * touches the body when its centre comes within its radius of the polygon
 * boundary. The contact normal is the line from the closest boundary point to
 * the disk centre: the edge normal on a face, the radial direction at a vertex
 * (a sharp corner is a point contact; nothing rounds it).
 *
 * Interaction law: the same Maxwell accommodation as the planar walls
 * (WallModel), per edge, with respect to the contact normal: with probability
 * 1 − Aw specular, otherwise diffuse re-emission from a wall Maxwellian at
 * kT_w (the body is at rest); a vertex uses the mean Aw of its two edges.
 * Contact timing: the earliest contact along the
 * particle's straight path in this step is found exactly (linear for faces,
 * quadratic for vertices); the particle is moved back to it, re-emitted, and
 * advanced by the remaining time.
 *
 * Measurements (cumulative; measurement code differences them between times):
 *   per edge and bin along the edge: hits, normal impulse into the body
 *   (pressure), tangential impulse along the edge direction a→b (shear);
 *   per vertex: hits and impulse vector;
 *   whole body: impulse vector (force × time), moment about `momentOrigin`,
 *   energy from gas to body.
 * Lift and drag are components of the measured impulse; no force formula is used.
 */
export interface PolygonBodyConfig {
  name: string;
  /** vertices, counter-clockwise, x and y interleaved: [x0, y0, x1, y1, ...] */
  vertices: number[];
  /** Aw per edge, or one value for all */
  accommodation: number | number[];
  /** kT_w for diffuse re-emission (required if any Aw > 0) */
  temperature?: number;
  /** target measurement bin length along each edge */
  binLength?: number;
  /** point about which the moment is accumulated (default: first vertex) */
  momentOrigin?: { x: number; y: number };
}

export const SOLID_BODY_VERSION = 'polygon-body-maxwell/1';

export interface EdgeGeometry {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  length: number;
  bins: number;
  /** offset of this edge's first bin in the flat bin arrays */
  binOffset: number;
}

/** Signed area of a polygon given as interleaved coordinates (positive = counter-clockwise). */
export function polygonArea(v: number[]): number {
  let a = 0;
  const n = v.length / 2;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    a += v[2 * k] * v[2 * j + 1] - v[2 * j] * v[2 * k + 1];
  }
  return a / 2;
}

export class PolygonBody {
  readonly config: PolygonBodyConfig;
  readonly edges: EdgeGeometry[];
  readonly accommodation: number[];
  readonly totalBins: number;
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  readonly momentOrigin: { x: number; y: number };

  // per edge bin (flat, see EdgeGeometry.binOffset)
  readonly hits: Float64Array;
  readonly normalImpulse: Float64Array;
  readonly tangentialImpulse: Float64Array;
  // per vertex
  readonly vertexHits: Float64Array;
  readonly vertexImpulseX: Float64Array;
  readonly vertexImpulseY: Float64Array;
  // whole body
  impulseX = 0;
  impulseY = 0;
  moment = 0;
  energyIn = 0;
  totalHits = 0;
  diffuseHits = 0;
  /** contacts that had to be placed at the start of the step (already overlapping) */
  lateContacts = 0;
  /** particle centres found inside the polygon (must stay 0) */
  insideDetections = 0;

  constructor(config: PolygonBodyConfig) {
    const v = config.vertices;
    const n = v.length / 2;
    if (!Number.isInteger(n) || n < 3) throw new Error('a polygon body needs at least 3 vertices');
    if (!(polygonArea(v) > 0)) throw new Error('polygon vertices must be counter-clockwise with positive area');
    const aw = Array.isArray(config.accommodation) ? config.accommodation : new Array<number>(n).fill(config.accommodation);
    if (aw.length !== n) throw new Error('one accommodation value per edge');
    for (const a of aw) if (!(a >= 0 && a <= 1)) throw new Error(`accommodation must be in [0,1], got ${a}`);
    if (aw.some((a) => a > 0) && !(config.temperature !== undefined && config.temperature > 0)) {
      throw new Error('a body with accommodation > 0 needs a positive temperature');
    }
    this.config = config;
    this.accommodation = aw;
    const binLength = config.binLength ?? 1;
    let off = 0;
    this.edges = [];
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = v[2 * k];
      const ay = v[2 * k + 1];
      const bx = v[2 * j];
      const by = v[2 * j + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (!(L > 0)) throw new Error('polygon has a zero-length edge');
      const tx = (bx - ax) / L;
      const ty = (by - ay) / L;
      const bins = Math.max(1, Math.round(L / binLength));
      this.edges.push({ ax, ay, bx, by, tx, ty, nx: ty, ny: -tx, length: L, bins, binOffset: off });
      off += bins;
    }
    this.totalBins = off;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < n; k++) {
      x0 = Math.min(x0, v[2 * k]);
      x1 = Math.max(x1, v[2 * k]);
      y0 = Math.min(y0, v[2 * k + 1]);
      y1 = Math.max(y1, v[2 * k + 1]);
    }
    [this.xmin, this.xmax, this.ymin, this.ymax] = [x0, x1, y0, y1];
    this.momentOrigin = config.momentOrigin ?? { x: v[0], y: v[1] };
    this.hits = new Float64Array(off);
    this.normalImpulse = new Float64Array(off);
    this.tangentialImpulse = new Float64Array(off);
    this.vertexHits = new Float64Array(n);
    this.vertexImpulseX = new Float64Array(n);
    this.vertexImpulseY = new Float64Array(n);
  }

  get vertexCount(): number {
    return this.edges.length;
  }

  /** Point-in-polygon (crossing number). */
  contains(px: number, py: number): boolean {
    let inside = false;
    for (const e of this.edges) {
      if (e.ay > py !== e.by > py) {
        const xc = e.ax + ((py - e.ay) * (e.bx - e.ax)) / (e.by - e.ay);
        if (px < xc) inside = !inside;
      }
    }
    return inside;
  }

  /**
   * Closest boundary point to (px, py): distance (negative inside), outward
   * contact normal, edge index, parameter along the edge, and the vertex index
   * if the closest point is a vertex (−1 otherwise).
   */
  closest(px: number, py: number): { d: number; nx: number; ny: number; edge: number; s: number; vertex: number } {
    let best = Infinity;
    let bx = 0;
    let by = 0;
    let edge = 0;
    let sBest = 0;
    let vertex = -1;
    const n = this.edges.length;
    for (let k = 0; k < n; k++) {
      const e = this.edges[k];
      const s = (px - e.ax) * e.tx + (py - e.ay) * e.ty;
      let qx: number;
      let qy: number;
      let vtx = -1;
      let sc = s;
      if (s <= 0) {
        qx = e.ax;
        qy = e.ay;
        vtx = k;
        sc = 0;
      } else if (s >= e.length) {
        qx = e.bx;
        qy = e.by;
        vtx = (k + 1) % n;
        sc = e.length;
      } else {
        qx = e.ax + s * e.tx;
        qy = e.ay + s * e.ty;
      }
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        bx = qx;
        by = qy;
        edge = k;
        sBest = sc;
        vertex = vtx;
      }
    }
    const dist = Math.sqrt(best);
    const inside = this.contains(px, py);
    let nx: number;
    let ny: number;
    if (dist > 1e-12) {
      nx = (px - bx) / dist;
      ny = (py - by) / dist;
      if (inside) {
        nx = -nx;
        ny = -ny;
      }
    } else {
      nx = this.edges[edge].nx;
      ny = this.edges[edge].ny;
    }
    return { d: inside ? -dist : dist, nx, ny, edge, s: sBest, vertex };
  }

  /**
   * Earliest time s ∈ [0, T] at which a disk of radius r moving from (x0, y0)
   * with velocity (vx, vy) first touches the body, or null.
   */
  firstContact(x0: number, y0: number, vx: number, vy: number, T: number, r: number): { s: number; edge: number; vertex: number } | null {
    let sBest = Infinity;
    let edgeBest = -1;
    let vertexBest = -1;
    const n = this.edges.length;
    const v2 = vx * vx + vy * vy;
    for (let k = 0; k < n; k++) {
      const e = this.edges[k];
      // face: (p0 + v s − a)·n = r while approaching
      const vn = vx * e.nx + vy * e.ny;
      if (vn < 0) {
        const d0 = (x0 - e.ax) * e.nx + (y0 - e.ay) * e.ny;
        if (d0 >= r) {
          const s = (r - d0) / vn;
          if (s <= T && s < sBest) {
            const along = (x0 + vx * s - e.ax) * e.tx + (y0 + vy * s - e.ay) * e.ty;
            if (along >= 0 && along <= e.length) {
              sBest = s;
              edgeBest = k;
              vertexBest = -1;
            }
          }
        }
      }
      // vertex a: |p0 + v s − a| = r, first (entering) root
      const dx = x0 - e.ax;
      const dy = y0 - e.ay;
      const b = dx * vx + dy * vy;
      if (b < 0 && v2 > 0) {
        const c = dx * dx + dy * dy - r * r;
        if (c >= 0) {
          const disc = b * b - v2 * c;
          if (disc >= 0) {
            const s = (-b - Math.sqrt(disc)) / v2;
            if (s <= T && s < sBest) {
              sBest = s;
              edgeBest = k;
              vertexBest = k;
            }
          }
        }
      }
    }
    return edgeBest >= 0 ? { s: Math.max(0, sBest), edge: edgeBest, vertex: vertexBest } : null;
  }

  /**
   * Resolve every particle that overlaps the body and moves into it.
   * Returns the number of interactions.
   */
  interact(store: ParticleStore, dt: number, rng: Rng, ledger: Ledger, eventStep?: Int32Array, step = 0): number {
    const { x, y, vx, vy, mass, radius, wallHits } = store;
    const kTw = this.config.temperature ?? 0;
    const margin = store.count > 0 ? store.maxRadius() : 0;
    const x0 = this.xmin - margin;
    const x1 = this.xmax + margin;
    const y0 = this.ymin - margin;
    const y1 = this.ymax + margin;
    const n = this.edges.length;
    let count = 0;
    for (let i = 0; i < store.count; i++) {
      const px = x[i];
      const py = y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const r = radius[i];
      const c = this.closest(px, py);
      if (c.d < 0) this.insideDetections++;
      if (c.d >= r) continue;
      const vxi = vx[i];
      const vyi = vy[i];
      if (vxi * c.nx + vyi * c.ny >= 0 && c.d >= 0) continue; // overlapping but already leaving
      // earliest contact along the straight path of this step
      const fc = this.firstContact(px - vxi * dt, py - vyi * dt, vxi, vyi, dt, r);
      let cx: number;
      let cy: number;
      let nx: number;
      let ny: number;
      let edge: number;
      let vertex: number;
      let tau: number; // time remaining after the contact
      if (fc && fc.s > 0) {
        tau = dt - fc.s;
        cx = px - vxi * tau;
        cy = py - vyi * tau;
        edge = fc.edge;
        vertex = fc.vertex;
        if (vertex >= 0) {
          const e = this.edges[vertex];
          nx = (cx - e.ax) / r;
          ny = (cy - e.ay) / r;
          const nn = Math.hypot(nx, ny);
          nx /= nn;
          ny /= nn;
        } else {
          nx = this.edges[edge].nx;
          ny = this.edges[edge].ny;
        }
      } else {
        // already overlapping at the start of the step: contact placed there
        this.lateContacts++;
        tau = dt;
        cx = px - vxi * dt;
        cy = py - vyi * dt;
        const c0 = this.closest(cx, cy);
        nx = c0.nx;
        ny = c0.ny;
        edge = c0.edge;
        vertex = c0.vertex;
      }
      const vn = vxi * nx + vyi * ny;
      if (vn >= 0) continue; // tangential graze: no interaction
      const m = mass[i];
      const tnx = -ny; // contact tangent
      const tny = nx;
      const vt = vxi * tnx + vyi * tny;
      // a vertex takes the mean Aw of the two edges meeting there
      const aw = vertex >= 0 ? 0.5 * (this.accommodation[vertex] + this.accommodation[(vertex + n - 1) % n]) : this.accommodation[edge];
      let vn2: number;
      let vt2: number;
      if (aw > 0 && rng.next() < aw) {
        this.diffuseHits++;
        vn2 = Math.sqrt(-2 * (kTw / m) * Math.log(rng.nextOpen()));
        vt2 = Math.sqrt(kTw / m) * rng.gaussian();
      } else {
        vn2 = -vn;
        vt2 = vt;
      }
      const nvx = vn2 * nx + vt2 * tnx;
      const nvy = vn2 * ny + vt2 * tny;
      const jx = -m * (nvx - vxi); // impulse on the body
      const jy = -m * (nvy - vyi);
      const dE = 0.5 * m * (vxi * vxi + vyi * vyi - nvx * nvx - nvy * nvy);
      vx[i] = nvx;
      vy[i] = nvy;
      x[i] = cx + nvx * tau;
      y[i] = cy + nvy * tau;

      // contact point on the body
      const qx = cx - r * nx;
      const qy = cy - r * ny;
      this.impulseX += jx;
      this.impulseY += jy;
      this.moment += (qx - this.momentOrigin.x) * jy - (qy - this.momentOrigin.y) * jx;
      this.energyIn += dE;
      this.totalHits++;
      if (vertex >= 0) {
        this.vertexHits[vertex]++;
        this.vertexImpulseX[vertex] += jx;
        this.vertexImpulseY[vertex] += jy;
      } else {
        const e = this.edges[edge];
        const along = (qx - e.ax) * e.tx + (qy - e.ay) * e.ty;
        let b = Math.floor((along / e.length) * e.bins);
        if (b < 0) b = 0;
        else if (b >= e.bins) b = e.bins - 1;
        const k = e.binOffset + b;
        this.hits[k]++;
        this.normalImpulse[k] += -(jx * e.nx + jy * e.ny); // into the body (> 0 for pressure)
        this.tangentialImpulse[k] += jx * e.tx + jy * e.ty; // along a→b, on the body
      }
      ledger.wallImpulseX -= jx;
      ledger.wallImpulseY -= jy;
      ledger.wallEnergyOut += dE;
      wallHits[i]++;
      if (eventStep) eventStep[i] = step;
      count++;
    }
    return count;
  }

  /** Polygon as plain data (for drawing and records). */
  geometry() {
    return { name: this.config.name, vertices: this.config.vertices.slice(), accommodation: this.accommodation.slice() };
  }
}
