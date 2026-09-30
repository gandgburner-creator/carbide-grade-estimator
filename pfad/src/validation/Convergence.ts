import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import { EXPERIMENTS } from '../experiments/registry';
import type { Estimate } from '../measurements/Statistics';
import type { ValidationStatus } from './Status';

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

function compare(hi: LevelResult['estimate'], lo: LevelResult['estimate']) {
  if (!hi || !lo) return null;
  const d = hi.mean - lo.mean;
  const se = Math.hypot(hi.se, lo.se);
  return {
    difference: d,
    se,
    z: se > 0 ? d / se : Number.POSITIVE_INFINITY,
    relative: d / Math.abs(hi.mean),
    resolution: (2 * se) / Math.abs(hi.mean),
  };
}

export function judgeConvergence(
  cmp: ReturnType<typeof compare>,
  relTolerance: number,
): { status: ValidationStatus; verdict: string } {
  if (!cmp) return { status: 'INCONCLUSIVE', verdict: 'missing estimate at one level' };
  const sig = Math.abs(cmp.z) > 2;
  if (sig && Math.abs(cmp.relative) > relTolerance) {
    return {
      status: 'NOT CONVERGED',
      verdict: `HIGH differs from MEDIUM by ${(100 * cmp.relative).toFixed(2)} % (z = ${cmp.z.toFixed(2)}), above the ${(100 * relTolerance).toFixed(1)} % tolerance`,
    };
  }
  if (cmp.resolution > 2 * relTolerance) {
    return {
      status: 'INCONCLUSIVE',
      verdict: `study resolution ${(100 * cmp.resolution).toFixed(2)} % is too coarse to test a ${(100 * relTolerance).toFixed(1)} % tolerance`,
    };
  }
  return {
    status: 'PASSED',
    verdict: `HIGH vs MEDIUM change ${(100 * cmp.relative).toFixed(2)} % (z = ${cmp.z.toFixed(2)}); converged within ${(100 * Math.max(relTolerance, cmp.resolution)).toFixed(2)} %`,
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
