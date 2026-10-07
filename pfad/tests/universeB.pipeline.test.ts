import { describe, expect, it } from 'vitest';
import { henderson, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { runPipeline, type FrozenJudged } from '../src/universeB/UB0Pipeline';
import { ub0Plan, type PlannedRun } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Result } from '../src/universeB/UB0Run';

/**
 * Plumbing test of the judged pipeline on MINIATURE versions of every judged
 * configuration: tiny boxes, short windows, design seeds 9601+ (never judged),
 * 2 planned + 2 reserve per group. Nothing physical is asserted or printed;
 * the test checks that the chain from records to verdicts runs, that an
 * exclusion requests the right reserve, and that the extension is guarded.
 */
const KT = henderson.KTred(UB0_PHI);
const n = UB0_PHI / (Math.PI / 4);
const S = (value: number, se: number, k: number) => ({ value, se, df: k - 1, n: k });
const frozen: FrozenJudged = {
  KTred: KT,
  cA: 2.17,
  cRatio: { 4: [1.05, 1.2], 16: [1.0, 1.05], 64: [1.0, 1.02] },
  judgedGamma: { 4: [1.0, 1.3], 16: [0.95, 1.11], 64: [0.95, 1.07] },
  What160: { 4: 0.99, 16: 0.97, 64: 0.9 },
  WhatShells: { 4: [0.99, 0.98], 16: [0.97, 0.94] },
  rpaStrength: { 4: 3 * KT, 16: 15 * KT },
  rho: n,
  A: { nuL80: S(1.38, 0.005, 48), nuL160: S(1.38, 0.005, 12), KT: S(KT * n, 0.003, 16), SA: [S(0.42, 0.005, 8), S(0.45, 0.005, 8)] },
};

function miniature(): PlannedRun[] {
  const full = ub0Plan(frozen, { reserve: true });
  const out: PlannedRun[] = [];
  const seen = new Map<string, { p: number; r: number }>();
  let seed = 9601;
  for (const p of full) {
    const c = seen.get(p.group) ?? { p: 0, r: 0 };
    if (p.planned ? c.p >= 2 : c.r >= 2) continue;
    if (p.planned) c.p++;
    else c.r++;
    seen.set(p.group, c);
    const h = p.ch * Math.sqrt(p.Nc);
    const side = Math.max(14, Math.ceil(3.1 * h));
    const q: PlannedRun = { ...p, seed, id: `mini-${p.group}-${seed}`, prep: 0.5, settle: p.kind === 'wall' || p.kind === 'couette' ? 0 : 0.3 };
    seed++;
    if (q.kind === 'wall' || q.kind === 'couette') {
      q.width = side;
      q.measure = 3;
    } else {
      q.L = side;
      q.measure = q.kind === 'static' ? 3 : q.kind === 'shear' ? 4 : 4;
    }
    if (q.kind === 'sound') q.periodHint = 1;
    out.push(q);
  }
  return out;
}

function exec(p: PlannedRun): UB0Result {
  const { group, planned, periodHint, ...spec } = p;
  void group;
  void planned;
  void periodHint;
  const run = new UB0Run(spec);
  while (!run.done) run.advance(5000);
  return run.result();
}

describe('judged pipeline plumbing (miniature design-seed runs)', () => {
  it('runs from records to verdicts, requests reserves, guards the extension', { timeout: 600_000 }, () => {
    const plan = miniature();
    expect(new Set(plan.map((p) => p.group)).size).toBe(31);
    const store = new Map<string, UB0Result>();
    for (const p of plan.filter((q) => q.planned)) store.set(p.id, exec(p));
    // force one exclusion: a halted planned run must call up the group's first reserve
    const victim = plan.find((p) => p.group === 'T16a1' && p.planned)!;
    const halted = JSON.parse(JSON.stringify(store.get(victim.id))) as UB0Result;
    halted.info.halted = 1;
    store.set(victim.id, halted);
    const load = (id: string) => store.get(id) ?? null;
    const need = runPipeline(plan, load, frozen);
    expect(need.status).toBe('need-runs');
    const reserve = plan.filter((p) => p.group === 'T16a1' && !p.planned)[0];
    if (need.status === 'need-runs') expect(need.toRun).toEqual([reserve.id]);
    store.set(reserve.id, exec(reserve));
    const done = runPipeline(plan, load, frozen);
    expect(done.status).toBe('done');
    if (done.status !== 'done') return;
    expect(done.selections.T16a1.excluded.map((e) => e.id)).toEqual([victim.id]);
    expect(done.selections.T16a1.over10pct).toBe(true); // 1 of 3 examined
    expect(done.final.labels).toContain('F0'); // > 10 % excluded in a bulk configuration
    expect(['PASS', 'PARTIAL PASS', 'INCONCLUSIVE', 'FAIL', 'VOID']).toContain(done.final.overall);
    expect(['F5-impl', 'F5-phys', 'INCONCLUSIVE', 'VOID']).toContain(done.wall.verdict);
    expect(Object.keys(done.diagnostics)).toHaveLength(31);
    // the extension: only first-look candidates may be extended
    const notEligible = ['pq1.4', 'pq2.16', 'pq6b'].find((k) => !done.candidates.includes(k))!;
    expect(() => runPipeline(plan, load, frozen, [notEligible])).toThrow(/not make eligible/);
    if (done.candidates.length) {
      // an eligible extension first calls up the remaining reserves of its groups
      const ext = runPipeline(plan, load, frozen, [done.candidates[0]]);
      expect(ext.status).toBe('need-runs');
    }
    // a changed spec on disk is refused
    const tampered = JSON.parse(JSON.stringify(store.get(plan[0].id))) as UB0Result;
    tampered.spec.measure += 1;
    expect(() => runPipeline(plan, (id) => (id === plan[0].id ? tampered : load(id)), frozen)).toThrow(/differs from the plan/);
  });
});
