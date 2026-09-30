import { describe, expect, it } from 'vitest';
import type { CollisionConfig } from '../src/core/CollisionModel';
import { ParticleStore, type ParticleInit } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { Simulation } from '../src/core/Simulation';

const periodicBox = { xmin: 0, xmax: 20, ymin: 0, ymax: 20, periodicX: true, periodicY: true };

function sim(particles: ParticleInit[], collision: Partial<CollisionConfig> = {}, dt = 0.01) {
  const store = new ParticleStore(Math.max(particles.length, 1));
  for (const p of particles) store.add(p);
  return new Simulation(
    {
      domain: periodicBox,
      walls: [],
      collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external', ...collision },
      timestep: { kind: 'fixed', dt },
      seed: 1,
    },
    store,
  );
}

const pairKE = (s: ParticleStore) => s.kineticEnergy();

describe('hard-disk collision law', () => {
  it('head-on, equal masses, e = 1: velocities exchange', () => {
    const S = sim([
      { x: 8, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
      { x: 12, y: 10, vx: -1, vy: 0, mass: 1, radius: 0.5 },
    ]);
    S.runUntil(3);
    expect(S.log.count).toBe(1);
    expect(S.store.vx[0]).toBeCloseTo(-1, 14);
    expect(S.store.vx[1]).toBeCloseTo(1, 14);
    const ev = S.log.recent(0);
    expect(ev.vn).toBeCloseTo(-2, 14); // (v1 - v2)·n with n from particle 1 (j) to 0 (i)
    expect(ev.J).toBeCloseTo(2, 14); // -(1+1)(-2)/(1+1)
    expect(ev.dKE).toBeCloseTo(0, 14);
  });

  it('rewind-to-contact puts a binary collision at the exact contact instant', () => {
    // contact occurs at t = 1.5 (gap 3 closed at relative speed 2); dt = 0.4 does not land on it
    const S = sim(
      [
        { x: 8, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
        { x: 12, y: 10, vx: -1, vy: 0, mass: 1, radius: 0.5 },
      ],
      {},
      0.4,
    );
    S.run(10); // t = 4
    // exact event-driven answer: contact at x = 9.5 / 10.5 at t = 1.5, then separate for 2.5
    expect(S.store.x[0]).toBeCloseTo(9.5 - 2.5, 12);
    expect(S.store.x[1]).toBeCloseTo(10.5 + 2.5, 12);
    expect(S.log.recent(0).t).toBeCloseTo(1.5, 12);
  });

  it('conserves momentum and (e = 1) energy for oblique collisions with unequal masses', () => {
    const rng = new Rng(99);
    for (let trial = 0; trial < 200; trial++) {
      const m1 = rng.uniform(0.2, 5);
      const m2 = rng.uniform(0.2, 5);
      const r1 = rng.uniform(0.3, 1);
      const r2 = rng.uniform(0.3, 1);
      const b = rng.uniform(-0.95, 0.95) * (r1 + r2); // impact parameter
      const S = sim([
        { x: 5, y: 10, vx: rng.uniform(0.5, 2), vy: rng.uniform(-0.2, 0.2), mass: m1, radius: r1 },
        { x: 5 + 3, y: 10 + b, vx: rng.uniform(-2, -0.5), vy: rng.uniform(-0.2, 0.2), mass: m2, radius: r2 },
      ]);
      const p0 = S.store.momentum();
      const e0 = pairKE(S.store);
      S.runUntil(4);
      if (S.log.count === 0) continue;
      const p1 = S.store.momentum();
      expect(Math.abs(p1.x - p0.x)).toBeLessThan(1e-13 * (1 + Math.abs(p0.x)));
      expect(Math.abs(p1.y - p0.y)).toBeLessThan(1e-13 * (1 + Math.abs(p0.y)));
      expect(Math.abs(pairKE(S.store) - e0) / e0).toBeLessThan(1e-13);
      const ev = S.log.recent(0);
      expect(ev.dpx * ev.dpx + ev.dpy * ev.dpy).toBeCloseTo(ev.J * ev.J, 10);
    }
  });

  it('e < 1: post-collision normal velocity is −e·v_n and the loss is (1−e²)·½μv_n², ledgered', () => {
    for (const e of [0.99, 0.9, 0.5, 0]) {
      const S = sim(
        [
          { x: 5, y: 10, vx: 1.3, vy: 0.2, mass: 2, radius: 0.5 },
          { x: 8, y: 10.4, vx: -0.7, vy: 0, mass: 1, radius: 0.5 },
        ],
        { restitution: e },
      );
      const e0 = pairKE(S.store);
      S.runUntil(4);
      expect(S.log.count).toBe(1);
      const ev = S.log.recent(0);
      const vnPost = (S.store.vx[0] - S.store.vx[1]) * ev.nx + (S.store.vy[0] - S.store.vy[1]) * ev.ny;
      expect(vnPost).toBeCloseTo(-e * ev.vn, 12);
      const mu = (2 * 1) / 3;
      const expectedLoss = (1 - e * e) * 0.5 * mu * ev.vn * ev.vn;
      expect(e0 - pairKE(S.store)).toBeCloseTo(expectedLoss, 12);
      expect(-ev.dKE).toBeCloseTo(expectedLoss, 12);
      expect(S.ledger.dissipatedExternal).toBeCloseTo(expectedLoss, 12);
      expect(Math.abs(S.energyResidual())).toBeLessThan(1e-13);
    }
  });

  it('e < 1 with the internal reservoir: lost kinetic energy appears as internal energy', () => {
    const S = sim(
      [
        { x: 5, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
        { x: 8, y: 10.3, vx: -1, vy: 0, mass: 1, radius: 0.5 },
      ],
      { restitution: 0.8, dissipationTarget: 'internal' },
    );
    const e0 = S.totalEnergy();
    S.runUntil(4);
    expect(S.log.count).toBe(1);
    expect(S.store.energy[0]).toBeGreaterThan(0);
    expect(S.store.energy[0]).toBeCloseTo(S.store.energy[1], 15);
    expect(S.totalEnergy()).toBeCloseTo(e0, 13);
    expect(S.ledger.dissipatedExternal).toBe(0);
  });

  it('is symmetric under label exchange and under mirror reflection', () => {
    const a = { x: 5, y: 10, vx: 1.1, vy: 0.3, mass: 1.5, radius: 0.6 };
    const b = { x: 8, y: 10.5, vx: -0.9, vy: -0.1, mass: 0.7, radius: 0.4 };
    const S1 = sim([a, b], { restitution: 0.9 });
    const S2 = sim([b, a], { restitution: 0.9 });
    // mirror y → 20 − y
    const mir = (p: ParticleInit): ParticleInit => ({ ...p, y: 20 - p.y, vy: -p.vy });
    const S3 = sim([mir(a), mir(b)], { restitution: 0.9 });
    for (const S of [S1, S2, S3]) S.runUntil(4);
    expect(S1.log.count).toBe(1);
    expect(S2.store.vx[1]).toBeCloseTo(S1.store.vx[0], 13);
    expect(S2.store.vy[1]).toBeCloseTo(S1.store.vy[0], 13);
    expect(S2.store.vx[0]).toBeCloseTo(S1.store.vx[1], 13);
    expect(S3.store.vx[0]).toBeCloseTo(S1.store.vx[0], 13);
    expect(S3.store.vy[0]).toBeCloseTo(-S1.store.vy[0], 13);
    expect(S3.store.y[1]).toBeCloseTo(20 - S1.store.y[1], 12);
  });

  it('ignores overlapping pairs that are already separating', () => {
    const S = sim([
      { x: 10, y: 10, vx: -1, vy: 0, mass: 1, radius: 0.5 },
      { x: 10.8, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
    ]);
    S.run(5);
    expect(S.log.count).toBe(0);
  });

  it('flags coincident centres as a failure instead of inventing a normal', () => {
    const S = sim([
      { x: 10, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
      { x: 10, y: 10, vx: 1, vy: 0, mass: 1, radius: 0.5 },
    ]);
    expect(S.flags.map((f) => f.code)).toContain('INITIAL_OVERLAP');
    S.run(20);
    expect(S.halted).toBe(true);
    expect(S.flags.map((f) => f.code)).toContain('DEGENERATE_CONTACT');
  });
});
