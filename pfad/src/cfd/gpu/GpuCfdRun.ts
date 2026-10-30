import { CfdRun, type CfdParams, type CfdResult } from '../CfdRun';
import { GpuLbm, type GpuInfo, type GpuSnapshotKind } from './LbmGpu';

/**
 * ONE CFD RUN ON THE GRAPHICS CARD. The set-up (the body on the lattice, the relaxation times, the sampling of the near-wall
 * profiles, the integrity checks and the results) is the one of CfdRun.ts, unchanged: this class only takes the steps on the card
 * and hands each finished time block (the sums of the time-mean fields, the mean force, the monitors) to the same run object, which
 * then closes the block exactly as it does for a run on the CPU. Same equations, same lattice, same measurements.
 *
 * The card works in 32-bit floats; the force and the mass fluxes are summed by many threads at once as fixed-point integers.
 */
export class GpuCfdRun {
  readonly base: CfdRun;
  private readonly gpu: GpuLbm;
  private readonly info: GpuInfo;
  /** steps per submission: starts small and grows toward batches of about 40 ms, so a slow card is never given a long job (a graphics driver resets the card when one job takes seconds) */
  private batch = 4;
  private averaging = false;
  private lastCheck = 0;
  /** milliseconds of compute so far */
  computeMs = 0;
  /** every call that touches the card waits for the one before it, so a late message cannot interleave two batches of one run */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.chain.then(f, f);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private constructor(base: CfdRun, gpu: GpuLbm, info: GpuInfo) {
    this.base = base;
    this.gpu = gpu;
    this.info = info;
  }

  static async create(p: CfdParams, device: GPUDevice, info: GpuInfo): Promise<GpuCfdRun> {
    const base = new CfdRun(p, { external: true });
    const cfg = base.lbmConfig();
    const gpu = await GpuLbm.create(device, { ...cfg, probe: base.probeNode, seriesCapacity: Math.ceil(base.blockSteps / p.sampleEvery) + 4 });
    return new GpuCfdRun(base, gpu, info);
  }

  get nx() {
    return this.base.nx;
  }
  get ny() {
    return this.base.ny;
  }
  get cpu() {
    return this.base.cpu;
  }
  get tau() {
    return this.base.tau;
  }
  get phase() {
    return this.base.phase;
  }
  get solver() {
    return this.base.solver;
  }
  get time() {
    return this.base.time;
  }
  progress() {
    return this.base.progress();
  }
  live() {
    return this.base.live();
  }

  /** Take steps on the card for about `budgetMs` of wall-clock time (one batch is at least one dispatch group, so a little more or less). */
  advance(budgetMs: number): Promise<void> {
    return this.serial(() => this.advanceNow(budgetMs));
  }

  private async advanceNow(budgetMs: number): Promise<void> {
    const b = this.base;
    const p = b.p;
    const total = b.warmSteps + b.blockSteps * p.blocks;
    const t0 = performance.now();
    do {
      if (b.phase === 'done') return;
      const steps = this.gpu.steps;
      let n: number;
      let sampleEvery = 0;
      if (steps < b.warmSteps) n = Math.min(this.batch, b.warmSteps - steps);
      else {
        if (!this.averaging) {
          // the averaging window starts here: the force and the time means count from this step
          this.gpu.resetAccumulators();
          this.averaging = true;
          b.phase = 'averaging';
        }
        const intoWindow = steps - b.warmSteps;
        n = Math.min(this.batch, b.blockSteps - (intoWindow % b.blockSteps), total - steps);
        sampleEvery = p.sampleEvery;
      }
      const tb = performance.now();
      await this.gpu.advance(n, sampleEvery, b.warmSteps);
      const dt = performance.now() - tb;
      // aim for batches of about 40 ms: long enough to keep the card busy, short enough to answer PAUSE and STOP
      if (dt > 0) this.batch = Math.max(1, Math.min(512, this.batch * 4, Math.round((this.batch * 40) / Math.max(dt, 4))));
      b.solver.steps = this.gpu.steps;
      if (this.averaging && (this.gpu.steps - b.warmSteps) % b.blockSteps === 0) {
        const blk = await this.gpu.readBlock(true);
        if (!Number.isFinite(blk.fx) || !Number.isFinite(blk.fy) || !(blk.maxSpeed < 0.6) || !(blk.rhoMin > 0)) {
          b.markDiverged();
          return;
        }
        b.ingestBlock(blk);
      }
      if (this.gpu.steps >= total) b.phase = 'done';
      // during the start-up nothing is sampled: look at a coarse picture now and then to catch a blow-up early
      if (!this.averaging && performance.now() - this.lastCheck > 1500) {
        this.lastCheck = performance.now();
        const s = await this.gpu.snapshot('speed', Math.max(4, Math.ceil(b.nx / 64)), b.rhoInfNow, p.uLattice, p.cells);
        let bad = false;
        for (const v of s.values) if (Number.isFinite(v) && !(v < 8)) bad = true;
        if (bad) {
          b.markDiverged();
          return;
        }
      }
    } while (performance.now() - t0 < budgetMs);
    this.computeMs += performance.now() - t0;
  }

  /** the instantaneous field for the live view, computed on the card (the same quantities as CfdRun.snapshot) */
  snapshot(kind: GpuSnapshotKind, stride: number): Promise<{ nx: number; ny: number; values: Float32Array }> {
    const p = this.base.p;
    return this.serial(() => this.gpu.snapshot(kind, stride, this.base.rhoInfNow, p.uLattice, p.cells));
  }

  result(): CfdResult {
    const r = this.base.result();
    return { ...r, engine: { kind: 'gpu', adapter: `${this.info.description || this.info.device || this.info.vendor || 'WebGPU adapter'}${this.info.software ? ' (software implementation)' : ''}`, precision: 'float32' } };
  }

  /** release the card's memory once the calls in flight have finished */
  destroy(): Promise<void> {
    return this.serial(async () => this.gpu.destroy(true));
  }
}
