import { tTwoSidedCritical } from './Statistics';
import { SUMS, WALL, type FlowBlock, type SideName } from './SurfaceFlowSampler';

/**
 * NEAR-WALL REVERSAL / SEPARATION-REGION DETECTOR — EXPERIMENTAL, NOT VALIDATED.
 *
 * `wall-flux-detector/0` reads the near-surface sums of SurfaceFlowSampler and reports, per
 * station and then per region, how far the measured near-wall flow departs from forward
 * attached flow. It is an OPERATIONAL definition: the words below name what is measured, not a
 * validated physical finding. PFAD's earlier separation study (Item 3) was INCONCLUSIVE and its
 * detector's positive control was under-powered; nothing here revises that, and this detector
 * has never been checked against an independent separation criterion.
 *
 * Measured per station (all from particle sums; u_t is along the downstream tangent):
 *   u1   mean u_t in the near-wall layer (first `nearLayer` of normal distance)
 *   uo   mean u_t in the outer reference layer (top `outerLayer` of the sampled window)
 *   Q_w  net mass flux along the surface within `fluxLayer` of the wall (negative = backflow)
 *   τ    downstream wall shear from the body's own tangential impulse tally (negative = the
 *        wall is dragged upstream)
 *   h_ds height at which the cumulative flux Q(n) returns to zero after a negative excursion
 *        (the dividing streamline of the mean flow; see SurfaceFlowSampler)
 *
 * Reference direction. A near-wall flow is "reversed" only relative to a FORWARD reference:
 *   - on a WINDWARD station (the imposed stream moves into the surface, U·n_out < 0) the reference is
 *     the measured outer-layer mean u_t, which must be significantly positive. Where it is not (the
 *     stagnation flow below an inclined body runs toward the leading edge) nothing is flagged:
 *     upstream-directed flow there is attached flow, not evidence of separation.
 *   - on a LEEWARD station (the stream moves away from the surface, U·n_out > 0) the reference is the
 *     component of the IMPOSED stream along the surface, U·t. This is a boundary condition of the
 *     experiment, not a prediction of the attached-flow velocity, and only its sign and a scale
 *     for the "reduced" deficit are used. It is needed because a stalled leeward side has no
 *     attached outer layer to measure a reference from.
 * This definition was extended after a first look at runs at 25–70° (a measured outer flow cannot
 * exist where the whole leeward side is in the wake). No threshold was changed; the extension
 * makes the detector able to flag a leeward stall at all, so the null-data test was re-run with it.
 *
 * Levels, from the weakest to the strongest evidence (a level needs all the lower ones):
 *   NONE                      no station departs from forward attached flow
 *   REDUCED_FORWARD_VELOCITY  ≥ `minStations` adjacent stations where u1 is at least
 *                             `deficitFraction` below uo, significantly
 *   LOCAL_REVERSAL            at least one station with significant backflow (u1 < 0 or Q_w < 0)
 *                             that does not make up a persistent region
 *   CANDIDATE_SEPARATION      ≥ `minStations` adjacent backflow stations (a region) whose
 *                             region-mean flux Q_w is negative in ≥ `persistence` of the time blocks
 *   CONFIRMED_OPERATIONAL     a candidate region that ALSO has
 *                               - reversed near-wall velocity (u1 < 0, significant) at ≥ half its
 *                                 stations — the velocity itself reverses, not only the net flux,
 *                               - reversed wall shear (τ < 0, significant) at ≥ `shearFraction`
 *                                 of its stations — an independent measurement,
 *                               - the same sign of the region-mean flux in ≥ `persistence` of at
 *                                 least `minSeeds` seeds,
 *                               - enough particle samples, and
 *                               - the same region (onset within `onsetTolerance`) in ≥
 *                                 `minVariants` analysis variants (different station widths,
 *                                 normal bins and block lengths).
 *
 * "Significant" is |mean| > t_(α/2, K−1) · SE with SE from the spread of the K time blocks
 * (batch means; block independence is assumed, not tested). A single negative value is never
 * enough. Resolution of the particle model itself (particle size, count) cannot be varied within
 * one run: it is tested only by comparing runs, and is NOT part of these criteria.
 *
 * All thresholds are the constants below, fixed before any flow data were examined and recorded
 * with every result. They are conventions of this detector, not physical constants.
 */
export type Level = 'NONE' | 'REDUCED_FORWARD_VELOCITY' | 'LOCAL_REVERSAL' | 'CANDIDATE_SEPARATION' | 'CONFIRMED_OPERATIONAL';
export const LEVELS: Level[] = ['NONE', 'REDUCED_FORWARD_VELOCITY', 'LOCAL_REVERSAL', 'CANDIDATE_SEPARATION', 'CONFIRMED_OPERATIONAL'];
const rank = (l: Level) => LEVELS.indexOf(l);

export const LEVEL_TEXT: Record<Level, string> = {
  NONE: 'No station departs from forward attached flow at the detector’s sensitivity.',
  REDUCED_FORWARD_VELOCITY: 'A region of reduced forward near-wall velocity (not reversed).',
  LOCAL_REVERSAL: 'Locally reversed near-wall velocity that does not qualify as a persistent region.',
  CANDIDATE_SEPARATION: 'A candidate separation region: persistent reversed near-wall velocity over adjacent stations.',
  CONFIRMED_OPERATIONAL: 'Operationally confirmed reversed-flow region by this detector’s criteria (experimental; not a validated separation finding).',
};

export interface Variant {
  name: string;
  /** base stations merged into one analysis station */
  stations: number;
  /** normal bins merged into one */
  bins: number;
  /** consecutive time blocks merged into one */
  blocks: number;
}

export interface DetectorSpec {
  id: string;
  /** two-sided significance level of one station test (0.0027 ≈ 3 σ for a normal) */
  alpha: number;
  nearLayer: number;
  fluxLayer: number;
  outerLayer: number;
  deficitFraction: number;
  minStations: number;
  persistence: number;
  minSeeds: number;
  /** particle-snapshots in the near-wall layer a station needs before it can be flagged */
  minSamples: number;
  shearFraction: number;
  /** time blocks needed to estimate a standard error at all */
  minBlocks: number;
  primary: Variant;
  variants: Variant[];
  minVariants: number;
  /** onset agreement between variants, in particle diameters (the onset is only known to a station) */
  onsetTolerance: number;
}

const PRIMARY: Variant = { name: 'primary (2 d stations)', stations: 2, bins: 1, blocks: 1 };
export const DETECTOR_SPEC: DetectorSpec = {
  id: 'wall-flux-detector/0',
  alpha: 0.0027,
  nearLayer: 2,
  fluxLayer: 4,
  outerLayer: 3,
  deficitFraction: 0.5,
  minStations: 2,
  persistence: 0.75,
  minSeeds: 3,
  minSamples: 400,
  shearFraction: 0.5,
  minBlocks: 8,
  primary: PRIMARY,
  variants: [
    PRIMARY,
    { name: '1 d stations', stations: 1, bins: 1, blocks: 1 },
    { name: '3 d stations', stations: 3, bins: 1, blocks: 1 },
    { name: '2 d normal bins', stations: 2, bins: 2, blocks: 1 },
    { name: 'blocks ×2', stations: 2, bins: 1, blocks: 2 },
  ],
  minVariants: 3,
  onsetTolerance: 3,
};

export interface FlowData {
  radius: number;
  normalWidth: number;
  normalBins: number;
  /**
   * per side and base station: whether the imposed stream moves away from the surface there
   * (leeward) and its component along the downstream tangent. Omitted: every station uses the
   * measured outer flow as its reference.
   */
  reference?: Record<SideName, { leeward: boolean[]; streamAlong: number[] }>;
  /** body-frame chord position of each segment's centre (shared by both sides) */
  xs: number[];
  lengths: Record<SideName, number[]>;
  runs: { seed: number; blocks: FlowBlock[] }[];
}

export interface Est {
  mean: number;
  se: number;
  n: number;
}

export interface StationRow {
  index: number;
  /** body-frame chord position of the centre and the two ends */
  x: number;
  xLo: number;
  xHi: number;
  length: number;
  /** particle-snapshots in the near-wall layer */
  samples: number;
  sufficient: boolean;
  u1: Est;
  uOuter: Est;
  deficit: Est;
  /** deficit / uo (null when uo ≤ 0) */
  deficitFraction: number | null;
  qw: Est;
  tau: Est;
  pressure: Est;
  /**
   * dividing-streamline height above the wall: 'attached' = no significant backflow in the flux
   * profile (height 0), 'closed' = the flux returns to zero within the window, 'open' = it does not
   * (the value is then only a lower bound), 'unknown' = not enough data
   */
  hds: { value: number; se: number; state: 'attached' | 'closed' | 'open' | 'unknown' };
  /**
   * the same estimate WITHOUT the significance gate: the point estimate of the pooled flux profile,
   * for explicitly exploratory use only (it can be produced by noise alone)
   */
  hdsRaw: { value: number; se: number; state: 'attached' | 'closed' | 'open' | 'unknown' };
  /** a forward reference exists: the precondition for flagging reversal (see the module comment) */
  forward: boolean;
  /** the reference velocity used and where it came from */
  ref: { kind: 'measured outer flow' | 'imposed stream'; value: number };
  flags: { reduced: boolean; reversed: boolean; fluxReversed: boolean; shearReversed: boolean };
}

export interface StationProfile {
  /** top edge of each normal bin, as a distance from the wall (centre distance) */
  n: number[];
  /** u_t, Q, number density, peculiar kT per bin, with SEs from the time blocks */
  ut: Est[];
  q: Est[];
  density: number[];
  kT: number[];
}

export interface Criterion {
  id: string;
  description: string;
  value: string;
  threshold: string;
  pass: boolean | null;
}

export interface Region {
  /** station indices (analysis resolution), inclusive */
  first: number;
  last: number;
  /** body-frame chord positions: upstream end of the first station, downstream end of the last */
  xLo: number;
  xHi: number;
  kind: 'reversed' | 'reduced';
  criteria: Criterion[];
  meanU1: number;
  meanQw: number;
  /** fraction of blocks / seeds in which the region-mean flux Q_w is negative */
  persistence: number;
  seedAgreement: number | null;
}

export interface VariantResult {
  variant: Variant;
  stations: StationRow[];
  regions: Region[];
  /** the longest backflow region (ties: the most upstream), or the longest reduced one */
  region: Region | null;
  /**
   * A weaker, unqualified region for EXPLORATORY construction: the longest run (≥ minStations) of
   * stations with a forward reference whose pooled flux Q_w is negative, whether or not that is
   * significant and whether or not the station has enough samples. It carries no evidence level and
   * must never be reported as a detection.
   */
  exploratory: { first: number; last: number; xLo: number; xHi: number; meanQw: number; stations: number } | null;
  level: Level;
  blocks: number;
  runs: number;
  dn: number;
  tCritical: number;
}

export interface SurfaceFlowAnalysis {
  detector: string;
  spec: DetectorSpec;
  side: SideName;
  primary: VariantResult;
  profiles: StationProfile[];
  variants: { name: string; level: Level; onsetX: number | null; region: [number, number] | null }[];
  /** level of the primary variant before the sensitivity test */
  levelBeforeSensitivity: Level;
  /** the reported level */
  level: Level;
  region: Region | null;
  /** why the level is not higher */
  reasons: string[];
  provisional: true;
  label: string;
  data: { runs: number; seeds: number[]; blocks: number; blockSnapshots: number };
}

const NAN_EST: Est = { mean: Number.NaN, se: Number.NaN, n: 0 };

function stat(values: number[], tcrit?: number): Est {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  if (n === 0) return NAN_EST;
  const m = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: m, se: Number.NaN, n };
  const s2 = v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
  void tcrit;
  return { mean: m, se: Math.sqrt(s2 / n), n };
}

interface MBlock {
  run: number;
  snapshots: number;
  duration: number;
  sums: number[];
  wall: number[];
}

/** Merge `mb` consecutive blocks of each run (a short remainder joins the last group). */
function mergeBlocks(data: FlowData, side: SideName, mb: number): MBlock[] {
  const out: MBlock[] = [];
  data.runs.forEach((run, r) => {
    const bl = run.blocks.filter((b) => b.sides[side]);
    const groups: FlowBlock[][] = [];
    for (let i = 0; i < bl.length; i += mb) groups.push(bl.slice(i, i + mb));
    if (groups.length > 1 && groups[groups.length - 1].length < mb) {
      const tail = groups.pop()!;
      groups[groups.length - 1].push(...tail);
    }
    for (const g of groups) {
      const first = g[0].sides[side]!;
      const sums = new Array<number>(first.sums.length).fill(0);
      const wall = new Array<number>(first.wall.length).fill(0);
      let snapshots = 0;
      let duration = 0;
      for (const b of g) {
        const sd = b.sides[side]!;
        for (let q = 0; q < sums.length; q++) sums[q] += sd.sums[q];
        for (let q = 0; q < wall.length; q++) wall[q] += sd.wall[q];
        snapshots += b.snapshots;
        duration += b.t1 - b.t0;
      }
      out.push({ run: r, snapshots, duration, sums, wall });
    }
  });
  return out;
}

/** Height at which a cumulative-flux profile (value at each bin's top edge) returns to zero after going negative. */
export function dividingHeight(q: number[], top: number[]): { value: number; state: 'attached' | 'closed' | 'open' | 'unknown' } {
  if (q.some((v) => !Number.isFinite(v))) return { value: Number.NaN, state: 'unknown' };
  let jmin = 0;
  for (let j = 1; j < q.length; j++) if (q[j] < q[jmin]) jmin = j;
  if (q[jmin] >= 0) return { value: 0, state: 'attached' };
  for (let j = jmin + 1; j < q.length; j++) {
    if (q[j] >= 0) {
      const f = -q[j - 1] / (q[j] - q[j - 1]);
      return { value: top[j - 1] + f * (top[j] - top[j - 1]), state: 'closed' };
    }
  }
  return { value: top[top.length - 1], state: 'open' };
}

function analyseVariant(data: FlowData, side: SideName, v: Variant, spec: DetectorSpec, withProfiles: boolean): { result: VariantResult; profiles: StationProfile[] } {
  const S0 = data.lengths[side].length;
  const dx = data.xs.length > 1 ? data.xs[1] - data.xs[0] : 1;
  const groups: number[][] = [];
  for (let i = 0; i < S0; i += v.stations) groups.push(Array.from({ length: Math.min(v.stations, S0 - i) }, (_, k) => i + k));
  const nb0 = data.normalBins;
  const bgroups: number[][] = [];
  for (let j = 0; j < nb0; j += v.bins) bgroups.push(Array.from({ length: Math.min(v.bins, nb0 - j) }, (_, k) => j + k));
  const dn = data.normalWidth * v.bins;
  const nB = bgroups.length;
  const top = bgroups.map((_, b) => data.radius + (b + 1) * dn);
  const nearBins = Math.min(nB, Math.max(1, Math.ceil(spec.nearLayer / dn - 1e-9)));
  const fluxBins = Math.min(nB, Math.max(1, Math.ceil(spec.fluxLayer / dn - 1e-9)));
  const outerBins = Math.min(nB, Math.max(1, Math.ceil(spec.outerLayer / dn - 1e-9)));
  const mblocks = mergeBlocks(data, side, v.blocks);
  const K = mblocks.length;
  const tcrit = K >= 2 ? tTwoSidedCritical(spec.alpha, K - 1) : Number.POSITIVE_INFINITY;
  const sig = (e: Est, sign: 1 | -1) => Number.isFinite(e.se) && e.n >= spec.minBlocks && sign * e.mean > tcrit * e.se && sign * e.mean > 0;

  const stations: StationRow[] = [];
  const profiles: StationProfile[] = [];
  // per merged block region sums are needed later: keep per-station per-block (Pt1, M1)
  const perBlock: { pt1: number[]; m1: number[]; qw: number[] }[] = [];

  groups.forEach((g, gi) => {
    const L = g.reduce((a, k) => a + data.lengths[side][k], 0);
    const u1: number[] = [];
    const uo: number[] = [];
    const qw: number[] = [];
    const tau: number[] = [];
    const prs: number[] = [];
    const pt1: number[] = [];
    const m1: number[] = [];
    const qProf: number[][] = [];
    const utProf: number[][] = [];
    const densAcc = new Array<number>(nB).fill(0);
    const kTAcc = new Array<number>(nB).fill(0);
    const kTCnt = new Array<number>(nB).fill(0);
    let samples = 0;
    let totalSnap = 0;
    for (const mb of mblocks) {
      // sums per merged normal bin
      const cnt = new Array<number>(nB).fill(0);
      const M = new Array<number>(nB).fill(0);
      const Pt = new Array<number>(nB).fill(0);
      const Pn = new Array<number>(nB).fill(0);
      const E = new Array<number>(nB).fill(0);
      for (const k of g) {
        bgroups.forEach((bg, b) => {
          for (const j of bg) {
            const o = (k * nb0 + j) * SUMS;
            cnt[b] += mb.sums[o];
            M[b] += mb.sums[o + 1];
            Pt[b] += mb.sums[o + 2];
            Pn[b] += mb.sums[o + 3];
            E[b] += mb.sums[o + 4];
          }
        });
      }
      let M1 = 0;
      let P1 = 0;
      for (let b = 0; b < nearBins; b++) {
        M1 += M[b];
        P1 += Pt[b];
        samples += cnt[b];
      }
      let Mo = 0;
      let Po = 0;
      for (let b = nB - outerBins; b < nB; b++) {
        Mo += M[b];
        Po += Pt[b];
      }
      u1.push(M1 > 0 ? P1 / M1 : Number.NaN);
      uo.push(Mo > 0 ? Po / Mo : Number.NaN);
      pt1.push(P1);
      m1.push(M1);
      const q: number[] = [];
      let acc = 0;
      for (let b = 0; b < nB; b++) {
        acc += Pt[b];
        q.push(acc / (mb.snapshots * L));
      }
      qProf.push(q);
      qw.push(q[fluxBins - 1]);
      utProf.push(M.map((m, b) => (m > 0 ? Pt[b] / m : Number.NaN)));
      let wn = 0;
      let wt = 0;
      for (const k of g) {
        wn += mb.wall[k * WALL];
        wt += mb.wall[k * WALL + 1];
      }
      tau.push(wt / (mb.duration * L));
      prs.push(wn / (mb.duration * L));
      totalSnap += mb.snapshots;
      for (let b = 0; b < nB; b++) {
        densAcc[b] += cnt[b];
        if (cnt[b] > 0) {
          // peculiar kinetic energy per particle: (E/2 − (Pt² + Pn²)/(2M)) / count   (A-03)
          kTAcc[b] += (0.5 * E[b] - (Pt[b] * Pt[b] + Pn[b] * Pn[b]) / (2 * M[b])) ;
          kTCnt[b] += cnt[b];
        }
      }
    }
    perBlock.push({ pt1, m1, qw });
    const deficitSeries = u1.map((a, k) => uo[k] - a);
    const u1e = stat(u1);
    const uoe = stat(uo);
    const de = stat(deficitSeries);
    const qwe = stat(qw);
    const taue = stat(tau);
    const pe = stat(prs);
    // dividing streamline from the pooled Q profile; jackknife SE over blocks
    const meanQ = (skip: number) => {
      const out = new Array<number>(nB).fill(0);
      let n = 0;
      qProf.forEach((q, k) => {
        if (k === skip) return;
        n++;
        for (let b = 0; b < nB; b++) out[b] += q[b];
      });
      return out.map((x) => x / Math.max(1, n));
    };
    const pooledQ = meanQ(-1);
    const hRaw = dividingHeight(pooledQ, top);
    let h = hRaw;
    if (h.state === 'closed' || h.state === 'open') {
      // a dividing streamline exists only where the flux is significantly negative at its minimum;
      // otherwise the excursion below zero is noise and the profile counts as having no backflow
      let jmin = 0;
      for (let b = 1; b < nB; b++) if (pooledQ[b] < pooledQ[jmin]) jmin = b;
      const qs = stat(qProf.map((q) => q[jmin]));
      if (!(Number.isFinite(qs.se) && qs.n >= spec.minBlocks && -qs.mean > tcrit * qs.se)) h = { value: 0, state: 'attached' };
    }
    let hse = Number.NaN;
    if (K >= 4 && hRaw.state !== 'unknown') {
      const hs: number[] = [];
      for (let k = 0; k < K; k++) hs.push(dividingHeight(meanQ(k), top).value);
      const mh = hs.reduce((a, b) => a + b, 0) / K;
      hse = Math.sqrt(((K - 1) / K) * hs.reduce((a, b) => a + (b - mh) ** 2, 0));
    }
    const sufficient = K >= spec.minBlocks && samples >= spec.minSamples;
    // reference: the imposed stream along the surface on a leeward station, the measured outer flow otherwise
    const refInfo = data.reference?.[side];
    const leeward = !!refInfo && g.every((k) => refInfo.leeward[k]);
    const uStream = refInfo ? g.reduce((a, k) => a + refInfo.streamAlong[k] * data.lengths[side][k], 0) / L : Number.NaN;
    const uRef = leeward ? uStream : uoe.mean;
    const forward = leeward ? uStream > 0 : sig(uoe, 1);
    const deficitSeries2 = leeward ? u1.map((a) => uStream - a) : deficitSeries;
    const de2 = leeward ? stat(deficitSeries2) : de;
    const row: StationRow = {
      index: gi,
      x: g.reduce((a, k) => a + data.xs[k], 0) / g.length,
      xLo: data.xs[g[0]] - dx / 2,
      xHi: data.xs[g[g.length - 1]] + dx / 2,
      length: L,
      samples,
      sufficient,
      u1: u1e,
      uOuter: uoe,
      deficit: de2,
      deficitFraction: uRef > 0 ? de2.mean / uRef : null,
      qw: qwe,
      tau: taue,
      pressure: pe,
      hds: { value: h.value, se: hse, state: h.state },
      hdsRaw: { value: hRaw.value, se: hse, state: hRaw.state },
      forward,
      ref: { kind: leeward ? 'imposed stream' : 'measured outer flow', value: uRef },
      flags: {
        reduced: sufficient && forward && de2.mean / uRef >= spec.deficitFraction && sig(de2, 1),
        reversed: sufficient && forward && sig(u1e, -1),
        fluxReversed: sufficient && forward && sig(qwe, -1),
        shearReversed: sufficient && sig(taue, -1),
      },
    };
    stations.push(row);
    if (withProfiles) {
      const area = L; // strip area per unit normal width, per snapshot: ℓ · Δn
      profiles.push({
        n: top,
        ut: Array.from({ length: nB }, (_, b) => stat(utProf.map((u) => u[b]))),
        q: Array.from({ length: nB }, (_, b) => stat(qProf.map((q) => q[b]))),
        density: densAcc.map((c) => c / (totalSnap * area * dn)),
        kT: kTAcc.map((e, b) => (kTCnt[b] > 0 ? e / kTCnt[b] : Number.NaN)),
      });
    }
  });

  // ---- regions: contiguous runs of flagged stations
  const runsOf = (pred: (r: StationRow) => boolean) => {
    const out: [number, number][] = [];
    let s = -1;
    stations.forEach((r, i) => {
      if (pred(r)) {
        if (s < 0) s = i;
      } else if (s >= 0) {
        out.push([s, i - 1]);
        s = -1;
      }
    });
    if (s >= 0) out.push([s, stations.length - 1]);
    return out.filter(([a, b]) => b - a + 1 >= spec.minStations);
  };
  const seedsOfBlocks = mblocks.map((b) => b.run);
  const runIds = [...new Set(seedsOfBlocks)];
  const regions: Region[] = [];
  const isMember = (r: StationRow) => r.flags.reversed || r.flags.fluxReversed;
  for (const [first, last] of runsOf(isMember)) {
    const idx = Array.from({ length: last - first + 1 }, (_, k) => first + k);
    const lenSum = idx.reduce((a, i) => a + stations[i].length, 0);
    // region-mean flux and velocity per block
    const qwPerBlock = mblocks.map((_, k) => idx.reduce((a, i) => a + perBlock[i].qw[k] * stations[i].length, 0) / lenSum);
    const u1PerBlock = mblocks.map((_, k) => {
      let p = 0;
      let m = 0;
      for (const i of idx) {
        p += perBlock[i].pt1[k];
        m += perBlock[i].m1[k];
      }
      return m > 0 ? p / m : Number.NaN;
    });
    const valid = qwPerBlock.filter(Number.isFinite);
    const persistence = valid.length ? valid.filter((x) => x < 0).length / valid.length : 0;
    const perRun = runIds.map((r) => stat(qwPerBlock.filter((_, k) => seedsOfBlocks[k] === r)).mean);
    const seedAgreement = runIds.length >= spec.minSeeds ? perRun.filter((x) => x < 0).length / runIds.length : null;
    const nVel = idx.filter((i) => stations[i].flags.reversed).length;
    const nShear = idx.filter((i) => stations[i].flags.shearReversed).length;
    const need = (frac: number) => Math.max(1, Math.ceil(frac * idx.length));
    const meanQw = stat(valid).mean;
    const meanU1 = stat(u1PerBlock).mean;
    const criteria: Criterion[] = [
      {
        id: 'region',
        description: `significant backflow (u1 < 0 or Q_w < 0, |t| > ${tcrit.toFixed(2)}, α = ${spec.alpha}) under a forward outer flow, at ≥ ${spec.minStations} adjacent stations`,
        value: `${idx.length} stations, x = ${stations[first].xLo.toFixed(1)} … ${stations[last].xHi.toFixed(1)} d`,
        threshold: `≥ ${spec.minStations}`,
        pass: true,
      },
      {
        id: 'persistence',
        description: `region-mean flux Q_w < 0 in a fraction of the ${valid.length} time blocks`,
        value: persistence.toFixed(2),
        threshold: `≥ ${spec.persistence}`,
        pass: persistence >= spec.persistence,
      },
      {
        id: 'velocity',
        description: 'the near-wall velocity u1 itself is significantly negative at stations of the region',
        value: `${nVel} of ${idx.length}`,
        threshold: `≥ ${need(0.5)}`,
        pass: nVel >= need(0.5),
      },
      {
        id: 'wall-shear',
        description: 'downstream wall shear τ from the body’s impulse tally significantly negative (independent of the sampled velocities)',
        value: `${nShear} of ${idx.length}`,
        threshold: `≥ ${need(spec.shearFraction)}`,
        pass: nShear >= need(spec.shearFraction),
      },
      {
        id: 'seeds',
        description: `region-mean flux Q_w < 0 in a fraction of the ${runIds.length} independent seeds`,
        value: seedAgreement === null ? `untestable (< ${spec.minSeeds} seeds)` : seedAgreement.toFixed(2),
        threshold: `≥ ${spec.persistence} with ≥ ${spec.minSeeds} seeds`,
        pass: seedAgreement === null ? null : seedAgreement >= spec.persistence,
      },
      {
        id: 'samples',
        description: `particle-snapshots in the near-wall layer at every region station`,
        value: `min ${Math.min(...idx.map((i) => stations[i].samples)).toFixed(0)}`,
        threshold: `≥ ${spec.minSamples}`,
        pass: idx.every((i) => stations[i].sufficient),
      },
    ];
    regions.push({ first, last, xLo: stations[first].xLo, xHi: stations[last].xHi, kind: 'reversed', criteria, meanU1, meanQw, persistence, seedAgreement });
  }
  for (const [first, last] of runsOf((r) => r.flags.reduced && !isMember(r))) {
    const idx = Array.from({ length: last - first + 1 }, (_, k) => first + k);
    regions.push({
      first,
      last,
      xLo: stations[first].xLo,
      xHi: stations[last].xHi,
      kind: 'reduced',
      criteria: [
        {
          id: 'deficit',
          description: `u1 at least ${spec.deficitFraction} below the outer-layer velocity, significantly, at ≥ ${spec.minStations} adjacent stations`,
          value: `${idx.length} stations`,
          threshold: `≥ ${spec.minStations}`,
          pass: true,
        },
      ],
      meanU1: stat(idx.map((i) => stations[i].u1.mean)).mean,
      meanQw: stat(idx.map((i) => stations[i].qw.mean)).mean,
      persistence: Number.NaN,
      seedAgreement: null,
    });
  }
  const longest = (rs: Region[]) => rs.slice().sort((a, b) => b.last - b.first - (a.last - a.first) || a.first - b.first)[0] ?? null;
  const reversed = regions.filter((r) => r.kind === 'reversed');
  const region = longest(reversed) ?? longest(regions.filter((r) => r.kind === 'reduced'));

  let level: Level = 'NONE';
  if (region && region.kind === 'reduced') level = 'REDUCED_FORWARD_VELOCITY';
  if (stations.some(isMember)) level = 'LOCAL_REVERSAL';
  if (region && region.kind === 'reversed') {
    const c = (id: string) => region.criteria.find((q) => q.id === id)!;
    if (c('persistence').pass) {
      level = 'CANDIDATE_SEPARATION';
      if (['velocity', 'wall-shear', 'seeds', 'samples'].every((id) => c(id).pass === true)) level = 'CONFIRMED_OPERATIONAL';
    }
  }
  const weak = runsOf((r) => r.forward && r.qw.mean < 0 && (r.hdsRaw.state === 'closed' || r.hdsRaw.state === 'open'));
  const wk = weak.slice().sort((a, b) => b[1] - b[0] - (a[1] - a[0]) || a[0] - b[0])[0];
  const exploratory = wk
    ? {
        first: wk[0],
        last: wk[1],
        xLo: stations[wk[0]].xLo,
        xHi: stations[wk[1]].xHi,
        meanQw: stat(stations.slice(wk[0], wk[1] + 1).map((r) => r.qw.mean)).mean,
        stations: wk[1] - wk[0] + 1,
      }
    : null;
  return { result: { variant: v, stations, regions, region, exploratory, level, blocks: K, runs: runIds.length, dn, tCritical: tcrit }, profiles };
}

/**
 * Run the detector on one side of a body. The primary variant gives the station table and the
 * region; the other variants test whether the finding survives a change of station width,
 * normal-bin width or block length. CONFIRMED_OPERATIONAL is only reported when it does.
 */
export function analyseSurfaceFlow(data: FlowData, side: SideName, spec: DetectorSpec = DETECTOR_SPEC): SurfaceFlowAnalysis {
  const { result: primary, profiles } = analyseVariant(data, side, spec.primary, spec, true);
  const variants = spec.variants.map((v) => {
    const r = v === spec.primary || v.name === spec.primary.name ? primary : analyseVariant(data, side, v, spec, false).result;
    const reg = r.region && r.region.kind === 'reversed' ? r.region : null;
    return { name: v.name, level: r.level, onsetX: reg ? reg.xLo : null, region: reg ? ([reg.xLo, reg.xHi] as [number, number]) : null };
  });
  const reasons: string[] = [];
  let level = primary.level;
  const region = primary.region;
  if (primary.blocks < spec.minBlocks) reasons.push(`only ${primary.blocks} time blocks (< ${spec.minBlocks}): standard errors are not estimated`);
  if (level === 'CONFIRMED_OPERATIONAL') {
    const onset = region!.xLo;
    const agree = variants.filter((q) => rank(q.level) >= rank('CANDIDATE_SEPARATION') && q.onsetX !== null && Math.abs(q.onsetX - onset) <= spec.onsetTolerance);
    if (agree.length < spec.minVariants) {
      level = 'CANDIDATE_SEPARATION';
      reasons.push(`the region is not stable across analysis variants: ${agree.length} of ${variants.length} agree within ${spec.onsetTolerance} d (need ${spec.minVariants})`);
    }
  }
  if (region && region.kind === 'reversed' && level !== 'CONFIRMED_OPERATIONAL') {
    for (const c of region.criteria) if (c.pass === false) reasons.push(`${c.id}: ${c.value} (threshold ${c.threshold})`);
    for (const c of region.criteria) if (c.pass === null) reasons.push(`${c.id}: ${c.value}`);
  }
  if (!region && level === 'NONE') reasons.push('no station is significantly slower or reversed');
  return {
    detector: spec.id,
    spec,
    side,
    primary,
    profiles,
    variants,
    levelBeforeSensitivity: primary.level,
    level,
    region,
    reasons,
    provisional: true,
    label: 'EXPERIMENTAL — an operational definition, not validated against any independent separation criterion',
    data: {
      runs: data.runs.length,
      seeds: data.runs.map((r) => r.seed),
      blocks: primary.blocks,
      blockSnapshots: Math.round(data.runs.reduce((a, r) => a + r.blocks.reduce((b, k) => b + k.snapshots, 0), 0) / Math.max(1, data.runs.reduce((a, r) => a + r.blocks.length, 0))),
    },
  };
}
