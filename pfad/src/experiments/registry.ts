import { ABTestExperiment, setABFactory, type ABTestParams } from './ABTestExperiment';
import type { ExperimentRecord, ExperimentType, SequentialExperiment } from './Experiment';
import { COUETTE_REFERENCE, COUETTE_SWEEPS, CouetteExperiment, type CouetteParams } from './CouetteExperiment';
import { PULSE_REFERENCE, PULSE_SWEEPS, PressurePulseExperiment, type PulseParams } from './PressurePulseExperiment';
import { STATIC_BOX_REFERENCE, StaticBoxExperiment, type StaticBoxParams } from './StaticBoxExperiment';
import { THERMAL_REFERENCE, ThermalExperiment, type ThermalParams } from './ThermalExperiment';
import {
  WALL_ACCOMMODATION_REFERENCE,
  WallAccommodationExperiment,
  type WallAccommodationParams,
} from './WallAccommodationExperiment';

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

const wallAccommodation: ExperimentEntry<WallAccommodationParams> = {
  type: 'wall-accommodation',
  title: 'Wall accommodation',
  defaults: WALL_ACCOMMODATION_REFERENCE,
  quick: {
    ...WALL_ACCOMMODATION_REFERENCE,
    count: 400,
    height: 20,
    accommodations: [0, 0.5, 1],
    seeds: [1, 2],
    thermalEquilibrationCollisions: 40,
    thermalCollisions: 30,
    shearEquilibrationCollisions: 40,
    shearCollisions: 30,
  },
  create: (p) => new WallAccommodationExperiment(p) as unknown as SequentialExperiment<unknown, unknown>,
};

const quickCase = (c: PulseParams['cases'][number]) => ({ ...c, length: 200, height: 50, duration: Math.min(c.duration, 55), equilibrationTime: Math.min(c.equilibrationTime, 20) });
const soundSpeed: ExperimentEntry<PulseParams> = {
  type: 'sound-speed',
  title: 'Sound speed (pressure pulse), models A–E',
  defaults: PULSE_REFERENCE,
  quick: { ...PULSE_REFERENCE, seeds: [1, 2, 3], cases: PULSE_REFERENCE.cases.map(quickCase) },
  create: (p) => new PressurePulseExperiment(p, 'sound-speed') as unknown as SequentialExperiment<unknown, unknown>,
};
const soundSpeedSweeps: ExperimentEntry<PulseParams> = {
  type: 'sound-speed-sweeps',
  title: 'Sound speed sweeps',
  defaults: PULSE_SWEEPS,
  quick: { ...PULSE_SWEEPS, seeds: [1, 2, 3], cases: PULSE_SWEEPS.cases.filter((_, i) => i % 3 === 0).map(quickCase) },
  create: (p) => new PressurePulseExperiment(p, 'sound-speed-sweeps') as unknown as SequentialExperiment<unknown, unknown>,
};

const viscosity: ExperimentEntry<CouetteParams> = {
  type: 'viscosity',
  title: 'Couette viscosity',
  defaults: COUETTE_REFERENCE,
  quick: {
    ...COUETTE_REFERENCE,
    seeds: [1, 2, 3],
    cases: COUETTE_REFERENCE.cases.map((c) => ({ ...c, count: 400, height: 20, equilibrationCollisions: 60, measurementCollisions: 80 })),
  },
  create: (p) => new CouetteExperiment(p, 'viscosity') as unknown as SequentialExperiment<unknown, unknown>,
};
const viscositySweeps: ExperimentEntry<CouetteParams> = {
  type: 'viscosity-sweeps',
  title: 'Couette viscosity sweeps',
  defaults: COUETTE_SWEEPS,
  quick: {
    ...COUETTE_SWEEPS,
    seeds: [1, 2, 3],
    cases: COUETTE_SWEEPS.cases.slice(0, 3).map((c) => ({ ...c, count: 400, height: 20, equilibrationCollisions: 60, measurementCollisions: 80 })),
  },
  create: (p) => new CouetteExperiment(p, 'viscosity-sweeps') as unknown as SequentialExperiment<unknown, unknown>,
};

const abBase = { ...STATIC_BOX_REFERENCE, restitutions: [1], count: 1000, measurementCollisions: 60 };
export const AB_PRESETS: Record<string, ABTestParams> = {
  'null test: disjoint seeds (expect no difference)': {
    experiment: 'static-box',
    a: { label: 'seeds 7–11', params: { ...abBase, seeds: [7, 8, 9, 10, 11] } },
    b: { label: 'seeds 12–16', params: { ...abBase, seeds: [12, 13, 14, 15, 16] } },
  },
  'numerical: rewind-to-contact vs impulse-at-detection (Courant 0.1)': {
    experiment: 'static-box',
    a: { label: 'rewind-to-contact', params: { ...abBase, seeds: [7, 8, 9, 10, 11], timestep: { kind: 'adaptive', courant: 0.1, dtMax: 1, dtMin: 1e-7 } } },
    b: {
      label: 'impulse-at-detection',
      params: { ...abBase, seeds: [7, 8, 9, 10, 11], contact: 'impulse-at-detection', timestep: { kind: 'adaptive', courant: 0.1, dtMax: 1, dtMin: 1e-7 } },
    },
  },
};
const abTest: ExperimentEntry<ABTestParams> = {
  type: 'ab-test',
  title: 'Model A/B test',
  defaults: AB_PRESETS['null test: disjoint seeds (expect no difference)'],
  quick: {
    experiment: 'static-box',
    a: { label: 'seeds 7–9', params: { ...abBase, count: 400, measurementCollisions: 30, seeds: [7, 8, 9] } },
    b: { label: 'seeds 10–12', params: { ...abBase, count: 400, measurementCollisions: 30, seeds: [10, 11, 12] } },
  },
  create: (p) => new ABTestExperiment(p) as unknown as SequentialExperiment<unknown, unknown>,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPERIMENTS: Partial<Record<ExperimentType, ExperimentEntry<any>>> = {
  'static-box': staticBox,
  thermal,
  'wall-accommodation': wallAccommodation,
  'sound-speed': soundSpeed,
  'sound-speed-sweeps': soundSpeedSweeps,
  viscosity,
  'viscosity-sweeps': viscositySweeps,
  'ab-test': abTest,
};

setABFactory((type, params) => {
  const entry = EXPERIMENTS[type];
  if (!entry || type === 'ab-test') throw new Error(`cannot A/B-test experiment type ${type}`);
  return entry.create(params);
});

/** Re-run an experiment from a saved record's configuration (Master prompt §42.13). */
export function runFromRecord(record: ExperimentRecord): ExperimentRecord {
  const entry = EXPERIMENTS[record.experimentType];
  if (!entry) throw new Error(`no experiment registered for ${record.experimentType}`);
  return entry.create(record.config).runToCompletion();
}
