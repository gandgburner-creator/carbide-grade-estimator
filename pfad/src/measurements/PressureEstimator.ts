import type { Simulation } from '../core/Simulation';

/**
 * Wall pressure measured ONLY from particle–wall momentum transfer (Bible §7):
 *
 *   P_wall = (Σ normal impulse delivered to the wall during a window) / (Δt · L)
 *
 * No equation of state or velocity–pressure relation is involved. The sampler
 * closes a window whenever the per-particle collision count has advanced by
 * `windowCollisions` (or the window has lasted `maxWindowTime`), so windows are
 * comparable between elastic and cooling (inelastic) gases.
 */
export interface PressureSample {
  tStart: number;
  tEnd: number;
  /** collisions per particle (2 · pair collisions / N) at window end */
  collisionsPerParticle: number;
  /** combined pressure over all walls */
  pressure: number;
  /** per-wall pressure, in the order of sim.walls */
  wallPressure: number[];
  /** shear stress on each wall: tangential impulse / (Δt · L) */
  wallShear: number[];
  /** energy flux from the gas INTO each wall: energy exchanged / (Δt · L) */
  wallEnergyFlux: number[];
  /** wall hits in the window, all walls */
  hits: number;
  /** kT proxy = KE/N at window end (see ThermalStatistics for the definition) */
  kT: number;
}

export class WallPressureSampler {
  readonly samples: PressureSample[] = [];
  private readonly sim: Simulation;
  private readonly windowCollisions: number;
  private readonly maxWindowTime: number;
  private tStart: number;
  private cStart: number;
  private normal0: number[];
  private tangential0: number[];
  private energy0: number[];
  private hits0: number;

  constructor(sim: Simulation, windowCollisions: number, maxWindowTime = Number.POSITIVE_INFINITY) {
    if (sim.walls.length === 0) throw new Error('WallPressureSampler needs walls');
    this.sim = sim;
    this.windowCollisions = windowCollisions;
    this.maxWindowTime = maxWindowTime;
    this.tStart = sim.time;
    this.cStart = this.collisionsPerParticle();
    this.normal0 = sim.walls.map((w) => w.totals().normalImpulse);
    this.tangential0 = sim.walls.map((w) => w.totals().tangentialImpulse);
    this.energy0 = sim.walls.map((w) => w.totals().energyIn);
    this.hits0 = this.totalHits();
  }

  collisionsPerParticle(): number {
    return (2 * this.sim.log.count) / this.sim.store.count;
  }

  private totalHits(): number {
    let h = 0;
    for (const w of this.sim.walls) h += w.totals().hits;
    return h;
  }

  /** Call after every step; closes a window when due. Returns the new sample, if any. */
  update(): PressureSample | null {
    const sim = this.sim;
    const c = this.collisionsPerParticle();
    const dtw = sim.time - this.tStart;
    if (c - this.cStart < this.windowCollisions && dtw < this.maxWindowTime) return null;
    if (!(dtw > 0)) return null;
    return this.close();
  }

  /** partial windows discarded at the end of a run (too short to be comparable) */
  discardedPartialWindows = 0;

  /**
   * End-of-run: keep the open window only if it has covered at least half a
   * normal window; a much shorter window has far larger variance and would
   * dominate any bin it lands in. The discard is counted, not hidden.
   */
  finish(): PressureSample | null {
    const progressed = this.collisionsPerParticle() - this.cStart;
    if (progressed >= 0.5 * this.windowCollisions) return this.close();
    if (this.sim.time > this.tStart) this.discardedPartialWindows++;
    return null;
  }

  /** Force-close the current window. */
  close(): PressureSample | null {
    const sim = this.sim;
    const dtw = sim.time - this.tStart;
    if (!(dtw > 0)) return null;
    const wallPressure: number[] = [];
    const wallShear: number[] = [];
    const wallEnergyFlux: number[] = [];
    const energyNow: number[] = [];
    let sumImpulse = 0;
    let sumLength = 0;
    const normalNow: number[] = [];
    const tangentialNow: number[] = [];
    sim.walls.forEach((w, k) => {
      const t = w.totals();
      normalNow.push(t.normalImpulse);
      tangentialNow.push(t.tangentialImpulse);
      energyNow.push(t.energyIn);
      wallEnergyFlux.push((t.energyIn - this.energy0[k]) / (dtw * w.length));
      const dJ = t.normalImpulse - this.normal0[k];
      const dT = t.tangentialImpulse - this.tangential0[k];
      wallPressure.push(dJ / (dtw * w.length));
      wallShear.push(dT / (dtw * w.length));
      sumImpulse += dJ;
      sumLength += w.length;
    });
    const hits = this.totalHits();
    const c = this.collisionsPerParticle();
    const sample: PressureSample = {
      tStart: this.tStart,
      tEnd: sim.time,
      collisionsPerParticle: c,
      pressure: sumImpulse / (dtw * sumLength),
      wallPressure,
      wallShear,
      wallEnergyFlux,
      hits: hits - this.hits0,
      kT: sim.store.kineticEnergy() / sim.store.count,
    };
    this.samples.push(sample);
    this.tStart = sim.time;
    this.cStart = c;
    this.normal0 = normalNow;
    this.tangential0 = tangentialNow;
    this.energy0 = energyNow;
    this.hits0 = hits;
    return sample;
  }
}
