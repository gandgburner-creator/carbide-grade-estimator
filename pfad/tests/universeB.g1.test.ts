import { describe, expect, it } from 'vitest';
import { Domain } from '../src/core/Domain';
import { ParticleStore } from '../src/core/ParticleStore';
import { lucyDW } from '../src/occupancy/OccupancyModel';
import { henderson, parcelMap, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { wallEstimate } from '../src/universeB/UB0Estimators';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';
import { UBOccupancyForce } from '../src/universeB/UBOccupancyForce';

/**
 * The remaining G1 implementation tests of the design (§15.2): (3) occupancy
 * virial against analytic two-body and lattice sums; (4) the Fourier stress
 * projection on a constructed field; (5) the contact theorem in a wall box;
 * (6) ledger closure with occupancy, reservoir and walls; (7) byte-identical
 * resume at N_c > 1. Static configurations, Universe A runs, or miniature
 * Universe B runs at design seeds; no Universe B physics value is asserted.
 */
const m4 = parcelMap({ Nc: 4, ch: 2, e: 0.9 }, { KTred: henderson.KTred(UB0_PHI) });

/** independent brute force over all pairs with the minimum image */
function brute(s: ParticleStore, dom: Domain, ks: number, h: number, kY: number) {
  const out = { wxx: 0, wyy: 0, wxy: 0, projCos: 0, projSin: 0 };
  for (let i = 0; i < s.count; i++) {
    for (let j = i + 1; j < s.count; j++) {
      const dx = dom.imageDx(s.x[i] - s.x[j]);
      const dy = dom.imageDy(s.y[i] - s.y[j]);
      const r = Math.hypot(dx, dy);
      if (r === 0 || r >= h) continue;
      const a = 0.5 * Math.PI * (s.radius[i] ** 2 + s.radius[j] ** 2);
      const f = (-ks * a * lucyDW(r, h)) / r;
      out.wxx += f * dx * dx;
      out.wyy += f * dy * dy;
      out.wxy += f * dx * dy;
      const ybar = s.y[j] + 0.5 * dy;
      const u = 0.5 * kY * dy;
      const w = f * dx * dy * (u === 0 ? 1 : Math.sin(u) / u);
      out.projCos += w * Math.cos(kY * ybar);
      out.projSin += w * Math.sin(kY * ybar);
    }
  }
  return out;
}

describe('G1 (3) occupancy virial', () => {
  it('two bodies: w = f r ⊗ r with f = −k_s a W′(r)/r', () => {
    const L = 10 * m4.h;
    const dom = new Domain({ xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true });
    const s = new ParticleStore(2);
    const r = 0.6 * m4.h;
    const th = 0.37;
    s.add({ x: 3 * m4.h, y: 3 * m4.h, vx: 0, vy: 0, radius: m4.radius, mass: m4.mass });
    s.add({ x: 3 * m4.h + r * Math.cos(th), y: 3 * m4.h + r * Math.sin(th), vx: 0, vy: 0, radius: m4.radius, mass: m4.mass });
    const o = new UBOccupancyForce({ ks: m4.ks, h: m4.h }).measure(s, dom, 0);
    const f = (-m4.ks * m4.parcelArea * lucyDW(r, m4.h)) / r;
    expect(o.wxx).toBeCloseTo(f * (r * Math.cos(th)) ** 2, 10);
    expect(o.wyy).toBeCloseTo(f * (r * Math.sin(th)) ** 2, 10);
    expect(o.wxy).toBeCloseTo(f * r * r * Math.cos(th) * Math.sin(th), 10);
    expect(f).toBeGreaterThan(0); // repulsive
  });

  it('a periodic lattice: grid sum = brute-force sum, isotropic (wxx = wyy, wxy = 0)', () => {
    const a = 0.45 * m4.h;
    const nside = 24;
    const L = nside * a;
    const dom = new Domain({ xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true });
    const s = new ParticleStore(nside * nside);
    for (let i = 0; i < nside; i++) for (let j = 0; j < nside; j++) s.add({ x: (i + 0.5) * a, y: (j + 0.5) * a, vx: 0, vy: 0, radius: m4.radius, mass: m4.mass });
    const o = new UBOccupancyForce({ ks: m4.ks, h: m4.h }).measure(s, dom, 0);
    const b = brute(s, dom, m4.ks, m4.h, 0);
    expect(Math.abs(o.wxx / b.wxx - 1)).toBeLessThan(1e-12);
    expect(Math.abs(o.wyy / b.wyy - 1)).toBeLessThan(1e-12);
    expect(Math.abs(o.wxx / o.wyy - 1)).toBeLessThan(1e-12);
    expect(Math.abs(o.wxy / o.wxx)).toBeLessThan(1e-12);
  });
});

describe('G1 (4) Fourier stress projection on a constructed field', () => {
  it('projection at k = 2π/L equals the brute-force pair sum on a random configuration', () => {
    const L = 12 * m4.h;
    const dom = new Domain({ xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true });
    const s = new ParticleStore(300);
    let seed = 12345;
    const u = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 300; i++) s.add({ x: u() * L, y: u() * L, vx: 0, vy: 0, radius: m4.radius, mass: m4.mass });
    const k = (2 * Math.PI) / L;
    const o = new UBOccupancyForce({ ks: m4.ks, h: m4.h }).measure(s, dom, k);
    const b = brute(s, dom, m4.ks, m4.h, k);
    expect(Math.abs(o.projCos - b.projCos)).toBeLessThan(1e-9 * Math.abs(b.wxy) + 1e-9);
    expect(Math.abs(o.projSin - b.projSin)).toBeLessThan(1e-9 * Math.abs(b.wxy) + 1e-9);
    // a pure sinusoidal shear field: rows displaced by ε sin(ky) on a lattice; the strain is εk cos(ky),
    // so the stress projects on cos(ky) only, linearly in ε
    const project = (eps: number) => {
      const lat = new ParticleStore(900);
      const a = L / 30;
      for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
        const y = (j + 0.5) * a;
        lat.add({ x: (i + 0.5) * a + eps * a * Math.sin(k * y), y, vx: 0, vy: 0, radius: m4.radius, mass: m4.mass });
      }
      return new UBOccupancyForce({ ks: m4.ks, h: m4.h }).measure(lat, dom, k);
    };
    const p1 = project(1e-4);
    const p2 = project(2e-4);
    expect(Math.abs(p1.projCos)).toBeGreaterThan(0);
    expect(Math.abs(p1.projSin / p1.projCos)).toBeLessThan(1e-6);
    expect(Math.abs(p2.projCos / p1.projCos - 2)).toBeLessThan(1e-3);
  });
});

describe('G1 (5) contact theorem in a wall box (Universe A, hard disks)', () => {
  it('n_contact kT_w / P_wall ≈ 1 (G-W2) and P_wall equals the core normal stress (G-W1)', { timeout: 300_000 }, () => {
    const spec: UB0Spec = { id: 'g1-ct', kind: 'wall', Nc: 1, ch: 0, e: 1, KTred: henderson.KTred(UB0_PHI), phi: UB0_PHI, courant: 0.025, seed: 9031, width: 40, height: 24, prep: 40, settle: 0, measure: 1500, sample: 1, observables: true };
    const run = new UB0Run(spec);
    while (!run.done) run.advance(20000);
    const w = wallEstimate(run.result());
    expect(Math.abs(w.gw2 - 1)).toBeLessThan(0.06);
    expect(Math.abs(w.gw1 - 1)).toBeLessThan(0.03);
  });
});

describe('G1 (6) ledger closure with occupancy, reservoir and walls', () => {
  it('momentum to round-off, internal energy ledger exact, total energy to integrator accuracy', () => {
    const spec: UB0Spec = { id: 'g1-led', kind: 'couette', Nc: 4, ch: 2, e: 0.9, KTred: henderson.KTred(UB0_PHI), phi: UB0_PHI, courant: 0.025, seed: 9032, width: 14, height: 40, wallSpeed: 1, prep: 1, settle: 0, measure: 3, sample: 1, observables: false };
    const run = new UB0Run(spec);
    let eint0 = Number.NaN;
    while (!run.done) {
      run.advance(500);
      if ((run as unknown as { phase: string }).phase === 'measure' && Number.isNaN(eint0)) {
        const s = run.sim.store;
        eint0 = 0;
        for (let i = 0; i < s.count; i++) eint0 += s.energy[i];
        eint0 -= run.sim.ledger.dissipatedToInternal - run.sim.ledger.releasedFromInternal;
      }
    }
    const s = run.sim.store;
    let eint = 0;
    for (let i = 0; i < s.count; i++) eint += s.energy[i];
    const L = run.sim.ledger;
    expect(Math.abs(eint - eint0 - (L.dissipatedToInternal - L.releasedFromInternal)) / eint).toBeLessThan(1e-12);
    const r = run.result();
    const m = r.phaseLedgers.measure as { momentumResidual: { x: number; y: number }; relativeEnergyResidual: number };
    expect(Math.hypot(m.momentumResidual.x, m.momentumResidual.y) / (r.info.parcels * r.map.mass * r.map.sigmaV)).toBeLessThan(1e-12);
    expect(Math.abs(m.relativeEnergyResidual)).toBeLessThan(1e-4);
    expect(L.wallEnergyOut).not.toBe(0); // the moving walls do exchange energy, and it is ledgered
  });
});

describe('G1 (7) checkpoint/resume byte-identical at N_c > 1', () => {
  const B = { Nc: 4, ch: 2, e: 0.9, KTred: henderson.KTred(UB0_PHI), courant: 0.025, observables: true, phi: UB0_PHI };
  const tiny: Record<string, UB0Spec> = {
    static: { ...B, id: 'b-static', kind: 'static', seed: 9041, L: 14, prep: 1, settle: 0.5, measure: 2, sample: 0.5, extras: true },
    shear: { ...B, id: 'b-shear', kind: 'shear', seed: 9042, L: 14, amplitude: 1, prep: 1, settle: 0.5, measure: 2, sample: 0.5 },
    sound: { ...B, id: 'b-sound', kind: 'sound', seed: 9043, L: 14, amplitude: 0.05, prep: 1, settle: 0.5, measure: 2, sample: 0.5 },
    wall: { ...B, id: 'b-wall', kind: 'wall', seed: 9044, width: 14, height: 40, prep: 1, settle: 0, measure: 2, sample: 0.5 },
    couette: { ...B, id: 'b-couette', kind: 'couette', seed: 9045, width: 14, height: 40, wallSpeed: 1, prep: 1, settle: 0, measure: 2, sample: 0.5 },
  };
  const strip = (r: ReturnType<UB0Run['result']>) => {
    const { timing, ...rest } = r;
    void timing;
    return JSON.stringify(rest);
  };
  for (const kind of Object.keys(tiny)) {
    it(kind, () => {
      const spec = tiny[kind];
      const ref = new UB0Run(spec);
      let steps = 0;
      while (!ref.done) steps += ref.advance(1000);
      const want = strip(ref.result());
      for (const cut of [5, Math.floor(steps / 2), steps - 3]) {
        const run = new UB0Run(spec);
        let taken = 0;
        while (taken < cut && !run.done) taken += run.advance(Math.min(17, cut - taken));
        const resumed = UB0Run.resume(JSON.parse(JSON.stringify(run.checkpoint())));
        while (!resumed.done) resumed.advance(1000);
        expect(strip(resumed.result())).toBe(want);
      }
    });
  }
});
