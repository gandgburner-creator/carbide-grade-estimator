import { describe, expect, it } from 'vitest';
import { composeFrozen, type PredictionFile } from '../src/universeB/UB0Freeze';
import { referenceForNc, reviewReference, soundBandWithUncertainty } from '../src/universeB/Predictions';
import { stage0bGroups, type PlannedRun } from '../src/universeB/UB0Plans';
import { UB0Run } from '../src/universeB/UB0Run';
import { amplitudeDecision, cellKeys, dtChecks, estimatesOf, matchedReferences, noiseBasis, type Estimates } from '../src/universeB/UB0Stage0b';
import type { Stat } from '../src/universeB/UB0Stage0';

/** Stage 0b estimators and rules on synthetic per-run values (docs/CRITERIA_UB0_STAGE0B.md). */
const n = 0.2 / (Math.PI / 4);
const KT: Stat = { value: 2.37564, se: 0.00249, df: 13.9, n: 16 };
/** deterministic pseudo-noise: zero mean, unit variance, no RNG state shared with the engine */
const z = (i: number) => Math.sqrt(2) * Math.sin(12.9898 * (i + 1) + 78.233 * (i + 1) * (i + 1));
/** k values with sample mean exactly m and sample relative SD exactly rel */
const series = (m: number, rel: number, k: number, off = 0) => {
  const u = Array.from({ length: k }, (_, i) => z(i + off));
  const mu = u.reduce((a, x) => a + x, 0) / k;
  const sd = Math.sqrt(u.reduce((a, x) => a + (x - mu) ** 2, 0) / (k - 1));
  return u.map((x) => m * (1 + (rel * (x - mu)) / sd));
};
const P = (phi: number) => (phi === 0.18 ? 0.34227 : 0.46326);

function synthetic(o: { c02?: number; c04?: number; shift04?: number; nuShift?: number; Kshift?: number } = {}): Estimates {
  const E: Estimates = {
    's0:T80a1': { nu: series(1.515, 0.106, 94) },
    's0b:T80a1': { nu: series(1.515, 0.106, 106, 500) },
    's0b:T80a1c0125': { nu: series(1.515 * (1 + (o.nuShift ?? 0)), 0.106, 200, 900) },
    's0b:T80a1c00625': { nu: series(1.515, 0.106, 100, 1300) },
    's0:T80a05': { nu: series(1.504, 0.205, 96, 1600) },
    's0:T160a1': { nu: series(1.598, 0.05, 12, 1800) },
    's0b:T160a1': { nu: series(1.598, 0.05, 88, 1900) },
    's0:L160': { c: series(2.194, o.c02 ?? 0.047, 15, 2100) },
    's0b:L160': { c: series(2.194, o.c02 ?? 0.047, 17, 2200) },
    's0b:L160a04': { c: series(2.194 * (1 + (o.shift04 ?? 0)), o.c04 ?? 0.024, 32, 2300) },
    's0b:L160c0125': { c: series(2.194, 0.03, 16, 2400) },
    's0b:L160c00625': { c: series(2.194, 0.03, 32, 2500) },
    's0:SL': { S1: series(0.42, 0.072, 8, 2600), S2: series(0.427, 0.037, 8, 2700) },
    's0b:SL': { S1: series(0.42, 0.072, 24, 2800), S2: series(0.427, 0.037, 24, 2900) },
    's0b:SLc00625': { S1: series(0.42, 0.072, 16, 3000), S2: series(0.427, 0.037, 16, 3100) },
    's0:SK18': { Pnorm: series(P(0.18), 7e-4, 8, 3200) },
    's0:SK22': { Pnorm: series(P(0.22), 6e-4, 8, 3300) },
    's0:W40': { gw1: series(1, 0.006, 4, 3400), gw2: series(1, 0.041, 4, 3500), gw3: series(1, 0.0018, 4, 3600) },
    's0b:W40': { gw1: series(1, 0.006, 28, 3700), gw2: series(1, 0.041, 28, 3800), gw3: series(1, 0.0018, 28, 3900) },
  };
  for (const c of ['c0125', 'c00625']) {
    const k = 1 + (o.Kshift ?? 0);
    // K ∝ P22 − P18: shift both about P20 = 0.4 to scale K by k
    E[`s0b:SK18${c}`] = { Pnorm: series(0.4 - (0.4 - P(0.18)) * k, 7e-4, 8, 4000) };
    E[`s0b:SK22${c}`] = { Pnorm: series(0.4 + (P(0.22) - 0.4) * k, 6e-4, 8, 4100) };
  }
  return E;
}

describe('the sound-amplitude decision (protocol §4)', () => {
  it('selects 0.04 when its scatter is materially smaller and c is unchanged', () => {
    const d = amplitudeDecision(synthetic());
    expect(d.rule).toEqual({ precisionGain: true, ciContainsOne: true, shiftWithin1pct: true });
    expect(d.selected).toBe(0.04);
    expect(d.n).toEqual({ a02: 32, a04: 32 });
  });
  it('keeps 0.02 when the larger amplitude does not reduce the scatter by 25 %', () => {
    const d = amplitudeDecision(synthetic({ c04: 0.042 }));
    expect(d.rule.precisionGain).toBe(false);
    expect(d.selected).toBe(0.02);
  });
  it('keeps 0.02 when the larger amplitude shifts c by more than 1 %, even within the CI', () => {
    const d = amplitudeDecision(synthetic({ shift04: 0.015 }));
    expect(d.rule.shiftWithin1pct).toBe(false);
    expect(d.selected).toBe(0.02);
  });
  it('keeps 0.02 when an amplitude effect is detected', () => {
    const d = amplitudeDecision(synthetic({ shift04: 0.04 }));
    expect(d.rule.ciContainsOne).toBe(false);
    expect(d.selected).toBe(0.02);
  });
});

describe('the timestep checks (protocol §5)', () => {
  it('K at the finer Courant numbers must lie within ±1/30 of the frozen K_T,A, else review', () => {
    const ok = dtChecks(synthetic(), KT, 0.04).filter((c) => c.quantity.startsWith('K'));
    expect(ok).toHaveLength(2);
    expect(ok.every((c) => c.outcome === 'PASS' && !c.review)).toBe(true);
    const off = dtChecks(synthetic({ Kshift: 0.05 }), KT, 0.04).filter((c) => c.quantity.startsWith('K'));
    expect(off.every((c) => c.review)).toBe(true);
  });
  it('ν, c and S: review only if the ratio CI lies entirely outside [0.97, 1.03]', () => {
    const base = dtChecks(synthetic(), KT, 0.04).filter((c) => !c.quantity.startsWith('K'));
    expect(base.some((c) => c.review)).toBe(false);
    const bad = dtChecks(synthetic({ nuShift: 0.08 }), KT, 0.04).find((c) => c.quantity.startsWith('ν') && c.courant === 0.0125)!;
    expect(bad.outcome).toBe('FAIL');
    expect(bad.review).toBe(true);
  });
});

describe('matched references and the noise basis (A2 §1.4, §3)', () => {
  const E = synthetic();
  it('each N_c\'s reference is measured at that N_c\'s Courant number', () => {
    const r = matchedReferences(E, 0.04);
    expect(r.nu[4].n).toBe(200); // T80a1 at 0.0125 (N4-shear)
    expect(r.nu[16].n).toBe(200); // Stage 0 94 + Stage 0b 106 at 0.025
    expect(r.nu[64].n).toBe(100); // L 160 d: Stage 0 12 + Stage 0b 88
    expect(r.cA[4].n).toBe(32); // L160 at 0.00625, selected amplitude
    expect(r.cA[16].n).toBe(32); // L160a04 at 0.025
    expect(r.SA[4][0].n).toBe(16); // SL at 0.00625
    expect(r.SA[16][0].n).toBe(32); // SL at 0.025, pooled
    expect(matchedReferences(E, 0.02).cA[16].n).toBe(32); // Stage 0 15 + Stage 0b 17
  });
  it('a halved group without a matched Universe A cell stops for the contingency', () => {
    expect(() => matchedReferences(E, 0.04, { 'N4-static': 0.003125, 'N4-shear': 0.0125, 'N16-shear': 0.025, 'N64-shear': 0.025, 'N16-static': 0.025, 'N64-static': 0.025 })).toThrow(/contingency/);
  });
  it('the noise basis pools within Courant cells', () => {
    const N = noiseBasis(E, 0.04);
    expect(N.nuL80a1.df).toBe(199 + 199 + 99);
    expect(N.nuL160a1.df).toBe(99);
    expect(N.c.df).toBe(31 + 15 + 31);
    expect(N.S1.df).toBe(31 + 15);
    expect(N.gw2.df).toBe(31);
    expect(N.nuL80a1.sd).toBeGreaterThan(0.08);
    expect(N.nuL80a1.sd).toBeLessThan(0.13);
    expect(cellKeys('c', 0.025, 0.02)).toEqual(['s0:L160', 's0b:L160']);
  });
});

describe('estimates from real runs (tiny Universe A boxes, design seeds)', () => {
  it('the committed estimators fill the cells of their groups', { timeout: 120_000 }, () => {
    const defs = stage0bGroups();
    const mk = (g: string, seed: number, over: Partial<PlannedRun>): PlannedRun => {
      const d = defs.find((x) => x.group === g)!;
      return { ...d.base, ...over, id: `t-${g}`, seed, group: g, planned: true, periodHint: d.periodHint } as PlannedRun;
    };
    const plans = [
      mk('SL', 9081, { L: 14, prep: 1, settle: 0.5, measure: 4 }),
      mk('T80a1', 9082, { L: 14, prep: 1, settle: 0.5, measure: 4 }),
      mk('L160', 9083, { L: 14, prep: 1, settle: 0.5, measure: 6, periodHint: 1 } as Partial<PlannedRun>),
    ];
    const runs = plans.map((plan) => {
      const { group, planned, periodHint, ...spec } = plan;
      void group;
      void planned;
      void periodHint;
      const r = new UB0Run(spec);
      while (!r.done) r.advance(2000);
      return { plan, result: r.result() };
    });
    const E = estimatesOf(runs, 's0b');
    expect(E['s0b:SL'].S1).toHaveLength(1);
    expect(E['s0b:SL'].lambda).toHaveLength(1);
    expect(E['s0b:T80a1'].nu).toHaveLength(1);
    expect(E['s0b:L160'].c).toHaveLength(1);
  });
});

describe('the A2 freeze', () => {
  const refs = matchedReferences(synthetic(), 0.04);
  const pred = (map: boolean): PredictionFile => ({
    label: 'stage0b',
    commit: 'x',
    ...(map ? { map: { releaseFraction: 'rho*', amendment: 'A2 (D2)' } } : {}),
    values: Object.fromEntries(
      [4, 16, 64].flatMap((N) => [
        [`mf.cLo.${N}`, 0.7],
        [`mf.cHi.${N}`, 0.75],
        [`pq3.lo.${N}`, 0.95],
        [`pq3.hi.${N}`, 1.1],
        [`mf.What160.${N}`, 0.99],
      ]),
    ),
  });
  it('refuses prediction files from before the D2 correction (no mixing of pre- and post-D2 outputs)', () => {
    expect(() => composeFrozen({ KTred: KT, refs, amplitude: 0.04, pred: pred(false), provenance: {} })).toThrow(/predates/);
  });
  it('keeps the Stage 0 mapping input and takes the matched references per N_c', () => {
    const f = composeFrozen({ KTred: KT, refs, amplitude: 0.04, pred: pred(true), provenance: {} });
    expect(f.version).toBe('A2');
    expect(f.KTred).toBe(KT.value);
    expect(f.A.KT.value).toBeCloseTo(KT.value * n, 12);
    expect(f.A.nu[4]).toEqual(refs.nu[4]);
    expect(f.A.SA[4]).toEqual(refs.SA[4]);
    expect(f.cA[4]).toBe(refs.cA[4].value);
    expect(f.soundAmplitude).toBe(0.04);
  });
  it('the sound band at an N_c uses the c_A matched to it', () => {
    const ref = { ...reviewReference(), cA: { value: 2.19, se: 0.02, df: 30, source: 'a' }, cAByNc: { 4: { value: 2.25, se: 0.02, df: 31, source: 'b' } } };
    expect(referenceForNc(ref, 4).cA.value).toBe(2.25);
    expect(referenceForNc(ref, 16).cA.value).toBe(2.19);
    expect(soundBandWithUncertainty(4, referenceForNc(ref, 4)).GammaA).toBeCloseTo((2.25 * 2.25) / ref.KTred.value, 12);
  });
});
