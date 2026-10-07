import { lucyDW } from '../occupancy/OccupancyModel';

/**
 * Mean-field occupancy normal stress across planes parallel to a wall, computed
 * from a (measured) parcel-centre density profile n(y). Design amendment A1 §2.4,
 * statistic W-MF. No hard-core density functional enters.
 *
 * Two parcels at offset (x, s) (s = y_upper − y_lower > 0) repel with the A-15
 * pair force F = −k_s a W′(r) r̂, so the y-force on the upper one is
 *   F_y(x, s) = f(r) s,   f(r) = −k_s a W′(r)/r,   r = √(x² + s²).
 * Integrated along x (per unit width): g(s) = ∫ F_y(x, s) dx.
 * The normal stress carried by the occupancy force across a plane y₀ is the
 * total y-force exerted by everything below on everything above, per unit width:
 *   P_MF(y₀) = Σ_{j: y_j < y₀} Σ_{l: y_l > y₀} λ_j λ_l g(y_l − y_j),   λ = n Δ.
 * For a uniform density this tends to ½ k_s a n² (the bulk mean-field closure)
 * as the bins are refined; tests/universeB.wallstress.test.ts checks it.
 */

/** g(s) = ∫ F_y(x, s) dx for the Lucy pair force with strength ksA = k_s·a (energy × area). */
export function slabForce(s: number, h: number, ksA: number): number {
  const a = Math.abs(s);
  if (a >= h || a === 0) return 0;
  const xm = Math.sqrt(h * h - a * a);
  const n = 400;
  const step = (2 * xm) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const x = -xm + i * step;
    const r = Math.sqrt(x * x + a * a);
    const f = (-ksA * lucyDW(r, h)) / r;
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += w * f * a;
  }
  return (sum * step) / 3;
}

export interface DensityBins {
  /** bin centres */
  y: number[];
  /** bin widths */
  width: number[];
  /** number density (per area) in each bin */
  n: number[];
}

/**
 * P_MF(y₀) for each plane, from the binned density. Bins are treated as thin
 * slabs at their centres; a bin whose centre equals y₀ counts as below.
 */
export function occupancyStressMF(bins: DensityBins, planes: number[], h: number, ksA: number): number[] {
  const m = bins.y.length;
  const lam = bins.n.map((v, i) => v * bins.width[i]);
  // cache g on the pairwise separations actually needed
  const cache = new Map<number, number>();
  const g = (s: number) => {
    const key = Math.round(s * 1e9);
    let v = cache.get(key);
    if (v === undefined) {
      v = slabForce(s, h, ksA);
      cache.set(key, v);
    }
    return v;
  };
  return planes.map((y0) => {
    let p = 0;
    for (let j = 0; j < m; j++) {
      if (bins.y[j] > y0 || lam[j] === 0) continue;
      for (let l = 0; l < m; l++) {
        if (bins.y[l] <= y0 || lam[l] === 0) continue;
        const s = bins.y[l] - bins.y[j];
        if (s >= h) continue;
        p += lam[j] * lam[l] * g(s);
      }
    }
    return p;
  });
}

export interface WallMFStatistic {
  /** core means (planes in the core window) */
  coreMeas: number;
  coreMF: number;
  /** deficit integrals over the near-wall window, Σ (core − P(y₀))·spacing */
  deficitMeas: number;
  deficitMF: number;
  /** R = (Δ_meas/Ĉ_meas)/(Δ_MF/Ĉ_MF) */
  R: number;
}

/**
 * The W-MF statistic for one wall (A1 §2.4). `planes` are distances from the
 * wall plane (y = 0), spacing `spacing`; the near-wall window is
 * [nearFrom, nearTo] and the core window [coreFrom, coreTo] (inclusive).
 */
export function wallMFStatistic(
  planes: number[],
  pMeas: number[],
  pMF: number[],
  spacing: number,
  nearFrom: number,
  nearTo: number,
  coreFrom: number,
  coreTo: number,
): WallMFStatistic {
  const eps = 1e-9 * spacing;
  let cm = 0;
  let cf = 0;
  let nc = 0;
  planes.forEach((y, i) => {
    if (y >= coreFrom - eps && y <= coreTo + eps) {
      cm += pMeas[i];
      cf += pMF[i];
      nc++;
    }
  });
  if (nc === 0) throw new Error('no planes in the core window');
  cm /= nc;
  cf /= nc;
  let dm = 0;
  let df = 0;
  planes.forEach((y, i) => {
    if (y >= nearFrom - eps && y <= nearTo + eps) {
      dm += (cm - pMeas[i]) * spacing;
      df += (cf - pMF[i]) * spacing;
    }
  });
  return { coreMeas: cm, coreMF: cf, deficitMeas: dm, deficitMF: df, R: dm / cm / (df / cf) };
}
