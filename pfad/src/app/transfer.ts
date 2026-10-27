import type { Simulation } from '../core/Simulation';
import type { TransferData } from '../workers/protocol';

/**
 * Wall and body momentum transfer over a window (display monitor). Uses the
 * same definition as the experiments' wall pressure (PressureEstimator):
 *   P_wall = Σ normal impulse delivered to the wall / (Δt · L)
 *   τ_wall = Σ tangential impulse / (Δt · L)
 *   F_body = Δ(impulse delivered to the body) / Δt
 * No equation of state or velocity–pressure relation is involved.
 */
export class TransferMonitor {
  readonly sim: Simulation;
  private readonly t0: number;
  private readonly normal0: number[];
  private readonly tangential0: number[];
  private readonly hits0: number[];
  private readonly body0: { jx: number; jy: number; hits: number }[];

  constructor(sim: Simulation) {
    this.sim = sim;
    this.t0 = sim.time;
    const totals = sim.walls.map((w) => w.totals());
    this.normal0 = totals.map((t) => t.normalImpulse);
    this.tangential0 = totals.map((t) => t.tangentialImpulse);
    this.hits0 = totals.map((t) => t.hits);
    this.body0 = sim.bodies.map((b) => ({ jx: b.impulseX, jy: b.impulseY, hits: b.totalHits }));
  }

  read(): TransferData | null {
    const sim = this.sim;
    if (sim.walls.length === 0 && sim.bodies.length === 0) return null;
    const dt = sim.time - this.t0;
    const rate = (x: number, L = 1) => (dt > 0 && L > 0 ? x / (dt * L) : Number.NaN);
    return {
      t0: this.t0,
      t1: sim.time,
      walls: sim.walls.map((w, i) => {
        const t = w.totals();
        return {
          side: w.config.side,
          length: w.length,
          accommodation: w.config.accommodation,
          hits: t.hits - this.hits0[i],
          pressure: rate(t.normalImpulse - this.normal0[i], w.length),
          shear: rate(t.tangentialImpulse - this.tangential0[i], w.length),
        };
      }),
      bodies: sim.bodies.map((b, i) => ({
        hits: b.totalHits - this.body0[i].hits,
        fx: rate(b.impulseX - this.body0[i].jx),
        fy: rate(b.impulseY - this.body0[i].jy),
      })),
    };
  }
}
