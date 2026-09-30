import { describe, expect, it } from 'vitest';
import { COUETTE_REFERENCE, CouetteExperiment } from '../src/experiments/CouetteExperiment';

describe('Couette experiment (small)', () => {
  const rec = new CouetteExperiment({
    ...COUETTE_REFERENCE,
    seeds: [1, 2, 3],
    profileBins: 10,
    cases: [{ ...COUETTE_REFERENCE.cases[0], label: 'small', count: 300, height: 16, equilibrationCollisions: 60, measurementCollisions: 80 }],
  }).runToCompletion();
  const byId = Object.fromEntries(rec.acceptance.map((a) => [a.id, a.status]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (rec.results as any).cases[0];

  it('closes energy and momentum ledgers with a moving diffuse wall', () => {
    expect(byId['energy-accounting']).toBe('PASSED');
    expect(byId['momentum-accounting']).toBe('PASSED');
  });

  it('develops a shear flow: positive gradient, stress of the right sign, finite μ_eff', () => {
    expect(c.gradient.mean).toBeGreaterThan(0);
    expect(c.shearStress.mean).toBeGreaterThan(0);
    expect(c.muEff.mean).toBeGreaterThan(0);
    expect(c.muEff.mean).toBeLessThan(5);
    expect(c.profile.ux[c.profile.ux.length - 1]).toBeGreaterThan(c.profile.ux[0]);
  });

  it('reports Re from the measured viscosity, and a measured Knudsen number', () => {
    expect(c.reynolds.simulation).toBeGreaterThan(0);
    expect(c.knudsen).toBeGreaterThan(0);
    expect(rec.reynolds.simulation).toBeCloseTo(c.reynolds.simulation, 10);
  });
});
