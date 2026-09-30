import { describe, expect, it } from 'vitest';
import { SoftContactForce } from '../src/core/DeformationModel';
import { Domain } from '../src/core/Domain';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { Simulation, type SimulationConfig } from '../src/core/Simulation';
import { createGas, squareBoxSide } from '../src/gas/InitialConditions';
import { lucyW, OccupancyForce } from '../src/occupancy/OccupancyModel';

const periodic = (L: number) => ({ xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true });

function randomStore(n: number, L: number, seed: number, r = 0.5) {
  const { store } = createGas({ count: n, radius: r, mass: 1, kT: 1, distribution: 'maxwell', seed, domain: periodic(L) });
  return store;
}

describe('occupancy model F = −ks ∇φ', () => {
  it('kernel is normalised: ∫ W dA = 1', () => {
    const h = 3;
    let s = 0;
    const dr = h / 4000;
    for (let k = 0; k < 4000; k++) {
      const r = (k + 0.5) * dr;
      s += lucyW(r, h) * 2 * Math.PI * r * dr;
    }
    expect(s).toBeCloseTo(1, 6);
  });

  it('forces are minus the gradient of the potential energy, and sum to zero', () => {
    const L = 30;
    const store = randomStore(120, L, 2);
    const dom = new Domain(periodic(L));
    const F = new OccupancyForce({ ks: 2.5, h: 4 });
    store.fx.fill(0);
    store.fy.fill(0);
    F.computeForces(store, dom);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < store.count; i++) {
      sx += store.fx[i];
      sy += store.fy[i];
    }
    expect(Math.abs(sx) + Math.abs(sy)).toBeLessThan(1e-12);
    for (const i of [0, 17, 60]) {
      const eps = 1e-6;
      const U = (dx: number) => {
        store.x[i] += dx;
        store.fx.fill(0);
        store.fy.fill(0);
        const u = F.computeForces(store, dom);
        store.x[i] -= dx;
        return u;
      };
      const dUdx = (U(eps) - U(-eps)) / (2 * eps);
      store.fx.fill(0);
      store.fy.fill(0);
      F.computeForces(store, dom);
      expect(store.fx[i]).toBeCloseTo(-dUdx, 6);
    }
  });

  it('pushes particles from high to low occupancy', () => {
    const dom = new Domain({ xmin: 0, xmax: 60, ymin: 0, ymax: 30, periodicX: false, periodicY: true });
    const store = new ParticleStore(2000);
    const rng = new Rng(3);
    // density rising linearly with x
    while (store.count < 1500) {
      const x = 60 * Math.sqrt(rng.next());
      store.add({ x, y: 30 * rng.next(), vx: 0, vy: 0, mass: 1, radius: 0.5 });
    }
    const F = new OccupancyForce({ ks: 1, h: 5 });
    F.computeForces(store, dom);
    let fx = 0;
    let n = 0;
    for (let i = 0; i < store.count; i++) {
      if (store.x[i] > 10 && store.x[i] < 50) {
        fx += store.fx[i];
        n++;
      }
    }
    expect(fx / n).toBeLessThan(0); // ∇φ points +x, force points −x
  });

  it('with collisions: KE + PE conserved to O(dt²) and momentum to round-off', () => {
    const res = (dt: number) => {
      const L = squareBoxSide(400, 0.5, 0.1);
      const store = randomStore(400, L, 5);
      const cfg: SimulationConfig = {
        domain: periodic(L),
        walls: [],
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'fixed', dt },
        seed: 1,
        safety: { energyTolerance: 1 },
      };
      const S = new Simulation(cfg, store, [new OccupancyForce({ ks: 20, h: 3 })]);
      const p0 = store.momentum();
      let worst = 0;
      while (S.time < 20) {
        S.step();
        worst = Math.max(worst, Math.abs(S.relativeEnergyResidual()));
      }
      const p = store.momentum();
      return { worst, dp: Math.hypot(p.x - p0.x, p.y - p0.y) / S.momentumScale, pe: S.potentialEnergy };
    };
    const a = res(0.02);
    const b = res(0.01);
    expect(a.pe).toBeGreaterThan(0);
    expect(a.dp).toBeLessThan(1e-12);
    expect(b.worst).toBeLessThan(a.worst / 2.5); // ≈ /4 for second order
    expect(b.worst).toBeLessThan(1e-3);
  });
});

describe('soft-contact deformation model F = Kδ', () => {
  it('reproduces an elastic head-on bounce and stores ½Kδ² during contact', () => {
    const store = new ParticleStore(2);
    store.add({ x: 8, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 });
    store.add({ x: 12, y: 10, vx: -1, vy: 0, mass: 1, radius: 0.5 });
    const K = 1e4;
    const soft = new SoftContactForce(K);
    const S = new Simulation(
      {
        domain: periodic(20),
        walls: [],
        collision: { enabled: false, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'fixed', dt: SoftContactForce.contactTime(K, 1) / 50 },
        seed: 1,
        safety: { energyTolerance: 1e-3 },
      },
      store,
      [soft],
    );
    let maxPE = 0;
    while (S.time < 3) {
      S.step();
      maxPE = Math.max(maxPE, S.potentialEnergy);
    }
    expect(store.vx[0]).toBeCloseTo(-1, 3);
    expect(store.vx[1]).toBeCloseTo(1, 3);
    // all kinetic energy (in the COM frame: 1) is briefly stored as deformation energy
    expect(maxPE).toBeGreaterThan(0.95);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-3);
    expect(soft.maxRelativeOverlap).toBeLessThan(0.02);
  });
});

describe('Universe B: inelastic parcels with an internal reservoir', () => {
  const run = (release: number) => {
    const L = squareBoxSide(400, 0.5, 0.1);
    const store = randomStore(400, L, 9);
    const S = new Simulation(
      {
        domain: periodic(L),
        walls: [],
        collision: { enabled: true, restitution: 0.8, contact: 'rewind-to-contact', dissipationTarget: 'internal', reservoirRelease: release },
        timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 },
        seed: 1,
      },
      store,
    );
    const ke0 = store.kineticEnergy();
    const kes: number[] = [];
    while (S.log.count < 400 * 60) {
      S.run(50);
      kes.push(store.kineticEnergy() / ke0);
    }
    return { S, kes, ke0 };
  };

  it('conserves kinetic + internal energy to round-off and never injects energy', () => {
    const { S } = run(0.5);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-12);
    expect(S.ledger.releasedFromInternal).toBeGreaterThan(0);
    expect(S.ledger.releasedFromInternal).toBeLessThan(S.ledger.dissipatedToInternal);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-12);
  });

  it('pure sink (ρ = 0) cools; with release the kinetic energy settles at a finite level', () => {
    const sink = run(0);
    const rel = run(0.5);
    const tail = (xs: number[]) => xs.slice(Math.floor(0.7 * xs.length));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(tail(sink.kes))).toBeLessThan(0.05);
    const t = tail(rel.kes);
    expect(mean(t)).toBeGreaterThan(0.3);
    // settled: first and second half of the tail agree to 10 %
    const h = Math.floor(t.length / 2);
    expect(Math.abs(mean(t.slice(0, h)) - mean(t.slice(h))) / mean(t)).toBeLessThan(0.1);
  });
});
