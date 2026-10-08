import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ub0Groups, type FrozenInputs } from '../src/universeB/UB0Plans';
import {
  assignCourant,
  comparabilityOf,
  COMPARABILITY,
  COURANT_ASSIGNMENT,
  courantOf,
  driftClass,
  driftStatistic,
  DT_ARM,
  EVIDENCE,
  gateLimit,
  LADDER,
  pilotDecision,
  predictedDrift,
  RATE_GATE,
  WAVE_GATE,
  type DriftEvidenceRow,
  type PilotGateA2,
} from '../src/universeB/UB0Timestep';

/** Amendment A2, D1: gates, the Courant ladder, the group assignment and the pilot rule. */
const rows = (JSON.parse(readFileSync('results/ub0/implementation/drift_check.json', 'utf8')) as { rows: DriftEvidenceRow[] }).rows;
const F: FrozenInputs = { version: 'A2', KTred: 2.37, cA: { 4: 2.19, 16: 2.19, 64: 2.19 }, cRatio: { 4: [0.72, 0.79], 16: [0.7, 0.72], 64: [0.7, 0.71] }, soundAmplitude: 0.02 };

describe('the A2 energy-drift gates (§1.2)', () => {
  it('shear waves keep 1 % of the wave energy; static, sound and wall boxes get the rate gate', () => {
    expect(driftClass('shear')).toBe('wave');
    for (const k of ['static', 'sound', 'wall'] as const) expect(driftClass(k)).toBe('rate');
    expect(gateLimit('shear')).toBe(WAVE_GATE);
    expect(gateLimit('static')).toBe(RATE_GATE);
    expect(WAVE_GATE).toBe(0.01);
    // the rate gate IS the design's 1e-4 over the S-K window of 500 D/σ_v
    expect(RATE_GATE * 500).toBeCloseTo(1e-4, 15);
    expect(() => driftClass('couette')).toThrow(/UB-0W/);
  });
  it('the statistic: |ΔE|/wave energy for waves, |ΔE/E| per D/σ_v otherwise', () => {
    const led = { energyResidual: -3e-3, relativeEnergyResidual: -2e-5 };
    expect(driftStatistic('shear', 176, led, 0.5)).toBeCloseTo(6e-3, 15);
    expect(driftStatistic('static', 100, led, 0.5)).toBeCloseTo(2e-7, 18);
    expect(driftStatistic('sound', 100, led, 1e-9)).toBeCloseTo(2e-7, 18); // the wave energy plays no part (A1's sound gate is superseded)
    // a linear secular drift gives the same rate statistic for any window length
    const rate = 1.2e-7;
    for (const W of [500, 2000, 4200]) expect(driftStatistic('static', W, { energyResidual: 0, relativeEnergyResidual: rate * W }, 1)).toBeCloseTo(rate, 18);
  });
});

describe('the Courant assignment (§1.3)', () => {
  it('the committed table is the selection rule applied to the integrator check (2900d89)', () => {
    const a = assignCourant(rows);
    expect(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.courant]))).toEqual(COURANT_ASSIGNMENT);
    // every member is at or below ¼ of its gate at the chosen Courant number …
    for (const v of Object.values(a)) for (const f of Object.values(v.fractions)) expect(f).toBeLessThanOrEqual(0.25);
    // … and the next coarser rung fails ¼ for at least one member (it is the largest such Courant number)
    for (const [cg, v] of Object.entries(a)) {
      const i = LADDER.indexOf(v.courant as (typeof LADDER)[number]);
      if (i === 0) continue;
      const coarser = LADDER[i - 1];
      expect(COMPARABILITY[cg].some((m) => predictedDrift(rows, m, coarser).drift / predictedDrift(rows, m, coarser).limit > 0.25)).toBe(true);
    }
  });
  it('the table of record', () => {
    expect(COURANT_ASSIGNMENT).toEqual({
      'N4-static': 0.00625,
      'N4-shear': 0.0125,
      W4c2: 0.00625,
      W4c4: 0.0125,
      W16c2: 0.0125,
      'N16-static': 0.025,
      'N16-shear': 0.025,
      'N64-static': 0.025,
      'N64-shear': 0.025,
    });
  });
  it('unmeasured Courant numbers are extrapolated at second order from the finest measured one', () => {
    const m = predictedDrift(rows, 'SK4c2p20', 0.0125);
    const x = predictedDrift(rows, 'SK4c2p20', 0.00625);
    expect(m.measured).toBe(true);
    expect(x.measured).toBe(false);
    expect(x.drift).toBeCloseTo(m.drift / 4, 18);
  });
  it('a group with no rung at ¼ of the gate goes to review, never to an automatic choice', () => {
    const worse = rows.map((r) => (r.case.startsWith('W N4 c2') ? { ...r, ratePerDsigma: r.ratePerDsigma * 100 } : r));
    expect(() => assignCourant(worse)).toThrow(/review/);
  });
  it('every judged group belongs to exactly one comparability group and has evidence', () => {
    const groups = ub0Groups(F).map((g) => g.group);
    const members = Object.values(COMPARABILITY).flat();
    expect(new Set(members).size).toBe(members.length);
    for (const g of groups) {
      if (g === DT_ARM.group) continue;
      expect(members).toContain(g);
      expect(EVIDENCE[g]).toBeDefined();
    }
    expect(groups.some((g) => /^C\d/.test(g))).toBe(false); // Couette deferred to UB-0W (§1.6)
  });
});

describe('group-specific Courant numbers and the dt arm (§1.4)', () => {
  it('each run group runs at its comparability group\'s Courant number', () => {
    for (const g of ub0Groups(F)) {
      const c = COURANT_ASSIGNMENT[comparabilityOf(g.group)];
      expect(g.base.courant).toBe(g.group === DT_ARM.group ? c / 2 : c);
    }
  });
  it('the dt arm is at N_c = 4, beside T4a1, at half its Courant number', () => {
    const t = ub0Groups(F).find((g) => g.group === DT_ARM.group)!;
    const a = ub0Groups(F).find((g) => g.group === DT_ARM.reference)!;
    expect(DT_ARM.group).toBe('T4dt');
    expect(t.base.Nc).toBe(4);
    expect(t.base.courant).toBe(0.00625);
    expect(a.base.courant).toBe(0.0125);
    const { courant: c1, ...x } = t.base;
    const { courant: c2, ...y } = a.base;
    void c1;
    void c2;
    expect(x).toEqual(y); // identical apart from the timestep
    expect(ub0Groups(F).some((g) => g.group === 'T16dt')).toBe(false);
  });
  it('a pilot halving halves the whole comparability group once, and the dt arm with it', () => {
    expect(courantOf('SL4', ['N4-static'])).toBe(0.003125);
    expect(courantOf('L4', ['N4-static'])).toBe(0.003125);
    expect(courantOf('T4dt', ['N4-shear'])).toBe(0.003125);
    expect(courantOf('T4a1', ['N4-shear'])).toBe(0.00625);
    expect(courantOf('T16a1', ['N4-shear'])).toBe(0.025);
    const g = ub0Groups(F, undefined, ['N16-shear']);
    for (const m of COMPARABILITY['N16-shear']) expect(g.find((x) => x.group === m)!.base.courant).toBe(0.0125);
  });
});

const gate = (group: string, fraction: number, extra: Partial<PilotGateA2> = {}): PilotGateA2 => ({
  id: `pilot-${group}`,
  group,
  courant: courantOf(group),
  halted: false,
  drift: fraction,
  limit: 1,
  fraction,
  defects: [],
  ...extra,
});

describe('the A2 pilot rule (§1.5)', () => {
  it('all pilots within ½ of their gates: proceed', () => {
    expect(pilotDecision([gate('SK4c2p20', 0.3), gate('T4a1', 0.49)], [], [4, 1])).toEqual({ kind: 'proceed', halved: [] });
  });
  it('a pilot above ½: its comparability group halves once (not the others)', () => {
    const d = pilotDecision([gate('SL4', 0.6), gate('T4a1', 0.1), gate('W16c2', 0.2)]);
    expect(d).toEqual({ kind: 'halve', halve: ['N4-static'], trigger: ['pilot-SL4'] });
  });
  it('the dt arm halves its partner group', () => {
    const d = pilotDecision([gate('T4dt', 0.7)]);
    expect(d.kind).toBe('halve');
    if (d.kind === 'halve') expect(d.halve).toEqual(['N4-shear']);
  });
  it('round 2: above ½ again ⇒ review; within ½ ⇒ proceed with the halving in force', () => {
    expect(pilotDecision([gate('SL4', 0.55)], ['N4-static']).kind).toBe('review');
    expect(pilotDecision([gate('SL4', 0.3)], ['N4-static'])).toEqual({ kind: 'proceed', halved: ['N4-static'] });
  });
  it('a halt or any defect is a review, never a timestep decision', () => {
    expect(pilotDecision([gate('SK16c2p20', 0.1, { halted: true })]).kind).toBe('review');
    expect(pilotDecision([gate('SK16c2p20', 0.9, { defects: ['measure: 1 unexplained late contacts'] })]).kind).toBe('review');
  });
  it('a dt-arm pilot drift ratio below 2.5 is a review (PQ7c would void UB-0)', () => {
    expect(pilotDecision([gate('T4a1', 0.1)], [], [2e-4, 1e-4]).kind).toBe('review');
    expect(pilotDecision([gate('T4a1', 0.1)], [], [4e-4, 1e-4]).kind).toBe('proceed');
  });
});
