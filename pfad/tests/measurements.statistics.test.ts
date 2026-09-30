import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import {
  blockAverage,
  chi2UpperP,
  consistency,
  independentEstimate,
  linearRegression,
  normalCdf,
  tCritical95,
} from '../src/measurements/Statistics';

describe('Statistics', () => {
  it('t critical values', () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 3);
    expect(tCritical95(10)).toBeCloseTo(2.228, 3);
    expect(tCritical95(40)).toBeCloseTo(2.021, 2);
    expect(tCritical95(1e6)).toBeCloseTo(1.96, 3);
  });

  it('normal CDF and chi-square tail', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(chi2UpperP(3.84, 1)).toBeGreaterThan(0.03);
    expect(chi2UpperP(3.84, 1)).toBeLessThan(0.07);
    expect(chi2UpperP(10, 10)).toBeCloseTo(0.44, 1);
  });

  it('independent estimate covers the true mean ~95% of the time', () => {
    const rng = new Rng(12);
    let covered = 0;
    const trials = 400;
    for (let t = 0; t < trials; t++) {
      const xs = Array.from({ length: 10 }, () => 3 + rng.gaussian());
      const e = independentEstimate(xs);
      if (e.ci95[0] <= 3 && 3 <= e.ci95[1]) covered++;
    }
    expect(covered / trials).toBeGreaterThan(0.92);
    expect(covered / trials).toBeLessThan(0.98);
  });

  it('block averaging recovers the correlated standard error of an AR(1) series', () => {
    const rho = 0.9;
    const n = 1 << 16;
    const rng = new Rng(4);
    const xs = new Float64Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = rho * v + Math.sqrt(1 - rho * rho) * rng.gaussian();
      xs[i] = v;
    }
    const naive = 1 / Math.sqrt(n);
    const trueSe = naive * Math.sqrt((1 + rho) / (1 - rho)); // ≈ 4.36 × naive
    const b = blockAverage(xs);
    expect(b.reliable).toBe(true);
    expect(b.se / trueSe).toBeGreaterThan(0.75);
    expect(b.se / trueSe).toBeLessThan(1.35);
    expect(b.nIndependent).toBeLessThan(n / 10);
  });

  it('linear regression recovers slope and its uncertainty', () => {
    const rng = new Rng(8);
    const x = Array.from({ length: 200 }, (_, i) => i / 10);
    const y = x.map((xi) => 1.5 - 0.3 * xi + 0.1 * rng.gaussian());
    const r = linearRegression(x, y);
    expect(Math.abs(r.slope + 0.3)).toBeLessThan(4 * r.seSlope);
    expect(Math.abs(r.intercept - 1.5)).toBeLessThan(4 * r.seIntercept);
    expect(r.residualSd).toBeCloseTo(0.1, 1);
  });

  it('consistency test separates agreeing from disagreeing measurements', () => {
    const ok = consistency([1.0, 1.01, 0.99, 1.005], [0.01, 0.01, 0.01, 0.01]);
    expect(ok.pValue).toBeGreaterThan(0.1);
    const bad = consistency([1.0, 1.1, 0.99, 1.005], [0.01, 0.01, 0.01, 0.01]);
    expect(bad.pValue).toBeLessThan(1e-3);
  });
});

describe('isotonic regression', () => {
  it('returns a non-increasing fit and leaves monotone data unchanged', async () => {
    const { isotonicNonIncreasing } = await import('../src/measurements/Statistics');
    expect(isotonicNonIncreasing([5, 4, 3, 1])).toEqual([5, 4, 3, 1]);
    const f = isotonicNonIncreasing([5, 3, 4, 1, 2]);
    expect(f).toEqual([5, 3.5, 3.5, 1.5, 1.5]);
    const rng = new Rng(2);
    const y = Array.from({ length: 400 }, (_, i) => Math.exp(-i / 100) + 0.2 * rng.gaussian());
    const g = isotonicNonIncreasing(y);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThanOrEqual(g[i - 1] + 1e-12);
    // crossing of 0.5 near i = 100 ln 2 ≈ 69
    const k = g.findIndex((v) => v < 0.5);
    expect(Math.abs(k - 69)).toBeLessThan(20);
  });
});

describe('distribution functions and ANOVA', () => {
  it('incomplete beta / t / F match reference values', async () => {
    const S = await import('../src/measurements/Statistics');
    expect(S.incompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(S.incompleteBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    expect(S.tTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(S.tTwoSidedP(12.706, 1)).toBeCloseTo(0.05, 3);
    expect(S.fUpperP(3.49, 3, 20)).toBeCloseTo(0.035, 2); // F(3,20) 0.965 quantile ≈ 3.49 → p ≈ 0.035
    expect(S.fUpperP(4.35, 1, 20)).toBeCloseTo(0.05, 2);
  });

  it('ANOVA accepts equal means and rejects shifted ones', async () => {
    const { oneWayAnova } = await import('../src/measurements/Statistics');
    const rng = new Rng(9);
    const same = [0, 1, 2, 3].map(() => Array.from({ length: 5 }, () => rng.gaussian()));
    let accept = 0;
    for (let t = 0; t < 200; t++) {
      const g = [0, 1, 2, 3].map(() => Array.from({ length: 5 }, () => rng.gaussian()));
      if (oneWayAnova(g).pValue > 0.05) accept++;
    }
    expect(accept / 200).toBeGreaterThan(0.9);
    expect(oneWayAnova(same).df2).toBe(16);
    const shifted = [0, 1, 2, 3].map((k) => Array.from({ length: 5 }, () => rng.gaussian() + (k === 3 ? 3 : 0)));
    expect(oneWayAnova(shifted).pValue).toBeLessThan(1e-3);
  });
});
