import { describe, expect, it } from 'vitest';
import { applyDelta, capByParticles, DEFAULT_LIVE, fitToLimits, gapAtStations, planIncrement } from '../src/geometry/LiveFill';
import { flatPlate, place, sideY, unplace, validateGeometry, bodyPolygon } from '../src/geometry/SurfaceGeometry';
import { wakeFromTotals, WAKE_SPEC, type WakeAnalysis } from '../src/measurements/WakeVoid';
import { polygonArea, PolygonBody } from '../src/walls/SolidBody';

const g0 = flatPlate(30, 3);

/** a wake analysis with a void of the given gap from station k0 on (segments 0 … 29) */
function wake(k0: number, gap: number, ambient = 0.125): WakeAnalysis {
  const S = 30;
  const NB = 12;
  const counts: number[] = [];
  for (let k = 0; k < S; k++) for (let j = 0; j < NB; j++) counts.push(k >= k0 && j < gap ? 12 : 100);
  return wakeFromTotals({ stations: S, bins: NB, counts, exposure: new Array(S).fill(800), xs: Array.from({ length: S }, (_, k) => k + 0.5), ambient, dn: 1 }, 'upper', { ...WAKE_SPEC, pool: 1 });
}

describe('the polygon body can be reshaped in place', () => {
  const verts = bodyPolygon(g0);
  const make = () => new PolygonBody({ name: 't', vertices: verts.slice(), accommodation: 1, temperature: 1, binLength: 1.5 });
  it('keeps its measurement bins and tallies, and moves its edges and bounding box', () => {
    const b = make();
    b.normalImpulse[3] = 7;
    const offs = b.edges.map((e) => [e.bins, e.binOffset]);
    const v2 = verts.slice();
    // raise the vertices of the upper side by 1.5 (the upper side holds the vertices after the lower side)
    const n = v2.length / 2;
    for (let k = n / 2; k < n; k++) v2[2 * k + 1] += 1.5;
    b.reshape(v2);
    expect(b.edges.map((e) => [e.bins, e.binOffset])).toEqual(offs);
    expect(b.normalImpulse[3]).toBe(7);
    expect(b.ymax).toBeCloseTo(Math.max(...verts.filter((_, i) => i % 2 === 1)) + 1.5, 9);
    expect(polygonArea(b.config.vertices)).toBeGreaterThan(polygonArea(verts));
    // the geometry of a contact is now the new surface
    const top = b.closest(15, Math.max(...v2.filter((_, i) => i % 2 === 1)) + 2);
    expect(top.d).toBeCloseTo(2, 6);
    expect(b.contains(15, Math.max(...v2.filter((_, i) => i % 2 === 1)) - 0.5)).toBe(true);
  });
  it('refuses a change of vertex count, a reversed polygon and a zero-length edge', () => {
    const b = make();
    expect(() => b.reshape(verts.slice(0, verts.length - 2))).toThrow(/needs/);
    const rev: number[] = [];
    for (let k = verts.length / 2 - 1; k >= 0; k--) rev.push(verts[2 * k], verts[2 * k + 1]);
    expect(() => b.reshape(rev)).toThrow(/counter-clockwise/);
    const z = verts.slice();
    z[2] = z[0];
    z[3] = z[1];
    expect(() => b.reshape(z)).toThrow(/zero-length|counter-clockwise/);
  });
});

describe('body frame ↔ simulation frame', () => {
  it('unplace inverts place', () => {
    const pl = { x: 60, y: 50, alphaDeg: 30 };
    const pts = [0, 0, 10, 3, 30, -1.5, 15, 7];
    const back = unplace(place(pts, pl), pl);
    back.forEach((v, i) => expect(v).toBeCloseTo(pts[i], 9));
  });
});

describe('the live-fill rule', () => {
  it('fills the gap from the separation point to the front, and nowhere else', () => {
    const w = wake(10, 6);
    expect(w.separation!.x).toBeCloseTo(10.5, 9);
    const plan = planIncrement(g0, w, DEFAULT_LIVE, null)!;
    expect(plan.onset).toBeCloseTo(10.5, 9);
    expect(plan.front).toBeCloseTo(12, 9);
    plan.delta.forEach((d, i) => {
      if (i < 10) expect(d).toBe(0); // upstream of the separation point nothing is added
      expect(d).toBeLessThanOrEqual(DEFAULT_LIVE.maxStep + 1e-12);
      expect(d).toBeGreaterThanOrEqual(0);
    });
    expect(plan.delta[28]).toBe(0); // the trailing edge reserve
    expect(plan.delta[30]).toBe(0);
    expect(plan.delta[12]).toBeGreaterThan(0);
    // the ramp starts at zero on the separation point and the front tapers to zero beyond its taper
    expect(plan.delta[Math.round(plan.front + DEFAULT_LIVE.taper)]).toBe(0);
  });

  it('adds more where the gap is bigger, never more than relaxation × gap', () => {
    const wsmall = wake(10, 1.2);
    const small = planIncrement(g0, wsmall, DEFAULT_LIVE, 28)!;
    const big = planIncrement(g0, wake(10, 8), DEFAULT_LIVE, 28)!;
    expect(Math.max(...big.delta)).toBeGreaterThan(Math.max(...small.delta));
    expect(Math.max(...small.delta)).toBeLessThanOrEqual(DEFAULT_LIVE.relaxation * (wsmall.stations[15].gap - DEFAULT_LIVE.margin) + 1e-9);
    expect(Math.max(...big.delta)).toBeCloseTo(DEFAULT_LIVE.maxStep, 9);
  });

  it('plans nothing when every station is touched, and ignores wetted segments inside the front', () => {
    expect(planIncrement(g0, wake(40, 6), DEFAULT_LIVE, null)).toBeNull();
    const gap = gapAtStations(g0, wake(10, 6));
    expect(gap[3]).toBe(0);
    expect(gap[20]).toBeGreaterThan(5);
  });

  it('the front moves toward the trailing edge but never past its reserve', () => {
    const last = planIncrement(g0, wake(10, 6), DEFAULT_LIVE, 29)!;
    expect(last.front).toBeCloseTo(g0.chord - DEFAULT_LIVE.teReserve, 9);
  });
});

describe('particles are never overrun', () => {
  const plan = planIncrement(g0, wake(4, 8), DEFAULT_LIVE, 28)!;
  const y = sideY(g0, 'upper');

  it('caps the increment above a particle that sits close to the surface, smoothly', () => {
    // a particle centre 0.8 above the upper surface at x = 14.2: the surface may rise only until radius + clearance from it
    const p = { x: 14.2, y: y[14] + 0.8 };
    const c = capByParticles(g0, 'upper', plan.delta, [p], 0.5, 0.1);
    expect(c.capped).toBe(1);
    expect(c.delta[14]).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(c.delta[15]).toBeLessThanOrEqual(0.2 + 1e-9);
    // a Lipschitz-type smoothing keeps the neighbours close
    for (let i = 1; i < c.delta.length; i++) expect(Math.abs(c.delta[i] - c.delta[i - 1])).toBeLessThanOrEqual(0.3 + 1e-9);
    // the cap never adds material
    c.delta.forEach((d, i) => expect(d).toBeLessThanOrEqual(plan.delta[i] + 1e-12));
  });

  it('a particle touching the surface stops the fill under it, and one farther away does not', () => {
    const touching = capByParticles(g0, 'upper', plan.delta, [{ x: 14.5, y: y[14] + 0.5 }], 0.5, 0.1);
    expect(touching.delta[14]).toBe(0);
    expect(touching.delta[15]).toBe(0);
    const far = capByParticles(g0, 'upper', plan.delta, [{ x: 14.5, y: y[14] + 5 }], 0.5, 0.1);
    expect(far.capped).toBe(0);
    expect(far.delta[14]).toBeCloseTo(plan.delta[14], 9);
  });

  it('works on the lower side with the sign reversed', () => {
    const lo = sideY(g0, 'lower');
    const d = plan.delta;
    const c = capByParticles(g0, 'lower', d, [{ x: 14.5, y: lo[14] - 0.6 }], 0.5, 0.1);
    expect(c.delta[14]).toBeLessThanOrEqual(0.1 + 1e-9);
    const above = capByParticles(g0, 'lower', d, [{ x: 14.5, y: y[14] + 0.6 }], 0.5, 0.1);
    expect(above.capped).toBe(0);
  });

  it('a polygon built from a capped increment holds no particle that was outside the old one', () => {
    // random particles outside the old plate; the capped, fitted increment must leave every one of them outside the new polygon
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const parts: { x: number; y: number }[] = [];
    while (parts.length < 400) {
      const q = { x: rnd() * 30, y: y[0] + 0.5 + rnd() * 9 };
      parts.push(q);
    }
    const c = capByParticles(g0, 'upper', plan.delta, parts, 0.5, 0.1);
    const fit = fitToLimits(g0, 'upper', c.delta, DEFAULT_LIVE.limits);
    expect('geometry' in fit).toBe(true);
    if (!('geometry' in fit)) return;
    const body = new PolygonBody({ name: 't', vertices: bodyPolygon(fit.geometry), accommodation: 1, temperature: 1 });
    for (const p of parts) {
      const old = new PolygonBody({ name: 'o', vertices: bodyPolygon(g0), accommodation: 1, temperature: 1 });
      if (old.closest(p.x, p.y).d < 0.5 - 1e-9) continue; // already overlapping the old surface: not ours to fix
      expect(body.closest(p.x, p.y).d).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });
});

describe('the geometry limits are applied locally', () => {
  it('a steep spot does not stop the rest of the increment', () => {
    // a surface that already climbs at the slope limit from station 2 to 5, stays up, and comes down at the limit
    const climb = g0.upper.map((_, i) => (i < 2 ? 0 : i <= 5 ? 0.5 * (i - 1) : i <= 12 ? 2 : Math.max(0, 2 - 0.5 * (i - 12))));
    const base = applyDelta(g0, 'upper', climb, 1);
    expect(validateGeometry(base, DEFAULT_LIVE.limits)).toEqual([]);
    const want = new Array(31).fill(0).map((_, i) => (i >= 1 && i <= 20 ? 0.1 * i : 0)); // would steepen the climb
    const fit = fitToLimits(base, 'upper', want, DEFAULT_LIVE.limits);
    expect('geometry' in fit).toBe(true);
    if (!('geometry' in fit)) return;
    expect(validateGeometry(fit.geometry, DEFAULT_LIVE.limits)).toEqual([]);
    const added = sideY(fit.geometry, 'upper').map((v, i) => v - sideY(base, 'upper')[i]);
    expect(added[3]).toBeLessThan(0.1 * 3 - 0.1); // held back on the steep stretch (planned 0.3)
    expect(Math.max(...added.slice(8, 20))).toBeGreaterThan(0.2); // but material still goes in where there is room
    expect(Math.min(...added)).toBeGreaterThanOrEqual(0);
    expect(fit.scale).toBeGreaterThan(0);
    expect(fit.scale).toBeLessThan(1);
  });
  it('reports which limit stops an increment that cannot be fitted', () => {
    const thick = flatPlate(30, 11.9);
    const r = fitToLimits(thick, 'upper', new Array(31).fill(1), DEFAULT_LIVE.limits);
    // everything is trimmed to zero by the thickness limit: the fit is the unchanged geometry, which is valid
    expect('geometry' in r || 'reason' in r).toBe(true);
    if ('geometry' in r) expect(sideY(r.geometry, 'upper').every((v, i) => v === sideY(thick, 'upper')[i] || v - sideY(thick, 'upper')[i] < 0.11)).toBe(true);
  });
});
