import { describe, expect, it } from 'vitest';
import type { CfdResult } from '../src/cfd/CfdRun';
import { bodyPolygon } from '../src/geometry/SurfaceGeometry';
import { AIRFOIL_PRESETS, airfoilBody, describeMetrics, fiveDigit, fourDigit, parseAirfoilDat, sectionFromCode } from '../src/reference/Airfoils';
import { highestLd, jobsFor, parseAngles, ratio, resolutionAdvice, rowOf, studyCsv } from '../src/reference/Study';

const area = (v: number[]) => {
  let a = 0;
  for (let i = 0; i < v.length; i += 2) {
    const j = (i + 2) % v.length;
    a += v[i] * v[j + 1] - v[j] * v[i + 1];
  }
  return Math.abs(a) / 2;
};

describe('airfoils from their published formulas', () => {
  it('the symmetric section 0012: 12 % thick at 30 % of the chord, half thickness 0.0600 there, area 0.0822 c²', () => {
    const b = airfoilBody(fourDigit(0, 0, 0.12), 1, 200);
    expect(b.metrics.thickness).toBeCloseTo(0.12, 3);
    expect(b.metrics.thicknessAt).toBeGreaterThan(0.28);
    expect(b.metrics.thicknessAt).toBeLessThan(0.32);
    expect(Math.abs(b.metrics.camber)).toBeLessThan(1e-9);
    const k = b.geometry.xs!.findIndex((x) => x >= 0.3);
    expect(b.geometry.upper[k]).toBeCloseTo(0.06, 2);
    for (let i = 0; i <= b.geometry.stations; i++) expect(b.geometry.upper[i]).toBeCloseTo(-b.geometry.lower[i], 9);
    // the cross-section of a NACA 0012 is 0.0822 of the chord squared
    expect(area(bodyPolygon(b.geometry)) / (b.geometry.chord ** 2)).toBeGreaterThan(0.0822 * 0.97);
    expect(area(bodyPolygon(b.geometry)) / (b.geometry.chord ** 2)).toBeLessThan(0.0822 * 1.03);
    // nose radius 1.1019 t² = 1.59 % of the chord
    expect(b.metrics.noseRadius).toBeGreaterThan(0.0159 * 0.8);
    expect(b.metrics.noseRadius).toBeLessThan(0.0159 * 1.25);
  });

  it('the digits mean what they say: 4412 has 4 % camber at 40 % and is 12 % thick; 6409 is 6 % at 40 % and 9 % thick', () => {
    for (const [code, m, t] of [['4412', 0.04, 0.12], ['6409', 0.06, 0.09], ['2412', 0.02, 0.12], ['9412', 0.09, 0.12]] as const) {
      const b = airfoilBody(sectionFromCode(code).contour, 1, 200);
      expect(b.metrics.camber, code).toBeCloseTo(m, 2);
      expect(b.metrics.camberAt, code).toBeGreaterThan(0.37);
      expect(b.metrics.camberAt, code).toBeLessThan(0.43);
      expect(b.metrics.thickness, code).toBeCloseTo(t, 2);
    }
  });

  it('the five-digit constants are right: the maximum camber of 210 … 250 lies at 5, 10, 15, 20, 25 % of the chord and the design lift is that of a 2 % camber', () => {
    for (const [pair, at] of [['10', 0.05], ['20', 0.1], ['30', 0.15], ['40', 0.2], ['50', 0.25]] as const) {
      // a thin section (1 %), so that the mid-line between its surfaces is its mean line
      const b = airfoilBody(fiveDigit(`2${pair}01`), 1, 400);
      expect(Math.abs(b.metrics.camberAt - at), pair).toBeLessThan(0.012);
      expect(b.metrics.thickness).toBeCloseTo(0.01, 2);
      expect(b.metrics.camber).toBeGreaterThan(0.01);
      expect(b.metrics.camber).toBeLessThan(0.03);
    }
    const b = airfoilBody(sectionFromCode('23012').contour, 1, 300);
    // 1.8 % relative to the x axis of the formula; relative to the line from the section's own leading point to its trailing point a little less
    expect(b.metrics.camber).toBeGreaterThan(0.013);
    expect(b.metrics.camber).toBeLessThan(0.0195);
    expect(Math.abs(b.metrics.camberAt - 0.15)).toBeLessThan(0.03);
  });

  it('every preset is a valid body: surfaces do not cross, both ends are points, the numbers on its card come from its coordinates', () => {
    expect(AIRFOIL_PRESETS.length).toBeGreaterThanOrEqual(12);
    const names = new Set<string>();
    for (const p of AIRFOIL_PRESETS) {
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
      const b = airfoilBody(p.contour, 30, 160);
      const g = b.geometry;
      expect(g.pointedEnds).toBe(true);
      expect(g.xs![0]).toBe(0);
      expect(g.xs![g.stations]).toBeCloseTo(30, 9);
      expect(g.upper[0]).toBe(0);
      expect(g.lower[0]).toBe(0);
      expect(g.upper[g.stations]).toBe(0);
      expect(g.lower[g.stations]).toBe(0);
      for (let i = 0; i <= g.stations; i++) expect(g.upper[i] - g.lower[i], `${p.name} ${i}`).toBeGreaterThanOrEqual(-1e-9);
      for (let i = 1; i <= g.stations; i++) expect(g.xs![i]).toBeGreaterThan(g.xs![i - 1]);
      expect(describeMetrics(b.metrics)).toMatch(/thick at/);
      expect(p.source.kind).toBe('formula');
      expect(p.known.length).toBeGreaterThan(30);
      expect(p.aims.length).toBeGreaterThan(0);
    }
  });

  it('refuses codes it cannot make, in words', () => {
    expect(() => sectionFromCode('44')).toThrow(/four digits/);
    expect(() => sectionFromCode('4400')).toThrow(/thickness/);
    expect(() => sectionFromCode('4012')).toThrow(/position of maximum camber/);
    expect(() => sectionFromCode('23112')).toThrow(/reflexed/);
    expect(() => sectionFromCode('13012')).toThrow(/starts with 2/);
    expect(sectionFromCode('NACA 4412').name).toBe('NACA 4412');
    expect(sectionFromCode(' 0012 ').aims).toContain('symmetric');
  });
});

describe('a coordinate file', () => {
  const selig = (c: number[], name = 'TEST 0012') => [name, ...Array.from({ length: c.length / 2 }, (_, i) => `  ${c[2 * i].toFixed(6)}  ${c[2 * i + 1].toFixed(6)}`)].join('\n');
  const c0012 = fourDigit(0, 0, 0.12, 40);

  it('reads Selig format and gives the same body as the formula', () => {
    const d = parseAirfoilDat(selig(c0012));
    expect(d.format).toBe('Selig');
    expect(d.name).toBe('TEST 0012');
    const a = airfoilBody(d.contour, 30, 120);
    const b = airfoilBody(c0012, 30, 120);
    expect(a.metrics.thickness).toBeCloseTo(b.metrics.thickness, 4);
    expect(a.geometry.upper[40]).toBeCloseTo(b.geometry.upper[40], 3);
  });

  it('reads Lednicer format (counts line, upper from the leading edge, lower from the leading edge)', () => {
    const n = c0012.length / 2;
    const half = (n + 1) / 2; // the contour has the leading point once: upper n/2+1 points, lower the same
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([c0012[2 * i], c0012[2 * i + 1]]);
    const le = Math.floor(n / 2);
    const upper = pts.slice(0, le + 1).reverse();
    const lower = pts.slice(le);
    const text = ['TEST LEDNICER', `   ${upper.length}.  ${lower.length}.`, ...upper.map((p) => `${p[0]} ${p[1]}`), ...lower.map((p) => `${p[0]} ${p[1]}`)].join('\n');
    void half;
    const d = parseAirfoilDat(text);
    expect(d.format).toBe('Lednicer');
    expect(airfoilBody(d.contour, 30, 100).metrics.thickness).toBeCloseTo(0.12, 2);
  });

  it('recognises percent coordinates', () => {
    const pct = selig(c0012.map((v) => v * 100));
    const d = parseAirfoilDat(pct);
    expect(d.notes.join(' ')).toMatch(/percent/);
    expect(airfoilBody(d.contour, 30, 100).metrics.thickness).toBeCloseTo(0.12, 2);
  });

  it('says what is wrong with a file', () => {
    expect(() => parseAirfoilDat('')).toThrow(/empty/);
    expect(() => parseAirfoilDat('name\n1 2\n3 4')).toThrow(/at least 20/);
    // an outline whose leading edge is not inside it
    expect(() => airfoilBody(Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.1 : 1 - i / 40)), 30)).toThrow(/leading edge|folds|length/);
    // an open trailing edge is closed and says so
    const open = c0012.slice();
    open[1] += 0.006;
    open[open.length - 1] -= 0.006;
    expect(airfoilBody(open, 30).notes.join(' ')).toMatch(/closed to a point/);
  });
});

describe('the airfoil study', () => {
  it('the ratio of two estimates carries the errors of both', () => {
    const r = ratio({ mean: 1.2, se: 0.06, n: 8 }, { mean: 0.1, se: 0.005, n: 8 })!;
    expect(r.mean).toBeCloseTo(12, 9);
    expect(r.se).toBeCloseTo(12 * Math.hypot(0.05, 0.05), 9);
    expect(ratio({ mean: 1, se: 0, n: 1 }, { mean: 0, se: 0, n: 1 })).toBeNull();
    expect(ratio({ mean: 1, se: 0, n: 1 }, { mean: -0.2, se: 0, n: 1 })).toBeNull();
  });

  it('angles are read from a list and checked', () => {
    expect(parseAngles('8, 0 4;12  4')).toEqual({ ok: true, angles: [0, 4, 8, 12] });
    expect(parseAngles('')).toMatchObject({ ok: false });
    expect(parseAngles('3, x')).toMatchObject({ ok: false, error: expect.stringContaining('“x”') });
    expect(parseAngles('50')).toMatchObject({ ok: false, error: expect.stringContaining('outside') });
    expect(parseAngles(Array.from({ length: 15 }, (_, i) => i).join(','))).toMatchObject({ ok: false });
  });

  it('a job for every body and angle; rows, the highest L/D of each body, and a CSV', () => {
    const bodies = ['4412', '0012'].map((c) => {
      const p = sectionFromCode(c);
      const b = airfoilBody(p.contour);
      return { id: p.id, name: p.name, geometry: b.geometry, thickness: b.metrics.thickness, noseRadius: b.metrics.noseRadius };
    });
    const jobs = jobsFor(bodies, [0, 6]);
    expect(jobs.map((j) => j.id)).toEqual(['4-4412@0', '4-4412@6', '4-0012@0', '4-0012@6']);
    const fake = (cl: number, cd: number, status: 'PASSED' | 'FAILED' = 'PASSED') =>
      ({ params: { reynolds: 500, cells: 64 }, forces: { liftCoeff: { mean: cl, se: 0.01, n: 8 }, dragCoeff: { mean: cd, se: 0.002, n: 8 } }, integrity: { status }, engine: { kind: 'gpu', adapter: 'x', precision: 'float32' }, separation: { upper: { x: null } } }) as unknown as CfdResult;
    const rows = [rowOf(jobs[0], fake(0.5, 0.1)), rowOf(jobs[1], fake(1.1, 0.12)), rowOf(jobs[2], fake(0, 0.09)), rowOf(jobs[3], fake(0.6, 0.11, 'FAILED'))];
    expect(rows[1].ld!.mean).toBeCloseTo(9.1667, 3);
    expect(rows[1].engine).toBe('GPU (32-bit)');
    const top = highestLd(rows);
    // one row per body: the 4412 at 6° (L/D 9.2) and the 0012 at 0° (L/D 0); the failed run of the 0012 at 6° does not count
    expect(top.map((r) => `${r.name}@${r.alphaDeg}`)).toEqual(['NACA 4412@6', 'NACA 0012@0']);
    expect(highestLd(rows.slice(2, 3)).length).toBe(1);
    const csv = studyCsv(rows).split('\n');
    expect(csv[0]).toMatch(/^body,alpha_deg,lift_coeff/);
    expect(csv.length).toBe(5);
    expect(csv[2]).toContain('"NACA 4412",6,1.10000');
  });

  it('says when the lattice cannot resolve a section', () => {
    expect(resolutionAdvice(0.12, 0.0159, 48).join(' ')).toMatch(/nose radius is 0\.76 cells/);
    expect(resolutionAdvice(0.12, 0.0159, 128)).toEqual([]);
    expect(resolutionAdvice(0.06, 0.004, 48).join(' ')).toMatch(/only 2\.9 lattice cells thick/);
  });
});
