import { describe, expect, it } from 'vitest';
import { arrowsOf, insidePolygon, smoothField, traceStreamlines, velocityAt, type GridField } from '../src/measurements/Streamlines';

const grid = (nx: number, ny: number, cell: number, u: (x: number, y: number) => [number, number], valid: (x: number, y: number) => boolean = () => true): GridField => {
  const ux: number[] = [];
  const uy: number[] = [];
  const ok: boolean[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * cell;
      const y = (j + 0.5) * cell;
      const v = u(x, y);
      ux.push(v[0]);
      uy.push(v[1]);
      ok.push(valid(x, y));
    }
  return { nx, ny, x0: 0, y0: 0, cw: cell, ch: cell, ux, uy, valid: ok };
};

describe('mean-flow streamlines', () => {
  it('a uniform stream gives straight, evenly spaced lines along the flow', () => {
    const f = grid(40, 20, 1, () => [2, 0]);
    const lines = traceStreamlines(f, { spacing: 2, testFraction: 0.5, step: 0.3, maxLength: 80, minSpeed: 1e-6 });
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const l of lines) {
      const y0 = l.points[1];
      for (let k = 1; k < l.points.length; k += 2) expect(l.points[k]).toBeCloseTo(y0, 9);
      expect(l.points[l.points.length - 2]).toBeGreaterThan(l.points[0]);
    }
    // no two lines closer than half the spacing
    const ys = lines.map((l) => l.points[1]).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(0.9 - 1e-9);
  });

  it('a line follows the flow direction and is tangent to the velocity', () => {
    const f = grid(40, 40, 1, (x) => [1, 0.3 * Math.sin((2 * Math.PI * x) / 40)]);
    const [l] = traceStreamlines(f, { spacing: 5, testFraction: 0.5, step: 0.25, maxLength: 60, minSpeed: 1e-6 });
    for (let k = 4; k + 3 < l.points.length - 4; k += 6) {
      const tx = l.points[k + 2] - l.points[k];
      const ty = l.points[k + 3] - l.points[k + 1];
      const v = velocityAt(f, (l.points[k] + l.points[k + 2]) / 2, (l.points[k + 1] + l.points[k + 3]) / 2)!;
      expect(Math.abs(tx * v.v - ty * v.u) / (Math.hypot(tx, ty) * Math.hypot(v.u, v.v))).toBeLessThan(0.02);
      expect(tx * v.u + ty * v.v).toBeGreaterThan(0);
    }
  });

  it('solid-body rotation gives closed circles (the loop ends where it meets itself)', () => {
    const f = grid(60, 60, 1, (x, y) => [-(y - 30) * 0.05, (x - 30) * 0.05]);
    const lines = traceStreamlines(f, { spacing: 4, testFraction: 0.5, step: 0.25, maxLength: 400, minSpeed: 1e-6 });
    const loops = lines.filter((l) => l.closed);
    expect(loops.length).toBeGreaterThan(2);
    for (const l of loops) {
      const rr: number[] = [];
      for (let k = 0; k < l.points.length; k += 2) rr.push(Math.hypot(l.points[k] - 30, l.points[k + 1] - 30));
      expect(Math.max(...rr) - Math.min(...rr)).toBeLessThan(0.15);
    }
  });

  it('never enters cells without data or an excluded region, and ends at stagnation', () => {
    const body = [10, 5, 20, 5, 20, 10, 10, 10];
    const f = grid(40, 20, 1, () => [1, 0], (x, y) => !insidePolygon(body, x, y));
    const lines = traceStreamlines(f, { spacing: 1.5, testFraction: 0.5, step: 0.25, maxLength: 80, minSpeed: 1e-6, inside: (x, y) => insidePolygon(body, x, y) });
    for (const l of lines) for (let k = 0; k < l.points.length; k += 2) expect(insidePolygon(body, l.points[k], l.points[k + 1])).toBe(false);
    const stagnant = grid(20, 20, 1, () => [0, 0]);
    expect(traceStreamlines(stagnant, { spacing: 2, testFraction: 0.5, step: 0.3, maxLength: 40, minSpeed: 1e-3 })).toEqual([]);
  });

  it('smoothing averages only over cells with data and keeps a uniform field uniform', () => {
    const f = grid(10, 10, 1, () => [3, -1], (x) => x > 2);
    const s = smoothField(f, 2);
    s.valid.forEach((ok, c) => {
      if (ok) {
        expect(s.ux[c]).toBeCloseTo(3, 9);
        expect(s.uy[c]).toBeCloseTo(-1, 9);
      } else expect(s.ux[c]).toBe(0);
    });
  });

  it('places arrows along the line at the requested spacing', () => {
    const arrows = arrowsOf({ points: [0, 0, 10, 0, 20, 0, 30, 0], closed: false }, 12);
    expect(arrows.length).toBe(2);
    expect(arrows[0][2]).toBeCloseTo(0, 12);
  });
});
