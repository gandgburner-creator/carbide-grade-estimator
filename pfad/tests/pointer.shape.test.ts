import { describe, expect, it } from 'vitest';
import { addPointerPoint, anchorMoved, anchorOf, applyPointerEdit, baseHeight, centreDistance, defaultAnchor, drawnSegments, initialPaths, outwardHeight, plateGeometry, pointerOf, radiusOf, startOf, tailPoint, trailingRadiusOf, validatePlate, type PlateSpec } from '../src/geometry/Pointer';
import { bodyPolygon, stationX, validateGeometry } from '../src/geometry/SurfaceGeometry';
import { polygonArea } from '../src/walls/SolidBody';

const EQUAL: PlateSpec = { length: 30, thickness: 3 };
const TAPER: PlateSpec = { length: 30, thickness: 3, trailingThickness: 1.2 };
const FAT_TAIL: PlateSpec = { length: 30, thickness: 2, trailingThickness: 4 };

describe('independent diameters of the leading and trailing circle', () => {
  it('an absent or an equal trailing diameter is the same plate as before', () => {
    const a = plateGeometry(EQUAL);
    const b = plateGeometry({ ...EQUAL, trailingThickness: 3 });
    expect(b).toEqual(a);
    expect(startOf(EQUAL)).toEqual({ x: 0, y: 1.5 });
    expect(defaultAnchor(EQUAL)).toEqual({ x: 27, y: 1.5 });
  });

  it('length is the centre distance plus the two radii; the tips are at 0 and at the length', () => {
    for (const S of [TAPER, FAT_TAIL]) {
      expect(centreDistance(S) + radiusOf(S) + trailingRadiusOf(S)).toBeCloseTo(S.length, 12);
      const g = plateGeometry(S);
      const xs = stationX(g);
      expect(xs[0]).toBe(0);
      expect(xs[g.stations]).toBe(S.length);
      // the widest point of each end circle is its diameter: the height above its centre column
      const iL = xs.findIndex((x) => x >= radiusOf(S) - 1e-9);
      const iT = xs.findIndex((x) => x >= radiusOf(S) + centreDistance(S) - 1e-9);
      expect(g.upper[iL] - g.lower[iL]).toBeGreaterThan(S.thickness * 0.97);
      expect(g.upper[iT] - g.lower[iT]).toBeGreaterThan((S.trailingThickness ?? S.thickness) * 0.92);
      expect(g.upper[iT] - g.lower[iT]).toBeLessThan((S.trailingThickness ?? S.thickness) * 1.03);
    }
  });

  it('the straight edge touches both circles (tangent), at the start point and at the anchor', () => {
    for (const S of [TAPER, FAT_TAIL]) {
      const a = startOf(S);
      const b = defaultAnchor(S);
      // the point lies on its circle …
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(radiusOf(S), 12);
      expect(Math.hypot(b.x - centreDistance(S), b.y)).toBeCloseTo(trailingRadiusOf(S), 12);
      // … and the edge between them is perpendicular to the radius at both ends
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      expect(ex * a.x + ey * a.y).toBeCloseTo(0, 9);
      expect(ex * (b.x - centreDistance(S)) + ey * b.y).toBeCloseTo(0, 9);
      // the plate's own surface runs along it
      expect(baseHeight(S, 0.5 * (a.x + b.x))).toBeCloseTo(0.5 * (a.y + b.y), 12);
    }
  });

  it('a plate that tapers is thicker at the leading end, one with a fat tail the other way round', () => {
    const t = plateGeometry(TAPER);
    const f = plateGeometry(FAT_TAIL);
    expect(t.upper[Math.floor(t.stations * 0.2)]).toBeGreaterThan(t.upper[Math.floor(t.stations * 0.8)]);
    expect(f.upper[Math.floor(f.stations * 0.2)]).toBeLessThan(f.upper[Math.floor(f.stations * 0.8)]);
  });

  it('is a valid, simple, counter-clockwise polygon whose area is that of the hull of the two circles', () => {
    for (const S of [TAPER, FAT_TAIL]) {
      const g = plateGeometry(S, undefined, 0.5);
      expect(validateGeometry(g, { minThickness: 0.5, maxSlope: 1, maxCurvature: 2, maxThickness: 12 }).length).toBe(0);
      const poly = bodyPolygon(g);
      const A = polygonArea(poly);
      const r1 = radiusOf(S);
      const r2 = trailingRadiusOf(S);
      const D = centreDistance(S);
      // the hull of two circles: both discs, plus the trapezoid between the tangent points, minus the overlaps (computed as the exact formula)
      const phi = Math.asin((r1 - r2) / D);
      const L = D * Math.cos(phi); // length of the tangent segment
      const hull = (r1 * r1 * (Math.PI + 2 * phi)) / 2 + (r2 * r2 * (Math.PI - 2 * phi)) / 2 + L * (r1 + r2) * Math.cos(0) * 0 + L * (r1 * Math.cos(phi) + r2 * Math.cos(phi));
      expect(Math.abs(A - hull) / hull).toBeLessThan(0.02);
    }
  });

  it('is refused when the plate is too short for the thicker end', () => {
    expect(validatePlate({ length: 7, thickness: 3, trailingThickness: 4 })).toMatch(/at least twice/);
    expect(validatePlate({ length: 30, thickness: 3, trailingThickness: 0 })).toMatch(/positive/);
    expect(validatePlate(TAPER)).toBeNull();
  });

  it('material is added above the straight edge, never below it, on a plate with different diameters', () => {
    const paths = initialPaths(TAPER);
    const x = 10;
    const below = addPointerPoint(TAPER, paths, 'upper', { x, y: baseHeight(TAPER, x) - 0.2 });
    expect(below.ok).toBe(false);
    const ok = addPointerPoint(TAPER, paths, 'upper', { x, y: baseHeight(TAPER, x) + 0.6 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const g = plateGeometry(TAPER, ok.paths, 1);
      const g0 = plateGeometry(TAPER, paths, 1);
      g.upper.forEach((y, i) => expect(y).toBeGreaterThanOrEqual(g0.upper[i] - 1e-9));
      expect(g.lower).toEqual(g0.lower);
    }
  });
});

describe('the green dot (anchor) can be moved', () => {
  const S = EQUAL;
  const move = (a: { x: number; y: number }) => applyPointerEdit(S, initialPaths(S), 'upper', { anchor: a });

  it('starts at the top of the trailing circle and is not "moved" until it is', () => {
    expect(anchorOf(S, initialPaths(S), 'upper')).toEqual({ x: 27, y: 1.5 });
    expect(anchorMoved(S, initialPaths(S), 'upper')).toBe(false);
  });

  it('a moved anchor is on the side that was moved only, and the surface then runs to it and on to the trailing circle along a straight line', () => {
    const r = move({ x: 22, y: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(anchorOf(S, r.paths, 'upper')).toEqual({ x: 22, y: 3 });
    expect(anchorOf(S, r.paths, 'lower')).toEqual({ x: 27, y: 1.5 });
    expect(anchorMoved(S, r.paths, 'upper')).toBe(true);
    const a = anchorOf(S, r.paths, 'upper');
    const t = tailPoint(S, a);
    // the line from the anchor touches the trailing circle: the tail point is on it, and the line is perpendicular to its radius there
    expect(Math.hypot(t.x - 27, t.y)).toBeCloseTo(1.5, 9);
    expect((t.x - a.x) * (t.x - 27) + (t.y - a.y) * t.y).toBeCloseTo(0, 9);
    // the height follows: the rope from the pointer reaches the anchor, then the line, then the circle
    const path = r.paths.upper;
    expect(outwardHeight(S, path, 22, undefined, a)).toBeCloseTo(3, 9);
    expect(outwardHeight(S, path, 0.5 * (a.x + t.x), undefined, a)).toBeCloseTo(0.5 * (a.y + t.y), 9);
    expect(outwardHeight(S, path, 28.5, undefined, a)).toBeCloseTo(Math.sqrt(1.5 * 1.5 - 1.5 * 1.5), 9);
    // the surface is a graph over the whole plate and never below the plate's own surface
    const g = plateGeometry(S, r.paths, 1);
    for (let x = -1.4; x <= 28.4; x += 0.37) {
      expect(outwardHeight(S, r.paths.upper, x, undefined, a)).toBeGreaterThanOrEqual(baseHeight(S, x) - 1e-9);
      expect(outwardHeight(S, r.paths.lower, x)).toBeCloseTo(baseHeight(S, x), 9);
    }
    expect(Math.max(...g.upper)).toBeGreaterThan(2.9);
    expect(Math.min(...g.lower)).toBeCloseTo(-1.5, 9);
    expect(stationX(g).every((x, i, xs) => i === 0 || x > xs[i - 1])).toBe(true);
  });

  it('refuses an anchor below the plate, beyond the top of the trailing circle, behind the red dot, or too high', () => {
    expect(move({ x: 20, y: 1.0 }).ok).toBe(false);
    expect(move({ x: 28, y: 3 }).ok).toBe(false);
    expect(move({ x: 20, y: 20 }).ok).toBe(false);
    const placed = addPointerPoint(S, initialPaths(S), 'upper', { x: 12, y: 2.2 });
    expect(placed.ok).toBe(true);
    if (placed.ok) expect(applyPointerEdit(S, placed.paths, 'upper', { anchor: { x: 11, y: 2.5 } }).ok).toBe(false);
  });

  it('null puts the anchor back', () => {
    const r = move({ x: 22, y: 3 });
    if (!r.ok) throw new Error('setup');
    const back = applyPointerEdit(S, r.paths, 'upper', { anchor: null });
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(anchorMoved(S, back.paths, 'upper')).toBe(false);
      expect(back.paths.anchor).toBeUndefined();
    }
  });
});

describe('the arc between the red dot and the pointer can be bent', () => {
  const S = EQUAL;
  const base = addPointerPoint(S, initialPaths(S), 'upper', { x: 8, y: 2.3 });
  if (!base.ok) throw new Error('setup');

  it('the direction at a placed point is the tether by default, and the angle that was set when there is one', () => {
    const along = addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6 });
    const bent = addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: (35 * Math.PI) / 180 });
    expect(along.ok && bent.ok).toBe(true);
    if (!along.ok || !bent.ok) return;
    const h = (paths: typeof along.paths, x: number) => outwardHeight(S, paths.upper, x);
    // both pass through the placed points …
    expect(h(along.paths, 16)).toBeCloseTo(2.6, 9);
    expect(h(bent.paths, 16)).toBeCloseTo(2.6, 9);
    expect(h(bent.paths, 8)).toBeCloseTo(2.3, 9);
    // … but between them the bent one arrives steeper, so it is lower early and higher late than the other
    expect(h(bent.paths, 14.5)).not.toBeCloseTo(h(along.paths, 14.5), 3);
    // the segment arriving at the point and the one leaving it share its direction (no corner)
    const next = addPointerPoint(S, bent.paths, 'upper', { x: 24, y: 2.0 });
    if (!next.ok) throw new Error('setup');
    const seg = drawnSegments(S, next.paths.upper);
    const arrive = { x: seg[1].p0.x - seg[1].c1.x, y: seg[1].p0.y - seg[1].c1.y };
    const leave = { x: seg[2 - 1].p3.x - seg[1].c2.x, y: seg[1].p3.y - seg[1].c2.y };
    void leave;
    const in2 = { x: seg[0].p3.x - seg[0].c2.x, y: seg[0].p3.y - seg[0].c2.y };
    expect(Math.atan2(in2.y, in2.x)).toBeCloseTo(Math.atan2(-arrive.y, -arrive.x), 9);
  });

  it('the surface stays a graph over the plate for every allowed angle, and an angle beyond the limit is refused', () => {
    for (const deg of [-60, -30, 0, 30, 60, 80]) {
      const p = addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: (deg * Math.PI) / 180 });
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      const g = plateGeometry(S, p.paths, 1);
      expect(stationX(g).every((x, i, xs) => i === 0 || x > xs[i - 1])).toBe(true);
      // never below the plate's own surface
      g.upper.forEach((y, i) => expect(y).toBeGreaterThanOrEqual(plateGeometry(S, initialPaths(S), 1).upper[i] - 1e-9));
    }
    expect(addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: (85 * Math.PI) / 180 }).ok).toBe(false);
    expect(addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: Number.NaN }).ok).toBe(false);
  });
});

describe('the red dot can be put somewhere else', () => {
  const S = EQUAL;
  const p1 = addPointerPoint(S, initialPaths(S), 'upper', { x: 8, y: 2.3 });
  if (!p1.ok) throw new Error('setup');

  it('moves the last placed point, within the same rules, and the old paths are untouched', () => {
    const r = applyPointerEdit(S, p1.paths, 'upper', { red: { x: 9, y: 2.6 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pointerOf(r.paths, 'upper')).toEqual({ x: 9, y: 2.6 });
    expect(pointerOf(p1.paths, 'upper')).toEqual({ x: 8, y: 2.3 });
    expect(applyPointerEdit(S, p1.paths, 'upper', { red: { x: 9, y: 0.5 } }).ok).toBe(false);
    expect(applyPointerEdit(S, p1.paths, 'upper', { red: { x: -1, y: 2 } }).ok).toBe(false);
  });

  it('at the very start only the direction can change: the start stays where the straight edge leaves the circle', () => {
    const start = startOf(S);
    const a = applyPointerEdit(S, initialPaths(S), 'upper', { red: { ...start, angle: 0.3 } });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.paths.upper[0].angle).toBe(0.3);
    const m = applyPointerEdit(S, initialPaths(S), 'upper', { red: { x: 1, y: 1.6 } });
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.reason).toMatch(/cannot be moved/);
  });

  it('can be combined with moving the green dot and placing the pointer in one change', () => {
    const r = applyPointerEdit(S, p1.paths, 'upper', { anchor: { x: 24, y: 2.4 }, red: { x: 8.5, y: 2.4, angle: 0.1 }, to: { x: 16, y: 2.8, angle: -0.05 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.paths.upper.length).toBe(3);
    expect(r.paths.upper[1]).toEqual({ x: 8.5, y: 2.4, angle: 0.1 });
    expect(anchorOf(S, r.paths, 'upper')).toEqual({ x: 24, y: 2.4 });
    const g = plateGeometry(S, r.paths, 1);
    expect(validateGeometry(g, { minThickness: 0.5, maxSlope: 1, maxCurvature: 2, maxThickness: 12 }).length).toBe(0);
  });

  it('older saved paths (no anchors, no angles) keep working', () => {
    const old = { upper: [{ x: 0, y: 1.5 }, { x: 8, y: 2.3 }], lower: [{ x: 0, y: 1.5 }] };
    const g = plateGeometry(S, old, 1);
    expect(g.upper.some((y) => y > 2.2)).toBe(true);
  });
});
