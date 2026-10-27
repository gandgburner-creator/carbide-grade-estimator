import { describe, expect, it } from 'vitest';
import { analyseSurfaceFlow, DETECTOR_SPEC, dividingHeight, LEVELS, type Level } from '../src/measurements/SeparationDetector';
import { attached, synth } from './helpers/synthFlow';

const rank = (l: Level) => LEVELS.indexOf(l);

describe('dividingHeight', () => {
  const top = [1, 2, 3, 4, 5, 6];
  it('interpolates the zero crossing of the cumulative flux', () => {
    const h = dividingHeight([-0.1, -0.3, -0.2, 0.1, 0.4, 0.8], top);
    expect(h.state).toBe('closed');
    expect(h.value).toBeCloseTo(3 + 0.2 / 0.3, 12);
  });
  it('is zero for flux that never goes negative, open for flux that never returns, unknown for missing data', () => {
    expect(dividingHeight([0.1, 0.2, 0.3], [1, 2, 3])).toEqual({ value: 0, state: 'attached' });
    expect(dividingHeight([-0.1, -0.2, -0.3], [1, 2, 3])).toEqual({ value: 3, state: 'open' });
    expect(dividingHeight([0.1, Number.NaN], [1, 2]).state).toBe('unknown');
  });
});

describe('the reference direction: imposed stream on leeward stations, measured outer flow on windward ones', () => {
  // deep stall: the whole leeward side sits in a wake. Net backflow near the wall, almost no flow above it.
  const stall = (k: number, j: number) => (k >= 6 && k <= 21 ? (j < 4 ? -0.3 : 0.04) : attached(j));
  const leeward = { leeward: () => true, along: 0.42 };
  it('flags a leeward stall that has no attached outer layer to measure a reference from', () => {
    const withRef = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => stall(k, j), reference: leeward }, 31), 'upper');
    expect(withRef.region?.kind).toBe('reversed');
    expect(withRef.primary.stations.filter((s) => s.x > 8 && s.x < 20).every((s) => s.ref.kind === 'imposed stream' && s.ref.value === 0.42)).toBe(true);
    expect(rank(withRef.level)).toBeGreaterThanOrEqual(rank('CANDIDATE_SEPARATION'));
    // without the reference the same data have no forward outer flow: nothing is flagged
    const without = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => stall(k, j) }, 31), 'upper');
    expect(without.region).toBeNull();
    expect(rank(without.level)).toBeLessThan(rank('LOCAL_REVERSAL'));
    expect(without.primary.stations.every((s) => s.ref.kind === 'measured outer flow')).toBe(true);
  });
  it('windward stations keep the measured reference: stagnation flow toward the leading edge is not flagged', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => (k < 8 ? -0.4 : attached(j)), reference: { leeward: () => false, along: 0.42 } }, 32), 'upper');
    expect(a.primary.stations.filter((s) => s.x < 7).every((s) => s.ref.kind === 'measured outer flow' && !s.flags.reversed && !s.flags.fluxReversed)).toBe(true);
    expect(rank(a.level)).toBeLessThan(rank('LOCAL_REVERSAL'));
  });
  it('a stream pointing against the surface (reference ≤ 0) gives no forward reference even on a leeward station', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => stall(k, j), reference: { leeward: () => true, along: -0.2 } }, 33), 'upper');
    expect(a.primary.stations.every((s) => !s.forward)).toBe(true);
    expect(a.region).toBeNull();
  });
  it('noise alone still never produces a candidate with the leeward reference: 120 null data sets', () => {
    let candidates = 0;
    for (let i = 0; i < 120; i++) {
      const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, _k, j) => (j < 4 ? 0 : 0.04), reference: leeward }, 2000 + i), 'upper');
      if (rank(a.level) >= rank('CANDIDATE_SEPARATION')) candidates++;
    }
    expect(candidates).toBe(0);
  });
  it('reports a stalled-but-not-reversed leeward layer as reduced forward velocity relative to the stream', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => (k >= 6 && k <= 21 ? 0.02 : attached(j)), reference: leeward }, 34), 'upper');
    expect(a.level).toBe('REDUCED_FORWARD_VELOCITY');
    expect(a.region?.kind).toBe('reduced');
  });
});

describe('separation detector on synthetic flows', () => {
  it('finds nothing in attached forward flow and reports the reasons', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, _k, j) => attached(j) }, 1), 'upper');
    expect(a.level).toBe('NONE');
    expect(a.region).toBeNull();
    expect(a.provisional).toBe(true);
    expect(a.label).toMatch(/EXPERIMENTAL/);
    expect(a.primary.stations.every((s) => s.hds.state === 'attached')).toBe(true);
  });

  it('noise alone never produces a candidate: 120 null data sets with a stalled (zero-mean) near-wall layer', () => {
    // near-wall mean flow is exactly zero (no reversal), outer flow forward: any flag is a false positive
    const stalled = (j: number) => (j < 4 ? 0 : 0.9);
    let candidates = 0;
    let local = 0;
    for (let i = 0; i < 120; i++) {
      const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, _k, j) => stalled(j) }, 1000 + i), 'upper');
      if (rank(a.level) >= rank('CANDIDATE_SEPARATION')) candidates++;
      if (a.level === 'LOCAL_REVERSAL') local++;
    }
    expect(candidates).toBe(0);
    expect(local).toBeLessThanOrEqual(12); // single-station flags at the 3σ level stay rare (≤ 10 %)
  });

  it('detects a persistent recirculation region and locates it', () => {
    // backflow −0.45 below n = 4.5 over stations 10…19 (x = 10…20 d), forward flow above
    const a = analyseSurfaceFlow(
      synth({ seeds: 3, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? -0.45 : 0.9) : attached(j)), tau: (_r, _b, k) => (k >= 10 && k <= 19 ? -0.03 : 0.02) }, 7),
      'upper',
    );
    expect(rank(a.level)).toBeGreaterThanOrEqual(rank('CANDIDATE_SEPARATION'));
    expect(a.region?.kind).toBe('reversed');
    expect(Math.abs(a.region!.xLo - 10)).toBeLessThanOrEqual(2.01);
    expect(Math.abs(a.region!.xHi - 20)).toBeLessThanOrEqual(2.01);
    // the dividing streamline: Q reaches −0.45·(4 bins) at n = 4.5, then rises with 0.9: zero at 4.5 + 0.45·4/0.9 = 6.5
    const inside = a.primary.stations.filter((s) => s.x > 11 && s.x < 19);
    for (const s of inside) {
      expect(s.hds.state).toBe('closed');
      expect(Math.abs(s.hds.value - 6.5)).toBeLessThan(1.0);
    }
    expect(a.primary.stations.filter((s) => s.x < 8 || s.x > 22).every((s) => s.hds.state === 'attached')).toBe(true);
    expect(a.level).toBe('CONFIRMED_OPERATIONAL');
    for (const c of a.region!.criteria) expect(c.pass, c.id).toBe(true);
    expect(a.variants.filter((v) => rank(v.level) >= rank('CANDIDATE_SEPARATION')).length).toBeGreaterThanOrEqual(DETECTOR_SPEC.minVariants);
  });

  it('a single reversed analysis station (one 2 d station) is only a local reversal, never a region', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => ((k === 14 || k === 15) && j < 4 ? -0.8 : attached(j)) }, 3), 'upper');
    expect(a.level).toBe('LOCAL_REVERSAL');
    expect(a.region).toBeNull();
  });

  it('intermittent backflow (present in half of the time blocks) is not a candidate', () => {
    const a = analyseSurfaceFlow(
      synth({ seeds: 3, u: (_r, b, k, j) => (k >= 10 && k <= 19 && b % 2 === 0 ? (j < 4 ? -0.9 : 0.9) : attached(j)) }, 4),
      'upper',
    );
    expect(rank(a.level)).toBeLessThan(rank('CANDIDATE_SEPARATION'));
  });

  it('backflow in only one of three seeds cannot be confirmed (or even a candidate by persistence)', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (r, _b, k, j) => (r === 0 && k >= 10 && k <= 19 ? (j < 4 ? -1.2 : 0.9) : attached(j)) }, 5), 'upper');
    expect(rank(a.level)).toBeLessThan(rank('CONFIRMED_OPERATIONAL'));
  });

  it('a confirmed finding needs at least three seeds', () => {
    const t = (seeds: number) => analyseSurfaceFlow(synth({ seeds, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? -0.6 : 0.9) : attached(j)), tau: (_r, _b, k) => (k >= 10 && k <= 19 ? -0.04 : 0.02) }, 6), 'upper');
    const two = t(2);
    expect(two.region?.criteria.find((c) => c.id === 'seeds')?.pass).toBeNull();
    expect(two.level).toBe('CANDIDATE_SEPARATION');
    expect(t(3).level).toBe('CONFIRMED_OPERATIONAL');
  });

  it('without an independent wall-shear reversal the level stays a candidate', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? -0.45 : 0.9) : attached(j)), tau: () => 0.03 }, 8), 'upper');
    expect(a.level).toBe('CANDIDATE_SEPARATION');
    expect(a.reasons.join(' ')).toMatch(/wall-shear/);
  });

  it('upstream-directed flow under an outer flow that is itself upstream is not flagged (stagnation flow, stalled wake)', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => (k < 8 ? -0.4 - 0.02 * j : attached(j)) }, 9), 'upper');
    expect(a.primary.stations.filter((s) => s.x < 7).every((s) => !s.flags.reversed && !s.flags.fluxReversed && !s.forward)).toBe(true);
    expect(rank(a.level)).toBeLessThan(rank('LOCAL_REVERSAL'));
  });

  it('reports reduced forward velocity as its own level, below reversal', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? 0.15 : 0.9) : attached(j)) }, 10), 'upper');
    expect(a.level).toBe('REDUCED_FORWARD_VELOCITY');
    expect(a.region?.kind).toBe('reduced');
  });

  it('too little data cannot flag anything, and says so', () => {
    const a = analyseSurfaceFlow(synth({ seeds: 3, rho: 0.002, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? -0.6 : 0.9) : attached(j)) }, 11), 'upper');
    expect(rank(a.level)).toBeLessThan(rank('CANDIDATE_SEPARATION'));
    expect(a.primary.stations.every((s) => !s.sufficient)).toBe(true);
  });

  it('is deterministic and records its own criteria', () => {
    const d = synth({ seeds: 3, u: (_r, _b, _k, j) => attached(j) }, 12);
    const x = analyseSurfaceFlow(d, 'upper');
    const y = analyseSurfaceFlow(d, 'upper');
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    expect(x.spec.id).toBe('wall-flux-detector/0');
    expect(x.spec.alpha).toBe(0.0027);
    expect(x.variants.map((v) => v.name)).toEqual(DETECTOR_SPEC.variants.map((v) => v.name));
  });
});

