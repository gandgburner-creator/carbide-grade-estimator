import { linearRegression, mean, std } from './Statistics';

/**
 * Probe-based arrival-time analysis of a planar disturbance (Item 2,
 * docs/CRITERIA_SOUND_SPEED.md). Model-free: nothing here knows any expected
 * propagation speed. Distances are measured from the disturbance origin along
 * the propagation axis; signals are "folded" (outward-positive) profiles.
 *
 * At each probe the seed-averaged signal J(t) is reduced to FEATURES:
 *   peak    — centroid of J over the contiguous interval around its maximum
 *             where J ≥ f·max (f = ½ by default): the primary arrival time;
 *   front   — first upward crossing of f·max before the peak (linear interp.);
 *   tail    — last downward crossing of f·max after the peak;
 *   minimum — centroid of −J around the most negative value after the peak
 *             (a trailing rarefaction, or an inward-moving wave), with its
 *             significance;
 *   competing peaks — every other local maximum outside the main interval that
 *             is at least max(D·σ, f·max): reported, never silently dropped.
 * Arrival times against probe distance give the propagation speed (1/slope).
 */

/** Average of the profile bins whose centres lie in [centre − width/2, centre + width/2). */
export function probeSeries(profiles: ArrayLike<ArrayLike<number>>, binWidth: number, centre: number, width: number): number[] {
  const out: number[] = [];
  const b0 = Math.round((centre - width / 2) / binWidth);
  const b1 = Math.round((centre + width / 2) / binWidth);
  for (let k = 0; k < profiles.length; k++) {
    const p = profiles[k];
    let s = 0;
    let n = 0;
    for (let b = Math.max(0, b0); b < Math.min(p.length, b1); b++) {
      s += p[b];
      n++;
    }
    out.push(n ? s / n : Number.NaN);
  }
  return out;
}

export interface PeakFeature {
  detected: boolean;
  /** detection noise σ (seed-ensemble SE, RMS over the window) */
  noise: number;
  height: number;
  snr: number;
  /** centroid time of the main peak over its ≥ f·max interval */
  tPeak: number;
  /** first and last sample time of that interval */
  interval: [number, number];
  /** the interval is closed inside the window (it does not touch either end) */
  closed: boolean;
  tFront: number;
  tTail: number;
  competing: { t: number; height: number; snr: number }[];
  minimum: { t: number; depth: number; snr: number; significant: boolean } | null;
}

export interface PeakOptions {
  /** detection threshold in units of σ */
  detectSigma: number;
  /** fraction of the maximum defining the peak interval */
  fraction: number;
}

export const PEAK_DEFAULTS: PeakOptions = { detectSigma: 5, fraction: 0.5 };

export function peakFeature(J: number[], times: number[], noise: number, opt: PeakOptions = PEAK_DEFAULTS): PeakFeature {
  const n = J.length;
  let kMax = 0;
  for (let k = 1; k < n; k++) if (J[k] > J[kMax]) kMax = k;
  const h = J[kMax];
  const thr = opt.fraction * h;
  let a = kMax;
  while (a > 0 && J[a - 1] >= thr) a--;
  let b = kMax;
  while (b < n - 1 && J[b + 1] >= thr) b++;
  let w0 = 0;
  let w1 = 0;
  for (let k = a; k <= b; k++) {
    w0 += J[k];
    w1 += J[k] * times[k];
  }
  const cross = (k0: number, k1: number) => {
    const f0 = J[k0] - thr;
    const f1 = J[k1] - thr;
    return f1 === f0 ? times[k1] : times[k0] + ((times[k1] - times[k0]) * -f0) / (f1 - f0);
  };
  const tFront = a > 0 ? cross(a - 1, a) : Number.NaN;
  const tTail = b < n - 1 ? cross(b, b + 1) : Number.NaN;
  // competing local maxima outside the main interval
  const level = Math.max(opt.detectSigma * noise, thr);
  const competing: PeakFeature['competing'] = [];
  for (let k = 1; k < n - 1; k++) {
    if (k >= a && k <= b) continue;
    if (J[k] >= J[k - 1] && J[k] > J[k + 1] && J[k] >= level) competing.push({ t: times[k], height: J[k], snr: noise > 0 ? J[k] / noise : Number.POSITIVE_INFINITY });
  }
  // most negative excursion after the main interval
  let minimum: PeakFeature['minimum'] = null;
  if (b < n - 1) {
    let kMin = b + 1;
    for (let k = b + 1; k < n; k++) if (J[k] < J[kMin]) kMin = k;
    if (J[kMin] < 0) {
      const thrMin = opt.fraction * J[kMin];
      let c = kMin;
      while (c > b + 1 && J[c - 1] <= thrMin) c--;
      let d = kMin;
      while (d < n - 1 && J[d + 1] <= thrMin) d++;
      let m0 = 0;
      let m1 = 0;
      for (let k = c; k <= d; k++) {
        m0 += -J[k];
        m1 += -J[k] * times[k];
      }
      const snr = noise > 0 ? -J[kMin] / noise : Number.POSITIVE_INFINITY;
      minimum = { t: m1 / m0, depth: J[kMin], snr, significant: snr >= opt.detectSigma };
    }
  }
  const snr = noise > 0 ? h / noise : Number.POSITIVE_INFINITY;
  return {
    detected: h > 0 && snr >= opt.detectSigma,
    noise,
    height: h,
    snr,
    tPeak: w0 > 0 ? w1 / w0 : Number.NaN,
    interval: [times[a], times[b]],
    closed: a > 0 && b < n - 1,
    tFront,
    tTail,
    competing,
    minimum,
  };
}

/** Seed-ensemble noise of a probe: SE across seeds at each time, RMS over the window. */
export function ensembleNoise(perSeed: number[][]): number {
  const S = perSeed.length;
  if (S < 2) return Number.NaN;
  const T = Math.min(...perSeed.map((s) => s.length));
  let acc = 0;
  for (let k = 0; k < T; k++) {
    const v = perSeed.map((s) => s[k]);
    acc += (std(v) / Math.sqrt(S)) ** 2;
  }
  return Math.sqrt(acc / T);
}

export interface ArrivalFit {
  n: number;
  slope: number;
  intercept: number;
  /** 1 / slope */
  speed: number;
  r2: number;
  residualRms: number;
  residuals: number[];
  /** quadratic coefficient of t = a + b·d + q·d² (0 for constant-speed propagation) */
  curvature: number;
}

/** Least squares of arrival time on distance; the speed is the inverse slope. */
export function arrivalFit(d: number[], t: number[]): ArrivalFit {
  const n = d.length;
  if (n < 2) return { n, slope: Number.NaN, intercept: Number.NaN, speed: Number.NaN, r2: Number.NaN, residualRms: Number.NaN, residuals: [], curvature: Number.NaN };
  const reg = linearRegression(d, t);
  const residuals = d.map((x, i) => t[i] - (reg.intercept + reg.slope * x));
  return {
    n,
    slope: reg.slope,
    intercept: reg.intercept,
    speed: 1 / reg.slope,
    r2: reg.r2,
    residualRms: Math.sqrt(mean(residuals.map((r) => r * r))),
    residuals,
    curvature: n >= 3 ? quadraticCoefficient(d, t) : Number.NaN,
  };
}

/** Coefficient q of the least-squares fit t = a + b·x + q·x² (centred x for conditioning). */
export function quadraticCoefficient(x: number[], y: number[]): number {
  const xm = mean(x);
  const u = x.map((v) => v - xm);
  // normal equations for [1, u, u²]
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let t0 = 0;
  let t1 = 0;
  let t2 = 0;
  for (let i = 0; i < u.length; i++) {
    const a = u[i];
    s0 += 1;
    s1 += a;
    s2 += a * a;
    s3 += a * a * a;
    s4 += a * a * a * a;
    t0 += y[i];
    t1 += a * y[i];
    t2 += a * a * y[i];
  }
  const M = [
    [s0, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const r = [t0, t1, t2];
  const det = (A: number[][]) =>
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det(M);
  if (D === 0) return Number.NaN;
  const M2 = M.map((row, i) => [row[0], row[1], r[i]]);
  return det(M2) / D;
}

/** Delete-1 jackknife: SE = √((S−1)/S · Σ(θ₍ᵢ₎ − θ̄)²). */
export function jackknifeSe(loo: number[]): number {
  const v = loo.filter(Number.isFinite);
  const S = v.length;
  if (S < 3) return Number.NaN;
  const m = mean(v);
  return Math.sqrt(((S - 1) / S) * v.reduce((a, x) => a + (x - m) ** 2, 0));
}

/** Seed-to-seed SD implied by the jackknife: SD of the pseudo-values S·θ − (S−1)·θ₍ᵢ₎. */
export function pseudoValueSd(full: number, loo: number[]): number {
  const S = loo.length;
  const pv = loo.filter(Number.isFinite).map((x) => S * full - (S - 1) * x);
  return pv.length >= 2 ? std(pv) : Number.NaN;
}

/** Mean of per-seed series, optionally leaving one seed out. */
export function ensembleSeries(perSeed: number[][], leaveOut = -1): number[] {
  const T = Math.min(...perSeed.map((s) => s.length));
  const out = new Array<number>(T).fill(0);
  let S = 0;
  for (let i = 0; i < perSeed.length; i++) {
    if (i === leaveOut) continue;
    S++;
    for (let k = 0; k < T; k++) out[k] += perSeed[i][k];
  }
  return out.map((v) => v / S);
}

/* ------------------------------------------------------------------------
 * Stacked-template cross-correlation (the primary arrival-time estimator).
 *
 * 1. Slant stack: for each trial slowness s (time per unit distance, on a
 *    uniform grid that spans far beyond any plausible speed — no expected
 *    value is used), P(s) = Σ_t [Σ_k J_k(t + s·(d_k − d_1))]² over the
 *    whole aligned axis (samples outside each probe's window count as 0). Its maximiser
 *    s* is the moveout of the most coherent outward-travelling signal.
 * 2. Template: T(t) = mean_k J_k(t + s*(d_k − d_1)) on probe 1's clock, on a
 *    time axis that holds every aligned sample (see stackAxis).
 * 3. Delay of each probe: τ_k = argmax_τ Σ_t T₋ₖ(t)·J_k(t + τ), with T₋ₖ the
 *    template without probe k, searched within ± halfRange of s*(d_k − d_1),
 *    refined parabolically.
 * 4. τ_k against d_k → speed = 1 / slope (arrivalFit).
 * Samples are on a uniform grid (times[0], Δt); values between samples are
 * linearly interpolated.
 * ---------------------------------------------------------------------- */

/** Value of a uniformly sampled series at time t (linear interpolation; 0 outside [times[0], tEnd]). */
export function sampleAt(J: ArrayLike<number>, t0: number, dt: number, t: number, tEnd: number): number {
  if (t < t0 || t > tEnd) return 0;
  const x = (t - t0) / dt;
  const k = Math.floor(x);
  if (k < 0 || k >= J.length - 1) return k === J.length - 1 && x === k ? J[k] : 0;
  const f = x - k;
  return J[k] * (1 - f) + J[k + 1] * f;
}

/**
 * Time axis of an aligned stack at slowness s, on probe 1's clock: every
 * probe's data window [times[0], tEnd] maps to [times[0] − s·Δd_p, tEnd − s·Δd_p];
 * the axis covers the union, so no aligned sample is cut off for any s (a
 * fixed axis would truncate the aligned, broadened far-probe pulses and bias
 * the stack toward faster moveouts).
 */
export function stackAxis(d: number[], times: number[], s: number, tEnd: number): { t0: number; dt: number; n: number } {
  const dt = times[1] - times[0];
  const shifts = d.map((dp) => s * (dp - d[0]));
  const lo = times[0] - Math.max(0, ...shifts);
  const hi = tEnd - Math.min(0, ...shifts);
  const k0 = Math.floor((lo - times[0]) / dt);
  return { t0: times[0] + k0 * dt, dt, n: Math.floor((hi - (times[0] + k0 * dt)) / dt) + 1 };
}

/** Slant-stack power P(s) for each slowness in `slownesses`. */
export function slantStack(E: number[][], d: number[], times: number[], slownesses: number[], tEnd: number): number[] {
  const t0 = times[0];
  const dt = times[1] - times[0];
  return slownesses.map((s) => {
    const ax = stackAxis(d, times, s, tEnd);
    let P = 0;
    for (let k = 0; k < ax.n; k++) {
      const t = ax.t0 + k * ax.dt;
      let sum = 0;
      for (let p = 0; p < d.length; p++) sum += sampleAt(E[p], t0, dt, t + s * (d[p] - d[0]), tEnd);
      P += sum * sum;
    }
    return P;
  });
}

export interface Template {
  t0: number;
  dt: number;
  v: number[];
}

/** Aligned stack (template) at slowness s on probe 1's clock; `exclude` leaves one probe out. */
export function alignedStack(E: number[][], d: number[], times: number[], s: number, tEnd: number, exclude = -1): Template {
  const t0 = times[0];
  const dt = times[1] - times[0];
  const ax = stackAxis(d, times, s, tEnd);
  const K = d.length - (exclude >= 0 ? 1 : 0);
  const v = Array.from({ length: ax.n }, (_, k) => {
    const t = ax.t0 + k * ax.dt;
    let a = 0;
    for (let p = 0; p < d.length; p++) if (p !== exclude) a += sampleAt(E[p], t0, dt, t + s * (d[p] - d[0]), tEnd);
    return a / K;
  });
  return { t0: ax.t0, dt: ax.dt, v };
}

/** Local maxima of a sampled curve (index, value), main maximum first. */
export function localMaxima(y: number[]): { i: number; v: number }[] {
  const out: { i: number; v: number }[] = [];
  for (let i = 0; i < y.length; i++) {
    const l = i === 0 ? -Infinity : y[i - 1];
    const r = i === y.length - 1 ? -Infinity : y[i + 1];
    if (y[i] >= l && y[i] > r) out.push({ i, v: y[i] });
  }
  return out.sort((a, b) => b.v - a.v);
}

/** Contiguous index interval around i where y ≥ fraction·y[i]. */
export function halfMaxInterval(y: number[], i: number, fraction = 0.5): [number, number] {
  const thr = fraction * y[i];
  let a = i;
  while (a > 0 && y[a - 1] >= thr) a--;
  let b = i;
  while (b < y.length - 1 && y[b + 1] >= thr) b++;
  return [a, b];
}

/** Parabolic refinement of a maximum on a uniform grid x. */
export function refineMax(x: number[], y: number[], i: number): number {
  if (i <= 0 || i >= y.length - 1) return x[i];
  const a = y[i - 1];
  const b = y[i];
  const c = y[i + 1];
  const den = a - 2 * b + c;
  return den < 0 ? x[i] + (0.5 * (a - c) * (x[1] - x[0])) / den : x[i];
}

/** Cross-correlation C(τ) = Σ_t T(t)·J(t + τ) on a τ grid (sum over the template axis). */
export function crossCorrelation(T: Template, J: ArrayLike<number>, times: number[], taus: number[], tEnd: number): number[] {
  const t0 = times[0];
  const dt = times[1] - times[0];
  return taus.map((tau) => {
    let c = 0;
    for (let k = 0; k < T.v.length; k++) c += T.v[k] * sampleAt(J, t0, dt, T.t0 + k * T.dt + tau, tEnd);
    return c;
  });
}

export interface StackOptions {
  /** slowness grid (time per unit distance): outward > 0 */
  sMin: number;
  sMax: number;
  sStep: number;
  /** analysis window end */
  tEnd: number;
  /** delay search half-range around s*·(d_k − d_1) */
  halfRange: number;
  /** delay grid step (time) */
  tauStep: number;
}

export interface StackArrivals {
  sStar: number;
  /** slowness grid index of the main maximum and its ≥ ½ interval (grid indices) */
  sIndex: number;
  sInterval: [number, number];
  /** other local maxima of P(s) (slowness, P/P(s*)) */
  sCompeting: { s: number; ratio: number }[];
  template: Template;
  delays: number[];
  /** per probe: τ grid, C(τ) main peak index, its ≥ ½ interval (as τ values), other maxima (τ, ratio) */
  corr: { taus: number[]; iMax: number; interval: [number, number]; competing: { tau: number; ratio: number }[] }[];
  fit: ArrivalFit;
}

export function stackArrivals(E: number[][], d: number[], times: number[], opt: StackOptions): StackArrivals {
  const sGrid: number[] = [];
  for (let s = opt.sMin; s <= opt.sMax + 1e-12; s += opt.sStep) sGrid.push(s);
  const P = slantStack(E, d, times, sGrid, opt.tEnd);
  const maxima = localMaxima(P);
  const iS = maxima[0].i;
  const sStar = refineMax(sGrid, P, iS);
  const [a, b] = halfMaxInterval(P, iS);
  const sCompeting = maxima.slice(1).filter((m) => m.i < a || m.i > b).map((m) => ({ s: sGrid[m.i], ratio: m.v / P[iS] }));
  const template = alignedStack(E, d, times, sStar, opt.tEnd);
  const corr: StackArrivals['corr'] = [];
  const delays = d.map((dp, p) => {
    const c0 = sStar * (dp - d[0]);
    const taus: number[] = [];
    for (let tau = c0 - opt.halfRange; tau <= c0 + opt.halfRange + 1e-12; tau += opt.tauStep) taus.push(tau);
    // the probe's own signal is left out of its template, so its noise cannot pull its delay toward the stack moveout
    const C = crossCorrelation(alignedStack(E, d, times, sStar, opt.tEnd, p), E[p], times, taus, opt.tEnd);
    const m = localMaxima(C);
    const iM = m.length ? m[0].i : 0;
    const [ca, cb] = halfMaxInterval(C, iM);
    corr.push({
      taus,
      iMax: iM,
      interval: [taus[ca], taus[cb]],
      competing: m.slice(1).filter((q) => (q.i < ca || q.i > cb) && q.v > 0).map((q) => ({ tau: taus[q.i], ratio: q.v / C[iM] })),
    });
    return refineMax(taus, C, iM);
  });
  return { sStar, sIndex: iS, sInterval: [sGrid[a], sGrid[b]], sCompeting, template, delays, corr, fit: arrivalFit(d, delays) };
}
