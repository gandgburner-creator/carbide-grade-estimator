import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';
import { GridSums } from '../src/measurements/GridSums';
import { coarsen, columnObservables, floorOf, sumGrids } from '../src/experiments/WallFlowAnalysis';
import { FRINGE_RNG_STREAM, WallFlowRun, wallFlowGeometry, type WallFlowConfig } from '../src/experiments/WallFlowRun';
import { RNG_STREAM } from '../src/core/Random';
import { PolygonBody } from '../src/walls/SolidBody';

const small: WallFlowConfig = {
  label: 'small',
  length: 120,
  heightIn: 20,
  expansion: 1.5,
  fringe: [0, 20],
  plate: [30, 100],
  diffuser: [40, 70],
  contraction: [90, 110],
  rampSegments: 8,
  areaFraction: 0.1,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  fringeRate: 0.5,
  fringeMixY: true,
  control: { interval: 2, gainP: 1, gainI: 0.01, exitRate: 0.02, freezeAverage: 4, freezeAt: 6 },
  accommodation: 1,
  wallKT: 1,
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  contact: 'rewind-to-contact',
  startupTime: 8,
  measurementTime: 8,
  sampleInterval: 1,
  blocks: 2,
  seriesInterval: 2,
  cellX: 10,
  nearWallHeight: 8,
  nearWallCellY: 1,
  outerCellY: 5,
  fineCellX: 5,
  fineCellY: 0.5,
  fineHeight: 4,
  blockCellY: 2,
  blockHeight: 8,
  wallBin: 5,
};

function runToEnd(c: WallFlowConfig, seed: number) {
  const r = new WallFlowRun(c, seed);
  while (!r.done) r.advance(5000);
  return r;
}

describe('wall-flow geometry', () => {
  it('ceiling knots, bodies and fluid area agree', () => {
    const g = wallFlowGeometry(small);
    expect(g.heightOut).toBeCloseTo(30, 12);
    expect(g.ceiling(10)).toBe(20);
    expect(g.ceiling(80)).toBeCloseTo(30, 12);
    expect(g.ceiling(55)).toBeCloseTo(25, 12); // half-cosine midpoint
    expect(g.ceiling(10 + 120)).toBe(20); // periodic
    // fluid area by brute-force integration of the ceiling
    let a = 0;
    const n = 120000;
    for (let k = 0; k < n; k++) a += g.ceiling(((k + 0.5) / n) * 120) * (120 / n);
    expect(g.fluidArea).toBeCloseTo(a, 3);
    // every ceiling knot lies on a body edge: the body's closest distance is zero there
    const bodies = g.bodies.map((b) => new PolygonBody(b));
    for (const k of g.knots) {
      if (k.h >= g.heightOut - 1e-9 || k.x <= 0 || k.x >= 120) continue;
      expect(Math.min(...bodies.map((b) => Math.abs(b.closest(k.x, k.h).d)))).toBeLessThan(1e-9);
    }
  });

  it('a straight channel has no bodies', () => {
    const g = wallFlowGeometry({ ...small, expansion: 1 });
    expect(g.bodies).toHaveLength(0);
    expect(g.fluidArea).toBeCloseTo(120 * 20, 9);
  });

  it('the fringe stream does not collide with the core RNG streams', () => {
    expect(Object.values(RNG_STREAM)).not.toContain(FRINGE_RNG_STREAM);
  });
});

describe('wall-flow run', () => {
  it('closes the energy and momentum ledgers with the fringe and the plate active', () => {
    const r = runToEnd(small, 11).result();
    expect(r.halted).toBe(false);
    expect(r.conservation.maxAbsRelativeEnergyResidual).toBeLessThan(1e-11);
    expect(r.conservation.maxRelativeMomentumResidual).toBeLessThan(1e-11);
    expect(r.fringe.resamplings).toBeGreaterThan(0);
    expect(r.fringe.moves).toBeGreaterThan(0);
    // the ledger's external work is exactly the fringe's energy input
    expect(-r.ledger.forceWorkOut).toBeCloseTo(r.fringe.energyInTotal, 9);
    expect(r.ledger.forceImpulseX).toBeCloseTo(r.fringe.momentumXTotal, 9);
  });

  it('is deterministic for a seed', () => {
    const a = runToEnd(small, 12).result();
    const b = runToEnd(small, 12).result();
    expect(b.nearWall.px).toEqual(a.nearWall.px);
    expect(b.floor.total.tangentialImpulse).toEqual(a.floor.total.tangentialImpulse);
  });

  it('a specular plate transfers no tangential momentum; the diffuse plate does, only on the plate', () => {
    const spec = runToEnd({ ...small, accommodation: 0 }, 13).result();
    expect(spec.floor.total.tangentialImpulse.every((v) => v === 0)).toBe(true);
    const diff = runToEnd(small, 13).result();
    const bins = diff.floor.total.tangentialImpulse;
    const bw = diff.floor.bin;
    bins.forEach((v, b) => {
      const x = (b + 0.5) * bw;
      if (x < small.plate[0] || x > small.plate[1]) expect(v).toBe(0);
    });
    expect(bins.some((v) => v !== 0)).toBe(true);
  });

  it('keeps every particle out of the ceiling bodies and inside the channel', () => {
    const run = runToEnd(small, 14);
    const g = run.geometry;
    const s = run.sim.store;
    for (let i = 0; i < s.count; i++) expect(s.y[i] + s.radius[i]).toBeLessThanOrEqual(g.ceiling(s.x[i]) + 0.05);
    expect(run.sim.flags.filter((f) => f.severity === 'failure')).toHaveLength(0);
  });
});

describe('grid sums and observables', () => {
  it('skips particles outside the region and coarsens exactly', () => {
    const st = new ParticleStore(4);
    st.add({ x: 1, y: 1, vx: 2, vy: 0, mass: 1, radius: 0.5 });
    st.add({ x: 3, y: 1, vx: -1, vy: 1, mass: 1, radius: 0.5 });
    st.add({ x: 1, y: 9, vx: 5, vy: 0, mass: 1, radius: 0.5 }); // outside (y ≥ 4)
    const g = new GridSums({ x0: 0, y0: 0, x1: 4, y1: 4 }, 2, 2);
    g.add(st);
    const d = g.data();
    expect(d.count).toEqual([1, 1, 0, 0]);
    expect(d.px).toEqual([2, -1, 0, 0]);
    const c = coarsen(d, 2, 2);
    expect(c.count).toEqual([2]);
    expect(c.px).toEqual([1]);
    expect(c.sxx).toEqual([5]);
    const s2 = sumGrids([d, d]);
    expect(s2.snapshots).toBe(2);
    expect(s2.px).toEqual([4, -2, 0, 0]);
  });

  it('column observables: wall shear and pressure are impulse per time per length', () => {
    const r = runToEnd({ ...small, expansion: 1 }, 15).result();
    const o = columnObservables(r.config, r.nearWall, r.outer, floorOf(r), r.measurementTime, {
      coreFrom: 0.4,
      coreTo: 0.8,
      edge: 0.4,
      nearWallBand: 2,
      cellY: 2,
      cellX: 10,
    });
    const i = 5; // column [50, 60)
    const tan = r.floor.total.tangentialImpulse[10] + r.floor.total.tangentialImpulse[11];
    expect(o.tauW[i]).toBeCloseTo(tan / (r.measurementTime * 10), 12);
    expect(o.x[i]).toBe(55);
    expect(o.Ue.every(Number.isFinite)).toBe(true);
  });
});
