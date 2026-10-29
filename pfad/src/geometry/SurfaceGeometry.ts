/**
 * Flow-guided geometry: the body representation.
 *
 * A body is a closed polygon built from two graph curves in a BODY FRAME (leading edge at
 * the origin, x along the chord, y across it):
 *
 *     upper:  y_u(x_i)   lower:  y_l(x_i)      x_i = i · chord / n,  i = 0 … n
 *
 * plus the two vertical end faces at x = 0 and x = chord. Every graph segment becomes one
 * straight polygon edge (no vertices are merged), so a "curve" is a polyline: the engine
 * (PolygonBody) has straight edges and point contacts at vertices, and nothing else. A
 * smooth surface is only as smooth as its stations (see docs/FLOW_GUIDED_GEOMETRY.md §2).
 *
 * The representation is a graph on purpose: it cannot overhang, so the polygon is always
 * simple, and every construction increment is a height change at a station.
 */
export type Side = 'upper' | 'lower';

export interface SurfaceGeometry {
  /** chord length in particle diameters */
  chord: number;
  /** segments per side */
  stations: number;
  /** y of the upper surface at stations 0 … n */
  upper: number[];
  /** y of the lower surface at stations 0 … n */
  lower: number[];
  /**
   * Station abscissae x_0 = 0 < … < x_n = chord, shared by both sides. Absent: uniform, x_i = i · chord / n
   * (the flat plate). The rounded plate (Pointer.ts) has closer stations around its two round ends.
   */
  xs?: number[];
  /**
   * Stations [lo, hi] whose surface the increment rules (Construction, LiveFill) may change and whose slope, curvature and
   * thickness the limits check. Absent: all. The round ends of the rounded plate lie outside it.
   */
  free?: [number, number];
  /**
   * Both sides meet in a single point at x = 0 and at x = chord (a rounded plate has no end faces). Absent: the plate has
   * blunt end faces, as the flat plate does.
   */
  pointedEnds?: boolean;
}

export interface GeometryLimits {
  /** smallest allowed local thickness y_u − y_l */
  minThickness: number;
  /** largest allowed |dy/dx| on a surface */
  maxSlope: number;
  /** largest allowed |second difference| of y per station, in units of dx (a curvature bound) */
  maxCurvature: number;
  /** largest allowed local thickness */
  maxThickness: number;
}

export const DEFAULT_LIMITS: GeometryLimits = { minThickness: 1.5, maxSlope: 0.5, maxCurvature: 0.35, maxThickness: 12 };

export function stationX(g: SurfaceGeometry): number[] {
  if (g.xs) return g.xs;
  const dx = g.chord / g.stations;
  return Array.from({ length: g.stations + 1 }, (_, i) => i * dx);
}

/** Station index whose segment [x_i, x_{i+1}] contains x (clamped to 0 … stations − 1). */
export function segmentAt(g: SurfaceGeometry, x: number): number {
  const xs = stationX(g);
  let lo = 0;
  let hi = g.stations - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Mean station spacing (the flat plate's dx). */
export function meanSpacing(g: SurfaceGeometry): number {
  return g.chord / g.stations;
}

/** Whether station i may be changed by the increment rules (see `free`). */
export function isFree(g: SurfaceGeometry, i: number): boolean {
  return !g.free || (i >= g.free[0] && i <= g.free[1]);
}

/** The starting geometry: a flat plate of the given thickness (blunt leading and trailing faces). */
export function flatPlate(chord: number, thickness: number, stations = Math.max(4, Math.round(chord))): SurfaceGeometry {
  if (!(chord > 0) || !(thickness > 0)) throw new Error('chord and thickness must be positive');
  if (!Number.isInteger(stations) || stations < 2) throw new Error('at least 2 stations');
  return { chord, stations, upper: new Array<number>(stations + 1).fill(thickness / 2), lower: new Array<number>(stations + 1).fill(-thickness / 2) };
}

export function cloneGeometry(g: SurfaceGeometry): SurfaceGeometry {
  const out: SurfaceGeometry = { chord: g.chord, stations: g.stations, upper: g.upper.slice(), lower: g.lower.slice() };
  if (g.xs) out.xs = g.xs.slice();
  if (g.free) out.free = [g.free[0], g.free[1]];
  if (g.pointedEnds) out.pointedEnds = true;
  return out;
}

export function sideY(g: SurfaceGeometry, side: Side): number[] {
  return side === 'upper' ? g.upper : g.lower;
}

/**
 * Counter-clockwise polygon in the body frame: lower surface LE→TE, trailing face, upper surface TE→LE.
 * With `pointedEnds` the two sides meet at the leading and trailing tips, so there is no end face and the shared tip
 * vertices appear once.
 */
export function bodyPolygon(g: SurfaceGeometry): number[] {
  const x = stationX(g);
  const n = g.stations;
  const v: number[] = [];
  for (let i = 0; i <= n; i++) v.push(x[i], g.lower[i]);
  const last = g.pointedEnds ? 1 : 0;
  const first = g.pointedEnds ? n - 1 : n;
  for (let i = first; i >= last; i--) v.push(x[i], g.upper[i]);
  return v;
}

/**
 * Polygon edge index of each graph segment. Vertices are ordered as in bodyPolygon, so
 * edge e runs from vertex e to vertex e+1: lower segments are edges 0 … n−1 (a→b
 * downstream), the trailing face is edge n, the upper segments are edges n+1 … 2n
 * (a→b upstream: segment k is edge 2n − k), and the leading face is edge 2n+1.
 * With pointed ends there are no end faces: upper segment k is edge 2n − 1 − k.
 */
export function edgeOfSegment(g: SurfaceGeometry, side: Side, k: number): number {
  const n = g.stations;
  if (g.pointedEnds) return side === 'lower' ? k : 2 * n - 1 - k;
  return side === 'lower' ? k : 2 * n - k;
}

/** Polygon vertex shared by graph segments k and k+1 of a side (see bodyPolygon for the vertex order). */
export function junctionVertex(g: SurfaceGeometry, side: Side, k: number): number {
  const n = g.stations;
  if (g.pointedEnds) return side === 'lower' ? k + 1 : 2 * n - 1 - k;
  return side === 'lower' ? k + 1 : 2 * n - k;
}

export interface Placement {
  /** leading-edge position in the simulation frame */
  x: number;
  y: number;
  /** angle of attack in degrees: nose up for positive values in a stream along +x */
  alphaDeg: number;
}

/** Rotate and translate body-frame points (interleaved) into the simulation frame. */
export function place(points: number[], p: Placement): number[] {
  const a = (-p.alphaDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const out = new Array<number>(points.length);
  for (let k = 0; k < points.length; k += 2) {
    out[k] = p.x + points[k] * ca - points[k + 1] * sa;
    out[k + 1] = p.y + points[k] * sa + points[k + 1] * ca;
  }
  return out;
}

/** The inverse of `place`: simulation-frame points into the body frame (x along the chord, y across it). */
export function unplace(points: number[], p: Placement): number[] {
  const a = (-p.alphaDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const out = new Array<number>(points.length);
  for (let k = 0; k < points.length; k += 2) {
    const dx = points[k] - p.x;
    const dy = points[k + 1] - p.y;
    out[k] = dx * ca + dy * sa;
    out[k + 1] = -dx * sa + dy * ca;
  }
  return out;
}

/** LE position so the mid-chord sits at (cx, cy) for this angle of attack. */
export function placementAt(g: SurfaceGeometry, cx: number, cy: number, alphaDeg: number): Placement {
  const a = (alphaDeg * Math.PI) / 180;
  return { x: cx - (g.chord / 2) * Math.cos(a), y: cy + (g.chord / 2) * Math.sin(a), alphaDeg };
}

export interface Issue {
  code: string;
  message: string;
}

/**
 * Local thickness, slope and curvature checks; an empty list means the geometry is within the limits. Only the free
 * stations are checked (all of them unless the geometry names a free range); the slope is dy/dx of a segment and the
 * curvature the change of slope from one segment to the next.
 */
export function validateGeometry(g: SurfaceGeometry, limits: GeometryLimits = DEFAULT_LIMITS): Issue[] {
  const issues: Issue[] = [];
  const n = g.stations;
  if (g.upper.length !== n + 1 || g.lower.length !== n + 1) return [{ code: 'shape', message: 'a surface needs stations + 1 values' }];
  const x = stationX(g);
  const lo = g.free ? g.free[0] : 0;
  const hi = g.free ? g.free[1] : n;
  for (const side of ['upper', 'lower'] as const) {
    const y = sideY(g, side);
    for (let i = 0; i <= n; i++) if (!Number.isFinite(y[i])) return [{ code: 'finite', message: `${side} surface has a non-finite value at station ${i}` }];
    const slope = (i: number) => (y[i + 1] - y[i]) / (x[i + 1] - x[i]);
    for (let i = lo; i < hi; i++) {
      if (Math.abs(slope(i)) > limits.maxSlope + 1e-9) issues.push({ code: 'slope', message: `${side} slope ${slope(i).toFixed(3)} at segment ${i} exceeds ${limits.maxSlope}` });
    }
    for (let i = lo + 1; i < hi; i++) {
      const curv = slope(i) - slope(i - 1);
      if (Math.abs(curv) > limits.maxCurvature + 1e-9) issues.push({ code: 'curvature', message: `${side} curvature ${curv.toFixed(3)} at station ${i} exceeds ${limits.maxCurvature}` });
    }
  }
  for (let i = lo; i <= hi; i++) {
    const t = g.upper[i] - g.lower[i];
    if (t < limits.minThickness - 1e-9) issues.push({ code: 'min-thickness', message: `thickness ${t.toFixed(3)} at station ${i} is below ${limits.minThickness}` });
    if (t > limits.maxThickness + 1e-9) issues.push({ code: 'max-thickness', message: `thickness ${t.toFixed(3)} at station ${i} exceeds ${limits.maxThickness}` });
  }
  return issues;
}

/** Samples of one surface: x, y, arc length from the leading edge, and local slope angle (degrees). */
export function sampleSurface(g: SurfaceGeometry, side: Side): { x: number; y: number; s: number; slopeDeg: number }[] {
  const x = stationX(g);
  const y = sideY(g, side);
  let s = 0;
  return x.map((xi, i) => {
    if (i > 0) s += Math.hypot(xi - x[i - 1], y[i] - y[i - 1]);
    const j = Math.min(i, g.stations - 1);
    return { x: xi, y: y[i], s, slopeDeg: (Math.atan2(y[j + 1] - y[j], x[j + 1] - x[j]) * 180) / Math.PI };
  });
}

/** Largest vertical difference between two geometries on the same stations (per side). */
export function maxDifference(a: SurfaceGeometry, b: SurfaceGeometry): { upper: number; lower: number } {
  if (a.stations !== b.stations) throw new Error('geometries use different stations');
  const d = (p: number[], q: number[]) => p.reduce((m, v, i) => Math.max(m, Math.abs(v - q[i])), 0);
  return { upper: d(a.upper, b.upper), lower: d(a.lower, b.lower) };
}

export function area(g: SurfaceGeometry): number {
  const x = stationX(g);
  let a = 0;
  for (let i = 0; i < g.stations; i++) a += 0.5 * (g.upper[i] - g.lower[i] + g.upper[i + 1] - g.lower[i + 1]) * (x[i + 1] - x[i]);
  return a;
}
