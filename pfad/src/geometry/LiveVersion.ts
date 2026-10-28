import type { ConstructionBasis, ConstructionConfig, PathPoint } from './Construction';
import { headVersion, type GeometryVersion, type Project } from './History';
import type { LiveBuildSummary } from './LiveFill';
import { sideY, stationX } from './SurfaceGeometry';

const now = () => new Date().toISOString();

/**
 * Add the shape a live fill grew as a new version of the project (a child of the current head). The version is
 * tagged `live-fill`, keeps the whole story of the fill (every update, why it stopped, the builder seed and the
 * settings), and has no run yet: what the new shape does in the flow is measured by simulating it like any other
 * version. Nothing is deleted; undo returns to the parent and keeps this version in the record.
 */
export function addLiveVersion(p: Project, live: LiveBuildSummary, at = now()): { project: Project; version: GeometryVersion } {
  const parent = headVersion(p);
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(parent.geometry.upper, live.startGeometry.upper) || !same(parent.geometry.lower, live.startGeometry.lower)) {
    throw new Error(`the live fill started from a different geometry than the current head ${parent.id}`);
  }
  const g = parent.geometry;
  const y0 = sideY(g, live.side);
  const y1 = sideY(live.finalGeometry, live.side);
  const xs = stationX(g);
  const gapStart = live.wakeStart ? live.wakeStart.stations.map((s) => (s.unwetted ? s.gap : 0)) : [];
  const points: PathPoint[] = [];
  for (let i = 0; i < y0.length; i++) {
    const d = Math.abs(y1[i] - y0[i]);
    if (d <= 1e-9) continue;
    const gap = gapStart.length ? 0.5 * ((gapStart[Math.max(0, i - 1)] ?? 0) + (gapStart[Math.min(gapStart.length - 1, i)] ?? 0)) : Number.NaN;
    points.push({ index: i, x: xs[i], yOld: y0[i], yNew: y1[i], deltaNormal: d, measured: gap, measuredSE: Number.NaN, weight: Number.NaN });
  }
  if (points.length === 0) throw new Error('the live fill added no material: there is no new version to keep');
  const cfg = live.config;
  const config: ConstructionConfig = { relaxation: cfg.relaxation, maxStep: cfg.maxStep, shrink: 0, ramp: cfg.ramp, taper: cfg.taper, leReserve: cfg.leReserve, teReserve: cfg.teReserve, limits: cfg.limits };
  const treated = live.treated ?? { xLo: points[0].x, xHi: points[points.length - 1].x };
  const w = live.wakeStart;
  const basis: ConstructionBasis = {
    side: live.side,
    mode: 'live-fill',
    detector: 'wake-void/0',
    level: 'UNWETTED SURFACE (experimental)',
    region: { xLo: treated.xLo, xHi: treated.xHi },
    stations: w
      ? w.stations.map((s) => ({ x: s.x, h: s.unwetted ? s.gap : 0, se: Number.NaN, state: s.unwetted ? (s.gap >= 12 ? ('open' as const) : ('closed' as const)) : ('attached' as const), qw: Number.NaN, u1: Number.NaN }))
      : [],
    source: { recordId: live.recordId, seeds: [live.seed], versionId: parent.id },
    summary: w?.separation
      ? `Wake void (wake-void/0, experimental): at the first measurement the particles had stopped touching the ${live.side} surface from x = ${w.separation.x.toFixed(1)} d on, and the particle cloud stood off it by ${w.meanGap.toFixed(1)} d on average over that stretch (contact-layer density ${(w.meanContact * 100).toFixed(0)} % of the free stream). Builder seed ${live.seed}.`
      : `Live fill on the ${live.side} side, builder seed ${live.seed}.`,
  };
  const step = p.versions.filter((v) => v.origin === 'constructed').length + 1;
  const id = `v${p.versions.length}`;
  const kinds = live.trajectory.filter((s) => s.added > 0).length;
  const v: GeometryVersion = {
    id,
    parent: parent.id,
    origin: 'constructed',
    label: `step ${step}: live fill, ${live.side} side, x = ${points[0].x.toFixed(1)}–${points[points.length - 1].x.toFixed(1)} d`,
    createdAt: at,
    geometry: live.finalGeometry,
    construction: {
      step,
      proposalId: `${parent.id}-live`,
      side: live.side,
      mode: 'live-fill',
      acceptedPoints: points.length,
      totalPoints: points.length,
      partial: false,
      reason:
        `Grown during one simulation (builder seed ${live.seed}): from the separation point toward the trailing edge, ${kinds} of ${live.trajectory.length} updates added material, at most ${cfg.maxStep} d per station per update, only into space without particles. ` +
        `Stopped because ${live.stop.reason}. ${basis.summary}`,
      hypothesis:
        `Filling the void that stands behind the separation point out to the particle cloud should make the particles touch the new surface again: in a fresh simulation of the new shape, the density of the contact layer ` +
        `(relative to the free stream) over x = ${treated.xLo.toFixed(1)}–${treated.xHi.toFixed(1)} d should be higher than on the old one. Untested: the next simulation decides, and the void may simply move downstream.`,
      basis,
      config,
      scale: 1,
      points,
      live: { recordId: live.recordId, seed: live.seed, stop: live.stop, updates: live.trajectory.length, config: live.config, trajectory: live.trajectory },
    },
    run: null,
    undone: null,
  };
  return {
    version: v,
    project: {
      ...p,
      versions: [...p.versions, v],
      head: id,
      log: [...p.log, { t: at, type: 'accepted', version: id, detail: `live fill on the ${live.side} side added ${points.length} points over ${live.trajectory.length} updates (${live.stop.kind}: ${live.stop.reason})` }],
    },
  };
}
