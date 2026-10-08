import { describe, expect, it } from 'vitest';
import { henderson } from '../src/universeB/CoarseGrainMap';
import type { PlannedRun } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';
import {
  checkRun,
  excessExclusions,
  extensionCandidates,
  halves,
  nonStationary,
  primariesOfStaticGroup,
  PRIMARY_GROUPS,
  selectGroup,
  stationarityThresholds,
  type RunCheck,
} from '../src/universeB/UB0Selection';
import { finalize, getOutcome, PRIMARY_KEYS, setOutcome } from '../src/universeB/UB0Judged';

const ok = (id: string): RunCheck => ({
  id,
  excludeReasons: [],
  gate: { id, momentumResidual: 0, drift: 0, driftLimit: 1, unexplainedLateContacts: 0, halted: false },
  maxOmegaDt: 0,
});
const bad = (id: string): RunCheck => ({ ...ok(id), excludeReasons: ['halted'] });
const group = (g: string, n: number, start: number): PlannedRun[] =>
  Array.from({ length: 2 * n }, (_, i) => ({ id: `${g}-${start + i}`, seed: start + i, group: g, planned: i < n }) as PlannedRun);

describe('reserve replacement and the extension (§11.6–§11.7)', () => {
  it('excluded planned runs are replaced by reserves in seed order', () => {
    const runs = group('T4a1', 4, 100);
    const checks = new Map<string, RunCheck>([
      ['T4a1-100', ok('T4a1-100')],
      ['T4a1-101', bad('T4a1-101')],
      ['T4a1-102', ok('T4a1-102')],
      ['T4a1-103', ok('T4a1-103')],
    ]);
    let s = selectGroup(runs, checks);
    expect(s.toRun).toEqual(['T4a1-104']);
    expect(s.used).toEqual(['T4a1-100', 'T4a1-102', 'T4a1-103']);
    checks.set('T4a1-104', ok('T4a1-104'));
    s = selectGroup(runs, checks);
    expect(s.used).toEqual(['T4a1-100', 'T4a1-102', 'T4a1-103', 'T4a1-104']);
    expect(s.toRun).toEqual([]);
    // A2 §4: one exclusion, replaced from the reserve, is not F0 (the design's > 10 % made 1 of 5 void)
    expect(s.excessExclusions).toBe(false);
    checks.set('T4a1-102', bad('T4a1-102'));
    checks.set('T4a1-105', ok('T4a1-105'));
    s = selectGroup(runs, checks);
    expect(s.excluded).toHaveLength(2);
    expect(s.excessExclusions).toBe(true); // 2 of 6 examined > max(1, 0.6)
  });
  it('F0 needs more than max(1, 10 %) of the runs examined excluded (A2 §4)', () => {
    expect(excessExclusions(0, 4)).toBe(false);
    expect(excessExclusions(1, 4)).toBe(false);
    expect(excessExclusions(1, 9)).toBe(false);
    expect(excessExclusions(2, 6)).toBe(true);
    expect(excessExclusions(2, 10)).toBe(true);
    expect(excessExclusions(2, 20)).toBe(false);
    expect(excessExclusions(3, 20)).toBe(true);
    expect(excessExclusions(0, 0)).toBe(false);
    const runs = group('T4a1', 48, 1000);
    const checks = new Map<string, RunCheck>();
    for (const r of runs) checks.set(r.id, r.seed < 1005 ? bad(r.id) : ok(r.id));
    expect(selectGroup(runs, checks).excessExclusions).toBe(false); // 5 of 53
    checks.set('T4a1-1005', bad('T4a1-1005'));
    expect(selectGroup(runs, checks).excessExclusions).toBe(true); // 6 of 54: the 10 % branch is unchanged
  });
  it('an extended group takes the next reserves after any replacement; exhaustion is a shortfall', () => {
    const runs = group('SL4', 4, 200);
    const checks = new Map<string, RunCheck>(runs.map((r) => [r.id, r.seed === 201 ? bad(r.id) : ok(r.id)]));
    const first = selectGroup(runs, checks);
    const ext = selectGroup(runs, checks, true);
    expect(ext.used.slice(0, 4)).toEqual(first.used); // the first look is a prefix
    expect(ext.used).toHaveLength(7);
    expect(ext.shortfall).toBe(1);
  });
  it('extension candidates: INCONCLUSIVE with the point estimate inside the margin', () => {
    expect(extensionCandidates({ 'pq1.4': 'INCONCLUSIVE', 'pq2.4': 'INCONCLUSIVE', 'pq5.4': 'PASS' }, { 'pq1.4': true, 'pq2.4': false, 'pq5.4': true })).toEqual(['pq1.4']);
    for (const k of Object.keys(PRIMARY_GROUPS)) expect(PRIMARY_KEYS).toContain(k);
  });
});

describe('run halves (§11.5.1)', () => {
  it('flags a drift beyond ⅓ of the margin, not one inside it', () => {
    const th = stationarityThresholds(0.6, [0.2, 0.25]);
    expect(th.Pnorm).toBeCloseTo(0.004, 12);
    const noisy = (d: number) => Array.from({ length: 8 }, (_, i) => [1 + d + 1e-4 * (i % 2 ? 1 : -1), 1] as [number, number]);
    expect(nonStationary(noisy(0.002), th.Pnorm).flag).toBe(false);
    expect(nonStationary(noisy(0.006), th.Pnorm).flag).toBe(true);
    expect(nonStationary(noisy(-0.006), th.Pnorm).flag).toBe(true);
    expect(halves([99, 1, 2, 3, 4])).toEqual([1.5, 3.5]);
  });
  it('maps static groups to the primaries they feed', () => {
    expect(primariesOfStaticGroup('SK16c2p18', 'Pnorm')).toEqual(['pq2.16', 'pq3.16']);
    expect(primariesOfStaticGroup('SK4c2p22', 'Pnorm')).toEqual(['pq2.4', 'pq3.4', 'pq6c']);
    expect(primariesOfStaticGroup('SK4c4p18', 'Pnorm')).toEqual(['pq6c', 'pq2.arm']);
    expect(primariesOfStaticGroup('SK64c2p20', 'TkinOverTint')).toEqual(['pq4.64']);
    expect(primariesOfStaticGroup('SK16c2p20', 'Pnorm')).toEqual([]);
    expect(primariesOfStaticGroup('SL16', 'S')).toEqual(['pq5.16']);
  });
});

describe('outcome overrides and the per-primary merge', () => {
  it('setOutcome / getOutcome round-trip every primary key', () => {
    const o = {
      pq1: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
      pq1Estimate: { 4: 1, 16: 1, 64: 1 },
      pq2: { 4: 'PASS', 16: 'PASS', 64: 'PASS' },
      pq2Estimate: { 4: 1, 16: 1, 64: 1 },
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
    } as Parameters<typeof finalize>[0];
    expect(finalize(o).overall).toBe('PASS');
    for (const k of PRIMARY_KEYS) {
      const before = getOutcome(o, k);
      setOutcome(o, k, 'INCONCLUSIVE');
      expect(getOutcome(o, k)).toBe('INCONCLUSIVE');
      setOutcome(o, k, before);
    }
    setOutcome(o, 'pq2.16', 'INCONCLUSIVE');
    expect(finalize(o).bulk).toBe('INCONCLUSIVE');
    setOutcome(o, 'pq2.16', 'FAIL', 1.3);
    expect(o.pq2Estimate[16]).toBe(1.3);
    expect(finalize(o).labels).toContain('F2');
  });
});

describe('per-run checks on a real Universe B run (implementation test, tiny box)', () => {
  // N_c = 4, c_h = 2 near-equilibrium runs are assigned Courant 0.00625 (A2 §1.3); at 0.025 this box drifts above the rate gate
  const B = { Nc: 4, ch: 2, e: 0.9, KTred: henderson.KTred(0.2), courant: 0.00625, observables: true, phi: 0.2 };
  const spec: UB0Spec = { ...B, id: 'sel-static', kind: 'static', seed: 9011, L: 14, prep: 1, settle: 0.5, measure: 2, sample: 0.5 };
  it('a clean run is included, with the stiffness diagnostic recorded', () => {
    const run = new UB0Run(spec);
    while (!run.done) run.advance(1000);
    const r = run.result();
    const c = checkRun(r);
    expect(c.excludeReasons).toEqual([]);
    expect(c.gate.momentumResidual).toBeLessThan(1e-9);
    expect(c.maxOmegaDt).toBeGreaterThan(0);
    const h = JSON.parse(JSON.stringify(r));
    h.info.halted = 1;
    expect(checkRun(h).excludeReasons).toContain('halted');
    const nf = JSON.parse(JSON.stringify(r));
    nf.samples[2].Pkin = null; // JSON turns NaN into null
    expect(checkRun(nf).excludeReasons).toContain('non-finite state');
  });
  it('PQ7(b) is the A2 rate gate for static, sound and wall runs: |ΔE/E| per D/σ_v ≤ 2e-7', () => {
    const run = new UB0Run(spec);
    while (!run.done) run.advance(1000);
    const r = run.result();
    const c = checkRun(r);
    expect(c.gate.driftLimit).toBe(2e-7);
    const m = r.phaseLedgers.measure as { relativeEnergyResidual: number };
    expect(c.gate.drift).toBeCloseTo(Math.abs(m.relativeEnergyResidual) / spec.measure, 15);
    // a residual of 1e-4 of E over a 500 D/σ_v window passes (the design's S-K number) and over 4200 it does not
    const at = (resid: number, window: number) => {
      const x = JSON.parse(JSON.stringify(r));
      x.spec.measure = window;
      x.phaseLedgers.measure.relativeEnergyResidual = resid;
      return checkRun(x);
    };
    expect(at(0.99e-4, 500).excludeReasons).toEqual([]);
    expect(at(1.01e-4, 500).excludeReasons.some((w) => w.startsWith('PQ7(b)'))).toBe(true);
    expect(at(8.3e-4, 4200).excludeReasons).toEqual([]);
    expect(at(8.5e-4, 4200).excludeReasons.some((w) => w.startsWith('PQ7(b)'))).toBe(true);
    // a sound run uses the same rate gate, not the wave energy (A1's sound gate is superseded)
    const snd = JSON.parse(JSON.stringify(r));
    snd.spec.kind = 'sound';
    snd.info.imposedKineticEnergy = 1e-9;
    expect(checkRun(snd).gate.driftLimit).toBe(2e-7);
    expect(checkRun(snd).excludeReasons).toEqual([]);
  });
});
