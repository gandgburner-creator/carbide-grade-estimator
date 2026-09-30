import { describe, expect, it } from 'vitest';
import { compareMetrics } from '../src/experiments/ABTestExperiment';

describe('A/B comparison', () => {
  it('reports B − A with the combined standard error', () => {
    const [c] = compareMetrics(
      [{ name: 'P', estimate: { mean: 1.122, se: 0.003 } }],
      [{ name: 'P', estimate: { mean: 1.1075, se: 0.004 } }],
    );
    expect(c.difference).toBeCloseTo(1.1075 - 1.122, 12);
    expect(c.se).toBeCloseTo(0.005, 12);
    expect(c.z).toBeCloseTo((1.1075 - 1.122) / 0.005, 9);
    expect(c.verdict).toBe('marginal (2 < |z| < 3)'); // z = −2.9
  });

  it('pairs metrics by name and leaves unmatched ones uncompared', () => {
    const out = compareMetrics([{ name: 'x', estimate: { mean: 1, se: 0.1 } }], [{ name: 'y', estimate: { mean: 1, se: 0.1 } }]);
    expect(out[0].difference).toBeNull();
  });
});
