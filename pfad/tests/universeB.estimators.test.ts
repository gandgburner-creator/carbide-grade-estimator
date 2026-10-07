import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Random';
import { henderson, parcelMap } from '../src/universeB/CoarseGrainMap';
import {
  couetteEstimate,
  dampedCosFit,
  expDecayFit,
  shearEstimate,
  soundEstimate,
  staticEstimate,
  wallEstimate,
} from '../src/universeB/UB0Estimators';
import type { Sample, UB0Result, UB0Spec } from '../src/universeB/UB0Run';
import { occupancyStressMF, type DensityBins } from '../src/universeB/WallStress';

const KT = henderson.KTred(0.2);
const base = { ch: 2, e: 0.9, KTred: KT, courant: 0.025, observables: true, phi: 0.2, prep: 0, settle: 0, sample: 0.5 };

function fake(spec: UB0Spec, samples: Sample[], extra: Partial<UB0Result> = {}): UB0Result {
  const map = parcelMap({ Nc: spec.Nc, ch: spec.ch, e: spec.Nc === 1 ? 1 : spec.e }, { KTred: KT, phi: 0.2 });
  return {
    spec,
    map,
    info: { parcels: 1630, imposedKineticEnergy: 100 },
    measureTime: samples.length ? samples[samples.length - 1].t : 0,
    samples,
    tallies: {},
    walls: [],
    lostEvents: 0,
    phaseLedgers: { measure: { E0: 1000 } },
    timing: {},
    ...extra,
  } as UB0Result;
}

describe('UB-0 estimators on synthetic data', () => {
  it('exponential decay fit in linear amplitude recovers the rate under noise', () => {
    const rng = new Rng(1, 9);
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 300; i++) {
      x.push(i * 0.5);
      y.push(2 * Math.exp(-0.02 * i * 0.5) + 0.01 * rng.gaussian());
    }
    const f = expDecayFit(x, y);
    expect(f.b).toBeGreaterThan(0.02 * 0.97);
    expect(f.b).toBeLessThan(0.02 * 1.03);
    expect(f.A0).toBeCloseTo(2, 1);
  });

  it('damped-cosine fit recovers frequency and damping', () => {
    const rng = new Rng(2, 9);
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const ti = i * 0.1;
      t.push(ti);
      y.push(1.5 * Math.exp(-0.01 * ti) * Math.cos(0.7 * ti + 0.3) + 0.05 * rng.gaussian());
    }
    const f = dampedCosFit(t, y);
    expect(Math.abs(f.omega / 0.7 - 1)).toBeLessThan(0.002);
    expect(Math.abs(f.gamma / 0.01 - 1)).toBeLessThan(0.15);
  });

  it('shear estimator: thermal-time decay, stress decomposition and occupancy share', () => {
    const spec: UB0Spec = { ...base, id: 's', kind: 'shear', Nc: 1, ch: 0, e: 1, seed: 1, L: 80, amplitude: 1, measure: 180 };
    const L = 80;
    const k = (2 * Math.PI) / L;
    const nu = 1.3;
    const tau = 1 / (1.379 * k * k);
    const rho = 0.2 / (Math.PI / 4);
    const muKin = 0.25 * rho * nu;
    const muColl = 0.6 * rho * nu;
    const muOcc = 0.15 * rho * nu;
    const samples: Sample[] = [];
    let s = 0;
    let tPrev = 0;
    const T = (t: number) => 1 + 0.2 * (1 - Math.exp(-t / 50));
    for (let i = 0; i <= 360; i++) {
      const t = i * 0.5;
      // exact thermal time by fine integration
      const m = 50;
      for (let j = 0; j < m; j++) {
        const a = tPrev + ((j + 0.5) * (t - tPrev)) / m;
        s += Math.sqrt(T(a)) * ((t - tPrev) / m);
      }
      tPrev = t;
      const U = Math.exp(-nu * k * k * s);
      samples.push({
        t,
        Tkin: T(t),
        Tint: 0,
        Us: U,
        Uc: 0,
        akc: -muKin * k * U,
        aks: 0,
        acc: -muColl * k * U,
        acs: 0,
        aoc: -muOcc * k * U,
        aos: 0,
        energyResidual: 1e-3,
        momentumResidual: 1e-14,
        collisions: 0,
      });
    }
    const e = shearEstimate(fake(spec, samples), tau);
    expect(Math.abs(e.nu_p / nu - 1)).toBeLessThan(2e-3);
    expect(e.nuRaw_p).toBeGreaterThan(nu); // heating makes the raw-time fit too fast
    expect(e.nuStress_p).toBeCloseTo(nu, 9);
    expect(e.nuOcc_p).toBeCloseTo(0.15 * nu, 9);
    expect(e.occShare).toBeCloseTo(0.15, 9);
    expect(e.window[0]).toBeCloseTo(0.1 * tau, 9);
    expect(e.driftOverWave).toBeCloseTo(1e-5, 12);
  });

  it('sound estimator recovers the phase speed in molecular units', () => {
    const Nc = 4;
    const spec: UB0Spec = { ...base, id: 'l', kind: 'sound', Nc, seed: 1, L: 160, amplitude: 0.1, measure: 1000 };
    const k = (2 * Math.PI) / 160;
    const cMol = 1.6;
    const cParcel = cMol * Math.sqrt(Nc); // in σ_v units
    const w = cParcel * k;
    const P = 160 / (cParcel * 0.95);
    const samples: Sample[] = [];
    for (let i = 0; i <= 2800; i++) {
      const t = i * 0.5;
      samples.push({ t, Tkin: 1, Tint: 1, Vs: 0.1 * Math.exp(-0.002 * t) * Math.cos(w * t), Vc: 0, Rc: 0.02 * Math.exp(-0.002 * t) * Math.sin(w * t), Rs: 0, energyResidual: 0, momentumResidual: 0, collisions: 0 });
    }
    const e = soundEstimate(fake(spec, samples), P);
    expect(Math.abs(e.c / cMol - 1)).toBeLessThan(1e-3);
    expect(Math.abs(e.cDensity / cMol - 1)).toBeLessThan(1e-3);
    expect(e.gamma_p).toBeCloseTo(0.002, 4);
  });

  it('static estimator: temperature-normalised pressure, structure factor, collision rate', () => {
    const spec: UB0Spec = { ...base, id: 'st', kind: 'static', Nc: 1, ch: 0, e: 1, seed: 1, L: 80, measure: 500 };
    const samples: Sample[] = [];
    for (let i = 0; i <= 500; i++) {
      samples.push({ t: i, Tkin: 1.02, Tint: 0, Pkin: 0.26, Pcoll: 0.15, Pocc: 0.05, Pxy: 0, a2: 0.001, meanSpeed: 1.25, S1: 0.4, S2: 0.45, S3: 0.5, energyResidual: 0, momentumResidual: 0, collisions: 1000 * i });
    }
    const e = staticEstimate(fake(spec, samples, { info: { parcels: 1630 } }));
    expect(e.Pnorm).toBeCloseTo((0.26 + 0.15) / 1.02 + 0.05, 12);
    [0.4, 0.45, 0.5].forEach((v, i) => expect(e.S[i]).toBeCloseTo(v, 12));
    expect(e.collisionRate_p).toBeCloseTo((2 * 1000) / 1630, 12);
    expect(e.lambda_p).toBeCloseTo(1.25 / ((2 * 1000) / 1630), 9);
    expect(e.np).toBeCloseTo(0.2 / (Math.PI / 4), 12);
  });

  it('wall estimator: gates are 1 for consistent stresses and R = 1 when the occupancy stress is the mean field', () => {
    const Nc = 4;
    const spec: UB0Spec = { ...base, id: 'w', kind: 'wall', Nc, seed: 1, width: 40, height: 40, measure: 2000, sample: 1 };
    const map = parcelMap({ Nc, ch: 2, e: 0.9 }, { KTred: KT, phi: 0.2 });
    const D = map.diameter;
    const W = 40 * D;
    const H = 40 * D;
    const fine = D / 20;
    const nb = Math.round(H / fine);
    const snaps = 100;
    const nb0 = map.numberDensity;
    // a density profile with a near-wall bump, symmetric
    const nOf = (y: number) => {
      const d = Math.min(y, H - y) - D / 2;
      if (d < 0) return 0;
      return nb0 * (1 + 0.8 * Math.exp(-d / (0.3 * D)) - 0.2 * Math.exp(-((d - 2 * D) ** 2) / (2 * D * D)));
    };
    const count: number[] = [];
    const mvy2: number[] = [];
    for (let b = 0; b < nb; b++) {
      const n = nOf((b + 0.5) * fine);
      count.push(n * snaps * W * fine);
      mvy2.push(n * snaps * W * fine * map.kT); // kinetic P_yy = n kT
    }
    // planes and the mean-field occupancy stress of exactly this density
    const np = Math.floor((H - D) / (D / 4)) + 1;
    const planes = Array.from({ length: np }, (_, p) => D / 2 + p * (D / 4));
    const bins: DensityBins = { y: [], width: [], n: [] };
    for (let b = 0; b < nb; b++) {
      bins.y.push((b + 0.5) * fine);
      bins.width.push(fine);
      bins.n.push(count[b] / (snaps * W * fine));
    }
    const pMF = occupancyStressMF(bins, planes, map.h, map.ks * map.parcelArea);
    const occSamples = 50;
    const planesOcc = pMF.map((p) => p * occSamples * W);
    // collisional planes: choose them so that the total normal stress is uniform = Ptot
    const pkinAt = (y: number) => nOf((Math.floor(y / fine) + 0.5) * fine) * map.kT;
    const Ptot = Math.max(...planes.map((y, i) => pMF[i] + pkinAt(y))) * 1.1;
    const Tm = 2000 * Nc;
    const planesColl = planes.map((y, i) => (Ptot - pMF[i] - pkinAt(y)) * W * Tm);
    const tallies = { count, mvy2, mvx2: count.map(() => 0), mvx: count.map(() => 0), eint: count.map(() => 0), planesOcc, planesColl, occSamples, profileSnapshots: snaps, psi6Sum: 0, psi6Samples: 0 };
    const wallImp = Ptot * W * Tm;
    const r = fake(spec, [], {
      tallies,
      measureTime: 2000,
      walls: [
        { normalImpulse: wallImp, tangentialImpulse: 0 },
        { normalImpulse: wallImp, tangentialImpulse: 0 },
      ] as unknown as UB0Result['walls'],
    });
    const e = wallEstimate(r);
    expect(e.gw1).toBeCloseTo(1, 9);
    expect(e.gw3).toBeCloseTo(1, 9);
    // the estimator bins the density as A1 §2.4 prescribes (D/20 near the walls, D/4 in the core);
    // this reference used D/20 everywhere, so they agree to the discretisation level
    expect(Math.abs(e.R - 1)).toBeLessThan(3e-3);
    expect(e.Rwalls[0]).toBeCloseTo(e.Rwalls[1], 9);
    // contact density: quadratic extrapolation of a smooth profile to y = D/2
    expect(e.contactDensity / nOf(D / 2 + 1e-9)).toBeGreaterThan(0.97);
    expect(e.gw2).toBeCloseTo((e.contactDensity * map.kT) / Ptot, 12);
    // a measured deficit 20 % deeper than the mean field shifts R accordingly
    const coreMean = (() => {
      const h = map.h;
      const v = planes.map((y, i) => (y >= 3 * h && y <= H - 3 * h ? pMF[i] : NaN)).filter(Number.isFinite);
      return v.reduce((a, b) => a + b, 0) / v.length;
    })();
    const deeper = pMF.map((p) => coreMean - 1.2 * (coreMean - p));
    const e2 = wallEstimate(fake(spec, [], { ...r, tallies: { ...tallies, planesOcc: deeper.map((p) => p * occSamples * W) } }));
    expect(e2.R).toBeGreaterThan(1.1);
  });

  it('Couette estimator: core shear rate, wall stress and μ', () => {
    const spec: UB0Spec = { ...base, id: 'c', kind: 'couette', Nc: 1, ch: 0, e: 1, seed: 1, width: 40, height: 40, wallSpeed: 1, measure: 3000, sample: 1 };
    const fine = 1 / 20;
    const nb = 40 / fine;
    const g = 0.02;
    const count: number[] = [];
    const mvx: number[] = [];
    const mvx2: number[] = [];
    const mvy2: number[] = [];
    for (let b = 0; b < nb; b++) {
      const y = (b + 0.5) * fine;
      const u = g * (y - 20);
      count.push(100);
      mvx.push(100 * u);
      mvx2.push(100 * (u * u + 1));
      mvy2.push(100);
    }
    const Tm = 3000;
    const tau = 0.35 * g;
    const r = fake(spec, [], {
      measureTime: 3000,
      tallies: { count, mvx, mvx2, mvy2, eint: count.map(() => 0) },
      walls: [
        { normalImpulse: 0, tangentialImpulse: tau * 40 * Tm },
        { normalImpulse: 0, tangentialImpulse: -tau * 40 * Tm },
      ] as unknown as UB0Result['walls'],
    });
    const e = couetteEstimate(r);
    expect(e.shearRate).toBeCloseTo(g, 9);
    expect(e.mu).toBeCloseTo(0.35, 9);
    expect(e.Tcore).toBeCloseTo(1, 4); // D/2 bins average u² over the bin
    expect(e.slip[0]).toBeCloseTo((g * -20 + 0.5) / 1, 9);
  });
});
