import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';
import { Simulation } from '../src/core/Simulation';

const box = { xmin: 0, xmax: 10, ymin: 0, ymax: 10, periodicX: false, periodicY: false };
const specular = (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, accommodation: 0 }));

describe('specular wall reflection', () => {
  it('reflects at the exact contact instant and records impulse 2m|v_n|', () => {
    const store = new ParticleStore(1);
    store.add({ x: 5, y: 5, vx: 0.7, vy: -0.3, mass: 2, radius: 0.5 });
    const S = new Simulation(
      {
        domain: box,
        walls: specular,
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'fixed', dt: 0.37 },
        seed: 1,
      },
      store,
    );
    // right wall contact: x = 9.5 at t = 4.5/0.7 ≈ 6.4286; bottom contact: y = 0.5 at t = 15
    S.run(20); // t = 7.4
    const t = S.time;
    const tHit = 4.5 / 0.7;
    expect(store.x[0]).toBeCloseTo(9.5 - 0.7 * (t - tHit), 12);
    expect(store.y[0]).toBeCloseTo(5 - 0.3 * t, 12);
    expect(store.vx[0]).toBeCloseTo(-0.7, 14);
    const right = S.walls[1].totals();
    expect(right.hits).toBe(1);
    expect(right.normalImpulse).toBeCloseTo(2 * 2 * 0.7, 14);
    expect(right.tangentialImpulse).toBeCloseTo(0, 14);
    expect(right.energyIn).toBeCloseTo(0, 14);
    expect(S.ledger.wallImpulseX).toBeCloseTo(-2 * 2 * 0.7, 14);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-14);
  });

  it('handles a corner (two walls in one step)', () => {
    const store = new ParticleStore(1);
    store.add({ x: 9.4, y: 9.4, vx: 1, vy: 1, mass: 1, radius: 0.5 });
    const S = new Simulation(
      {
        domain: box,
        walls: specular,
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'fixed', dt: 0.3 },
        seed: 1,
      },
      store,
    );
    S.run(1);
    expect(store.vx[0]).toBe(-1);
    expect(store.vy[0]).toBe(-1);
    expect(store.x[0]).toBeCloseTo(9.5 - 0.2, 12);
    expect(store.y[0]).toBeCloseTo(9.5 - 0.2, 12);
    expect(S.halted).toBe(false);
  });
});
