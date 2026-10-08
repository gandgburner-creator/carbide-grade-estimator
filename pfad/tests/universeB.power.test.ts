import { describe, expect, it } from 'vitest';
import { DESIGN_COUNTS } from '../src/universeB/UB0Plans';
import {
  chi2Quantile,
  coreHoursPerSeed,
  countsOf,
  falsePassMC,
  halfWidth,
  nAgainstFixed,
  nTwoArm,
  passProbability,
  planningFactor,
  planningSD,
  pooledSD,
  powerPlan,
  type NoiseEstimate,
  type PowerInputs,
} from '../src/universeB/UB0Power';
import type { Stat } from '../src/universeB/UB0Stage0';

/** Amendment A2, D3: the power calculation on synthetic Universe A noise. */
const S = (value: number, se: number, n: number): Stat => ({ value, se, df: n - 1, n });
const noise = (sd: number, df: number, relative = true): NoiseEstimate => ({ sd, df, relative, source: 'synthetic', cells: [] });

function inputs(over: Partial<PowerInputs['noise']> = {}, refs: Partial<PowerInputs['refs']> = {}): PowerInputs {
  return {
    status: 'provisional',
    basis: { test: 'synthetic' },
    noise: {
      nuL80a1: noise(0.106, 499),
      nuL80a05: noise(0.205, 95),
      nuL160a1: noise(0.05, 99),
      c: noise(0.047, 77),
      S1: noise(0.072, 46),
      S2: noise(0.037, 46),
      P18: noise(2.4e-4, 23, false),
      P22: noise(2.7e-4, 23, false),
      gw1: noise(0.006, 31, false),
      gw2: noise(0.041, 31, false),
      gw3: noise(0.0018, 31, false),
      ...over,
    },
    refs: {
      nu: { 4: S(1.51, 0.0113, 200), 16: S(1.51, 0.0113, 200), 64: S(1.59, 0.008, 100) },
      KT: S(0.605, 0.00064, 16),
      SA: { 4: [S(0.42, 0.0075, 16), S(0.427, 0.004, 16)], 16: [S(0.42, 0.0053, 32), S(0.427, 0.0028, 32)] },
      ...refs,
    },
    judgedGamma: { 4: [1.01, 1.31], 16: [0.954, 1.115], 64: [0.95, 1.066] },
    rpaStrength: { 4: 7.127, 16: 35.635 },
    WhatShells: { 4: [0.9956, 0.9912], 16: [0.9825, 0.9653] },
  };
}

describe('the uncertainty on a variance estimate', () => {
  it('Wilson–Hilferty χ² quantiles are accurate to < 1 % for df ≥ 3', () => {
    // exact values: χ²₀.₂₀(10) = 6.1791, χ²₀.₀₂₅(10) = 3.2470, χ²₀.₉₇₅(10) = 20.483, χ²₀.₂₀(3) = 1.0052, χ²₀.₂₀(95) = 83.25
    expect(chi2Quantile(-0.8416212335729143, 10) / 6.1791 - 1).toBeLessThan(0.01);
    expect(Math.abs(chi2Quantile(-1.959963984540054, 10) / 3.247 - 1)).toBeLessThan(0.01);
    expect(Math.abs(chi2Quantile(1.959963984540054, 10) / 20.483 - 1)).toBeLessThan(0.01);
    expect(Math.abs(chi2Quantile(-0.8416212335729143, 3) / 1.0052 - 1)).toBeLessThan(0.02);
    expect(Math.abs(chi2Quantile(-0.8416212335729143, 95) / 83.25 - 1)).toBeLessThan(0.002);
  });
  it('the planning SD is the 80 % upper bound: larger for fewer df, → 1 as df grows', () => {
    expect(planningFactor(3)).toBeGreaterThan(1.7);
    expect(planningFactor(7)).toBeCloseTo(1.35, 1);
    expect(planningFactor(500)).toBeLessThan(1.04);
    expect(planningFactor(500)).toBeGreaterThan(1);
    expect(planningSD(noise(0.1, 10))).toBeCloseTo(0.1 * planningFactor(10), 15);
  });
  it('pooled within-cell SD: a shift of the mean between Courant cells does not inflate it', () => {
    const a = [1, 1.1, 0.9, 1.05, 0.95];
    const b = a.map((x) => x + 5); // the same scatter around another mean
    const p = pooledSD([{ label: 'a', values: a }, { label: 'b', values: b }], false, 't');
    const one = pooledSD([{ label: 'a', values: a }], false, 't');
    expect(p.sd).toBeCloseTo(one.sd, 12);
    expect(p.df).toBe(8);
    // relative SDs are pooled relative to each cell's own mean
    const r = pooledSD([{ label: 'a', values: a }, { label: '2a', values: a.map((x) => 2 * x) }], true, 't');
    expect(r.sd).toBeCloseTo(one.sd, 12);
  });
});

describe('seed-count formulas', () => {
  it('one group against a fixed reference variance: the smallest n meeting the target', () => {
    const s = 0.11;
    const target = Math.log(1.1) / 3;
    const F = 0.0075 ** 2;
    const r = nAgainstFixed(s, target, F, 199);
    expect(r.feasible).toBe(true);
    expect(r.halfWidth).toBeLessThanOrEqual(target);
    expect(halfWidth([{ v: (s * s) / (r.n - 1), df: r.n - 2 }, { v: F, df: 199 }])).toBeGreaterThan(target);
    // the closed form n ≈ s²/((target/t)² − F) with t ≈ 1.97
    expect(Math.abs(r.n - (s * s) / ((target / 1.97) ** 2 - F))).toBeLessThan(3);
  });
  it('a reference term that alone exceeds the target is infeasible, not silently accepted', () => {
    expect(nAgainstFixed(0.1, 0.02, 0.012 ** 2, 11).feasible).toBe(false);
  });
  it('two arms with n₂ = r n₁: n₁ = (s₁² + s₂²/r)(t/target)²', () => {
    const n1 = nTwoArm(0.11, 0.22, 2, Math.log(1.05) / 2);
    expect(Math.abs(n1 - (0.11 ** 2 + 0.22 ** 2 / 2) * (1.966 / (Math.log(1.05) / 2)) ** 2)).toBeLessThan(3);
    expect(halfWidth([{ v: 0.11 ** 2 / n1, df: n1 - 1 }, { v: 0.22 ** 2 / (2 * n1), df: 2 * n1 - 1 }])).toBeLessThanOrEqual(Math.log(1.05) / 2);
  });
  it('the operating characteristic: half-width ½ the margin passes ≈ 95 % of exact equivalents', () => {
    const se = Math.log(1.05) / 2 / 1.96;
    expect(passProbability(Math.log(1.05) / 2, se, 0.05, 1)).toBeGreaterThan(0.93);
    expect(passProbability(Math.log(1.05) / 2, se, 0.05, 1)).toBeLessThan(0.97);
  });
});

describe('the power plan (synthetic Universe A noise)', () => {
  const p = powerPlan(inputs());
  it('every powered primary meets its target at the planned counts', () => {
    for (const q of p.primaries) {
      if (q.targetHalfWidth === null) continue;
      expect(q.halfWidthPlan).toBeLessThanOrEqual(q.targetHalfWidth * (1 + 1e-12));
    }
  });
  it('the margins and targets are the pre-registered ones (no margin is changed by A2)', () => {
    const m = Object.fromEntries(p.primaries.map((q) => [q.key, q.margin]));
    expect(m['pq1.4']).toBe('[0.90, 1.10]');
    expect(m['pq6a.4']).toBe('[0.95, 1.05]');
    expect(m.pq6b).toBe('[0.95, 1.05]');
    expect(m['pq6c.nu']).toBe('[0.93, 1.07]');
    expect(m.pq7d).toBe('[0.97, 1.03]');
    const f = Object.fromEntries(p.primaries.map((q) => [q.key, q.targetFraction]));
    expect(f['pq1.4']).toBeCloseTo(1 / 3, 15);
    expect(f['pq2.16']).toBeCloseTo(1 / 3, 15);
    for (const k of ['pq3.16', 'pq5.4', 'pq6a.16', 'pq6b', 'pq6c.nu', 'wall.W4c2']) expect(f[k]).toBe(0.5);
    expect(f.pq7d).toBeNull();
  });
  it('no group falls below its design count; the dt arm and the c_h 4 wall arm keep theirs', () => {
    for (const [g, d] of Object.entries(DESIGN_COUNTS)) expect(p.groups[g].n).toBeGreaterThanOrEqual(d);
    expect(p.groups.T4dt.n).toBe(48);
    expect(p.groups.W4c4.n).toBe(4);
  });
  it('the PQ6a arms keep the design ratio ≈ 2 and are the binding constraint on T{4,16}a1', () => {
    expect(p.groups.T4a05.n / p.groups.T4a1.n).toBeGreaterThan(1.8);
    expect(p.groups.T4a05.n / p.groups.T4a1.n).toBeLessThan(2.2);
    expect(p.groups.T4a1.setBy).toContain('pq6a.4');
  });
  it('more Universe A scatter means more seeds; a smaller Universe A reference error means fewer', () => {
    const noisier = powerPlan(inputs({ c: noise(0.094, 77) }));
    for (const g of ['L4', 'L16', 'L64']) expect(noisier.groups[g].n).toBeGreaterThan(p.groups[g].n);
    const fewDf = powerPlan(inputs({ S1: noise(0.072, 7) }));
    expect(fewDf.groups.SL4.n).toBeGreaterThan(p.groups.SL4.n); // the planning bound widens with fewer df
    const worseRef = powerPlan(inputs({}, { nu: { 4: S(1.51, 0.0113, 200), 16: S(1.51, 0.0113, 200), 64: S(1.59, 0.016, 25) } }));
    expect(worseRef.groups.T64a1.n).toBeGreaterThan(p.groups.T64a1.n);
  });
  it('PQ5: the S_A term enters scaled by S_RPA/S_A, so the Universe B count binds', () => {
    const q = p.primaries.find((x) => x.key === 'pq5.16')!;
    expect(q.F).toBeLessThan(1e-5);
  });
  it('a target the reference alone cannot meet stops the plan for review', () => {
    expect(() => powerPlan(inputs({}, { nu: { 4: S(1.51, 0.03, 12), 16: S(1.51, 0.0113, 200), 64: S(1.59, 0.008, 100) } }))).toThrow(/review/);
  });
  it('is deterministic and gives seed counts in the form the plan takes', () => {
    expect(powerPlan(inputs())).toEqual(p);
    const c = countsOf(p);
    expect(c.status).toBe('provisional');
    expect(Object.keys(c.n).sort()).toEqual(Object.keys(DESIGN_COUNTS).sort());
  });
});

describe('false-PASS control (simulation of the decision rule at the margin edge)', () => {
  it('first look ≈ 2.5 %, and the single extension stays below the 3.75 % union bound', () => {
    const one = falsePassMC({ nA: 60, sA: 0.11, ref: { se: 0.0075, df: 199 }, margin: 0.1, reps: 6000, seed: 1 });
    expect(one.firstLook).toBeGreaterThan(0.015);
    expect(one.firstLook).toBeLessThan(0.035);
    expect(one.withExtension).toBeLessThan(0.0375 + 0.006);
    const two = falsePassMC({ nA: 100, sA: 0.11, nB: 200, sB: 0.22, margin: 0.05, reps: 6000, seed: 2 });
    expect(two.firstLook).toBeGreaterThan(0.015);
    expect(two.firstLook).toBeLessThan(0.035);
    expect(two.withExtension).toBeGreaterThanOrEqual(two.firstLook);
    expect(two.withExtension).toBeLessThan(0.0375 + 0.006);
  });
  it('is reproducible for a seed', () => {
    const a = falsePassMC({ nA: 20, sA: 0.1, margin: 0.1, reps: 500, seed: 9 });
    expect(falsePassMC({ nA: 20, sA: 0.1, margin: 0.1, reps: 500, seed: 9 })).toEqual(a);
  });
});

describe('cost model (B0 rows)', () => {
  const rows = [
    { Nc: 1, ch: 0, L: 80, N: 1630, stepUs: 0.2, meanDtP: 0.0066 },
    { Nc: 1, ch: 0, L: 160, N: 6519, stepUs: 0.21, meanDtP: 0.0054 },
    { Nc: 4, ch: 2, L: 80, N: 1630, stepUs: 0.83, meanDtP: null },
    { Nc: 4, ch: 2, L: 160, N: 6519, stepUs: 0.85, meanDtP: null },
  ];
  it('scales with 1/Courant and with the window', () => {
    const base = { kind: 'static', Nc: 4, ch: 2, e: 0.9, KTred: 2.37, phi: 0.2, L: 80, prep: 100, settle: 20, measure: 500, sample: 1, courant: 0.025, observables: true } as const;
    const a = coreHoursPerSeed(base, rows);
    expect(coreHoursPerSeed({ ...base, courant: 0.0125 }, rows)).toBeCloseTo(2 * a, 12);
    expect(coreHoursPerSeed({ ...base, measure: 1120 }, rows)).toBeCloseTo((1240 / 620) * a, 12);
  });
});
