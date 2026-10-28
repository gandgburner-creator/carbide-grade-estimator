import { tTwoSidedCritical } from './Statistics';
import { SUMS, type SideName } from './SurfaceFlowSampler';
import type { Est, FlowData } from './SeparationDetector';

/**
 * WAKE VOID / UNWETTED SURFACE — EXPERIMENTAL, NOT VALIDATED.
 *
 * `wake-void/0` asks a simpler, particle-level question than the backflow detector: do the gas
 * particles still TOUCH the surface? On a station it measures the number density of the layer
 * right at the wall (the first normal bin: particle centres within one bin width of touching),
 * relative to the free stream's, from the same strip counts the flow sampler already collects.
 *
 *   contact   θ₀ = n(first bin) / n∞            (≈ 1 or more where the gas presses on the wall,
 *                                                  well below 1 in a wake the stream has left)
 *   profile   θ_j = n(bin j) / n∞               (the density recovering with distance from the wall)
 *   gap       the distance from the wall to where the density first reaches `wetThreshold` of the free
 *             stream (linear between bin centres), i.e. how far the particle cloud stands off the surface.
 *             Filling the surface out to the cloud edge would put a layer of that density against the wall.
 *
 * A station is UNWETTED when θ₀ < `wetThreshold`, the pooled count is large enough to say so, and the
 * gap is at least `gapMin`. The SEPARATION POINT of this definition is the first station, counted
 * from the leading edge, of a run of at least `minRun` adjacent unwetted stations: the place where the
 * particles stop touching the surface. It does not need any backflow, and it is what the live construction
 * responds to. It is NOT the classical definition (zero wall shear, or the start of reversed flow),
 * and it has not been compared with any independent criterion; a fast stream past an inclined plate leaves
 * a rarefied lee that this definition calls unwetted whether or not a classical analysis would call it separated.
 *
 * The free-stream density n∞ is the density the experiment imposes at its open boundaries (a
 * configuration value, not a classical result). The threshold 0.5 (half the free stream) was chosen as the
 * natural midpoint, after a probe of a flat plate at 30° and 65° had shown lee densities of 0.15–0.4 of the
 * free stream against 1–3 on the windward side; it is recorded with every result.
 */
export interface WakeSpec {
  id: string;
  /** a layer is "touched" when its number density is at least this fraction of the free stream's */
  wetThreshold: number;
  /** base stations pooled around each station (odd) */
  pool: number;
  /** adjacent unwetted stations that make a separation */
  minRun: number;
  /**
   * fewest particle counts EXPECTED in the pooled contact layer at the free-stream density (strip area ×
   * snapshots × n∞) before a station gets a verdict: with fewer, even a full-density layer could not be
   * told from an empty one
   */
  minExpected: number;
  /** a void thinner than this [d] counts as wetted */
  gapMin: number;
  /** two-sided level of the significance flag (≈ 3 σ) */
  alpha: number;
}

export const WAKE_SPEC: WakeSpec = {
  id: 'wake-void/0',
  wetThreshold: 0.5,
  pool: 3,
  minRun: 2,
  minExpected: 24,
  gapMin: 0.5,
  alpha: 0.0027,
};

export interface WakeStation {
  index: number;
  /** body-frame chord position of the station centre */
  x: number;
  /** n(bin j)/n∞, pooled over the neighbouring stations and all the data */
  theta: number[];
  /** the contact layer, θ₀, with its standard error */
  contact: Est;
  /** particle counts behind θ₀ (pooled) */
  counts: number;
  /** distance from the wall to the cloud edge [d]; the window height if the density never reaches the threshold */
  gap: number;
  /** a verdict could be given (enough exposure: see minExpected) */
  known: boolean;
  unwetted: boolean;
  /** θ₀ is below the threshold by more than `tCritical` standard errors */
  significant: boolean;
}

export interface WakeAnalysis {
  spec: string;
  side: SideName;
  stations: WakeStation[];
  /** first station of the first run of ≥ minRun adjacent unwetted stations, or null */
  separation: { index: number; x: number } | null;
  /** that run, to where it ends */
  run: { first: number; last: number; xLo: number; xHi: number } | null;
  /** fraction of the stations with a verdict that are unwetted */
  unwettedFraction: number;
  /** mean gap over the run (0 if none) [d] */
  meanGap: number;
  /** mean θ₀ over the run (NaN if none) */
  meanContact: number;
  /** largest gap over the run [d] */
  maxGap: number;
  label: string;
}

export const WAKE_LABEL = 'EXPERIMENTAL — an occupancy definition (do particles touch the surface?), not validated against any independent separation criterion';

/** Raw totals behind an analysis: counts per (station, bin) and the exposure per station. */
export interface WakeTotals {
  stations: number;
  bins: number;
  /** counts[k · bins + j] */
  counts: number[];
  /** exposure[k] = Σ snapshots · segment length · bin width (the strip area times the number of snapshots) */
  exposure: number[];
  /** body-frame chord position of each station centre */
  xs: number[];
  /** free-stream number density */
  ambient: number;
  /** bin width [d] */
  dn: number;
}

function interpGap(theta: number[], thr: number, dn: number): number {
  if (!(theta[0] < thr)) return 0;
  for (let j = 1; j < theta.length; j++) {
    if (theta[j] >= thr) {
      const a = theta[j - 1];
      const frac = theta[j] > a ? (thr - a) / (theta[j] - a) : 1;
      return (j - 1 + Math.min(1, Math.max(0, frac))) * dn;
    }
  }
  return theta.length * dn;
}

/**
 * The analysis of totals. `contactSeries[k]` (optional) is the per-block θ₀ of the pooled layer, used for batch-mean
 * standard errors; without it the Poisson error of the count is used.
 */
export function wakeFromTotals(t: WakeTotals, side: SideName, spec: WakeSpec = WAKE_SPEC, contactSeries?: number[][]): WakeAnalysis {
  const S = t.stations;
  const half = Math.floor(spec.pool / 2);
  const K = contactSeries && contactSeries[0] ? contactSeries[0].length : 0;
  const tcrit = K >= 5 ? tTwoSidedCritical(spec.alpha, K - 1) : 3;
  const stations: WakeStation[] = [];
  for (let k = 0; k < S; k++) {
    const lo = Math.max(0, k - half);
    const hi = Math.min(S - 1, k + half);
    let expo = 0;
    for (let q = lo; q <= hi; q++) expo += t.exposure[q];
    const theta: number[] = [];
    let counts0 = 0;
    for (let j = 0; j < t.bins; j++) {
      let c = 0;
      for (let q = lo; q <= hi; q++) c += t.counts[q * t.bins + j];
      if (j === 0) counts0 = c;
      theta.push(expo > 0 ? c / (expo * t.ambient) : Number.NaN);
    }
    const known = expo * t.ambient >= spec.minExpected;
    const th0 = theta[0];
    let se = th0 > 0 ? th0 / Math.sqrt(Math.max(1, counts0)) : 1 / Math.sqrt(Math.max(1, counts0));
    if (contactSeries && K >= 5) {
      const v = contactSeries[k];
      const m = v.reduce((a, b) => a + b, 0) / K;
      se = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (K - 1) / K);
    }
    const gap = known ? interpGap(theta, spec.wetThreshold, t.dn) : 0;
    const unwetted = known && th0 < spec.wetThreshold && gap >= spec.gapMin;
    stations.push({
      index: k,
      x: t.xs[k],
      theta,
      contact: { mean: th0, se, n: Math.max(K, 1) },
      counts: counts0,
      gap,
      known,
      unwetted,
      significant: known && spec.wetThreshold - th0 > tcrit * se,
    });
  }
  let separation: WakeAnalysis['separation'] = null;
  let run: WakeAnalysis['run'] = null;
  for (let k = 0; k + spec.minRun <= S; k++) {
    if (stations.slice(k, k + spec.minRun).every((s) => s.unwetted)) {
      let last = k + spec.minRun - 1;
      while (last + 1 < S && stations[last + 1].unwetted) last++;
      const dx = S > 1 ? t.xs[1] - t.xs[0] : 1;
      separation = { index: k, x: stations[k].x };
      run = { first: k, last, xLo: stations[k].x - dx / 2, xHi: stations[last].x + dx / 2 };
      break;
    }
  }
  const sel = run ? stations.slice(run.first, run.last + 1) : [];
  const known = stations.filter((s) => s.known);
  return {
    spec: spec.id,
    side,
    stations,
    separation,
    run,
    unwettedFraction: known.length ? known.filter((s) => s.unwetted).length / known.length : 0,
    meanGap: sel.length ? sel.reduce((a, s) => a + s.gap, 0) / sel.length : 0,
    meanContact: sel.length ? sel.reduce((a, s) => a + s.contact.mean, 0) / sel.length : Number.NaN,
    maxGap: sel.length ? Math.max(...sel.map((s) => s.gap)) : 0,
    label: WAKE_LABEL,
  };
}

/** The analysis of finished runs (all seeds and blocks of one side). Needs `data.ambientDensity`. */
export function analyseWake(data: FlowData, side: SideName, spec: WakeSpec = WAKE_SPEC): WakeAnalysis | null {
  const n0 = data.ambientDensity;
  if (!(n0 && n0 > 0)) return null;
  const S = data.lengths[side].length;
  const NB = data.normalBins;
  const counts = new Array<number>(S * NB).fill(0);
  const exposure = new Array<number>(S).fill(0);
  const half = Math.floor(spec.pool / 2);
  const blocks = data.runs.flatMap((r) => r.blocks);
  const perBlock: { c0: number[]; expo: number[] }[] = [];
  for (const b of blocks) {
    const sd = b.sides[side];
    if (!sd) continue;
    const sums = sd.sums;
    const c0 = new Array<number>(S).fill(0);
    const expo = new Array<number>(S).fill(0);
    for (let k = 0; k < S; k++) {
      for (let j = 0; j < NB; j++) counts[k * NB + j] += sums[(k * NB + j) * SUMS];
      c0[k] = sums[k * NB * SUMS];
      expo[k] = b.snapshots * data.lengths[side][k] * data.normalWidth;
      exposure[k] += expo[k];
    }
    perBlock.push({ c0, expo });
  }
  const series: number[][] = Array.from({ length: S }, (_, k) => {
    const lo = Math.max(0, k - half);
    const hi = Math.min(S - 1, k + half);
    return perBlock.map((b) => {
      let c = 0;
      let e = 0;
      for (let q = lo; q <= hi; q++) {
        c += b.c0[q];
        e += b.expo[q];
      }
      return e > 0 ? c / (e * n0) : Number.NaN;
    });
  });
  return wakeFromTotals({ stations: S, bins: NB, counts, exposure, xs: data.xs, ambient: n0, dn: data.normalWidth }, side, spec, series);
}

/**
 * Rolling totals for live use: each new block of strip counts is added after the old ones were
 * multiplied by `decay` (so the estimate follows a surface that is moving, with an effective memory of
 * 1/(1 − decay) blocks).
 */
export class WakeAccumulator {
  readonly counts: number[];
  readonly exposure: number[];
  constructor(
    readonly stations: number,
    readonly bins: number,
  ) {
    this.counts = new Array<number>(stations * bins).fill(0);
    this.exposure = new Array<number>(stations).fill(0);
  }

  fold(sums: number[], snapshots: number, lengths: number[], dn: number, decay: number): void {
    for (let i = 0; i < this.counts.length; i++) this.counts[i] *= decay;
    for (let k = 0; k < this.stations; k++) this.exposure[k] *= decay;
    for (let k = 0; k < this.stations; k++) {
      for (let j = 0; j < this.bins; j++) this.counts[k * this.bins + j] += sums[(k * this.bins + j) * SUMS];
      this.exposure[k] += snapshots * lengths[k] * dn;
    }
  }

  totals(xs: number[], ambient: number, dn: number): WakeTotals {
    return { stations: this.stations, bins: this.bins, counts: this.counts.slice(), exposure: this.exposure.slice(), xs, ambient, dn };
  }
}
