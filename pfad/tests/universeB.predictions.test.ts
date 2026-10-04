import { describe, expect, it } from 'vitest';
import { henderson, parcelMap, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import {
  diskProjected,
  hendersonZPrime,
  lucyHat,
  lucyProjected,
  meanFieldPressure,
  reviewReference,
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
      // release balance: ρ_rel·2(N_c − 1) kT = (1 − e²) kT
      expect(m.releaseFraction * 2 * (Nc - 1)).toBeCloseTo(1 - 0.81, 14);
    }
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
