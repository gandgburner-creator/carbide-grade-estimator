import { describe, expect, it } from 'vitest';
import { LbmSolver } from '../src/cfd/Lbm';
import { circlePolygon, rasterize } from '../src/cfd/Raster';

function cylinder(Re: number, D: number, ny14: number, spin: number, avg: number) {
  const U = 0.1;
  const tau = (3 * U * D) / Re + 0.5;
  const nx = Math.round(30 * D);
  const ny = Math.round(ny14 * D);
  const r = rasterize(nx, ny, circlePolygon(8 * D, ny / 2 + 0.2, D / 2, 192));
  const s = new LbmSolver({ nx, ny, tau, uIn: U, solid: r.solid, wallQ: r.wallQ, noise: 0.01, seed: 3 });
  const cd: number[] = [];
  const cl: number[] = [];
  const rho: number[] = [];
  for (let t = 0; t < spin + avg; t++) {
    if (!s.step()) throw new Error(`diverged at step ${t}`);
    if (t >= spin) {
      rho.push(s.macro((ny >> 1) * nx + 3 * D).rho);
      cd.push(s.fx / (0.5 * U * U * D));
      cl.push(s.fy / (0.5 * U * U * D));
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rhoInf = mean(rho);
  for (let i = 0; i < cd.length; i++) { cd[i] /= rhoInf; cl[i] /= rhoInf; }
  const m = mean(cl);
  const up: number[] = [];
  for (let i = 1; i < cl.length; i++) if (cl[i - 1] < m && cl[i] >= m) up.push(i);
  const period = up.length > 1 ? (up[up.length - 1] - up[0]) / (up.length - 1) : NaN;
  const clAmp = Math.SQRT2 * Math.sqrt(mean(cl.map((v) => (v - m) ** 2)));
  return { D, blockage: 1 / ny14, cd: mean(cd), clAmp, St: D / (period * U) };
}
/**
 * Resolution and blockage study of the cylinder at Re = 100 (about ten minutes, so skipped unless PFAD_STUDIES=1):
 *
 *   PFAD_STUDIES=1 npx vitest run tests/cfd.cylinder-convergence.test.ts
 *
 * Recorded result (docs/FLOW_GUIDED_GEOMETRY.md): C_d = 1.528 (D = 16 cells, blockage 7 %), 1.504 (D = 24, 7 %), 1.455 (D = 16, 3.6 %);
 * St = 0.174 in all three. Published, unconfined: C_d about 1.34, St about 0.165. The mean drag does not change with resolution and
 * falls with blockage, so the difference from the published values is confinement and the outflow condition, not resolution.
 */
describe.skipIf(process.env.PFAD_STUDIES !== '1')('cylinder Re = 100: resolution and blockage', () => {
  it('the drag and the Strouhal number do not depend on resolution at fixed blockage, and the drag falls with blockage', () => {
    const a = cylinder(100, 16, 14, 12000, 14000);
    const b = cylinder(100, 24, 14, 12000, 14000);
    const c = cylinder(100, 16, 28, 12000, 14000);
    console.log(JSON.stringify([a, b, c]));
    expect(Math.abs(a.cd - b.cd) / b.cd).toBeLessThan(0.03);
    expect(Math.abs(a.St - b.St)).toBeLessThan(0.005);
    expect(c.cd).toBeLessThan(a.cd);
  }, 3_000_000);
});
