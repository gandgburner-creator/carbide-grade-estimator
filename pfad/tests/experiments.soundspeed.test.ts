import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import { stackArrivals, slantStack } from '../src/measurements/ArrivalAnalysis';
import { MODEL_A, PULSE_REFERENCE, PulseRun } from '../src/experiments/PressurePulseExperiment';
import { equivalence, primaryAnalysis, weightedPoly } from '../src/experiments/SoundSpeedAnalysis';
import { SoundRun, type SoundCase, type SoundParamsBase } from '../src/experiments/SoundSpeedRun';
import { SOUND_VALIDATION } from '../src/experiments/SoundSpeedExperiment';

const small: SoundCase = {
  ...PULSE_REFERENCE.cases[0],
  label: 'small',
  role: 'amplitude',
  model: MODEL_A,
  length: 100,
  height: 20,
  duration: 8,
  equilibrationTime: 4,
  amplitude: 0.3,
  slabWidth: 10,
  snapshotInterval: 0.5,
  binWidth: 2,
};
const params: SoundParamsBase = {
  ...PULSE_REFERENCE,
  seeds: [3],
  cases: [small],
  measurement: { probes: [12, 20, 28], widths: [4, 2], binWidth: 2, snapshotInterval: 0.5, fieldBin: 4, fieldEvery: 2 },
};

describe('SoundRun', () => {
  it('has exactly the physics of PulseRun (bit-identical particle state), measurement only differs', () => {
    const a = new PulseRun(params, 0, 3);
    const b = new SoundRun(params, 0, 3);
    while (!a.done) a.advance(5000);
    while (!b.done) b.advance(5000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sa = (a as any).store;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (b as any).store;
    expect(sb.count).toBe(sa.count);
    for (let i = 0; i < sa.count; i++) {
      expect(sb.x[i]).toBe(sa.x[i]);
      expect(sb.vx[i]).toBe(sa.vx[i]);
      expect(sb.vy[i]).toBe(sa.vy[i]);
    }
    const r = b.result();
    expect(r.sound.times.length).toBe(17);
    // fixed sampling grid: samples within one step of k·Δt
    expect(r.sound.gridDeviationMax).toBeLessThan(0.05 + 1e-9);
    expect(r.sound.realizedAmplitude).toBeCloseTo(0.3, 1);
    expect(r.sound.j[0].length).toBe(3 * 17);
  });

  it('folds the outward momentum density with the right sign on both sides', () => {
    const kick: SoundParamsBase = { ...params, cases: [{ ...small, perturbation: 'kick', amplitude: 0.5, slabWidth: 20 }] };
    const r = new SoundRun(kick, 0, 3);
    while (!r.done) r.advance(5000);
    const s = r.result().sound;
    // at t = 0 the slab moves outward on both sides: positive folded j near the source, both sides
    const T = s.times.length;
    expect(s.jR[0 * T]).toBeGreaterThan(0);
    expect(s.jL[0 * T]).toBeGreaterThan(0);
  });
});

describe('stacked-template cross-correlation', () => {
  const times = Array.from({ length: 241 }, (_, k) => 0.5 * k);
  const d = Array.from({ length: 17 }, (_, k) => 30 + 10 * k);
  const g = (t: number, t0: number, s: number) => Math.exp(-((t - t0) ** 2) / (2 * s * s));

  it('recovers the speed of a noisy outward pulse and finds no inward wave', () => {
    const rng = new Rng(4);
    const c = 2.2;
    const S = 12;
    const per = d.map((x) => Array.from({ length: S }, () => times.map((t) => 0.02 * g(t, x / c, 3 + 0.02 * x) + 0.01 * rng.gaussian())));
    const opt = { sMin: 0.02, sMax: 2, sStep: 0.0025, tEnd: 120, halfRange: 15, tauStep: 0.125, detectSigma: 5, probeDetectSigma: 3, probeDetectFraction: 0.75, competingFraction: 0.5 };
    const r = primaryAnalysis(per, d, times, opt);
    expect(r.detected).toBe(true);
    expect(Math.abs(r.speed - c)).toBeLessThan(4 * r.se + 0.01);
    expect(r.ambiguous).toBe(false);
    expect(r.fit.r2).toBeGreaterThan(0.99);
    expect(Math.abs(r.curvature.z)).toBeLessThan(4);
  });

  it('reports a second, slower coherent wavefront as competing', () => {
    const long = Array.from({ length: 501 }, (_, k) => 0.5 * k);
    const E = d.map((x) => long.map((t) => g(t, x / 2.2, 2) + 0.9 * g(t, 10 + x / 1.1, 2)));
    const s = stackArrivals(E, d, long, { sMin: 0.02, sMax: 2, sStep: 0.0025, tEnd: 250, halfRange: 15, tauStep: 0.125 });
    const speeds = [1 / s.sStar, ...s.sCompeting.filter((q) => q.ratio > 0.5).map((q) => 1 / q.s)];
    expect(speeds.some((v) => Math.abs(v - 2.2) < 0.05)).toBe(true);
    expect(speeds.some((v) => Math.abs(v - 1.1) < 0.05)).toBe(true);
  });

  it('is unbiased when pulses broaden with distance (no truncation of aligned far-probe pulses)', () => {
    const fine = Array.from({ length: 1201 }, (_, k) => 0.1 * k);
    const E = d.map((x) => fine.map((t) => g(t, x / 2.2, 3 + 0.05 * x)));
    const s = stackArrivals(E, d, fine, { sMin: 0.2, sMax: 0.8, sStep: 0.0025, tEnd: 120, halfRange: 15, tauStep: 0.025 });
    expect(s.fit.speed).toBeCloseTo(2.2, 3);
    expect(1 / s.sStar).toBeCloseTo(2.2, 2);
  });

  it('slant stack peaks at the true slowness', () => {
    const E = d.map((x) => times.map((t) => g(t, 5 + x / 2.5, 2)));
    const grid = Array.from({ length: 200 }, (_, k) => 0.2 + 0.002 * k);
    const P = slantStack(E, d, times, grid, 120);
    const best = grid[P.indexOf(Math.max(...P))];
    expect(best).toBeCloseTo(0.4, 2);
  });
});

describe('extrapolation and equivalence helpers', () => {
  it('weighted polynomial fit recovers exact coefficients', () => {
    const x = [0.05, 0.1, 0.2, 0.3, 0.4];
    const y = x.map((a) => 2 + 0.7 * a - 0.3 * a * a);
    const q = weightedPoly(x, y, [1, 2, 3, 4, 5], 2);
    expect(q[0]).toBeCloseTo(2, 10);
    expect(q[1]).toBeCloseTo(0.7, 10);
    expect(q[2]).toBeCloseTo(-0.3, 10);
    const l = weightedPoly(x, x.map((a) => 1 + 2 * a), [1, 1, 1, 1, 1], 1);
    expect(l[0]).toBeCloseTo(1, 12);
  });

  it('equivalence: inside, outside, straddling', () => {
    expect(equivalence(0.01, 0.005, 31, 0.05).status).toBe('PASSED');
    expect(equivalence(0.2, 0.01, 31, 0.05).status).toBe('FAILED');
    expect(equivalence(0.03, 0.02, 31, 0.05).status).toBe('INCONCLUSIVE');
  });

  it('the registered validation configuration uses fresh seeds and no prescribed speed', () => {
    expect(SOUND_VALIDATION.seeds[0]).toBe(6001);
    expect(SOUND_VALIDATION.seeds).toHaveLength(32);
    expect(JSON.stringify(SOUND_VALIDATION)).not.toMatch(/soundSpeed|c0|hardDisk/);
  });
});
