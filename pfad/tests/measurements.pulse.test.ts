import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import { ensembleProfiles, jackknife, profileNoise, trackPulse } from '../src/measurements/PulseAnalysis';

/** Synthetic outward half-domain profiles: a Gaussian leaving x = 0 at speed c, decaying and spreading. */
function synth(c: number, seeds: number, noise: number, rng: Rng) {
  const bw = 2;
  const nb = 100; // half-domain of length 200
  const times = Array.from({ length: 60 }, (_, k) => k * 2);
  const perSeed = Array.from({ length: seeds }, () =>
    times.map((t) => {
      const x0 = 5 + c * t;
      const w2 = 36 + 0.8 * t;
      const A = Math.exp(-0.004 * c * t);
      return Array.from({ length: nb }, (_, b) => {
        const x = (b + 0.5) * bw;
        return A * Math.exp(-((x - x0) ** 2) / (2 * w2)) + noise * rng.gaussian();
      });
    }),
  );
  return { perSeed, times, bw };
}

describe('pulse tracking', () => {
  it('recovers speed, attenuation and spreading of a synthetic pulse', () => {
    const rng = new Rng(4);
    const { perSeed, times, bw } = synth(1.3, 12, 0.3, rng);
    const tr = trackPulse(ensembleProfiles(perSeed), times, bw, 12, 190, 16, 0.3 / Math.sqrt(12));
    expect(tr.valid).toBe(true);
    expect(tr.speed).toBeCloseTo(1.3, 1);
    expect(tr.attenuationPerLength).toBeGreaterThan(0.001);
    expect(tr.attenuationPerLength).toBeLessThan(0.008);
    expect(tr.widthGrowthRate).toBeGreaterThan(0);
    const jk = jackknife(perSeed, (p) => trackPulse(p, times, bw, 12, 190, 16, 0.3 / Math.sqrt(11)).speed);
    expect(jk.se).toBeGreaterThan(0);
    expect(Math.abs(jk.value - 1.3)).toBeLessThan(5 * jk.se + 0.02);
  });

  it('does not invent a speed when there is no pulse', () => {
    const rng = new Rng(5);
    const times = Array.from({ length: 40 }, (_, k) => k);
    const profiles = times.map(() => Array.from({ length: 80 }, () => rng.gaussian()));
    const tr = trackPulse(profiles, times, 2, 12, 150, 16, 1);
    expect(tr.valid).toBe(false);
  });
});

/** erf (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7) */
const erf = (x: number) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};

describe('pulse tracking of a released slab (linear acoustics)', () => {
  it('is unbiased for slab widths 10–40: the two halves overlapping at the start do not shift the speed', () => {
    // outward momentum density j = (c/2)[f(x − ct) − f(x + ct)] of a top-hat slab f of width w,
    // diffused with variance 2Dt, bin-averaged, with noise — the geometry of the pulse experiment
    const c = 2.2;
    const bin = 4;
    const nb = 50;
    const D = 0.4;
    const hat = (x: number, x0: number, w: number, s2: number) => {
      const sq = Math.sqrt(2 * Math.max(s2, 1e-12));
      return 0.5 * (erf((x - x0 + w / 2) / sq) - erf((x - x0 - w / 2) / sq));
    };
    for (const w of [10, 20, 40]) {
      const speeds: number[] = [];
      for (let seed = 1; seed <= 6; seed++) {
        const rng = new Rng(100 + seed);
        const times = Array.from({ length: 101 }, (_, k) => k);
        const prof = times.map((t) =>
          Array.from({ length: nb }, (_, b) => {
            let v = 0;
            for (let q = 0; q < 8; q++) {
              const x = b * bin + ((q + 0.5) * bin) / 8;
              v += (c / 2) * (hat(x, c * t, w, 2 * D * t) - hat(x, -c * t, w, 2 * D * t));
            }
            return (v / 8) * 0.05 + 0.004 * rng.gaussian();
          }),
        );
        const tr = trackPulse(prof, times, bin, w / 2 + bin, 200 - bin, Math.max(w, 3 * bin), profileNoise(prof, bin, w + 2 * bin));
        if (Number.isFinite(tr.speed)) speeds.push(tr.speed);
      }
      expect(speeds.length).toBeGreaterThanOrEqual(5);
      const m = speeds.reduce((a, v) => a + v, 0) / speeds.length;
      expect(Math.abs(m / c - 1)).toBeLessThan(0.02);
    }
  });
});

