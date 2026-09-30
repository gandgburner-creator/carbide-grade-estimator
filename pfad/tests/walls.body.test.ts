import { describe, expect, it } from 'vitest';
import { Ledger } from '../src/core/Ledger';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { Simulation } from '../src/core/Simulation';
import { createGas } from '../src/gas/InitialConditions';
import { ensembleEstimate } from '../src/measurements/Statistics';
import { PolygonBody, polygonArea } from '../src/walls/SolidBody';

/** Triangle with a face at 30° to the x axis, counter-clockwise. */
const TRI = [0, 0, 20, 0, 0, 20 * Math.tan(Math.PI / 6)];

function one(x: number, y: number, vx: number, vy: number) {
  const s = new ParticleStore(4);
  s.add({ x, y, vx, vy, mass: 1, radius: 0.5 });
  return s;
}

describe('polygon body geometry', () => {
  it('orientation, containment and closest point', () => {
    expect(polygonArea(TRI)).toBeGreaterThan(0);
    expect(() => new PolygonBody({ name: 'cw', vertices: [0, 0, 0, 1, 1, 0], accommodation: 0 })).toThrow();
    const b = new PolygonBody({ name: 't', vertices: TRI, accommodation: 0 });
    expect(b.contains(2, 2)).toBe(true);
    expect(b.contains(-1, 2)).toBe(false);
    const c = b.closest(10, -3);
    expect(c.d).toBeCloseTo(3, 12);
    expect(c.nx).toBeCloseTo(0, 12);
    expect(c.ny).toBeCloseTo(-1, 12);
    expect(c.vertex).toBe(-1);
    const v = b.closest(23, -4);
    expect(v.vertex).toBe(1);
    expect(v.d).toBeCloseTo(5, 12);
  });
});

describe('polygon body contact (specular)', () => {
  it('face: reflection about the inclined face, at the exact contact instant', () => {
    const b = new PolygonBody({ name: 't', vertices: TRI, accommodation: 0 });
    const e = b.edges[1]; // hypotenuse (20,0) → (0, 11.5)
    const r = 0.5;
    // aim at the middle of the hypotenuse from outside
    const mx = 0.5 * (e.ax + e.bx);
    const my = 0.5 * (e.ay + e.by);
    const v = { x: -0.9, y: -0.4 };
    const dt = 0.1;
    // position at the end of the step: 0.03 inside the contact distance
    const pen = 0.03;
    const px = mx + (r - pen) * e.nx;
    const py = my + (r - pen) * e.ny;
    const s = one(px, py, v.x, v.y);
    const L = new Ledger();
    expect(b.interact(s, dt, new Rng(1), L)).toBe(1);
    const vn = v.x * e.nx + v.y * e.ny;
    expect(s.vx[0]).toBeCloseTo(v.x - 2 * vn * e.nx, 12);
    expect(s.vy[0]).toBeCloseTo(v.y - 2 * vn * e.ny, 12);
    // mirrored end position: distance from the face r + pen
    const d = (s.x[0] - e.ax) * e.nx + (s.y[0] - e.ay) * e.ny;
    expect(d).toBeCloseTo(r + pen, 12);
    expect(b.lateContacts).toBe(0);
    // impulse on the body equals the particle's momentum change (opposite sign), energy unchanged
    expect(b.impulseX).toBeCloseTo(-(s.vx[0] - v.x), 12);
    expect(b.impulseY).toBeCloseTo(-(s.vy[0] - v.y), 12);
    expect(L.wallEnergyOut).toBeCloseTo(0, 12);
    expect(b.normalImpulse.reduce((a, q) => a + q, 0)).toBeCloseTo(-2 * vn, 12);
  });

  it('vertex: head-on along the bisector reflects straight back; off-centre uses the radial normal', () => {
    const b = new PolygonBody({ name: 't', vertices: TRI, accommodation: 0 });
    const r = 0.5;
    const dt = 0.1;
    // vertex 1 at (20, 0); approach from +x along the axis
    const s = one(20 + r - 0.02, 0, -1, 0);
    // (20,0) is a vertex whose exterior includes the +x direction
    b.interact(s, dt, new Rng(1), new Ledger());
    expect(s.vx[0]).toBeCloseTo(1, 12);
    expect(s.vy[0]).toBeCloseTo(0, 12);
    expect(b.vertexHits[1]).toBe(1);

    // off-centre: impact parameter 0.3 (below the axis, still hits the vertex, not a face)
    const bb = new PolygonBody({ name: 't', vertices: TRI, accommodation: 0 });
    const h = -0.3;
    const xc = 20 + Math.sqrt(r * r - h * h); // contact centre
    const s2 = one(xc - 0.01, h, -1, 0); // 0.01 past contact along the path
    bb.interact(s2, dt, new Rng(1), new Ledger());
    const nx = (xc - 20) / r;
    const ny = h / r;
    const vn = -1 * nx;
    expect(s2.vx[0]).toBeCloseTo(-1 - 2 * vn * nx, 12);
    expect(s2.vy[0]).toBeCloseTo(0 - 2 * vn * ny, 12);
    expect(Math.hypot(s2.vx[0], s2.vy[0])).toBeCloseTo(1, 12);
    expect(bb.vertexHits[1]).toBe(1);
  });

  it('a disk moving away while overlapping is left alone', () => {
    const b = new PolygonBody({ name: 't', vertices: TRI, accommodation: 0 });
    const s = one(10, -0.4, 0, -1);
    expect(b.interact(s, 0.1, new Rng(1), new Ledger())).toBe(0);
  });
});

describe('polygon body in a gas at rest', () => {
  it('diffuse body at the gas temperature: ledgers close, no particle enters, no mean force, face pressure = wall pressure', () => {
    const L = 80;
    const r = 0.5;
    const phi = 0.15;
    const count = Math.round((phi * L * L) / (Math.PI * r * r));
    const body = { name: 'square', vertices: [30, 30, 50, 30, 50, 50, 30, 50], accommodation: 1, temperature: 1, binLength: 20 };
    const probe = new PolygonBody(body);
    const domain = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: false, periodicY: false };
    const { store } = createGas({
      count,
      radius: r,
      mass: 1,
      kT: 1,
      distribution: 'maxwell',
      seed: 3,
      domain,
      removeDrift: true,
      exclude: (x: number, y: number, rr: number) => probe.closest(x, y).d < rr,
    });
    const S = new Simulation(
      {
        domain,
        walls: [
          { side: 'left', accommodation: 1, temperature: 1 },
          { side: 'right', accommodation: 1, temperature: 1 },
          { side: 'bottom', accommodation: 1, temperature: 1 },
          { side: 'top', accommodation: 1, temperature: 1 },
        ],
        bodies: [body],
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 },
        seed: 3,
      },
      store,
    );
    expect(S.flags.filter((f) => f.code === 'INITIAL_OVERLAP')).toHaveLength(0);
    S.runUntil(100);
    const B = S.bodies[0];
    const blocks = 16;
    const Fx: number[] = [];
    const Fy: number[] = [];
    const pBody: number[] = [];
    const pWall: number[] = [];
    const wallN = () => S.walls.reduce((a, w) => a + w.totals().normalImpulse, 0);
    const bodyN = () => B.normalImpulse.reduce((a, q) => a + q, 0);
    for (let k = 0; k < blocks; k++) {
      const t0 = S.time;
      const [ix, iy, nb, nw] = [B.impulseX, B.impulseY, bodyN(), wallN()];
      S.runUntil(t0 + 100);
      const T = S.time - t0;
      Fx.push((B.impulseX - ix) / T);
      Fy.push((B.impulseY - iy) / T);
      pBody.push((bodyN() - nb) / (T * 80)); // perimeter 80 (faces only; vertex hits excluded)
      pWall.push((wallN() - nw) / (T * 4 * L));
    }
    expect(S.halted).toBe(false);
    expect(B.insideDetections).toBe(0);
    expect(Math.abs(S.relativeEnergyResidual())).toBeLessThan(1e-9);
    expect(S.relativeMomentumResidual()).toBeLessThan(1e-9);
    const fx = ensembleEstimate(Fx);
    const fy = ensembleEstimate(Fy);
    expect(Math.abs(fx.mean)).toBeLessThan(4 * fx.se);
    expect(Math.abs(fy.mean)).toBeLessThan(4 * fy.se);
    const pb = ensembleEstimate(pBody);
    const pw = ensembleEstimate(pWall);
    expect(Math.abs(pb.mean - pw.mean)).toBeLessThan(4 * Math.hypot(pb.se, pw.se) + 0.01 * pw.mean);
  });
});
