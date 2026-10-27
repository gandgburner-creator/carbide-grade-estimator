import { describe, expect, it } from 'vitest';
import { LabSession } from '../src/app/LabSession';
import type { ExperimentRecord } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';
import { UBInstrumentExperiment, type UBInstrumentCheckpoint, type UBInstrumentParams } from '../src/experiments/UBInstrumentExperiment';
import type { Frame, FromWorker } from '../src/workers/protocol';

/** LabSession driven headless against the real engine (what the worker does in the browser). */
function harness() {
  const out: FromWorker[] = [];
  let clock = 0;
  const s = new LabSession((m) => out.push(m), { now: () => (clock += 1), frameMs: 0 });
  const frames = () => out.filter((m): m is Frame => m.type === 'frame');
  const last = <T extends FromWorker['type']>(type: T) => [...out].reverse().find((m) => m.type === type) as Extract<FromWorker, { type: T }> | undefined;
  return { s, out, frames, last };
}

const tinyBox = { ...EXPERIMENTS['static-box']!.quick, count: 120, restitutions: [1], measurementCollisions: 4, decayMaxCollisions: 6, seeds: [3] };

describe('LabSession with the real engine', () => {
  it('runs a small static box end to end: frames, fields, wall transfer, history, record', () => {
    const { s, frames, last } = harness();
    s.handle({ type: 'init', experiment: 'static-box', params: tinyBox, epoch: 1 });
    s.handle({ type: 'view', field: 'kT', perCell: 20, average: true, trails: false, profile: { x0: -1e9, x1: 1e9, bins: 4 } });
    s.handle({ type: 'run' });
    let guard = 0;
    while (s.running && guard++ < 100000) s.tick();
    const rec = last('record');
    expect(rec, 'record emitted').toBeDefined();
    expect(rec!.epoch).toBe(1);
    expect(rec!.activeMs).toBeGreaterThan(0);
    expect(rec!.record.experimentType).toBe('static-box');
    expect(rec!.record.seeds).toEqual([3]);
    const f = frames().filter((x) => x.field && x.field.snapshots > 3).pop()!;
    expect(f.field!.kind).toBe('kT');
    expect(f.field!.t1).toBeGreaterThan(f.field!.t0);
    expect(f.transfer!.walls).toHaveLength(4);
    // wall pressure from impulses is positive in a closed elastic box
    expect(f.transfer!.walls.every((w) => w.pressure > 0 && w.hits > 0)).toBe(true);
    expect(f.history.t.length).toBeGreaterThan(2);
    expect(Object.keys(f.history.columns)).toEqual(expect.arrayContaining(['energy residual (rel.)', 'P_wall left (running mean)']));
    expect(f.profile!.y).toHaveLength(4);
    expect(f.profile!.snapshots).toBeGreaterThan(0);
    const final = frames().pop()!;
    expect(final.finished).toBe(true);
    expect(final.progress).toBe(1);
  });

  it('the same seed and configuration reproduce the same measured results', () => {
    const run = () => {
      const { s, last } = harness();
      s.handle({ type: 'init', experiment: 'static-box', params: tinyBox, epoch: 1 });
      s.handle({ type: 'run' });
      while (s.running) s.tick();
      return last('record')!.record;
    };
    expect(JSON.stringify(run().results)).toBe(JSON.stringify(run().results));
  });

  it('STOP reports an incomplete run without a record; an unknown experiment is an error', () => {
    const { s, out, last } = harness();
    s.handle({ type: 'init', experiment: 'static-box', params: tinyBox, epoch: 2 });
    s.handle({ type: 'step', steps: 10 });
    s.handle({ type: 'stop' });
    expect(last('stopped')!.message).toMatch(/incomplete/);
    expect(out.some((m) => m.type === 'record')).toBe(false);
    s.handle({ type: 'init', experiment: 'nope' as never, params: {}, epoch: 3 });
    expect(last('error')!.message).toMatch(/not implemented/);
  });

  it('checkpoints are refused for experiments that cannot resume', () => {
    const { s, last } = harness();
    s.handle({ type: 'init', experiment: 'static-box', params: tinyBox, epoch: 1 });
    s.handle({ type: 'checkpoint' });
    expect(last('error')!.message).toMatch(/only the UB-0 instrument/);
  });
});

const tinyStatic: UBInstrumentParams = { ...(EXPERIMENTS['ub-instrument']!.quick as UBInstrumentParams), L: 12, prep: 4, settle: 1, measure: 8, sample: 1, seeds: [101, 102] };

describe('UB-0 instrument through the session', () => {
  it('the session refuses Universe B (N_c > 1) and loads nothing', () => {
    const { s, last } = harness();
    s.handle({ type: 'init', experiment: 'ub-instrument', params: { ...tinyStatic, Nc: 16 }, epoch: 1 });
    expect(last('error')!.message).toMatch(/Universe B .* is locked/);
    expect(s.loaded).toBe(false);
  });

  it('checkpoint → resume continues bit for bit', () => {
    const full = new UBInstrumentExperiment(tinyStatic).runToCompletion();
    const { s, last } = harness();
    s.handle({ type: 'init', experiment: 'ub-instrument', params: tinyStatic, epoch: 1 });
    let f: Frame | null = null;
    // into the second seed, so the checkpoint carries a finished run and a run in progress
    while (!f || f.runIndex < 1 || f.progress < 0.6) {
      s.handle({ type: 'step', steps: 200 });
      f = s.frame(true);
    }
    expect(f.progress).toBeLessThan(1);
    s.handle({ type: 'checkpoint' });
    const cp = JSON.parse(JSON.stringify(last('checkpoint')!.state)) as UBInstrumentCheckpoint;
    expect(cp.index).toBe(1);
    expect(cp.results).toHaveLength(1);
    expect(cp.run).not.toBeNull();
    const { s: s2, last: last2 } = harness();
    s2.handle({ type: 'init', experiment: 'ub-instrument', params: tinyStatic, epoch: 5, resume: cp });
    s2.handle({ type: 'run' });
    while (s2.running) s2.tick();
    const resumed = last2('record')!.record as ExperimentRecord;
    expect(JSON.stringify((resumed.results as { perSeed: unknown }).perSeed)).toBe(JSON.stringify((full.results as { perSeed: unknown }).perSeed));
  });
});
