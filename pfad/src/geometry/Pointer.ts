import type { Side, SurfaceGeometry } from './SurfaceGeometry';

/**
 * THE ROUNDED PLATE AND THE CONSTRUCTION POINTER (engine-agnostic; used by the particle and the CFD workspaces).
 *
 * The starting body is a slot shape, not a rectangle: both ends are half-circles. The THICKNESS is the diameter of the two
 * end circles and the LENGTH is the distance between their centres plus one diameter. PLATE FRAME: the origin is the centre
 * of the leading-edge circle, x runs along the plate and y across it (y is the outward height above the axis on each side,
 * so the plate's own surface is at y = r = thickness / 2 on both sides).
 *
 *            ·────────── tether ──────────·
 *      pointer P                            anchor A = top of the trailing-edge circle = (length − thickness, r)
 *
 * Construction on one side. A POINTER starts at the top of the leading-edge circle, P0 = (0, r). It is moved forward along the
 * plate (x) and outward (y, never below the plate's own surface: material is only added). Every position it has been placed at
 * is kept: the DRAWN CURVE passes through them, joined by cubic curves that touch each other smoothly (equal tangents at every
 * point). At each point the tangent is the direction of the TETHER, the straight line from the pointer to the anchor A, so
 * the curve arrives at the pointer heading along the tether and leaves it the same way: there is no corner at the pointer.
 * Ahead of the pointer the surface is the tether itself, a straight line to A; at the start (pointer on the plate, tether on
 * the plate) nothing has been added. The anchor is a construction constraint chosen by the user, namely the plate's own
 * trailing-edge geometry; it is not a flow law and nothing about the flow decides it.
 *
 * Nothing here knows an airfoil family, a camber line or a Kutta condition: the shape is whatever path the pointer was given.
 * Where the pointer goes is decided by the caller (by hand, or by a measurement through planPointerStep).
 */
export interface Pt {
  x: number;
  y: number;
}

export interface PlateSpec {
  /** tip to tip */
  length: number;
  /** diameter of the two end circles */
  thickness: number;
}

/** The pointer paths of both sides, in outward-height coordinates (y ≥ r on either side), each starting at (0, r). */
export interface PointerPaths {
  upper: Pt[];
  lower: Pt[];
}

export interface PointerLimits {
  /** greatest height the pointer may be placed above the plate's own surface [d] */
  maxRise: number;
  /** greatest |Δy / Δx| between consecutive pointer positions */
  maxSlope: number;
  /** the tether must keep at least this length (the pointer stops short of the anchor) unless it is placed exactly on it */
  minTether: number;
}

export const DEFAULT_POINTER_LIMITS: PointerLimits = { maxRise: 6, maxSlope: 1.2, minTether: 0 };

/** how long the handles of the joining cubic curves are, as a fraction of the distance between the two points */
const HANDLE = 0.4;

export const radiusOf = (s: PlateSpec) => s.thickness / 2;

export function validatePlate(s: PlateSpec): string | null {
  if (!(s.thickness > 0) || !(s.length > 0)) return 'length and thickness must be positive';
  if (s.length < 2 * s.thickness) return 'the plate must be at least twice as long as it is thick (two end circles and a straight stretch between them)';
  return null;
}

/** The anchor: the top of the trailing-edge circle (where its flat edge meets the circle), in outward-height coordinates. */
export function anchorOf(s: PlateSpec): Pt {
  return { x: s.length - s.thickness, y: radiusOf(s) };
}

export function initialPaths(s: PlateSpec): PointerPaths {
  const r = radiusOf(s);
  return { upper: [{ x: 0, y: r }], lower: [{ x: 0, y: r }] };
}

export function clonePaths(p: PointerPaths): PointerPaths {
  return { upper: p.upper.map((q) => ({ ...q })), lower: p.lower.map((q) => ({ ...q })) };
}

export const pathOf = (p: PointerPaths, side: Side): Pt[] => (side === 'upper' ? p.upper : p.lower);

/** Where the pointer is now on a side. */
export function pointerOf(p: PointerPaths, side: Side): Pt {
  const path = pathOf(p, side);
  return path[path.length - 1];
}

/** Whether a side has anything built on it. */
export function isBuilt(s: PlateSpec, path: Pt[]): boolean {
  const r = radiusOf(s);
  return path.length > 1 || path[0].y > r + 1e-12;
}

/** The unit vector from a point to the anchor (along the plate if it is at the anchor). */
function tetherDirection(s: PlateSpec, q: Pt): Pt {
  const a = anchorOf(s);
  const dx = a.x - q.x;
  const dy = a.y - q.y;
  const L = Math.hypot(dx, dy);
  return L < 1e-12 ? { x: 1, y: 0 } : { x: dx / L, y: dy / L };
}

export interface CubicSegment {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

/** The drawn curve: one cubic between each pair of consecutive pointer positions, tangent to the tether at both. */
export function drawnSegments(s: PlateSpec, path: Pt[]): CubicSegment[] {
  const out: CubicSegment[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const ua = tetherDirection(s, a);
    const ub = tetherDirection(s, b);
    const dx = b.x - a.x;
    const d = Math.hypot(dx, b.y - a.y);
    // keep x increasing along the curve, so the surface stays a graph over the plate
    const h = Math.min(HANDLE * d, (0.999 * dx) / (ua.x + ub.x));
    out.push({ p0: a, c1: { x: a.x + h * ua.x, y: a.y + h * ua.y }, c2: { x: b.x - h * ub.x, y: b.y - h * ub.y }, p3: b });
  }
  return out;
}

const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

function segmentHeight(seg: CubicSegment, x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (bez(seg.p0.x, seg.c1.x, seg.c2.x, seg.p3.x, mid) < x) lo = mid;
    else hi = mid;
  }
  const t = 0.5 * (lo + hi);
  return bez(seg.p0.y, seg.c1.y, seg.c2.y, seg.p3.y, t);
}

/**
 * Outward height of one side of the plate at plate-frame x ∈ [−r, length − r]: the leading circle, the drawn curve, the tether
 * to the anchor, and the trailing circle. The drawn curve is never lower than the plate's own surface.
 */
export function outwardHeight(s: PlateSpec, path: Pt[], x: number, segs: CubicSegment[] = drawnSegments(s, path)): number {
  const r = radiusOf(s);
  const a = anchorOf(s);
  if (x <= 0) return Math.sqrt(Math.max(0, r * r - x * x));
  if (x >= a.x) return Math.sqrt(Math.max(0, r * r - (x - a.x) * (x - a.x)));
  const last = path[path.length - 1];
  if (x >= last.x) {
    const f = a.x - last.x < 1e-12 ? 1 : (x - last.x) / (a.x - last.x);
    return last.y + f * (a.y - last.y);
  }
  let k = 0;
  while (k + 1 < segs.length && x > segs[k].p3.x) k++;
  return Math.max(r, segmentHeight(segs[k], x));
}

/** Total thickness of the plate at plate-frame x (both sides). */
export function thicknessAt(s: PlateSpec, paths: PointerPaths, x: number): number {
  return outwardHeight(s, paths.upper, x) + outwardHeight(s, paths.lower, x);
}

/**
 * The plate as a SurfaceGeometry (body frame: leading tip at x = 0, stations closer together around the two round ends so that
 * the semicircles are real polygons, about `spacing` apart elsewhere). Both sides meet in the tips; there are no end faces.
 * The `free` stations are the straight stretch between the circles, the only part the increment rules (Construction,
 * LiveFill) may change.
 */
export function plateGeometry(s: PlateSpec, paths: PointerPaths = initialPaths(s), spacing = 1): SurfaceGeometry {
  const err = validatePlate(s);
  if (err) throw new Error(err);
  const r = radiusOf(s);
  const a = anchorOf(s);
  const m = Math.max(2, Math.ceil((Math.PI * r) / 2 / (0.8 * spacing)));
  const nMid = Math.max(2, Math.ceil(a.x / spacing));
  const xp: number[] = [];
  for (let j = 0; j <= m; j++) xp.push(-r * Math.cos((j / m) * (Math.PI / 2)));
  for (let k = 1; k <= nMid; k++) xp.push((a.x * k) / nMid);
  for (let j = 1; j <= m; j++) xp.push(a.x + r * Math.sin((j / m) * (Math.PI / 2)));
  const su = drawnSegments(s, paths.upper);
  const sl = drawnSegments(s, paths.lower);
  const n = xp.length - 1;
  const xs = xp.map((x) => x + r);
  xs[0] = 0;
  xs[n] = s.length;
  const upper = xp.map((x) => outwardHeight(s, paths.upper, x, su));
  const lower = xp.map((x) => -outwardHeight(s, paths.lower, x, sl));
  upper[0] = 0;
  lower[0] = 0;
  upper[n] = 0;
  lower[n] = 0;
  return { chord: s.length, stations: n, upper, lower, xs, free: [m, m + nMid], pointedEnds: true };
}

/** Plate frame → body frame (x only: the body frame starts at the leading tip). */
export const toBodyX = (s: PlateSpec, x: number) => x + radiusOf(s);
export const fromBodyX = (s: PlateSpec, x: number) => x - radiusOf(s);

export type AddResult = { ok: true; paths: PointerPaths } | { ok: false; reason: string };

/** Place the pointer of one side at a new position. Add-only, forward only, within the limits. */
export function addPointerPoint(s: PlateSpec, paths: PointerPaths, side: Side, to: Pt, limits: PointerLimits = DEFAULT_POINTER_LIMITS): AddResult {
  const r = radiusOf(s);
  const a = anchorOf(s);
  const path = pathOf(paths, side);
  const last = path[path.length - 1];
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return { ok: false, reason: 'the pointer position is not a number' };
  if (!(to.x > last.x + 1e-9)) return { ok: false, reason: `the pointer only moves forward: x must be beyond ${last.x.toFixed(2)} d` };
  if (to.x > a.x + 1e-9) return { ok: false, reason: `the pointer cannot pass the trailing-edge anchor at x = ${a.x.toFixed(2)} d` };
  if (to.x < a.x - 1e-9 && a.x - to.x < limits.minTether) return { ok: false, reason: `the tether would be shorter than ${limits.minTether} d` };
  if (to.y < r - 1e-9) return { ok: false, reason: `material is only added: the pointer cannot go below the plate’s own surface (y = ${r.toFixed(2)} d)` };
  if (to.y > r + limits.maxRise + 1e-9) return { ok: false, reason: `the pointer is more than ${limits.maxRise} d above the plate` };
  const slope = Math.abs(to.y - last.y) / (to.x - last.x);
  if (slope > limits.maxSlope + 1e-9) return { ok: false, reason: `the step is steeper than ${limits.maxSlope} (rise ${(to.y - last.y).toFixed(2)} over ${(to.x - last.x).toFixed(2)} d)` };
  const next = clonePaths(paths);
  pathOf(next, side).push({ x: to.x, y: Math.max(r, to.y) });
  return { ok: true, paths: next };
}

/** Remove the last pointer position of a side (the pointer goes back one step). */
export function undoPointerPoint(paths: PointerPaths, side: Side): PointerPaths {
  const next = clonePaths(paths);
  const path = pathOf(next, side);
  if (path.length > 1) path.pop();
  return next;
}

/** The step the automatic rule takes: where the pointer goes next and why. */
export interface PointerStepConfig {
  /** how far the pointer advances along the plate in one step [d] */
  step: number;
  /** fraction of the measured gap added above the current surface */
  relaxation: number;
  /** most the pointer may rise above the current surface in one step [d] */
  maxRise: number;
  /** gap left unfilled [d] */
  margin: number;
  limits: PointerLimits;
}

export const DEFAULT_POINTER_STEP: PointerStepConfig = { step: 3, relaxation: 0.5, maxRise: 1, margin: 0.3, limits: DEFAULT_POINTER_LIMITS };

export interface PointerStep {
  to: Pt;
  /** the height of the current surface at the new x, the measured gap there and the rise that followed from it */
  surface: number;
  gap: number;
  rise: number;
  /** the pointer has reached the anchor: nothing more to draw on this side */
  atAnchor: boolean;
  note: string;
}

/**
 * The next pointer position from a measurement. The pointer advances `step` along the plate, to just above the CURRENT surface
 * (the drawn curve or the tether) by a fraction of the measured gap between that surface and the flow, at most `maxRise`, and
 * not at all where nothing is measured (gap 0): then the curve simply follows the surface already there. `gapAt(x)` is the
 * measured gap at plate-frame x (0 where the flow touches the surface or nothing is known). Pure.
 */
export function planPointerStep(s: PlateSpec, paths: PointerPaths, side: Side, gapAt: (x: number) => number, cfg: PointerStepConfig = DEFAULT_POINTER_STEP): PointerStep | null {
  const a = anchorOf(s);
  const last = pointerOf(paths, side);
  if (last.x >= a.x - 1e-9) return null;
  const x = Math.min(a.x, last.x + cfg.step);
  const atAnchor = x >= a.x - 1e-9;
  const surface = outwardHeight(s, pathOf(paths, side), x);
  const gap = Math.max(0, gapAt(x));
  const rise = Math.min(cfg.maxRise, cfg.relaxation * Math.max(0, gap - cfg.margin));
  const y = atAnchor ? a.y : Math.max(radiusOf(s), surface + rise);
  return {
    to: { x: atAnchor ? a.x : x, y },
    surface,
    gap,
    rise: atAnchor ? 0 : rise,
    atAnchor,
    note: atAnchor ? 'the pointer reaches the trailing-edge anchor: the drawn curve is complete' : `at x = ${x.toFixed(1)} d the measured gap above the surface is ${gap.toFixed(2)} d, so the pointer rises ${rise.toFixed(2)} d above it`,
  };
}
