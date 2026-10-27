/**
 * Bounded columnar time series of live values. When `capacity` points are held,
 * every second point is dropped and the recording stride doubles, so a long run
 * keeps an evenly thinned history of its whole duration.
 */
export interface SeriesSnapshot {
  t: number[];
  columns: Record<string, number[]>;
}

export class SeriesRecorder {
  readonly capacity: number;
  private stride = 1;
  private offered = 0;
  private t: number[] = [];
  private columns = new Map<string, number[]>();

  constructor(capacity = 2000) {
    if (capacity < 4) throw new Error('series capacity must be at least 4');
    this.capacity = capacity;
  }

  get length(): number {
    return this.t.length;
  }

  /** Offer one sample; non-finite values and keys missing from this sample are stored as NaN. */
  push(t: number, values: Record<string, number>): void {
    if (!Number.isFinite(t)) return;
    if (this.t.length > 0 && t <= this.t[this.t.length - 1]) return;
    if (this.offered++ % this.stride !== 0) return;
    const n = this.t.length;
    this.t.push(t);
    for (const [k, v] of Object.entries(values)) {
      let col = this.columns.get(k);
      if (!col) {
        col = new Array<number>(n).fill(Number.NaN);
        this.columns.set(k, col);
      }
      col.push(Number.isFinite(v) ? v : Number.NaN);
    }
    for (const col of this.columns.values()) if (col.length === n) col.push(Number.NaN);
    if (this.t.length >= this.capacity) {
      const keep = (a: number[]) => a.filter((_, i) => i % 2 === 0);
      this.t = keep(this.t);
      for (const [k, col] of this.columns) this.columns.set(k, keep(col));
      this.stride *= 2;
    }
  }

  snapshot(): SeriesSnapshot {
    const columns: Record<string, number[]> = {};
    for (const [k, col] of this.columns) columns[k] = col.slice();
    return { t: this.t.slice(), columns };
  }

  reset(): void {
    this.stride = 1;
    this.offered = 0;
    this.t = [];
    this.columns.clear();
  }
}
