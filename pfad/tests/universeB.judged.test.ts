import { describe, expect, it } from 'vitest';
import type { ShearEstimate, SoundEstimate, StaticEstimate, WallEstimate } from '../src/universeB/UB0Estimators';
import { judge, oscillatoryEnsemble, type JudgedInputs, type StaticRun } from '../src/universeB/UB0Judged';
import type { Stat } from '../src/universeB/UB0Stage0';

/** Synthetic per-run estimates only; no simulation. */
const S = (value: number, se: number, n: number): Stat => ({ value, se, df: n - 1, n });
const jitter = (v: number, i: number, a: number) => v * (1 + a * (i % 2 === 0 ? 1 : -1));
const rho = 0.2 / (Math.PI / 4);
const KT = 0.6037;

function stat(P: number, i: number, extra: Partial<StaticEstimate> = {}): StaticRun {
  const est = { Pnorm: jitter(P, i, 1e-4), TkinOverTint: jitter(1, i, 2e-3), a2: 0.002 * (i % 2 ? 1 : -1), S: [0.105, 0.11, 0.12], psi6: 0.02, ...extra } as StaticEstimate;
  return { est, qSound: est.Pnorm };
}
function shear(nu: number, n: number, drift = 4e-4, share = 0.05): ShearEstimate[] {
  return Array.from({ length: n }, (_, i) => ({ nu_p: jitter(nu, i, 0.02), occShare: jitter(share, i, 0.1), driftOverWave: drift }) as ShearEstimate);
}

function baseInputs(): JudgedInputs {
  const statics: Record<string, StaticRun[]> = {};
  const dP = (KT * 0.04) / 0.2 / 2;
  for (const key of ['SK4c2', 'SK16c2', 'SK64c2', 'SK4c4']) {
    statics[`${key}p18`] = Array.from({ length: 8 }, (_, i) => stat(1 - dP, i));
    statics[`${key}p20`] = Array.from({ length: 8 }, (_, i) => stat(1, i));
    statics[`${key}p22`] = Array.from({ length: 8 }, (_, i) => stat(1 + dP, i));
  }
  // RPA-consistent parcel S at the two lowest shells
  const sr = (SA: number, a: number, w: number) => 1 / (1 / SA + a * w);
  const a4 = 3 * 2.371;
  const a16 = 15 * 2.371;
  statics.SL4 = Array.from({ length: 4 }, (_, i) => stat(1, i, { S: [sr(0.42, a4, 0.99), sr(0.45, a4, 0.98), 0] }));
  statics.SL16 = Array.from({ length: 4 }, (_, i) => stat(1, i, { S: [sr(0.42, a16, 0.97), sr(0.45, a16, 0.94), 0] }));
  const cFor = (G: number) => Math.sqrt((G * KT) / rho);
  const sound = (G: number): SoundEstimate[] => Array.from({ length: 4 }, (_, i) => ({ c: jitter(cFor(G), i, 1e-3) }) as SoundEstimate);
  const wall = (R: number): WallEstimate[] => Array.from({ length: 4 }, (_, i) => ({ gw1: jitter(1, i, 1e-4), gw2: jitter(1, i, 1e-3), gw3: jitter(1, i, 1e-3), R: jitter(R, i, 0.01) }) as WallEstimate);
  return {
    level: {},
    A: { nuL80: S(1.38, 0.005, 48), nuL160: S(1.38, 0.005, 12), KT: S(KT, 0.003, 16), SA: [S(0.42, 0.005, 8), S(0.45, 0.005, 8)] },
    P: {
      judgedGamma: { 4: [1.01, 1.3], 16: [0.95, 1.11], 64: [0.95, 1.07] },
      rpaStrength: { 4: a4, 16: a16 },
      WhatShells: { 4: [0.99, 0.98], 16: [0.97, 0.94] },
      rho,
    },
    static: statics,
    shear: {
      T4a1: shear(1.38, 48),
      T4a05: shear(1.38, 96),
      T16a1: shear(1.38, 48, 4e-4),
      T16a05: shear(1.38, 96),
      T64a1: shear(1.38, 6),
      T16e08: shear(1.38, 48),
      T16e095: shear(1.38, 48),
      T4c4: shear(1.38, 24),
      T16dt: shear(1.38, 48, 1e-4),
    },
    sound: { L4: sound(1.1), L16: sound(1.03), L64: sound(1.01) },
    wall: { W4c2: wall(1.0), W16c2: wall(1.01), W4c4: wall(0.99) },
    gates: [{ id: 'x', momentumResidual: 1e-13, drift: 1e-4, driftLimit: 0.01, unexplainedLateContacts: 0, halted: false }],
    oscillatory: {},
    exclusionsOver10pct: false,
  };
}

describe('UB-0 judged-analysis assembly (synthetic estimates)', () => {
  it('a fully consistent synthetic data set is a PASS with F5-impl', () => {
    const j = judge(baseInputs());
    expect(j.labels).toEqual([]);
    expect(j.bulk).toBe('PASS');
    expect(j.overall).toBe('PASS');
    expect(j.wall.verdict).toBe('F5-impl');
  });

  it('a non-inherited viscosity at N_c = 16 is F1 → FAIL', () => {
    const i = baseInputs();
    i.shear.T16a1 = shear(1.7, 48, 4e-4);
    i.shear.T16a05 = shear(1.7, 96);
    i.shear.T16e08 = shear(1.7, 48);
    i.shear.T16e095 = shear(1.7, 48);
    i.shear.T16dt = shear(1.7, 48, 1e-4);
    const j = judge(i);
    expect(j.labels).toContain('F1');
    expect(j.overall).toBe('FAIL');
  });

  it('a pressure-closure miss at N_c = 16 with transport intact is a PARTIAL PASS', () => {
    const i = baseInputs();
    const dP = (KT * 0.04) / 0.2 / 2;
    i.static.SK16c2p18 = Array.from({ length: 8 }, (_, k) => stat(1 - 1.4 * dP, k));
    i.static.SK16c2p22 = Array.from({ length: 8 }, (_, k) => stat(1 + 1.4 * dP, k));
    const j = judge(i);
    expect(j.outcomes.pq2[16]).toBe('FAIL');
    expect(j.labels).toContain('F2');
    expect(j.overall).toBe('PARTIAL PASS');
  });

  it('the wall verdict never enters the bulk verdict', () => {
    const i = baseInputs();
    i.wall.W16c2 = Array.from({ length: 4 }, (_, k) => ({ gw1: 1, gw2: 1, gw3: 1, R: jitter(1.6, k, 0.01) }) as WallEstimate);
    const j = judge(i);
    expect(j.wall.verdict).toBe('F5-phys');
    expect(j.overall).toBe('PASS');
  });

  it('oscillation check', () => {
    const t = Array.from({ length: 50 }, (_, k) => k);
    const mono = [0, 1, 2].map((s) => ({ t, U: t.map((x) => Math.exp(-x / 20) + 0.001 * s) }));
    expect(oscillatoryEnsemble(mono, [5, 45])).toBe(false);
    const osc = [0, 1, 2].map((s) => ({ t, U: t.map((x) => Math.exp(-x / 30) * Math.cos(x / 5) + 0.001 * s) }));
    expect(oscillatoryEnsemble(osc, [5, 45])).toBe(true);
  });
});
