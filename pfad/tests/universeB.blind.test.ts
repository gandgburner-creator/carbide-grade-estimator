import { describe, expect, it } from 'vitest';
import { henderson } from '../src/universeB/CoarseGrainMap';
import { blindRecord, pilotGate, type BlindRecord } from '../src/universeB/UB0Blind';
import { pilotPlan, type FrozenInputs } from '../src/universeB/UB0Plans';
import { comparabilityOf, COURANT_ASSIGNMENT, DT_ARM } from '../src/universeB/UB0Timestep';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';

const B = { Nc: 4, ch: 2, e: 0.9, KTred: henderson.KTred(0.2), courant: 0.0125, observables: false, phi: 0.2 };
const F: FrozenInputs = { version: 'A2', KTred: 2.37, cA: { 4: 2.17, 16: 2.17, 64: 2.17 }, cRatio: { 4: [1, 1.1], 16: [1, 1.03], 64: [1, 1.01] }, soundAmplitude: 0.02 };
const tiny: Record<string, UB0Spec> = {
  static: { ...B, id: 'b-static', kind: 'static', seed: 9001, L: 14, prep: 1, settle: 0.5, measure: 1, sample: 0.5 },
  shear: { ...B, id: 'b-shear', kind: 'shear', seed: 9002, L: 14, amplitude: 1, prep: 1, settle: 0.5, measure: 1, sample: 0.5 },
  wall: { ...B, id: 'b-wall', kind: 'wall', seed: 9003, width: 14, height: 14, prep: 1, settle: 0, measure: 1, sample: 0.5 },
};

function finish(spec: UB0Spec) {
  const run = new UB0Run(spec);
  while (!run.done) run.advance(1000);
  return run.result();
}

const ALLOWED_TOP = ['blind', 'spec', 'halted', 'lostEvents', 'phases', 'seconds'].sort();
const ALLOWED_PHASE = ['relativeEnergyResidual', 'energyOverWave', 'momentumOverNMs', 'lateContactsUnexplained', 'maxOverlapFraction', 'flags', 'halted'];

describe('UB-0 blind records (stability pilots, A1 §4.3; A2 §1.5)', () => {
  it('every pilot is blind, at its group\'s assigned Courant number, on design seeds', () => {
    const plan = pilotPlan(F);
    expect(plan.every((p) => p.observables === false)).toBe(true);
    expect(new Set(plan.map((p) => p.seed)).size).toBe(plan.length);
    expect(plan.every((p) => p.seed >= 9501 && p.seed <= 9999)).toBe(true);
    expect(plan).toHaveLength(29); // 31 design groups − Couette (A2 §1.6)
    for (const p of plan) {
      const c = COURANT_ASSIGNMENT[comparabilityOf(p.group)];
      expect(p.courant).toBe(p.group === DT_ARM.group ? c / 2 : c);
    }
  });
  it('round 2 repeats only the halved groups, with the same seeds, at half the Courant number', () => {
    const r1 = pilotPlan(F);
    const r2 = pilotPlan(F, { round: 2, halved: ['N4-shear'] });
    expect(r2.map((p) => p.group).sort()).toEqual(['T4a05', 'T4a1', 'T4c4', 'T4dt']);
    for (const p of r2) {
      const q = r1.find((x) => x.group === p.group)!;
      expect(p.seed).toBe(q.seed);
      expect(p.courant).toBe(q.courant / 2);
      expect(p.id).toMatch(/^pilot-r2-/);
    }
    expect(() => pilotPlan(F, { round: 2 })).toThrow();
  });
  it('refuses frozen inputs that are not in the A2 structure', () => {
    expect(() => pilotPlan({ KTred: 2.37, cA: 2.17, cRatio: {} } as unknown as FrozenInputs)).toThrow(/A2/);
  });

  for (const kind of Object.keys(tiny)) {
    it(`${kind}: the stored record holds the whitelist only`, () => {
      const res = finish(tiny[kind]);
      expect(res.samples).toHaveLength(0); // no sampling with observables off
      const b = blindRecord(res);
      expect(Object.keys(b).sort()).toEqual(ALLOWED_TOP);
      for (const p of Object.values(b.phases)) for (const k of Object.keys(p)) expect(ALLOWED_PHASE).toContain(k);
      for (const k of Object.keys(b.seconds)) expect(k.endsWith('Seconds')).toBe(true);
      const text = JSON.stringify(b);
      for (const banned of ['wallTotals', 'ledger', 'pairCollisions', 'rescale', 'E0', 'Steps', 'samples', 'tallies', 'walls', 'info']) {
        expect(text).not.toContain(`"${banned}`);
      }
      if (kind === 'shear') expect(b.phases.measure.energyOverWave).toBeTypeOf('number');
      const g = pilotGate(b);
      expect(g.halted).toBe(false);
      expect(Number.isFinite(g.drift)).toBe(true);
      expect(g.limit).toBe(kind === 'shear' ? 0.01 : 2e-7);
      expect(g.fraction).toBeCloseTo(g.drift / g.limit, 12);
    });
  }
});

function rec(id: string, kind: 'static' | 'shear', courant: number, drift: number, measure = 500): BlindRecord {
  return {
    blind: true,
    spec: { id, kind, courant, measure } as BlindRecord['spec'],
    halted: false,
    lostEvents: 0,
    phases: {
      measure: {
        relativeEnergyResidual: kind === 'static' ? drift : 1e-6,
        ...(kind === 'shear' ? { energyOverWave: drift } : {}),
        momentumOverNMs: 1e-14,
        lateContactsUnexplained: 0,
        maxOverlapFraction: 0,
        flags: [],
        halted: false,
      },
    },
    seconds: { measureSeconds: 1 },
  };
}

describe('the A2 pilot gate on blind records (synthetic)', () => {
  it('shear: |ΔE| over the window / wave energy against 1 %', () => {
    expect(pilotGate(rec('w', 'shear', 0.0125, 0.004)).fraction).toBeCloseTo(0.4, 12);
    expect(pilotGate(rec('w', 'shear', 0.0125, -0.006)).fraction).toBeCloseTo(0.6, 12);
  });
  it('static: |ΔE/E| per D/σ_v of window against 2e-7 (A1 §4.3\'s absolute 1e-4 is superseded)', () => {
    // 1e-4 over 500 D/σ_v is exactly the gate; over 4200 D/σ_v the same 1e-4 is 0.12 of it
    expect(pilotGate(rec('s', 'static', 0.00625, 1e-4, 500)).fraction).toBeCloseTo(1, 12);
    expect(pilotGate(rec('s', 'static', 0.00625, 1e-4, 4200)).fraction).toBeCloseTo(500 / 4200, 12);
  });
  it('defects are listed: halt, PQ7(a), PQ7(e), lost events', () => {
    const m = rec('m', 'static', 0.025, 1e-6);
    m.phases.measure.momentumOverNMs = 1e-8;
    m.phases.measure.lateContactsUnexplained = 1;
    m.lostEvents = 2;
    const g = pilotGate(m);
    expect(g.defects).toHaveLength(3);
  });
});
