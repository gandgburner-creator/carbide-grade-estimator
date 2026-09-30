import { describe, expect, it } from 'vitest';
import { Domain } from '../src/core/Domain';
import { ParticleStore } from '../src/core/ParticleStore';
import { ProfileSampler } from '../src/measurements/ProfileSampler';
import { WALL_ACCOMMODATION_REFERENCE, WallAccommodationExperiment } from '../src/experiments/WallAccommodationExperiment';

describe('profile sampler', () => {
  it('recovers an imposed linear velocity profile and uniform density', () => {
    const d = new Domain({ xmin: 0, xmax: 10, ymin: 0, ymax: 10, periodicX: true, periodicY: false });
    const s = new ParticleStore(10000);
    for (let i = 0; i < 10000; i++) {
      const y = ((i % 100) + 0.5) / 10;
      s.add({ x: Math.floor(i / 100) / 10, y, vx: 0.2 * y, vy: 0, mass: 1, radius: 0.01 });
    }
    const p = new ProfileSampler(d, 5);
    for (let k = 0; k < 8; k++) p.sample(s);
    const r = p.result(4);
    r.centers.forEach((y, b) => {
      expect(r.ux[b].mean).toBeCloseTo(0.2 * y, 10);
      expect(r.numberDensity[b].mean).toBeCloseTo(100, 8);
    });
  });
});

describe('wall-accommodation experiment (small)', () => {
  const rec = new WallAccommodationExperiment({
    ...WALL_ACCOMMODATION_REFERENCE,
    count: 200,
    height: 12,
    accommodations: [0, 1],
    seeds: [1, 2, 3],
    thermalEquilibrationCollisions: 30,
    thermalCollisions: 20,
    shearEquilibrationCollisions: 30,
    shearCollisions: 20,
  }).runToCompletion();
  const byId = Object.fromEntries(rec.acceptance.map((c) => [c.id, c.status]));

  it('specular walls exchange neither energy nor tangential momentum', () => {
    expect(byId['specular-exchanges-no-energy']).toBe('PASSED');
    expect(byId['specular-transfers-no-shear']).toBe('PASSED');
  });

  it('closes the energy and momentum ledgers with diffuse, moving walls', () => {
    expect(byId['energy-accounting']).toBe('PASSED');
    expect(byId['momentum-accounting']).toBe('PASSED');
  });

  it('measures accommodation coefficients equal to Aw for a fully diffuse wall', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (rec.results.thermal as any[]).find((x) => x.Aw === 1);
    expect(t.realisedDiffuseFraction.mean).toBe(1);
    expect(Math.abs(t.alphaE_hotWall.mean - 1)).toBeLessThan(0.1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (rec.results.shear as any[]).find((x) => x.Aw === 1);
    expect(s.bottomShear.mean).toBeGreaterThan(0); // the gas drags the resting wall forward
    expect(s.topShear.mean).toBeLessThan(0); // and holds the moving wall back
  });
});
