import { describe, expect, it } from 'vitest';
import { henderson } from '../src/universeB/CoarseGrainMap';
import { blindRecord, pilotGate, timestepDecision, type BlindRecord } from '../src/universeB/UB0Blind';
import { pilotPlan } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';

const B = { Nc: 4, ch: 2, e: 0.9, KTred: henderson.KTred(0.2), courant: 0.025, observables: false, phi: 0.2 };
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

describe('UB-0 blind records (stability pilots, A1 §4.3)', () => {
  it('every pilot is blind', () => {
    const plan = pilotPlan({ KTred: 2.37, cA: 2.17, cRatio: { 4: [1, 1.1], 16: [1, 1.03], 64: [1, 1.01] } });
    expect(plan.every((p) => p.observables === false)).toBe(true);
    expect(new Set(plan.map((p) => p.seed)).size).toBe(plan.length);
    expect(plan.every((p) => p.seed >= 9501 && p.seed <= 9999)).toBe(true);
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
    });
  }
});

function rec(id: string, kind: 'static' | 'shear', courant: number, drift: number, extra: Partial<BlindRecord['phases']['measure']> = {}): BlindRecord {
  return {
    blind: true,
    spec: { id, kind, courant } as BlindRecord['spec'],
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
        ...extra,
      },
    },
    seconds: { measureSeconds: 1 },
  };
}

describe('the pre-declared timestep rule (synthetic gates)', () => {
  it('all within the gates: Courant retained', () => {
    const d = timestepDecision([rec('a', 'static', 0.025, 5e-5), rec('b', 'shear', 0.025, -0.004)].map(pilotGate), 0.025);
    expect(d).toEqual({ kind: 'retain', courant: 0.025 });
  });
  it('a baseline pilot over its gate halves Courant throughout', () => {
    const d = timestepDecision([rec('a', 'static', 0.025, 2e-4), rec('b', 'shear', 0.025, 0.004)].map(pilotGate), 0.025);
    expect(d).toEqual({ kind: 'halve', courant: 0.0125, trigger: ['a'] });
  });
  it('the wave gate is 1 % of the wave energy, the static gate 1e-4 of the total', () => {
    expect(pilotGate(rec('w', 'shear', 0.025, 0.011)).driftPass).toBe(false);
    expect(pilotGate(rec('w', 'shear', 0.025, 0.009)).driftPass).toBe(true);
    expect(pilotGate(rec('s', 'static', 0.025, 1.1e-4)).driftPass).toBe(false);
  });
  it('over the gate at half Courant: no automatic change, review', () => {
    const d = timestepDecision([rec('dt', 'shear', 0.0125, 0.02)].map(pilotGate), 0.025);
    expect(d.kind).toBe('review');
    // a second pilot round at 0.0125 is always judged against the original base 0.025
    const d2 = timestepDecision([rec('a', 'static', 0.0125, 2e-4)].map(pilotGate), 0.025);
    expect(d2.kind).toBe('review');
  });
  it('a halt or a PQ7(a)/(e) defect is an implementation defect, never a dt decision', () => {
    const h = rec('h', 'static', 0.025, 2e-4);
    h.halted = true;
    expect(timestepDecision([pilotGate(h)], 0.025).kind).toBe('review');
    const m = rec('m', 'static', 0.025, 1e-5, { momentumOverNMs: 1e-8 });
    expect(timestepDecision([pilotGate(m)], 0.025).kind).toBe('review');
    const l = rec('l', 'static', 0.025, 1e-5, { lateContactsUnexplained: 1 });
    expect(timestepDecision([pilotGate(l)], 0.025).kind).toBe('review');
  });
});
