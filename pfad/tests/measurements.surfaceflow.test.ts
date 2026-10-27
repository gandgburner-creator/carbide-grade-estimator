import { describe, expect, it } from 'vitest';
import { Ledger } from '../src/core/Ledger';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { bodyConfigFor, placementFor, samplerSidesFor, FLOW_GEOMETRY_QUICK, type FlowGeometryParams } from '../src/experiments/FlowGeometryExperiment';
import { bodyPolygon, flatPlate, place, placementAt } from '../src/geometry/SurfaceGeometry';
import { SUMS, SurfaceFlowSampler, WALL } from '../src/measurements/SurfaceFlowSampler';
import { PolygonBody } from '../src/walls/SolidBody';

/** Hand-built particle states around a plate: the sampler must assign each particle to the right station and bin and resolve u_t and u_n. */
function setup(alphaDeg: number) {
  const g = flatPlate(20, 3);
  const pl = placementAt(g, 50, 50, alphaDeg);
  const body = new PolygonBody({ name: 't', vertices: place(bodyPolygon(g), pl), accommodation: 1, temperature: 1, binLength: 1.5 });
  const sampler = new SurfaceFlowSampler(body, samplerSidesFor(g, pl), { radius: 0.5, normalWidth: 1, normalBins: 6 }, 0);
  const a = (alphaDeg * Math.PI) / 180;
  const t = { x: Math.cos(a), y: -Math.sin(a) }; // downstream tangent (LE → TE)
  const nUp = { x: Math.sin(a), y: Math.cos(a) }; // outward normal of the upper side
  /** simulation-frame position from body-frame (x, y) */
  const at = (x: number, y: number) => ({ x: pl.x + x * t.x + y * nUp.x, y: pl.y + x * t.y + y * nUp.y });
  return { g, pl, body, sampler, t, nUp, at };
}

describe('SurfaceFlowSampler', () => {
  for (const alpha of [0, 30, 65]) {
    it(`assigns particles to station and normal bin and resolves u_t, u_n (α = ${alpha}°)`, () => {
      const { sampler, t, nUp, at } = setup(alpha);
      const s = new ParticleStore(10);
      // upper side: surface at y = +1.5; station 4 covers x ∈ [4, 5]; centre distance n = 1.0 → bin 0 (n ∈ [0.5, 1.5))
      let p = at(4.5, 1.5 + 1.0);
      s.add({ x: p.x, y: p.y, vx: 0.8 * t.x + 0.3 * nUp.x, vy: 0.8 * t.y + 0.3 * nUp.y, mass: 1, radius: 0.5 });
      // upper side, station 10, n = 2.7 → bin 2 (n ∈ [2.5, 3.5)); u_t = −0.4 (backflow), u_n = 0
      p = at(10.2, 1.5 + 2.7);
      s.add({ x: p.x, y: p.y, vx: -0.4 * t.x, vy: -0.4 * t.y, mass: 2, radius: 0.5 });
      // lower side: surface at y = −1.5, outward normal −nUp; station 7, n = 1.2 → bin 0; moving downstream
      p = at(7.5, -1.5 - 1.2);
      s.add({ x: p.x, y: p.y, vx: 1.1 * t.x, vy: 1.1 * t.y, mass: 1, radius: 0.5 });
      // outside the sampled window (n = 8 > 0.5 + 6) and beyond the trailing edge: ignored
      p = at(5, 1.5 + 8);
      s.add({ x: p.x, y: p.y, vx: 5, vy: 5, mass: 1, radius: 0.5 });
      p = at(25, 3);
      s.add({ x: p.x, y: p.y, vx: 5, vy: 5, mass: 1, radius: 0.5 });
      sampler.sample(s);
      const b = (sampler as unknown as { cur: Record<string, { sums: number[] }> }).cur;
      const at3 = (side: 'upper' | 'lower', k: number, j: number) => b[side].sums.slice((k * 6 + j) * SUMS, (k * 6 + j + 1) * SUMS);
      const u0 = at3('upper', 4, 0);
      expect(u0[0]).toBe(1);
      expect(u0[2]).toBeCloseTo(0.8, 12); // Σ m u_t
      expect(u0[3]).toBeCloseTo(0.3, 12); // Σ m u_n
      const u2 = at3('upper', 10, 2);
      expect(u2[0]).toBe(1);
      expect(u2[1]).toBe(2);
      expect(u2[2]).toBeCloseTo(2 * -0.4, 12);
      const l0 = at3('lower', 7, 0);
      expect(l0[0]).toBe(1);
      expect(l0[2]).toBeCloseTo(1.1, 12); // downstream is positive on the lower side too
      expect(l0[3]).toBeCloseTo(0, 12);
      // nothing else was counted
      const total = (side: 'upper' | 'lower') => b[side].sums.filter((_, i) => i % SUMS === 0).reduce((a, c) => a + c, 0);
      expect(total('upper')).toBe(2);
      expect(total('lower')).toBe(1);
    });
  }

  it('wall shear is positive downstream on both sides for a gas moving downstream, and normal impulse is positive into the body', () => {
    const { body, sampler, t, nUp } = setup(20);
    const rng = new Rng(5);
    const ledger = new Ledger();
    const dt = 0.1;
    const N = 4000;
    // particles with velocity (u_t = 1, u_n = −0.6): onto the upper side from above; (u_t = 1, u_n = +0.6) onto the lower side from below
    for (const [sign, y0] of [[1, 1.5], [-1, -1.5]] as const) {
      const s = new ParticleStore(N);
      for (let i = 0; i < N; i++) {
        const x = 2 + (16 * (i + 0.5)) / N;
        const n = 0.5 - 0.02; // slightly inside the contact distance
        const pl = setup(20).pl;
        const a = (20 * Math.PI) / 180;
        const px = pl.x + x * Math.cos(a) + (y0 + sign * n) * Math.sin(a);
        const py = pl.y - x * Math.sin(a) + (y0 + sign * n) * Math.cos(a);
        s.add({ x: px, y: py, vx: 1 * t.x - sign * 0.6 * nUp.x, vy: 1 * t.y - sign * 0.6 * nUp.y, mass: 1, radius: 0.5 });
      }
      body.interact(s, dt, rng, ledger);
    }
    const block = sampler.closeBlock(1);
    for (const side of ['upper', 'lower'] as const) {
      const wall = block.sides[side]!.wall;
      let tan = 0;
      let nrm = 0;
      let hits = 0;
      for (let k = 0; k < wall.length / WALL; k++) {
        nrm += wall[k * WALL];
        tan += wall[k * WALL + 1];
        hits += wall[k * WALL + 2];
      }
      expect(hits).toBeGreaterThan(0.95 * N);
      // re-emission is diffuse at kT_w = 1: the mean tangential momentum delivered is the incident one (1 per particle)
      expect(tan / hits).toBeGreaterThan(0.9);
      expect(tan / hits).toBeLessThan(1.1);
      // normal impulse into the body: incident 0.6 plus the re-emitted outward momentum (positive)
      expect(nrm / hits).toBeGreaterThan(0.6);
    }
  });

  it('closing a block differences the body tallies: a second block sees only its own impacts', () => {
    const { body, sampler, nUp } = setup(0);
    const rng = new Rng(2);
    const hit = (n: number) => {
      const s = new ParticleStore(n);
      for (let i = 0; i < n; i++) s.add({ x: 50 - 8 + (16 * (i + 0.5)) / n, y: 50 + 1.5 + 0.48, vx: 0, vy: -1, mass: 1, radius: 0.5 });
      body.interact(s, 0.1, rng, new Ledger());
    };
    hit(100);
    const b1 = sampler.closeBlock(1);
    hit(40);
    const b2 = sampler.closeBlock(2);
    const sumHits = (b: typeof b1) => b.sides.upper!.wall.filter((_, i) => i % WALL === 2).reduce((a, c) => a + c, 0);
    expect(sumHits(b1)).toBeGreaterThan(90);
    expect(sumHits(b2)).toBeGreaterThan(35);
    expect(sumHits(b2)).toBeLessThan(45);
    void nUp;
  });

  it('the body of a version is built from the same polygon the sampler uses (edge ↔ station mapping)', () => {
    const p: FlowGeometryParams = { ...FLOW_GEOMETRY_QUICK, geometry: flatPlate(12, 3), alphaDeg: 17 };
    const cfg = bodyConfigFor(p);
    const body = new PolygonBody(cfg);
    const sides = samplerSidesFor(p.geometry, placementFor(p));
    const n = p.geometry.stations;
    expect(body.edges.length).toBe(2 * n + 2);
    for (const sd of sides) {
      sd.edges.forEach((e, k) => {
        const ed = body.edges[e];
        // an upper edge runs a→b upstream, a lower one downstream; both lie on the side's polyline segment k
        const p0 = { x: sd.points[2 * k], y: sd.points[2 * k + 1] };
        const p1 = { x: sd.points[2 * k + 2], y: sd.points[2 * k + 3] };
        const [a, b] = sd.side === 'lower' ? [p0, p1] : [p1, p0];
        expect(ed.ax).toBeCloseTo(a.x, 9);
        expect(ed.ay).toBeCloseTo(a.y, 9);
        expect(ed.bx).toBeCloseTo(b.x, 9);
        expect(ed.by).toBeCloseTo(b.y, 9);
      });
    }
  });
});
