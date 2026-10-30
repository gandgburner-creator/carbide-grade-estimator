import { describe, expect, it } from 'vitest';
import { addCfdPointerMove, newCfdProject, type CfdConditions } from '../src/cfd/CfdProject';
import { camberFunction, CAMBER_LIMITS, describeCamber, validateCamber, withCamber, type CamberSpec } from '../src/geometry/Camber';
import { addCamberPoint, camberControlsOf, camberTextsOf, dragCamberPoint, readCamberInput } from '../src/geometry/CamberInput';
import { newProject } from '../src/geometry/History';
import { applyPointerEdit, camberShift, initialPaths, outwardHeight, plateGeometry, validatePlate, type PlateSpec } from '../src/geometry/Pointer';
import { addPointerVersion } from '../src/geometry/PointerVersion';
import { bodyPolygon, stationX } from '../src/geometry/SurfaceGeometry';
import { DEFAULT_SCENARIO } from '../src/experiments/PhysicalScenario';
import { polygonArea } from '../src/walls/SolidBody';

const L = 30;
const straight: PlateSpec = { length: L, thickness: 3 };
const arch: CamberSpec = { points: [{ x: 10, y: 1.5 }, { x: 20, y: 2 }] };
const cambered: PlateSpec = { ...straight, camber: arch };

describe('the camber spline', () => {
  it('is zero without control points, and zero at both tips with them', () => {
    expect(camberFunction(undefined, L)(12)).toBe(0);
    expect(camberFunction({ points: [] }, L)(12)).toBe(0);
    const f = camberFunction(arch, L);
    expect(f(0)).toBe(0);
    expect(f(L)).toBe(0);
  });

  it('passes through every control point, and is smooth between them (no corner: the slope is continuous)', () => {
    const f = camberFunction(arch, L);
    for (const p of arch.points) expect(f(p.x)).toBeCloseTo(p.y, 9);
    const d = (x: number) => (f(x + 1e-4) - f(x - 1e-4)) / 2e-4;
    for (const p of arch.points) expect(d(p.x - 1e-3)).toBeCloseTo(d(p.x + 1e-3), 2);
    // and the second derivative too (a natural cubic spline is C²)
    const d2 = (x: number) => (f(x + 1e-2) - 2 * f(x) + f(x - 1e-2)) / 1e-4;
    for (const p of arch.points) expect(d2(p.x - 1e-2)).toBeCloseTo(d2(p.x + 1e-2), 1);
  });

  it('a control point on the chord line with no neighbours changes nothing, and a single raised one arches the whole plate', () => {
    expect(camberFunction({ points: [{ x: 15, y: 0 }] }, L)(8)).toBeCloseTo(0, 12);
    const f = camberFunction({ points: [{ x: 15, y: 2 }] }, L);
    for (const x of [3, 8, 15, 22, 27]) expect(f(x)).toBeGreaterThan(0);
    expect(f(15)).toBeCloseTo(2, 12);
  });

  it('refuses control points too close to the tips or to each other, too high, too many, or a spline that is too steep', () => {
    expect(validateCamber(arch, L)).toBeNull();
    expect(validateCamber({ points: [{ x: 0.2, y: 1 }] }, L)).toMatch(/keep 3 % of the plate length/);
    expect(validateCamber({ points: [{ x: 10, y: 1 }, { x: 10.3, y: 1 }] }, L)).toMatch(/keep 3 %/);
    expect(validateCamber({ points: [{ x: 29.9, y: 1 }] }, L)).toMatch(/from the trailing tip/);
    expect(validateCamber({ points: [{ x: 15, y: 0.4 * L }] }, L)).toMatch(/35 %/);
    expect(validateCamber({ points: Array.from({ length: CAMBER_LIMITS.maxPoints + 1 }, (_, i) => ({ x: 1 + 3 * i, y: 0 })) }, L)).toMatch(/at most/);
    expect(validateCamber({ points: [{ x: 13, y: 0 }, { x: 15, y: 2.5 }] }, L)).toMatch(/steeper/);
    expect(validateCamber({ points: [{ x: Number.NaN, y: 1 }] }, L)).toMatch(/not a number/);
  });

  it('withCamber sets and removes it without touching the original, and says what it is in words', () => {
    const c = withCamber(straight, arch);
    expect(c.camber?.points.length).toBe(2);
    expect(straight.camber).toBeUndefined();
    expect(withCamber(c, null).camber).toBeUndefined();
    expect(describeCamber(arch, L)).toMatch(/camber set: a spline through 2 control points, 2\.\d\d d above the chord line/);
    expect(describeCamber(null, L)).toMatch(/straight/);
  });
});

describe('a cambered plate', () => {
  const g0 = plateGeometry(straight, undefined, 0.5);
  const g1 = plateGeometry(cambered, undefined, 0.5);
  const f = camberFunction(arch, L);
  const xs = stationX(g1);

  it('is the plate lifted by the spline: the same stations, the tips unmoved, the thickness unchanged straight up and down, the mid-line the spline', () => {
    expect(g1.stations).toBe(g0.stations);
    expect(xs[0]).toBe(0);
    expect(xs[g1.stations]).toBe(L);
    expect(g1.upper[0]).toBe(0);
    expect(g1.upper[g1.stations]).toBe(0);
    for (let i = 0; i <= g1.stations; i++) {
      expect(g1.upper[i] - g1.lower[i]).toBeCloseTo(g0.upper[i] - g0.lower[i], 12);
      expect(0.5 * (g1.upper[i] + g1.lower[i])).toBeCloseTo(f(xs[i]), 12);
    }
    expect(Math.max(...g1.upper)).toBeGreaterThan(Math.max(...g0.upper) + 1);
  });

  it('is still a graph over the chord, a simple closed counter-clockwise polygon, with about the same area', () => {
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true);
    const poly = bodyPolygon(g1);
    expect(polygonArea(poly)).toBeGreaterThan(0);
    expect(Math.abs(polygonArea(poly) - polygonArea(bodyPolygon(g0))) / polygonArea(bodyPolygon(g0))).toBeLessThan(0.01);
    // no two non-adjacent edges cross
    const n = poly.length / 2;
    const P = (i: number) => ({ x: poly[2 * (i % n)], y: poly[2 * (i % n) + 1] });
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < n; i++)
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const a = P(i), b = P(i + 1), c = P(j), d = P(j + 1);
        expect(cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0).toBe(false);
      }
  });

  it('carries what is drawn on it: heights stay heights above the wall, and the shift is the spline at that place', () => {
    expect(camberShift(straight, 8)).toBe(0);
    expect(camberShift(cambered, 8)).toBeCloseTo(f(8 + 1.5), 12);
    const built = applyPointerEdit(cambered, initialPaths(cambered), 'upper', { to: { x: 12, y: 3 } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const built0 = applyPointerEdit(straight, initialPaths(straight), 'upper', { to: { x: 12, y: 3 } });
    if (!built0.ok) throw new Error('setup');
    expect(outwardHeight(cambered, built.paths.upper, 12)).toBeCloseTo(outwardHeight(straight, built0.paths.upper, 12), 12);
    const gb = plateGeometry(cambered, built.paths, 1);
    const gb0 = plateGeometry(straight, built0.paths, 1);
    const xb = stationX(gb);
    for (let i = 0; i <= gb.stations; i++) expect(gb.upper[i] - gb0.upper[i]).toBeCloseTo(camberFunction(arch, L)(xb[i]), 12);
  });

  it('is refused by the plate rules when the spline is not allowed', () => {
    expect(validatePlate(cambered)).toBeNull();
    expect(validatePlate({ ...straight, camber: { points: [{ x: 0.1, y: 1 }] } })).toMatch(/keep 3 %/);
  });
});

describe('typing the camber', () => {
  const cm = 0.5;
  const paths = initialPaths(straight);

  it('the boxes start empty for a straight plate and show the control points of a cambered one', () => {
    expect(camberTextsOf(straight, cm).points).toEqual([]);
    expect(camberTextsOf(cambered, cm).points).toEqual([{ x: '5.00', y: '0.75' }, { x: '10.00', y: '1.00' }]);
  });

  it('reads the boxes into a spline, sorts the points, shows the mid-line and the controls, and knows when nothing changed', () => {
    const t = { points: [{ x: '10.00', y: '1.00' }, { x: '5.00', y: '0.75' }] };
    const r = readCamberInput(cambered, paths, 1, t, cm);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.camber!.points.map((p) => p.x)).toEqual([10, 20]);
    expect(r.unchanged).toBe(true);
    expect(r.line.length).toBeGreaterThan(30);
    expect(r.line[0]).toEqual({ x: 0, y: 0 });
    expect(r.controls.length).toBe(2);
    const moved = readCamberInput(cambered, paths, 1, { points: [{ x: '5.00', y: '1.50' }, { x: '10.00', y: '1.00' }] }, cm);
    expect(moved.ok && !moved.unchanged).toBe(true);
    const none = readCamberInput(cambered, paths, 1, { points: [] }, cm);
    expect(none.ok && none.camber === null && !none.unchanged).toBe(true);
  });

  it('says why a box is refused', () => {
    expect(readCamberInput(straight, paths, 1, { points: [{ x: '', y: '1' }] }, cm).ok).toBe(false);
    const near = readCamberInput(straight, paths, 1, { points: [{ x: '0.1', y: '1' }] }, cm);
    expect(near.ok).toBe(false);
    if (!near.ok) expect(near.reason).toMatch(/keep 3 %/);
  });

  it('a new control point goes in the middle of the widest stretch, on the chord line; at most the limit', () => {
    let t = addCamberPoint(straight, { points: [] }, cm);
    expect(t.points).toEqual([{ x: '7.50', y: '0.00' }]);
    t = addCamberPoint(straight, t, cm);
    // the stretches 0–15 and 15–30 d are equally wide: the first one gets the point, in its middle
    expect(Number(t.points[1].x)).toBeCloseTo(3.75, 6);
    for (let i = 0; i < 20; i++) t = addCamberPoint(straight, t, cm);
    expect(t.points.length).toBe(CAMBER_LIMITS.maxPoints);
  });

  it('a dragged control point is free but keeps its place in the order and its distance from the tips', () => {
    const t = camberTextsOf(cambered, cm);
    const d = dragCamberPoint(cambered, t, 0, 4, 3, cm);
    expect(d.points[0]).toEqual({ x: '2.00', y: '1.50' });
    // dragged past its neighbour or off the plate it stops short of them
    const past = dragCamberPoint(cambered, t, 0, 25, 0, cm);
    expect(Number(past.points[0].x)).toBeLessThan(Number(past.points[1].x));
    const off = dragCamberPoint(cambered, t, 1, 1e6, 1e6, cm);
    expect(Number(off.points[1].x)).toBeLessThan(L * cm);
    expect(Number(off.points[1].y)).toBeCloseTo(CAMBER_LIMITS.maxHeight * L * cm, 6);
    expect(camberControlsOf(t, cm)).toEqual(arch.points);
    expect(camberControlsOf({ points: [{ x: '', y: '1' }] }, cm)).toEqual([]);
  });
});

describe('versions made by changing the camber', () => {
  const cond: CfdConditions = { scenario: DEFAULT_SCENARIO, preset: 'quick', params: { alphaDeg: 30, cells: 32, reynolds: 240, widthL: 9, heightL: 6, spongeL: 2, spongeTau: 1.2, bodyAtX: 0.3, blocks: 4, sampleEvery: 8, seed: 7, uLattice: 0.06, warmup: 4, average: 6 }, realReynolds: 1e5 };
  const shape = { plate: straight, paths: initialPaths(straight), spacing: 1 };

  it('the CFD project makes a new version with the camber, keeps the parent as it was, and can make it straight again', () => {
    const p0 = newCfdProject('t', cond, shape);
    const out = addCfdPointerMove(p0, { side: 'upper', camber: arch, decision: { kind: 'hand' } });
    const v = out.version;
    expect(v.shape.plate.camber?.points.length).toBe(2);
    expect(v.label).toMatch(/camber set: a spline through 2 control points/);
    expect(v.move!.edit?.camber).toEqual(arch);
    expect(p0.versions[0].shape.plate.camber).toBeUndefined();
    expect(v.geometry).toEqual(plateGeometry(v.shape.plate, v.shape.paths, 1));
    expect(Math.max(...v.geometry.upper)).toBeGreaterThan(Math.max(...p0.versions[0].geometry.upper) + 1);
    const back = addCfdPointerMove(out.project, { side: 'upper', camber: null, decision: { kind: 'hand' } });
    expect(back.version.shape.plate.camber).toBeUndefined();
    expect(back.version.label).toMatch(/straight/);
    // a camber the plate does not allow is refused with the reason
    expect(() => addCfdPointerMove(p0, { side: 'upper', camber: { points: [{ x: 0.1, y: 1 }] }, decision: { kind: 'hand' } })).toThrow(/keep 3 %/);
  });

  it('the particle project does the same, together with a pointer move', () => {
    const pr = newProject('t', {}, plateGeometry(straight, initialPaths(straight), 1), undefined, shape);
    const out = addPointerVersion(pr, { side: 'upper', camber: arch, to: { x: 12, y: 3 }, decision: { kind: 'hand' } });
    expect(out.version.shape!.plate.camber?.points.length).toBe(2);
    expect(out.version.shape!.paths.upper.length).toBe(2);
    expect(out.version.label).toMatch(/camber set/);
    expect(() => addPointerVersion(pr, { side: 'upper', decision: { kind: 'hand' } })).toThrow(/nothing to change/);
  });
});
