import { describe, expect, it } from 'vitest';
import { chooseNext, nextAutoAction, type AutoAction } from '../src/geometry/AutoBuild';
import { DEFAULT_CONSTRUCTION, proposeIncrement } from '../src/geometry/Construction';
import { acceptProposal, attachRun, headVersion, newProject, recordProposal, type Project, type RunSummary } from '../src/geometry/History';
import { flatPlate } from '../src/geometry/SurfaceGeometry';
import { analyseSurfaceFlow, type SurfaceFlowAnalysis } from '../src/measurements/SeparationDetector';
import { attached, synth } from './helpers/synthFlow';

type Prof = (k: number, j: number) => number;
const bubble =
  (amp: number): Prof =>
  (k, j) =>
    k >= 10 && k <= 19 ? (j < 4 ? -amp : 0.9) : attached(j);
const weakBubble: Prof = (k, j) => (k >= 8 && k <= 21 ? (j < 4 ? -0.05 : 0.9) : attached(j));
const calm: Prof = (_k, j) => attached(j);

const analysis = (u: Prof, seeds: number, seed: number, side: 'upper' | 'lower'): SurfaceFlowAnalysis =>
  analyseSurfaceFlow(synth({ seeds, u: (_r, _b, k, j) => u(k, j), tau: (_r, _b, k) => (k >= 8 && k <= 21 && u(k, 0) < 0.3 ? -0.04 : 0.02) }, seed), side);

function run(upper: Prof, lower: Prof, opts: { seeds?: number; seed?: number; status?: RunSummary['integrity']['status']; recordId?: string } = {}): RunSummary {
  const seeds = opts.seeds ?? 3;
  const seed = opts.seed ?? 50;
  return {
    recordId: opts.recordId ?? 'r', experimentId: 'r', seeds: [1, 2, 3].slice(0, seeds), finishedAt: 't', activeMs: 1, codeVersion: 'abc', modelVersion: '0.2', conditions: { alphaDeg: 65 },
    integrity: { status: opts.status ?? 'PASSED', maxEnergyResidual: 1e-14, maxMomentumResidual: 1e-15, halted: 0, insideDetections: 0 },
    analysis: { upper: analysis(upper, seeds, seed, 'upper'), lower: analysis(lower, seeds, seed + 1, 'lower') },
    forces: { fx: { mean: 5, se: 0.1, n: 48 }, fy: { mean: 2, se: 0.1, n: 48 }, moment: { mean: 0, se: 1, n: 48 } },
  };
}
const src = { recordId: 'r', versionId: 'v0' };

describe('auto-build: which stretch to respond to', () => {
  it('prefers a detector region over weak evidence, and the side with the stronger measured backflow', () => {
    const r = run(bubble(0.3), bubble(0.8));
    expect(r.analysis.upper.level).not.toBe('NONE');
    const d = chooseNext(r.analysis, true, src);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.choice.mode).toBe('detector');
    expect(d.choice.side).toBe('lower');
    const other = chooseNext(run(bubble(0.8), bubble(0.3)).analysis, true, src);
    expect(other.ok && other.choice.side).toBe('upper');
  });

  it('uses weak (below-evidence) measurements only when allowed, and says so', () => {
    const r = run(weakBubble, calm, { seeds: 2, seed: 60 });
    expect(['NONE', 'REDUCED_FORWARD_VELOCITY', 'LOCAL_REVERSAL']).toContain(r.analysis.upper.level);
    const allowed = chooseNext(r.analysis, true, src);
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.choice.mode).toBe('exploratory');
      expect(allowed.choice.side).toBe('upper');
      expect(allowed.choice.basis.summary).toMatch(/EXPLORATORY/);
    }
    const off = chooseNext(r.analysis, false, src);
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toMatch(/switched off/);
  });

  it('stops with a reason when nothing is measured on either side', () => {
    const d = chooseNext(run(calm, calm).analysis, true, src);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toMatch(/nothing is measured to respond to/);
      expect(d.reason).toMatch(/upper:/);
      expect(d.reason).toMatch(/lower:/);
    }
  });
});

describe('auto-build: what happens next', () => {
  const head = (r: RunSummary | null, over: Partial<{ target: number; done: number; allowWeak: boolean }> = {}) => nextAutoAction({ target: 3, done: 0, allowWeak: true, headRun: r, headId: 'v0', ...over });

  it('simulates an unsimulated version first', () => {
    expect(head(null)).toEqual({ kind: 'simulate' });
  });
  it('refuses to build on a run that failed its integrity checks', () => {
    const a = head(run(bubble(0.6), calm, { status: 'FAILED' }));
    expect(a).toMatchObject({ kind: 'stop', stop: 'failed' });
  });
  it('proposes while increments remain, and finishes when the requested number is reached', () => {
    const r = run(bubble(0.6), calm);
    expect(head(r, { done: 0 }).kind).toBe('propose');
    expect(head(r, { done: 2 }).kind).toBe('propose');
    const fin = head(r, { done: 3 });
    expect(fin).toMatchObject({ kind: 'stop', stop: 'finished' });
  });
  it('stops when nothing is measured', () => {
    expect(head(run(calm, calm))).toMatchObject({ kind: 'stop', stop: 'nothing-measured' });
  });
  it('is a pure function of its state', () => {
    const r = run(bubble(0.6), calm);
    expect(JSON.stringify(head(r))).toBe(JSON.stringify(head(r)));
  });
});

/** Drive the real history reducers with the auto-build decisions and synthetic simulations. */
function drive(target: number, results: (version: string, index: number) => RunSummary, allowWeak = true): { project: Project; stop: AutoAction & { kind: 'stop' }; steps: string[] } {
  let p = newProject('auto', { alphaDeg: 65 }, flatPlate(30, 3));
  let done = 0;
  const steps: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const h = headVersion(p);
    const a = nextAutoAction({ target, done, allowWeak, headRun: h.run ?? null, headId: h.id });
    if (a.kind === 'stop') return { project: p, stop: a, steps };
    if (a.kind === 'simulate') {
      p = attachRun(p, h.id, results(h.id, done));
      steps.push(`simulated ${h.id}`);
      continue;
    }
    const id = `${h.id}-p${p.proposals.length + 1}`;
    const r = proposeIncrement(h.geometry, a.choice.basis, a.choice.mode === 'exploratory' ? { ...DEFAULT_CONSTRUCTION, shrink: 0 } : DEFAULT_CONSTRUCTION, id);
    if (!r.ok) return { project: p, stop: { kind: 'stop', stop: 'limit', reason: r.reason }, steps };
    p = recordProposal(p, r.proposal);
    p = acceptProposal(p, id, undefined, `auto-build increment ${done + 1} of ${target}`).project;
    done++;
    steps.push(`accepted ${id} (${a.choice.mode}, ${a.choice.side})`);
  }
  throw new Error('auto-build did not stop');
}

describe('auto-build against the real history', () => {
  it('adds the requested increments, simulating each version, and then stops as finished', () => {
    const { project, stop, steps } = drive(2, (_v, i) => run(bubble(0.6), calm, { seed: 70 + i }));
    expect(stop.stop).toBe('finished');
    expect(project.versions.map((v) => v.id)).toEqual(['v0', 'v1', 'v2']);
    expect(project.head).toBe('v2');
    expect(project.versions.every((v) => v.run)).toBe(true);
    expect(project.versions.slice(1).map((v) => v.parent)).toEqual(['v0', 'v1']);
    expect(project.proposals.every((q) => q.status === 'accepted')).toBe(true);
    expect(project.proposals.map((q) => q.note)).toEqual(['auto-build increment 1 of 2', 'auto-build increment 2 of 2']);
    expect(steps.filter((s) => s.startsWith('simulated')).length).toBe(3);
    // the shape really changed, and only on the side with the measured backflow
    const g = headVersion(project).geometry;
    expect(Math.max(...g.upper.map((y, i) => y - flatPlate(30, 3).upper[i]))).toBeGreaterThan(1);
    expect(g.lower).toEqual(flatPlate(30, 3).lower);
  });

  it('stops with a plain reason when a further increment would break the geometry limits, keeping what was built', () => {
    const { project, stop } = drive(6, (_v, i) => run(bubble(0.6), calm, { seed: 70 + i }));
    expect(stop).toMatchObject({ kind: 'stop', stop: 'limit' });
    expect(stop.reason).toMatch(/geometry limits/);
    expect(project.versions.length).toBeGreaterThanOrEqual(2);
    expect(project.versions.length).toBeLessThan(7);
    expect(project.versions.every((v) => v.run)).toBe(true);
  });

  it('stops by itself when a re-simulation measures nothing, keeping everything built so far', () => {
    const { project, stop } = drive(5, (_v, i) => (i === 0 ? run(bubble(0.6), calm) : run(calm, calm, { seed: 90 + i })));
    expect(stop.stop).toBe('nothing-measured');
    expect(project.versions.map((v) => v.id)).toEqual(['v0', 'v1']);
    expect(headVersion(project).run).toBeTruthy();
  });

  it('stops at once, and builds nothing, when the first measurement shows nothing', () => {
    const { project, stop } = drive(3, () => run(calm, calm));
    expect(stop.stop).toBe('nothing-measured');
    expect(project.versions.length).toBe(1);
    expect(project.proposals.length).toBe(0);
  });

  it('does nothing when weak evidence is not allowed and the detector sees no region', () => {
    const { project, stop } = drive(3, () => run(weakBubble, calm, { seeds: 2, seed: 60 }), false);
    expect(stop.stop).toBe('nothing-measured');
    expect(project.versions.length).toBe(1);
  });

  it('records every automatic step with its evidence mode', () => {
    const { project } = drive(2, () => run(weakBubble, calm, { seeds: 2, seed: 60 }));
    expect(project.versions.length).toBe(3);
    for (const v of project.versions.slice(1)) expect(v.construction!.mode).toBe('exploratory');
  });
});
