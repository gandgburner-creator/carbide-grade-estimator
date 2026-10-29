import type { WakeAnalysis } from '../measurements/WakeVoid';
import { cloneGeometry, DEFAULT_LIMITS, isFree, segmentAt, sideY, stationX, validateGeometry, type GeometryLimits, type Side, type SurfaceGeometry } from './SurfaceGeometry';

/**
 * LIVE FILL (experimental): grow a surface WHILE the simulation runs, where the particles no longer
 * touch it, from the separation point toward the trailing edge.
 *
 * The measurement is `wake-void/0` (measurements/WakeVoid.ts): how far the particle cloud stands off
 * the surface at each station (the gap). The rule fills that gap, slowly:
 *
 *     δ(x) = min(maxStep, η · max(0, gap(x) − margin)) · w_on(x) · w_front(x)
 *
 * for stations from the SEPARATION POINT (the first station of the unwetted stretch) up to a FRONT that
 * starts at the separation point and advances `frontSpeed` per update until it meets the trailing edge,
 * with smooth ramps so the new surface leaves and rejoins the old one tangentially. The trailing edge stays
 * where it is: the fill converges to it. Each update adds at most `maxStep` of material, and only the gap
 * is ever filled, so as the surface advances into the void the particles touch it again and the gap closes.
 *
 * Nothing here knows an airfoil, a Kutta condition or a target shape; what it builds is the envelope of the
 * particle cloud. It is a hypothesis generator, not an optimiser, and unvalidated.
 *
 * Safety: material is only added where no particle centre is within its radius (+ `clearance`) of the new
 * surface (`capByParticles`), so the engine never has a particle inside the body.
 */
export type LiveStop = 'converged' | 'swept' | 'stalled' | 'wetted' | 'max-updates' | 'blocked' | 'limit' | 'failed' | 'user';

/** One update of a live fill. */
export interface LiveStep {
  update: number;
  t: number;
  /** the separation point of this update (body-frame chord position), or null when every station is touched */
  onset: number | null;
  front: number;
  maxGap: number;
  meanGap: number;
  /** largest material added at a station [d], and the area added [d²] */
  added: number;
  area: number;
  /** stations whose increment a particle capped, and the fraction of the planned material the geometry limits let through (1 = all) */
  capped: number;
  scale: number;
  note: string;
}

/** What a finished live fill hands to the project history. */
export interface LiveBuildSummary {
  recordId: string;
  seed: number;
  side: Side;
  startGeometry: SurfaceGeometry;
  finalGeometry: SurfaceGeometry;
  trajectory: LiveStep[];
  stop: { kind: LiveStop; reason: string };
  /** the first measurement of how far the particle cloud stood off the surface */
  wakeStart: WakeAnalysis | null;
  treated: { xLo: number; xHi: number } | null;
  config: LiveFillConfig;
}

export interface LiveFillConfig {
  /** which side to fill; 'auto' chooses at the first update the side with the larger unwetted stretch × gap */
  side: Side | 'auto';
  /** simulation time between updates [τ]; also the length of the strip sample behind each update */
  interval: number;
  /** weight kept of earlier blocks at each update (the surface moves, so the memory is short) */
  decay: number;
  /** fraction of the gap filled per update */
  relaxation: number;
  /** most material added at a station per update [d] */
  maxStep: number;
  /** gap left unfilled [d] */
  margin: number;
  /** how far the front advances per update [d of chord] */
  frontSpeed: number;
  ramp: number;
  taper: number;
  /** how far behind the front material is still added [d]: the fill is ONE pass of the front, so a station gets material only while the front is passing it */
  behind: number;
  leReserve: number;
  teReserve: number;
  /** extra clearance beyond the particle radius kept between a particle centre and new material [d] */
  clearance: number;
  maxUpdates: number;
  /** stop as converged when the largest gap on the treated stretch stays below `gap` [d] for `updates` updates after the front reached the trailing edge */
  convergeGap: number;
  convergeUpdates: number;
  limits: GeometryLimits;
}

export const DEFAULT_LIVE: LiveFillConfig = {
  side: 'upper',
  interval: 40,
  decay: 0.5,
  relaxation: 0.4,
  maxStep: 0.5,
  margin: 0.3,
  frontSpeed: 1.5,
  ramp: 3,
  taper: 3,
  behind: 3,
  leReserve: 1,
  teReserve: 2,
  clearance: 0.1,
  maxUpdates: 30,
  convergeGap: 1,
  convergeUpdates: 3,
  limits: { ...DEFAULT_LIMITS, maxCurvature: 0.5 },
};

const smooth = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

/** Gap at each geometry station (stations + 1 values), from the per-segment wake analysis. Wetted or unknown segments give 0. */
export function gapAtStations(g: SurfaceGeometry, wake: WakeAnalysis): number[] {
  const n = g.stations;
  const gap = wake.stations.map((s) => (s.unwetted ? s.gap : 0));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = i > 0 ? gap[i - 1] : gap[0];
    const b = i < n ? gap[i] : gap[n - 1];
    return 0.5 * (a + b);
  });
}

export interface LivePlan {
  /** material to add at each geometry station [d] along the outward direction of the side */
  delta: number[];
  /** where the separation is (body-frame chord position of the first unwetted station's centre), and the front after this update */
  onset: number;
  front: number;
  /** largest gap on the stretch between the onset and the front */
  maxGap: number;
  meanGap: number;
}

/** A three-point smoothing (¼, ½, ¼) of a profile that keeps it non-negative and leaves its ends alone. */
function smoothProfile(v: number[]): number[] {
  return v.map((x, i) => (i === 0 || i === v.length - 1 ? x : 0.25 * v[i - 1] + 0.5 * x + 0.25 * v[i + 1]));
}

/**
 * The increment for this update, or null when there is nothing to start from.
 *
 * The fill STARTS at the separation point found at the first update (`onset`, kept for the whole run: material added since then
 * makes the particles touch the new surface, which would otherwise move the "first unwetted station" ahead of the fill and make it
 * restart downstream, leaving a ripple of separate humps) and its FRONT then advances toward the trailing edge by `frontSpeed` per
 * update. In a band around the front (from `behind` behind it to `taper` ahead) it adds material by the measured gap, which is
 * smoothed over several stations first (and so is the increment) so that the noise of single stations does not print itself into the surface. The fill is ONE
 * PASS of the front: once the front has passed a station it adds nothing more there, so the surface cannot keep growing after the cloud
 * it follows (a surface in a thermal gas always has a lee side with less contact, and chasing it outward never ends). `onset` is read from the wake analysis when it is not given.
 */
export function planIncrement(g: SurfaceGeometry, wake: WakeAnalysis, cfg: LiveFillConfig, front: number | null, onsetFixed: number | null = null): LivePlan | null {
  const onset = onsetFixed ?? wake.separation?.x ?? null;
  if (onset === null || (onsetFixed === null && (!wake.separation || !wake.run))) return null;
  const xs = stationX(g);
  const xOn = Math.max(onset, cfg.leReserve);
  const xTe = g.chord - cfg.teReserve;
  const fr = Math.min(xTe, front === null ? onset + cfg.frontSpeed : front);
  // three passes of the three-point filter: the gap of one station is a few hundred particle samples, and a ripple of 0.3 d in it is noise
  const gap = smoothProfile(smoothProfile(smoothProfile(gapAtStations(g, wake))));
  const raw = xs.map((x, i) => {
    if (!isFree(g, i)) return 0;
    if (x < xOn - 1e-9) return 0;
    if (x >= xTe || x >= fr + cfg.taper) return 0;
    // material goes into the band around the front only: from `behind` behind it, easing in, to `taper` ahead of it, easing out
    const w = smooth((x - xOn) / Math.max(1e-6, cfg.ramp)) * smooth((x - (fr - cfg.behind)) / Math.max(1e-6, cfg.behind)) * (1 - smooth((x - fr) / Math.max(1e-6, cfg.taper)));
    return Math.min(cfg.maxStep, cfg.relaxation * Math.max(0, gap[i] - cfg.margin)) * w;
  });
  // the increment itself is smoothed too (and cut off again where nothing may be added), so that the surface gets a smooth bump, not a comb
  const sm = smoothProfile(smoothProfile(raw));
  const delta = sm.map((v, i) => (isFree(g, i) && xs[i] >= xOn - 1e-9 && xs[i] < xTe && xs[i] < fr + cfg.taper ? Math.min(cfg.maxStep, v) : 0));
  const treated = xs.map((x, i) => (x >= xOn - 1e-9 && x <= fr + 1e-9 ? gap[i] : null)).filter((v): v is number => v !== null);
  return {
    delta,
    onset,
    front: fr,
    maxGap: treated.length ? Math.max(...treated) : 0,
    meanGap: treated.length ? treated.reduce((a, b) => a + b, 0) / treated.length : 0,
  };
}

/**
 * Cap the increment so that no particle is overrun. `particles` are the particle centres in the BODY frame
 * (x along the chord, y across it) and `radius` their radius. At each particle the new surface may rise only to
 * (its distance from the old surface) − radius − clearance, measured along the normal; the two stations on either
 * side of it are capped to that, and a gentle slope limit between neighbours then keeps the capped increment smooth.
 */
export function capByParticles(g: SurfaceGeometry, side: Side, delta: number[], particles: { x: number; y: number }[], radius: number, clearance: number, slopeStep = 0.3): { delta: number[]; capped: number } {
  const n = g.stations;
  const xs = stationX(g);
  const y = sideY(g, side);
  const sign = side === 'upper' ? 1 : -1;
  const out = delta.slice();
  let capped = 0;
  for (const p of particles) {
    if (p.x < 0 || p.x > g.chord) continue;
    const i = segmentAt(g, p.x);
    const dx = xs[i + 1] - xs[i];
    const f = (p.x - xs[i]) / dx;
    const y0 = y[i] + f * (y[i + 1] - y[i]);
    const slope = (y[i + 1] - y[i]) / dx;
    const dOut = sign * (p.y - y0);
    if (dOut < 0) continue; // behind or inside the surface: another matter, not ours to move
    const allow = Math.max(0, dOut - (radius + clearance) * Math.sqrt(1 + slope * slope));
    // the increment at the particle's x (linear between the two stations) must not exceed `allow`
    const here = (1 - f) * out[i] + f * out[i + 1];
    if (here <= allow + 1e-12) continue;
    if (out[i] > allow) out[i] = allow;
    if (out[i + 1] > allow) out[i + 1] = allow;
    capped++;
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i <= n; i++) {
      const left = i > 0 ? out[i - 1] + slopeStep : Infinity;
      const right = i < n ? out[i + 1] + slopeStep : Infinity;
      out[i] = Math.min(out[i], left, right);
    }
  }
  return { delta: out, capped };
}

/** The geometry with `delta` (times `scale`) added on one side. */
export function applyDelta(g: SurfaceGeometry, side: Side, delta: number[], scale = 1): SurfaceGeometry {
  const out = cloneGeometry(g);
  const y = sideY(out, side);
  const sign = side === 'upper' ? 1 : -1;
  for (let i = 0; i < y.length; i++) y[i] += sign * delta[i] * scale;
  return out;
}

/**
 * Fit the increment to the geometry limits LOCALLY, so one tight spot does not stop the rest.
 *   slope      projected exactly: neighbouring increments may differ only as far as the surface may still rise or fall by
 *              `maxSlope` per unit of chord (forward and backward passes);
 *   curvature, thickness  where the limit is still exceeded, the increments at and next to the offending station are
 *              reduced (×0.6) and the check repeated.
 * Increments are never negative (material is only added), so the result is always between "nothing added" and the plan.
 * Returns the geometry and the fraction of the planned material that survived, or the first limit that stopped it.
 */
export function fitToLimits(g: SurfaceGeometry, side: Side, delta: number[], limits: GeometryLimits): { geometry: SurfaceGeometry; scale: number } | { reason: string } {
  const n = g.stations;
  const xs = stationX(g);
  const sign = side === 'upper' ? 1 : -1;
  const h = sideY(g, side).map((v) => sign * v);
  const d = delta.map((v, i) => (isFree(g, i) ? Math.max(0, v) : 0));
  const S = Array.from({ length: n }, (_, i) => limits.maxSlope * (xs[i + 1] - xs[i]));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) d[i + 1] = Math.max(0, Math.min(d[i + 1], d[i] + S[i] - (h[i + 1] - h[i])));
    for (let i = n - 1; i >= 0; i--) d[i] = Math.max(0, Math.min(d[i], d[i + 1] + S[i] + (h[i + 1] - h[i])));
  }
  let reason = '';
  for (let iter = 0; iter < 40; iter++) {
    const cand = applyDelta(g, side, d, 1);
    const issues = validateGeometry(cand, limits);
    if (issues.length === 0) {
      const planned = delta.reduce((a, v) => a + Math.max(0, v), 0);
      const kept = d.reduce((a, v) => a + v, 0);
      return { geometry: cand, scale: planned > 0 ? kept / planned : 1 };
    }
    if (!reason) reason = issues[0].message;
    for (const is of issues) {
      const m = /(segment|station) (\d+)/.exec(is.message);
      if (!m) return { reason: is.message };
      const k = Number(m[2]);
      const lo = m[1] === 'segment' ? k : k - 1;
      const hi = m[1] === 'segment' ? k + 1 : k + 1;
      for (let q = Math.max(0, lo); q <= Math.min(n, hi); q++) d[q] *= 0.6;
    }
  }
  return { reason: reason || 'no room' };
}
