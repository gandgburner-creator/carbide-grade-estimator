import { describe, expect, it } from 'vitest';
import { CfdFillRun, DEFAULT_CFD_FILL, type CfdFillConfig } from '../src/cfd/CfdFill';
import { CFD_BASE, CfdRun, type CfdParams } from '../src/cfd/CfdRun';
import { LbmSolver } from '../src/cfd/Lbm';
import { circlePolygon, rasterize } from '../src/cfd/Raster';
import { anchorOf, initialPaths, outwardHeight, pathOf, plateGeometry, pointerOf, type PlateSpec } from '../src/geometry/Pointer';

const plate: PlateSpec = { length: 30, thickness: 3 };
const paths0 = initialPaths(plate);
const params = (over: Partial<CfdParams> = {}): CfdParams => ({ geometry: plateGeometry(plate, paths0, 1), alphaDeg: 25, cells: 32, reynolds: 240, ...CFD_BASE, warmup: 4, average: 6, blocks: 4, ...over });
const fast: CfdFillConfig = { ...DEFAULT_CFD_FILL, develop: 4, settle: 0.5, window: 0.75, step: { ...DEFAULT_CFD_FILL.step, step: 6 } };

describe('the solver accepts a body that grows while it runs', () => {
  const nx = 120;
  const ny = 80;
  const make = (r: number) => rasterize(nx, ny, circlePolygon(40, 40, r, 64));
  const a = make(6);
  const s = new LbmSolver({ nx, ny, tau: 0.6, uIn: 0.05, solid: a.solid.slice(), wallQ: a.wallQ.slice() });
  for (let i = 0; i < 400; i++) s.step();

  it('replaces the solid in place and reports what changed', () => {
    const b = make(8);
    const before = s.solid.reduce((x, v) => x + v, 0);
    const changed = s.reshape(b.solid, b.wallQ);
    expect(changed).toBeGreaterThan(0);
    expect(s.solid.reduce((x, v) => x + v, 0)).toBeGreaterThan(before);
    expect(Array.from(s.solid)).toEqual(Array.from(b.solid));
  });

  it('stays finite and settles to a force of the same sign after the change', () => {
    let ok = true;
    for (let i = 0; i < 1500; i++) ok = s.step() && ok;
    expect(ok).toBe(true);
    const m = s.monitor();
    expect(m.finite).toBe(true);
    expect(m.maxSpeed * Math.sqrt(3)).toBeLessThan(0.45);
    expect(s.fx).toBeGreaterThan(0);
  });

  it('refuses a body that does not fit the lattice', () => {
    expect(() => s.reshape(new Uint8Array(10), new Float32Array(90))).toThrow(/does not fit/);
  });
});

describe('the auto fill of the CFD workspace (small, not judged)', () => {
  const run = new CfdFillRun(params(), plate, paths0, 1, fast);
  let guard = 0;
  while (!run.done && guard++ < 400) run.advance(2000);
  const res = run.result();

  it('moves the pointer from the leading circle toward the anchor in several measured moves, and stops there', () => {
    expect(run.done).toBe(true);
    expect(res.finite).toBe(true);
    expect(res.moves.length).toBeGreaterThanOrEqual(3);
    expect(['anchor', 'nothing-measured']).toContain(res.stop.kind);
    const xs = res.moves.map((m) => m.to.x);
    xs.forEach((x, i) => i > 0 && expect(x).toBeGreaterThan(xs[i - 1]));
    expect(xs[xs.length - 1]).toBeCloseTo(anchorOf(plate).x, 6);
    expect(pointerOf(res.paths, 'upper').x).toBeCloseTo(anchorOf(plate).x, 6);
  });

  it('only adds material, only on the chosen side, and the lower side and the ends are untouched', () => {
    expect(res.paths.lower).toEqual(paths0.lower);
    const x0 = plateGeometry(plate, paths0, 1);
    res.geometry.lower.forEach((y, i) => expect(y).toBeCloseTo(x0.lower[i], 9));
    res.geometry.upper.forEach((y, i) => expect(y).toBeGreaterThanOrEqual(x0.upper[i] - 1e-9));
    for (const m of res.moves) {
      expect(m.rise).toBeGreaterThanOrEqual(0);
      expect(m.rise).toBeLessThanOrEqual(fast.step.maxRise + 1e-9);
      expect(m.gap).toBeGreaterThanOrEqual(0);
    }
    const r = plate.thickness / 2;
    for (const q of pathOf(res.paths, 'upper')) expect(q.y).toBeGreaterThanOrEqual(r - 1e-9);
    expect(outwardHeight(plate, pathOf(res.paths, 'upper'), 0)).toBeGreaterThanOrEqual(r - 1e-9);
  });

  it('is a run of the real solver: the body it ends with is what the solver holds, and the state is stable', () => {
    const final = new CfdRun(params({ geometry: res.geometry }));
    const same = Array.from(run.solver.solid).every((v, n) => v === final.solver.solid[n]);
    expect(same).toBe(true);
    expect(res.maxMach).toBeLessThan(0.45);
  });

  it('records what it did: the config, the story of every move, and the reason it stopped', () => {
    expect(res.schema).toBe('pfad-cfd-fill/1');
    expect(res.config.side).toBe('upper');
    expect(res.stop.reason.length).toBeGreaterThan(10);
    expect(res.moves.every((m) => m.note.length > 5)).toBe(true);
    expect(res.totalRise).toBeCloseTo(res.moves.reduce((a, m) => a + m.rise, 0), 12);
  });

  it('can be stopped by the person, which keeps the shape drawn so far', () => {
    const r2 = new CfdFillRun(params(), plate, paths0, 1, fast);
    let g = 0;
    while (r2.moves.length < 2 && !r2.done && g++ < 400) r2.advance(1000);
    expect(r2.done).toBe(false);
    r2.finishEarly();
    const out = r2.result();
    expect(out.stop.kind).toBe('user');
    expect(out.stop.reason).toMatch(/kept/);
    expect(out.moves.length).toBeGreaterThanOrEqual(2);
    expect(pointerOf(out.paths, 'upper').x).toBeLessThan(anchorOf(plate).x);
  });
});
