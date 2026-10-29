import { describe, expect, it } from 'vitest';
import { CfdRun, CFD_BASE, reynoldsCap, type CfdParams } from '../src/cfd/CfdRun';
import { dividingStreamline, sampleField, wallGradient } from '../src/cfd/Walls';
import { plateGeometry } from '../src/geometry/Pointer';

const geometry = plateGeometry({ length: 30, thickness: 3 });
const small = (over: Partial<CfdParams> = {}): CfdParams => ({ geometry, alphaDeg: 40, cells: 32, reynolds: 240, ...CFD_BASE, warmup: 5, average: 10, blocks: 6, ...over });

function runAll(p: CfdParams) {
  const r = new CfdRun(p);
  while (r.phase !== 'done') r.advance(2000);
  return { run: r, res: r.result() };
}

describe('a CFD run of the rounded plate', () => {
  const { run, res } = runAll(small());

  it('runs to the end, stays stable and passes its integrity checks', () => {
    expect(res.integrity.checks.find((c) => c.id === 'stable')!.pass).toBe(true);
    expect(res.integrity.maxMach).toBeLessThan(0.45);
    expect(res.integrity.fluxImbalance).toBeLessThan(0.1);
    expect(res.integrity.status === 'PASSED' || res.integrity.status === 'WARNING').toBe(true);
    expect(res.steps).toBe(run.warmSteps + run.blockSteps * 6);
    expect(res.rhoInf).toBeGreaterThan(0.95);
    expect(res.rhoInf).toBeLessThan(1.1);
  });

  it('the force on a body at a positive angle of attack points downstream (drag) and up (lift)', () => {
    expect(res.forces.dragCoeff.mean).toBeGreaterThan(0.3);
    expect(res.forces.liftCoeff.mean).toBeGreaterThan(0.05);
    expect(res.forces.drag.n).toBe(6);
    expect(Number.isFinite(res.forces.dragCoeff.se)).toBe(true);
    // the coefficients are the forces over ½ ρ∞ U² (plate length in cells)
    expect(res.forces.dragCoeff.mean).toBeCloseTo(res.forces.drag.mean / res.forces.reference, 12);
  });

  it('measures every station of both sides: wall shear, pressure, the velocity beside the wall', () => {
    for (const side of ['upper', 'lower'] as const) {
      expect(res.stations[side].length).toBe(geometry.stations);
      const fin = res.stations[side].filter((s) => Number.isFinite(s.cf.mean) && Number.isFinite(s.cp.mean));
      expect(fin.length).toBeGreaterThan(0.6 * geometry.stations);
    }
    // the windward (lower) side carries the overpressure, the leeward (upper) side the suction
    const mean = (side: 'upper' | 'lower') => res.stations[side].filter((s) => Number.isFinite(s.cp.mean)).reduce((a, s) => a + s.cp.mean, 0) / res.stations[side].filter((s) => Number.isFinite(s.cp.mean)).length;
    expect(mean('lower')).toBeGreaterThan(mean('upper'));
  });

  it('stores a grid of the time-mean fields with the body marked', () => {
    expect(res.grid.ux.length).toBe(res.grid.nx * res.grid.ny);
    expect(res.grid.solid.reduce((a, b) => a + b, 0)).toBeGreaterThan(5);
    // far upstream the mean velocity is the free stream (in units of U)
    const j = res.grid.ny >> 1;
    expect(res.grid.ux[j * res.grid.nx + 2]).toBeGreaterThan(0.9);
    expect(res.grid.ux[j * res.grid.nx + 2]).toBeLessThan(1.1);
  });

  it('is deterministic: the same parameters give the same numbers', () => {
    const again = runAll(small()).res;
    expect(JSON.stringify(again.forces)).toBe(JSON.stringify(res.forces));
  });

  it('refuses a Reynolds number the resolution cannot run, and says the limit', () => {
    expect(reynoldsCap(48)).toBeCloseTo(384, 6);
    expect(() => new CfdRun(small({ reynolds: 1e5 }))).toThrow(/too high/);
  });

  it('gives a live snapshot of the field in each kind', () => {
    for (const kind of ['speed', 'vorticity', 'pressure', 'ux', 'uy'] as const) {
      const s = run.snapshot(kind, 2);
      expect(s.values.length).toBe(s.nx * s.ny);
      expect(s.values.some((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('near-wall analysis helpers', () => {
  it('the wall gradient of a linear profile is its slope; the dividing streamline is where the flux returns to zero', () => {
    // u(d) = 0.04 d: u(1) = 0.04, u(2) = 0.08
    expect(wallGradient(new Float64Array([0.04, 0.08]), 1)).toBeCloseTo(0.04, 12);
    // profile with backflow near the wall (u < 0 up to d = 4) then forward flow: Q returns to 0 above
    const step = 0.5;
    const prof = new Float64Array(40).map((_, j) => {
      const d = 1 + j * step;
      return d < 4 ? -0.05 : 0.05 * (d - 4);
    });
    const dv = dividingStreamline(prof, 1, step);
    expect(dv.open).toBe(false);
    expect(dv.h).not.toBeNull();
    // Q(4) = −0.05·4 + small ≈ −0.2 (near-wall part), returns to zero where 0.025 (d−4)² = 0.2 → d ≈ 6.8
    expect(dv.h!).toBeGreaterThan(5.5);
    expect(dv.h!).toBeLessThan(8);
    // attached flow has no dividing streamline
    expect(dividingStreamline(new Float64Array(10).fill(0.05), 1, step).h).toBeNull();
  });

  it('bilinear sampling ignores solid nodes and refuses to read mostly inside a body', () => {
    const nx = 6;
    const ny = 6;
    const field = new Float64Array(nx * ny).fill(2);
    const solid = new Uint8Array(nx * ny);
    expect(sampleField(field, solid, nx, ny, 3, 3)).toBeCloseTo(2, 12);
    for (let i = 0; i < 36; i++) solid[i] = 1;
    expect(Number.isNaN(sampleField(field, solid, nx, ny, 3, 3))).toBe(true);
  });
});
