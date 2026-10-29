import { describe, expect, it } from 'vitest';
import { addPointerPoint, anchorOf, DEFAULT_POINTER_LIMITS, DEFAULT_POINTER_STEP, drawnSegments, initialPaths, outwardHeight, plateGeometry, planPointerStep, pointerOf, undoPointerPoint, validatePlate, type PlateSpec } from '../src/geometry/Pointer';
import { area, bodyPolygon, edgeOfSegment, junctionVertex, stationX, validateGeometry } from '../src/geometry/SurfaceGeometry';

const S: PlateSpec = { length: 30, thickness: 3 };

/** signed area of a polygon (positive = counter-clockwise) */
const signedArea = (v: number[]) => {
  let a = 0;
  for (let i = 0; i < v.length; i += 2) {
    const j = (i + 2) % v.length;
    a += v[i] * v[j + 1] - v[j] * v[i + 1];
  }
  return a / 2;
};

/** true when no two non-adjacent edges of the polygon cross */
const isSimple = (v: number[]) => {
  const n = v.length / 2;
  const P = (i: number) => ({ x: v[2 * (i % n)], y: v[2 * (i % n) + 1] });
  const cross = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = P(i), b = P(i + 1), c = P(j), d = P(j + 1);
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
    }
  return true;
};

describe('the rounded plate', () => {
  it('thickness is the end-circle diameter and length is the centre distance plus one diameter', () => {
    const g = plateGeometry(S);
    const xs = stationX(g);
    expect(xs[0]).toBe(0);
    expect(xs[g.stations]).toBe(30);
    expect(Math.max(...g.upper)).toBeCloseTo(1.5, 12);
    expect(Math.min(...g.lower)).toBeCloseTo(-1.5, 12);
    // the centre of the leading circle is r from the tip, the centre of the trailing circle is length − r: centres 27 apart
    expect(30 - 3 - 0).toBe(27);
    // flat top over the straight stretch between the circles
    const [lo, hi] = g.free!;
    for (let i = lo; i <= hi; i++) expect(g.upper[i]).toBeCloseTo(1.5, 12);
    expect(xs[lo]).toBeCloseTo(1.5, 12);
    expect(xs[hi]).toBeCloseTo(28.5, 12);
  });

  it('both ends are semicircles (every nose and trailing-edge station lies on the circle)', () => {
    const g = plateGeometry(S);
    const xs = stationX(g);
    const n = g.stations;
    for (let i = 0; i <= g.free![0]; i++) expect(Math.hypot(xs[i] - 1.5, g.upper[i])).toBeCloseTo(1.5, 10);
    for (let i = g.free![1]; i <= n; i++) expect(Math.hypot(xs[i] - 28.5, g.upper[i])).toBeCloseTo(1.5, 10);
    expect(g.upper[0]).toBe(0);
    expect(g.lower[n]).toBe(0);
    // the round ends are made of several edges, not two
    expect(g.free![0]).toBeGreaterThanOrEqual(3);
    expect(n - g.free![1]).toBeGreaterThanOrEqual(3);
  });

  it('is a simple counter-clockwise polygon without end faces, with consistent edge and junction numbering', () => {
    const g = plateGeometry(S);
    const v = bodyPolygon(g);
    expect(v.length / 2).toBe(2 * g.stations);
    expect(signedArea(v)).toBeGreaterThan(0);
    expect(isSimple(v)).toBe(true);
    const nv = v.length / 2;
    for (const side of ['upper', 'lower'] as const) {
      for (let k = 0; k < g.stations; k++) {
        const e = edgeOfSegment(g, side, k);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThan(nv);
        const [x0, y0, x1, y1] = [v[2 * e], v[2 * e + 1], v[2 * ((e + 1) % nv)], v[2 * ((e + 1) % nv) + 1]];
        const xs = stationX(g);
        const y = side === 'upper' ? g.upper : g.lower;
        // the polygon edge e joins this segment's two stations (in either direction)
        const fwd = Math.abs(x0 - xs[k]) + Math.abs(y0 - y[k]) + Math.abs(x1 - xs[k + 1]) + Math.abs(y1 - y[k + 1]);
        const bwd = Math.abs(x1 - xs[k]) + Math.abs(y1 - y[k]) + Math.abs(x0 - xs[k + 1]) + Math.abs(y0 - y[k + 1]);
        expect(Math.min(fwd, bwd)).toBeLessThan(1e-12);
      }
      for (let k = 0; k + 1 < g.stations; k++) {
        const j = junctionVertex(g, side, k);
        const xs = stationX(g);
        const y = side === 'upper' ? g.upper : g.lower;
        expect(v[2 * j]).toBeCloseTo(xs[k + 1], 12);
        expect(v[2 * j + 1]).toBeCloseTo(y[k + 1], 12);
      }
    }
  });

  it('its area is a rectangle plus one disc', () => {
    const g = plateGeometry(S, initialPaths(S), 0.25);
    expect(area(g)).toBeCloseTo(27 * 3 + Math.PI * 1.5 * 1.5, 1);
  });

  it('passes its own limits where the increment rules work, and rejects an impossible plate', () => {
    expect(validateGeometry(plateGeometry(S))).toEqual([]);
    expect(validatePlate({ length: 5, thickness: 3 })).toMatch(/twice as long/);
    expect(() => plateGeometry({ length: 5, thickness: 3 })).toThrow();
  });
});

describe('the pointer and its tether', () => {
  it('starts on top of the leading circle, with nothing added: the surface is exactly the plate', () => {
    const paths = initialPaths(S);
    expect(pointerOf(paths, 'upper')).toEqual({ x: 0, y: 1.5 });
    const g = plateGeometry(S, paths);
    const plain = plateGeometry(S);
    expect(g.upper).toEqual(plain.upper);
    expect(g.lower).toEqual(plain.lower);
    for (const x of [-1.4, 0, 3, 14, 27, 27.5, 28.4]) expect(outwardHeight(S, paths.upper, x)).toBeCloseTo(x <= 0 ? Math.sqrt(1.5 ** 2 - x * x) : x >= 27 ? Math.sqrt(1.5 ** 2 - (x - 27) ** 2) : 1.5, 12);
  });

  it('the anchor is the top of the trailing-edge circle', () => {
    expect(anchorOf(S)).toEqual({ x: 27, y: 1.5 });
  });

  it('beyond the pointer the surface is the straight tether to the anchor', () => {
    const r = addPointerPoint(S, initialPaths(S), 'upper', { x: 4, y: 3.5 });
    if (!r.ok) throw new Error(r.reason);
    for (const x of [5, 10, 20, 26]) {
      const expected = 3.5 + ((x - 4) / (27 - 4)) * (1.5 - 3.5);
      expect(outwardHeight(S, r.paths.upper, x)).toBeCloseTo(expected, 12);
    }
  });

  it('the drawn curve passes through the pointer position and is smooth there (no corner)', () => {
    const r = addPointerPoint(S, initialPaths(S), 'upper', { x: 4, y: 3.5 });
    if (!r.ok) throw new Error(r.reason);
    expect(outwardHeight(S, r.paths.upper, 4)).toBeCloseTo(3.5, 6);
    const e = 1e-4;
    const left = (outwardHeight(S, r.paths.upper, 4) - outwardHeight(S, r.paths.upper, 4 - e)) / e;
    const right = (outwardHeight(S, r.paths.upper, 4 + e) - outwardHeight(S, r.paths.upper, 4)) / e;
    expect(left).toBeCloseTo(right, 3);
    // and the slope there is the tether's
    expect(right).toBeCloseTo((1.5 - 3.5) / 23, 3);
  });

  it('leaves the leading circle smoothly: horizontal at the top of the circle', () => {
    const r = addPointerPoint(S, initialPaths(S), 'upper', { x: 4, y: 3.5 });
    if (!r.ok) throw new Error(r.reason);
    const e = 1e-4;
    expect((outwardHeight(S, r.paths.upper, e) - outwardHeight(S, r.paths.upper, 0)) / e).toBeCloseTo(0, 2);
  });

  it('every earlier pointer position stays on the curve when the pointer moves on', () => {
    let paths = initialPaths(S);
    const pts = [
      { x: 3, y: 2.4 },
      { x: 7, y: 3.2 },
      { x: 12, y: 3.4 },
    ];
    for (const p of pts) {
      const r = addPointerPoint(S, paths, 'upper', p);
      if (!r.ok) throw new Error(r.reason);
      paths = r.paths;
    }
    for (const p of pts) expect(outwardHeight(S, paths.upper, p.x)).toBeCloseTo(p.y, 6);
  });

  it('only adds material: the surface never goes below the plate, and a lower pointer is refused', () => {
    let paths = initialPaths(S);
    for (const p of [{ x: 2, y: 1.6 }, { x: 6, y: 1.5 }, { x: 10, y: 2.5 }, { x: 20, y: 1.5 }]) {
      const r = addPointerPoint(S, paths, 'upper', p);
      if (!r.ok) throw new Error(r.reason);
      paths = r.paths;
    }
    for (let x = -1.5; x <= 28.5; x += 0.05) expect(outwardHeight(S, paths.upper, x)).toBeGreaterThanOrEqual(1.5 - 1e-9 - (x < 0 || x > 27 ? 1.5 : 0));
    const bad = addPointerPoint(S, initialPaths(S), 'upper', { x: 3, y: 1.0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/only added/);
  });

  it('the pointer only moves forward and cannot pass the anchor or rise too far or too steeply', () => {
    const paths = initialPaths(S);
    const r1 = addPointerPoint(S, paths, 'upper', { x: 0, y: 2 });
    expect(r1.ok).toBe(false);
    expect(addPointerPoint(S, paths, 'upper', { x: 28, y: 1.5 }).ok).toBe(false);
    expect(addPointerPoint(S, paths, 'upper', { x: 10, y: 1.5 + DEFAULT_POINTER_LIMITS.maxRise + 1 }).ok).toBe(false);
    expect(addPointerPoint(S, paths, 'upper', { x: 1, y: 3.5 }).ok).toBe(false);
    expect(addPointerPoint(S, paths, 'upper', { x: 27, y: 1.5 }).ok).toBe(true);
  });

  it('the body stays a simple counter-clockwise polygon along a long pointer path, and the curve is a graph over x', () => {
    let paths = initialPaths(S);
    const pts = [
      { x: 2, y: 2.3 },
      { x: 5, y: 3.6 },
      { x: 9, y: 4.4 },
      { x: 14, y: 4.0 },
      { x: 20, y: 2.9 },
      { x: 27, y: 1.5 },
    ];
    for (const p of pts) {
      const r = addPointerPoint(S, paths, 'upper', p);
      if (!r.ok) throw new Error(`${JSON.stringify(p)}: ${r.reason}`);
      paths = r.paths;
    }
    for (const seg of drawnSegments(S, paths.upper)) {
      expect(seg.c1.x).toBeGreaterThanOrEqual(seg.p0.x - 1e-12);
      expect(seg.c2.x).toBeLessThanOrEqual(seg.p3.x + 1e-12);
      expect(seg.c1.x).toBeLessThanOrEqual(seg.c2.x + 1e-12);
    }
    const g = plateGeometry(S, paths);
    const v = bodyPolygon(g);
    expect(signedArea(v)).toBeGreaterThan(0);
    expect(isSimple(v)).toBe(true);
    // the upper surface is above the plate and meets the anchor
    expect(area(g)).toBeGreaterThan(area(plateGeometry(S)));
    const xs = stationX(g);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });

  it('the lower side is built the same way, independently', () => {
    const r = addPointerPoint(S, initialPaths(S), 'lower', { x: 4, y: 3 });
    if (!r.ok) throw new Error(r.reason);
    const g = plateGeometry(S, r.paths);
    const base = plateGeometry(S);
    expect(g.upper).toEqual(base.upper);
    expect(Math.min(...g.lower)).toBeLessThan(-2.9);
  });

  it('undo takes the pointer back one position', () => {
    let paths = initialPaths(S);
    const r = addPointerPoint(S, paths, 'upper', { x: 4, y: 3 });
    if (!r.ok) throw new Error(r.reason);
    paths = r.paths;
    paths = undoPointerPoint(paths, 'upper');
    expect(pointerOf(paths, 'upper')).toEqual({ x: 0, y: 1.5 });
    expect(undoPointerPoint(paths, 'upper').upper.length).toBe(1);
  });
});

describe('the automatic pointer step', () => {
  it('rises above the current surface by a fraction of the measured gap, at most maxRise', () => {
    const paths = initialPaths(S);
    const st = planPointerStep(S, paths, 'upper', () => 4)!;
    expect(st.to.x).toBeCloseTo(3, 12);
    expect(st.surface).toBeCloseTo(1.5, 12);
    expect(st.rise).toBeCloseTo(DEFAULT_POINTER_STEP.maxRise, 12);
    expect(st.to.y).toBeCloseTo(2.5, 12);
    const small = planPointerStep(S, paths, 'upper', () => 1.3)!;
    expect(small.rise).toBeCloseTo(0.5 * (1.3 - 0.3), 12);
  });

  it('follows the existing surface where nothing is measured', () => {
    const r = addPointerPoint(S, initialPaths(S), 'upper', { x: 4, y: 3.5 });
    if (!r.ok) throw new Error(r.reason);
    const st = planPointerStep(S, r.paths, 'upper', () => 0)!;
    expect(st.rise).toBe(0);
    expect(st.to.y).toBeCloseTo(outwardHeight(S, r.paths.upper, st.to.x), 12);
  });

  it('sweeps from the leading edge to the anchor and then says it is finished', () => {
    let paths = initialPaths(S);
    let guard = 0;
    let finished = false;
    while (guard++ < 40) {
      const st = planPointerStep(S, paths, 'upper', (x) => (x < 12 ? 3 : 0));
      if (!st) {
        finished = true;
        break;
      }
      const r = addPointerPoint(S, paths, 'upper', st.to);
      if (!r.ok) throw new Error(r.reason);
      paths = r.paths;
    }
    expect(finished).toBe(true);
    expect(pointerOf(paths, 'upper')).toEqual(anchorOf(S));
    expect(guard).toBeLessThan(15);
  });
});
