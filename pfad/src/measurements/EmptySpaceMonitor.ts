import type { Simulation } from '../core/Simulation';
import { OccupancyField } from '../occupancy/OccupancyField';

/**
 * "No empty space" test (Bible §19, Master prompt §20).
 *
 * Records φ_min, φ_max, φ_mean, density_min, density_max on a coarse grid whose
 * cells hold `perCell` particles on average (default 40, so an empty cell is a
 * >6σ Poisson event rather than routine noise).
 *
 * A cell with φ < collapseFraction · φ_mean is "near-zero occupancy". If such a
 * cell exists in `sustainSamples` consecutive samples the run is flagged
 *   POTENTIAL MODEL / NUMERICAL FAILURE
 * The flag is reported, never hidden or smoothed away. Low occupancy is kept
 * distinct from low density (reported separately) and from low pressure
 * (measured independently from momentum transfer).
 */
export interface EmptySpaceSummary {
  cells: number;
  meanParticlesPerCell: number;
  phiMin: number;
  phiMax: number;
  phiMean: number;
  densityMin: number;
  densityMax: number;
  collapseThreshold: number;
  samplesWithCollapsedCell: number;
  longestCollapseRun: number;
  /** index of dispersion Var(N_cell)/⟨N_cell⟩: 1 for Poisson, < 1 for excluded-area gases, ≫ 1 when clustering */
  dispersionFinal: number;
  dispersionMax: number;
  samples: number;
  flag: null | 'POTENTIAL MODEL / NUMERICAL FAILURE';
}

export class EmptySpaceMonitor {
  readonly field: OccupancyField;
  private readonly sim: Simulation;
  private readonly collapseFraction: number;
  private readonly sustainSamples: number;
  private phiMin = Infinity;
  private phiMax = -Infinity;
  private phiMeanSum = 0;
  private densityMin = Infinity;
  private densityMax = -Infinity;
  private nSamples = 0;
  private collapsedSamples = 0;
  private run = 0;
  private longestRun = 0;
  private dispersionFinal = Number.NaN;
  private dispersionMax = 0;

  constructor(sim: Simulation, perCell = 40, collapseFraction = 0.1, sustainSamples = 5) {
    this.sim = sim;
    this.field = OccupancyField.withMeanOccupancy(sim.domain, sim.store.count, perCell);
    this.collapseFraction = collapseFraction;
    this.sustainSamples = sustainSamples;
  }

  sample(): void {
    this.field.compute(this.sim.store);
    const s = this.field.stats();
    this.phiMin = Math.min(this.phiMin, s.phiMin);
    this.phiMax = Math.max(this.phiMax, s.phiMax);
    this.phiMeanSum += s.phiMean;
    this.densityMin = Math.min(this.densityMin, s.densityMin);
    this.densityMax = Math.max(this.densityMax, s.densityMax);
    this.nSamples++;
    const counts = this.field.count;
    let m = 0;
    for (let c = 0; c < counts.length; c++) m += counts[c];
    m /= counts.length;
    let v = 0;
    for (let c = 0; c < counts.length; c++) v += (counts[c] - m) ** 2;
    v /= Math.max(1, counts.length - 1);
    this.dispersionFinal = m > 0 ? v / m : Number.NaN;
    this.dispersionMax = Math.max(this.dispersionMax, this.dispersionFinal);
    if (s.phiMin < this.collapseFraction * s.phiMean) {
      this.collapsedSamples++;
      this.run++;
      this.longestRun = Math.max(this.longestRun, this.run);
    } else {
      this.run = 0;
    }
  }

  summary(): EmptySpaceSummary {
    const phiMean = this.nSamples > 0 ? this.phiMeanSum / this.nSamples : Number.NaN;
    return {
      cells: this.field.nx * this.field.ny,
      meanParticlesPerCell: this.sim.store.count / (this.field.nx * this.field.ny),
      phiMin: this.phiMin,
      phiMax: this.phiMax,
      phiMean,
      densityMin: this.densityMin,
      densityMax: this.densityMax,
      collapseThreshold: this.collapseFraction * phiMean,
      samplesWithCollapsedCell: this.collapsedSamples,
      longestCollapseRun: this.longestRun,
      dispersionFinal: this.dispersionFinal,
      dispersionMax: this.dispersionMax,
      samples: this.nSamples,
      flag: this.longestRun >= this.sustainSamples ? 'POTENTIAL MODEL / NUMERICAL FAILURE' : null,
    };
  }
}
