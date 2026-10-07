import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { Simulation } from '../src/core/Simulation';
import { releaseEquilibrium, rhoBalanced } from '../src/universeB/Predictions';

/**
 * Design G1 test (2): the release-law mean balance on SYNTHETIC collisions
 * (independent pairs through the real collider, one contact each; no dynamics).
 * Contacts are flux-weighted at kT = 1, reservoirs at their mean (N_c − 1) kT.
 */
function synthetic(Nc: number, e: number, rho: number, K: number) {
  const M = Nc;
  const D = Math.sqrt(Nc);
  const mu = M / 2;
  const dt = 1e-3;
  const rng = new Rng(77, 1);
  const spacing = 4 * D;
  const cols = 100;
  const s = new ParticleStore(2 * K);
  for (let k = 0; k < K; k++) {
    const vn = Math.sqrt((-2 * Math.log(rng.nextOpen())) / mu);
    const vt = rng.gaussian() / Math.sqrt(mu);
    const th = 2 * Math.PI * rng.next();
    const nx = Math.cos(th);
    const ny = Math.sin(th);
    const cx = ((k % cols) + 0.5) * spacing;
    const cy = (Math.floor(k / cols) + 0.5) * spacing;
    const h = 0.5 * (D + 0.5 * vn * dt);
    const rvx = -vn * nx - vt * ny;
    const rvy = -vn * ny + vt * nx;
    s.add({ x: cx - h * nx, y: cy - h * ny, vx: -0.5 * rvx, vy: -0.5 * rvy, radius: D / 2, mass: M });
    s.add({ x: cx + h * nx, y: cy + h * ny, vx: 0.5 * rvx, vy: 0.5 * rvy, radius: D / 2, mass: M });
  }
  for (let i = 0; i < 2 * K; i++) s.energy[i] = Nc - 1;
  const sim = new Simulation(
    {
      domain: { xmin: 0, xmax: cols * spacing, ymin: 0, ymax: Math.ceil(K / cols) * spacing, periodicX: true, periodicY: true },
      walls: [],
      collision: { enabled: true, restitution: e, contact: 'rewind-to-contact', dissipationTarget: 'internal', reservoirRelease: rho },
      timestep: { kind: 'fixed', dt },
      seed: 1,
      referenceKT: 1,
    },
    s,
  );
  sim.step();
  return { n: sim.log.count, loss: sim.ledger.dissipatedToInternal, release: sim.ledger.releasedFromInternal, sim };
}

describe('A-16 release law: mean balance on synthetic collisions (design G1 test 2)', () => {
  const K = 20000;
  for (const [Nc, e] of [[4, 0.9], [16, 0.9], [16, 0.8]] as const) {
    it(`N_c = ${Nc}, e = ${e}: loss, release identity, and the equilibrium it implies`, () => {
      const rho = (1 - e * e) / (2 * (Nc - 1));
      const r = synthetic(Nc, e, rho, K);
      expect(r.n).toBe(K);
      // flux-weighted contacts: ⟨loss⟩ = (1 − e²) kT
      expect(Math.abs(r.loss / K / (1 - e * e) - 1)).toBeLessThan(0.02);
      // as implemented, the release takes ρ of the reservoirs INCLUDING this collision's loss
      expect(Math.abs(r.release - rho * (2 * (Nc - 1) * K + r.loss)) / r.release).toBeLessThan(1e-12);
      // energy (kinetic + internal) is conserved exactly
      expect(Math.abs(r.sim.relativeEnergyResidual())).toBeLessThan(1e-12);
      // hence the design ρ_rel balances at T_kin/T_int = 1/(1 − ρ_rel), not 1
      expect(releaseEquilibrium(Nc, e, rho)).toBeCloseTo(1 / (1 - rho), 12);
      // and ρ* balances exactly: release = loss at T_kin = T_int (to the sampling error of ⟨loss⟩)
      const star = synthetic(Nc, e, rhoBalanced(Nc, e), K);
      expect(Math.abs(star.release / star.loss - 1)).toBeLessThan(0.02);
      expect(releaseEquilibrium(Nc, e, rhoBalanced(Nc, e))).toBeCloseTo(1, 12);
    });
  }
});
