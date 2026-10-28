import { describe, expect, it } from 'vitest';
import { LabSession } from '../src/app/LabSession';
import { compareVersions } from '../src/geometry/Compare';
import { DEFAULT_CONSTRUCTION, proposeIncrement, type ConstructionBasis } from '../src/geometry/Construction';
import { acceptProposal, attachRun, headVersion, newProject, recordProposal, undo, version } from '../src/geometry/History';
import { runSummaryFromRecord } from '../src/geometry/RunSummary';
import { flatPlate } from '../src/geometry/SurfaceGeometry';
import { EXPERIMENTS, runFromRecord } from '../src/experiments/registry';
import { FLOW_GEOMETRY_QUICK, FlowGeometryExperiment, type FlowGeometryParams, type FlowGeometryResults } from '../src/experiments/FlowGeometryExperiment';
import type { FromWorker } from '../src/workers/protocol';

/** Small non-judged runs of the real engine (about 700 particles, a few seconds each). */
const tiny: FlowGeometryParams = { ...FLOW_GEOMETRY_QUICK, geometry: flatPlate(20, 3), alphaDeg: 40, length: 100, height: 60, startup: 25, measure: 48, blocks: 6, seeds: [11, 12], cell: 4 };

describe('the flow-geometry experiment on the real engine', () => {
  const rec = new FlowGeometryExperiment(tiny).runToCompletion();
  const res = rec.results as unknown as FlowGeometryResults;

  it('produces a record with measurements, the detector output, forces, fields and integrity checks', () => {
    expect(rec.experimentType).toBe('flow-geometry');
    expect(rec.seeds).toEqual([11, 12]);
    expect(rec.acceptance.map((c) => [c.id, c.status])).toEqual([
      ['numerical-safety', 'PASSED'],
      ['no-penetration', 'PASSED'],
      ['energy-accounting', 'PASSED'],
      ['momentum-accounting', 'PASSED'],
      ['no-empty-space', 'PASSED'],
    ]);
    expect(rec.warnings[0]).toMatch(/numerical-integrity checks of these runs only/);
    expect(rec.assumptions.join(' ')).toMatch(/has not been validated/);
    expect(res.detector).toBe('wall-flux-detector/0');
    expect(res.geometry).toEqual(tiny.geometry);
    expect(res.surfaceFlow!.upper.primary.stations.length).toBe(10); // 20 base stations, merged by 2
    expect(res.surfaceFlow!.upper.provisional).toBe(true);
    expect(res.surfaceFlow!.upper.data.seeds).toEqual([11, 12]);
    expect(res.surfaceFlow!.upper.primary.stations.every((s) => Number.isFinite(s.u1.mean) && Number.isFinite(s.qw.mean) && Number.isFinite(s.tau.mean))).toBe(true);
    // wall momentum transfer: the pressure on the windward (lower) side is positive and larger than on the lee side
    const mean = (side: 'upper' | 'lower') => res.surfaceFlow![side].primary.stations.reduce((a, s) => a + s.pressure.mean, 0) / res.surfaceFlow![side].primary.stations.length;
    expect(mean('lower')).toBeGreaterThan(0);
    expect(mean('lower')).toBeGreaterThan(mean('upper'));
    // force on the body points downstream (+x drag) and, at a positive angle of attack, upward
    expect(res.forces.fx.mean).toBeGreaterThan(0);
    expect(res.forces.fy.mean).toBeGreaterThan(0);
    expect(res.fields!.density.length).toBe(res.fields!.nx * res.fields!.ny);
    expect(res.regime.note).toMatch(/ESTIMATES/);
    expect(res.regime.knudsenChord).toBeGreaterThan(0.1); // slip/transitional, not a continuum boundary layer
    expect(res.perSeed.map((s) => s.seed)).toEqual([11, 12]);
    expect(rec.config).toEqual(tiny);
  });

  it('the same configuration and seeds reproduce the same measured results exactly, also through runFromRecord', () => {
    const again = new FlowGeometryExperiment(tiny).runToCompletion();
    expect(JSON.stringify(again.results)).toBe(JSON.stringify(rec.results));
    const replay = runFromRecord(rec);
    expect(JSON.stringify(replay.results)).toBe(JSON.stringify(rec.results));
  });

  it('is registered with quick and reference setups, and its parameters are the documented set', () => {
    const e = EXPERIMENTS['flow-geometry']!;
    expect(e.quick.geometry.chord).toBe(30);
    expect(e.defaults.geometry.chord).toBe(60);
    expect(e.quick.detector.id).toBe('wall-flux-detector/0');
    expect(() => new FlowGeometryExperiment({ ...tiny, blocks: 2 })).toThrow(/at least 4 blocks/);
  });
});

describe('the construction loop on real simulation output (flat → measured → proposal → accepted → simulated → compared)', () => {
  it('runs end to end and keeps the history', () => {
    const rec0 = new FlowGeometryExperiment(tiny).runToCompletion();
    let project = newProject('slice', { ...tiny, geometry: undefined, seeds: undefined }, tiny.geometry);
    project = attachRun(project, 'v0', runSummaryFromRecord(rec0, { codeVersion: 'test', activeMs: 1 }));
    const run0 = headVersion(project).run!;
    expect(run0.analysis.upper.primary.stations.length).toBeGreaterThan(0);
    expect(run0.integrity.status).toBe('PASSED');

    // a measured basis from the real record's stations (the detector's level on this run is whatever it is);
    // the stretch is chosen by hand because a tiny run has no detection to follow — recorded as exploratory
    const stations = run0.analysis.upper.primary.stations.map((s) => ({ x: s.x, h: 4, se: 0.5, state: 'closed' as const, qw: s.qw.mean, u1: s.u1.mean }));
    const basis: ConstructionBasis = {
      side: 'upper',
      mode: 'exploratory',
      detector: run0.analysis.upper.detector,
      level: run0.analysis.upper.level,
      region: { xLo: 4, xHi: 13 },
      stations,
      source: { recordId: run0.recordId, seeds: run0.seeds, versionId: 'v0' },
      summary: 'integration test basis (hand-chosen stretch on a tiny run)',
    };
    const cfg = { ...DEFAULT_CONSTRUCTION, shrink: 0, ramp: 3, taper: 3, teReserve: 3 };
    const r = proposeIncrement(tiny.geometry, basis, cfg, 'p1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    project = recordProposal(project, r.proposal);
    project = acceptProposal(project, 'p1').project;
    const v1 = headVersion(project);
    expect(v1.parent).toBe('v0');
    expect(v1.geometry.upper).not.toEqual(tiny.geometry.upper);

    // simulate the accepted geometry under the same conditions and seeds
    const rec1 = new FlowGeometryExperiment({ ...tiny, geometry: v1.geometry }).runToCompletion();
    expect((rec1.results as unknown as FlowGeometryResults).geometry).toEqual(v1.geometry);
    project = attachRun(project, 'v1', runSummaryFromRecord(rec1, { codeVersion: 'test', activeMs: 1 }));
    expect(rec1.acceptance.every((c) => c.status === 'PASSED')).toBe(true);

    const cmp = compareVersions(version(project, 'v0'), version(project, 'v1'));
    expect(cmp.conditionChanges).toEqual([]);
    expect(cmp.sharedSeeds).toEqual([11, 12]);
    expect(cmp.hypothesis!.side).toBe('upper');
    expect(['supported', 'contradicted', 'unresolved', 'not applicable']).toContain(cmp.hypothesis!.outcome);
    expect(cmp.sides.upper.stations.length).toBe(10);
    expect(cmp.indicators.map((i) => i.id)).toEqual(['fx', 'fy', 'qw-upper', 'qw-lower', 'contact-upper', 'contact-lower']);
    // the flow around the changed upper surface differs measurably from the original (the geometry matters to the measurement)
    expect(cmp.sides.upper.stations.some((s) => Math.abs(s.u1.diff) > 0 || Math.abs(s.qw.diff) > 0)).toBe(true);

    // undo returns to the flat plate and keeps both runs in the record
    const back = undo(project);
    expect(back.head).toBe('v0');
    expect(version(back, 'v1').run).not.toBeNull();
    expect(back.log.map((e) => e.type)).toEqual(['created', 'run-finished', 'proposed', 'accepted', 'run-finished', 'undone']);
  });
});

describe('the session runs the experiment (what the worker does in the browser)', () => {
  it('streams frames with the body polygon and the wall momentum transfer, then the record', () => {
    const out: FromWorker[] = [];
    let clock = 0;
    const s = new LabSession((m) => out.push(m), { now: () => (clock += 1), frameMs: 0 });
    s.handle({ type: 'init', experiment: 'flow-geometry', params: { ...tiny, seeds: [11], startup: 10, measure: 24, blocks: 4 }, epoch: 1 });
    s.handle({ type: 'run' });
    let guard = 0;
    while (s.running && guard++ < 100000) s.tick();
    const frames = out.filter((m) => m.type === 'frame') as Extract<FromWorker, { type: 'frame' }>[];
    expect(frames.length).toBeGreaterThan(2);
    const mid = frames[Math.floor(frames.length / 2)];
    expect(mid.bodies.length).toBe(1);
    expect(mid.bodies[0].vertices.length / 2).toBe(2 * (tiny.geometry.stations + 1));
    expect(mid.transfer!.bodies.length).toBe(1);
    expect(mid.live.phase === 'start-up' || mid.live.phase === 'measuring').toBe(true);
    const rec = out.find((m) => m.type === 'record') as Extract<FromWorker, { type: 'record' }>;
    expect(rec.record.experimentType).toBe('flow-geometry');
    expect(frames[frames.length - 1].finished).toBe(true);
  });
});
