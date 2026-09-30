import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';

describe('ParticleStore', () => {
  const make = () => {
    const s = new ParticleStore(4);
    s.add({ x: 0, y: 0, vx: 1, vy: 0, mass: 2, radius: 0.5 });
    s.add({ x: 1, y: 2, vx: -1, vy: 3, mass: 1, radius: 0.25, energy: 0.1 });
    return s;
  };

  it('computes kinetic energy, momentum, mass and area', () => {
    const s = make();
    expect(s.kineticEnergy()).toBeCloseTo(0.5 * 2 * 1 + 0.5 * 1 * 10, 14);
    expect(s.momentum()).toEqual({ x: 2 - 1, y: 3 });
    expect(s.totalMass()).toBe(3);
    expect(s.internalEnergy()).toBeCloseTo(0.1, 15);
    expect(s.particleArea()).toBeCloseTo(Math.PI * (0.25 + 0.0625), 14);
    expect(s.maxSpeed()).toBeCloseTo(Math.sqrt(10), 14);
  });

  it('rejects non-physical particles instead of repairing them', () => {
    const s = new ParticleStore(2);
    expect(() => s.add({ x: 0, y: 0, vx: 0, vy: 0, mass: -1, radius: 1 })).toThrow();
    expect(() => s.add({ x: 0, y: 0, vx: 0, vy: 0, mass: 1, radius: 0 })).toThrow();
    expect(() => s.add({ x: 0, y: 0, vx: 0, vy: 0, mass: Number.NaN, radius: 1 })).toThrow();
  });

  it('round-trips through a snapshot and clone', () => {
    const s = make();
    const t = ParticleStore.fromSnapshot(s.snapshot());
    expect(t.snapshot()).toEqual(s.snapshot());
    const c = s.clone();
    c.vx[0] = 99;
    expect(s.vx[0]).toBe(1);
  });
});
