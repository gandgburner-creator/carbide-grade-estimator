import { cloneGeometry, DEFAULT_LIMITS, sideY, stationX, validateGeometry, type GeometryLimits, type Side, type SurfaceGeometry } from './SurfaceGeometry';

/**
 * FLOW-GUIDED CONSTRUCTION RULE (experimental; a hypothesis generator, not an optimiser).
 *
 * Input: the measured near-surface flow of the CURRENT geometry, as a height h(x) per analysis
 * station on one side — the dividing-streamline height, i.e. the distance from the wall at which
 * the time-mean cumulative mass flux along the surface returns to zero after a backflow
 * excursion (SurfaceFlowSampler, SeparationDetector). Where the flux never reverses there is no
 * dividing streamline and no height.
 *
 * Rule: add material on that side, over the stretch where the measured flow is reversed, up to a
 * fraction η of the measured height (a lower confidence bound in detector mode), at most
 * `maxStep` per station per increment:
 *
 *     δ(x) = min(maxStep, η · max(0, h(x) − shrink · se(x))) · w_on(x) · w_off(x),
 *
 * with smoothstep ramps w_on (from zero at the onset of the measured region, over `ramp`) and
 * w_off (back to zero over `taper` after its end), so the new surface leaves and rejoins the old
 * one tangentially (G1). The leading and trailing `leReserve` / `teReserve` are never modified:
 * the trailing edge is held fixed in this version and nothing is imposed there.
 *
 * Why this and not "connect the separation point to the trailing edge": a separation point is a
 * place where the flow leaves the wall, not a place on the final surface. The measured quantity
 * that has a geometric meaning is the DIVIDING STREAMLINE of the time-mean flow: the surface of
 * zero net flux that bounds the recirculating (dead-air) region. Adding material up to a fraction
 * of it tests one specific hypothesis — that the flow around the new surface no longer carries
 * the backflow it carried around the old one. The hypothesis may fail: the flow can separate
 * further downstream, or not change at all, and the next simulation is what decides.
 *
 * The increment is bounded by `limits` (local thickness, slope, curvature): if it would violate
 * them it is scaled down uniformly, and if even a tiny scale violates them there is no proposal.
 * Everything is a pure function: the same inputs give the same proposal.
 */
/** what a measurement-based proposal rests on: the detector's region, or a weaker point estimate (see Basis.ts) */
export type AnalysisMode = 'detector' | 'exploratory';
/** how an increment came about: from an analysis of a finished run, or grown live while a simulation ran (LiveFill.ts) */
export type EvidenceMode = AnalysisMode | 'live-fill';

export interface BasisStation {
  /** body-frame chord position of the analysis station's centre */
  x: number;
  /** dividing-streamline height and its standard error */
  h: number;
  se: number;
  state: 'attached' | 'closed' | 'open' | 'unknown';
  /** measured values shown with the proposal */
  qw: number;
  u1: number;
}

export interface ConstructionBasis {
  side: Side;
  mode: EvidenceMode;
  detector: string;
  /** the detector level of this side at the time (not a claim: see SeparationDetector) */
  level: string;
  /** the stretch the proposal responds to, in chord position */
  region: { xLo: number; xHi: number };
  stations: BasisStation[];
  /** where the measurements came from */
  source: { recordId: string | null; seeds: number[]; versionId: string | null };
  /** one-line statement of what was measured */
  summary: string;
}

export interface ConstructionConfig {
  /** fraction η of the measured height applied per increment */
  relaxation: number;
  /** largest height added at any station in one increment */
  maxStep: number;
  /** standard errors subtracted from the measured height (detector mode; 0 in exploratory mode) */
  shrink: number;
  /** length over which the increment eases in from zero at the onset */
  ramp: number;
  /** length over which it eases back to zero after the end of the region */
  taper: number;
  /** never modified: next to the leading edge and next to the trailing edge */
  leReserve: number;
  teReserve: number;
  limits: GeometryLimits;
}

export const DEFAULT_CONSTRUCTION: ConstructionConfig = {
  relaxation: 0.5,
  maxStep: 1,
  shrink: 1,
  ramp: 5,
  taper: 5,
  leReserve: 1,
  teReserve: 5,
  limits: { ...DEFAULT_LIMITS, maxCurvature: 0.5 },
};

export interface PathPoint {
  /** station index on the geometry */
  index: number;
  x: number;
  yOld: number;
  yNew: number;
  /** height added in the direction normal to the old surface */
  deltaNormal: number;
  /** the measured height this point responds to (before shrink and relaxation) and its SE */
  measured: number;
  measuredSE: number;
  /** product of the onset and taper weights */
  weight: number;
}

export interface Proposal {
  id: string;
  side: Side;
  mode: EvidenceMode;
  config: ConstructionConfig;
  basis: ConstructionBasis;
  /** the points of the increment from the onset toward the trailing edge */
  points: PathPoint[];
  /** the surface before and after the whole increment (all stations) */
  before: number[];
  after: number[];
  /** 1 unless the bounds forced the increment to be scaled down */
  scale: number;
  rationale: string;
  hypothesis: string;
  /** area added to the body (d²) */
  area: number;
}

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; reason: string };

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Height h(x) by linear interpolation between station centres, held constant beyond the end stations. */
function interpolate(stations: BasisStation[], usable: (s: BasisStation) => number, x: number): number {
  if (stations.length === 0) return 0;
  if (x <= stations[0].x) return usable(stations[0]);
  for (let k = 0; k + 1 < stations.length; k++) {
    const a = stations[k];
    const b = stations[k + 1];
    if (x <= b.x) {
      const f = (x - a.x) / (b.x - a.x || 1);
      return usable(a) + f * (usable(b) - usable(a));
    }
  }
  return usable(stations[stations.length - 1]);
}

/** Apply per-station normal heights to one side; the vertical shift is δ/cos θ so the NORMAL distance is δ. */
function applyDeltas(g: SurfaceGeometry, side: Side, delta: number[]): SurfaceGeometry {
  const out = cloneGeometry(g);
  const y = sideY(out, side);
  const y0 = sideY(g, side);
  const x = stationX(g);
  const sign = side === 'upper' ? 1 : -1;
  for (let i = 0; i <= g.stations; i++) {
    if (delta[i] === 0) continue;
    const a = Math.max(0, i - 1);
    const b = Math.min(g.stations, i + 1);
    const m = (y0[b] - y0[a]) / (x[b] - x[a]);
    y[i] = y0[i] + sign * delta[i] * Math.sqrt(1 + m * m);
  }
  return out;
}

/** Scale `delta` by the largest factor in [0, 1] that keeps the result within the limits. */
function limited(g: SurfaceGeometry, side: Side, delta: number[], limits: GeometryLimits): { geometry: SurfaceGeometry; scale: number } | null {
  const build = (s: number) => applyDeltas(g, side, delta.map((d) => d * s));
  if (validateGeometry(build(1), limits).length === 0) return { geometry: build(1), scale: 1 };
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = 0.5 * (lo + hi);
    if (validateGeometry(build(mid), limits).length === 0) lo = mid;
    else hi = mid;
  }
  return lo < 0.05 ? null : { geometry: build(lo), scale: lo };
}

export function newProposalId(parentVersion: string, step: number): string {
  return `${parentVersion}-p${step}`;
}

/** Propose one increment on `basis.side` of geometry `g`. */
export function proposeIncrement(g: SurfaceGeometry, basis: ConstructionBasis, cfg: ConstructionConfig = DEFAULT_CONSTRUCTION, id = 'p'): ProposalResult {
  const parentIssues = validateGeometry(g, cfg.limits);
  if (parentIssues.length) return { ok: false, reason: `the current geometry violates its limits (${parentIssues[0].message}); fix or undo before proposing` };
  const { side } = basis;
  const eta = cfg.relaxation;
  if (!(eta > 0 && eta <= 1)) return { ok: false, reason: 'relaxation must lie in (0, 1]' };
  if (!(cfg.maxStep > 0)) return { ok: false, reason: 'maxStep must be positive' };
  const usable = (s: BasisStation) => {
    if (s.state !== 'closed' && s.state !== 'open') return 0;
    const lower = cfg.shrink > 0 ? s.h - cfg.shrink * (Number.isFinite(s.se) ? s.se : s.h) : s.h;
    return Math.max(0, lower);
  };
  const xs = stationX(g);
  const xOn = Math.max(basis.region.xLo, cfg.leReserve);
  const xEnd = Math.min(basis.region.xHi, g.chord - cfg.teReserve - cfg.taper);
  const xLast = xEnd + cfg.taper;
  if (!(xEnd > xOn)) return { ok: false, reason: 'the measured region lies inside the reserved leading/trailing zones: nothing can be changed there' };
  const inRegion = basis.stations.filter((s) => s.x >= basis.region.xLo - 1e-9 && s.x <= basis.region.xHi + 1e-9);
  const delta = xs.map((x) => {
    if (x <= xOn || x >= xLast) return 0;
    const h = interpolate(inRegion, usable, x);
    const w = smooth((x - xOn) / cfg.ramp) * (1 - smooth((x - xEnd) / cfg.taper));
    return Math.min(cfg.maxStep, eta * h) * w;
  });
  if (!delta.some((d) => d > 1e-9)) return { ok: false, reason: 'the increment is zero: the measured heights are below their uncertainty (or the region is inside the reserved zones)' };
  const lim = limited(g, side, delta, cfg.limits);
  if (!lim) return { ok: false, reason: 'the geometry limits (thickness, slope, curvature) leave no room for an increment of this shape' };
  const y0 = sideY(g, side);
  const y1 = sideY(lim.geometry, side);
  const points: PathPoint[] = [];
  for (let i = 0; i <= g.stations; i++) {
    const d = delta[i] * lim.scale;
    if (d <= 1e-9) continue;
    const w = smooth((xs[i] - xOn) / cfg.ramp) * (1 - smooth((xs[i] - xEnd) / cfg.taper));
    const near = inRegion.length ? inRegion.reduce((a, s) => (Math.abs(s.x - xs[i]) < Math.abs(a.x - xs[i]) ? s : a)) : null;
    points.push({
      index: i,
      x: xs[i],
      yOld: y0[i],
      yNew: y1[i],
      deltaNormal: d,
      measured: interpolate(inRegion, (s) => (s.state === 'closed' || s.state === 'open' ? s.h : 0), xs[i]),
      measuredSE: near ? near.se : Number.NaN,
      weight: w,
    });
  }
  const dx = g.chord / g.stations;
  const area = points.reduce((a, p) => a + Math.abs(p.yNew - p.yOld) * dx, 0);
  const sideWord = side === 'upper' ? 'upper side' : 'lower side';
  const exploratory = basis.mode === 'exploratory';
  return {
    ok: true,
    proposal: {
      id,
      side,
      mode: basis.mode,
      config: cfg,
      basis,
      points,
      before: y0.slice(),
      after: y1.slice(),
      scale: lim.scale,
      area,
      rationale:
        `Add material on the ${sideWord} from x = ${points[0].x.toFixed(1)} to ${points[points.length - 1].x.toFixed(1)} d, ` +
        `up to ${(100 * eta).toFixed(0)} % of the measured dividing-streamline height ` +
        `${exploratory ? '(point estimate, no uncertainty margin)' : `(minus ${cfg.shrink} SE)`}, at most ${cfg.maxStep} d per station` +
        `${lim.scale < 1 ? `, scaled by ${lim.scale.toFixed(2)} to respect the geometry limits` : ''}. ` +
        `${basis.summary}`,
      hypothesis:
        `If the dividing streamline of the time-mean flow is a surface the flow follows, the flow around the new surface should carry less backflow over x = ${basis.region.xLo.toFixed(1)}–${basis.region.xHi.toFixed(1)} d ` +
        `than the ${basis.stations.length ? 'measured flow around the current one' : 'current surface'}. Untested: the next simulation decides, and the separation may simply move.`,
    },
  };
}

/**
 * The surface after accepting the increment up to path point `upTo` (inclusive; −1 for none).
 * Points beyond the cut ease back to zero over the taper length, so partial acceptance is still
 * smooth. `upTo` at the last point reproduces the full increment exactly.
 */
export function applyProposal(g: SurfaceGeometry, p: Proposal, upTo: number): { geometry: SurfaceGeometry; scale: number; accepted: number } {
  const last = p.points.length - 1;
  const k = Math.max(-1, Math.min(last, Math.floor(upTo)));
  if (k === last) {
    const out = cloneGeometry(g);
    const y = sideY(out, p.side);
    p.points.forEach((q) => (y[q.index] = q.yNew));
    return { geometry: out, scale: p.scale, accepted: p.points.length };
  }
  if (k < 0) return { geometry: cloneGeometry(g), scale: 1, accepted: 0 };
  const xCut = p.points[k].x;
  const xs = stationX(g);
  const delta = new Array<number>(g.stations + 1).fill(0);
  for (const q of p.points) {
    const w = q.index <= p.points[k].index ? 1 : 1 - smooth((q.x - xCut) / p.config.taper);
    delta[q.index] = q.deltaNormal * w;
  }
  void xs;
  const lim = limited(g, p.side, delta, p.config.limits);
  if (!lim) return { geometry: cloneGeometry(g), scale: 0, accepted: 0 };
  return { geometry: lim.geometry, scale: lim.scale, accepted: k + 1 };
}

/** The surface with only the first `k + 1` points of an ACCEPTED increment applied (for replay). */
export function partialSurface(parent: SurfaceGeometry, side: Side, points: PathPoint[], k: number): SurfaceGeometry {
  const out = cloneGeometry(parent);
  const y = sideY(out, side);
  for (let i = 0; i < points.length && i <= k; i++) y[points[i].index] = points[i].yNew;
  return out;
}
