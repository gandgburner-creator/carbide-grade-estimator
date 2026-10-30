import { camberFunction, validateCamber, type CamberSpec } from './Camber';
import type { Side, SurfaceGeometry } from './SurfaceGeometry';

/**
 * THE ROUNDED PLATE AND THE CONSTRUCTION POINTER (engine-agnostic; used by the particle and the CFD workspaces).
 *
 * The starting body is a slot shape, not a rectangle: both ends are half-circles. The THICKNESS is the diameter of the leading
 * end circle and the TRAILING THICKNESS the diameter of the trailing one (when it is absent the two are the same); the LENGTH is the
 * distance between their centres plus the two radii. With different diameters the body is the hull of the two circles, joined by the
 * straight edges that touch both. PLATE FRAME: the origin is the centre of the leading-edge circle, x runs along the plate and y across
 * it; y is the OUTWARD HEIGHT above the axis on each side, so the plate's own surface (baseHeight) is at y = r = thickness / 2 on both
 * sides when the diameters are equal, and on the straight edge between the circles in general.
 *
 *      red dot R ~~~ arc ~~~ pointer P ───── tether (rope) ─────· green dot A (the anchor)
 *
 * Construction on one side. The RED DOT is the last place the pointer was put (at the start: the top of the leading circle, where
 * the straight edge leaves it). The POINTER is the next place. The ARC between them is a smooth curve (a cubic) whose direction at
 * each end is adjustable; unless it is set, the direction at a point is that of the TETHER, the straight rope from the point to the
 * GREEN DOT, the anchor. Ahead of the pointer the surface is the rope itself, running to the anchor and then on, along a straight
 * line, to the trailing circle. Every position that has been placed is kept: the drawn curve passes through all of them, joined by
 * such arcs, with one direction at each point so there is no corner at a placed point. The pointer moves forward along the plate (x)
 * and outward (y, never below the plate's own surface: material is only added). The anchor starts at the top of the trailing circle
 * and may be moved. It is a construction constraint chosen by the user, not a flow law, and nothing about the flow decides it.
 *
 * Nothing here knows an airfoil family, a camber line or a Kutta condition: the shape is whatever path the pointer was given.
 * Where the pointer goes is decided by the caller (by hand, or by a measurement through planPointerStep).
 */
export interface Pt {
  x: number;
  y: number;
  /** direction of the drawn curve at this point [radians from the plate axis, positive outward]; absent: along the tether (the rope to the anchor) */
  angle?: number;
}

export interface PlateSpec {
  /** tip to tip */
  length: number;
  /** diameter of the leading end circle (and of the trailing one when `trailingThickness` is absent) */
  thickness: number;
  /** diameter of the trailing end circle; absent: the same as `thickness` */
  trailingThickness?: number;
  /** the mid-line as a spline instead of a straight line (see Camber.ts); absent or without points: straight */
  camber?: CamberSpec;
}

/** The pointer paths of both sides, in outward-height coordinates (never below the plate's own surface), each starting where the straight edge leaves the leading circle. */
export interface PointerPaths {
  upper: Pt[];
  lower: Pt[];
  /** anchors (green dots) that have been moved; absent: the top of the trailing circle */
  anchor?: { upper?: Pt; lower?: Pt };
}

export interface PointerLimits {
  /** greatest height the pointer may be placed above the plate's own surface [d] */
  maxRise: number;
  /** greatest angle a curve direction may be set to, either way from the plate axis [radians] */
  maxAngle?: number;
  /** greatest |Δy / Δx| between consecutive pointer positions */
  maxSlope: number;
  /** the tether must keep at least this length (the pointer stops short of the anchor) unless it is placed exactly on it */
  minTether: number;
}

export const DEFAULT_POINTER_LIMITS: PointerLimits = { maxRise: 6, maxSlope: 1.2, minTether: 0, maxAngle: (88 * Math.PI) / 180 };

/** how long the handles of the joining cubic curves are, as a fraction of the distance between the two points */
const HANDLE = 0.4;

/** Radius of the leading end circle (the plate-frame origin is its centre, so this is also the offset to the body frame). */
export const radiusOf = (s: PlateSpec) => s.thickness / 2;
/** Radius of the trailing end circle. */
export const trailingRadiusOf = (s: PlateSpec) => (s.trailingThickness ?? s.thickness) / 2;
/**
 * How far the camber lifts the plate at plate-frame x (the origin is the centre of the leading circle): the height of the mid-line
 * spline above the chord line there; 0 for a straight plate. Heights in this file are heights above the plate's own wall, which
 * the camber carries with it, so a point at plate-frame (x, ±h) is at body-frame height ±h + camberShift(x).
 */
export function camberShift(s: PlateSpec, x: number): number {
  return s.camber && s.camber.points.length ? camberFunction(s.camber, s.length)(x + radiusOf(s)) : 0;
}

/** Distance between the centres of the two circles: the length minus the two radii. */
export const centreDistance = (s: PlateSpec) => s.length - radiusOf(s) - trailingRadiusOf(s);

export function validatePlate(s: PlateSpec): string | null {
  const t = s.trailingThickness ?? s.thickness;
  if (!(s.thickness > 0) || !(t > 0) || !(s.length > 0)) return 'length and thicknesses must be positive';
  if (s.length < radiusOf(s) + trailingRadiusOf(s) + Math.max(s.thickness, t)) return 'the plate must be at least twice as long as it is thick (two end circles and a straight stretch between them as long as the thicker end is wide)';
  if (s.camber && s.camber.points.length) return validateCamber(s.camber, s.length);
  return null;
}

/** Slope angle φ of the straight edge between the circles: sin φ = (r_lead − r_trail) / centre distance (positive: the plate tapers toward the trailing edge). */
const taper = (s: PlateSpec) => Math.asin(Math.max(-1, Math.min(1, (radiusOf(s) - trailingRadiusOf(s)) / centreDistance(s))));

/** Where the straight edge leaves the leading circle (its top when the two diameters are equal): where the pointer starts. */
export function startOf(s: PlateSpec): Pt {
  const phi = taper(s);
  return { x: radiusOf(s) * Math.sin(phi), y: radiusOf(s) * Math.cos(phi) };
}

/** The default anchor: where the straight edge meets the trailing circle (its top when the diameters are equal), in outward-height coordinates. */
export function defaultAnchor(s: PlateSpec): Pt {
  const phi = taper(s);
  return { x: centreDistance(s) + trailingRadiusOf(s) * Math.sin(phi), y: trailingRadiusOf(s) * Math.cos(phi) };
}

/** The anchor of one side: the one that was set, or the default. */
export function anchorOf(s: PlateSpec, paths?: PointerPaths | null, side: Side = 'upper'): Pt {
  const set = paths?.anchor?.[side];
  return set ? { x: set.x, y: set.y } : defaultAnchor(s);
}

/** Whether a side's anchor has been moved off its default place. */
export const anchorMoved = (s: PlateSpec, paths: PointerPaths, side: Side): boolean => {
  const set = paths.anchor?.[side];
  const d = defaultAnchor(s);
  return !!set && (Math.abs(set.x - d.x) > 1e-9 || Math.abs(set.y - d.y) > 1e-9);
};

/**
 * The plate's own surface: the outward height of the bare plate (the two circles and the straight edge between them) at plate-frame
 * x ∈ [−r, length − r]. Material is only added above it.
 */
export function baseHeight(s: PlateSpec, x: number): number {
  const r = radiusOf(s);
  const rt = trailingRadiusOf(s);
  const a = startOf(s);
  const b = defaultAnchor(s);
  if (x <= a.x) return Math.sqrt(Math.max(0, r * r - x * x));
  if (x >= b.x) {
    const dx = x - centreDistance(s);
    return Math.sqrt(Math.max(0, rt * rt - dx * dx));
  }
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

/**
 * Where the straight line from the anchor touches the trailing circle: the surface runs from the anchor along it, then round the
 * circle to the trailing tip. With the anchor at its default place this is the anchor itself (no line).
 */
export function tailPoint(s: PlateSpec, anchor: Pt): Pt {
  const D = centreDistance(s);
  const rt = trailingRadiusOf(s);
  const d0 = defaultAnchor(s);
  if (Math.abs(anchor.x - d0.x) < 1e-9 && Math.abs(anchor.y - d0.y) < 1e-9) return d0;
  // on the trailing circle itself (beyond its top) the anchor is the point where the straight line would touch it
  if (anchor.x > d0.x + 1e-9) return { x: anchor.x, y: anchor.y };
  const vx = anchor.x - D;
  const vy = anchor.y;
  const dist = Math.hypot(vx, vy);
  if (dist <= rt + 1e-9) return d0;
  const ang = Math.atan2(vy, vx) - Math.acos(rt / dist);
  return { x: D + rt * Math.cos(ang), y: rt * Math.sin(ang) };
}

export function initialPaths(s: PlateSpec): PointerPaths {
  const a = startOf(s);
  return { upper: [{ ...a }], lower: [{ ...a }] };
}

export function clonePaths(p: PointerPaths): PointerPaths {
  const out: PointerPaths = { upper: p.upper.map((q) => ({ ...q })), lower: p.lower.map((q) => ({ ...q })) };
  if (p.anchor) out.anchor = { ...(p.anchor.upper ? { upper: { ...p.anchor.upper } } : {}), ...(p.anchor.lower ? { lower: { ...p.anchor.lower } } : {}) };
  return out;
}

export const pathOf = (p: PointerPaths, side: Side): Pt[] => (side === 'upper' ? p.upper : p.lower);

/** Where the pointer is now on a side. */
export function pointerOf(p: PointerPaths, side: Side): Pt {
  const path = pathOf(p, side);
  return path[path.length - 1];
}

/** Whether a side has anything built on it. */
export function isBuilt(s: PlateSpec, path: Pt[]): boolean {
  return path.length > 1 || path[0].y > startOf(s).y + 1e-12;
}

/** The unit vector from a point to the anchor (along the plate if it is at the anchor). */
function tetherDirection(q: Pt, a: Pt): Pt {
  const dx = a.x - q.x;
  const dy = a.y - q.y;
  const L = Math.hypot(dx, dy);
  return L < 1e-12 ? { x: 1, y: 0 } : { x: dx / L, y: dy / L };
}

/**
 * The direction along the plate's own wall at plate-frame x, going forward (a unit vector): round the leading circle, along the
 * straight edge, round the trailing circle. At the very nose it points straight out from the plate (up on the upper side).
 */
export function wallDirection(s: PlateSpec, x: number): Pt {
  const r = radiusOf(s);
  const rt = trailingRadiusOf(s);
  const a = startOf(s);
  const b = defaultAnchor(s);
  if (x <= a.x) {
    const y = Math.sqrt(Math.max(0, r * r - x * x));
    const n = Math.hypot(y, x) || 1;
    return { x: y / n, y: -x / n };
  }
  if (x >= b.x) {
    const dx = x - centreDistance(s);
    const y = Math.sqrt(Math.max(0, rt * rt - dx * dx));
    const n = Math.hypot(y, dx) || 1;
    return { x: y / n, y: -dx / n };
  }
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
}

/**
 * The direction of the drawn curve at a placed point: the one that was set; else, for a point that lies ON the plate's own wall,
 * along the wall (so a curve that starts on the wall leaves it tangentially, with no kink); else along the tether.
 */
export function directionAt(s: PlateSpec, q: Pt, a: Pt): Pt {
  if (q.angle !== undefined) return { x: Math.cos(q.angle), y: Math.sin(q.angle) };
  if (Math.abs(q.y - baseHeight(s, q.x)) < 1e-9) return wallDirection(s, q.x);
  return tetherDirection(q, a);
}

export interface CubicSegment {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p3: Pt;
}

/** The drawn curve: one cubic between each pair of consecutive pointer positions, with the direction of each point at both its ends. */
export function drawnSegments(s: PlateSpec, path: Pt[], anchor: Pt = anchorOf(s)): CubicSegment[] {
  const out: CubicSegment[] = [];
  for (let k = 0; k + 1 < path.length; k++) {
    const a = path[k];
    const b = path[k + 1];
    const ua = directionAt(s, a, anchor);
    const ub = directionAt(s, b, anchor);
    const dx = b.x - a.x;
    const d = Math.hypot(dx, b.y - a.y);
    // keep x increasing along the curve, so the surface stays a graph over the plate
    const h = Math.min(HANDLE * d, (0.999 * dx) / Math.max(1e-6, ua.x + ub.x));
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
 * (rope) to the anchor, the straight line on to the trailing circle, and the trailing circle. The drawn curve is never lower
 * than the plate's own surface.
 */
export function outwardHeight(s: PlateSpec, path: Pt[], x: number, segs?: CubicSegment[], anchor: Pt = anchorOf(s)): number {
  const rt = trailingRadiusOf(s);
  const tail = tailPoint(s, anchor);
  // left of the first placed point the surface is the plate's own wall
  if (x <= path[0].x) return baseHeight(s, x);
  if (x >= tail.x) {
    const dx = x - centreDistance(s);
    return Math.sqrt(Math.max(0, rt * rt - dx * dx));
  }
  if (x >= anchor.x) {
    const f = tail.x - anchor.x < 1e-12 ? 1 : (x - anchor.x) / (tail.x - anchor.x);
    return anchor.y + f * (tail.y - anchor.y);
  }
  const last = path[path.length - 1];
  if (x >= last.x) {
    const f = anchor.x - last.x < 1e-12 ? 1 : (x - last.x) / (anchor.x - last.x);
    // a rope never goes through the plate: where the straight line would, it lies on the wall instead
    return Math.max(baseHeight(s, x), last.y + f * (anchor.y - last.y));
  }
  const sg = segs ?? drawnSegments(s, path, anchor);
  let k = 0;
  while (k + 1 < sg.length && x > sg[k].p3.x) k++;
  return Math.max(baseHeight(s, x), segmentHeight(sg[k], x));
}

/** Total thickness of the plate at plate-frame x (both sides). */
export function thicknessAt(s: PlateSpec, paths: PointerPaths, x: number): number {
  return outwardHeight(s, paths.upper, x, undefined, anchorOf(s, paths, 'upper')) + outwardHeight(s, paths.lower, x, undefined, anchorOf(s, paths, 'lower'));
}

/**
 * The plate as a SurfaceGeometry (body frame: leading tip at x = 0, stations closer together around the two round ends so that
 * the semicircles are real polygons, about `spacing` apart elsewhere). Both sides meet in the tips; there are no end faces.
 * The `free` stations are the straight stretch between the circles, the only part the increment rules (Construction,
 * LiveFill) may change. (The stations are the same on both sides, so the two anchors, which may have been moved separately, set
 * the stretch between them: the larger of the two.)
 */
export function plateGeometry(s: PlateSpec, paths: PointerPaths = initialPaths(s), spacing = 1): SurfaceGeometry {
  const err = validatePlate(s);
  if (err) throw new Error(err);
  const r = radiusOf(s);
  const rt = trailingRadiusOf(s);
  const D = centreDistance(s);
  const phi = taper(s);
  const a0 = startOf(s);
  const aU = anchorOf(s, paths, 'upper');
  const aL = anchorOf(s, paths, 'lower');
  const tU = tailPoint(s, aU);
  const tL = tailPoint(s, aL);
  const anchorX = Math.max(aU.x, aL.x);
  const tailX = Math.max(tU.x, tL.x);
  const mL = Math.max(2, Math.ceil((r * (Math.PI / 2 + phi)) / (0.8 * spacing)));
  const mT = Math.max(2, Math.ceil((rt * (Math.PI / 2 - phi)) / (0.8 * spacing)));
  const nMid = Math.max(2, Math.ceil((anchorX - a0.x) / spacing));
  const nTail = tailX - anchorX > 1e-9 ? Math.max(1, Math.ceil((tailX - anchorX) / spacing)) : 0;
  const xp: number[] = [];
  // leading arc: from the nose (angle π) to where the straight edge leaves the circle (π/2 − φ)
  for (let j = 0; j <= mL; j++) xp.push(r * Math.cos(Math.PI - (j / mL) * (Math.PI / 2 + phi)));
  xp[mL] = a0.x;
  for (let k = 1; k <= nMid; k++) xp.push(a0.x + ((anchorX - a0.x) * k) / nMid);
  for (let k = 1; k <= nTail; k++) xp.push(anchorX + ((tailX - anchorX) * k) / nTail);
  // trailing arc: from where the straight edge meets the circle (π/2 − φ) to the tip (angle 0)
  for (let j = 1; j <= mT; j++) xp.push(D + rt * Math.cos((1 - j / mT) * (Math.PI / 2 - phi)));
  const su = drawnSegments(s, paths.upper, aU);
  const sl = drawnSegments(s, paths.lower, aL);
  const n = xp.length - 1;
  const xs = xp.map((x) => x + r);
  xs[0] = 0;
  xs[n] = s.length;
  const lift = camberFunction(s.camber, s.length);
  const upper = xp.map((x, i) => outwardHeight(s, paths.upper, x, su, aU) + lift(xs[i]));
  const lower = xp.map((x, i) => -outwardHeight(s, paths.lower, x, sl, aL) + lift(xs[i]));
  upper[0] = 0;
  lower[0] = 0;
  upper[n] = 0;
  lower[n] = 0;
  return { chord: s.length, stations: n, upper, lower, xs, free: [mL, mL + nMid], pointedEnds: true };
}

/** Plate frame → body frame (x only: the body frame starts at the leading tip). */
export const toBodyX = (s: PlateSpec, x: number) => x + radiusOf(s);
export const fromBodyX = (s: PlateSpec, x: number) => x - radiusOf(s);

export type AddResult = { ok: true; paths: PointerPaths } | { ok: false; reason: string };

const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(0);

function checkAngle(angle: number | undefined, limits: PointerLimits): string | null {
  if (angle === undefined) return null;
  if (!Number.isFinite(angle)) return 'the direction of the curve is not a number';
  const max = limits.maxAngle ?? DEFAULT_POINTER_LIMITS.maxAngle!;
  if (Math.abs(angle) > max + 1e-9) return `the curve may not leave the plate axis by more than ${deg(max)}° either way (this is ${deg(angle)}°)`;
  return null;
}

/** Why a point may not be placed after `last` (towards `anchor`), or null. */
function checkPoint(s: PlateSpec, to: Pt, last: Pt, anchor: Pt, limits: PointerLimits): string | null {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return 'the pointer position is not a number';
  if (!(to.x > last.x + 1e-9)) return `the pointer only moves forward: x must be beyond ${last.x.toFixed(2)} d`;
  if (to.x > anchor.x + 1e-9) return `the pointer cannot pass the anchor at x = ${anchor.x.toFixed(2)} d`;
  if (to.x < anchor.x - 1e-9 && anchor.x - to.x < limits.minTether) return `the tether would be shorter than ${limits.minTether} d`;
  const base = baseHeight(s, to.x);
  if (to.y < base - 1e-9) return `material is only added: the pointer cannot go below the plate’s own surface (y = ${base.toFixed(2)} d here)`;
  if (to.y > base + limits.maxRise + 1e-9) return `the pointer is more than ${limits.maxRise} d above the plate`;
  // the step may be as steep as the limit says relative to the plate's own wall there (round the nose the wall itself is nearly vertical)
  const slope = Math.abs(to.y - last.y) / (to.x - last.x);
  const wallSlope = Math.abs(baseHeight(s, to.x) - baseHeight(s, last.x)) / (to.x - last.x);
  if (slope > limits.maxSlope + wallSlope + 1e-9) return `the step is steeper than ${limits.maxSlope} beyond the wall’s own slope (rise ${(to.y - last.y).toFixed(2)} over ${(to.x - last.x).toFixed(2)} d)`;
  return checkAngle(to.angle, limits);
}

/** Place the pointer of one side at a new position. Add-only, forward only, within the limits. */
export function addPointerPoint(s: PlateSpec, paths: PointerPaths, side: Side, to: Pt, limits: PointerLimits = DEFAULT_POINTER_LIMITS): AddResult {
  const path = pathOf(paths, side);
  const last = path[path.length - 1];
  const why = checkPoint(s, to, last, anchorOf(s, paths, side), limits);
  if (why) return { ok: false, reason: why };
  const next = clonePaths(paths);
  pathOf(next, side).push({ x: to.x, y: Math.max(baseHeight(s, to.x), to.y), ...(to.angle !== undefined ? { angle: to.angle } : {}) });
  return { ok: true, paths: next };
}

/**
 * Everything a person can adjust about the three points and the arc, in one change (applied in this order):
 *   red     slide the red dot along the wall (the surface as it is now: the drawn curve, then the rope; its height is that of the
 *           surface where it is, so only its x matters) and/or set the direction the curve has there. Going back along the drawn
 *           curve drops what was drawn beyond the red dot (the earlier version stays in the history);
 *   anchor  slide the green dot along the plate's own wall (only its x matters; the height is the wall's), forward of the red dot;
 *           null puts it back at the trailing circle's top;
 *   to      place the pointer, which is free above the wall (the arc from the red dot to it is drawn; the rope runs from it to the green dot).
 * A `to` of its own is optional: with none, the rope simply runs from the red dot.
 */
export interface PointerEdit {
  anchor?: Pt | null;
  red?: Pt;
  to?: Pt;
}

export function applyPointerEdit(s: PlateSpec, paths: PointerPaths, side: Side, edit: PointerEdit, limits: PointerLimits = DEFAULT_POINTER_LIMITS): AddResult {
  let next = clonePaths(paths);
  const rt = trailingRadiusOf(s);
  const xEnd = centreDistance(s) + rt;
  // the red dot slides along the surface as it is now (the drawn curve, then the rope); its height is that of the surface where it is
  if (edit.red) {
    const path = pathOf(next, side);
    const anchor = anchorOf(s, next, side);
    const r = edit.red;
    if (!Number.isFinite(r.x)) return { ok: false, reason: 'the red dot position is not a number' };
    const why = checkAngle(r.angle, limits);
    if (why) return { ok: false, reason: why };
    const xMin = -radiusOf(s);
    if (r.x < xMin - 1e-9) return { ok: false, reason: 'the red dot cannot go beyond the leftmost point of the leading edge' };
    // the green dot as it will be after this change (a red dot may be dragged forward together with the green dot)
    const anchorAfter = edit.anchor === undefined ? anchor.x : edit.anchor === null ? defaultAnchor(s).x : edit.anchor.x;
    if (!(r.x < anchorAfter - 1e-6)) return { ok: false, reason: `the red dot must lie before the green dot (x < ${anchorAfter.toFixed(2)} d from the middle of the leading circle)` };
    const y = outwardHeight(s, path, r.x, undefined, anchor);
    // going back along the drawn curve drops what was drawn beyond it (the version before it is kept in the history)
    const kept = path.filter((q) => q.x < r.x - 1e-9);
    const same = path.find((q) => Math.abs(q.x - r.x) < 1e-9);
    kept.push({ x: r.x, y: same ? same.y : y, ...(r.angle !== undefined ? { angle: r.angle } : {}) });
    path.length = 0;
    path.push(...kept);
  }
  // the green dot slides along the plate's own wall, from the red dot to the trailing tip; the surface beyond it is the wall
  if (edit.anchor !== undefined) {
    if (edit.anchor === null) {
      if (next.anchor) {
        delete next.anchor[side];
        if (!next.anchor.upper && !next.anchor.lower) delete next.anchor;
      }
    } else {
      const a = edit.anchor;
      const path = pathOf(next, side);
      const last = path[path.length - 1];
      if (!Number.isFinite(a.x)) return { ok: false, reason: 'the green dot position is not a number' };
      if (!(a.x > last.x + 1e-9)) return { ok: false, reason: `the green dot must lie beyond the red dot (x > ${last.x.toFixed(2)} d)` };
      if (a.x > xEnd - 1e-6) return { ok: false, reason: `the green dot cannot lie beyond the end of the trailing circle (x = ${xEnd.toFixed(2)} d)` };
      next.anchor = { ...(next.anchor ?? {}), [side]: { x: a.x, y: baseHeight(s, a.x) } };
    }
  }
  if (edit.to) {
    const added = addPointerPoint(s, next, side, edit.to, limits);
    if (!added.ok) return added;
    next = added.paths;
  }
  return { ok: true, paths: next };
}

/** What an edit does, in words (for version labels and the log): where each dot went and the directions that were set. */
export function describePointerEdit(s: PlateSpec, edit: PointerEdit): string {
  const at = (q: Pt) => `x = ${(q.x + radiusOf(s)).toFixed(1)} d from the leading tip, ${(q.y - baseHeight(s, q.x)).toFixed(2)} d above the plate`;
  const parts: string[] = [];
  if (edit.anchor === null) parts.push('green dot (anchor) put back at the trailing circle');
  else if (edit.anchor) parts.push(`green dot (anchor) moved to ${at(edit.anchor)}`);
  if (edit.red) parts.push(`red dot ${edit.red.angle !== undefined && !edit.to ? 'direction' : 'moved to ' + at(edit.red)}${edit.red.angle !== undefined ? ` (curve leaves it at ${deg(edit.red.angle)}°)` : ''}`);
  if (edit.to) parts.push(`pointer to ${at(edit.to)}${edit.to.angle !== undefined ? ` (curve arrives at ${deg(edit.to.angle)}°)` : ''}`);
  return parts.join('; ');
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
  const a = anchorOf(s, paths, side);
  const last = pointerOf(paths, side);
  if (last.x >= a.x - 1e-9) return null;
  const x = Math.min(a.x, last.x + cfg.step);
  const atAnchor = x >= a.x - 1e-9;
  const surface = outwardHeight(s, pathOf(paths, side), x, undefined, a);
  const gap = Math.max(0, gapAt(x));
  const rise = Math.min(cfg.maxRise, cfg.relaxation * Math.max(0, gap - cfg.margin));
  const y = atAnchor ? a.y : Math.max(baseHeight(s, x), surface + rise);
  return {
    to: { x: atAnchor ? a.x : x, y },
    surface,
    gap,
    rise: atAnchor ? 0 : rise,
    atAnchor,
    note: atAnchor ? 'the pointer reaches the trailing-edge anchor: the drawn curve is complete' : `at x = ${(x + radiusOf(s)).toFixed(1)} d from the leading tip the measured gap above the surface is ${gap.toFixed(2)} d, so the pointer rises ${rise.toFixed(2)} d above it`,
  };
}
