import { mean, pairedTTest, seedSummary, weightedLinearFit } from '../measurements/Statistics';
import type { ChannelGasRunResult } from './ChannelGasRun';

/**
 * Time-resolved and window-sensitivity analysis of one Couette case
 * (criteria V5, V6 and the reported convergence curves in
 * docs/CRITERIA_THERMAL_VISCOSITY.md). Uses the profile accumulated in
 * consecutive measurement blocks and the per-window wall stresses of the same
 * blocks; μ_eff = τ / (du/dy) exactly as in the whole-run analysis.
 * Aggregate uncertainties come from independent seeds.
 */
type R = ChannelGasRunResult;

/** μ_eff over a set of consecutive blocks, with the core fraction used for the gradient fit. */
export function muOverBlocks(r: R, blocks: number[], coreFraction: number) {
  const pb = blocks.map((b) => r.profileBlocks[b]).filter((q) => q && q.profile);
  if (pb.length === 0) return null;
  const prof0 = pb[0].profile!;
  const H = r.params.height;
  const lo = (H * (1 - coreFraction)) / 2;
  const hi = H - lo;
  const idx = prof0.centers.map((y, i) => (y >= lo && y <= hi ? i : -1)).filter((i) => i >= 0);
  const y = idx.map((i) => prof0.centers[i]);
  // equal-duration blocks: equal-weight average of the block means
  const u = idx.map((i) => mean(pb.map((q) => q.profile!.ux[i].mean)));
  const se = idx.map((i) => Math.max(1e-12, Math.sqrt(pb.reduce((a, q) => a + q.profile!.ux[i].se ** 2, 0)) / pb.length));
  const fit = weightedLinearFit(y, u, se);
  const cFrom = pb[0].cFrom;
  const cTo = pb[pb.length - 1].cTo;
  const s = r.series;
  const w = s.c.map((c, i) => (c > cFrom && c <= cTo + 1e-9 ? i : -1)).filter((i) => i >= 0);
  const tau = mean(w.map((i) => 0.5 * (s.bottomShear[i] - s.topShear[i])));
  return { mu: tau / fit.slope, tau, gradient: fit.slope, linearityP: fit.pValue, windows: w.length, cFrom, cTo };
}

export function viscosityConvergence(runs: R[], coreFraction: number) {
  const K = Math.min(...runs.map((r) => r.profileBlocks.length));
  if (!(K >= 2)) return null;
  const all = Array.from({ length: K }, (_, k) => k);
  const half = Math.floor(K / 2);
  const per = runs.map((r) => ({
    seed: r.seed,
    blocks: all.map((k) => muOverBlocks(r, [k], coreFraction)?.mu ?? Number.NaN),
    cumulative: all.map((k) => muOverBlocks(r, all.slice(0, k + 1), coreFraction)?.mu ?? Number.NaN),
    firstHalf: muOverBlocks(r, all.slice(0, half), coreFraction)?.mu ?? Number.NaN,
    secondHalf: muOverBlocks(r, all.slice(half), coreFraction)?.mu ?? Number.NaN,
    core04: muOverBlocks(r, all, 0.4)?.mu ?? Number.NaN,
    core06: muOverBlocks(r, all, 0.6)?.mu ?? Number.NaN,
    core08: muOverBlocks(r, all, 0.8)?.mu ?? Number.NaN,
    blockCollisions: runs[0].profileBlocks.map((b) => b.cTo - runs[0].profileBlocks[0].cFrom),
  }));
  const cAxis = per[0].blockCollisions;
  return {
    blocks: K,
    perSeed: per.map(({ blockCollisions: _b, ...rest }) => rest),
    blockCollisions: cAxis,
    perBlock: all.map((k) => ({ c: cAxis[k], mu: seedSummary(per.map((q) => q.blocks[k])) })),
    cumulative: all.map((k) => ({ c: cAxis[k], mu: seedSummary(per.map((q) => q.cumulative[k])) })),
    halves: {
      first: seedSummary(per.map((q) => q.firstHalf)),
      second: seedSummary(per.map((q) => q.secondHalf)),
      pairedDifference: pairedTTest(per.map((q) => q.secondHalf - q.firstHalf)),
    },
    coreFraction: {
      '0.4': seedSummary(per.map((q) => q.core04)),
      '0.6': seedSummary(per.map((q) => q.core06)),
      '0.8': seedSummary(per.map((q) => q.core08)),
      pairedDifference04vs06: pairedTTest(per.map((q) => q.core04 - q.core06)),
      pairedDifference08vs06_diagnostic: pairedTTest(per.map((q) => q.core08 - q.core06)),
    },
    note: `Core fraction of the reported μ_eff: ${coreFraction}. Blocks are consecutive and equal in collisions/particle.`,
  };
}
