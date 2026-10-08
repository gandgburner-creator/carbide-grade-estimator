import { describe, expect, it } from 'vitest';
import { henderson, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { runPipeline, type FrozenJudged } from '../src/universeB/UB0Pipeline';
import { DESIGN_COUNTS, ub0Plan, type PlannedRun } from '../src/universeB/UB0Plans';
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
  version: 'A2',
  KTred: KT,
  cA: { 4: 2.17, 16: 2.17, 64: 2.17 },
  soundAmplitude: 0.02,
  cRatio: { 4: [1.05, 1.2], 16: [1.0, 1.05], 64: [1.0, 1.02] },
  judgedGamma: { 4: [1.0, 1.3], 16: [0.95, 1.11], 64: [0.95, 1.07] },
  What160: { 4: 0.99, 16: 0.97, 64: 0.9 },
  WhatShells: { 4: [0.99, 0.98], 16: [0.97, 0.94] },
  rpaStrength: { 4: 3 * KT, 16: 15 * KT },
  rho: n,
  A: {
    nu: { 4: S(1.38, 0.005, 200), 16: S(1.38, 0.005, 200), 64: S(1.38, 0.005, 100) },
    KT: S(KT * n, 0.003, 16),
    SA: { 4: [S(0.42, 0.005, 16), S(0.45, 0.005, 16)], 16: [S(0.42, 0.005, 32), S(0.45, 0.005, 32)] },
  },
};

function miniature(): PlannedRun[] {
  // a synthetic FINAL count table (the design counts); the real one comes from scripts/ub0-power.ts after Stage 0b
  const full = ub0Plan(frozen, { status: 'final', n: DESIGN_COUNTS }, { reserve: true });
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
    const q: PlannedRun = { ...p, seed, id: `mini-${p.group}-${seed}`, prep: 0.5, settle: p.kind === 'wall' ? 0 : 0.3 };
    seed++;
    if (q.kind === 'wall') {
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
    expect(new Set(plan.map((p) => p.group)).size).toBe(29); // Couette deferred to UB-0W (A2 §1.6)
    expect(plan.some((p) => p.group === 'T4dt')).toBe(true);
    const store = new Map<string, UB0Result>();
    for (const p of plan.filter((q) => q.planned)) store.set(p.id, exec(p));
    // force one exclusion: a halted planned run must call up the group's first reserve
    const halt = (id: string) => {
      const h = JSON.parse(JSON.stringify(store.get(id))) as UB0Result;
      h.info.halted = 1;
      store.set(id, h);
    };
    const [victim, victim2] = plan.filter((p) => p.group === 'T16a1' && p.planned);
    halt(victim.id);
    const load = (id: string) => store.get(id) ?? null;
    const need = runPipeline(plan, load, frozen);
    expect(need.status).toBe('need-runs');
    const [reserve, reserve2] = plan.filter((p) => p.group === 'T16a1' && !p.planned);
    if (need.status === 'need-runs') expect(need.toRun).toEqual([reserve.id]);
    store.set(reserve.id, exec(reserve));
    const one = runPipeline(plan, load, frozen);
    expect(one.status).toBe('done');
    if (one.status !== 'done') return;
    expect(one.selections.T16a1.excluded.map((e) => e.id)).toEqual([victim.id]);
    // A2 §4: a single exclusion, replaced from the reserve, does not void (1 of 3 examined)
    expect(one.selections.T16a1.excessExclusions).toBe(false);
    expect(one.first.outcomes.excessExclusions).toBe(false);
    // a second exclusion in the same group does: 2 > max(1, 10 % of 4)
    halt(victim2.id);
    store.set(reserve2.id, exec(reserve2));
    const done = runPipeline(plan, load, frozen);
    expect(done.status).toBe('done');
    if (done.status !== 'done') return;
    expect(done.selections.T16a1.excluded.map((e) => e.id)).toEqual([victim.id, victim2.id]);
    expect(done.selections.T16a1.excessExclusions).toBe(true);
    expect(done.final.labels).toContain('F0');
    expect(['PASS', 'PARTIAL PASS', 'INCONCLUSIVE', 'FAIL', 'VOID']).toContain(done.final.overall);
    expect(['F5-impl', 'F5-phys', 'INCONCLUSIVE', 'VOID']).toContain(done.wall.verdict);
    expect(Object.keys(done.diagnostics)).toHaveLength(29);
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
