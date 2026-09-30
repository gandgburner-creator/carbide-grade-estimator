import type { Domain } from '../core/Domain';
import type { ParticleStore } from '../core/ParticleStore';
import { independentEstimate, type Estimate } from './Statistics';

/**
 * Time-averaged profiles across the channel (bins along y), e.g. V(y) for
 * Couette flow or V_t(y) above a wall.
 *
 * Each call to `sample()` stores, per bin, the particle count, Σm, Σm·v_x,
 * Σm·v_y and Σ½m|v|². Profiles are ratios of time-summed sums (mass-weighted
 * time averages). Uncertainties use batch means: the samples are split into
 * `batches` consecutive batches, the ratio is formed in each, and the SE is the
 * spread of the batch values / √batches.
 */
export interface Profile {
  centers: number[];
  binWidth: number;
  numberDensity: Estimate[];
  ux: Estimate[];
  uy: Estimate[];
  /** peculiar kinetic energy per particle (kT proxy, A-03) */
  kT: Estimate[];
  samples: number;
  batches: number;
}

export class ProfileSampler {
  readonly bins: number;
  readonly y0: number;
  readonly binWidth: number;
  readonly width: number;
  private readonly rows: Float64Array[] = [];

  constructor(domain: Domain, bins: number, y0 = domain.ymin, y1 = domain.ymax) {
    this.bins = bins;
    this.y0 = y0;
    this.binWidth = (y1 - y0) / bins;
    this.width = domain.width;
  }

  sample(store: ParticleStore): void {
    const B = this.bins;
    const row = new Float64Array(5 * B); // count, M, px, py, ke
    const { y, vx, vy, mass } = store;
    for (let i = 0; i < store.count; i++) {
      const b = Math.floor((y[i] - this.y0) / this.binWidth);
      if (b < 0 || b >= B) continue;
      const m = mass[i];
      row[b] += 1;
      row[B + b] += m;
      row[2 * B + b] += m * vx[i];
      row[3 * B + b] += m * vy[i];
      row[4 * B + b] += 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i]);
    }
    this.rows.push(row);
  }

  get samples(): number {
    return this.rows.length;
  }

  result(batches = 16): Profile {
    const B = this.bins;
    const S = this.rows.length;
    const nb = Math.max(1, Math.min(batches, Math.floor(S / 2)));
    const per = Math.floor(S / nb);
    const area = this.binWidth * this.width;
    const numberDensity: Estimate[] = [];
    const ux: Estimate[] = [];
    const uy: Estimate[] = [];
    const kT: Estimate[] = [];
    for (let b = 0; b < B; b++) {
      const nD: number[] = [];
      const bx: number[] = [];
      const by: number[] = [];
      const bk: number[] = [];
      for (let k = 0; k < nb; k++) {
        let cnt = 0;
        let M = 0;
        let px = 0;
        let py = 0;
        let ke = 0;
        for (let s = k * per; s < (k + 1) * per; s++) {
          const r = this.rows[s];
          cnt += r[b];
          M += r[B + b];
          px += r[2 * B + b];
          py += r[3 * B + b];
          ke += r[4 * B + b];
        }
        nD.push(cnt / per / area);
        if (M > 0) {
          const u = px / M;
          const v = py / M;
          bx.push(u);
          by.push(v);
          bk.push((ke - 0.5 * M * (u * u + v * v)) / cnt);
        }
      }
      numberDensity.push(independentEstimate(nD, 'block-average'));
      ux.push(independentEstimate(bx, 'block-average'));
      uy.push(independentEstimate(by, 'block-average'));
      kT.push(independentEstimate(bk, 'block-average'));
    }
    return {
      centers: Array.from({ length: B }, (_, b) => this.y0 + (b + 0.5) * this.binWidth),
      binWidth: this.binWidth,
      numberDensity,
      ux,
      uy,
      kT,
      samples: S,
      batches: nb,
    };
  }
}
