import { describe, expect, it } from 'vitest';
import { addPointerPoint, anchorMoved, anchorOf, applyPointerEdit, baseHeight, centreDistance, defaultAnchor, drawnSegments, initialPaths, outwardHeight, plateGeometry, pointerOf, radiusOf, startOf, trailingRadiusOf, validatePlate, type PlateSpec } from '../src/geometry/Pointer';
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

describe('the green dot (anchor) slides along the plate’s own wall', () => {
  const S = EQUAL;
  const move = (x: number) => applyPointerEdit(S, initialPaths(S), 'upper', { anchor: { x, y: 99 } });

  it('starts at the top of the trailing circle and is not "moved" until it is', () => {
    expect(anchorOf(S, initialPaths(S), 'upper')).toEqual({ x: 27, y: 1.5 });
    expect(anchorMoved(S, initialPaths(S), 'upper')).toBe(false);
  });

  it('a moved anchor is on the wall wherever it is put (only its x counts), on that side only, and the surface beyond it is the wall', () => {
    for (const x of [8, 22, 27, 28.4]) {
      const r = move(x);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const a = anchorOf(S, r.paths, 'upper');
      expect(a.x).toBe(x);
      expect(a.y).toBeCloseTo(baseHeight(S, x), 12);
      expect(anchorOf(S, r.paths, 'lower')).toEqual({ x: 27, y: 1.5 });
      // beyond the green dot the surface is the plate's own wall, and nowhere is it below it
      for (let q = -1.4; q <= 28.4; q += 0.37) {
        expect(outwardHeight(S, r.paths.upper, q, undefined, a)).toBeGreaterThanOrEqual(baseHeight(S, q) - 1e-9);
        if (q >= x) expect(outwardHeight(S, r.paths.upper, q, undefined, a)).toBeCloseTo(baseHeight(S, q), 9);
      }
    }
  });

  it('with a bump already drawn, the rope comes down to the green dot on the wall and the wall continues', () => {
    const placed = applyPointerEdit(S, initialPaths(S), 'upper', { anchor: { x: 20, y: 0 }, to: { x: 10, y: 3 } });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const a = anchorOf(S, placed.paths, 'upper');
    expect(outwardHeight(S, placed.paths.upper, 10, undefined, a)).toBeCloseTo(3, 9);
    // the rope runs straight from the pointer to the green dot
    expect(outwardHeight(S, placed.paths.upper, 15, undefined, a)).toBeCloseTo(0.5 * (3 + 1.5), 9);
    expect(outwardHeight(S, placed.paths.upper, 24, undefined, a)).toBeCloseTo(1.5, 9);
    const g = plateGeometry(S, placed.paths, 1);
    expect(Math.max(...g.upper)).toBeGreaterThan(2.9);
    expect(stationX(g).every((x, i, xs) => i === 0 || x > xs[i - 1])).toBe(true);
  });

  it('refuses a green dot behind the red dot or beyond the trailing tip', () => {
    const placed = addPointerPoint(S, initialPaths(S), 'upper', { x: 12, y: 2.2 });
    expect(placed.ok).toBe(true);
    if (placed.ok) expect(applyPointerEdit(S, placed.paths, 'upper', { anchor: { x: 11, y: 0 } }).ok).toBe(false);
    expect(move(29.5).ok).toBe(false);
    expect(move(Number.NaN).ok).toBe(false);
  });

  it('null puts the anchor back', () => {
    const r = move(22);
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
    expect(h(along.paths, 16)).toBeCloseTo(2.6, 9);
    expect(h(bent.paths, 16)).toBeCloseTo(2.6, 9);
    expect(h(bent.paths, 8)).toBeCloseTo(2.3, 9);
    expect(h(bent.paths, 14.5)).not.toBeCloseTo(h(along.paths, 14.5), 3);
    // the segment arriving at the point and the one leaving it share its direction (no corner)
    const next = addPointerPoint(S, bent.paths, 'upper', { x: 24, y: 2.0 });
    if (!next.ok) throw new Error('setup');
    const seg = drawnSegments(S, next.paths.upper);
    const arrive = { x: seg[1].c1.x - seg[1].p0.x, y: seg[1].c1.y - seg[1].p0.y };
    const into = { x: seg[0].p3.x - seg[0].c2.x, y: seg[0].p3.y - seg[0].c2.y };
    expect(Math.atan2(into.y, into.x)).toBeCloseTo(Math.atan2(arrive.y, arrive.x), 9);
  });

  it('the surface stays a graph over the plate for every allowed angle, and an angle beyond the limit is refused', () => {
    for (const deg of [-60, -30, 0, 30, 60, 80]) {
      const p = addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: (deg * Math.PI) / 180 });
      expect(p.ok).toBe(true);
      if (!p.ok) continue;
      const g = plateGeometry(S, p.paths, 1);
      expect(stationX(g).every((x, i, xs) => i === 0 || x > xs[i - 1])).toBe(true);
      for (let x = -1.4; x <= 28.4; x += 0.37) expect(outwardHeight(S, p.paths.upper, x)).toBeGreaterThanOrEqual(baseHeight(S, x) - 1e-9);
    }
    expect(addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: (85 * Math.PI) / 180 }).ok).toBe(false);
    expect(addPointerPoint(S, base.paths, 'upper', { x: 16, y: 2.6, angle: Number.NaN }).ok).toBe(false);
  });
});

describe('the red dot slides along the wall', () => {
  const S = EQUAL;
  const drawn = applyPointerEdit(S, initialPaths(S), 'upper', { to: { x: 8, y: 2.3 } });
  if (!drawn.ok) throw new Error('setup');
  const drawn2 = applyPointerEdit(S, drawn.paths, 'upper', { to: { x: 16, y: 2.6 } });
  if (!drawn2.ok) throw new Error('setup');

  it('at the start it can be put anywhere along the plate’s own wall, and its height is the wall’s there', () => {
    for (const x of [-1.0, 0, 6, 15, 26]) {
      const r = applyPointerEdit(S, initialPaths(S), 'upper', { red: { x, y: 99 } });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const p = pointerOf(r.paths, 'upper');
      expect(p.x).toBeCloseTo(x, 12);
      expect(p.y).toBeCloseTo(baseHeight(S, x), 12);
    }
    // it cannot go round the nose, nor on to or past the green dot
    expect(applyPointerEdit(S, initialPaths(S), 'upper', { red: { x: -1.45, y: 0 } }).ok).toBe(false);
    expect(applyPointerEdit(S, initialPaths(S), 'upper', { red: { x: 27, y: 0 } }).ok).toBe(false);
  });

  it('a new arc from a red dot on the wall to a pointer above it makes a bump that starts exactly there', () => {
    const r = applyPointerEdit(S, initialPaths(S), 'upper', { red: { x: 10, y: 0 }, to: { x: 16, y: 3 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(outwardHeight(S, r.paths.upper, 10)).toBeCloseTo(1.5, 12);
    expect(outwardHeight(S, r.paths.upper, 16)).toBeCloseTo(3, 9);
    expect(outwardHeight(S, r.paths.upper, 5)).toBeCloseTo(1.5, 12);
    expect(outwardHeight(S, r.paths.upper, 12)).toBeGreaterThan(1.5);
  });

  it('after building it slides along the surface as it is now: the drawn curve, then the rope', () => {
    // on the drawn curve: the red dot lands on it
    const on = applyPointerEdit(S, drawn2.paths, 'upper', { red: { x: 12, y: 0 } });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(pointerOf(on.paths, 'upper').y).toBeCloseTo(outwardHeight(S, drawn2.paths.upper, 12), 9);
    // going back drops what was drawn beyond it (the earlier version is another version)
    expect(on.paths.upper.some((q) => Math.abs(q.x - 16) < 1e-9)).toBe(false);
    expect(on.paths.upper.every((q) => q.x <= 12 + 1e-9)).toBe(true);
    // on the rope beyond the last pointer: a waypoint on the rope, so the surface does not change
    const ahead = applyPointerEdit(S, drawn2.paths, 'upper', { red: { x: 21, y: 0 } });
    expect(ahead.ok).toBe(true);
    if (!ahead.ok) return;
    for (const x of [8, 14, 16, 18, 21, 24]) expect(outwardHeight(S, ahead.paths.upper, x)).toBeCloseTo(outwardHeight(S, drawn2.paths.upper, x), 6);
  });

  it('the direction of the curve at the red dot can be set where it is', () => {
    const r = applyPointerEdit(S, drawn.paths, 'upper', { red: { x: 8, y: 0, angle: 0.3 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(pointerOf(r.paths, 'upper')).toEqual({ x: 8, y: 2.3, angle: 0.3 });
      expect(r.paths.upper.length).toBe(drawn.paths.upper.length);
    }
  });

  it('can be combined with the green dot and the pointer in one change, and the result is valid', () => {
    const r = applyPointerEdit(S, drawn.paths, 'upper', { red: { x: 8.5, y: 0, angle: 0.1 }, anchor: { x: 24, y: 0 }, to: { x: 16, y: 2.8, angle: -0.05 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(anchorOf(S, r.paths, 'upper').x).toBe(24);
    const g = plateGeometry(S, r.paths, 1);
    expect(validateGeometry(g, { minThickness: 0.5, maxSlope: 1, maxCurvature: 2, maxThickness: 12 }).length).toBe(0);
  });

  it('older saved paths (no anchors, no angles) keep working', () => {
    const old = { upper: [{ x: 0, y: 1.5 }, { x: 8, y: 2.3 }], lower: [{ x: 0, y: 1.5 }] };
    const g = plateGeometry(S, old, 1);
    expect(g.upper.some((y) => y > 2.2)).toBe(true);
  });
});
