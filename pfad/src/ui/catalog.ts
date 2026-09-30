import type { ExperimentType } from '../experiments/Experiment';

/**
 * The laboratory's experiment selector (Master prompt §26). An entry whose
 * `engine` is null is not implemented yet and is shown as UNTESTED with the
 * development step that will provide it — never as a mock-up.
 */
export interface CatalogEntry {
  key: string;
  label: string;
  engine: ExperimentType | null;
  step: string;
  summary: string;
  /** parameter overrides applied on top of the engine's defaults */
  preset?: Record<string, unknown>;
}

export const CATALOG: CatalogEntry[] = [
  {
    key: 'static-pressure',
    label: 'STATIC PRESSURE',
    engine: 'static-box',
    step: 'Steps 5–7',
    summary: 'Closed box of hard disks. Pressure measured only from wall impulses; compared afterwards with kinetic-theory benchmarks.',
    preset: { restitutions: [1] },
  },
  {
    key: 'energy',
    label: 'ENERGY',
    engine: 'static-box',
    step: 'Step 7',
    summary: 'Elastic energy conservation (ledger residual) and inelastic cooling: pressure vs collisions per particle for e = 1, 0.99, 0.9.',
    preset: { restitutions: [1, 0.99, 0.9] },
  },
  {
    key: 'thermal',
    label: 'THERMAL EQUILIBRIUM',
    engine: 'thermal',
    step: 'Step 8',
    summary: 'Temperature and density dependence of the measured pressure, and relaxation from non-Maxwellian starts.',
  },
  {
    key: 'wall',
    label: 'WALL ACCOMMODATION',
    engine: 'wall-accommodation',
    step: 'Step 9',
    summary: 'Momentum and energy transfer at walls with accommodation Aw. A wall parameter, not a viscosity.',
  },
  {
    key: 'sound',
    label: 'SOUND SPEED',
    engine: 'sound-speed',
    step: 'Step 10',
    summary: 'Pressure pulse: a density excess is released after equilibration; c_p is tracked from the outward momentum density. Models A–E (collisions, occupancy, Universe B reservoir).',
  },
  {
    key: 'sound-sweeps',
    label: 'SOUND SPEED — SWEEPS',
    engine: 'sound-speed-sweeps',
    step: 'Step 10',
    summary: 'c_p versus density, amplitude, pulse width, particle scale, temperature, contact stiffness, and the k_s = m c_p²/φ₀ calibration.',
  },
  {
    key: 'viscosity',
    label: 'VISCOSITY',
    engine: 'viscosity',
    step: 'Step 11',
    summary: 'Couette flow between a resting and a moving diffuse wall: μ_eff = measured wall shear / measured core velocity gradient. No viscosity enters the solver.',
  },
  {
    key: 'viscosity-sweeps',
    label: 'VISCOSITY — SWEEPS',
    engine: 'viscosity-sweeps',
    step: 'Step 11',
    summary: 'μ_eff versus wall speed, accommodation, density, channel height, temperature and particle scale.',
  },
  {
    key: 'boundary-layer',
    label: 'BOUNDARY LAYER',
    engine: null,
    step: 'Step 12',
    summary: 'Uniform flow over a long flat wall. Not implemented yet.',
  },
  {
    key: 'separation',
    label: 'SEPARATION',
    engine: null,
    step: 'Step 13',
    summary: 'Controlled adverse gradient; separation threshold as a data-generated hypothesis. Not implemented yet.',
  },
  { key: 'kutta', label: 'KUTTA DISCOVERY', engine: null, step: 'Step 14', summary: 'Sharp trailing edge from a cold start, nothing imposed. Not implemented yet.' },
  { key: 'scaling', label: 'SCALING', engine: null, step: 'Step 15', summary: 'Do results converge across scaled particle universes? Not implemented yet.' },
  {
    key: 'ab',
    label: 'MODEL A/B TEST',
    engine: 'ab-test',
    step: '§40',
    summary: 'Two configurations of one experiment under equivalent conditions (same seeds): difference, uncertainty, significance and each side’s status. Default: a null test with disjoint seeds, which should show no difference.',
  },
];

/** Phase 0 acceptance criteria (Master prompt §42); airfoil optimisation stays locked until all pass. */
export const PHASE0_CRITERIA: { text: string; engine: ExperimentType | null }[] = [
  { text: 'produce stable particle gas', engine: 'static-box' },
  { text: 'measure pressure from impacts', engine: 'static-box' },
  { text: 'quantify energy conservation', engine: 'static-box' },
  { text: 'measure thermal behaviour', engine: 'thermal' },
  { text: 'measure disturbance propagation', engine: 'sound-speed' },
  { text: 'measure effective viscosity', engine: 'viscosity' },
  { text: 'demonstrate wall momentum transfer', engine: 'wall-accommodation' },
  { text: 'show a boundary layer', engine: null },
  { text: 'investigate adverse-gradient separation', engine: null },
  { text: 'test Kutta emergence', engine: null },
  { text: 'report Re/Mach', engine: 'viscosity' },
  { text: 'perform resolution tests', engine: 'static-box' },
  { text: 'reproduce experiments from saved configurations', engine: 'static-box' },
  { text: 'export experiment data', engine: 'static-box' },
  { text: 'clearly distinguish measured results from assumptions', engine: 'static-box' },
];
