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
 * The reported SE is the plateau value read at the DEEPEST level that still
 * has ≥ minBlocks blocks. For positively correlated data the level SEs rise to
 * that plateau; for anti-correlated data (e.g. wall impulse in a closed elastic
 * box, where the virial bounds the integrated impulse) they fall to it, and
 * the naive SE would overstate the uncertainty. `conservativeSe` (the largest
 * level SE) is kept for reference. `reliable` is true when the two deepest
 * usable levels agree within their own uncertainty (plateau reached).
 */
export function blockAverage(xs: ArrayLike<number>, minBlocks = 16): Estimate & { levels: BlockLevel[]; conservativeSe: number } {
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
    return { ...e, reliable: false, levels, conservativeSe: e.se };
  }
  const deepest = levels[levels.length - 1];
  let conservativeSe = 0;
  for (const L of levels) conservativeSe = Math.max(conservativeSe, L.se);
  let reliable = false;
  if (levels.length >= 3) {
    const a = levels[levels.length - 1];
    const b = levels[levels.length - 2];
    reliable = Math.abs(a.se - b.se) <= 2 * Math.hypot(a.seError, b.seError);
  }
  const nInd = deepest.se > 0 ? (sd * sd) / (deepest.se * deepest.se) : n;
  const est = finish(m, deepest.se, deepest.nBlocks - 1, sd, n, Math.min(n, nInd), 'block-average', reliable);
  return { ...est, levels, conservativeSe };
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

/**
 * Is an estimate consistent with a reference value? Threshold = k·t₀.₉₇₅(dof)·SE
 * with k = 2, i.e. about 4σ for many samples and correspondingly wider for few
 * (a 2- or 3-seed SE is itself very uncertain). Returns the ratio |x − ref|/threshold.
 */
export function tScaledDeviation(e: Estimate, reference: number, k = 2): number {
  const dof = e.method === 'block-average' || e.method === 'independent' || e.method === 'ensemble' ? Math.max(1, e.n - 1) : 1;
  return Math.abs(e.mean - reference) / (k * tCritical95(dof) * e.se);
}

/** Inverse-variance pooled estimate of per-run estimates (each with a reliable SE). */
export function pooled(es: { mean: number; se: number }[]) {
  const ok = es.filter((e) => Number.isFinite(e.mean) && e.se > 0);
  const c = consistency(
    ok.map((e) => e.mean),
    ok.map((e) => e.se),
  );
  return { mean: c.weightedMean, se: c.weightedSe, z: c.weightedMean / c.weightedSe, runs: ok.length, chi2p: c.pValue };
}

/** ln Γ(x), Lanczos approximation (|rel. error| < 2e-10 for x > 0). */
export function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularised incomplete beta I_x(a, b) (continued fraction, Numerical Recipes betacf). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx: number, aa: number, bb: number) => {
    const tiny = 1e-300;
    let c = 1;
    let d = 1 - ((aa + bb) * xx) / (aa + 1);
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa1 = (m * (bb - m) * xx) / ((aa - 1 + m2) * (aa + m2));
      d = 1 + aa1 * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa1 / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      h *= d * c;
      aa1 = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + 1 + m2));
      d = 1 + aa1 * d;
      if (Math.abs(d) < tiny) d = tiny;
      c = 1 + aa1 / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 3e-14) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (front * cf(x, a, b)) / a : 1 - (front * cf(1 - x, b, a)) / b;
}

/** Upper-tail p-value of the F distribution with (d1, d2) degrees of freedom. */
export function fUpperP(F: number, d1: number, d2: number): number {
  if (!(F > 0)) return 1;
  return incompleteBeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2);
}

/** Two-sided p-value of Student's t with ν degrees of freedom. */
export function tTwoSidedP(t: number, nu: number): number {
  return incompleteBeta(nu / (nu + t * t), nu / 2, 0.5);
}

/**
 * One-way ANOVA: do several groups of INDEPENDENT runs share one mean?
 * Uses the run-to-run scatter pooled over all groups (df = N − G), which is far
 * more reliable than per-group standard errors from 2–5 seeds.
 */
export function oneWayAnova(groups: number[][]) {
  const gs = groups.filter((g) => g.length > 0);
  const N = gs.reduce((a, g) => a + g.length, 0);
  const G = gs.length;
  const grand = gs.reduce((a, g) => a + g.reduce((x, y) => x + y, 0), 0) / N;
  let ssb = 0;
  let ssw = 0;
  for (const g of gs) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (const x of g) ssw += (x - m) ** 2;
  }
  const df1 = G - 1;
  const df2 = N - G;
  const F = df2 > 0 && ssw > 0 ? ssb / df1 / (ssw / df2) : Number.NaN;
  return {
    F,
    df1,
    df2,
    pValue: df1 > 0 && df2 > 0 ? fUpperP(F, df1, df2) : Number.NaN,
    grandMean: grand,
    withinSd: df2 > 0 ? Math.sqrt(ssw / df2) : Number.NaN,
  };
}

/**
 * Weighted least squares y = a + b x with known per-point standard errors,
 * plus the χ² goodness of fit (is a straight line an adequate description?).
 */
export function weightedLinearFit(x: number[], y: number[], se: number[]) {
  let S = 0;
  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 1 / (se[i] * se[i]);
    S += w;
    Sx += w * x[i];
    Sy += w * y[i];
    Sxx += w * x[i] * x[i];
    Sxy += w * x[i] * y[i];
  }
  const D = S * Sxx - Sx * Sx;
  const intercept = (Sxx * Sy - Sx * Sxy) / D;
  const slope = (S * Sxy - Sx * Sy) / D;
  let chi2 = 0;
  for (let i = 0; i < x.length; i++) chi2 += ((y[i] - intercept - slope * x[i]) / se[i]) ** 2;
  const dof = x.length - 2;
  return {
    slope,
    intercept,
    seSlope: Math.sqrt(S / D),
    seIntercept: Math.sqrt(Sxx / D),
    chi2,
    dof,
    pValue: dof > 0 ? chi2UpperP(chi2, dof) : Number.NaN,
  };
}

/**
 * Paired / one-sample t-test on per-seed differences (H0: mean difference 0).
 * Each element comes from one independent seed, so no per-run SE is needed.
 */
export function pairedTTest(diffs: number[]) {
  const d = diffs.filter(Number.isFinite);
  const n = d.length;
  if (n < 2) return { n, mean: Number.NaN, se: Number.NaN, t: Number.NaN, dof: 0, p: Number.NaN };
  const m = mean(d);
  const se = std(d) / Math.sqrt(n);
  const t = se > 0 ? m / se : m === 0 ? 0 : Number.POSITIVE_INFINITY;
  return { n, mean: m, se, t, dof: n - 1, p: Number.isFinite(t) ? tTwoSidedP(t, n - 1) : 0 };
}

/**
 * Welch two-sample t-test (unequal variances) on two groups of INDEPENDENT
 * values, e.g. per-seed means of two run families. H0: equal means. The
 * degrees of freedom are Welch–Satterthwaite.
 */
export function welchTTest(a: number[], b: number[]) {
  const x = a.filter(Number.isFinite);
  const y = b.filter(Number.isFinite);
  if (x.length < 2 || y.length < 2) return { nA: x.length, nB: y.length, diff: Number.NaN, se: Number.NaN, t: Number.NaN, dof: 0, p: Number.NaN };
  const va = variance(x) / x.length;
  const vb = variance(y) / y.length;
  const diff = mean(x) - mean(y);
  const se = Math.sqrt(va + vb);
  const t = se > 0 ? diff / se : diff === 0 ? 0 : Number.POSITIVE_INFINITY;
  const dof = se > 0 ? (va + vb) ** 2 / (va ** 2 / (x.length - 1) + vb ** 2 / (y.length - 1)) : x.length + y.length - 2;
  return { nA: x.length, nB: y.length, diff, se, t, dof, p: Number.isFinite(t) ? tTwoSidedP(t, dof) : 0 };
}

/** Two-sided critical value of Student's t: |t| above it has p < alpha (bisection on tTwoSidedP). */
export function tTwoSidedCritical(alpha: number, nu: number): number {
  let lo = 0;
  let hi = 1e3;
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (lo + hi);
    if (tTwoSidedP(mid, nu) > alpha) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Seed-ensemble summary: mean, sample variance, SD, SE, Student-t 95 % CI, coefficient of variation. */
export function seedSummary(perSeed: number[]) {
  const e = ensembleEstimate(perSeed.filter(Number.isFinite));
  return {
    n: e.n,
    mean: e.mean,
    variance: e.sd * e.sd,
    sd: e.sd,
    se: e.se,
    ci95: e.ci95,
    relHalfWidth95: e.relHalfWidth,
    betweenSeedCV: e.sd / Math.abs(e.mean),
  };
}

/** Mean of the first and second halves of a series (for stationarity tests). */
export function halfMeans(xs: ArrayLike<number>): { first: number; second: number } {
  const n = xs.length;
  const h = Math.floor(n / 2);
  let a = 0;
  let b = 0;
  for (let i = 0; i < h; i++) a += xs[i];
  for (let i = h; i < n; i++) b += xs[i];
  return { first: h > 0 ? a / h : Number.NaN, second: n - h > 0 ? b / (n - h) : Number.NaN };
}

/** Running (cumulative) mean, sampled at ≤ `points` evenly spaced indices (always including the last). */
export function cumulativeMean(xs: ArrayLike<number>, points = 60): { index: number[]; value: number[] } {
  const n = xs.length;
  const index: number[] = [];
  const value: number[] = [];
  if (n === 0) return { index, value };
  const step = Math.max(1, Math.floor(n / points));
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += xs[i];
    if ((i + 1) % step === 0 || i === n - 1) {
      index.push(i);
      value.push(s / (i + 1));
    }
  }
  return { index, value };
}

/** Mean of the last `fraction` of a series. */
export function tailMean(xs: ArrayLike<number>, fraction: number): number {
  const n = xs.length;
  const k = Math.max(1, Math.round(n * fraction));
  let s = 0;
  for (let i = n - k; i < n; i++) s += xs[i];
  return s / k;
}
