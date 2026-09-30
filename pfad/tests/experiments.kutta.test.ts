import { describe, expect, it } from 'vitest';
import { contourCirculation, fisherG, KUTTA_REFERENCE, kuttaBody } from '../src/experiments/KuttaExperiment';
import { Rng } from '../src/core/Random';
import { polygonArea } from '../src/walls/SolidBody';

describe('Kutta analysis helpers', () => {
  it('contour circulation of solid-body rotation u = (−Ωy, Ωx) is 2Ω × enclosed area', () => {
    const nx = 40;
    const ny = 30;
    const cw = 2;
    const ch = 3;
    const omega = 0.37;
    const ux = new Float64Array(nx * ny);
    const uy = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = (i + 0.5) * cw;
        const y = (j + 0.5) * ch;
        ux[j * nx + i] = -omega * y;
        uy[j * nx + i] = omega * x;
      }
    }
    const [i0, i1, j0, j1] = [5, 30, 4, 20];
    const area = (i1 - i0) * cw * (j1 - j0) * ch;
    expect(contourCirculation(ux, uy, nx, cw, ch, i0, i1, j0, j1)).toBeCloseTo(2 * omega * area, 9);
    // a uniform stream has none
    ux.fill(1);
    uy.fill(0.2);
    expect(contourCirculation(ux, uy, nx, cw, ch, i0, i1, j0, j1)).toBeCloseTo(0, 12);
  });

  it('Fisher g: detects a buried sinusoid, not white noise', () => {
    const rng = new Rng(9);
    const n = 64;
    const noise = Array.from({ length: n }, () => rng.gaussian());
    const periodic = noise.map((v, k) => v + 1.5 * Math.sin((2 * Math.PI * 5 * k) / n));
    const a = fisherG(noise);
    const b = fisherG(periodic);
    expect(a.p).toBeGreaterThan(0.01);
    expect(b.p).toBeLessThan(1e-4);
    expect(b.peakFrequency).toBeCloseTo(5 / n, 12);
  });

  it('body geometry: counter-clockwise, nose up for positive α, trailing edge a vertex for sharp shapes', () => {
    for (const c of KUTTA_REFERENCE.cases) {
      const g = kuttaBody(KUTTA_REFERENCE, c);
      expect(polygonArea(g.vertices)).toBeGreaterThan(0);
      if (c.alphaDeg > 0) expect(g.te.y).toBeLessThan(g.le.y);
      if (c.shape === 'rhombus') {
        expect(g.vertices[4]).toBeCloseTo(g.te.x, 12);
        expect(g.vertices[5]).toBeCloseTo(g.te.y, 12);
      }
      // mid-chord at mid-height
      expect(0.5 * (g.te.y + g.le.y)).toBeCloseTo(KUTTA_REFERENCE.height / 2, 9);
      expect(Math.hypot(g.te.x - g.le.x, g.te.y - g.le.y)).toBeCloseTo(KUTTA_REFERENCE.chord, 9);
    }
  });
});

describe('scaling families', () => {
  it('fixed-Mach keeps U and scales geometry and convective times; fixed-Re scales U as 1/size', async () => {
    const { levelParams, SCALING_REFERENCE } = await import('../src/experiments/ScalingExperiment');
    const a = levelParams(SCALING_REFERENCE, 30).params as typeof KUTTA_REFERENCE;
    const b = levelParams(SCALING_REFERENCE, 60).params as typeof KUTTA_REFERENCE;
    expect(a.speed).toBe(1);
    expect(b.speed).toBe(1);
    expect(b.length / a.length).toBeCloseTo(2, 2);
    expect(b.thickness / a.thickness).toBeCloseTo(2, 12);
    expect(b.duration / a.duration).toBeCloseTo(2, 12);
    expect(a.cases).toHaveLength(1);
    expect(a.cases[0].alphaDeg).toBe(8);
    const re = { ...SCALING_REFERENCE, mode: 'fixed-reynolds' as const, referenceSize: 30, referenceSpeed: 1 };
    const c = levelParams(re, 30);
    const d = levelParams(re, 60);
    expect(c.speed).toBe(1);
    expect(d.speed).toBeCloseTo(0.5, 12);
    // convective time c/U grows 4× from size 30 to 60 at fixed Re
    expect((d.params as typeof KUTTA_REFERENCE).duration / (c.params as typeof KUTTA_REFERENCE).duration).toBeCloseTo(4, 12);
  });
});
