import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import { ensembleProfiles, jackknife, trackPulse } from '../src/measurements/PulseAnalysis';

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
