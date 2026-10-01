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
    temperatures: [0.5, 1, 2],
    areaFractions: [0.05],
    distributions: ['maxwell', 'two-beam'],
    measurementCollisions: 15,
    relaxationCollisions: 20,
  }).runToCompletion();
  const byId = Object.fromEntries(rec.acceptance.map((c) => [c.id, c.status]));

  it('temperature classes: kT differing by a power of 4 are the same trajectory; others are independent', async () => {
    const { temperatureClass } = await import('../src/experiments/ThermalExperiment');
    expect(temperatureClass(0.25)).toBe(temperatureClass(4));
    expect(temperatureClass(0.5)).toBe(temperatureClass(2));
    expect(temperatureClass(1)).not.toBe(temperatureClass(2));
  });

  it('confirms the rigid-disk model has no hidden energy scale (exact kT rescaling)', () => {
    expect(byId['no-hidden-energy-scale']).toBe('PASSED');
    expect(byId['E3-temperature-scaling']).toBe('PASSED');
  });

  it('relaxes a two-beam start to the same state as a Maxwellian start', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (rec.results.distributionDependence as any).rows;
    const beam = rows.find((r: { distribution: string }) => r.distribution === 'two-beam');
    expect(beam.initial.anisotropy).toBeGreaterThan(0.8);
    expect(Math.abs(beam.equilibrium_a2_pooled.mean)).toBeLessThan(0.1);
    expect(byId['E3-independent-of-initial-distribution']).toBe('PASSED');
  });

  it('judges relaxation with E6′ (2 seeds: not evaluable) and keeps the retired E6 only as a diagnostic', () => {
    expect(byId['E6prime-relaxation-vs-control']).toBe('INCONCLUSIVE');
    expect(byId['E6-relaxation-settled']).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rec.results.distributionDependence as any).retiredE6.note).toContain('Diagnostic only');
  });
});

describe('E6′: relaxation against the equilibrium-start control', () => {
  // synthetic relaxation runs: AR(1) noise around 0, plus a decaying transient for non-Maxwell starts
  const series = (rng: Rng, n: number, x0: number, tau: number, offset = 0) => {
    const c = Array.from({ length: n }, (_, i) => 0.1 * (i + 1));
    let e = 0;
    const x = c.map((ci) => {
      e = 0.9 * e + 0.02 * Math.sqrt(1 - 0.81) * rng.gaussian();
      return x0 * Math.exp(-ci / tau) + offset + e;
    });
    return { c, x };
  };
  const make = (seed: number, opts: { offset?: number; seeds?: number; tau?: number } = {}) => {
    const rng = new Rng(seed);
    const runs = [];
    for (const d of ['maxwell', 'uniform-speed', 'two-beam'] as const) {
      for (let s = 0; s < (opts.seeds ?? 10); s++) {
        const a2 = series(rng, 790, d === 'maxwell' ? 0 : -0.5, opts.tau ?? 3, d === 'two-beam' ? (opts.offset ?? 0) : 0);
        const an = series(rng, 790, d === 'two-beam' ? 0.9 : 0, opts.tau ?? 1);
        runs.push({ distribution: d, seed: s, series: { c: a2.c, a2: a2.x, anisotropy: an.x } });
      }
    }
    return runs;
  };

  it('splits the late half into equal blocks and drops at most blocks − 1 final windows', async () => {
    const { lateHalfBlocks } = await import('../src/experiments/ThermalEquilibriumAnalysis');
    expect(lateHalfBlocks(790, 4)).toEqual([{ from: 395, to: 493 }, { from: 493, to: 591 }, { from: 591, to: 689 }, { from: 689, to: 787 }]);
    expect(lateHalfBlocks(791, 4)[3]).toEqual({ from: 692, to: 791 });
  });

  it('passes relaxed starts, fails a start that stays away from equilibrium, and needs ≥ 3 seeds', async () => {
    const { relaxationVersusControl } = await import('../src/experiments/ThermalEquilibriumAnalysis');
    const ok = relaxationVersusControl(make(3));
    expect(ok.results.m).toBe(16);
    expect(ok.check.status).toBe('PASSED');
    const stuck = relaxationVersusControl(make(4, { offset: 0.05 }));
    expect(stuck.check.status).toBe('FAILED');
    const slow = relaxationVersusControl(make(5, { tau: 60 }));
    expect(slow.check.status).not.toBe('PASSED');
    const few = relaxationVersusControl(make(6, { seeds: 2 }));
    expect(few.check.status).toBe('INCONCLUSIVE');
    expect(few.check.measured).toContain('not evaluable');
  });
});
