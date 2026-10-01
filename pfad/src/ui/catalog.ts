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
    key: 'sound-linear',
    label: 'SOUND SPEED — LINEAR LIMIT',
    engine: 'sound-speed-linear',
    step: 'Step 10',
    summary: 'Amplitude series (0.1–0.5) extrapolated to zero amplitude, where finite-amplitude effects vanish; widths 10 and 40 test width dependence near the linear regime.',
  },
  {
    key: 'sound-validation',
    label: 'SOUND SPEED — SMALL AMPLITUDE (ITEM 2)',
    engine: 'sound-speed-validation',
    step: 'Step 10',
    summary: 'Pre-registered amplitude series (0.4 → 0.05) with a zero-amplitude control, extrapolated to zero amplitude. Arrival times at 17 probes by stacked-template cross-correlation of the outward momentum pulse; competing features reported; invariance to timestep, probe width, sampling, window, domain length, strip height and particle radius. Criteria: docs/CRITERIA_SOUND_SPEED.md. The full configuration takes hours; use quick mode in the browser.',
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
    engine: 'boundary-layer',
    step: 'Step 12',
    summary: 'A uniform stream from an open reservoir passes a diffuse flat plate set in a specular floor (open top and outlet). Measures the near-wall deficit, δ*, θ, wall shear and growth — no profile is imposed. Dashed blue = open reservoir boundaries.',
  },
  {
    key: 'bl-separation',
    label: 'BOUNDARY LAYER + SEPARATION (ITEM 3)',
    engine: 'boundary-layer-separation',
    step: 'Steps 12–13',
    summary: 'Periodic channel: an inflow-conditioning fringe, a specular lead-in, then a diffuse flat plate under a specular ceiling. The ceiling can widen as a smooth diffuser (expansion r = 1–2.5) to decelerate the core. Near-wall velocity, wall impulse (shear and pressure), stream function and reverse-flow statistics come from particle data, with no profile or separation law. Criteria: docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md. The full configuration takes hours; use quick mode in the browser.',
  },
  {
    key: 'separation',
    label: 'SEPARATION',
    engine: 'separation',
    step: 'Step 13',
    summary: 'The boundary-layer rig with a controlled deceleration imposed only through the far-field reservoir (top boundary bleeds mass, outlet slower). Looks for sustained wall-shear reversal under forward outer flow; separation-onset hypotheses are trained on some gradient strengths and scored on held-out ones. Bulk reversal is not counted as separation.',
  },
  {
    key: 'kutta',
    label: 'KUTTA DISCOVERY',
    engine: 'kutta',
    step: 'Step 14',
    summary: 'A uniform stream starts impulsively past a fixed polygon body with a sharp trailing edge (open reservoirs on all sides). Nothing about circulation or the trailing edge is imposed. Measures lift and drag from wall impulses, circulation from the particle velocity field, the starting vortex, the direction in which gas leaves the trailing edge, near-wall reversal and the wake. A blunt-edged body is the comparison case.',
  },
  {
    key: 'scaling',
    label: 'SCALING',
    engine: 'scaling',
    step: 'Step 15',
    summary: 'Do results converge across scaled particle universes? The Kutta configuration is rerun at geometrically similar sizes (chord in particle diameters). Fixed-Mach family: Re grows with size. Fixed-Re family (set mode): U ∝ 1/size. Dimensionless lift, drag and circulation are judged LOW/MEDIUM/HIGH.',
  },
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
  { text: 'measure disturbance propagation', engine: 'sound-speed-validation' },
  { text: 'measure effective viscosity', engine: 'viscosity' },
  { text: 'demonstrate wall momentum transfer', engine: 'wall-accommodation' },
  { text: 'show a boundary layer', engine: 'boundary-layer' },
  { text: 'investigate adverse-gradient separation', engine: 'separation' },
  { text: 'test Kutta emergence', engine: 'kutta' },
  { text: 'report Re/Mach', engine: 'viscosity' },
  { text: 'perform resolution tests', engine: 'static-box' },
  { text: 'reproduce experiments from saved configurations', engine: 'static-box' },
  { text: 'export experiment data', engine: 'static-box' },
  { text: 'clearly distinguish measured results from assumptions', engine: 'static-box' },
];
