import type { ParticleStore } from '../core/ParticleStore';

/**
 * Thermal statistics of the particle ensemble (Master prompt §11).
 *
 * Definitions (docs/MODEL_ASSUMPTIONS.md A-03), all measured, none assumed:
 *   u          mass-weighted mean velocity
 *   kT_x, kT_y ⟨m c_x²⟩, ⟨m c_y²⟩ with peculiar velocity c = v − u
 *   kT         (kT_x + kT_y)/2 = peculiar KE / N
 *   anisotropy (kT_x − kT_y)/(kT_x + kT_y)
 *   kurtosis   ⟨c_x⁴⟩/⟨c_x²⟩², ⟨c_y⁴⟩/⟨c_y²⟩², and their mean
 *   a2         ⟨c⁴⟩/(2⟨c²⟩²) − 1, the 2D speed-distribution shape factor
 *              (second Sonine coefficient)
 * For reference only (benchmarks/): a 2D Maxwellian has kurtosis 3 and a2 = 0.
 * Whether the gas reaches those values is what the experiment measures.
 */
export interface VelocityStats {
  n: number;
  ux: number;
  uy: number;
  kT: number;
  kTx: number;
  kTy: number;
  anisotropy: number;
  kurtosisX: number;
  kurtosisY: number;
  kurtosis: number;
  a2: number;
}

export function velocityStats(store: ParticleStore, first = 0, last = store.count): VelocityStats {
  const { vx, vy, mass } = store;
  const n = last - first;
  let M = 0;
  let px = 0;
  let py = 0;
  for (let i = first; i < last; i++) {
    M += mass[i];
    px += mass[i] * vx[i];
    py += mass[i] * vy[i];
  }
  const ux = px / M;
  const uy = py / M;
  let sx2 = 0;
  let sy2 = 0;
  let sx4 = 0;
  let sy4 = 0;
  let mc2 = 0;
  let c2s = 0;
  let c4s = 0;
  for (let i = first; i < last; i++) {
    const cx = vx[i] - ux;
    const cy = vy[i] - uy;
    const cx2 = cx * cx;
    const cy2 = cy * cy;
    sx2 += cx2;
    sy2 += cy2;
    sx4 += cx2 * cx2;
    sy4 += cy2 * cy2;
    mc2 += mass[i] * (cx2 + cy2);
    const c2 = cx2 + cy2;
    c2s += c2;
    c4s += c2 * c2;
  }
  // component temperatures with per-particle masses
  let kTx = 0;
  let kTy = 0;
  for (let i = first; i < last; i++) {
    kTx += mass[i] * (vx[i] - ux) ** 2;
    kTy += mass[i] * (vy[i] - uy) ** 2;
  }
  kTx /= n;
  kTy /= n;
  const kurtosisX = (sx4 / n) / (sx2 / n) ** 2;
  const kurtosisY = (sy4 / n) / (sy2 / n) ** 2;
  return {
    n,
    ux,
    uy,
    kT: (0.5 * mc2) / n,
    kTx,
    kTy,
    anisotropy: (kTx - kTy) / (kTx + kTy),
    kurtosisX,
    kurtosisY,
    kurtosis: 0.5 * (kurtosisX + kurtosisY),
    a2: (c4s / n) / (2 * (c2s / n) ** 2) - 1,
  };
}

/** Histogram of speeds in units of sqrt(kT/m) (measured kT), for display and benchmark comparison. */
export function speedHistogram(store: ParticleStore, kT: number, bins = 40, maxReduced = 5) {
  const counts = new Array<number>(bins).fill(0);
  const w = maxReduced / bins;
  let over = 0;
  for (let i = 0; i < store.count; i++) {
    const s = Math.hypot(store.vx[i], store.vy[i]) / Math.sqrt(kT / store.mass[i]);
    const b = Math.floor(s / w);
    if (b < bins) counts[b]++;
    else over++;
  }
  return {
    binWidth: w,
    centers: counts.map((_, b) => (b + 0.5) * w),
    density: counts.map((c) => c / (store.count * w)),
    overflow: over,
  };
}

/** Reduced speeds v/sqrt(kT/m), for distribution tests. */
export function reducedSpeeds(store: ParticleStore, kT: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < store.count; i++) out.push(Math.hypot(store.vx[i], store.vy[i]) / Math.sqrt(kT / store.mass[i]));
  return out;
}
