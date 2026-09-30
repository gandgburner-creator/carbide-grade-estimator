import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';

describe('Rng (sfc32 via splitmix32)', () => {
  it('is deterministic for a fixed (seed, stream)', () => {
    const a = new Rng(7, 1);
    const b = new Rng(7, 1);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('gives different sequences for different seeds and streams', () => {
    const base = new Rng(7, 1).nextU32();
    expect(new Rng(8, 1).nextU32()).not.toBe(base);
    expect(new Rng(7, 2).nextU32()).not.toBe(base);
  });

  it('is replayable from saved state', () => {
    const r = new Rng(42);
    for (let i = 0; i < 100; i++) r.next();
    const state = r.getState();
    const expected = [r.next(), r.next(), r.gaussian()];
    const r2 = new Rng(0);
    r2.setState(state);
    expect([r2.next(), r2.next(), r2.gaussian()]).toEqual(expected);
  });

  it('produces uniform [0,1) with correct first two moments', () => {
    const r = new Rng(1);
    const n = 200_000;
    let s = 0;
    let s2 = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const u = r.next();
      s += u;
      s2 += u * u;
      if (u < min) min = u;
      if (u > max) max = u;
    }
    const mean = s / n;
    const variance = s2 / n - mean * mean;
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    // 5-sigma bounds: sigma(mean) = sqrt(1/12/n)
    expect(Math.abs(mean - 0.5)).toBeLessThan(5 * Math.sqrt(1 / 12 / n));
    expect(Math.abs(variance - 1 / 12)).toBeLessThan(0.002);
  });

  it('produces standard normal variates (mean, variance, kurtosis)', () => {
    const r = new Rng(3);
    const n = 200_000;
    let s = 0;
    let s2 = 0;
    let s4 = 0;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      s += g;
      s2 += g * g;
      s4 += g * g * g * g;
    }
    const mean = s / n;
    const variance = s2 / n - mean * mean;
    const kurtosis = s4 / n / (variance * variance);
    expect(Math.abs(mean)).toBeLessThan(5 / Math.sqrt(n));
    expect(Math.abs(variance - 1)).toBeLessThan(0.02);
    expect(Math.abs(kurtosis - 3)).toBeLessThan(0.08);
  });
});
