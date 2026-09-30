import type { ValidationStatus } from './Status';

/**
 * The convergence verdict (Master prompt §23), shared by convergence studies
 * and scaling experiments. Compares the finest level with the next one.
 */
export interface LevelEstimate {
  mean: number;
  se: number;
}

export function compare(hi: LevelEstimate | null, lo: LevelEstimate | null) {
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
