/**
 * MEAN-FLOW STREAMLINES (a view of a measured or computed mean velocity field).
 *
 * A streamline of the time-averaged velocity field u(x, y) is the curve everywhere tangent to u: the path a massless
 * tracer would follow if it were carried by the MEAN flow. In the particle simulation no single particle follows such a
 * path (each moves thermally and collides); the lines drawn here are the paths of the mean motion, obtained by integrating
 * the seed- and time-averaged cell velocities. They are as good as that averaged field: where a cell has few samples the
 * line wanders, and where there is no data (inside the body, or never visited) a line simply ends.
 *
 *   d x / d s = u / |u|      (arc length s; RK4, bilinear interpolation between cell centres)
 *
 * Lines are laid out roughly evenly spaced (after Jobard & Lefer): seeds lie on a lattice of the requested spacing, a seed
 * too close to an existing line is dropped, and a line stops where it comes closer than a fraction of that spacing to
 * another line (or to its own earlier part: a closed recirculation loop then ends where it meets itself).
 * Nothing here is physics: it is a drawing of a field that was measured elsewhere.
 */
export interface GridField {
  nx: number;
  ny: number;
  /** lower-left corner of the grid and the cell size */
  x0: number;
  y0: number;
  cw: number;
  ch: number;
  /** cell-centred velocity, row-major with row 0 at y0 */
  ux: number[];
  uy: number[];
  /** a cell with data; the others (inside the body, never visited) hold no velocity */
  valid: boolean[];
}

export interface StreamOptions {
  /** distance between neighbouring lines */
  spacing: number;
  /** a line stops when it comes closer than testFraction · spacing to another line */
  testFraction: number;
  /** integration step (arc length) */
  step: number;
  /** longest line on either side of its seed (arc length) */
  maxLength: number;
  /** a line ends where the speed falls below this */
  minSpeed: number;
  /** extra exclusion (e.g. the body polygon): a line ends if this is true */
  inside?: (x: number, y: number) => boolean;
  maxLines?: number;
}

export interface Streamline {
  /** x0, y0, x1, y1, … in order along the flow */
  points: number[];
  /** the line came back to its own beginning (a closed loop) */
  closed: boolean;
}

export const DEFAULT_STREAM: Omit<StreamOptions, 'spacing' | 'step' | 'maxLength' | 'minSpeed'> = { testFraction: 0.5 };

/** Weighted 3 × 3 average of the velocity over the cells that have data (weights 1 centre, ½ sides, ¼ corners). */
export function smoothField(f: GridField, passes = 1): GridField {
  let ux = f.ux;
  let uy = f.uy;
  for (let p = 0; p < passes; p++) {
    const nx2 = new Array<number>(ux.length).fill(0);
    const ny2 = new Array<number>(ux.length).fill(0);
    for (let j = 0; j < f.ny; j++) {
      for (let i = 0; i < f.nx; i++) {
        const c = j * f.nx + i;
        if (!f.valid[c]) continue;
        let w = 0;
        let sx = 0;
        let sy = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= f.nx || b >= f.ny) continue;
            const q = b * f.nx + a;
            if (!f.valid[q]) continue;
            const k = (di === 0 ? 1 : 0.5) * (dj === 0 ? 1 : 0.5) * 4;
            w += k;
            sx += k * ux[q];
            sy += k * uy[q];
          }
        }
        nx2[c] = sx / w;
        ny2[c] = sy / w;
      }
    }
    ux = nx2;
    uy = ny2;
  }
  return { ...f, ux, uy };
}

/** Bilinear velocity at a point from the valid cells around it, or null outside the data. */
export function velocityAt(f: GridField, x: number, y: number): { u: number; v: number } | null {
  const fx = (x - f.x0) / f.cw - 0.5;
  const fy = (y - f.y0) / f.ch - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > f.nx - 0.5 || fy > f.ny - 0.5) return null;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  let w = 0;
  let u = 0;
  let v = 0;
  for (let dj = 0; dj <= 1; dj++) {
    for (let di = 0; di <= 1; di++) {
      const i = Math.min(f.nx - 1, Math.max(0, i0 + di));
      const j = Math.min(f.ny - 1, Math.max(0, j0 + dj));
      const c = j * f.nx + i;
      if (!f.valid[c]) continue;
      const k = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
      w += k;
      u += k * f.ux[c];
      v += k * f.uy[c];
    }
  }
  if (w < 0.6) return null;
  return { u: u / w, v: v / w };
}

class PointHash {
  private readonly cells = new Map<number, number[]>();
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly line: number[] = [];
  readonly s: number[] = [];
  constructor(private readonly size: number) {}
  private key(i: number, j: number) {
    return i * 73856093 + j * 19349663;
  }
  add(x: number, y: number, line: number, s: number) {
    const idx = this.x.length;
    this.x.push(x);
    this.y.push(y);
    this.line.push(line);
    this.s.push(s);
    const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size));
    const l = this.cells.get(k);
    if (l) l.push(idx);
    else this.cells.set(k, [idx]);
  }
  /** is there a point within `d` that is not an earlier stretch of the same line (|Δs| < `own`)? */
  near(x: number, y: number, d: number, line: number, s: number, own: number): boolean {
    const i0 = Math.floor(x / this.size);
    const j0 = Math.floor(y / this.size);
    const r = Math.ceil(d / this.size);
    for (let i = i0 - r; i <= i0 + r; i++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        const l = this.cells.get(this.key(i, j));
        if (!l) continue;
        for (const q of l) {
          if (this.line[q] === line && Math.abs(this.s[q] - s) < own) continue;
          if ((this.x[q] - x) ** 2 + (this.y[q] - y) ** 2 < d * d) return true;
        }
      }
    }
    return false;
  }
}

/** Evenly spaced streamlines of a grid field. */
export function traceStreamlines(f: GridField, o: StreamOptions): Streamline[] {
  const dtest = o.testFraction * o.spacing;
  const hash = new PointHash(Math.max(dtest, 1e-6));
  const lines: Streamline[] = [];
  const maxLines = o.maxLines ?? 400;
  const own = 3 * o.spacing;
  const dir = (x: number, y: number, sign: number): { dx: number; dy: number; speed: number } | null => {
    const v = velocityAt(f, x, y);
    if (!v) return null;
    const speed = Math.hypot(v.u, v.v);
    if (!(speed >= o.minSpeed)) return null;
    return { dx: (sign * v.u) / speed, dy: (sign * v.v) / speed, speed };
  };
  const stepRK4 = (x: number, y: number, h: number, sign: number): [number, number] | null => {
    const k1 = dir(x, y, sign);
    if (!k1) return null;
    const k2 = dir(x + 0.5 * h * k1.dx, y + 0.5 * h * k1.dy, sign);
    if (!k2) return null;
    const k3 = dir(x + 0.5 * h * k2.dx, y + 0.5 * h * k2.dy, sign);
    if (!k3) return null;
    const k4 = dir(x + h * k3.dx, y + h * k3.dy, sign);
    if (!k4) return null;
    return [x + (h / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx), y + (h / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy)];
  };
  const walk = (x: number, y: number, lineId: number, sign: number): { pts: number[]; closed: boolean } => {
    const pts: number[] = [];
    let cx = x;
    let cy = y;
    let s = 0;
    let closed = false;
    const maxSteps = Math.ceil(o.maxLength / o.step);
    for (let k = 0; k < maxSteps; k++) {
      const nxt = stepRK4(cx, cy, o.step, sign);
      if (!nxt) break;
      s += o.step;
      const sg = sign * s;
      if (o.inside && o.inside(nxt[0], nxt[1])) break;
      if (hash.near(nxt[0], nxt[1], dtest, lineId, sg, own)) {
        // meeting its own earlier part ends a loop
        closed = k > 4 && Math.hypot(nxt[0] - x, nxt[1] - y) < 2 * dtest && sign > 0;
        break;
      }
      pts.push(nxt[0], nxt[1]);
      hash.add(nxt[0], nxt[1], lineId, sg);
      cx = nxt[0];
      cy = nxt[1];
    }
    return { pts, closed };
  };
  const W = f.nx * f.cw;
  const H = f.ny * f.ch;
  const nI = Math.max(1, Math.floor(W / o.spacing));
  const nJ = Math.max(1, Math.floor(H / o.spacing));
  for (let i = 0; i < nI && lines.length < maxLines; i++) {
    for (let j = 0; j < nJ && lines.length < maxLines; j++) {
      const sx = f.x0 + (i + 0.5) * (W / nI);
      const sy = f.y0 + (j + 0.5) * (H / nJ);
      if (o.inside && o.inside(sx, sy)) continue;
      const v = dir(sx, sy, 1);
      if (!v) continue;
      const id = lines.length;
      if (hash.near(sx, sy, o.spacing * 0.9, -1, 0, 0)) continue;
      hash.add(sx, sy, id, 0);
      const fwd = walk(sx, sy, id, 1);
      const back = walk(sx, sy, id, -1);
      const pts: number[] = [];
      for (let k = back.pts.length - 2; k >= 0; k -= 2) pts.push(back.pts[k], back.pts[k + 1]);
      pts.push(sx, sy, ...fwd.pts);
      if (pts.length >= 8) lines.push({ points: pts, closed: fwd.closed });
    }
  }
  return lines;
}

/** Arrow positions along a streamline, every `every` of arc length: [x, y, direction angle]. */
export function arrowsOf(line: Streamline, every: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  let acc = every / 2;
  for (let k = 2; k < line.points.length; k += 2) {
    const dx = line.points[k] - line.points[k - 2];
    const dy = line.points[k + 1] - line.points[k - 1];
    acc += Math.hypot(dx, dy);
    if (acc >= every) {
      acc = 0;
      out.push([line.points[k], line.points[k + 1], Math.atan2(dy, dx)]);
    }
  }
  return out;
}

/** Point in polygon (interleaved vertices). */
export function insidePolygon(v: number[], x: number, y: number): boolean {
  let inside = false;
  const n = v.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = v[2 * i];
    const yi = v[2 * i + 1];
    const xj = v[2 * j];
    const yj = v[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
