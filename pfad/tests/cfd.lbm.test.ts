import { describe, expect, it } from 'vitest';
import { LbmSolver } from '../src/cfd/Lbm';
import { circlePolygon, rasterize } from '../src/cfd/Raster';

/** a periodic channel between two solid rows (walls halfway between the last fluid node and the first solid node) */
function channel(tau: number, H: number, g: number) {
  const nx = 8;
  const ny = H + 2;
  const solid = new Uint8Array(nx * ny);
  const wallQ = new Float32Array(9 * nx * ny);
  for (let i = 0; i < nx; i++) {
    solid[i] = 1;
    solid[(ny - 1) * nx + i] = 1;
  }
  for (let j = 1; j < ny - 1; j++)
    for (let i = 0; i < nx; i++)
      for (let k = 1; k < 9; k++) {
        const sj = j + [0, 0, 1, 0, -1, 1, 1, -1, -1][k];
        if (sj === 0 || sj === ny - 1) wallQ[k * nx * ny + j * nx + i] = 0.5;
      }
  return new LbmSolver({ nx, ny, tau, uIn: 0, solid, wallQ, xMode: 'periodic', yMode: 'periodic', bodyForce: [g, 0], rest: true });
}

describe('the lattice Boltzmann solver', () => {
  it('Poiseuille flow between two walls gives the parabola of the Navier–Stokes equations (viscosity ν = (τ − ½)/3)', () => {
    const H = 24;
    const tau = 0.8;
    const g = 1e-6;
    const s = channel(tau, H, g);
    for (let t = 0; t < 12000; t++) expect(s.step()).toBe(true);
    const nu = (tau - 0.5) / 3;
    // walls at y = 0 (between rows 0 and 1) and y = H; node j (≥ 1) sits at y = j − ½
    let worst = 0;
    for (let j = 1; j <= H; j++) {
      const y = j - 0.5;
      const exact = (g / (2 * nu)) * y * (H - y);
      const u = s.macro(j * 8 + 3).ux;
      worst = Math.max(worst, Math.abs(u - exact) / ((g / (2 * nu)) * (H * H) / 4));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('the wall sits where it is drawn: a channel whose walls lie at a quarter of a cell still follows the parabola', () => {
    const H = 24;
    const tau = 0.8;
    const g = 1e-6;
    const nx = 8;
    const ny = H + 2;
    // walls at y = 1 − 0.3 … i.e. the link from node 1 to the wall below is 0.2 of a link long (q = 0.2) and so on
    const solid = new Uint8Array(nx * ny);
    const wallQ = new Float32Array(9 * nx * ny);
    const q = 0.2;
    for (let i = 0; i < nx; i++) {
      solid[i] = 1;
      solid[(ny - 1) * nx + i] = 1;
    }
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        if (j === 1) wallQ[4 * nx * ny + n] = q; // toward row 0 (c_4 = (0, −1))
        if (j === ny - 2) wallQ[2 * nx * ny + n] = q; // toward the top row (c_2 = (0, +1))
        // the diagonal links toward a flat wall cross it at the same fraction of the link (their vertical step is also one cell)
        if (j === 1) for (const k of [7, 8]) wallQ[k * nx * ny + n] = q;
        if (j === ny - 2) for (const k of [5, 6]) wallQ[k * nx * ny + n] = q;
      }
    const s = new LbmSolver({ nx, ny, tau, uIn: 0, solid, wallQ, xMode: 'periodic', yMode: 'periodic', bodyForce: [g, 0], rest: true });
    for (let t = 0; t < 12000; t++) s.step();
    const nu = (tau - 0.5) / 3;
    // node j sits at y = j − ½ (row 0 is solid); the wall is q of a link below node 1: y_w = 0.5 − q
    const yw = 0.5 - q;
    const yTop = ny - 2 - 0.5 + q; // the top fluid node ny − 2 sits at ny − 2.5, the wall q above it
    const Hh = yTop - yw;
    let worst = 0;
    for (let j = 1; j <= ny - 2; j++) {
      const y = j - 0.5 - yw;
      const exact = (g / (2 * nu)) * y * (Hh - y);
      worst = Math.max(worst, Math.abs(s.macro(j * nx + 3).ux - exact) / ((g / (2 * nu)) * Hh * Hh / 4));
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('conserves mass in a periodic box, and a fluid at rest stays at rest', () => {
    const s = new LbmSolver({ nx: 24, ny: 20, tau: 0.7, uIn: 0, xMode: 'periodic', yMode: 'periodic', rest: true });
    const m0 = s.mass();
    for (let t = 0; t < 200; t++) s.step();
    expect(Math.abs(s.mass() - m0) / m0).toBeLessThan(1e-12);
    const mon = s.monitor();
    expect(mon.maxSpeed).toBeLessThan(1e-12);
  });

  it('rasterises a circle with its wall links cut at the right fraction', () => {
    const r = rasterize(40, 40, circlePolygon(20, 20, 6.3));
    // area ≈ π r²
    expect(Math.abs(r.solidNodes - Math.PI * 6.3 * 6.3)).toBeLessThan(6);
    expect(r.links).toBeGreaterThan(60);
    // every wall link crosses the circle: the point at fraction q along the link lies on it
    const N = 1600;
    let worst = 0;
    const CXs = [0, 1, 0, -1, 0, 1, -1, -1, 1];
    const CYs = [0, 0, 1, 0, -1, 1, 1, -1, -1];
    for (let n = 0; n < N; n++)
      for (let k = 1; k < 9; k++) {
        const q = r.wallQ[k * N + n];
        if (!(q > 0)) continue;
        const px = (n % 40) + 0.5 + q * CXs[k];
        const py = Math.floor(n / 40) + 0.5 + q * CYs[k];
        worst = Math.max(worst, Math.abs(Math.hypot(px - 20, py - 20) - 6.3));
      }
    expect(worst).toBeLessThan(0.05); // the 96-sided polygon is within 0.005 of the circle
  });
});

/** a circular cylinder of diameter D in a 30 D × 14 D box (free-stream inflow, outflow, slip top and bottom; blockage 1/14) */
function cylinder(Re: number, D: number, spin: number, avg: number, sponge?: { cells: number; tau: number }) {
  const U = 0.1;
  const tau = (3 * U * D) / Re + 0.5;
  const nx = Math.round(30 * D);
  const ny = Math.round(14 * D);
  const r = rasterize(nx, ny, circlePolygon(8 * D, ny / 2 + 0.2, D / 2, 128));
  const s = new LbmSolver({ nx, ny, tau, uIn: U, solid: r.solid, wallQ: r.wallQ, noise: 0.01, seed: 3, sponge });
  const cd: number[] = [];
  const cl: number[] = [];
  const rho: number[] = [];
  for (let t = 0; t < spin + avg; t++) {
    if (!s.step()) throw new Error(`diverged at step ${t}`);
    if (t >= spin) {
      // the reference dynamic pressure uses the density measured upstream of the body (it floats a little with the outflow)
      rho.push(s.macro((ny >> 1) * nx + 3 * D).rho);
      cd.push(s.fx / (0.5 * U * U * D));
      cl.push(s.fy / (0.5 * U * U * D));
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const rhoInf = mean(rho);
  for (let i = 0; i < cd.length; i++) {
    cd[i] /= rhoInf;
    cl[i] /= rhoInf;
  }
  const m = mean(cl);
  const up: number[] = [];
  for (let i = 1; i < cl.length; i++) if (cl[i - 1] < m && cl[i] >= m) up.push(i);
  const period = up.length > 1 ? (up[up.length - 1] - up[0]) / (up.length - 1) : Number.NaN;
  // amplitude of the lift oscillation: √2 × the standard deviation (the amplitude of a sinusoid); robust against single-step spikes
  const clAmp = Math.SQRT2 * Math.sqrt(mean(cl.map((v) => (v - m) ** 2)));
  // the height of each lift peak above the mean
  const peaks: number[] = [];
  for (let i = 1; i < cl.length - 1; i++) if (cl[i] > cl[i - 1] && cl[i] >= cl[i + 1] && cl[i] > m + 0.1) peaks.push(cl[i] - m);
  return { peaks, cd: mean(cd), clSpan: Math.max(...cl) - Math.min(...cl), clAmp, St: D / (period * U), mon: s.monitor() };
}

describe('the solver on the circular cylinder (the classical benchmark)', () => {
  it('Re = 20: a steady wake and a drag coefficient near the published 2.05 (a little higher in a slip channel of 7 % blockage)', () => {
    const r = cylinder(20, 10, 6000, 3000);
    expect(r.mon.finite).toBe(true);
    expect(r.clAmp).toBeLessThan(1e-3); // steady: no shedding
    expect(r.cd).toBeGreaterThan(1.95);
    expect(r.cd).toBeLessThan(2.45);
  }, 120000);

  it('Re = 100: vortex shedding at a Strouhal number near the published 0.165 and a mean drag near 1.34 (both a little higher at 7 % blockage)', () => {
    const r = cylinder(100, 10, 8000, 6000);
    expect(r.mon.finite).toBe(true);
    expect(r.mon.maxSpeed).toBeLessThan(0.3); // the flow stays far below the lattice's own speed of sound (0.577)
    expect(r.St).toBeGreaterThan(0.15);
    expect(r.St).toBeLessThan(0.2);
    expect(r.cd).toBeGreaterThan(1.3);
    expect(r.cd).toBeLessThan(1.65);
    expect(r.clAmp).toBeGreaterThan(0.25); // the lift oscillates: published amplitude about 0.33 (in units of ½ρU²D)
    expect(r.clAmp).toBeLessThan(0.55);
  }, 180000);

  it('Re = 100 with an absorbing layer in front of the outflow: the lift oscillates steadily (without it the amplitude modulates from reflections), at the same Strouhal number', () => {
    const r = cylinder(100, 10, 8000, 6000, { cells: 80, tau: 1.0 });
    expect(r.mon.finite).toBe(true);
    expect(r.St).toBeGreaterThan(0.15);
    expect(r.St).toBeLessThan(0.2);
    expect(r.cd).toBeGreaterThan(1.3);
    expect(r.cd).toBeLessThan(1.65);
    expect(r.peaks.length).toBeGreaterThan(8);
    expect(Math.min(...r.peaks) / Math.max(...r.peaks)).toBeGreaterThan(0.75);
    expect(r.clAmp).toBeGreaterThan(0.3);
    expect(r.clAmp).toBeLessThan(0.55);
  }, 180000);
});
