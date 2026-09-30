import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import { Simulation } from '../src/core/Simulation';
import { createGas } from '../src/gas/InitialConditions';
import { reservoirFluxPerDensity, sampleCrossingNormal } from '../src/gas/InflowSampling';

/** E[s] and E[s²] of p(s) ∝ s exp(−(s−a)²/2), s > 0, by quadrature. */
function moments(a: number) {
  let z = 0;
  let m1 = 0;
  let m2 = 0;
  const ds = 1e-4;
  for (let s = ds / 2; s < a + 14; s += ds) {
    const w = s * Math.exp(-0.5 * (s - a) ** 2);
    z += w;
    m1 += w * s;
    m2 += w * s * s;
  }
  return { m1: m1 / z, m2: m2 / z };
}

describe('reservoir inflow sampling', () => {
  for (const a of [-1, 0, 0.7, 2.5]) {
    it(`crossing normal velocities follow the flux-weighted drifting Maxwellian (a = ${a})`, () => {
      const rng = new Rng(3);
      const n = 60_000;
      let s1 = 0;
      let s2 = 0;
      for (let k = 0; k < n; k++) {
        const s = sampleCrossingNormal(a, rng);
        expect(s).toBeGreaterThan(0);
        s1 += s;
        s2 += s * s;
      }
      const ref = moments(a);
      expect(s1 / n).toBeCloseTo(ref.m1, 1);
      expect(s2 / n).toBeCloseTo(ref.m2, 1);
    });
  }

  it('flux for zero drift is n·sqrt(kT/(2π m))', () => {
    expect(reservoirFluxPerDensity(0, 2, 1)).toBeCloseTo(Math.sqrt(2 / (2 * Math.PI)), 6);
  });
});

function channelWithReservoirs(U: number, seed: number, phi = 0.01, L = 200, H = 100) {
  const r = 0.5;
  const n0 = phi / (Math.PI * r * r);
  const domain = { xmin: 0, xmax: L, ymin: 0, ymax: H, periodicX: false, periodicY: false };
  const N0 = Math.round(n0 * L * H);
  const { store } = createGas({ count: N0, radius: r, mass: 1, kT: 1, distribution: 'maxwell', seed, domain, flow: { x: U, y: 0 }, extraCapacity: N0 });
  const res = { numberDensity: n0, kT: 1, velocity: { x: U, y: 0 }, mass: 1, radius: r };
  const S = new Simulation(
    {
      domain,
      walls: [
        { side: 'bottom', accommodation: 0 },
        { side: 'top', accommodation: 0 },
      ],
      boundaries: [
        { side: 'left', ...res },
        { side: 'right', ...res },
      ],
      collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
      timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 },
      seed,
    },
    store,
  );
  return { S, store, N0, n0, L, H };
}

describe('open reservoir boundaries', () => {
  it('dilute gas: a zero-drift reservoir box holds the stated density and temperature; the ledger closes exactly', () => {
    const { S, store, N0 } = channelWithReservoirs(0, 5);
    let nSum = 0;
    let kTSum = 0;
    let k = 0;
    while (S.time < 400) {
      S.run(200);
      if (S.time > 100) {
        nSum += store.count;
        kTSum += store.kineticEnergy() / store.count;
        k++;
      }
    }
    expect(S.halted).toBe(false);
    expect(S.ledger.particlesIn).toBeGreaterThan(100);
    expect(S.ledger.particlesOut).toBeGreaterThan(100);
    expect(Math.abs(nSum / k / N0 - 1)).toBeLessThan(0.05);
    expect(Math.abs(kTSum / k - 1)).toBeLessThan(0.05);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-9);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-9);
  });

  it('dense gas (characterisation, A-18): the kinetic-only reservoir leaves the interior below the stated density', () => {
    // The reservoir supplies kinetic pressure n0·kT only (no collisions across the plane),
    // so the interior settles near n·Z(φ) ≈ n0: a deficit of order 20–30 % at φ = 0.2.
    const { S, store, N0 } = channelWithReservoirs(0, 7, 0.2, 120, 40);
    let nSum = 0;
    let k = 0;
    while (S.time < 200) {
      S.run(100);
      if (S.time > 60) {
        nSum += store.count;
        k++;
      }
    }
    const ratio = nSum / k / N0;
    expect(ratio).toBeLessThan(0.9);
    expect(ratio).toBeGreaterThan(0.65);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-9);
  });

  it('a drifting reservoir sustains the stated stream velocity through the channel', () => {
    const { S, store } = channelWithReservoirs(0.6, 6);
    let uSum = 0;
    let k = 0;
    while (S.time < 300) {
      S.run(200);
      if (S.time > 100) {
        uSum += store.momentum().x / store.totalMass();
        k++;
      }
    }
    expect(Math.abs(uSum / k - 0.6)).toBeLessThan(0.05);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-9);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-9);
  });
});
