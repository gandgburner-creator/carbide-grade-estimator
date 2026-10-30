import { describe, expect, it } from 'vitest';
import { domainToPaper, drawPad, GRID_STEPS, gridLines, gridSteps, inkWeight, PAD_OFF, paperToDomain, type PadGeometry, type PadSettings } from '../src/ui/flow/DrawingPad';

const geo: PadGeometry = { origin: { x: 80, y: 90, alphaDeg: 65 }, cmPerUnit: 20 / 30 };

describe('the drawing pad', () => {
  it('the grid is a ruler: the finest spacing whose lines are far enough apart on the screen', () => {
    expect(gridSteps(40).minor).toBe(0.5); // 40 px per cm: 0.1 cm would be 4 px apart, 0.2 cm 8 px
    expect(gridSteps(80).minor).toBe(0.2);
    expect(gridSteps(12)).toEqual({ minor: 1, major: 5 });
    expect(gridSteps(1.2)).toEqual({ minor: 10, major: 50 });
    expect(gridSteps(0.001).minor).toBe(100); // never finer than needed, never absurdly coarse
    for (const [minor, major] of GRID_STEPS) expect(Math.abs(major / minor - Math.round(major / minor))).toBeLessThan(1e-9);
  });

  it('paper coordinates (cm from the leading tip) and the simulation frame map to each other, turned with the plate or not', () => {
    for (const frame of ['plate', 'wind'] as const) {
      const [x, y] = paperToDomain(7.5, -2.25, geo, frame);
      const [u, v] = domainToPaper(x, y, geo, frame);
      expect(u).toBeCloseTo(7.5, 9);
      expect(v).toBeCloseTo(-2.25, 9);
    }
    // the leading tip is the origin; 20 cm along the plate is the trailing tip, one plate length (30 units) away, at the angle of attack
    expect(paperToDomain(0, 0, geo, 'plate')).toEqual([80, 90]);
    const [tx, ty] = paperToDomain(20, 0, geo, 'plate');
    expect(Math.hypot(tx - 80, ty - 90)).toBeCloseTo(30, 9);
    expect((Math.atan2(ty - 90, tx - 80) * 180) / Math.PI).toBeCloseTo(-65, 9); // nose up: the tail lies below
    // wind frame: the same 20 cm along the wind
    expect(paperToDomain(20, 0, geo, 'wind')).toEqual([110, 90]);
  });

  it('lists the grid lines in a range and marks the heavy ones', () => {
    const l = gridLines(-1.2, 6.3, 1, 5);
    expect(l.map((x) => x.value)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);
    expect(l.filter((x) => x.major).map((x) => x.value)).toEqual([0, 5]);
    expect(gridLines(0, 1, 0.1, 1).length).toBe(11);
    expect(gridLines(0, 1e9, 0.1, 1)).toEqual([]); // far too many: nothing is drawn
  });

  it('thin paper leaves the construction as it is; thick paper draws it all in ink; a blueprint never inks', () => {
    const s = (opacity: number, style: PadSettings['style'] = 'pad'): PadSettings => ({ opacity, style, frame: 'plate' });
    expect(inkWeight(s(0))).toBe(0);
    expect(inkWeight(s(0.3))).toBe(0);
    expect(inkWeight(s(0.55))).toBeCloseTo(0.5, 6);
    expect(inkWeight(s(0.8))).toBe(1);
    expect(inkWeight(s(1))).toBe(1);
    expect(inkWeight(s(1, 'blueprint'))).toBe(0);
    let last = -1;
    for (let o = 0; o <= 1; o += 0.05) {
      const w = inkWeight(s(o));
      expect(w).toBeGreaterThanOrEqual(last);
      last = w;
    }
  });

  it('draws nothing without paper, and with paper a sheet, lines, numbers and a caption at the chosen opacity', () => {
    const calls: Record<string, number> = {};
    const alphas: number[] = [];
    const g = new Proxy(
      {},
      {
        get: (_t, k: string) => {
          if (k === 'globalAlpha') return 1;
          return (...a: unknown[]) => {
            calls[k] = (calls[k] ?? 0) + 1;
            void a;
          };
        },
        set: (_t, k: string, v) => {
          if (k === 'globalAlpha') alphas.push(v as number);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const w = 800;
    const h = 600;
    const s = 3.2; // px per plate unit
    const T = { s, X: (x: number) => w / 2 + (x - 90) * s, Y: (y: number) => h / 2 - (y - 90) * s, invX: (px: number) => 90 + (px - w / 2) / s, invY: (py: number) => 90 - (py - h / 2) / s };
    drawPad(g, T, w, h, PAD_OFF, geo);
    expect(Object.keys(calls)).toEqual([]);
    drawPad(g, T, w, h, { opacity: 0.6, style: 'pad', frame: 'plate' }, geo);
    expect(alphas[0]).toBeCloseTo(0.6, 9);
    expect(calls.fillRect).toBe(1);
    expect(calls.stroke).toBeGreaterThanOrEqual(5); // minor, major, axes (each direction)
    expect(calls.moveTo).toBeGreaterThan(20);
    expect(calls.fillText).toBeGreaterThan(4); // numbers on the axes and the caption
    expect(calls.save).toBe(calls.restore);
  });
});
