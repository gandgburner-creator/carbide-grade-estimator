import { describe, expect, it } from 'vitest';
import { AIRFOIL_PRESETS, airfoilBody, sectionFromCode } from '../src/reference/Airfoils';
import { DEFAULT_DIMPLE_TEXTS, DIMPLE_PRESETS, DIMPLES_2D_NOTE, applyDimples, capDepth, dimpleAdvice, dimpleCentres, dimpleLabel, dimpleTextsOf, dimpledBody, parseDimples, stationsFor, type DimpleSpec } from '../src/reference/Dimples';

const spec: DimpleSpec = { surface: 'upper', diameter: 0.04, depthRatio: 0.1, coverage: 0.75, from: 0.08, to: 0.92 };
const c4412 = sectionFromCode('4412').contour;

describe('the shape of a dimple', () => {
  it('is a circular segment of the given width and depth', () => {
    const d = 0.04;
    const h = 0.004;
    expect(capDepth(0, d, h)).toBeCloseTo(h, 12);
    expect(capDepth(d / 2, d, h)).toBe(0);
    expect(capDepth(0.03, d, h)).toBe(0);
    // a point of a circle of radius R through the rim: depth(u) = sqrt(R² − u²) − (R − h)
    const R = (d * d) / (8 * h) + h / 2;
    expect(capDepth(0.01, d, h)).toBeCloseTo(Math.sqrt(R * R - 1e-4) - (R - h), 12);
    // a half circle: the depth is half the width
    expect(capDepth(0, 0.04, 0.02)).toBeCloseTo(0.02, 12);
    expect(capDepth(0.01, 0.04, 0.02)).toBeCloseTo(Math.sqrt(0.02 ** 2 - 0.01 ** 2), 12);
  });

  it('are placed at the pitch the density gives, centred in the stretch, never overlapping', () => {
    const c = dimpleCentres(spec);
    const pitch = spec.diameter / spec.coverage;
    for (let i = 1; i < c.length; i++) expect(c[i] - c[i - 1]).toBeCloseTo(pitch, 12);
    expect(c[0] - spec.diameter / 2).toBeGreaterThanOrEqual(spec.from - 1e-12);
    expect(c[c.length - 1] + spec.diameter / 2).toBeLessThanOrEqual(spec.to + 1e-12);
    // centred: the room left at the two ends is the same
    expect(c[0] - spec.diameter / 2 - spec.from).toBeCloseTo(spec.to - (c[c.length - 1] + spec.diameter / 2), 12);
    // a denser row has more dimples; touching dimples (coverage 1) are one diameter apart
    expect(dimpleCentres({ ...spec, coverage: 0.95 }).length).toBeGreaterThan(dimpleCentres({ ...spec, coverage: 0.3 }).length);
    const t = dimpleCentres({ ...spec, coverage: 1 });
    expect(t[1] - t[0]).toBeCloseTo(spec.diameter, 12);
    // smaller dimples at the same density: more of them
    expect(dimpleCentres({ ...spec, diameter: 0.02 }).length).toBeGreaterThan(dimpleCentres(spec).length);
    expect(dimpleCentres({ ...spec, from: 0.5, to: 0.52 })).toEqual([]);
  });
});

describe('the settings', () => {
  it('parse from text, and say in words what is wrong', () => {
    const ok = parseDimples(DEFAULT_DIMPLE_TEXTS);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.spec).toMatchObject({ surface: 'upper', diameter: 0.04, depthRatio: 0.1, coverage: 0.7, from: 0.08, to: 0.92 });
    const bad = parseDimples({ ...DEFAULT_DIMPLE_TEXTS, diameterPct: '0.2', depthPct: 'abc', toPct: '5' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(' | ')).toMatch(/dimple diameter 0\.2% is outside/);
      expect(bad.errors.join(' | ')).toMatch(/“abc” is not a number/);
    }
    const short = parseDimples({ ...DEFAULT_DIMPLE_TEXTS, fromPct: '40', toPct: '42', diameterPct: '5' });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors[0]).toMatch(/shorter than one dimple/);
    const back = parseDimples(dimpleTextsOf(spec));
    expect(back.ok && back.spec).toEqual(spec);
    for (const p of DIMPLE_PRESETS) expect(parseDimples(dimpleTextsOf(p.spec)).ok, p.id).toBe(true);
  });

  it('give the number of stations a body needs to draw them', () => {
    expect(stationsFor({ ...spec, diameter: 0.2 })).toBe(160);
    expect(stationsFor({ ...spec, diameter: 0.04 })).toBe(236);
    expect(stationsFor({ ...spec, diameter: 0.015 })).toBe(629);
  });
});

describe('a dimpled section', () => {
  it('has the same section outside the dimples, dents only on the chosen surface, and the ends untouched', () => {
    const base = airfoilBody(c4412, 30, stationsFor(spec));
    const { body, record } = dimpledBody(c4412, spec, 30);
    const g = body.geometry;
    expect(g.stations).toBe(base.geometry.stations);
    expect(g.pointedEnds).toBe(true);
    expect(g.upper[0]).toBe(0);
    expect(g.upper[g.stations]).toBe(0);
    let dented = 0;
    for (let k = 0; k <= g.stations; k++) {
      expect(g.lower[k]).toBe(base.geometry.lower[k]);
      expect(g.upper[k]).toBeLessThanOrEqual(base.geometry.upper[k] + 1e-12);
      if (g.upper[k] < base.geometry.upper[k] - 1e-9) dented++;
      if (g.xs![k] / 30 < spec.from - 1e-9 || g.xs![k] / 30 > spec.to + 1e-9) expect(g.upper[k]).toBe(base.geometry.upper[k]);
    }
    expect(dented).toBeGreaterThan(40);
    expect(record.count).toBe(dimpleCentres(spec).length);
    expect(record.label).toBe(dimpleLabel(spec));
    // the card numbers are those of the section before its dimples
    expect(body.metrics).toEqual(base.metrics);
  });

  it('is dented by the depth asked for, measured along the surface (about h at the centre of a dimple on a gently sloping surface)', () => {
    const flat = sectionFromCode('0012').contour;
    const s: DimpleSpec = { surface: 'upper', diameter: 0.06, depthRatio: 0.2, coverage: 0.5, from: 0.4, to: 0.6 };
    const base = airfoilBody(flat, 1, stationsFor(s));
    const { body } = dimpledBody(flat, s, 1);
    const centre = dimpleCentres(s)[0];
    let k0 = 0;
    for (let k = 0; k <= base.geometry.stations; k++) if (Math.abs(base.geometry.xs![k] - centre) < Math.abs(base.geometry.xs![k0] - centre)) k0 = k;
    const dent = base.geometry.upper[k0] - body.geometry.upper[k0];
    expect(dent).toBeGreaterThan(0.012 * 0.97);
    expect(dent).toBeLessThan(0.012 * 1.06);
  });

  it('adds surface length that grows with the depth and the density, and none when the dimples are not there', () => {
    const gain = (s: DimpleSpec) => dimpledBody(c4412, s, 30).record.surfaceGain;
    expect(gain(spec)).toBeGreaterThan(0);
    expect(gain({ ...spec, depthRatio: 0.3 })).toBeGreaterThan(gain(spec));
    expect(gain({ ...spec, coverage: 0.95 })).toBeGreaterThan(gain({ ...spec, coverage: 0.3 }));
    expect(gain({ ...spec, surface: 'both' })).toBeGreaterThan(gain(spec) * 0.5);
  });

  it('puts them on the lower surface or both, as asked', () => {
    const base = airfoilBody(c4412, 30, stationsFor(spec)).geometry;
    const lo = dimpledBody(c4412, { ...spec, surface: 'lower' }, 30).body.geometry;
    const both = dimpledBody(c4412, { ...spec, surface: 'both' }, 30).body.geometry;
    expect(lo.upper).toEqual(base.upper);
    expect(lo.lower.some((v, k) => v > base.lower[k] + 1e-9)).toBe(true);
    expect(both.upper.some((v, k) => v < base.upper[k] - 1e-9)).toBe(true);
    expect(both.lower.some((v, k) => v > base.lower[k] + 1e-9)).toBe(true);
  });

  it('keeps the section open: where it is too thin for the dimples they are made shallower and the surfaces never cross', () => {
    const thin = sectionFromCode('0006').contour;
    const s: DimpleSpec = { surface: 'both', diameter: 0.1, depthRatio: 0.5, coverage: 0.9, from: 0.3, to: 0.9 };
    const { body, record } = dimpledBody(thin, s, 30);
    expect(record.thinned).toBeGreaterThan(0);
    expect(body.notes.join(' ')).toMatch(/too thin/);
    const g = body.geometry;
    const base = airfoilBody(thin, 30, stationsFor(s)).geometry;
    // never thinner than the small gap that is kept (or than the section was to begin with, near its two ends)
    for (let k = 1; k < g.stations; k++) expect(g.upper[k] - g.lower[k], `station ${k}`).toBeGreaterThanOrEqual(Math.min(base.upper[k] - base.lower[k], 0.006 * 30) - 1e-9);
  });

  it('works for every section of the list and for the three designed sections', () => {
    for (const a of AIRFOIL_PRESETS) {
      const { body, record } = dimpledBody(a.contour, spec, 30);
      expect(record.count, a.name).toBeGreaterThan(5);
      for (let k = 1; k < body.geometry.stations; k++) expect(body.geometry.upper[k] - body.geometry.lower[k], `${a.name} ${k}`).toBeGreaterThan(0);
    }
  });

  it('refuses a stretch that holds no dimple, in words', () => {
    expect(() => dimpledBody(c4412, { ...spec, from: 0.5, to: 0.52 }, 30)).toThrow(/no dimple fits/);
  });

  it('does not change the original geometry in place', () => {
    const base = airfoilBody(c4412, 30, 300).geometry;
    const copy = JSON.stringify(base);
    applyDimples(base, spec);
    expect(JSON.stringify(base)).toBe(copy);
  });
});

describe('what the lattice can resolve', () => {
  it('says so when the dimples are smaller than a cell, or barely resolved, or narrow', () => {
    expect(dimpleAdvice({ ...spec, diameter: 0.02, depthRatio: 0.05 }, 48).join(' ')).toMatch(/smaller than the lattice can see/);
    expect(dimpleAdvice({ ...spec, diameter: 0.04, depthRatio: 0.1 }, 128).join(' ')).toMatch(/barely resolved/);
    expect(dimpleAdvice({ ...spec, diameter: 0.04, depthRatio: 0.3 }, 192)).toEqual([]);
    expect(dimpleAdvice({ ...spec, diameter: 0.02, depthRatio: 0.5 }, 128).join(' ')).toMatch(/cells wide/);
  });

  it('carries the two-dimensional caveat', () => {
    expect(DIMPLES_2D_NOTE).toMatch(/groove across the wing/);
    expect(DIMPLES_2D_NOTE).toMatch(/not whether dimples help a wing/);
  });
});
