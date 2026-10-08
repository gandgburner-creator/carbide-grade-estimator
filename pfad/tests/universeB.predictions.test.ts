import { describe, expect, it } from 'vitest';
import { henderson, parcelMap, releaseFractionFor, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import {
  diskProjected,
  hendersonZPrime,
  lucyHat,
  lucyProjected,
  meanFieldPressure,
  releaseEquilibrium,
  reviewReference,
  rhoBalanced,
  rhoDesignSuperseded,
  soundBand,
  wallProfile,
} from '../src/universeB/Predictions';

const ref = reviewReference();

describe('UB-0 coarse-graining map', () => {
  it('N_c = 1 is Universe A: no occupancy, no reservoir, unit restitution', () => {
    const m = parcelMap({ Nc: 1, ch: 2, e: 1 }, { KTred: ref.KTred.value });
    expect(m.mass).toBe(1);
    expect(m.diameter).toBe(1);
    expect(m.ks).toBe(0);
    expect(m.internalEnergy).toBe(0);
    expect(m.releaseFraction).toBe(0);
    expect(() => parcelMap({ Nc: 1, ch: 2, e: 0.9 }, { KTred: ref.KTred.value })).toThrow();
  });

  it('keeps φ, ρ and D·σ_v invariant and scales the rest as derived', () => {
    for (const Nc of [4, 16, 64]) {
      const m = parcelMap({ Nc, ch: 2, e: 0.9 }, { KTred: ref.KTred.value });
      expect(m.numberDensity * m.parcelArea).toBeCloseTo(UB0_PHI, 14);
      expect(m.numberDensity * m.mass).toBeCloseTo(UB0_PHI / (Math.PI / 4), 14);
      expect(m.diameter * m.sigmaV).toBeCloseTo(1, 14);
      expect(m.h / m.diameter).toBeCloseTo(2 * Math.sqrt(Nc), 12);
      expect(m.ks).toBeCloseTo(((Nc - 1) * ref.KTred.value) / UB0_PHI, 12);
      // release balance of A-16 as coded (A2, D2): the release takes ρ of (2(N_c − 1) kT + loss),
      // the loss is (1 − e²) kT, so (1 − ρ)(1 − e²) = ρ·2(N_c − 1), i.e. ρ = (1 − e²)/(2(N_c − 1) + 1 − e²)
      expect((1 - m.releaseFraction) * (1 - 0.81)).toBeCloseTo(m.releaseFraction * 2 * (Nc - 1), 14);
      expect(m.releaseFraction).toBeCloseTo(0.19 / (2 * (Nc - 1) + 0.19), 15);
    }
  });
});

describe('UB-0 release fraction ρ_rel (amendment A2, D2)', () => {
  it('is ρ* for every e and N_c, and gives T_kin = T_int in the mean balance of the coded law', () => {
    for (const Nc of [2, 4, 16, 64, 256]) {
      for (const e of [0.8, 0.9, 0.95]) {
        const m = parcelMap({ Nc, ch: 2, e }, { KTred: ref.KTred.value });
        expect(m.releaseFraction).toBe(releaseFractionFor(Nc, e));
        expect(m.releaseFraction).toBe(rhoBalanced(Nc, e));
        expect(releaseEquilibrium(Nc, e, m.releaseFraction)).toBeCloseTo(1, 13);
        // the superseded design formula is larger by the factor (2(N_c − 1) + 1 − e²)/(2(N_c − 1))
        // and balances at 1/(1 − ρ), which is what made PQ4 fail by construction at N_c = 4
        const old = rhoDesignSuperseded(Nc, e);
        expect(old / m.releaseFraction).toBeCloseTo((2 * (Nc - 1) + 1 - e * e) / (2 * (Nc - 1)), 13);
        expect(releaseEquilibrium(Nc, e, old)).toBeCloseTo(1 / (1 - old), 13);
      }
    }
    // the values of record (A2 §2): N_c = 4, 16, 64 at e = 0.9 and the e arms at N_c = 16
    const r = (Nc: number, e: number) => parcelMap({ Nc, ch: 2, e }, { KTred: ref.KTred.value }).releaseFraction;
    expect(r(4, 0.9)).toBeCloseTo(0.0306947, 7);
    expect(r(16, 0.9)).toBeCloseTo(0.0062935, 7);
    expect(r(64, 0.9)).toBeCloseTo(0.0015057, 7);
    expect(r(16, 0.8)).toBeCloseTo(0.0118577, 7);
    expect(r(16, 0.95)).toBeCloseTo(0.0032395, 7);
  });
});

describe('UB-0 analytical predictions', () => {
  it('Henderson identities: K_T/(nkT) = Z + φZ′ and Z − 1 = φ d(βf_ex)/dφ', () => {
    const p = UB0_PHI;
    const dZ = (henderson.Z(p + 1e-6) - henderson.Z(p - 1e-6)) / 2e-6;
    expect(hendersonZPrime(p)).toBeCloseTo(dZ, 6);
    expect(henderson.KTred(p)).toBeCloseTo(henderson.Z(p) + p * dZ, 6);
    const dF = (henderson.betaFex(p + 1e-6) - henderson.betaFex(p - 1e-6)) / 2e-6;
    expect(henderson.betaFexPrime(p)).toBeCloseTo(dF, 6);
    expect(p * henderson.betaFexPrime(p)).toBeCloseTo(henderson.Z(p) - 1, 10);
  });

  it('kernel transforms are normalised', () => {
    expect(lucyHat(0, 3)).toBeCloseTo(1, 8);
    let s = 0;
    for (let i = -400; i <= 400; i++) s += lucyProjected(i * 0.01, 3) * 0.01;
    expect(s).toBeCloseTo(1, 4);
    let w = 0;
    for (let i = -200; i <= 200; i++) w += diskProjected(i * 0.01, 1) * 0.01;
    expect(w).toBeCloseTo(1, 3);
    // small-k expansion W̃ ≈ 1 − k²⟨r²⟩/4, ⟨r²⟩ = (5/28) h² for the Lucy kernel
    expect(lucyHat(0.05, 1)).toBeCloseTo(1 - (0.05 * 0.05 * 5) / 28 / 4, 7);
  });

  it('mean-field closure reproduces the isothermal modulus and the stated pressure ratio', () => {
    for (const Nc of [4, 16, 64]) {
      const p = meanFieldPressure(Nc, ref);
      // K_B/(n_p kT) = Z + φZ′ (hard cores) + (N_c − 1)(Z + φZ′) (occupancy) = N_c K_T,A/(n kT)
      const KB = ref.KTred.value + (Nc - 1) * ref.KTred.value;
      expect(KB / Nc).toBeCloseTo(ref.KTred.value, 12);
      expect(p.ZratioBA).toBeCloseTo(1 / Nc + (1 - 1 / Nc) * (ref.KTred.value / (2 * ref.Z.value)), 12);
      const b = soundBand(Nc, ref);
      expect(b.Gamma[0]).toBeLessThan(b.Gamma[1]);
      expect(b.Gamma[1]).toBeLessThan(b.GammaA);
    }
  });

  it('the wall solver reduces to the bulk without occupancy (LDA) and conserves N (canonical)', () => {
    const w = wallProfile({ Nc: 1, ch: 2, functional: 'LDA', ensemble: 'grand', HoverH: 4 }, ref);
    expect(w.converged).toBe(true);
    for (const v of w.phi) expect(v).toBeCloseTo(UB0_PHI, 9);
    const c = wallProfile({ Nc: 4, ch: 2, functional: 'SDA', ensemble: 'canonical', HoverH: 6 }, ref);
    expect(c.converged).toBe(true);
    const a = Math.PI / 4;
    const N = c.phi.reduce((s, v) => s + (v / a) * c.options.dy, 0);
    expect(N).toBeCloseTo((UB0_PHI / a) * 6 * 4, 6);
  });
});

describe('PQ3 band with propagated Universe A uncertainty (A1 §5)', () => {
  it('reduces to the point band without SEs and widens with them', async () => {
    const { soundBandWithUncertainty, soundBand } = await import('../src/universeB/Predictions');
    const point = soundBandWithUncertainty(4, ref);
    const b = soundBand(4, ref);
    expect(point.band[0]).toBeCloseTo(b.Gamma[0], 12);
    expect(point.band[1]).toBeCloseTo(b.Gamma[1], 12);
    expect(point.judged[0]).toBeCloseTo(b.Gamma[0] - 0.05, 12);
    const withSE = soundBandWithUncertainty(4, {
      ...ref,
      cA: { ...ref.cA, se: 0.02, df: 7 },
      KTred: { ...ref.KTred, se: 0.03, df: 12 },
    });
    expect(withSE.band[0]).toBeLessThan(point.band[0]);
    expect(withSE.band[1]).toBeGreaterThan(point.band[1]);
    expect(withSE.seGammaA).toBeCloseTo(withSE.GammaA * Math.hypot(0.04 / 2.17, 0.03 / ref.KTred.value), 12);
  });
});
