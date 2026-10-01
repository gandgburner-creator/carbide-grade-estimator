import {
  alignedStack,
  arrivalFit,
  crossCorrelation,
  ensembleNoise,
  ensembleSeries,
  jackknifeSe,
  peakFeature,
  pseudoValueSd,
  slantStack,
  stackArrivals,
  type ArrivalFit,
  type StackOptions,
  type Template,
} from '../measurements/ArrivalAnalysis';
import { mean, std } from '../measurements/Statistics';

/**
 * Analysis of one sound-speed case (Item 2, docs/CRITERIA_SOUND_SPEED.md §4–§5).
 * Input: per-probe, per-seed series [probe][seed][sample] on a uniform time
 * grid. Everything is model-free; the only speeds are inverse slopes of
 * arrival time against distance.
 */
export type Series3 = number[][][];

export interface AnalysisOptions extends StackOptions {
  detectSigma: number;
  probeDetectSigma: number;
  probeDetectFraction: number;
  competingFraction: number;
}

/** Ensemble [probe][sample] over the given seed indices (all if omitted), optionally leaving one out. */
export function ensemble(per: Series3, seeds?: number[], leaveOut = -1): number[][] {
  return per.map((ps) => {
    const sub = seeds ? seeds.map((i) => ps[i]) : ps;
    return ensembleSeries(sub, leaveOut);
  });
}

/** Keep every `stride`-th sample (time-resolution test). */
export function decimate(per: Series3, times: number[], stride: number): { per: Series3; times: number[] } {
  if (stride === 1) return { per, times };
  return { per: per.map((ps) => ps.map((s) => s.filter((_, k) => k % stride === 0))), times: times.filter((_, k) => k % stride === 0) };
}

export interface PrimaryResult {
  seeds: number;
  speed: number;
  se: number;
  ci95: [number, number];
  /** seed-to-seed SD implied by the jackknife pseudo-values */
  seedSd: number;
  fit: ArrivalFit;
  curvature: { q: number; se: number; z: number };
  slantStackSpeed: number;
  delays: number[];
  delaySe: number[];
  /** detection */
  stackSnr: number;
  probeSignificance: number[];
  probesDetected: number;
  detected: boolean;
  /** ambiguity: competing coherent moveouts / correlation peaks that are both ≥ ½ the main one and significant; leave-one-out instability */
  competingMoveouts: { speed: number; ratio: number; snr: number }[];
  competingCorrelation: { probe: number; tau: number; ratio: number; snr: number }[];
  looUnstable: { slowness: boolean; probes: number[] };
  ambiguous: boolean;
  /** inward-moving coherent signal (negative slowness): overall maximum and the judged candidate */
  inward: { speed: number; ratio: number; snr: number; candidate: { speed: number; ratio: number; snr: number } | null };
  loo: { speed: number[]; curvature: number[]; delays: number[][] };
  templatePeak: number;
  /** slant-stack power against speed (every 4th slowness; outward, and inward as negative speeds), normalised to the outward maximum */
  stackPower: { speed: number[]; power: number[] };
}

const tCrit = (dof: number) => {
  const T = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
  return dof >= 1 && dof <= 30 ? T[dof - 1] : 1.96 + 2.4 / Math.max(dof, 1);
};
export const t95 = tCrit;

/** Stack SNR: peak of the aligned stack over the RMS seed-SE of the per-seed aligned stacks. */
function stackSnr(per: Series3, seeds: number[], d: number[], times: number[], s: number, tEnd: number, template: Template) {
  const perSeed = seeds.map((i) => alignedStack(per.map((ps) => ps[i]), d, times, s, tEnd).v);
  const n = template.v.length;
  let acc = 0;
  for (let k = 0; k < n; k++) acc += (std(perSeed.map((q) => q[k])) / Math.sqrt(seeds.length)) ** 2;
  const sigma = Math.sqrt(acc / n);
  const peak = Math.max(...template.v);
  return { snr: sigma > 0 ? peak / sigma : Number.POSITIVE_INFINITY, sigma, peak };
}

/** Primary estimator with delete-1 jackknife over the seeds in `seedIdx`. */
export function primaryAnalysis(per: Series3, d: number[], times: number[], opt: AnalysisOptions, seedIdx?: number[]): PrimaryResult {
  const S = per[0].length;
  const seeds = seedIdx ?? Array.from({ length: S }, (_, i) => i);
  const E = ensemble(per, seeds);
  const full = stackArrivals(E, d, times, opt);
  // detection: stacked signal and per-probe correlation significance (noise from the seed scatter)
  const st = stackSnr(per, seeds, d, times, full.sStar, opt.tEnd, full.template);
  const probeSig = d.map((_, p) => {
    const taus = full.corr[p].taus;
    const tmpl = alignedStack(E, d, times, full.sStar, opt.tEnd, p);
    const perC = seeds.map((i) => crossCorrelation(tmpl, per[p][i], times, taus, opt.tEnd));
    let acc = 0;
    for (let k = 0; k < taus.length; k++) acc += (std(perC.map((c) => c[k])) / Math.sqrt(seeds.length)) ** 2;
    const sigma = Math.sqrt(acc / taus.length);
    const Cfull = taus.map((_, k) => mean(perC.map((c) => c[k])));
    const main = Cfull[full.corr[p].iMax];
    return { sig: sigma > 0 ? main / sigma : Number.POSITIVE_INFINITY, sigma, main };
  });
  const probesDetected = probeSig.filter((q) => q.sig >= opt.probeDetectSigma).length;
  const detected = st.snr >= opt.detectSigma && probesDetected >= Math.ceil(opt.probeDetectFraction * d.length);
  // competing coherent moveouts: aligned-stack SNR of each competing P(s) maximum
  const competingMoveouts = full.sCompeting
    .filter((c) => c.ratio >= opt.competingFraction)
    .map((c) => {
      const tmpl = alignedStack(E, d, times, c.s, opt.tEnd);
      return { speed: 1 / c.s, ratio: c.ratio, snr: stackSnr(per, seeds, d, times, c.s, opt.tEnd, tmpl).snr };
    })
    .filter((c) => c.snr >= opt.detectSigma);
  const competingCorrelation = full.corr.flatMap((c, p) =>
    c.competing
      .filter((q) => q.ratio >= opt.competingFraction)
      .map((q) => ({ probe: d[p], tau: q.tau, ratio: q.ratio, snr: (q.ratio * probeSig[p].main) / probeSig[p].sigma }))
      .filter((q) => q.snr >= opt.detectSigma),
  );
  // leave-one-out
  const looRuns = seeds.map((_, j) => stackArrivals(ensemble(per, seeds, j), d, times, opt));
  const looSpeed = looRuns.map((r) => r.fit.speed);
  const looCurv = looRuns.map((r) => r.fit.curvature);
  const unstableS = looRuns.some((r) => r.sStar < full.sInterval[0] || r.sStar > full.sInterval[1]);
  const unstableProbes = d.map((_, p) => (looRuns.some((r) => r.delays[p] < full.corr[p].interval[0] || r.delays[p] > full.corr[p].interval[1]) ? p : -1)).filter((p) => p >= 0);
  const se = jackknifeSe(looSpeed);
  const seQ = jackknifeSe(looCurv);
  const n = seeds.length;
  // inward-moving coherent signal (negative slowness)
  const sIn: number[] = [];
  for (let s = -opt.sMax; s <= -opt.sMin + 1e-12; s += opt.sStep) sIn.push(s);
  const Pin = slantStack(E, d, times, sIn, opt.tEnd);
  const Pout = slantStack(E, d, times, [full.sStar], opt.tEnd)[0];
  let iIn = 0;
  for (let i = 1; i < Pin.length; i++) if (Pin[i] > Pin[iIn]) iIn = i;
  // inward-wave candidate: the largest INTERIOR local maximum of the cross power for inward speeds between ½ and 2 × the
  // measured outward speed (a reflected or wrapped pulse travels at the medium's speed; the near-zero-moveout tail of a
  // strong outward pulse, which overlaps neighbouring probes at any moveout, is monotonic there and is not a maximum)
  const sBand: number[] = [];
  for (let s = -2 * full.sStar; s <= -0.5 * full.sStar + 1e-12; s += opt.sStep) sBand.push(s);
  const Pb = slantStack(E, d, times, sBand, opt.tEnd);
  let iB = -1;
  for (let i = 1; i < Pb.length - 1; i++) if (Pb[i] >= Pb[i - 1] && Pb[i] > Pb[i + 1] && (iB < 0 || Pb[i] > Pb[iB])) iB = i;
  const inwardCandidate =
    iB >= 0
      ? { speed: 1 / sBand[iB], ratio: Pb[iB] / Pout, snr: stackSnr(per, seeds, d, times, sBand[iB], opt.tEnd, alignedStack(E, d, times, sBand[iB], opt.tEnd)).snr }
      : null;
  const inTmpl = alignedStack(E, d, times, sIn[iIn], opt.tEnd);
  const sOut: number[] = [];
  for (let s = opt.sMin; s <= opt.sMax + 1e-12; s += 4 * opt.sStep) sOut.push(s);
  const Po = slantStack(E, d, times, sOut, opt.tEnd);
  const norm = Math.max(...Po);
  const stackPower = {
    speed: [...sIn.filter((_, i) => i % 4 === 0).map((s) => 1 / s), ...sOut.map((s) => 1 / s)].map((v) => +v.toPrecision(5)),
    power: [...Pin.filter((_, i) => i % 4 === 0), ...Po].map((v) => +(v / norm).toPrecision(4)),
  };
  const inward = {
    /** overall inward maximum (any inward speed; includes leakage of a strong outward pulse at near-zero moveout) */
    speed: 1 / sIn[iIn],
    ratio: Pin[iIn] / Pout,
    snr: stackSnr(per, seeds, d, times, sIn[iIn], opt.tEnd, inTmpl).snr,
    /** the judged candidate (see above), or null if the band has no interior maximum */
    candidate: inwardCandidate,
  };
  return {
    seeds: n,
    speed: full.fit.speed,
    se,
    ci95: [full.fit.speed - tCrit(n - 1) * se, full.fit.speed + tCrit(n - 1) * se],
    seedSd: pseudoValueSd(full.fit.speed, looSpeed),
    fit: full.fit,
    curvature: { q: full.fit.curvature, se: seQ, z: full.fit.curvature / seQ },
    slantStackSpeed: 1 / full.sStar,
    delays: full.delays,
    delaySe: d.map((_, p) => jackknifeSe(looRuns.map((r) => r.delays[p]))),
    stackSnr: st.snr,
    probeSignificance: probeSig.map((q) => q.sig),
    probesDetected,
    detected,
    competingMoveouts,
    competingCorrelation,
    looUnstable: { slowness: unstableS, probes: unstableProbes.map((p) => d[p]) },
    ambiguous: competingMoveouts.length > 0 || competingCorrelation.length > 0 || unstableS || unstableProbes.length > 0,
    inward,
    loo: { speed: looSpeed, curvature: looCurv, delays: looRuns.map((r) => r.delays) },
    templatePeak: st.peak,
    stackPower,
  };
}

export interface FeatureResult {
  name: string;
  /** per probe: detected, arrival time (NaN if not), SNR */
  probes: { d: number; detected: boolean; t: number; snr: number }[];
  fit: ArrivalFit | null;
  speed: number;
  se: number;
}

/**
 * Secondary features from the per-probe ensemble signals (reported, never
 * judged): a feature is fitted over the probes where it is detected (≥ 5
 * probes required), its speed SE by delete-1 jackknife over seeds.
 */
export function featureAnalysis(
  name: string,
  per: Series3,
  d: number[],
  times: number[],
  pick: (f: ReturnType<typeof peakFeature>) => number,
  opt: { detectSigma: number; tEnd: number; negate?: boolean; minProbes?: number },
): FeatureResult {
  const nT = times.filter((t) => t <= opt.tEnd).length;
  const tt = times.slice(0, nT);
  const sgn = opt.negate ? -1 : 1;
  const cut = (ps: number[][]) => ps.map((s) => s.slice(0, nT).map((v) => sgn * v));
  const pp = per.map(cut);
  const noise = pp.map((ps) => ensembleNoise(ps));
  const feats = pp.map((ps, p) => peakFeature(ensembleSeries(ps), tt, noise[p]));
  const probes = feats.map((f, p) => {
    const t = pick(f);
    return { d: d[p], detected: f.detected && Number.isFinite(t), t: f.detected ? t : Number.NaN, snr: f.snr };
  });
  const use = probes.map((q, p) => (q.detected ? p : -1)).filter((p) => p >= 0);
  if (use.length < (opt.minProbes ?? 5)) return { name, probes, fit: null, speed: Number.NaN, se: Number.NaN };
  const fit = arrivalFit(use.map((p) => d[p]), use.map((p) => probes[p].t));
  const S = per[0].length;
  const loo = Array.from({ length: S }, (_, i) => arrivalFit(use.map((p) => d[p]), use.map((p) => pick(peakFeature(ensembleSeries(pp[p], i), tt, noise[p])))).speed);
  return { name, probes, fit, speed: fit.speed, se: jackknifeSe(loo) };
}

/** Weighted polynomial least squares of degree 1 or 2: coefficients [c0, c1, (c2)]. */
export function weightedPoly(x: number[], y: number[], w: number[], degree: 1 | 2): number[] {
  const m = degree + 1;
  const A = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b = new Array<number>(m).fill(0);
  for (let i = 0; i < x.length; i++) {
    const phi = Array.from({ length: m }, (_, k) => x[i] ** k);
    for (let r = 0; r < m; r++) {
      b[r] += w[i] * phi[r] * y[i];
      for (let c = 0; c < m; c++) A[r][c] += w[i] * phi[r] * phi[c];
    }
  }
  // Gaussian elimination
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < m; r++) {
      const f = A[r][col] / A[col][col];
      for (let c = col; c < m; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const coef = new Array<number>(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < m; c++) s -= A[r][c] * coef[c];
    coef[r] = s / A[r][r];
  }
  return coef;
}

/**
 * Equivalence classification of a relative difference with a 95 % CI against
 * a margin δ: PASS if the CI lies inside [−δ, δ], FAIL if it lies entirely
 * outside, otherwise INCONCLUSIVE.
 */
export function equivalence(rel: number, relSe: number, dof: number, margin: number) {
  const h = tCrit(dof) * relSe;
  const lo = rel - h;
  const hi = rel + h;
  const status: 'PASSED' | 'FAILED' | 'INCONCLUSIVE' = lo >= -margin && hi <= margin ? 'PASSED' : hi < -margin || lo > margin ? 'FAILED' : 'INCONCLUSIVE';
  return { rel, relSe, ci95: [lo, hi] as [number, number], margin, status };
}
