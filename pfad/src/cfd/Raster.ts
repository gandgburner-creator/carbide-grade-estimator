import { CX, CY } from './Lbm';

/**
 * Turning a polygon into the solid of a lattice: which nodes are inside it, and, for every wall link (a fluid node and its
 * solid neighbour in direction c_k), the fraction q of the link at which the wall lies. Node (i, j) sits at (i + ½, j + ½) in
 * lattice coordinates; the polygon is given in the same coordinates (interleaved x, y).
 */
export function insidePoly(v: number[], x: number, y: number): boolean {
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

/** Smallest t ∈ (0, 1] where the segment p + t d crosses an edge of the polygon, or null. */
function crossing(v: number[], px: number, py: number, dx: number, dy: number): number | null {
  const n = v.length / 2;
  let best: number | null = null;
  for (let a = 0; a < n; a++) {
    const b = (a + 1) % n;
    const ex = v[2 * b] - v[2 * a];
    const ey = v[2 * b + 1] - v[2 * a + 1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-14) continue;
    const wx = v[2 * a] - px;
    const wy = v[2 * a + 1] - py;
    const t = (wx * ey - wy * ex) / den;
    const s = (wx * dy - wy * dx) / den;
    if (t > 1e-9 && t <= 1 + 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) {
      if (best === null || t < best) best = Math.min(1, t);
    }
  }
  return best;
}

export interface Raster {
  solid: Uint8Array;
  wallQ: Float32Array;
  /** number of solid nodes and of wall links */
  solidNodes: number;
  links: number;
}

export function rasterize(nx: number, ny: number, poly: number[]): Raster {
  const N = nx * ny;
  const solid = new Uint8Array(N);
  const wallQ = new Float32Array(9 * N);
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let k = 0; k < poly.length; k += 2) {
    xmin = Math.min(xmin, poly[k]);
    xmax = Math.max(xmax, poly[k]);
    ymin = Math.min(ymin, poly[k + 1]);
    ymax = Math.max(ymax, poly[k + 1]);
  }
  const i0 = Math.max(0, Math.floor(xmin) - 1);
  const i1 = Math.min(nx - 1, Math.ceil(xmax) + 1);
  const j0 = Math.max(0, Math.floor(ymin) - 1);
  const j1 = Math.min(ny - 1, Math.ceil(ymax) + 1);
  let solidNodes = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (insidePoly(poly, i + 0.5, j + 0.5)) {
        solid[j * nx + i] = 1;
        solidNodes++;
      }
    }
  let links = 0;
  for (let j = Math.max(0, j0 - 1); j <= Math.min(ny - 1, j1 + 1); j++)
    for (let i = Math.max(0, i0 - 1); i <= Math.min(nx - 1, i1 + 1); i++) {
      const n = j * nx + i;
      if (solid[n]) continue;
      for (let k = 1; k < 9; k++) {
        const si = i + CX[k];
        const sj = j + CY[k];
        if (si < 0 || sj < 0 || si >= nx || sj >= ny || !solid[sj * nx + si]) continue;
        const t = crossing(poly, i + 0.5, j + 0.5, CX[k], CY[k]);
        wallQ[k * N + n] = Math.min(1, Math.max(1e-3, t ?? 0.5));
        links++;
      }
    }
  return { solid, wallQ, solidNodes, links };
}

/** A regular polygon approximating a circle (counter-clockwise). */
export function circlePolygon(cx: number, cy: number, r: number, sides = 96): number[] {
  const v: number[] = [];
  for (let k = 0; k < sides; k++) v.push(cx + r * Math.cos((2 * Math.PI * k) / sides), cy + r * Math.sin((2 * Math.PI * k) / sides));
  return v;
}
