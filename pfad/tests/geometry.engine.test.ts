import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/Simulation';
import { bodyPolygon, place, placementAt, validateGeometry, type SurfaceGeometry } from '../src/geometry/SurfaceGeometry';
import { samplerSidesFor } from '../src/experiments/FlowGeometryExperiment';
import { createGas } from '../src/gas/InitialConditions';
import { ensembleEstimate } from '../src/measurements/Statistics';
import { SurfaceFlowSampler, WALL } from '../src/measurements/SurfaceFlowSampler';
import { PolygonBody } from '../src/walls/SolidBody';

/**
 * WHAT THE ENGINE SUPPORTS (docs/FLOW_GUIDED_GEOMETRY.md §2): bodies are polygons of straight edges
 * with point contacts at vertices. A curved surface is therefore a polyline. These tests check that
 * such polylines — a smooth lens (every vertex convex, small turning angles) and a flat plate with a
 * bump (concave junctions) — behave: nothing penetrates, the ledgers close, and a body at the gas
 * temperature in a gas at rest feels the gas pressure on every surface and no mean force or shear.
 */
function station(chord: number, n: number, f: (x: number) => number, base = 0.75): SurfaceGeometry {
  const x = Array.from({ length: n + 1 }, (_, i) => (i * chord) / n);
  return { chord, stations: n, upper: x.map((v) => base + f(v)), lower: x.map((v) => -base - f(v)) };
}

const LENS = station(40, 40, (x) => 3.25 * Math.sin((Math.PI * x) / 40));
// a flat plate with a smooth bump on the upper side only: concave where the bump meets the plate
const BUMP: SurfaceGeometry = (() => {
  const g = station(40, 40, () => 0, 1.5);
  g.upper = g.upper.map((y, i) => y + (i >= 10 && i <= 30 ? 2.5 * Math.pow(Math.sin((Math.PI * (i - 10)) / 20), 2) : 0));
  return g;
})();

function equilibrium(g: SurfaceGeometry, alphaDeg: number, seed: number) {
  const L = 90;
  const r = 0.5;
  const pl = placementAt(g, L / 2, L / 2, alphaDeg);
  const bodyCfg = { name: 'eq', vertices: place(bodyPolygon(g), pl), accommodation: 1, temperature: 1, binLength: 1.5 };
  const probe = new PolygonBody(bodyCfg);
  const domain = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: false, periodicY: false };
  const count = Math.round((0.1 * L * L) / (Math.PI * r * r));
  const { store } = createGas({ count, radius: r, mass: 1, kT: 1, distribution: 'maxwell', seed, domain, removeDrift: true, exclude: (x: number, y: number, rr: number) => probe.closest(x, y).d < rr });
  const sim = new Simulation(
    {
      domain,
      walls: (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, accommodation: 1, temperature: 1 })),
      bodies: [bodyCfg],
      collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
      timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 },
      seed,
    },
    store,
  );
  expect(sim.flags.filter((f) => f.code === 'INITIAL_OVERLAP')).toHaveLength(0);
  sim.runUntil(60);
  const sampler = new SurfaceFlowSampler(sim.bodies[0], samplerSidesFor(g, pl), { radius: r, normalWidth: 1, normalBins: 4 }, sim.time);
  sampler.restart(sim.time);
  const wallN = () => sim.walls.reduce((a, w) => a + w.totals().normalImpulse, 0);
  const pWall: number[] = [];
  const ps: Record<'upper' | 'lower', number[]> = { upper: [], lower: [] };
  const tau: Record<'upper' | 'lower', number[]> = { upper: [], lower: [] };
  const fx: number[] = [];
  const fy: number[] = [];
  const stationsLen = Object.fromEntries(sampler.sides.map((s) => [s.side, sampler.lengths(s.side)])) as Record<'upper' | 'lower', number[]>;
  const perimeter = (side: 'upper' | 'lower') => stationsLen[side].reduce((a, c) => a + c, 0);
  for (let k = 0; k < 12; k++) {
    const t0 = sim.time;
    const n0 = wallN();
    const i0 = { x: sim.bodies[0].impulseX, y: sim.bodies[0].impulseY };
    sim.runUntil(t0 + 60);
    const T = sim.time - t0;
    const b = sampler.closeBlock(sim.time);
    pWall.push((wallN() - n0) / (T * 4 * L));
    fx.push((sim.bodies[0].impulseX - i0.x) / T);
    fy.push((sim.bodies[0].impulseY - i0.y) / T);
    for (const side of ['upper', 'lower'] as const) {
      const w = b.sides[side]!.wall;
      let n = 0;
      let t = 0;
      for (let q = 0; q < w.length / WALL; q++) {
        n += w[q * WALL];
        t += w[q * WALL + 1];
      }
      ps[side].push(n / (T * perimeter(side)));
      tau[side].push(t / (T * perimeter(side)));
    }
  }
  return { sim, pWall, ps, tau, fx, fy };
}

describe('smooth and concave polygon bodies in the engine', () => {
  for (const [name, g, alpha] of [['smooth lens', LENS, 25], ['plate with a bump (concave junctions)', BUMP, 0]] as const) {
    it(`${name}: no penetration, closed ledgers, wall pressure everywhere, no mean force or shear`, () => {
      expect(validateGeometry(g, { minThickness: 1.4, maxSlope: 1, maxCurvature: 1, maxThickness: 20 })).toEqual([]);
      const r = equilibrium(g, alpha, 11);
      const { sim } = r;
      expect(sim.halted).toBe(false);
      expect(sim.bodies[0].insideDetections).toBe(0);
      expect(Math.abs(sim.relativeEnergyResidual())).toBeLessThan(1e-9);
      expect(sim.relativeMomentumResidual()).toBeLessThan(1e-9);
      const pw = ensembleEstimate(r.pWall);
      for (const side of ['upper', 'lower'] as const) {
        const pb = ensembleEstimate(r.ps[side]);
        // the surface pressure equals the wall pressure: the shape of the polyline does not matter at equilibrium
        expect(Math.abs(pb.mean - pw.mean), `${name} ${side}: ${pb.mean} vs ${pw.mean}`).toBeLessThan(4 * Math.hypot(pb.se, pw.se) + 0.03 * pw.mean);
        const ta = ensembleEstimate(r.tau[side]);
        expect(Math.abs(ta.mean), `${name} ${side} shear`).toBeLessThan(4 * ta.se + 0.01 * pw.mean);
      }
      const fx = ensembleEstimate(r.fx);
      const fy = ensembleEstimate(r.fy);
      expect(Math.abs(fx.mean)).toBeLessThan(4 * fx.se + 0.02);
      expect(Math.abs(fy.mean)).toBeLessThan(4 * fy.se + 0.02);
    });
  }
});
