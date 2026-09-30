/**
 * Explicit validation statuses (Master prompt §37). "Validated" is never used:
 * a PASSED check means the stated acceptance criterion was met in the runs
 * recorded, nothing more.
 */
export type ValidationStatus = 'UNTESTED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | 'NOT CONVERGED';

export interface AcceptanceCheck {
  id: string;
  description: string;
  /** the criterion, stated before the measurement */
  criterion: string;
  /** what was measured */
  measured: string;
  status: ValidationStatus;
}

const SEVERITY: Record<ValidationStatus, number> = {
  FAILED: 5,
  'NOT CONVERGED': 4,
  INCONCLUSIVE: 3,
  RUNNING: 2,
  UNTESTED: 1,
  PASSED: 0,
};

/** Worst status wins: FAILED > NOT CONVERGED > INCONCLUSIVE > RUNNING > UNTESTED > PASSED. */
export function combineStatus(checks: AcceptanceCheck[]): ValidationStatus {
  if (checks.length === 0) return 'UNTESTED';
  let worst: ValidationStatus = 'PASSED';
  for (const c of checks) if (SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
  return worst;
}

export function check(
  id: string,
  description: string,
  criterion: string,
  measured: string,
  ok: boolean,
  statusIfNot: ValidationStatus = 'FAILED',
): AcceptanceCheck {
  return { id, description, criterion, measured, status: ok ? 'PASSED' : statusIfNot };
}
