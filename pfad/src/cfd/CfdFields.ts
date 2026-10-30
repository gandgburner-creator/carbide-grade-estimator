import type { CfdGrid, CfdResult } from './CfdRun';
import type { CfdViewKind } from '../workers/cfdProtocol';
import type { GridField } from '../measurements/Streamlines';

/** The stored time-mean fields of a run as drawable arrays (row-major, row 0 at the bottom), NaN inside the body. */
export function fieldFromResult(res: CfdResult, kind: CfdViewKind): { nx: number; ny: number; values: Float32Array } {
  const g: CfdGrid = res.grid;
  const U = res.params.uLattice;
  const out = new Float32Array(g.nx * g.ny);
  // grid spacing in units of the plate length, for the vorticity
  const h = g.stride / res.params.cells;
  const at = (a: number[], i: number, j: number) => a[Math.min(g.ny - 1, Math.max(0, j)) * g.nx + Math.min(g.nx - 1, Math.max(0, i))];
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const n = j * g.nx + i;
      if (g.solid[n]) {
        out[n] = Number.NaN;
        continue;
      }
      switch (kind) {
        case 'speed':
          out[n] = Math.hypot(g.ux[n], g.uy[n]);
          break;
        case 'ux':
          out[n] = g.ux[n];
          break;
        case 'uy':
          out[n] = g.uy[n];
          break;
        case 'pressure':
          out[n] = (g.rho[n] - res.rhoInf) / 3 / (0.5 * res.rhoInf * U * U);
          break;
        case 'total': {
          const s = Math.hypot(g.ux[n], g.uy[n]) / U;
          out[n] = (g.rho[n] - res.rhoInf) / 3 / (0.5 * res.rhoInf * U * U) + s * s - 1;
          break;
        }
        case 'vorticity':
          out[n] = ((at(g.uy, i + 1, j) - at(g.uy, i - 1, j)) - (at(g.ux, i, j + 1) - at(g.ux, i, j - 1))) / (2 * h);
          break;
      }
    }
  return { nx: g.nx, ny: g.ny, values: out };
}

/** The stored mean velocity as a field for the streamline tracer (plate units). */
export function streamField(res: CfdResult): GridField {
  const g = res.grid;
  const cpu = res.lattice.cellsPerUnit;
  const cell = g.stride / cpu;
  return { nx: g.nx, ny: g.ny, x0: 0, y0: 0, cw: cell, ch: cell, ux: g.ux, uy: g.uy, valid: g.solid.map((s) => !s) };
}

/** A colour range for a field: symmetric about zero for the signed kinds, clipped to the 2nd–98th percentile so a single extreme cell does not set the scale. */
export function robustRange(values: ArrayLike<number>, kind: CfdViewKind): { lo: number; hi: number; signed: boolean } {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return { lo: 0, hi: 1, signed: false };
  v.sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))))];
  const signed = kind !== 'speed';
  if (signed) {
    const a = Math.max(Math.abs(q(0.02)), Math.abs(q(0.98))) || 1;
    return { lo: -a, hi: a, signed };
  }
  return { lo: Math.max(0, q(0.01)), hi: q(0.995) || 1, signed };
}

export const CFD_FIELD_LABEL: Record<CfdViewKind, { label: string; units: string }> = {
  speed: { label: 'speed |u|', units: 'U' },
  vorticity: { label: 'vorticity ∂v/∂x − ∂u/∂y', units: 'U/L' },
  pressure: { label: 'pressure coefficient C_p', units: '½ρU²' },
  total: { label: 'total pressure C_p + |u|²/U² − 1 (0 where Bernoulli holds)', units: '½ρU²' },
  ux: { label: 'velocity u_x', units: 'U' },
  uy: { label: 'velocity u_y', units: 'U' },
};
