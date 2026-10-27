import { Rng } from '../../src/core/Random';
import type { FlowData } from '../../src/measurements/SeparationDetector';
import { SUMS, WALL, type FlowBlock } from '../../src/measurements/SurfaceFlowSampler';

/**
 * Synthetic near-wall flows with a KNOWN truth. The generator draws Poisson particle counts and
 * Gaussian thermal velocities per station and normal bin, so the data carry the noise a simulation
 * would; the detector never sees the truth.
 */
export const S = 30;
export const NB = 12;
const BLOCKS = 16;
const SNAP = 30; // snapshots per block
const BLOCK_T = 15;

export interface Truth {
  seeds: number;
  rho?: number;
  sigma?: number;
  /** mean u_t at station k, bin j (block b of run r) */
  u: (r: number, b: number, k: number, j: number) => number;
  tau?: (r: number, b: number, k: number) => number;
  /** stream reference: leeward stations and the imposed stream component along the surface */
  reference?: { leeward: (k: number) => boolean; along: number };
}

export function synth(t: Truth, seed: number): FlowData {
  const rng = new Rng(seed);
  const rho = t.rho ?? 0.127;
  const sigma = t.sigma ?? 1.1;
  const poisson = (lam: number) => {
    const L = Math.exp(-lam);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > L);
    return k - 1;
  };
  const runs = Array.from({ length: t.seeds }, (_, r) => {
    const blocks: FlowBlock[] = Array.from({ length: BLOCKS }, (_, b) => {
      const sums = new Array<number>(S * NB * SUMS).fill(0);
      const wall = new Array<number>(S * WALL).fill(0);
      for (let k = 0; k < S; k++) {
        for (let j = 0; j < NB; j++) {
          const c = poisson(rho * SNAP);
          const u = t.u(r, b, k, j);
          const o = (k * NB + j) * SUMS;
          sums[o] = c;
          sums[o + 1] = c;
          sums[o + 2] = c * u + (c > 0 ? sigma * Math.sqrt(c) * rng.gaussian() : 0);
          sums[o + 3] = c > 0 ? sigma * Math.sqrt(c) * rng.gaussian() : 0;
          sums[o + 4] = c * (u * u + 2 * sigma * sigma);
        }
        const tau = (t.tau?.(r, b, k) ?? 0.02) + 0.01 * rng.gaussian();
        wall[k * WALL] = 0.5 * BLOCK_T;
        wall[k * WALL + 1] = tau * BLOCK_T;
        wall[k * WALL + 2] = 10;
      }
      return { index: b, snapshots: SNAP, t0: b * BLOCK_T, t1: (b + 1) * BLOCK_T, sides: { upper: { sums, wall }, lower: { sums: sums.slice(), wall: wall.slice() } } };
    });
    return { seed: 100 + r, blocks };
  });
  const lengths = new Array<number>(S).fill(1);
  const reference = t.reference ? { upper: { leeward: Array.from({ length: S }, (_, k) => t.reference!.leeward(k)), streamAlong: new Array<number>(S).fill(t.reference.along) }, lower: { leeward: new Array<boolean>(S).fill(false), streamAlong: new Array<number>(S).fill(t.reference.along) } } : undefined;
  return { reference, radius: 0.5, normalWidth: 1, normalBins: NB, xs: Array.from({ length: S }, (_, k) => k + 0.5), lengths: { upper: lengths, lower: lengths }, runs };
}

/** attached: forward flow growing from 0.5 at the wall to 0.9 outside (a 40 % wall deficit, under the 50 % convention) */
export const attached = (j: number) => 0.5 + (0.4 * j) / (NB - 1);
