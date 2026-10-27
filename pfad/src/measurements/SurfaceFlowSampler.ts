import type { ParticleStore } from '../core/ParticleStore';
import type { PolygonBody } from '../walls/SolidBody';

/**
 * NEAR-SURFACE FLOW along a body (reads simulation state only).
 *
 * For each side of the body the sampler holds a polyline of straight segments from the
 * leading to the trailing edge. A STATION is one segment. A particle belongs to station k
 * when its foot point lies within segment k and its distance n from the segment (along the
 * outward normal) is within the sampled window; where two segments overlap (inside a
 * concave bend) the smaller n wins. Normal bin j covers
 *
 *     n ∈ [r + j·Δn, r + (j+1)·Δn),     r = particle radius (a centre cannot be closer),
 *
 * so bin 0 is the layer touching the wall. Per station and bin the sampler accumulates
 *
 *     count, M = Σ m, P_t = Σ m u_t, P_n = Σ m u_n, E = Σ m |v|²
 *
 * with u_t along the DOWNSTREAM tangent (leading → trailing edge) and u_n along the
 * outward normal. These are sums over snapshots; every quantity the detector uses is a
 * ratio of them (a mass-weighted mean). Sums are kept per time BLOCK so that uncertainties
 * come from block-to-block spread (batch means) and persistence in time can be tested.
 *
 * Wall momentum transfer per station comes from the body's own impulse tallies (the
 * existing PolygonBody counters): the normal impulse into the body and the tangential
 * impulse along the downstream direction, per block, with each interior vertex's impulse
 * shared between its two adjacent stations. Corner vertices (leading and trailing faces)
 * are not assigned to any station.
 *
 * Mass flux. Within a station the cumulative sum Σ_{j' ≤ j} P_t / (S · ℓ) (S snapshots,
 * ℓ the segment length) is the time-mean mass flux along the surface through the strip
 * between the wall and the top of bin j: Q(n). Where Q < 0 the mean flow near the wall
 * carries mass backwards; the height at which Q returns to 0 is where the mean
 * stream function regains its wall value (the dividing streamline). This presumes a
 * statistically stationary flow and neglects the strip's curvature (second order for
 * small surface slopes).
 */
export type SideName = 'upper' | 'lower';

export interface SamplerSide {
  side: SideName;
  /** polyline in the simulation frame, interleaved, leading → trailing edge (stations + 1 points) */
  points: number[];
  /** +1 if the outward normal is the left of the downstream tangent, −1 if it is the right */
  outward: 1 | -1;
  /** polygon edge index of each segment (PolygonBody.edges) */
  edges: number[];
  /** polygon vertex shared by segment k and k+1, for k = 0 … stations − 2 */
  junctions: number[];
}

export interface SamplerConfig {
  /** particle radius */
  radius: number;
  /** normal bin width and count */
  normalWidth: number;
  normalBins: number;
}

/** Per-station, per-bin sums: count, M, P_t, P_n, E. */
export const SUMS = 5;
/** Per-station wall tallies: normal impulse into the body, downstream tangential impulse on the body, hits. */
export const WALL = 3;

export interface BlockSideData {
  /** [station][bin][SUMS], flattened */
  sums: number[];
  /** [station][WALL], flattened */
  wall: number[];
}

export interface FlowBlock {
  index: number;
  snapshots: number;
  t0: number;
  t1: number;
  sides: Partial<Record<SideName, BlockSideData>>;
}

interface Seg {
  ax: number;
  ay: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  len: number;
}

function segments(side: SamplerSide): Seg[] {
  const p = side.points;
  const out: Seg[] = [];
  for (let k = 0; k + 3 < p.length; k += 2) {
    const dx = p[k + 2] - p[k];
    const dy = p[k + 3] - p[k + 1];
    const len = Math.hypot(dx, dy);
    const tx = dx / len;
    const ty = dy / len;
    out.push({ ax: p[k], ay: p[k + 1], tx, ty, nx: -ty * side.outward, ny: tx * side.outward, len });
  }
  return out;
}

export class SurfaceFlowSampler {
  readonly cfg: SamplerConfig;
  readonly sides: SamplerSide[];
  readonly body: PolygonBody;
  readonly blocks: FlowBlock[] = [];
  private readonly segs: Record<string, Seg[]> = {};
  private readonly box: Record<string, [number, number, number, number]> = {};
  private cur: Record<string, BlockSideData> = {};
  private snapshots = 0;
  private blockT0: number;
  // body tallies at the start of the block
  private normal0: Float64Array;
  private tangential0: Float64Array;
  private hits0: Float64Array;
  private vx0: Float64Array;
  private vy0: Float64Array;
  private vhits0: Float64Array;
  /** vertex index → [station on side A, side] sharing, built once */
  private readonly vertexStations: Map<number, { side: SideName; station: number }[]> = new Map();

  constructor(body: PolygonBody, sides: SamplerSide[], cfg: SamplerConfig, t0: number) {
    this.body = body;
    this.sides = sides;
    this.cfg = cfg;
    this.blockT0 = t0;
    const reach = cfg.radius + cfg.normalBins * cfg.normalWidth + 1;
    for (const sd of sides) {
      this.segs[sd.side] = segments(sd);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let k = 0; k < sd.points.length; k += 2) {
        x0 = Math.min(x0, sd.points[k]);
        x1 = Math.max(x1, sd.points[k]);
        y0 = Math.min(y0, sd.points[k + 1]);
        y1 = Math.max(y1, sd.points[k + 1]);
      }
      this.box[sd.side] = [x0 - reach, x1 + reach, y0 - reach, y1 + reach];
      // interior vertices: each is shared by two consecutive stations
      sd.junctions.forEach((v, k) => {
        const list = this.vertexStations.get(v) ?? [];
        list.push({ side: sd.side, station: k }, { side: sd.side, station: k + 1 });
        this.vertexStations.set(v, list);
      });
    }
    this.normal0 = body.normalImpulse.slice();
    this.tangential0 = body.tangentialImpulse.slice();
    this.hits0 = body.hits.slice();
    this.vx0 = body.vertexImpulseX.slice();
    this.vy0 = body.vertexImpulseY.slice();
    this.vhits0 = body.vertexHits.slice();
    this.resetBlock();
  }

  /** Start measuring at time t: wall tallies are differenced from the body's current counters. */
  restart(t: number): void {
    const b = this.body;
    this.normal0 = b.normalImpulse.slice();
    this.tangential0 = b.tangentialImpulse.slice();
    this.hits0 = b.hits.slice();
    this.vx0 = b.vertexImpulseX.slice();
    this.vy0 = b.vertexImpulseY.slice();
    this.vhits0 = b.vertexHits.slice();
    this.blockT0 = t;
    this.blocks.length = 0;
    this.resetBlock();
  }

  /** Start time of the block being filled. */
  currentStart(): number {
    return this.blockT0;
  }

  stations(side: SideName): number {
    return this.segs[side].length;
  }

  private resetBlock() {
    this.cur = {};
    for (const sd of this.sides) {
      const S = this.segs[sd.side].length;
      this.cur[sd.side] = { sums: new Array<number>(S * this.cfg.normalBins * SUMS).fill(0), wall: new Array<number>(S * WALL).fill(0) };
    }
    this.snapshots = 0;
  }

  /** Accumulate one snapshot of the particle state. */
  sample(store: ParticleStore): void {
    const { x, y, vx, vy, mass, radius } = store;
    const nb = this.cfg.normalBins;
    const dn = this.cfg.normalWidth;
    const r0 = this.cfg.radius;
    const nMax = r0 + nb * dn;
    for (const sd of this.sides) {
      const segs = this.segs[sd.side];
      const [bx0, bx1, by0, by1] = this.box[sd.side];
      const sums = this.cur[sd.side].sums;
      for (let i = 0; i < store.count; i++) {
        const px = x[i];
        const py = y[i];
        if (px < bx0 || px > bx1 || py < by0 || py > by1) continue;
        let best = Infinity;
        let bk = -1;
        for (let k = 0; k < segs.length; k++) {
          const s = segs[k];
          const dx = px - s.ax;
          const dy = py - s.ay;
          const along = dx * s.tx + dy * s.ty;
          if (along < 0 || along >= s.len) continue;
          const n = dx * s.nx + dy * s.ny;
          if (n < 0 || n >= nMax) continue;
          if (n < best) {
            best = n;
            bk = k;
          }
        }
        if (bk < 0) continue;
        const s = segs[bk];
        let j = Math.floor((best - r0) / dn);
        if (j < 0) j = 0;
        if (j >= nb) continue;
        const m = mass[i];
        const ut = vx[i] * s.tx + vy[i] * s.ty;
        const un = vx[i] * s.nx + vy[i] * s.ny;
        const o = (bk * nb + j) * SUMS;
        sums[o] += 1;
        sums[o + 1] += m;
        sums[o + 2] += m * ut;
        sums[o + 3] += m * un;
        sums[o + 4] += m * (vx[i] * vx[i] + vy[i] * vy[i]);
      }
      void radius;
    }
    this.snapshots++;
  }

  /** Close the current block at time t: store its sums and the wall tallies accumulated since the last close. */
  closeBlock(t: number): FlowBlock {
    const b = this.body;
    const sides: Partial<Record<SideName, BlockSideData>> = {};
    for (const sd of this.sides) {
      const segs = this.segs[sd.side];
      const wall = this.cur[sd.side].wall;
      segs.forEach((s, k) => {
        const e = b.edges[sd.edges[k]];
        // edge direction a→b is downstream on the lower side and upstream on the upper side
        const downSign = e.tx * s.tx + e.ty * s.ty >= 0 ? 1 : -1;
        let nrm = 0;
        let tan = 0;
        let hits = 0;
        for (let q = 0; q < e.bins; q++) {
          const bin = e.binOffset + q;
          nrm += b.normalImpulse[bin] - this.normal0[bin];
          tan += b.tangentialImpulse[bin] - this.tangential0[bin];
          hits += b.hits[bin] - this.hits0[bin];
        }
        wall[k * WALL] += nrm;
        wall[k * WALL + 1] += downSign * tan;
        wall[k * WALL + 2] += hits;
      });
    }
    // interior vertex impulses, half to each adjacent station, projected on that station's frame
    for (const [v, list] of this.vertexStations) {
      const jx = b.vertexImpulseX[v] - this.vx0[v];
      const jy = b.vertexImpulseY[v] - this.vy0[v];
      const jh = b.vertexHits[v] - this.vhits0[v];
      if (jx === 0 && jy === 0 && jh === 0) continue;
      for (const { side, station } of list) {
        const s = this.segs[side][station];
        const wall = this.cur[side].wall;
        // the vertex impulse is the impulse ON the body; the normal impulse INTO the body is −j·n_out
        wall[station * WALL] += -0.5 * (jx * s.nx + jy * s.ny);
        wall[station * WALL + 1] += 0.5 * (jx * s.tx + jy * s.ty);
        wall[station * WALL + 2] += 0.5 * jh;
      }
    }
    for (const sd of this.sides) sides[sd.side] = this.cur[sd.side];
    const block: FlowBlock = { index: this.blocks.length, snapshots: this.snapshots, t0: this.blockT0, t1: t, sides };
    this.blocks.push(block);
    this.normal0 = b.normalImpulse.slice();
    this.tangential0 = b.tangentialImpulse.slice();
    this.hits0 = b.hits.slice();
    this.vx0 = b.vertexImpulseX.slice();
    this.vy0 = b.vertexImpulseY.slice();
    this.vhits0 = b.vertexHits.slice();
    this.blockT0 = t;
    this.resetBlock();
    return block;
  }

  /** Segment lengths of a side. */
  lengths(side: SideName): number[] {
    return this.segs[side].map((s) => s.len);
  }

  /** Station centres in the simulation frame. */
  centres(side: SideName): { x: number; y: number }[] {
    return this.segs[side].map((s) => ({ x: s.ax + 0.5 * s.len * s.tx, y: s.ay + 0.5 * s.len * s.ty }));
  }
}
