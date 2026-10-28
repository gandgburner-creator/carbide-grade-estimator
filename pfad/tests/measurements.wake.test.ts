import { describe, expect, it } from 'vitest';
import { analyseWake, WAKE_SPEC, WakeAccumulator, wakeFromTotals } from '../src/measurements/WakeVoid';
import { SUMS } from '../src/measurements/SurfaceFlowSampler';
import { attached, NB, S, synth } from './helpers/synthFlow';

const N0 = 0.127;
const data = (rho: (k: number, j: number) => number, seeds = 3, seed = 5) => ({ ...synth({ seeds, rho, u: (_r, _b, _k, j) => attached(j) }, seed), ambientDensity: N0 });
/** density N0 (θ = 1) everywhere except a void of relative density `th` out to bin `top` on stations from k0 on */
const void_ = (k0: number, top: number, th: number, k1 = S) => (k: number, j: number) => N0 * (k >= k0 && k < k1 && j < top ? th : 1);

describe('wake-void/0: do the particles touch the surface?', () => {
  it('finds no separation where the gas presses on the whole surface', () => {
    const w = analyseWake(data(() => N0), 'upper')!;
    expect(w.separation).toBeNull();
    expect(w.unwettedFraction).toBe(0);
    for (const s of w.stations) {
      expect(s.contact.mean).toBeGreaterThan(0.85);
      expect(s.contact.mean).toBeLessThan(1.15);
      expect(s.gap).toBe(0);
    }
  });

  it('puts the separation point where the contact layer empties, and measures how far the cloud stands off', () => {
    const w = analyseWake(data(void_(12, 6, 0.25)), 'upper')!;
    expect(w.separation).not.toBeNull();
    // stations pool 3 neighbours, so the onset is known to about a station
    expect(w.separation!.x).toBeGreaterThan(10.5);
    expect(w.separation!.x).toBeLessThan(13.5);
    expect(w.run!.xHi).toBeCloseTo(30, 0);
    // the density recovers at bin 6: the gap is about 5 d (between 4.5 and 5.5)
    expect(w.meanGap).toBeGreaterThan(4.3);
    expect(w.meanGap).toBeLessThan(5.7);
    expect(w.meanContact).toBeLessThan(0.4);
    for (const s of w.stations.slice(0, 9)) expect(s.unwetted).toBe(false);
    for (const s of w.stations.slice(14, 28)) expect(s.unwetted).toBe(true);
    expect(w.label).toMatch(/EXPERIMENTAL/);
    expect(w.spec).toBe('wake-void/0');
  });

  it('a single unwetted station is not a separation', () => {
    const w = analyseWake(data(void_(14, 5, 0.1, 15), 3, 6), 'upper')!;
    // pooled over 3 stations a one-station void still spreads over its neighbours: but never the minimum run of the unwetted verdict
    const run = w.stations.filter((s) => s.unwetted).length;
    expect(run).toBeLessThan(WAKE_SPEC.minRun + 2);
    const alone = wakeFromTotals(
      { stations: 6, bins: 3, counts: [100, 100, 100, 100, 100, 100, 10, 90, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], exposure: [800, 800, 800, 800, 800, 800], xs: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5], ambient: 0.125, dn: 1 },
      'upper',
      { ...WAKE_SPEC, pool: 1 },
    );
    expect(alone.stations.filter((s) => s.unwetted).length).toBe(1);
    expect(alone.separation).toBeNull();
  });

  it('gives no verdict where there is too little exposure to tell an empty layer from a full one', () => {
    const few = wakeFromTotals({ stations: 4, bins: 3, counts: new Array(12).fill(1), exposure: [20, 20, 20, 20], xs: [0.5, 1.5, 2.5, 3.5], ambient: 0.125, dn: 1 }, 'upper', { ...WAKE_SPEC, pool: 1 });
    expect(few.stations.every((s) => !s.known && !s.unwetted)).toBe(true);
    expect(few.separation).toBeNull();
    // the same low density WITH enough exposure is an unwetted surface
    const many = wakeFromTotals({ stations: 4, bins: 3, counts: new Array(12).fill(10), exposure: [800, 800, 800, 800], xs: [0.5, 1.5, 2.5, 3.5], ambient: 0.125, dn: 1 }, 'upper', { ...WAKE_SPEC, pool: 1 });
    expect(many.stations.every((s) => s.known && s.unwetted)).toBe(true);
  });

  it('uses batch-mean standard errors from the blocks, and flags only a clear void as significant', () => {
    const w = analyseWake(data(void_(12, 6, 0.25)), 'upper')!;
    const lee = w.stations[22];
    const front = w.stations[3];
    expect(lee.significant).toBe(true);
    expect(front.significant).toBe(false);
    expect(lee.contact.se).toBeGreaterThan(0);
    expect(lee.contact.n).toBe(48);
  });

  it('needs the free-stream density', () => {
    const d = synth({ seeds: 1, u: (_r, _b, _k, j) => attached(j) }, 9);
    expect(analyseWake(d, 'upper')).toBeNull();
  });
});

describe('the rolling accumulator follows a moving surface', () => {
  const block = (th: number) => {
    const sums = new Array<number>(S * NB * SUMS).fill(0);
    for (let k = 0; k < S; k++) for (let j = 0; j < NB; j++) sums[(k * NB + j) * SUMS] = 100 * N0 * (j < 4 ? th : 1);
    return sums;
  };
  const lengths = new Array<number>(S).fill(1);
  const xs = Array.from({ length: S }, (_, k) => k + 0.5);

  it('weights new blocks over old ones by the decay factor', () => {
    const acc = new WakeAccumulator(S, NB);
    acc.fold(block(0.2), 100, lengths, 1, 0.5);
    let w = wakeFromTotals(acc.totals(xs, N0, 1), 'upper');
    expect(w.meanContact).toBeCloseTo(0.2, 1);
    expect(w.separation).not.toBeNull();
    // the surface moved out into the cloud: the layer is now dense; the old data fade
    for (let i = 0; i < 5; i++) acc.fold(block(1.0), 100, lengths, 1, 0.5);
    w = wakeFromTotals(acc.totals(xs, N0, 1), 'upper');
    expect(w.separation).toBeNull();
    expect(w.stations[15].contact.mean).toBeGreaterThan(0.9);
  });
});
