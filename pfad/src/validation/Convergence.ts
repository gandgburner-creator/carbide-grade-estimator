import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import { EXPERIMENTS } from '../experiments/registry';
import type { Estimate } from '../measurements/Statistics';
import { compare, judgeConvergence } from './ConvergenceJudge';
import type { ValidationStatus } from './Status';

export { compare, judgeConvergence };

/**
 * Convergence studies (Master prompt §23, Bible §31).
 *
 * A study reruns one experiment at LOW / MEDIUM / HIGH along one numerical
 * dimension and compares a measured scalar. The verdict compares HIGH with
 * MEDIUM:
 *   NOT CONVERGED  the change is statistically significant (|z| > 2) AND larger
 *                  than the stated relative tolerance
 *   INCONCLUSIVE   the study cannot resolve a change of the tolerance's size
 *                  (2σ of the difference > 2 × tolerance)
 *   PASSED         otherwise: converged to within max(tolerance, resolution)
 */
export type ConvergenceDimension = 'timestep' | 'particle-count' | 'grid' | 'domain' | 'averaging' | 'seeds';

export interface ConvergenceLevel {
  name: string;
  overrides: Record<string, unknown>;
}

export interface ConvergenceStudyDef {
  experiment: ExperimentType;
  dimension: ConvergenceDimension;
  base: Record<string, unknown>;
  levels: ConvergenceLevel[];
  metricName: string;
  metric: (rec: ExperimentRecord) => Estimate | null | undefined;
  relTolerance: number;
}

export interface LevelResult {
  name: string;
  overrides: Record<string, unknown>;
  estimate: { mean: number; se: number; ci95: [number, number]; n: number } | null;
  status: ValidationStatus;
  wallSeconds: number;
}

export interface ConvergenceResult {
  experiment: ExperimentType;
  dimension: ConvergenceDimension;
  metricName: string;
  relTolerance: number;
  levels: LevelResult[];
  highVsMedium: { difference: number; se: number; z: number; relative: number; resolution: number } | null;
  mediumVsLow: { difference: number; se: number; z: number; relative: number; resolution: number } | null;
  status: ValidationStatus;
  verdict: string;
  /**
   * particle-count studies at fixed occupancy: weighted fit metric = M∞ + a·N^(−1/2)
   * (N^(−1/2) ∝ 1/L, the wall-to-bulk ratio). An extrapolation, reported as such.
   */
  extrapolation?: { model: string; infinite: number; seInfinite: number; slope: number; seSlope: number } | null;
}

function weightedLine(x: number[], y: number[], se: number[]) {
  let S = 0;
  let Sx = 0;
  let Sy = 0;
  let Sxx = 0;
  let Sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 1 / (se[i] * se[i]);
    S += w;
    Sx += w * x[i];
    Sy += w * y[i];
    Sxx += w * x[i] * x[i];
    Sxy += w * x[i] * y[i];
  }
  const D = S * Sxx - Sx * Sx;
  return {
    intercept: (Sxx * Sy - Sx * Sxy) / D,
    slope: (S * Sxy - Sx * Sy) / D,
    seIntercept: Math.sqrt(Sxx / D),
    seSlope: Math.sqrt(S / D),
  };
}

export function runConvergenceStudy(
  def: ConvergenceStudyDef,
  onProgress?: (level: string, fraction: number) => void,
): ConvergenceResult {
  const entry = EXPERIMENTS[def.experiment];
  if (!entry) throw new Error(`unknown experiment ${def.experiment}`);
  const levels: LevelResult[] = [];
  for (const L of def.levels) {
    const t0 = Date.now();
    const exp = entry.create({ ...def.base, ...L.overrides });
    const rec = exp.runToCompletion(onProgress ? (f) => onProgress(L.name, f) : undefined);
    const est = def.metric(rec);
    levels.push({
      name: L.name,
      overrides: L.overrides,
      estimate: est ? { mean: est.mean, se: est.se, ci95: est.ci95, n: est.n } : null,
      status: rec.status,
      wallSeconds: (Date.now() - t0) / 1000,
    });
  }
  const n = levels.length;
  const highVsMedium = n >= 2 ? compare(levels[n - 1].estimate, levels[n - 2].estimate) : null;
  const mediumVsLow = n >= 3 ? compare(levels[n - 2].estimate, levels[n - 3].estimate) : null;
  const { status, verdict } = judgeConvergence(highVsMedium, def.relTolerance);
  let extrapolation: ConvergenceResult['extrapolation'] = null;
  const counts = levels.map((L) => Number((L.overrides as { count?: number }).count));
  if (def.dimension === 'particle-count' && levels.every((L) => L.estimate) && counts.every((c) => c > 0) && n >= 3) {
    const fit = weightedLine(
      counts.map((c) => 1 / Math.sqrt(c)),
      levels.map((L) => L.estimate!.mean),
      levels.map((L) => L.estimate!.se),
    );
    extrapolation = {
      model: 'metric = M∞ + a·N^(−1/2)  (fixed occupancy: N^(−1/2) ∝ 1/L)',
      infinite: fit.intercept,
      seInfinite: fit.seIntercept,
      slope: fit.slope,
      seSlope: fit.seSlope,
    };
  }
  return {
    extrapolation,
    experiment: def.experiment,
    dimension: def.dimension,
    metricName: def.metricName,
    relTolerance: def.relTolerance,
    levels,
    highVsMedium,
    mediumVsLow,
    status,
    verdict,
  };
}
