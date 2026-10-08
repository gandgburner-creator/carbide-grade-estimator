import { describe, expect, it } from 'vitest';
import {
  assertDisjoint,
  DESIGN_COUNTS,
  pilotPlan,
  seedBlocks,
  stage0bContingency,
  stage0bGroups,
  stage0bPlan,
  STAGE0B_SEED_START,
  stage0Groups,
  stage0Plan,
  ub0Groups,
  ub0Plan,
  UB0_SEED_START,
  type FrozenInputs,
  type SeedCounts,
} from '../src/universeB/UB0Plans';

/** Seed allocation (A2 §6) and the Stage 0b plan (docs/CRITERIA_UB0_STAGE0B.md §3). */
const F: FrozenInputs = { version: 'A2', KTred: 2.37564, cA: { 4: 2.2, 16: 2.19, 64: 2.19 }, cRatio: { 4: [0.7247, 0.7875], 16: [0.7039, 0.7247], 64: [0.7026, 0.7081] }, soundAmplitude: 0.04 };
const counts = (status: SeedCounts['status'], bump: Record<string, number> = {}): SeedCounts => ({ status, n: { ...DESIGN_COUNTS, ...bump } });

describe('the judged seed plan is generated from the power plan', () => {
  it('refuses a provisional power plan', () => {
    expect(() => ub0Plan(F, counts('provisional'))).toThrow(/FINAL/);
    expect(ub0Plan(F, counts('provisional'), { allowProvisional: true }).length).toBeGreaterThan(0);
  });
  it('is deterministic: the same inputs give the identical plan', () => {
    const c = counts('final', { T4a1: 238, T4a05: 476 });
    expect(ub0Plan(F, c, { reserve: true })).toEqual(ub0Plan(F, c, { reserve: true }));
  });
  it('contiguous blocks of 2n per group from 20001, planned first, no seed reused', () => {
    const c = counts('final', { T4a1: 238, T4a05: 476, L64: 21, W4c2: 38 });
    const plan = ub0Plan(F, c, { reserve: true });
    const seeds = plan.map((p) => p.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(Math.min(...seeds)).toBe(UB0_SEED_START);
    expect(seeds.length).toBe(2 * Object.values(c.n).reduce((s, x) => s + x, 0));
    const blocks = seedBlocks(ub0Groups(F, c), UB0_SEED_START);
    let next = UB0_SEED_START;
    for (const b of blocks) {
      expect(b.planned[0]).toBe(next);
      expect(b.planned[1] - b.planned[0] + 1).toBe(c.n[b.group]);
      expect(b.reserve[0]).toBe(b.planned[1] + 1);
      expect(b.reserve[1] - b.reserve[0] + 1).toBe(c.n[b.group]);
      next = b.reserve[1] + 1;
      const inGroup = plan.filter((p) => p.group === b.group);
      expect(inGroup.filter((p) => p.planned).every((p) => p.seed >= b.planned[0] && p.seed <= b.planned[1])).toBe(true);
      expect(inGroup.filter((p) => !p.planned).every((p) => p.seed >= b.reserve[0] && p.seed <= b.reserve[1])).toBe(true);
    }
  });
  it('rejects a count below the design count', () => {
    expect(() => ub0Groups(F, counts('final', { T4a1: 47 }))).toThrow(/design count/);
  });
  it('each seed is tied to one configuration (its id, group and spec)', () => {
    const plan = ub0Plan(F, counts('final'), { reserve: true });
    for (const p of plan) expect(p.id).toBe(`ub0-${p.group}-${p.seed}`);
    // the sound amplitude and length come from the frozen inputs (A2: per-N_c matched c_A, the Stage 0b amplitude)
    const L4 = plan.find((p) => p.group === 'L4')!;
    const cMid = F.cA[4] * 0.5 * (F.cRatio[4][0] + F.cRatio[4][1]) * 2;
    expect(L4.amplitude).toBeCloseTo(0.04 * cMid, 12);
    expect(L4.periodHint).toBeCloseTo(160 / (F.cA[4] * F.cRatio[4][0] * 2), 12);
  });
});

describe('seed blocks across UB-0 are disjoint', () => {
  it('tests and design seeds, Stage 0, Stage 0b, judged', () => {
    const s0 = stage0Plan({ reserve: true }).map((p) => p.seed);
    const s0b = [...stage0bPlan({ phase: 1, reserve: true }), ...stage0bPlan({ phase: 2, amplitude: 0.02, reserve: true })].map((p) => p.seed);
    const j = ub0Plan(F, counts('final', { T4a1: 238, T4a05: 476, T16a1: 238, T16a05: 476, T16e08: 168, T16e095: 168 }), { reserve: true }).map((p) => p.seed);
    const pil = pilotPlan(F).map((p) => p.seed);
    const r = (name: string, xs: number[]) => ({ name, range: [Math.min(...xs), Math.max(...xs)] as [number, number] });
    expect(() => assertDisjoint([{ name: 'design', range: [9001, 9999] }, r('Stage 0', s0), r('Stage 0b', s0b), r('judged', j)])).not.toThrow();
    expect(pil.every((s) => s >= 9501 && s <= 9999)).toBe(true);
    expect(() => assertDisjoint([{ name: 'a', range: [1, 10] }, { name: 'b', range: [10, 20] }])).toThrow(/overlap/);
  });
});

describe('the Stage 0b plan (Universe A only)', () => {
  const p1 = stage0bPlan({ phase: 1, reserve: true });
  const p2a = stage0bPlan({ phase: 2, amplitude: 0.02, reserve: true });
  const p2b = stage0bPlan({ phase: 2, amplitude: 0.04, reserve: true });
  it('is Universe A only, from 11001, with unique seeds', () => {
    const all = [...p1, ...p2a];
    expect(all.every((s) => s.Nc === 1 && s.e === 1)).toBe(true);
    expect(Math.min(...all.map((s) => s.seed))).toBe(STAGE0B_SEED_START);
    expect(new Set(all.map((s) => s.seed)).size).toBe(all.length);
  });
  it('the reference groups at Courant 0.025 have exactly Stage 0\'s specs, so they pool with Stage 0', () => {
    const s0 = Object.fromEntries(stage0Groups(0.025).map((g) => [g.group, g.base]));
    for (const g of ['T80a1', 'T160a1', 'SL', 'W40', 'L160']) {
      const d = stage0bGroups().find((x) => x.group === g)!;
      expect(d.base).toEqual(s0[g]);
    }
  });
  it('the amplitude study and the timestep checks', () => {
    const d = Object.fromEntries(stage0bGroups(0.04).map((g) => [g.group, g]));
    expect(d.L160a04.base.amplitude).toBeCloseTo(0.04 * 2.17, 12);
    expect(d.L160.base.amplitude).toBeCloseTo(0.02 * 2.17, 12);
    expect(d.T80a1c0125.base.courant).toBe(0.0125);
    expect(d.T80a1c00625.base.courant).toBe(0.00625);
    expect(d.SLc00625.base.courant).toBe(0.00625);
    for (const g of ['SK18c0125', 'SK22c0125']) expect(d[g].base.courant).toBe(0.0125);
    for (const g of ['SK18c00625', 'SK22c00625']) expect(d[g].base.courant).toBe(0.00625);
    expect(d.L160c0125.base.amplitude).toBeCloseTo(0.04 * 2.17, 12);
    expect(d.L160c00625.base.courant).toBe(0.00625);
  });
  it('phase-2 seeds do not depend on the amplitude decision; phase 2 needs the decision', () => {
    expect(p2a.map((p) => p.seed)).toEqual(p2b.map((p) => p.seed));
    expect(p2a.map((p) => p.id)).toEqual(p2b.map((p) => p.id));
    expect(p2a[0].amplitude).not.toBe(p2b[0].amplitude);
    expect(() => stage0bPlan({ phase: 2 })).toThrow(/amplitude/);
    expect(new Set([...p1, ...p2a].map((p) => p.seed)).size).toBe(p1.length + p2a.length);
  });
  it('the planned counts of the protocol (§3)', () => {
    const n = Object.fromEntries(stage0bGroups().map((g) => [g.group, g.n]));
    expect(n).toEqual({
      T80a1: 106, T160a1: 88, SL: 24, W40: 28, L160: 17, L160a04: 32,
      T80a1c0125: 200, T80a1c00625: 100, SK18c0125: 8, SK22c0125: 8, SK18c00625: 8, SK22c00625: 8, SLc00625: 16,
      L160c0125: 16, L160c00625: 32,
    });
    // with Stage 0's used runs: T80a1 94 + 106 = 200, T160a1 12 + 88 = 100, SL 8 + 24 = 32, W40 4 + 28 = 32, L160 15 + 17 = 32
  });
  it('the contingency (§8): fixed seeds from 12401 whatever is needed, disjoint from phases 1 and 2', () => {
    const all = stage0bContingency(['N4-static', 'N16-static', 'N64-shear'], 0.04).plan;
    const s4 = stage0bContingency(['N4-static'], 0.04);
    expect(Math.min(...all.map((p) => p.seed))).toBe(12401);
    expect(Math.max(...all.map((p) => p.seed))).toBe(12792);
    for (const p of s4.plan) expect(all.find((q) => q.id === p.id)?.seed).toBe(p.seed);
    expect([...new Set(s4.plan.map((p) => p.group))].sort()).toEqual(['L160c003125', 'SK18c003125', 'SK22c003125', 'SLc003125']);
    expect(s4.plan.every((p) => p.courant === 0.003125 && p.Nc === 1)).toBe(true);
    expect(s4.plan.find((p) => p.group === 'L160c003125')!.amplitude).toBeCloseTo(0.04 * 2.17, 12);
    expect(stage0bContingency(['N4-shear'], 0.02)).toEqual({ plan: [], activateReserves: ['T80a1c00625'] });
    expect(stage0bContingency(['W16c2'], 0.02)).toEqual({ plan: [], activateReserves: [] });
    const main = [...stage0bPlan({ phase: 1, reserve: true }), ...stage0bPlan({ phase: 2, amplitude: 0.02, reserve: true })].map((p) => p.seed);
    expect(Math.max(...main)).toBeLessThan(12401);
  });
});
