import type { ParticleStore } from '../core/ParticleStore';
import type { ProfileBin, ProfileData } from '../workers/protocol';

/**
 * Streaming cross-stream profile inside an x window (near-wall velocity
 * profiles). Per y bin it accumulates count, Σm, Σm·v_x, Σm·v_y and Σ½m|v|²
 * over snapshots, in consecutive batches of `batchSize` snapshots; profiles are
 * ratios of the summed sums (as in ProfileSampler). The SE is the spread of
 * the per-batch ratios / √batches: it assumes batches are independent, which
 * is not checked here. When more than `maxBatches` batches exist, adjacent
 * batches are merged (sums add), so memory stays bounded.
 */
export class ProfileAccumulator {
  readonly x0: number;
  readonly x1: number;
  readonly ymin: number;
  readonly bins: number;
  readonly binWidth: number;
  readonly batchSize: number;
  readonly maxBatches: number;
  private batches: Float64Array[] = [];
  private current: Float64Array;
  private inCurrent = 0;
  private perBatch: number;
  snapshots = 0;

  constructor(window: { x0: number; x1: number; ymin: number; ymax: number }, bins: number, batchSize = 10, maxBatches = 32) {
    if (!(window.x1 > window.x0)) throw new Error('profile window needs x1 > x0');
    if (!(window.ymax > window.ymin)) throw new Error('profile window needs ymax > ymin');
    this.x0 = window.x0;
    this.x1 = window.x1;
    this.ymin = window.ymin;
    this.bins = Math.max(1, Math.floor(bins));
    this.binWidth = (window.ymax - window.ymin) / this.bins;
    this.batchSize = Math.max(1, Math.floor(batchSize));
    this.perBatch = this.batchSize;
    this.maxBatches = Math.max(2, Math.floor(maxBatches));
    this.current = new Float64Array(5 * this.bins);
  }

  sample(store: ParticleStore): void {
    const B = this.bins;
    const row = this.current;
    const { x, y, vx, vy, mass } = store;
    for (let i = 0; i < store.count; i++) {
      if (x[i] < this.x0 || x[i] >= this.x1) continue;
      const b = Math.floor((y[i] - this.ymin) / this.binWidth);
      if (b < 0 || b >= B) continue;
      const m = mass[i];
      row[b] += 1;
      row[B + b] += m;
      row[2 * B + b] += m * vx[i];
      row[3 * B + b] += m * vy[i];
      row[4 * B + b] += 0.5 * m * (vx[i] * vx[i] + vy[i] * vy[i]);
    }
    this.snapshots++;
    if (++this.inCurrent >= this.perBatch) this.closeBatch();
  }

  private closeBatch(): void {
    this.batches.push(this.current);
    this.current = new Float64Array(5 * this.bins);
    this.inCurrent = 0;
    if (this.batches.length > this.maxBatches) {
      const merged: Float64Array[] = [];
      for (let k = 0; k + 1 < this.batches.length; k += 2) {
        const a = this.batches[k];
        const b = this.batches[k + 1];
        const m = new Float64Array(a.length);
        for (let j = 0; j < a.length; j++) m[j] = a[j] + b[j];
        merged.push(m);
      }
      if (this.batches.length % 2 === 1) {
        // the odd batch out becomes the start of the (now longer) current batch
        this.current = this.batches[this.batches.length - 1];
        this.inCurrent = this.perBatch;
      }
      this.batches = merged;
      this.perBatch *= 2;
    }
  }

  result(): ProfileData {
    const B = this.bins;
    const all = [...this.batches];
    if (this.inCurrent > 0) all.push(this.current);
    const area = this.binWidth * (this.x1 - this.x0);
    const stat = (vals: number[]): ProfileBin => {
      const ok = vals.filter((v) => Number.isFinite(v));
      const n = ok.length;
      if (n === 0) return { mean: Number.NaN, se: Number.NaN };
      const m = ok.reduce((s, v) => s + v, 0) / n;
      if (n < 2) return { mean: m, se: Number.NaN };
      const v = ok.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
      return { mean: m, se: Math.sqrt(v / n) };
    };
    // full-window ratio as the central value; batch spread for the SE
    const total = new Float64Array(5 * B);
    for (const r of all) for (let j = 0; j < total.length; j++) total[j] += r[j];
    const pooled = (r: Float64Array, b: number, q: 'n' | 'ux' | 'uy' | 'kT', snaps: number): number => {
      const cnt = r[b];
      const M = r[B + b];
      if (q === 'n') return snaps > 0 ? cnt / snaps / area : Number.NaN;
      if (!(M > 0)) return Number.NaN;
      const u = r[2 * B + b] / M;
      const v = r[3 * B + b] / M;
      if (q === 'ux') return u;
      if (q === 'uy') return v;
      return (r[4 * B + b] - 0.5 * M * (u * u + v * v)) / cnt;
    };
    const batchSnaps = all.map((_, k) => (k < this.batches.length ? this.perBatch : this.inCurrent));
    const column = (q: 'n' | 'ux' | 'uy' | 'kT'): ProfileBin[] =>
      Array.from({ length: B }, (_, b) => {
        const s = stat(all.map((r, k) => pooled(r, b, q, batchSnaps[k])));
        return { mean: pooled(total, b, q, this.snapshots), se: s.se };
      });
    return {
      x0: this.x0,
      x1: this.x1,
      y: Array.from({ length: B }, (_, b) => (b + 0.5) * this.binWidth),
      binWidth: this.binWidth,
      snapshots: this.snapshots,
      batches: all.length,
      numberDensity: column('n'),
      ux: column('ux'),
      uy: column('uy'),
      kT: column('kT'),
    };
  }
}
