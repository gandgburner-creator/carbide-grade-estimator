import { linearRegression, mean } from './Statistics';

/**
 * Disturbance-propagation analysis for a planar density pulse (Master prompt
 * §14). Model-free: nothing here knows any expected propagation speed.
 *
 * Input: density-excess profiles δn(x, t_k) along the propagation axis for the
 * OUTWARD half-domain (x measured from the pulse origin), averaged over seeds.
 *
 * 1. Start: the first snapshot whose profile maximum lies beyond `startBeyond`
 *    (the edge of the initial compression) AND exceeds `significance` × the
 *    noise level `noiseSd` — the pulse has left its source and is not a noise
 *    peak. Its profile over [peak − halfWindow, peak + halfWindow] is the template.
 * 2. Tracking: for every later snapshot, the shift s maximising
 *    C(s) = Σ_x T(x) δn(x + s) (sub-bin parabolic refinement).
 * 3. Stop: before the tracked template would pass `maxPosition`
 *    (the half-domain end, where the counter-propagating pulse arrives).
 * 4. c_p = slope of shift vs time (least squares).
 * Also: amplitude (least-squares scale of the shifted template), and front
 * width (√ of the second moment of δn⁺ inside the window), along the path.
 */
export interface PulseTrack {
  times: number[];
  shifts: number[];
  amplitudes: number[];
  widths: number[];
  peakPositions: number[];
  speed: number;
  speedRegressionSe: number;
  r2: number;
  startTime: number;
  startPeak: number;
  usedSnapshots: number;
  /** ln(amplitude) vs distance slope (attenuation per unit length, > 0 = decaying) */
  attenuationPerLength: number;
  attenuationSe: number;
  /** d(width²)/dt — spreading rate */
  widthGrowthRate: number;
  valid: boolean;
  reason: string;
}

function parabolicPeak(c: number[], k: number): number {
  if (k <= 0 || k >= c.length - 1) return k;
  const a = c[k - 1];
  const b = c[k];
  const d = c[k + 1];
  const den = a - 2 * b + d;
  return den < 0 ? k + (0.5 * (a - d)) / den : k;
}

export function trackPulse(
  profiles: number[][],
  times: number[],
  binWidth: number,
  startBeyond: number,
  maxPosition: number,
  halfWindow: number,
  noiseSd = 0,
  significance = 4,
): PulseTrack {
  const nb = profiles[0]?.length ?? 0;
  const centers = Array.from({ length: nb }, (_, b) => (b + 0.5) * binWidth);
  const fail = (reason: string): PulseTrack => ({
    times: [],
    shifts: [],
    amplitudes: [],
    widths: [],
    peakPositions: [],
    speed: Number.NaN,
    speedRegressionSe: Number.NaN,
    r2: Number.NaN,
    startTime: Number.NaN,
    startPeak: Number.NaN,
    usedSnapshots: 0,
    attenuationPerLength: Number.NaN,
    attenuationSe: Number.NaN,
    widthGrowthRate: Number.NaN,
    valid: false,
    reason,
  });
  const hw = Math.max(1, Math.round(halfWindow / binWidth));
  // 1. start snapshot
  let k0 = -1;
  let p0 = -1;
  for (let k = 0; k < profiles.length; k++) {
    let best = 0;
    for (let b = 1; b < nb; b++) if (profiles[k][b] > profiles[k][best]) best = b;
    if (centers[best] > startBeyond && profiles[k][best] > significance * noiseSd) {
      k0 = k;
      p0 = best;
      break;
    }
  }
  if (k0 < 0) return fail(`no significant pulse (> ${significance} × noise ${noiseSd.toPrecision(2)}) left the source region`);
  const lo = Math.max(0, p0 - hw);
  const hi = Math.min(nb - 1, p0 + hw);
  const T = profiles[k0].slice(lo, hi + 1);
  const TT = T.reduce((a, v) => a + v * v, 0);
  const maxShiftBins = nb - 1 - hi;
  const out = { times: [] as number[], shifts: [] as number[], amplitudes: [] as number[], widths: [] as number[], peakPositions: [] as number[] };
  let prev = 0;
  for (let k = k0; k < profiles.length; k++) {
    const P = profiles[k];
    // search shifts ≥ previous shift − 2 bins (pulses move outward)
    const sLo = Math.max(0, Math.floor(prev) - 2);
    const C: number[] = [];
    for (let s = 0; s <= maxShiftBins; s++) {
      if (s < sLo) {
        C.push(-Infinity);
        continue;
      }
      let c = 0;
      for (let j = 0; j < T.length; j++) c += T[j] * P[lo + j + s];
      C.push(c);
    }
    let bestS = sLo;
    for (let s = sLo; s <= maxShiftBins; s++) if (C[s] > C[bestS]) bestS = s;
    const s = parabolicPeak(C.map((v) => (Number.isFinite(v) ? v : 0)), bestS);
    const peakPos = centers[p0] + s * binWidth;
    if (centers[hi] + s * binWidth > maxPosition) break;
    prev = s;
    // amplitude: least-squares scale of the template at integer shift
    let num = 0;
    for (let j = 0; j < T.length; j++) num += T[j] * P[lo + j + bestS];
    // width: second moment of the positive excess inside the shifted window
    let w0 = 0;
    let w1 = 0;
    let w2 = 0;
    for (let j = 0; j < T.length; j++) {
      const v = Math.max(0, P[lo + j + bestS]);
      const x = centers[lo + j + bestS];
      w0 += v;
      w1 += v * x;
      w2 += v * x * x;
    }
    const xm = w0 > 0 ? w1 / w0 : Number.NaN;
    out.times.push(times[k]);
    out.shifts.push(s * binWidth);
    out.amplitudes.push(num / TT);
    out.widths.push(w0 > 0 ? Math.sqrt(Math.max(0, w2 / w0 - xm * xm)) : Number.NaN);
    out.peakPositions.push(peakPos);
  }
  if (out.times.length < 5) return { ...fail(`only ${out.times.length} usable snapshots`), ...out, startTime: times[k0], startPeak: centers[p0] };
  const reg = linearRegression(out.times, out.shifts);
  const pos = out.amplitudes.map((a, i) => ({ a, d: out.shifts[i] })).filter((p) => p.a > 0);
  const att = pos.length >= 5 ? linearRegression(pos.map((p) => p.d), pos.map((p) => Math.log(p.a))) : null;
  const wv = out.widths.map((w, i) => ({ w, t: out.times[i] })).filter((p) => Number.isFinite(p.w));
  const wreg = wv.length >= 5 ? linearRegression(wv.map((p) => p.t), wv.map((p) => p.w * p.w)) : null;
  return {
    ...out,
    speed: reg.slope,
    speedRegressionSe: reg.seSlope,
    r2: reg.r2,
    startTime: times[k0],
    startPeak: centers[p0],
    usedSnapshots: out.times.length,
    attenuationPerLength: att ? -att.slope : Number.NaN,
    attenuationSe: att ? att.seSlope : Number.NaN,
    widthGrowthRate: wreg ? wreg.slope : Number.NaN,
    valid: reg.r2 > 0.9,
    reason: reg.r2 > 0.9 ? 'ok' : `poor linear fit of shift vs time (r² = ${reg.r2.toFixed(3)})`,
  };
}

/** Average a set of per-seed profile stacks: out[k][b] = mean over seeds. */
export function ensembleProfiles(perSeed: number[][][]): number[][] {
  const S = perSeed.length;
  const K = Math.min(...perSeed.map((p) => p.length));
  const out: number[][] = [];
  for (let k = 0; k < K; k++) {
    const B = perSeed[0][k].length;
    const row = new Array<number>(B).fill(0);
    for (let s = 0; s < S; s++) for (let b = 0; b < B; b++) row[b] += perSeed[s][k][b] / S;
    out.push(row);
  }
  return out;
}

/**
 * Jackknife over seeds: recompute a statistic with each seed left out.
 * SE = sqrt((S−1)/S · Σ (θ_i − θ̄)²).
 */
export function jackknife(perSeed: number[][][], stat: (profiles: number[][]) => number) {
  const S = perSeed.length;
  const full = stat(ensembleProfiles(perSeed));
  if (S < 3) return { value: full, se: Number.NaN, leaveOneOut: [] as number[] };
  const loo: number[] = [];
  for (let i = 0; i < S; i++) loo.push(stat(ensembleProfiles(perSeed.filter((_, j) => j !== i))));
  const ok = loo.filter(Number.isFinite);
  const m = mean(ok);
  const se = Math.sqrt(((ok.length - 1) / ok.length) * ok.reduce((a, v) => a + (v - m) ** 2, 0));
  return { value: full, se, leaveOneOut: loo };
}

/** Noise level of a profile stack: sd of the first snapshot over bins beyond `from`. */
export function profileNoise(profiles: number[][], binWidth: number, from: number): number {
  const p0 = profiles[0] ?? [];
  const v = p0.filter((_, b) => (b + 0.5) * binWidth > from);
  if (v.length < 3) return 0;
  const m = v.reduce((a, x) => a + x, 0) / v.length;
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}
