import { describe, expect, it } from 'vitest';
import {
  armRatio,
  bulkVerdict,
  centralDifference,
  equivalence,
  failureLabels,
  overallCategory,
  pq1,
  pq2,
  pq3,
  pq4,
  pq5,
  pq6c,
  pq7,
  pq8,
  ratioCI,
  sRPA,
  wallConfig,
  wallVerdict,
  type BulkOutcomes,
} from '../src/universeB/UB0Analysis';
import type { Stat } from '../src/universeB/UB0Stage0';

const S = (value: number, se: number, n = 24): Stat => ({ value, se, df: n - 1, n });
/** n seeds with a given mean and an exact sample SD */
function seeds(meanV: number, sd: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(meanV + sd * (i % 2 === 0 ? 1 : -1) * Math.sqrt((n - 1) / n));
  return out;
}

describe('UB-0 decision rules on synthetic data', () => {
  it('equivalence: PASS inside, FAIL entirely outside, INCONCLUSIVE straddling', () => {
    expect(equivalence([0.95, 1.05], [0.9, 1.1])).toBe('PASS');
    expect(equivalence([1.11, 1.2], [0.9, 1.1])).toBe('FAIL');
    expect(equivalence([0.8, 0.89], [0.9, 1.1])).toBe('FAIL');
    expect(equivalence([1.05, 1.15], [0.9, 1.1])).toBe('INCONCLUSIVE');
    expect(equivalence([NaN, 1], [0.9, 1.1])).toBe('INCONCLUSIVE');
  });

  it('ratio CI: log-symmetric, contains the ratio, widens with either SE', () => {
    const r = ratioCI(S(1.0, 0.01), S(1.0, 0.01));
    expect(r.estimate).toBe(1);
    expect(r.ci[0] * r.ci[1]).toBeCloseTo(1, 12);
    const wider = ratioCI(S(1.0, 0.01), S(1.0, 0.03));
    expect(wider.ci[1]).toBeGreaterThan(r.ci[1]);
  });

  it('PQ1 PASS / FAIL / INCONCLUSIVE', () => {
    const nuA = S(1.38, 0.007, 48);
    expect(pq1(seeds(1.40, 0.05, 48), nuA).outcome).toBe('PASS');
    expect(pq1(seeds(1.70, 0.05, 48), nuA).outcome).toBe('FAIL');
    expect(pq1(seeds(1.52, 0.10, 48), nuA).outcome).toBe('INCONCLUSIVE');
  });

  it('PQ2 adds the full Universe A SE (a larger A SE widens the interval)', () => {
    const KB = S(0.61, 0.006, 16);
    const a = pq2(KB, S(0.6, 0.001, 16));
    const b = pq2(KB, S(0.6, 0.02, 16));
    expect(b.interval.ci[1] - b.interval.ci[0]).toBeGreaterThan(a.interval.ci[1] - a.interval.ci[0]);
    expect(a.outcome).toBe('PASS');
  });

  it('central difference matches the formula', () => {
    const k = centralDifference(seeds(1.0, 0.01, 8), seeds(1.2, 0.01, 8));
    expect(k.value).toBeCloseTo((0.2 / 0.04) * 0.2, 12);
  });

  it('PQ3 outcomes against the judged band', () => {
    const rho = 0.2546;
    // Γ = ρ c²/K; choose K so Γ ≈ 1.10
    const c = S(1.6, 0.002, 4);
    const K = S((rho * 1.6 * 1.6) / 1.1, 0.002, 16);
    expect(pq3(c, K, rho, [1.01, 1.30]).outcome).toBe('P-INC');
    expect(pq3(c, K, rho, [1.2, 1.3]).outcome).toBe('T-FAIL-low');
    expect(pq3(c, K, rho, [0.9, 1.0]).outcome).toBe('T-FAIL-high');
    expect(pq3(S(1.6, 0.2, 4), K, rho, [1.05, 1.15]).outcome).toBe('INCONCLUSIVE');
  });

  it('PQ4 needs both equipartition and a₂', () => {
    expect(pq4(seeds(1.0, 0.005, 24), seeds(0.0, 0.005, 24)).outcome).toBe('PASS');
    expect(pq4(seeds(1.06, 0.005, 24), seeds(0.0, 0.005, 24)).outcome).toBe('FAIL');
    expect(pq4(seeds(1.0, 0.005, 24), seeds(0.05, 0.005, 24)).outcome).toBe('FAIL');
  });

  it('PQ5: RPA formula and the two-shell rule', () => {
    expect(sRPA(0.42, 0, 1)).toBeCloseTo(0.42, 12);
    // with the occupancy term the parcel S falls; at k → 0 it is S_A/N_c (n_p k_s a = (N_c − 1)/S_A)
    expect(sRPA(0.42, 3 / 0.42, 1)).toBeCloseTo(0.42 / 4, 12);
    const SA = [S(0.42, 0.005, 8), S(0.44, 0.005, 8)];
    const pred = [sRPA(0.42, 3 / 0.42, 0.998), sRPA(0.44, 3 / 0.42, 0.996)];
    const ok = pq5([seeds(pred[0], 0.002, 4), seeds(pred[1], 0.002, 4)], SA, 3 / 0.42, [0.998, 0.996]);
    expect(ok.outcome).toBe('PASS');
    const bad = pq5([seeds(pred[0] * 1.3, 0.002, 4), seeds(pred[1], 0.002, 4)], SA, 3 / 0.42, [0.998, 0.996]);
    expect(bad.outcome).toBe('FAIL');
  });

  it('PQ6 arms and PQ6c needs both ν and K', () => {
    expect(armRatio(seeds(1.4, 0.03, 48), seeds(1.4, 0.03, 96), [0.95, 1.05]).outcome).toBe('PASS');
    expect(armRatio(seeds(1.6, 0.03, 48), seeds(1.4, 0.03, 48), [0.95, 1.05]).outcome).toBe('FAIL');
    const r = pq6c(seeds(1.4, 0.03, 24), seeds(1.4, 0.03, 48), S(0.6, 0.004, 16), S(0.6, 0.004, 16));
    expect(r.outcome).toBe('PASS');
    expect(pq6c(seeds(1.4, 0.03, 24), seeds(1.4, 0.03, 48), S(0.8, 0.004, 16), S(0.6, 0.004, 16)).outcome).toBe('FAIL');
  });

  it('PQ7 gates, drift ratio and dt arm', () => {
    const g = { id: 'a', momentumResidual: 1e-12, drift: 0.001, driftLimit: 0.01, unexplainedLateContacts: 0, halted: false };
    const ok = pq7([g], [4e-4, 4e-4], [1e-4, 1e-4], seeds(1.4, 0.03, 48), seeds(1.4, 0.03, 48));
    expect(ok.violations).toHaveLength(0);
    expect(ok.c).toBe('PASS');
    expect(ok.d.outcome).toBe('PASS');
    const bad = pq7([{ ...g, drift: 0.02 }, { ...g, id: 'b', momentumResidual: 1e-6 }], [2e-4], [1e-4], seeds(1.4, 0.03, 48), seeds(1.5, 0.03, 48));
    expect(bad.violations.map((v) => v.id)).toEqual(['a', 'b']);
    expect(bad.c).toBe('FAIL');
    expect(bad.d.outcome).toBe('FAIL');
  });

  it('PQ8 threshold at 0.20', () => {
    expect(pq8(seeds(0.08, 0.02, 48)).outcome).toBe('PASS');
    expect(pq8(seeds(0.3, 0.02, 48)).outcome).toBe('FAIL');
    expect(pq8(seeds(0.19, 0.05, 6)).outcome).toBe('INCONCLUSIVE');
  });

  it('wall verdict: VOID on a gate failure, F5-impl / F5-phys / INCONCLUSIVE on R', () => {
    const good = (R: number) => wallConfig(Array.from({ length: 4 }, (_, i) => ({ gw1: 1 + (i % 2 ? 1e-4 : -1e-4), gw2: 1 + (i % 2 ? 1e-3 : -1e-3), gw3: 1, R: R + (i % 2 ? 0.01 : -0.01) })));
    expect(wallVerdict(good(1.0), good(1.02))).toBe('F5-impl');
    expect(wallVerdict(good(1.0), good(1.5))).toBe('F5-phys');
    expect(wallVerdict(good(1.0), good(1.09))).toBe('INCONCLUSIVE');
    const broken = wallConfig(Array.from({ length: 4 }, (_, i) => ({ gw1: 1.1 + (i % 2 ? 1e-4 : -1e-4), gw2: 1, gw3: 1, R: 1 })));
    expect(wallVerdict(broken, good(1.0))).toBe('VOID');
  });
});

function allPass(): BulkOutcomes {
  return {
    pq1: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
    pq1Estimate: { 4: 1.0, 16: 1.0, 64: 1.0 },
    pq2: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
    pq2Estimate: { 4: 1.0, 16: 1.0, 64: 1.0 },
    pq2ArmC4: 'PASS',
    pq1ArmC4: 'PASS',
    pq3: { 4: 'P-INC', 16: 'P-INC', 64: 'P-INC' },
    pq4: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
    pq5: { 4: 'PASS', 16: 'PASS' },
    pq6a: { 4: 'PASS', 16: 'PASS' },
    pq6b: 'PASS',
    pq6c: 'PASS',
    pq8: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
    pq8Estimate: { 4: 0.05, 16: 0.05, 64: 0.05 },
    pq7Violations: 0,
    pq7c: 'PASS',
    pq7d: 'PASS',
    excessExclusions: false,
    orderingFlag: false,
  };
}

describe('UB-0 failure labels and verdicts', () => {
  it('all primaries passing gives PASS with no labels', () => {
    const o = allPass();
    expect(failureLabels(o)).toEqual([]);
    expect(bulkVerdict(o)).toBe('PASS');
    expect(overallCategory(o)).toBe('PASS');
  });

  it('F0 voids everything', () => {
    const o = { ...allPass(), pq7Violations: 2 };
    expect(failureLabels(o)[0]).toBe('F0');
    expect(bulkVerdict(o)).toBe('VOID');
    expect(overallCategory(o)).toBe('VOID');
  });

  it('F3: occupancy-borne shear stress, or ν depending on e — a FAIL', () => {
    const o = { ...allPass(), pq8: { 4: 'PASS', 16: 'FAIL', 64: 'PASS' } as BulkOutcomes['pq8'] };
    expect(failureLabels(o)).toContain('F3');
    expect(overallCategory(o)).toBe('FAIL');
    const e = { ...allPass(), pq6b: 'FAIL' as const };
    expect(failureLabels(e)).toContain('F3');
  });

  it('F1: viscosity not inherited although kinetic, e-robust and coupling-robust', () => {
    const o = { ...allPass(), pq1: { 4: 'PASS', 16: 'FAIL', 64: 'PASS' } as BulkOutcomes['pq1'] };
    expect(failureLabels(o)).toContain('F1');
    expect(overallCategory(o)).toBe('FAIL');
  });

  it('F2 alone with H1 intact is a PARTIAL PASS (constitutive failure, not a core failure)', () => {
    const o = { ...allPass(), pq2: { 4: 'PASS', 16: 'FAIL', 64: 'PASS' } as BulkOutcomes['pq2'] };
    expect(failureLabels(o)).toEqual(['F2']);
    expect(bulkVerdict(o)).toBe('FAIL');
    expect(overallCategory(o)).toBe('PARTIAL PASS');
  });

  it('T-FAIL (sound theory refuted) with H1 intact is also an isolated constitutive failure', () => {
    const o = { ...allPass(), pq3: { 4: 'T-FAIL-high', 16: 'P-INC', 64: 'P-INC' } as BulkOutcomes['pq3'] };
    expect(failureLabels(o)).toEqual(['T-FAIL']);
    expect(overallCategory(o)).toBe('PARTIAL PASS');
    const low = { ...allPass(), pq3: { 4: 'T-FAIL-low', 16: 'P-INC', 64: 'P-INC' } as BulkOutcomes['pq3'] };
    expect(failureLabels(low)).toEqual(['F2']);
  });

  it('F2 with H1 unresolved is INCONCLUSIVE, never FAIL', () => {
    const o = { ...allPass(), pq2: { 4: 'PASS', 16: 'FAIL', 64: 'PASS' } as BulkOutcomes['pq2'], pq1: { 4: 'PASS', 16: 'INCONCLUSIVE', 64: 'PASS' } as BulkOutcomes['pq1'] };
    expect(overallCategory(o)).toBe('INCONCLUSIVE');
  });

  it('F4: the c_h = 4 arm passes what the baseline fails, or ordering', () => {
    const o = { ...allPass(), pq1: { 4: 'FAIL', 16: 'PASS', 64: 'PASS' } as BulkOutcomes['pq1'], pq1ArmC4: 'PASS' as const };
    expect(failureLabels(o)).toContain('F4');
    expect(overallCategory(o)).toBe('FAIL');
    expect(failureLabels({ ...allPass(), orderingFlag: true })).toEqual(['F4']);
  });

  it('F6: pass at 4 and 16, monotone failure at 64 → PASS-NARROW → PARTIAL PASS', () => {
    const o = {
      ...allPass(),
      pq1: { 4: 'PASS', 16: 'PASS', 64: 'FAIL' } as BulkOutcomes['pq1'],
      pq1Estimate: { 4: 1.01, 16: 1.04, 64: 1.2 },
    };
    expect(failureLabels(o)).toEqual(['F6']);
    expect(bulkVerdict(o)).toBe('PASS-NARROW');
    expect(overallCategory(o)).toBe('PARTIAL PASS');
    // a non-monotone failure at 64 is a FAIL, not a narrowing
    const nm = { ...o, pq1Estimate: { 4: 1.08, 16: 1.01, 64: 1.2 } };
    expect(failureLabels(nm)).not.toContain('F6');
    expect(bulkVerdict(nm)).toBe('FAIL');
  });

  it('clarification: a monotone 64-only failure of PQ2 or PQ8 is F6, not F2 or F3', () => {
    const p2 = { ...allPass(), pq2: { 4: 'PASS', 16: 'PASS', 64: 'FAIL' } as BulkOutcomes['pq2'], pq2Estimate: { 4: 0.99, 16: 0.96, 64: 0.85 } };
    expect(failureLabels(p2)).toEqual(['F6']);
    const p8 = { ...allPass(), pq8: { 4: 'PASS', 16: 'PASS', 64: 'FAIL' } as BulkOutcomes['pq8'], pq8Estimate: { 4: 0.05, 16: 0.1, 64: 0.3 } };
    expect(failureLabels(p8)).toEqual(['F6']);
    // non-monotone: the literal F3 trigger applies
    const nm = { ...p8, pq8Estimate: { 4: 0.15, 16: 0.05, 64: 0.3 } };
    expect(failureLabels(nm)).toEqual(['F3']);
  });

  it('an unresolved primary without failures is INCONCLUSIVE', () => {
    const o = { ...allPass(), pq5: { 4: 'INCONCLUSIVE', 16: 'PASS' } as BulkOutcomes['pq5'] };
    expect(bulkVerdict(o)).toBe('INCONCLUSIVE');
    expect(overallCategory(o)).toBe('INCONCLUSIVE');
  });

  it('precedence order F0 > F3 > F1 > F2 > T-FAIL > F4 > F6', () => {
    const o = {
      ...allPass(),
      pq7Violations: 1,
      pq8: { 4: 'FAIL', 16: 'PASS', 64: 'PASS' } as BulkOutcomes['pq8'],
      pq4: { 4: 'FAIL', 16: 'PASS', 64: 'PASS' } as BulkOutcomes['pq4'],
      pq2: { 4: 'PASS', 16: 'FAIL', 64: 'PASS' } as BulkOutcomes['pq2'],
      orderingFlag: true,
    };
    expect(failureLabels(o)).toEqual(['F0', 'F3', 'F1', 'F2', 'F4']);
  });
});
