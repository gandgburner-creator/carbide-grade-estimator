import { describe, expect, it } from 'vitest';
import { MODEL_A, PULSE_REFERENCE, PressurePulseExperiment } from '../src/experiments/PressurePulseExperiment';

describe('pressure-pulse experiment (small)', () => {
  const small = {
    ...PULSE_REFERENCE,
    seeds: [1, 2, 3, 4],
    cases: [
      {
        ...PULSE_REFERENCE.cases[0],
        label: 'A small',
        model: MODEL_A,
        length: 200,
        height: 40,
        duration: 40,
        equilibrationTime: 15,
      },
    ],
  };
  const rec = new PressurePulseExperiment(small).runToCompletion();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (rec.results as any).cases[0];

  it('conserves energy exactly (rigid contact) through equilibration, insertion and pulse', () => {
    const byId = Object.fromEntries(rec.acceptance.map((a) => [a.id, a.status]));
    expect(byId['energy-accounting-rigid']).toBe('PASSED');
    expect(byId['numerical-safety']).toBe('PASSED');
  });

  it('tracks an outward-moving pulse with a positive, finite speed from particle data alone', () => {
    expect(c.track.usedSnapshots).toBeGreaterThan(5);
    expect(c.speed.mean).toBeGreaterThan(0.5);
    expect(c.speed.mean).toBeLessThan(6);
    // the tracked shifts increase with time
    const s = c.track.shifts;
    expect(s[s.length - 1]).toBeGreaterThan(s[0] + 10);
  });

  it('keeps benchmark sound speeds out of the measured results', () => {
    expect(JSON.stringify(rec.results)).not.toMatch(/hardDiskAdiabatic|idealGas/);
    expect(rec.benchmarks.perCase).toBeDefined();
  });
});
