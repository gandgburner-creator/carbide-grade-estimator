import { describe, expect, it } from 'vitest';
import type { ExperimentRecord } from '../src/experiments/Experiment';
import { runFromRecord } from '../src/experiments/registry';
import { STATIC_BOX_REFERENCE, StaticBoxExperiment, type StaticBoxParams } from '../src/experiments/StaticBoxExperiment';
import { judgeConvergence } from '../src/validation/Convergence';

const small: StaticBoxParams = {
  ...STATIC_BOX_REFERENCE,
  count: 300,
  restitutions: [1, 0.9],
  seeds: [3],
  measurementCollisions: 20,
  decayMaxCollisions: 30,
  decayStopKineticFraction: 0.2,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R = (rec: ExperimentRecord) => rec.results as any;

describe('static-box experiment (small configuration)', () => {
  const rec = new StaticBoxExperiment(small).runToCompletion();

  it('measures pressure from wall impulses with an uncertainty and conserves energy/momentum', () => {
    const el = R(rec).elastic;
    expect(el.measuredPressure.mean).toBeGreaterThan(0);
    expect(el.measuredPressure.se).toBeGreaterThan(0);
    expect(el.measuredPressure.ci95[0]).toBeLessThan(el.measuredPressure.mean);
    const byId = Object.fromEntries(rec.acceptance.map((c) => [c.id, c.status]));
    expect(byId['energy-accounting']).toBe('PASSED');
    expect(byId['momentum-accounting']).toBe('PASSED');
    expect(byId['numerical-safety']).toBe('PASSED');
    expect(byId['isotropy']).toBe('PASSED');
  });

  it('keeps benchmarks in their own section, separate from measured results', () => {
    expect(rec.benchmarks.pressure).toBeDefined();
    expect(JSON.stringify(rec.results)).not.toMatch(/henderson|haff|enskog/i);
  });

  it('records the inelastic decay and its energy bookkeeping', () => {
    const d = R(rec).inelasticDecay['e=0.9'];
    expect(d.perSeed[0].referenceSource).toBe('elastic run, same seed');
    expect(d.perSeed[0].finalKineticFraction).toBeLessThan(0.5);
    expect(d.collisionsPerParticleToHalveKT).not.toBeNull();
  });

  it('is exactly reproducible from its saved JSON configuration', () => {
    const saved = JSON.parse(JSON.stringify(rec)) as ExperimentRecord;
    const again = runFromRecord(saved);
    expect(R(again).runs.map((r: { series: unknown }) => r.series)).toEqual(
      R(rec).runs.map((r: { series: unknown }) => r.series),
    );
    expect(again.modelVersion).toBe(rec.modelVersion);
  });
});

describe('convergence verdicts', () => {
  const est = (mean: number, se: number) => ({ mean, se, ci95: [mean - 2 * se, mean + 2 * se] as [number, number], n: 5 });
  const cmp = (hi: ReturnType<typeof est>, lo: ReturnType<typeof est>) => {
    const d = hi.mean - lo.mean;
    const se = Math.hypot(hi.se, lo.se);
    return { difference: d, se, z: d / se, relative: d / hi.mean, resolution: (2 * se) / hi.mean };
  };
  it('flags a significant change larger than tolerance as NOT CONVERGED', () => {
    expect(judgeConvergence(cmp(est(1.1, 0.002), est(1.05, 0.002)), 0.01).status).toBe('NOT CONVERGED');
  });
  it('refuses to call a noisy study converged', () => {
    expect(judgeConvergence(cmp(est(1.1, 0.03), est(1.1, 0.03)), 0.01).status).toBe('INCONCLUSIVE');
  });
  it('passes a precise, unchanged result', () => {
    expect(judgeConvergence(cmp(est(1.1, 0.002), est(1.101, 0.002)), 0.01).status).toBe('PASSED');
  });
});

describe('timestep and resolution convergence (small)', () => {
  const Z = (p: Partial<StaticBoxParams>) =>
    R(
      new StaticBoxExperiment({
        ...small,
        restitutions: [1],
        seeds: [1, 2, 3],
        measurementCollisions: 40,
        ...p,
      }).runToCompletion(),
    ).elastic.dimensionlessPressure;

  it('elastic pressure does not change significantly when the timestep is quartered', () => {
    const coarse = Z({ timestep: { kind: 'adaptive', courant: 0.1, dtMax: 1, dtMin: 1e-7 } });
    const fine = Z({ timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 } });
    expect(Math.abs(coarse.mean - fine.mean)).toBeLessThan(3 * Math.hypot(coarse.se, fine.se));
  });

  it('dimensionless pressure at N = 300 and N = 1200 agree within 3σ + 3 % (finite-size allowance)', () => {
    const a = Z({ count: 300 });
    const b = Z({ count: 1200 });
    expect(Math.abs(a.mean - b.mean)).toBeLessThan(3 * Math.hypot(a.se, b.se) + 0.03 * b.mean);
  });
});
