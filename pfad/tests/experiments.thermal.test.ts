import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { THERMAL_REFERENCE, ThermalExperiment, relaxationCollisions } from '../src/experiments/ThermalExperiment';
import { velocityStats } from '../src/measurements/ThermalStatistics';

describe('velocity statistics', () => {
  it('recovers kT, isotropy, kurtosis 3 and a2 ≈ 0 for sampled 2D Maxwellian velocities', () => {
    const rng = new Rng(5);
    const s = new ParticleStore(40000);
    for (let i = 0; i < 40000; i++) {
      s.add({ x: 0, y: 0, vx: 0.3 + Math.sqrt(2) * rng.gaussian(), vy: -0.1 + Math.sqrt(2) * rng.gaussian(), mass: 1, radius: 0.5 });
    }
    const v = velocityStats(s);
    expect(v.ux).toBeCloseTo(0.3, 1);
    expect(v.kT).toBeCloseTo(2, 1);
    expect(Math.abs(v.anisotropy)).toBeLessThan(0.02);
    expect(v.kurtosis).toBeCloseTo(3, 1);
    expect(Math.abs(v.a2)).toBeLessThan(0.03);
  });

  it('identifies equal-speed velocities as far from Maxwellian (a2 = −1/2)', () => {
    const s = new ParticleStore(1000);
    for (let i = 0; i < 1000; i++) {
      const a = (2 * Math.PI * i) / 1000;
      s.add({ x: 0, y: 0, vx: Math.cos(a), vy: Math.sin(a), mass: 1, radius: 0.5 });
    }
    expect(velocityStats(s).a2).toBeCloseTo(-0.5, 6);
  });

  it('relaxation metric finds the end of a decaying transient', () => {
    const rng = new Rng(1);
    const c = Array.from({ length: 400 }, (_, i) => i * 0.1);
    const x = c.map((ci) => -0.5 * Math.exp(-ci / 2) + 0.005 * rng.gaussian());
    const r = relaxationCollisions(c, x);
    expect(r.settled).toBe(true);
    expect(r.relaxationCollisions).toBeGreaterThan(3);
    expect(r.relaxationCollisions).toBeLessThan(15);
  });
});

describe('thermal experiment (small)', () => {
  const rec = new ThermalExperiment({
    ...THERMAL_REFERENCE,
    count: 300,
    seeds: [1, 2],
    temperatures: [0.5, 2],
    areaFractions: [0.05],
    distributions: ['maxwell', 'two-beam'],
    measurementCollisions: 15,
    relaxationCollisions: 20,
  }).runToCompletion();
  const byId = Object.fromEntries(rec.acceptance.map((c) => [c.id, c.status]));

  it('confirms the rigid-disk model has no hidden energy scale (exact kT rescaling)', () => {
    expect(byId['no-hidden-energy-scale']).toBe('PASSED');
    expect(byId['temperature-scaling']).toBe('PASSED');
  });

  it('relaxes a two-beam start to the same state as a Maxwellian start', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (rec.results.distributionDependence as any).rows;
    const beam = rows.find((r: { distribution: string }) => r.distribution === 'two-beam');
    expect(beam.initial.anisotropy).toBeGreaterThan(0.8);
    expect(Math.abs(beam.equilibrium_a2.mean)).toBeLessThan(0.1);
    expect(byId['equilibrium-independent-of-initial-distribution']).toBe('PASSED');
  });
});
