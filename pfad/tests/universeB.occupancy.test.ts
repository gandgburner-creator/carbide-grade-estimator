import { describe, expect, it } from 'vitest';
import { Domain } from '../src/core/Domain';
import { createGas } from '../src/gas/InitialConditions';
import { OccupancyForce } from '../src/occupancy/OccupancyModel';
import { henderson, parcelMap } from '../src/universeB/CoarseGrainMap';
import { UBOccupancyForce } from '../src/universeB/UBOccupancyForce';

/**
 * Implementation test only (a static configuration; no dynamics, no observable):
 * the UB-0 occupancy force must be bit-identical to the A-15 OccupancyForce, and
 * its diagnostic pass must not touch the forces.
 */
describe('UB-0 occupancy force = A-15 occupancy force', () => {
  for (const [Nc, ch] of [[4, 2], [16, 2], [4, 4]]) {
    it(`bit-identical forces and potential (N_c = ${Nc}, c_h = ${ch})`, () => {
      const m = parcelMap({ Nc, ch, e: 0.9 }, { KTred: henderson.KTred(0.2) });
      const L = 30 * m.diameter;
      const spec = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true };
      const count = Math.round(m.numberDensity * L * L);
      const { store } = createGas({ count, radius: m.radius, mass: m.mass, kT: 1, distribution: 'maxwell', seed: 77, domain: spec });
      const domain = new Domain(spec);
      const a = store.clone();
      const b = store.clone();
      a.fx.fill(0);
      a.fy.fill(0);
      b.fx.fill(0);
      b.fy.fill(0);
      const Ua = new OccupancyForce({ ks: m.ks, h: m.h }).computeForces(a, domain);
      const ub = new UBOccupancyForce({ ks: m.ks, h: m.h });
      const Ub = ub.computeForces(b, domain);
      expect(Ub).toBe(Ua);
      expect(Buffer.from(b.fx.buffer).equals(Buffer.from(a.fx.buffer))).toBe(true);
      expect(Buffer.from(b.fy.buffer).equals(Buffer.from(a.fy.buffer))).toBe(true);
      const fx = Buffer.from(b.fx.buffer).toString('base64');
      const meas = ub.measure(b, domain, (2 * Math.PI) / L);
      expect(Buffer.from(b.fx.buffer).toString('base64')).toBe(fx);
      expect(meas.wxx).toBeGreaterThan(0);
      expect(meas.wyy).toBeGreaterThan(0);
    });
  }
});

describe('occupancy stiffness diagnostic (design §11.6)', () => {
  it('maxOmega equals √(|λ|max/M) of the finite-difference force Jacobian', () => {
    const m = parcelMap({ Nc: 4, ch: 2, e: 0.9 }, { KTred: henderson.KTred(0.2) });
    const L = 16 * m.diameter;
    const spec = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true };
    const count = Math.round(m.numberDensity * L * L);
    const { store } = createGas({ count, radius: m.radius, mass: m.mass, kT: 1, distribution: 'maxwell', seed: 78, domain: spec });
    const domain = new Domain(spec);
    const ub = new UBOccupancyForce({ ks: m.ks, h: m.h });
    const w = ub.maxOmega(store, domain);
    // finite-difference Jacobian of the force on each parcel w.r.t. its own position
    const eps = 1e-5 * m.diameter;
    const force = (s: typeof store) => {
      s.fx.fill(0);
      s.fy.fill(0);
      ub.computeForces(s, domain);
    };
    let best = 0;
    for (let i = 0; i < store.count; i++) {
      const K = [0, 0, 0, 0];
      for (const [d, col] of [['x', 0], ['y', 1]] as const) {
        const p = store.clone();
        const q = store.clone();
        p[d][i] += eps;
        q[d][i] -= eps;
        force(p);
        force(q);
        K[col] = -(p.fx[i] - q.fx[i]) / (2 * eps);
        K[2 + col] = -(p.fy[i] - q.fy[i]) / (2 * eps);
      }
      const mm = 0.5 * (K[0] + K[3]);
      const dd = Math.hypot(0.5 * (K[0] - K[3]), 0.5 * (K[1] + K[2]));
      best = Math.max(best, Math.sqrt(Math.max(Math.abs(mm + dd), Math.abs(mm - dd)) / store.mass[i]));
    }
    expect(store.count).toBeGreaterThan(50);
    expect(Math.abs(w / best - 1)).toBeLessThan(1e-6);
  });
});
