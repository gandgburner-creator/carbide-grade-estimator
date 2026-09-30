import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/Simulation';
import { createGas } from '../src/gas/InitialConditions';
import { FieldAverager } from '../src/measurements/FieldAverager';

/**
 * The local particle stress field (kinetic + collisional) must agree with the
 * wall-impulse measurements: pressure in an equilibrium box, shear in Couette flow.
 */
function box(L: number, phi: number, seed: number, wallSpeed = 0) {
  const r = 0.5;
  const count = Math.round((phi * L * L) / (Math.PI * r * r));
  const domain = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: wallSpeed !== 0, periodicY: false };
  const { store } = createGas({ count, radius: r, mass: 1, kT: 1, distribution: 'maxwell', seed, domain, removeDrift: true });
  const walls =
    wallSpeed !== 0
      ? [
          { side: 'bottom' as const, accommodation: 1, temperature: 1, tangentialVelocity: -wallSpeed },
          { side: 'top' as const, accommodation: 1, temperature: 1, tangentialVelocity: wallSpeed },
        ]
      : (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, accommodation: 0 }));
  return new Simulation(
    {
      domain,
      walls,
      collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
      timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
      seed,
      referenceKT: 1,
    },
    store,
  );
}

function sampleFields(S: Simulation, f: FieldAverager, until: number) {
  f.addCollisions(S.log, 1, S.time);
  while (S.time < until) {
    S.run(20);
    f.add(S.store);
    f.addCollisions(S.log, 1, S.time);
  }
}

describe('local stress field', () => {
  it('equilibrium box: cell pressure (kinetic + collisional) equals the wall pressure; shear vanishes', () => {
    const L = 40;
    const S = box(L, 0.25, 4);
    S.runUntil(50);
    const nw0 = S.walls.map((w) => w.totals().normalImpulse);
    const t0 = S.time;
    const f = new FieldAverager(S.domain, 4, 4);
    sampleFields(S, f, t0 + 300);
    const T = S.time - t0;
    const wallP = S.walls.reduce((a, w, k) => a + (w.totals().normalImpulse - nw0[k]), 0) / (T * 4 * L);
    expect(f.collisionsLost).toBe(0);
    const p = f.field('pressure');
    const s = f.field('shear');
    // interior cells only (the wall layer has its own density structure)
    const inner = [5, 6, 9, 10];
    const pIn = inner.reduce((a, c) => a + p[c], 0) / inner.length;
    const sIn = inner.reduce((a, c) => a + s[c], 0) / inner.length;
    expect(Math.abs(pIn / wallP - 1)).toBeLessThan(0.03);
    expect(Math.abs(sIn)).toBeLessThan(0.03 * wallP);
    // the collisional part matters at this density: kinetic-only would be ~ρkT, well below P
    const kineticOnly = new FieldAverager(S.domain, 4, 4);
    kineticOnly.add(S.store);
    expect(pIn).toBeGreaterThan(1.3 * kineticOnly.field('pressure').reduce((a, v) => a + v, 0) / 16);
  });

  it('Couette flow: bulk shear stress equals the wall shear stress', () => {
    const L = 30;
    const S = box(L, 0.2, 5, 0.6);
    S.runUntil(150);
    const bot = S.walls[0];
    const tan0 = bot.totals().tangentialImpulse;
    const t0 = S.time;
    const f = new FieldAverager(S.domain, 1, 6);
    sampleFields(S, f, t0 + 600);
    const T = S.time - t0;
    // the faster gas drags the bottom wall (moving −x) along +x: τ_xy = tangential impulse on it per length and time
    const tauWall = (bot.totals().tangentialImpulse - tan0) / (T * L);
    const s = f.field('shear');
    const bulk = (s[1] + s[2] + s[3] + s[4]) / 4;
    expect(tauWall).toBeGreaterThan(0);
    expect(Math.abs(bulk / tauWall - 1)).toBeLessThan(0.1);
  });
});
