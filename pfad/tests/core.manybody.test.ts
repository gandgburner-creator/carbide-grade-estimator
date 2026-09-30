import { describe, expect, it } from 'vitest';
import type { DomainSpec } from '../src/core/Domain';
import { Simulation, type SimulationConfig } from '../src/core/Simulation';
import { createGas, squareBoxSide } from '../src/gas/InitialConditions';
import type { PlaneWallConfig } from '../src/walls/WallModel';

function gasSim(opts: {
  N: number;
  phi: number;
  seed: number;
  periodic: boolean;
  restitution?: number;
  walls?: PlaneWallConfig[];
  dt?: number;
}) {
  const L = squareBoxSide(opts.N, 0.5, opts.phi);
  const domain: DomainSpec = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: opts.periodic, periodicY: opts.periodic };
  const { store } = createGas({ count: opts.N, radius: 0.5, mass: 1, kT: 1, distribution: 'maxwell', seed: opts.seed, domain });
  const walls: PlaneWallConfig[] = opts.periodic
    ? []
    : (opts.walls ?? (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, accommodation: 0 })));
  const config: SimulationConfig = {
    domain,
    walls,
    collision: {
      enabled: true,
      restitution: opts.restitution ?? 1,
      contact: 'rewind-to-contact',
      dissipationTarget: 'external',
    },
    timestep: { kind: 'fixed', dt: opts.dt ?? 0.01 },
    seed: opts.seed,
  };
  return new Simulation(config, store);
}

describe('many-body gas', () => {
  it('periodic elastic gas conserves momentum and energy to round-off', () => {
    const S = gasSim({ N: 500, phi: 0.1, seed: 3, periodic: true });
    const p0 = S.store.momentum();
    S.run(3000);
    expect(S.halted).toBe(false);
    // λ ≈ 5.6 d at φ = 0.1 and ⟨|v|⟩ ≈ 1.25, so ~7 collisions per particle by t = 30
    expect(S.log.count).toBeGreaterThan(1200);
    const p = S.store.momentum();
    expect(Math.abs(p.x - p0.x) / S.momentumScale).toBeLessThan(1e-12);
    expect(Math.abs(p.y - p0.y) / S.momentumScale).toBeLessThan(1e-12);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-12);
  });

  it('elastic gas with specular walls: energy exact, momentum closed by wall impulses', () => {
    const S = gasSim({ N: 500, phi: 0.05, seed: 4, periodic: false });
    S.run(3000);
    expect(S.halted).toBe(false);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-12);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-12);
    // specular walls exchange no energy
    expect(Math.abs(S.ledger.wallEnergyOut)).toBeLessThan(1e-9);
    for (const w of S.walls) expect(w.lateContacts).toBe(0);
  });

  it('inelastic gas: kinetic energy decays and the ledger accounts for all of it', () => {
    const S = gasSim({ N: 500, phi: 0.1, seed: 5, periodic: true, restitution: 0.9 });
    const ke0 = S.store.kineticEnergy();
    S.run(2000);
    expect(S.store.kineticEnergy()).toBeLessThan(0.8 * ke0);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-12);
    expect(S.ledger.dissipatedExternal).toBeGreaterThan(0.2 * ke0);
  });

  it('replays bit-for-bit from the same seed, including diffuse wall re-emission', () => {
    const walls: PlaneWallConfig[] = [
      { side: 'left', accommodation: 0.5, temperature: 1.2 },
      { side: 'right', accommodation: 1, temperature: 0.8 },
      { side: 'bottom', accommodation: 0.3, temperature: 1, tangentialVelocity: 0.4 },
      { side: 'top', accommodation: 0 },
    ];
    const run = (seed: number) => {
      const S = gasSim({ N: 300, phi: 0.08, seed, periodic: false, walls });
      S.run(1500);
      return S;
    };
    const A = run(7);
    const B = run(7);
    const C = run(8);
    expect(Array.from(A.store.x.subarray(0, 300))).toEqual(Array.from(B.store.x.subarray(0, 300)));
    expect(Array.from(A.store.vy.subarray(0, 300))).toEqual(Array.from(B.store.vy.subarray(0, 300)));
    expect(A.log.count).toBe(B.log.count);
    expect(Array.from(A.store.x.subarray(0, 300))).not.toEqual(Array.from(C.store.x.subarray(0, 300)));
    expect(A.relativeMomentumResidual()).toBeLessThan(1e-12);
    expect(Math.abs(A.relativeEnergyResidual())).toBeLessThan(1e-12);
  });
});
