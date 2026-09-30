/**
 * Statistics used by every PFAD measurement (Master prompt §21, Bible §20).
 *
 * Time series from a particle simulation are autocorrelated, so the naive
 * standard error σ/√n underestimates the uncertainty. `blockAverage` applies the
 * Flyvbjerg–Petersen blocking transformation and reports the effective number
 * of independent samples. Ensembles over seeds are independent by construction
 * and use the plain standard error with a Student-t interval.
 */

export function mean(xs: ArrayLike<number>): number {
  if (xs.length === 0) return Number.NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function variance(xs: ArrayLike<number>, ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return Number.NaN;
  const m = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - m) * (xs[i] - m);
  return s / (n - ddof);
}

export const std = (xs: ArrayLike<number>, ddof = 1): number => Math.sqrt(variance(xs, ddof));

/** Two-sided 95 % Student-t critical values for dof 1..30. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12,
  2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Two-sided 95 % t critical value (table for dof ≤ 30, Cornish–Fisher beyond). */
export function tCritical95(dof: number): number {
  if (!(dof >= 1)) return Number.POSITIVE_INFINITY;
  const d = Math.floor(dof);
  if (d <= 30) return T95[d - 1];
  const z = 1.959963984540054;
  const z3 = z ** 3;
  const z5 = z ** 5;
  const z7 = z ** 7;
  return (
    z +
    (z3 + z) / (4 * d) +
    (5 * z5 + 16 * z3 + 3 * z) / (96 * d * d) +
    (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * d * d * d)
  );
}

export interface Estimate {
  mean: number;
  /** standard error of the mean */
  se: number;
  /** 95 % confidence interval */
  ci95: [number, number];
  /** half-width of the 95 % interval divided by |mean| */
  relHalfWidth: number;
  /** sample standard deviation of the underlying samples */
  sd: number;
  /** number of samples used */
  n: number;
  /** estimated number of statistically independent samples */
  nIndependent: number;
  method: 'independent' | 'block-average' | 'ensemble' | 'single-value';
  /** false when the correlation time could not be resolved (uncertainty unreliable) */
  reliable: boolean;
}

function finish(
  m: number,
  se: number,
  dof: number,
  sd: number,
  n: number,
  nInd: number,
  method: Estimate['method'],
  reliable: boolean,
): Estimate {
  const hw = tCritical95(dof) * se;
  return {
    mean: m,
    se,
    ci95: [m - hw, m + hw],
    relHalfWidth: m !== 0 ? Math.abs(hw / m) : Number.POSITIVE_INFINITY,
    sd,
    n,
    nIndependent: nInd,
    method,
    reliable,
  };
}

/** Estimate for independent samples (e.g. per-seed results). */
export function independentEstimate(xs: ArrayLike<number>, method: Estimate['method'] = 'independent'): Estimate {
  const n = xs.length;
  const m = mean(xs);
  if (n < 2) return finish(m, Number.NaN, 0, Number.NaN, n, n, 'single-value', false);
  const sd = std(xs);
  return finish(m, sd / Math.sqrt(n), n - 1, sd, n, n, method, n >= 3);
}

export interface BlockLevel {
  blockSize: number;
  nBlocks: number;
  se: number;
  /** statistical uncertainty of `se` itself */
  seError: number;
}

/**
 * Flyvbjerg–Petersen blocking analysis of a correlated series.
 * The reported SE is the largest SE among levels that still have ≥ minBlocks
 * blocks (conservative). `reliable` is true when the two deepest usable levels
 * agree within their own uncertainty, i.e. the SE has reached a plateau.
 */
export function blockAverage(xs: ArrayLike<number>, minBlocks = 16): Estimate & { levels: BlockLevel[] } {
  const n = xs.length;
  const m = mean(xs);
  const sd = n > 1 ? std(xs) : Number.NaN;
  const levels: BlockLevel[] = [];
  let cur = Array.from(xs);
  let size = 1;
  while (cur.length >= minBlocks) {
    const nb = cur.length;
    const se = Math.sqrt(variance(cur, 1) / nb);
    levels.push({ blockSize: size, nBlocks: nb, se, seError: se / Math.sqrt(2 * (nb - 1)) });
    const next: number[] = [];
    for (let i = 0; i + 1 < cur.length; i += 2) next.push(0.5 * (cur[i] + cur[i + 1]));
    cur = next;
    size *= 2;
  }
  if (levels.length === 0) {
    const e = independentEstimate(xs);
    return { ...e, reliable: false, levels };
  }
  let best = levels[0];
  for (const L of levels) if (L.se > best.se) best = L;
  let reliable = false;
  if (levels.length >= 3) {
    const a = levels[levels.length - 1];
    const b = levels[levels.length - 2];
    reliable = Math.abs(a.se - b.se) <= 2 * Math.hypot(a.seError, b.seError);
  }
  const nInd = best.se > 0 ? (sd * sd) / (best.se * best.se) : n;
  const est = finish(m, best.se, best.nBlocks - 1, sd, n, Math.min(n, nInd), 'block-average', reliable);
  return { ...est, levels };
}

/** Combine per-seed estimates: the spread between seeds defines the uncertainty. */
export function ensembleEstimate(perSeed: number[]): Estimate {
  return independentEstimate(perSeed, 'ensemble');
}

export interface Regression {
  slope: number;
  intercept: number;
  seSlope: number;
  seIntercept: number;
  r2: number;
  residualSd: number;
  n: number;
}

/** Ordinary least squares y = a + b x with standard errors. */
export function linearRegression(x: ArrayLike<number>, y: ArrayLike<number>): Regression {
  const n = x.length;
  if (n !== y.length) throw new Error('regression arrays differ in length');
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let i = 0; i < n; i++) rss += (y[i] - intercept - slope * x[i]) ** 2;
  const s2 = n > 2 ? rss / (n - 2) : Number.NaN;
  return {
    slope,
    intercept,
    seSlope: Math.sqrt(s2 / sxx),
    seIntercept: Math.sqrt(s2 * (1 / n + (mx * mx) / sxx)),
    r2: syy > 0 ? 1 - rss / syy : 1,
    residualSd: Math.sqrt(s2),
    n,
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Upper-tail p-value of χ² with k dof (Wilson–Hilferty approximation). */
export function chi2UpperP(chi2: number, k: number): number {
  if (k <= 0) return Number.NaN;
  const z = (Math.cbrt(chi2 / k) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return 1 - normalCdf(z);
}

/**
 * Are several measurements of the same quantity mutually consistent?
 * χ² of the values about their inverse-variance weighted mean.
 */
export function consistency(values: number[], ses: number[]) {
  let sw = 0;
  let swx = 0;
  for (let i = 0; i < values.length; i++) {
    const w = 1 / (ses[i] * ses[i]);
    sw += w;
    swx += w * values[i];
  }
  const wmean = swx / sw;
  let chi2 = 0;
  for (let i = 0; i < values.length; i++) chi2 += ((values[i] - wmean) / ses[i]) ** 2;
  const dof = values.length - 1;
  return { weightedMean: wmean, weightedSe: Math.sqrt(1 / sw), chi2, dof, pValue: chi2UpperP(chi2, dof) };
}

/** Difference of two independent estimates and its significance (for A/B tests). */
export function difference(a: Estimate, b: Estimate) {
  const d = a.mean - b.mean;
  const se = Math.hypot(a.se, b.se);
  const z = se > 0 ? d / se : Number.POSITIVE_INFINITY;
  return { difference: d, se, z, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
}

/**
 * Weighted isotonic regression (pool-adjacent-violators) for a NON-INCREASING
 * sequence. Model-free apart from monotonicity; used to locate level crossings
 * of noisy decaying signals without assuming a functional form.
 */
export function isotonicNonIncreasing(y: ArrayLike<number>, w?: ArrayLike<number>): number[] {
  const n = y.length;
  const vals: number[] = [];
  const wts: number[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    vals.push(y[i]);
    wts.push(w ? w[i] : 1);
    lens.push(1);
    // merge while the sequence increases
    while (vals.length > 1 && vals[vals.length - 2] < vals[vals.length - 1]) {
      const v2 = vals.pop()!;
      const w2 = wts.pop()!;
      const l2 = lens.pop()!;
      const k = vals.length - 1;
      const ww = wts[k] + w2;
      vals[k] = (vals[k] * wts[k] + v2 * w2) / ww;
      wts[k] = ww;
      lens[k] += l2;
    }
  }
  const out: number[] = [];
  for (let k = 0; k < vals.length; k++) for (let j = 0; j < lens[k]; j++) out.push(vals[k]);
  return out;
}
