import { describe, expect, it } from 'vitest';
import { compareVersions } from '../src/geometry/Compare';
import { FLOW_GEOMETRY_QUICK, FlowGeometryExperiment, type FlowGeometryParams } from '../src/experiments/FlowGeometryExperiment';
import { attachRun, headVersion, newProject, undo, version } from '../src/geometry/History';
import { anchorOf, DEFAULT_POINTER_STEP, initialPaths, plateGeometry, pointerOf, type PlateSpec } from '../src/geometry/Pointer';
import { measuredPointerStep } from '../src/geometry/PointerMeasure';
import { addPointerVersion } from '../src/geometry/PointerVersion';
import { replayFrames } from '../src/geometry/History';
import { runSummaryFromRecord } from '../src/geometry/RunSummary';
import { stationX, validateGeometry } from '../src/geometry/SurfaceGeometry';

/** Small non-judged runs of the real engine on the rounded plate (about 700 particles, a few seconds each). */
const plate: PlateSpec = { length: 20, thickness: 3 };
const tiny = (g = plateGeometry(plate)): FlowGeometryParams => ({ ...FLOW_GEOMETRY_QUICK, geometry: g, alphaDeg: 40, length: 100, height: 60, startup: 25, measure: 48, blocks: 6, seeds: [11, 12], cell: 4 });

const simulate = (p: ReturnType<typeof newProject>) => {
  const h = headVersion(p);
  const rec = new FlowGeometryExperiment(tiny(h.geometry)).runToCompletion();
  return attachRun(p, h.id, runSummaryFromRecord(rec, { codeVersion: 'test', activeMs: 1 }));
};

describe('the rounded plate and the pointer on the real engine', () => {
  const paths = initialPaths(plate);
  const base = (): ReturnType<typeof newProject> => newProject('sweep', { ...tiny(), geometry: undefined, seeds: undefined }, plateGeometry(plate, paths, 1), undefined, { plate, paths, spacing: 1 });

  it('simulates the rounded plate: integrity passes, the detector and wake analyses cover every station, the force points downstream and up', () => {
    const p = simulate(base());
    const run = headVersion(p).run!;
    expect(run.integrity.status).toBe('PASSED');
    expect(run.wake).toBeTruthy();
    const g = headVersion(p).geometry;
    expect(run.wake!.upper.stations.length).toBe(g.stations);
    // station centres of the analysis follow the (non-uniform) stations of the geometry
    const xs = stationX(g);
    run.wake!.upper.stations.forEach((s, k) => expect(s.x).toBeCloseTo(0.5 * (xs[k] + xs[k + 1]), 9));
    expect(run.forces.fx.mean).toBeGreaterThan(0);
    expect(run.forces.fy.mean).toBeGreaterThan(0);
  });

  it('sweeps the pointer from the leading edge to the anchor: simulate, step by the measurement, simulate …, and keeps every version', () => {
    let p = base();
    const cfg = { ...DEFAULT_POINTER_STEP, step: 6 };
    let steps = 0;
    for (let guard = 0; guard < 8; guard++) {
      p = simulate(p);
      const h = headVersion(p);
      const m = measuredPointerStep(h, 'upper', cfg);
      if (!m.ok) {
        expect(m.done).toBe(true);
        break;
      }
      const out = addPointerVersion(p, { side: 'upper', to: m.st.to, decision: { kind: 'measurement', step: m.st, recordId: h.run!.recordId, versionId: h.id, seeds: h.run!.seeds, summary: m.summary, detector: 'wake-void/0' } });
      p = out.project;
      steps++;
      // every step moved the pointer forward by the step, never below the plate
      expect(out.version.construction!.pointer!.to.x).toBeGreaterThan(out.version.construction!.pointer!.from.x);
      expect(out.version.construction!.pointer!.to.y).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(out.version.run).toBeNull();
      expect(out.version.construction!.pointer!.measured!.recordId).toBe(h.run!.recordId);
    }
    const h = headVersion(p);
    expect(pointerOf(h.shape!.paths, 'upper')).toEqual(anchorOf(plate));
    expect(steps).toBe(Math.ceil(anchorOf(plate).x / 6));
    expect(p.versions.length).toBe(steps + 1);
    // the surface is the rounded plate plus added material only
    const g0 = plateGeometry(plate);
    h.geometry.upper.forEach((y, i) => expect(y).toBeGreaterThanOrEqual(g0.upper[i] - 1e-9));
    expect(h.geometry.lower).toEqual(g0.lower);
    // each version keeps its own pointer path; the history can be replayed
    expect(replayFrames(p).length).toBeGreaterThan(steps);
    // and the first moved version compares with its parent: the stated prediction gets one of the four outcomes
    const first = p.versions[1];
    const parentRun = simulate({ ...p, head: first.id });
    const c = compareVersions(version(parentRun, 'v0'), version(parentRun, first.id));
    expect(['supported', 'contradicted', 'unresolved', 'not applicable']).toContain(c.hypothesis!.outcome);
  });

  it('undo returns to the parent and the undone pointer version stays in the record', () => {
    let p = base();
    p = addPointerVersion(p, { side: 'upper', to: { x: 4, y: 2.5 }, decision: { kind: 'hand' } }).project;
    expect(p.head).toBe('v1');
    p = undo(p);
    expect(p.head).toBe('v0');
    expect(version(p, 'v1').undone).not.toBeNull();
  });

  it('refuses a pointer move on a version that was not drawn by the pointer (after an increment of the older rules)', () => {
    const p = base();
    // an older-rule increment drops the pointer description (the geometry is no longer plate + pointer path)
    expect(() => addPointerVersion({ ...p, versions: p.versions.map((v) => ({ ...v, shape: undefined })) }, { side: 'upper', to: { x: 4, y: 2.5 }, decision: { kind: 'hand' } })).toThrow(/not drawn by the pointer/);
  });

  it('the older increment rules still work on the free stretch of the rounded plate and leave its round ends alone', async () => {
    const { DEFAULT_CONSTRUCTION, proposeIncrement } = await import('../src/geometry/Construction');
    const p = simulate(base());
    const run = headVersion(p).run!;
    const stations = run.analysis.upper.primary.stations.map((s) => ({ x: s.x, h: 3, se: 0.3, state: 'closed' as const, qw: s.qw.mean, u1: s.u1.mean }));
    const g = headVersion(p).geometry;
    const basis = { side: 'upper' as const, mode: 'exploratory' as const, detector: 'x', level: 'x', region: { xLo: 2, xHi: 14 }, stations, source: { recordId: null, seeds: [], versionId: 'v0' }, summary: 's' };
    const r = proposeIncrement(g, basis, { ...DEFAULT_CONSTRUCTION, teReserve: 1 }, 'p');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [lo, hi] = g.free!;
      for (const q of r.proposal.points) expect(q.index >= lo && q.index <= hi).toBe(true);
      const geo = (await import('../src/geometry/Construction')).applyProposal(g, r.proposal, r.proposal.points.length - 1).geometry;
      expect(validateGeometry(geo)).toEqual([]);
      expect(geo.upper[0]).toBe(0);
    }
  });
});
