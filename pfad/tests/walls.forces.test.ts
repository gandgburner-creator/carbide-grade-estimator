import { describe, expect, it } from 'vitest';
import { ParticleStore } from '../src/core/ParticleStore';
import { Simulation, type ForceModel } from '../src/core/Simulation';

/**
 * Model p0.5: with forces acting, a plane-wall event is evaluated at the contact
 * instant (as pair collisions since p0.2). A particle under a uniform force,
 * which velocity Verlet integrates exactly, bouncing on a wall must conserve
 * energy to round-off. Before p0.5 the error was first order per wall event
 * (≈ 3 × 10⁻³ … 3 × 10⁻² over 200 time units, not converging with dt).
 */
class Uniform implements ForceModel {
  readonly name = 'uniform-test';
  readonly version = 'test';
  computeForces(s: ParticleStore): number {
    let U = 0;
    for (let i = 0; i < s.count; i++) {
      s.fy[i] -= s.mass[i];
      U += s.mass[i] * s.y[i];
    }
    return U;
  }
}

function bounce(Aw: number, dt: number) {
  const s = new ParticleStore(1);
  s.add({ x: 5, y: 3, vx: 0.3, vy: -0.7, radius: 0.5, mass: 1 });
  const sim = new Simulation(
    {
      domain: { xmin: 0, xmax: 10, ymin: 0, ymax: 100, periodicX: true, periodicY: false },
      walls: [{ side: 'bottom', accommodation: Aw, temperature: 1 }, { side: 'top', accommodation: 0 }],
      collision: { enabled: false, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
      timestep: { kind: 'fixed', dt },
      seed: 1,
      referenceKT: 1,
      // the uniform test force is not a pair force: its impulse is not ledgered
      safety: { momentumTolerance: 1e9, energyTolerance: 1e9 },
    },
    s,
    [new Uniform()],
  );
  let maxRes = 0;
  for (let k = 0; k < 10000 && sim.step(); k++) maxRes = Math.max(maxRes, Math.abs(sim.energyResidual()));
  return { maxRes, hits: sim.walls[0].totals() };
}

describe('plane walls under forces (model p0.5)', () => {
  for (const Aw of [0, 1]) {
    for (const dt of [0.02, 0.005]) {
      it(`uniform force, Aw = ${Aw}, dt = ${dt}: energy conserved to round-off across wall events`, () => {
        const { maxRes } = bounce(Aw, dt);
        expect(maxRes).toBeLessThan(1e-11);
      });
    }
  }
});
