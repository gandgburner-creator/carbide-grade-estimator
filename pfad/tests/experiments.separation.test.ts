import { describe, expect, it } from 'vitest';
import { detectOnset, predictOnset, type StationRow } from '../src/experiments/AdverseGradientExperiment';

const row = (x: number, tau: number, se: number, S: number, H: number): StationRow => ({
  x,
  tau: { mean: tau, se },
  Ue: 1,
  rhoE: 0.13,
  nearWallU: 0.1,
  reverseFraction: 0,
  dstar: 1,
  theta: 1 / H,
  shapeFactor: H,
  slowMomentum: S,
  wallPressure: 0,
});

describe('separation onset and threshold prediction', () => {
  const rows = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((x) => {
    const tau = 0.02 - 0.0004 * x; // crosses zero at x = 50
    return row(x, tau, 0.001, 0.3 - 0.003 * x, 2 + 0.03 * x);
  });

  it('detects a sustained, significant sign change of the wall shear — not a single noisy bin', () => {
    expect(detectOnset(rows, 0, 90)).toBe(60);
    const noisy = rows.map((r, k) => (k === 3 ? { ...r, tau: { mean: -0.001, se: 0.002 } } : r));
    expect(detectOnset(noisy, 0, 90)).toBe(60);
  });

  it('predicts onset where an indicator crosses its critical value', () => {
    expect(predictOnset(rows, 'slowMomentum', 0.12, 0, 90)).toBe(60);
    expect(predictOnset(rows, 'shapeFactor', 3.8, 0, 90)).toBe(60);
    expect(predictOnset(rows, 'slowMomentum', -1, 0, 90)).toBeNull();
  });

  it('reports no onset for an attached flow', () => {
    const attached = rows.map((r) => ({ ...r, tau: { mean: 0.01, se: 0.001 } }));
    expect(detectOnset(attached, 0, 90)).toBeNull();
  });
});
