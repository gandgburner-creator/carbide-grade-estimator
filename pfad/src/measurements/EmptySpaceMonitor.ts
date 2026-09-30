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
  /** index of dispersion at every sample, with the simulation time (for stationarity tests) */
  dispersionSeries: { t: number[]; d: number[] };
  samples: number;
  /** cells left out of the statistics (occupied by a solid body) */
  excludedCells: number;
  flag: null | 'POTENTIAL MODEL / NUMERICAL FAILURE';
}

/** Aggregate of the per-run summaries, as reported in experiment records. */
export function aggregateEmptySpace(runs: EmptySpaceSummary[]) {
  const flagged = runs.filter((r) => r.flag).length;
  return {
    runs: runs.length,
    flaggedRuns: flagged,
    phiMin: Math.min(...runs.map((r) => r.phiMin)),
    phiMax: Math.max(...runs.map((r) => r.phiMax)),
    phiMean: runs.reduce((a, r) => a + r.phiMean, 0) / Math.max(1, runs.length),
    densityMin: Math.min(...runs.map((r) => r.densityMin)),
    densityMax: Math.max(...runs.map((r) => r.densityMax)),
    longestCollapseRun: Math.max(0, ...runs.map((r) => r.longestCollapseRun)),
    dispersionMax: Math.max(0, ...runs.map((r) => r.dispersionMax)),
    cellsPerRun: runs[0]?.cells ?? 0,
    excludedCells: runs[0]?.excludedCells ?? 0,
    meanParticlesPerCell: runs[0]?.meanParticlesPerCell ?? Number.NaN,
    note: 'Master prompt §20: occupancy and density extremes on cells of ~40 particles; a cell below 0.1 φ_mean in 5 consecutive samples flags POTENTIAL MODEL / NUMERICAL FAILURE. Low density near open boundaries (A-18) is expected and is not near-zero occupancy.',
  };
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
  private readonly dispT: number[] = [];
  private readonly dispD: number[] = [];
  /** 1 = cell counted, 0 = excluded */
  private readonly mask: Uint8Array;
  private readonly excluded: number;

  /**
   * `excludeCell(xmin, ymin, xmax, ymax)` may remove cells from the statistics,
   * e.g. cells a solid body occupies (their low occupancy is geometry, not a failure).
   */
  constructor(sim: Simulation, perCell = 40, collapseFraction = 0.1, sustainSamples = 5, excludeCell?: (x0: number, y0: number, x1: number, y1: number) => boolean) {
    this.sim = sim;
    this.field = OccupancyField.withMeanOccupancy(sim.domain, sim.store.count, perCell);
    this.collapseFraction = collapseFraction;
    this.sustainSamples = sustainSamples;
    const f = this.field;
    this.mask = new Uint8Array(f.nx * f.ny).fill(1);
    let ex = 0;
    if (excludeCell) {
      const d = sim.domain;
      for (let cy = 0; cy < f.ny; cy++) {
        for (let cx = 0; cx < f.nx; cx++) {
          const x0 = d.xmin + cx * f.cellW;
          const y0 = d.ymin + cy * f.cellH;
          if (excludeCell(x0, y0, x0 + f.cellW, y0 + f.cellH)) {
            this.mask[cy * f.nx + cx] = 0;
            ex++;
          }
        }
      }
    }
    this.excluded = ex;
  }

  sample(): void {
    this.field.compute(this.sim.store);
    const s = this.maskedStats();
    this.phiMin = Math.min(this.phiMin, s.phiMin);
    this.phiMax = Math.max(this.phiMax, s.phiMax);
    this.phiMeanSum += s.phiMean;
    this.densityMin = Math.min(this.densityMin, s.densityMin);
    this.densityMax = Math.max(this.densityMax, s.densityMax);
    this.nSamples++;
    const counts = this.field.count;
    const used = counts.length - this.excluded;
    let m = 0;
    for (let c = 0; c < counts.length; c++) if (this.mask[c]) m += counts[c];
    m /= Math.max(1, used);
    let v = 0;
    for (let c = 0; c < counts.length; c++) if (this.mask[c]) v += (counts[c] - m) ** 2;
    v /= Math.max(1, used - 1);
    this.dispersionFinal = m > 0 ? v / m : Number.NaN;
    this.dispersionMax = Math.max(this.dispersionMax, this.dispersionFinal);
    this.dispT.push(this.sim.time);
    this.dispD.push(this.dispersionFinal);
    if (s.phiMin < this.collapseFraction * s.phiMean) {
      this.collapsedSamples++;
      this.run++;
      this.longestRun = Math.max(this.longestRun, this.run);
    } else {
      this.run = 0;
    }
  }

  private maskedStats() {
    const f = this.field;
    let pmin = Infinity;
    let pmax = -Infinity;
    let psum = 0;
    let dmin = Infinity;
    let dmax = -Infinity;
    let n = 0;
    for (let c = 0; c < f.phi.length; c++) {
      if (!this.mask[c]) continue;
      const p = f.phi[c];
      const d = f.density[c];
      if (p < pmin) pmin = p;
      if (p > pmax) pmax = p;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      psum += p;
      n++;
    }
    return { phiMin: pmin, phiMax: pmax, phiMean: psum / Math.max(1, n), densityMin: dmin, densityMax: dmax };
  }

  summary(): EmptySpaceSummary {
    const phiMean = this.nSamples > 0 ? this.phiMeanSum / this.nSamples : Number.NaN;
    return {
      cells: this.field.nx * this.field.ny,
      excludedCells: this.excluded,
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
      dispersionSeries: { t: this.dispT.slice(), d: this.dispD.slice() },
      samples: this.nSamples,
      flag: this.longestRun >= this.sustainSamples ? 'POTENTIAL MODEL / NUMERICAL FAILURE' : null,
    };
  }
}
