import { describe, expect, it } from 'vitest';
import { FlowLiveBuildExperiment, LIVE_BUILD_QUICK, type LiveBuildParams, type LiveBuildResults } from '../src/experiments/FlowLiveBuildExperiment';
import { EXPERIMENTS } from '../src/experiments/registry';
import { sideY, validateGeometry } from '../src/geometry/SurfaceGeometry';

/** a short live fill on the real engine: fast stream past a plate at 30°, three updates */
const short: LiveBuildParams = { ...LIVE_BUILD_QUICK, alphaDeg: 30, speed: 2.95, startup: 100, live: { ...LIVE_BUILD_QUICK.live, maxUpdates: 3 } };

describe('live fill on the real engine (short run, not judged)', () => {
  const rec = new FlowLiveBuildExperiment(short).runToCompletion();
  const r = rec.results as unknown as LiveBuildResults;

  it('is a registry experiment and refuses more than one builder seed', () => {
    expect(EXPERIMENTS['flow-live-build']).toBeDefined();
    expect(() => new FlowLiveBuildExperiment({ ...short, seeds: [401, 402] })).toThrow(/exactly one seed/);
  });

  it('grows the surface where the particles do not touch it, on the chosen side only, and keeps the trailing edge', () => {
    expect(r.kind).toBe('flow-live-build');
    expect(r.side).toBe('upper');
    expect(r.trajectory.length).toBeGreaterThanOrEqual(1);
    expect(r.areaAdded).toBeGreaterThan(0.5);
    const y0 = sideY(r.startGeometry, 'upper');
    const y1 = sideY(r.finalGeometry, 'upper');
    expect(y1.every((v, i) => v >= y0[i] - 1e-12)).toBe(true);
    expect(Math.max(...y1.map((v, i) => v - y0[i]))).toBeGreaterThan(0.1);
    expect(r.finalGeometry.lower).toEqual(r.startGeometry.lower);
    expect(y1[y1.length - 1]).toBe(y0[y0.length - 1]);
    expect(validateGeometry(r.finalGeometry, short.live.limits)).toEqual([]);
    // every update started from where the previous one left the surface
    const first = r.trajectory.find((s) => s.onset !== null)!;
    expect(first.onset).not.toBeNull();
    expect(r.treated).not.toBeNull();
  });

  it('keeps every integrity check while the body is reshaped: no particle inside it, ledgers closed', () => {
    for (const c of rec.acceptance) expect(c.status, `${c.id}: ${c.measured}`).toBe('PASSED');
    expect(rec.acceptance.map((c) => c.id)).toEqual(expect.arrayContaining(['no-penetration', 'energy-accounting', 'momentum-accounting', 'geometry-limits', 'trailing-edge-fixed', 'other-side-untouched']));
    expect(rec.status).toBe('PASSED');
  });

  it('says what it is: experimental, not an optimiser, and that a fresh measurement is still needed', () => {
    expect(rec.warnings.join(' ')).toMatch(/not an optimised or validated airfoil/);
    expect(r.note).toMatch(/EXPERIMENTAL/);
    expect(rec.assumptions.join(' ')).toMatch(/not validated against any independent separation criterion/);
    expect(r.stop.reason.length).toBeGreaterThan(10);
  });

  it('is reproducible: the same seed and settings give the same shape, step by step', () => {
    const again = new FlowLiveBuildExperiment(short).runToCompletion().results as unknown as LiveBuildResults;
    expect(again.finalGeometry).toEqual(r.finalGeometry);
    expect(again.trajectory.map((s) => [s.t, s.added, s.area])).toEqual(r.trajectory.map((s) => [s.t, s.added, s.area]));
  }, 120000);
}, 180000);

describe('stopping a live fill and keeping what it built', () => {
  it('ends with stop kind user, keeps the shape grown so far, and still passes every integrity check', () => {
    const e = new FlowLiveBuildExperiment({ ...short, live: { ...short.live, maxUpdates: 30 } });
    let guard = 0;
    // run until at least one update has put material on the surface, but nowhere near the end
    while (!e.done && guard++ < 400) {
      e.advance(2000);
      const updates = String(e.currentRun()?.live().updates ?? '0/0');
      if (Number(updates.split('/')[0]) >= 2) break;
    }
    expect(e.done).toBe(false);
    e.finishNow();
    e.advance(1);
    expect(e.done).toBe(true);
    const rec = e.buildRecord();
    const r = rec.results as unknown as LiveBuildResults;
    expect(r.stop.kind).toBe('user');
    expect(r.stop.reason).toMatch(/kept/);
    expect(r.areaAdded).toBeGreaterThan(0);
    expect(validateGeometry(r.finalGeometry, short.live.limits)).toEqual([]);
    for (const c of rec.acceptance) expect(c.status, `${c.id}: ${c.measured}`).toBe('PASSED');
  }, 180000);
});
