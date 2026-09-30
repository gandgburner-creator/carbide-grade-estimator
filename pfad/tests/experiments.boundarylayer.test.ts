import { describe, expect, it } from 'vitest';
import { BOUNDARY_LAYER_REFERENCE, BoundaryLayerExperiment, columnMeasures } from '../src/experiments/BoundaryLayerExperiment';

describe('boundary-layer integral measures', () => {
  it('are zero for a uniform column and positive for a near-wall deficit', () => {
    const uniform = columnMeasures(Array(20).fill(1), 1, 20, 0.6, 0.9);
    expect(uniform.dstar).toBeCloseTo(0, 12);
    expect(uniform.theta).toBeCloseTo(0, 12);
    const u = Array.from({ length: 20 }, (_, j) => Math.min(1, (j + 0.5) / 5));
    const m = columnMeasures(u, 1, 20, 0.6, 0.9);
    expect(m.Ue).toBeCloseTo(1, 12);
    expect(m.dstar).toBeGreaterThan(2);
    expect(m.theta).toBeGreaterThan(0.5);
    expect(m.theta).toBeLessThan(m.dstar);
    expect(m.d90).toBeCloseTo(4.5, 6);
  });
});

describe('boundary-layer experiment (small)', () => {
  const rec = new BoundaryLayerExperiment({
    ...BOUNDARY_LAYER_REFERENCE,
    length: 120,
    height: 40,
    plateStart: 30,
    plateEnd: 110,
    seeds: [1, 2, 3],
    startupTime: 120,
    measurementTime: 120,
    cellX: 8,
    cellY: 2,
    wallBinWidth: 8,
  }).runToCompletion();
  const byId = Object.fromEntries(rec.acceptance.map((a) => [a.id, a.status]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = rec.results as any;

  it('closes the ledgers with open boundaries and a diffuse plate', () => {
    expect(byId['energy-accounting']).toBe('PASSED');
    expect(byId['momentum-accounting']).toBe('PASSED');
  });

  it('measures a near-wall deficit over the plate and drag on it, without imposing a profile', () => {
    const plate = r.stations.slice(1);
    expect(plate[plate.length - 1].deficitAtWall.mean).toBeGreaterThan(0.2);
    for (const s of plate) expect(s.wallShear.mean).toBeGreaterThan(0);
    expect(typeof r.determination).toBe('string');
  });
});
