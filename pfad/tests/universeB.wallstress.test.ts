import { describe, expect, it } from 'vitest';
import { occupancyStressMF, slabForce, wallMFStatistic } from '../src/universeB/WallStress';

describe('W-MF mean-field occupancy stress (amendment A1 §2.4)', () => {
  it('slab force is odd-free, positive (repulsive) and vanishes beyond the kernel support', () => {
    const h = 8;
    expect(slabForce(0, h, 10)).toBe(0);
    expect(slabForce(h, h, 10)).toBe(0);
    expect(slabForce(9, h, 10)).toBe(0);
    for (const s of [0.5, 2, 5, 7.5]) {
      expect(slabForce(s, h, 10)).toBeGreaterThan(0);
      expect(slabForce(-s, h, 10)).toBeCloseTo(slabForce(s, h, 10), 12);
    }
  });

  it('a uniform density gives the bulk closure ½ k_s a n²', () => {
    for (const [h, dy] of [[4, 0.25], [8, 0.25], [16, 0.5]]) {
      const ksA = 37.3;
      const n = 0.2546 / 4;
      const nb = Math.round((20 * h) / dy);
      const bins = { y: Array.from({ length: nb }, (_, i) => (i + 0.5) * dy), width: Array(nb).fill(dy), n: Array(nb).fill(n) };
      const p = occupancyStressMF(bins, [Math.round(nb / 2) * dy], h, ksA)[0];
      expect(p / (0.5 * ksA * n * n)).toBeCloseTo(1, 3);
    }
  });

  it('the stress vanishes at a plane with nothing below it and is independent of k_s in R', () => {
    const dy = 0.25;
    const bins = { y: [0.625, 0.875, 1.125, 1.375], width: [dy, dy, dy, dy], n: [1, 0.5, 0.3, 0.3] };
    expect(occupancyStressMF(bins, [0.5], 4, 10)[0]).toBe(0);
    const planes = Array.from({ length: 40 }, (_, p) => 0.5 + p * dy);
    const pMF = planes.map((y) => 1 - Math.exp(-y / 2));
    const same = wallMFStatistic(planes, pMF, pMF, dy, 0.5, 3.5, 6, 10);
    expect(same.R).toBeCloseTo(1, 12);
    const scaled = wallMFStatistic(planes, pMF.map((v) => 7 * v), pMF, dy, 0.5, 3.5, 6, 10);
    expect(scaled.R).toBeCloseTo(1, 12);
    // a measured deficit 20 % deeper than the mean field gives R ≈ 1.2
    const core = 1;
    const deeper = pMF.map((v) => core - 1.2 * (core - v));
    const r = wallMFStatistic(planes, deeper, pMF, dy, 0.5, 3.5, 6, 10);
    expect(r.R).toBeGreaterThan(1.15);
  });
});
