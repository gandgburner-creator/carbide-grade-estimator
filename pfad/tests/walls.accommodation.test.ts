import { describe, expect, it } from 'vitest';
import { Domain } from '../src/core/Domain';
import { Ledger } from '../src/core/Ledger';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { Simulation } from '../src/core/Simulation';
import { createGas, squareBoxSide } from '../src/gas/InitialConditions';
import { PlaneWall } from '../src/walls/WallModel';

const domain = new Domain({ xmin: 0, xmax: 100, ymin: 0, ymax: 100, periodicX: true, periodicY: false });

/** M particles each hitting the bottom wall once, same incident velocity. */
function fire(M: number, Aw: number, kTw: number, Uw: number, seed = 3) {
  const store = new ParticleStore(M);
  for (let i = 0; i < M; i++) store.add({ x: (i % 1000) * 0.1, y: 0.49, vx: 0.3, vy: -1, mass: 2, radius: 0.5 });
  const wall = new PlaneWall({ side: 'bottom', accommodation: Aw, temperature: kTw, tangentialVelocity: Uw }, domain);
  const ledger = new Ledger();
  wall.interact(store, 0.1, new Rng(seed, 3), ledger);
  return { store, wall, ledger };
}

describe('wall accommodation (Maxwell model)', () => {
  it('Aw = 0 is exactly specular: no tangential momentum or energy exchanged', () => {
    const { store, wall } = fire(1000, 0, 1, 0.7);
    for (let i = 0; i < 1000; i++) {
      expect(store.vx[i]).toBe(0.3);
      expect(store.vy[i]).toBe(1);
    }
    const t = wall.totals();
    expect(t.tangentialImpulse).toBe(0);
    expect(t.energyIn).toBeCloseTo(0, 12);
    expect(t.normalImpulse).toBeCloseTo(1000 * 2 * 2 * 1, 9);
  });

  it('Aw = 1 re-emits from the wall Maxwellian: <v_n²> = 2kT_w/m, <v_t> = U_w, var(v_t) = kT_w/m', () => {
    const M = 200_000;
    const kTw = 1.5;
    const m = 2;
    const Uw = 0.7;
    const { store, wall } = fire(M, 1, kTw, Uw);
    let sn2 = 0;
    let st = 0;
    let st2 = 0;
    for (let i = 0; i < M; i++) {
      expect(store.vy[i]).toBeGreaterThan(0);
      sn2 += store.vy[i] ** 2;
      st += store.vx[i];
      st2 += store.vx[i] ** 2;
    }
    const mt = st / M;
    expect(sn2 / M).toBeCloseTo((2 * kTw) / m, 1);
    expect(mt).toBeCloseTo(Uw, 2);
    expect(st2 / M - mt * mt).toBeCloseTo(kTw / m, 2);
    expect(wall.totals().diffuseHits).toBe(M);
  });

  it('intermediate Aw re-emits diffusely with probability Aw (deterministic per seed)', () => {
    const M = 50_000;
    const a = fire(M, 0.3, 1, 0);
    const b = fire(M, 0.3, 1, 0);
    const frac = a.wall.totals().diffuseHits / M;
    expect(Math.abs(frac - 0.3)).toBeLessThan(5 * Math.sqrt((0.3 * 0.7) / M));
    expect(Array.from(a.store.vx)).toEqual(Array.from(b.store.vx));
    // specular fraction keeps the incident velocity exactly
    let unchanged = 0;
    for (let i = 0; i < M; i++) if (a.store.vx[i] === 0.3 && a.store.vy[i] === 1) unchanged++;
    expect(unchanged).toBe(M - a.wall.totals().diffuseHits);
  });

  it('records the momentum and energy it exchanges in the ledger, consistently with the particles', () => {
    const { store, wall, ledger } = fire(5000, 0.6, 1.2, -0.4);
    let px = 0;
    let py = 0;
    let ke = 0;
    for (let i = 0; i < store.count; i++) {
      px += store.mass[i] * (store.vx[i] - 0.3);
      py += store.mass[i] * (store.vy[i] + 1);
      ke += 0.5 * store.mass[i] * (store.vx[i] ** 2 + store.vy[i] ** 2 - 0.3 ** 2 - 1);
    }
    expect(ledger.wallImpulseX).toBeCloseTo(px, 9);
    expect(ledger.wallImpulseY).toBeCloseTo(py, 9);
    expect(ledger.wallEnergyOut).toBeCloseTo(-ke, 9);
    const t = wall.totals();
    expect(t.tangentialImpulse).toBeCloseTo(-px, 9);
    expect(t.incidentEnergy - t.emittedEnergy).toBeCloseTo(t.energyIn, 9);
  });

  it('diffuse walls at kT_w thermalise a gas that starts at a different temperature', () => {
    const N = 200;
    const L = squareBoxSide(N, 0.5, 0.05);
    const spec = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: false, periodicY: false };
    const { store } = createGas({ count: N, radius: 0.5, mass: 1, kT: 1, distribution: 'maxwell', seed: 4, domain: spec });
    const S = new Simulation(
      {
        domain: spec,
        walls: (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, accommodation: 1, temperature: 2 })),
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 },
        seed: 4,
        referenceKT: 2,
      },
      store,
    );
    S.runUntil(1500);
    let kTsum = 0;
    let n = 0;
    while (S.time < 3000) {
      S.run(200);
      kTsum += store.kineticEnergy() / N;
      n++;
    }
    expect(S.halted).toBe(false);
    expect(Math.abs(kTsum / n - 2)).toBeLessThan(0.1);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-10);
    expect(S.ledger.wallEnergyOut).toBeLessThan(0); // walls heated the gas
  });
});
