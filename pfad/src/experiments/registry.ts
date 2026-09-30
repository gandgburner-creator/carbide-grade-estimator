import type { ExperimentRecord, ExperimentType, SequentialExperiment } from './Experiment';
import { STATIC_BOX_REFERENCE, StaticBoxExperiment, type StaticBoxParams } from './StaticBoxExperiment';
import { THERMAL_REFERENCE, ThermalExperiment, type ThermalParams } from './ThermalExperiment';

/**
 * Experiment registry: one entry per experiment type, used by the CLI, the UI
 * worker and `runFromRecord`. `defaults` is the documented reference setup;
 * `quick` is a reduced setup for smoke tests (never used for reported results).
 */
export interface ExperimentEntry<P> {
  type: ExperimentType;
  title: string;
  defaults: P;
  quick: P;
  create(params: P): SequentialExperiment<unknown, unknown>;
}

const staticBox: ExperimentEntry<StaticBoxParams> = {
  type: 'static-box',
  title: 'Static pressure (static box)',
  defaults: STATIC_BOX_REFERENCE,
  quick: {
    ...STATIC_BOX_REFERENCE,
    count: 400,
    measurementCollisions: 30,
    decayMaxCollisions: 60,
    decayStopKineticFraction: 0.1,
  },
  create: (p) => new StaticBoxExperiment(p) as unknown as SequentialExperiment<unknown, unknown>,
};

const thermal: ExperimentEntry<ThermalParams> = {
  type: 'thermal',
  title: 'Thermal equilibrium',
  defaults: THERMAL_REFERENCE,
  quick: {
    ...THERMAL_REFERENCE,
    count: 400,
    seeds: [1, 2],
    temperatures: [0.5, 2],
    areaFractions: [0.05, 0.2],
    distributions: ['maxwell', 'two-beam'],
    measurementCollisions: 20,
    relaxationCollisions: 20,
  },
  create: (p) => new ThermalExperiment(p) as unknown as SequentialExperiment<unknown, unknown>,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPERIMENTS: Partial<Record<ExperimentType, ExperimentEntry<any>>> = {
  'static-box': staticBox,
  thermal,
};

/** Re-run an experiment from a saved record's configuration (Master prompt §42.13). */
export function runFromRecord(record: ExperimentRecord): ExperimentRecord {
  const entry = EXPERIMENTS[record.experimentType];
  if (!entry) throw new Error(`no experiment registered for ${record.experimentType}`);
  return entry.create(record.config).runToCompletion();
}
