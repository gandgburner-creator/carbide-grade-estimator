import type { Estimate } from '../measurements/Statistics';
import { STATIC_BOX_REFERENCE } from '../experiments/StaticBoxExperiment';
import type { ConvergenceStudyDef } from './Convergence';

/**
 * Registered convergence studies. Each names its levels, its metric and its
 * tolerance up front; the verdict is computed, never edited.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dimensionlessPressure = (rec: any): Estimate | null => rec.results?.elastic?.dimensionlessPressure ?? null;

const staticBase = { ...STATIC_BOX_REFERENCE, restitutions: [1], seeds: [7, 8, 9, 10, 11] };

export const CONVERGENCE_STUDIES: Record<string, ConvergenceStudyDef> = {
  'static-box/timestep': {
    experiment: 'static-box',
    dimension: 'timestep',
    base: staticBase,
    levels: [
      { name: 'LOW', overrides: { timestep: { kind: 'adaptive', courant: 0.1, dtMax: 1, dtMin: 1e-7 } } },
      { name: 'MEDIUM', overrides: { timestep: { kind: 'adaptive', courant: 0.05, dtMax: 1, dtMin: 1e-7 } } },
      { name: 'HIGH', overrides: { timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 } } },
    ],
    metricName: 'P·A/(N·kT)',
    metric: dimensionlessPressure,
    relTolerance: 0.01,
  },
  'static-box/particle-count': {
    experiment: 'static-box',
    dimension: 'particle-count',
    base: staticBase,
    levels: [
      { name: 'LOW', overrides: { count: 500 } },
      { name: 'MEDIUM', overrides: { count: 1000 } },
      { name: 'HIGH', overrides: { count: 2000 } },
    ],
    metricName: 'P·A/(N·kT)',
    metric: dimensionlessPressure,
    relTolerance: 0.01,
  },
  'static-box/averaging': {
    experiment: 'static-box',
    dimension: 'averaging',
    base: staticBase,
    levels: [
      { name: 'LOW', overrides: { measurementCollisions: 25 } },
      { name: 'MEDIUM', overrides: { measurementCollisions: 50 } },
      { name: 'HIGH', overrides: { measurementCollisions: 100 } },
    ],
    metricName: 'P·A/(N·kT)',
    metric: dimensionlessPressure,
    relTolerance: 0.01,
  },
  'static-box/grid': {
    experiment: 'static-box',
    dimension: 'grid',
    base: staticBase,
    levels: [
      { name: 'LOW', overrides: { gridCellSize: 1 } },
      { name: 'MEDIUM', overrides: { gridCellSize: 2.5 } },
      { name: 'HIGH', overrides: { gridCellSize: undefined } },
    ],
    metricName: 'P·A/(N·kT)',
    metric: dimensionlessPressure,
    relTolerance: 0.01,
  },
};
