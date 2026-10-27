import { describe, expect, it } from 'vitest';
import { EXPERIMENTS } from '../src/experiments/registry';
import { UB_LOCK_MESSAGE, UBInstrumentExperiment, type UBInstrumentCheckpoint, type UBInstrumentParams } from '../src/experiments/UBInstrumentExperiment';

/** The UB-0 instrument as a laboratory experiment: Universe A only. */
const tinyStatic: UBInstrumentParams = { ...(EXPERIMENTS['ub-instrument']!.quick as UBInstrumentParams), L: 12, prep: 4, settle: 1, measure: 8, sample: 1, seeds: [101, 102] };

describe('UB-0 instrument in the app (Universe A only)', () => {
  it('refuses Universe B (N_c > 1)', () => {
    expect(() => new UBInstrumentExperiment({ ...tinyStatic, Nc: 4 })).toThrow(UB_LOCK_MESSAGE);
    expect(() => EXPERIMENTS['ub-instrument']!.create({ ...tinyStatic, Nc: 16 })).toThrow(/Universe B .* is locked/);
  });

  it('runs at N_c = 1 and records per-seed and ensemble estimates from the UB-0 estimators', () => {
    const rec = new UBInstrumentExperiment(tinyStatic).runToCompletion();
    const r = rec.results as { ensemble: Record<string, { mean: number; n: number }>; perSeed: Record<string, number>[] };
    expect(rec.experimentType).toBe('ub-instrument');
    expect(r.perSeed).toHaveLength(2);
    expect(r.ensemble.Pnorm.n).toBe(2);
    // Pnorm = P/T (absolute); the compressibility factor P/(n kT) of hard disks at φ = 0.2 is ≈ 1.6
    const Z = r.ensemble.Pnorm.mean / r.ensemble.np.mean;
    expect(Z).toBeGreaterThan(1.3);
    expect(Z).toBeLessThan(1.9);
    expect(rec.status).toBe('UNTESTED');
    expect(rec.assumptions.join(' ')).toMatch(/outside the UB-0 protocol/);
  });

});

describe('UB-0 instrument checkpoints', () => {
  it('a JSON round trip of a mid-run checkpoint resumes bit for bit', () => {
    const full = new UBInstrumentExperiment(tinyStatic).runToCompletion();
    const x = new UBInstrumentExperiment(tinyStatic);
    while (x.runIndex < 1) x.advance(500);
    x.advance(700);
    const cp = JSON.parse(JSON.stringify(x.checkpoint())) as UBInstrumentCheckpoint;
    expect(cp.results).toHaveLength(1);
    const y = UBInstrumentExperiment.resume(cp);
    expect(y.steps).toBe(x.steps);
    const rec = y.runToCompletion();
    expect(JSON.stringify((rec.results as { perSeed: unknown }).perSeed)).toBe(JSON.stringify((full.results as { perSeed: unknown }).perSeed));
  });
});

describe('checkpoint encoding works without Node Buffer (browser worker)', () => {
  it('the btoa/atob path gives the same base64 as Buffer, for large arrays too', async () => {
    const { toBase64, fromBase64 } = await import('../src/universeB/SimState');
    const bytes = new Uint8Array(100_003);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const viaBtoa = btoa(s);
    expect(toBase64(bytes)).toBe(viaBtoa);
    const back = Uint8Array.from(atob(viaBtoa), (c) => c.charCodeAt(0));
    expect(Buffer.from(fromBase64(viaBtoa)).equals(Buffer.from(back))).toBe(true);
  });
});
