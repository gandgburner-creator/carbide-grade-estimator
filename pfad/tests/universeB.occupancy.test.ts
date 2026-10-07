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
