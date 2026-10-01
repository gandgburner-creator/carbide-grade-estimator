import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import {
  arrivalFit,
  ensembleNoise,
  ensembleSeries,
  jackknifeSe,
  peakFeature,
  probeSeries,
  pseudoValueSd,
  quadraticCoefficient,
} from '../src/measurements/ArrivalAnalysis';

const times = Array.from({ length: 201 }, (_, k) => 0.5 * k);
const gauss = (t: number, t0: number, s: number, a = 1) => a * Math.exp(-((t - t0) ** 2) / (2 * s * s));

describe('peak features at one probe', () => {
  it('finds the centroid, front and tail of a clean pulse', () => {
    const J = times.map((t) => gauss(t, 40, 3));
    const f = peakFeature(J, times, 0.01);
    expect(f.detected).toBe(true);
    expect(f.tPeak).toBeCloseTo(40, 6);
    // half maximum of a Gaussian at ± s√(2 ln 2)
    expect(f.tFront).toBeCloseTo(40 - 3 * Math.sqrt(2 * Math.log(2)), 1);
    expect(f.tTail).toBeCloseTo(40 + 3 * Math.sqrt(2 * Math.log(2)), 1);
    expect(f.closed).toBe(true);
    expect(f.competing).toHaveLength(0);
  });

  it('reports a competing second peak instead of choosing silently', () => {
    const J = times.map((t) => gauss(t, 30, 2) + gauss(t, 60, 2, 0.8));
    const f = peakFeature(J, times, 0.01);
    expect(f.tPeak).toBeCloseTo(30, 3);
    expect(f.competing).toHaveLength(1);
    expect(f.competing[0].t).toBeCloseTo(60, 6);
  });

  it('reports a trailing negative lobe (rarefaction or inward wave) with its significance', () => {
    const J = times.map((t) => gauss(t, 30, 2) - gauss(t, 45, 3, 0.3));
    const f = peakFeature(J, times, 0.01);
    expect(f.minimum).not.toBeNull();
    expect(f.minimum!.t).toBeCloseTo(45, 1);
    expect(f.minimum!.significant).toBe(true);
  });

  it('does not detect noise', () => {
    const rng = new Rng(3);
    const J = times.map(() => 0.01 * rng.gaussian());
    expect(peakFeature(J, times, 0.01).detected).toBe(false);
  });
});

describe('arrival time against distance', () => {
  it('recovers the speed of a constant-speed pulse with no curvature', () => {
    const d = [30, 40, 50, 60, 70, 80, 90, 100, 110];
    const t = d.map((x) => 0.7 + x / 2.3);
    const fit = arrivalFit(d, t);
    expect(fit.speed).toBeCloseTo(2.3, 10);
    expect(fit.intercept).toBeCloseTo(0.7, 10);
    expect(Math.abs(fit.curvature)).toBeLessThan(1e-12);
    expect(fit.r2).toBeCloseTo(1, 12);
  });

  it('shows curvature for diffusive (t ∝ d²) arrival', () => {
    const d = [30, 40, 50, 60, 70, 80, 90, 100, 110];
    expect(quadraticCoefficient(d, d.map((x) => (x * x) / 400))).toBeCloseTo(1 / 400, 10);
  });

  it('end to end: noisy seeds, probes, jackknife', () => {
    const rng = new Rng(9);
    const c = 2.2;
    const binWidth = 2;
    const nb = 70;
    const S = 16;
    // per-seed folded profiles [time][bin]: pulse centred at c·t, width growing slowly, plus white noise
    const seeds = Array.from({ length: S }, () =>
      times.map((t) => Array.from({ length: nb }, (_, b) => gauss((b + 0.5) * binWidth, c * t, 6 + 0.05 * t, 0.05) + 0.01 * rng.gaussian())),
    );
    const probes = [30, 40, 50, 60, 70, 80, 90, 100];
    const perProbe = probes.map((p) => seeds.map((s) => probeSeries(s, binWidth, p, 4)));
    const tFull = perProbe.map((ps) => peakFeature(ensembleSeries(ps), times, ensembleNoise(ps)).tPeak);
    const full = arrivalFit(probes, tFull).speed;
    const loo = Array.from({ length: S }, (_, i) => arrivalFit(probes, perProbe.map((ps) => peakFeature(ensembleSeries(ps, i), times, ensembleNoise(ps)).tPeak)).speed);
    const se = jackknifeSe(loo);
    expect(Math.abs(full - c)).toBeLessThan(4 * se + 0.01);
    expect(se).toBeGreaterThan(0);
    expect(pseudoValueSd(full, loo)).toBeCloseTo(se * Math.sqrt(S), 6);
  });
});
