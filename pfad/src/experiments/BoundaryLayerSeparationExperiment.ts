import { aggregateEmptySpace } from '../measurements/EmptySpaceMonitor';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';
import { WallFlowRun, wallFlowGeometry, type WallFlowConfig, type WallFlowRunResult } from './WallFlowRun';

/**
 * ITEM 3 — BOUNDARY LAYER + SEPARATION DISCOVERY
 * (docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md).
 *
 * Every case is the flat-wall rig of WallFlowRun with a few documented
 * overrides of the base configuration (wall accommodation, ceiling expansion,
 * numerical or domain variants). The runs only record raw particle and wall
 * data; this class assembles them into a record (raw runs kept) and checks the
 * numerical safety, ledger closure and empty-space conditions. All physics
 * analysis and the classification are done by the pre-registered report
 * script (scripts/report-bl-separation.ts) from the raw runs, so the same
 * analysis applies to every execution group.
 */
export type BLSRole = 'attached-control' | 'deceleration' | 'variant';
export type BLSVariant = 'timestep' | 'height' | 'length' | 'resolution';

export interface BLSCase {
  key: string;
  /** execution group (a record file holds one or more groups) */
  group: string;
  role: BLSRole;
  /** what differs from the base configuration */
  overrides: Partial<WallFlowConfig>;
  seeds: number[];
  /** variants: the case they are compared with, and what is varied */
  reference?: string;
  variant?: BLSVariant;
  /** capture particle frames for animation on this seed */
  framesSeed?: number;
  /** frame window for this case (default: BLSParams.frames) */
  framesWindow?: NonNullable<WallFlowConfig['frames']>;
}

export interface BLSParams {
  base: WallFlowConfig;
  cases: BLSCase[];
  /** groups to run (undefined = all) */
  groups?: string[];
  /** frame window used when a case captures frames */
  frames: NonNullable<WallFlowConfig['frames']>;
}

interface Spec {
  caseIndex: number;
  seed: number;
}

export function caseConfig(p: BLSParams, c: BLSCase, seed?: number): WallFlowConfig {
  const cfg: WallFlowConfig = { ...p.base, ...c.overrides, label: c.key };
  if (seed !== undefined && c.framesSeed === seed) cfg.frames = c.framesWindow ?? p.frames;
  return cfg;
}

export class BoundaryLayerSeparationExperiment extends SequentialExperiment<Spec, WallFlowRunResult> {
  readonly type = 'boundary-layer-separation' as const;
  readonly params: BLSParams;

  constructor(p: BLSParams) {
    const specs: Spec[] = [];
    p.cases.forEach((c, k) => {
      if (p.groups && !p.groups.includes(c.group)) return;
      for (const seed of c.seeds) specs.push({ caseIndex: k, seed });
    });
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<WallFlowRunResult> {
    const c = this.params.cases[spec.caseIndex];
    return new WallFlowRun(caseConfig(this.params, c, spec.seed), spec.seed);
  }

  /** Relative cost of a run (particles × simulated time / timestep scale), for scheduling only. */
  specCost(i: number): number {
    const s = this.specs[i];
    const cfg = caseConfig(this.params, this.params.cases[s.caseIndex]);
    const g = wallFlowGeometry(cfg);
    const n = (cfg.areaFraction / (Math.PI * cfg.radius * cfg.radius)) * g.fluidArea;
    const courant = cfg.timestep.kind === 'adaptive' ? cfg.timestep.courant : 0.025;
    return (n * (cfg.startupTime + cfg.measurementTime)) / (courant * 2 * cfg.radius);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results;
    const checks: AcceptanceCheck[] = [];
    const halted = runs.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const maxE = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...runs.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger (kinetic, wall heat, fringe work) closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Momentum ledger (walls, ceiling, fringe impulse) closes', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));
    const empty = aggregateEmptySpace(runs.map((r) => r.emptySpace));
    checks.push(
      check(
        'no-empty-space',
        'No sustained near-zero-occupancy region',
        'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
        empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)})`,
        empty.flaggedRuns === 0,
      ),
    );
    const cases = p.cases.filter((c) => !p.groups || p.groups.includes(c.group));
    const base = p.base;
    const warnings: string[] = [];
    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`${r.label} seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    const seeds = [...new Set(runs.map((r) => r.seed))];
    return {
      ...recordHeader('boundary-layer-separation', 'Item 3: boundary layer and separation discovery (raw runs)', seeds.length ? seeds : [0]),
      particleCount: runs.length ? Math.round(runs.reduce((s, r) => s + r.particles, 0) / runs.length) : 0,
      particleScale: { radius: base.radius, diameter: 2 * base.radius, mass: base.mass },
      density: {
        numberDensity: base.areaFraction / (Math.PI * base.radius ** 2),
        massDensity: (base.mass * base.areaFraction) / (Math.PI * base.radius ** 2),
        areaFraction: base.areaFraction,
      },
      temperature: { kT: base.kT, definition: 'fringe and plate kT; local kT measured (A-03)' },
      speed: base.speed,
      geometry: 'periodic channel: fringe (inflow conditioning) → specular lead-in → diffuse flat plate in a specular floor; specular ceiling with optional smooth diffuser/contraction (A-19, A-20)',
      wallModel: 'segmented planar floor (Maxwell accommodation on the plate), specular ceiling plane and ceiling bodies',
      accommodation: Object.fromEntries(cases.map((c) => [c.key, c.overrides.accommodation ?? base.accommodation])),
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: base.timestep,
      domain: { xmin: 0, xmax: base.length, ymin: 0, ymax: base.heightIn * base.expansion, periodicX: true, periodicY: false },
      duration: { time: runs.reduce((s, r) => s + r.config.startupTime + r.config.measurementTime, 0), steps: runs.reduce((s, r) => s + r.steps, 0), collisionsPerParticle: Number.NaN },
      reynolds: { simulation: null, effective: null, physical: null, note: 'Computed by the report script from measured quantities (EXTERNAL COMPARISON only).' },
      mach: { Mp: null, benchmark: null, note: 'Computed by the report script (EXTERNAL COMPARISON only).' },
      results: {
        cases: cases.map((c) => ({ ...c, runs: runs.filter((r) => r.label === c.key).length })),
        emptySpace: empty,
        runs,
      },
      uncertainty: { note: 'Seed ensembles; computed by the report script.' },
      convergence: { status: 'NOT ASSESSED', note: 'Judged by the report script across groups.' },
      benchmarks: {},
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-08', 'A-19', 'A-20'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}

// ---------------------------------------------------------------- registered configuration (pre-registered; see the criteria document)

const seq = (from: number, n: number) => Array.from({ length: n }, (_, k) => from + k);

export const BLS_BASE: WallFlowConfig = {
  label: 'base',
  length: 560,
  heightIn: 70,
  expansion: 1,
  fringe: [0, 60],
  plate: [100, 500],
  diffuser: [180, 400],
  contraction: [500, 560],
  rampSegments: 16,
  areaFraction: 0.2,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  fringeRate: 0.5,
  fringeMixY: true,
  control: { interval: 2, gainP: 0.5, gainI: 0.02, exitRate: 0.02, freezeAverage: 300, freezeAt: 800 },
  accommodation: 1,
  wallKT: 1,
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  contact: 'rewind-to-contact',
  startupTime: 1000,
  measurementTime: 1200,
  sampleInterval: 1,
  blocks: 10,
  seriesInterval: 10,
  cellX: 10,
  nearWallHeight: 40,
  nearWallCellY: 1,
  outerCellY: 5,
  fineCellX: 5,
  fineCellY: 0.5,
  fineHeight: 10,
  blockCellY: 2,
  blockHeight: 40,
  wallBin: 5,
};

export const BLS_VALIDATION: BLSParams & { criteria: import('./BLSeparationReport').BLSCriteria } = {
  base: BLS_BASE,
  frames: { x0: 280, x1: 440, height: 24, count: 60, interval: 0.5 },
  cases: [
    { key: 'A1-r1', group: 'aw1', role: 'attached-control', overrides: { accommodation: 1, expansion: 1 }, seeds: seq(7001, 8), framesSeed: 7001 },
    { key: 'A1-r1.5', group: 'aw1', role: 'deceleration', overrides: { accommodation: 1, expansion: 1.5 }, seeds: seq(7001, 8) },
    { key: 'A1-r2', group: 'aw1', role: 'deceleration', overrides: { accommodation: 1, expansion: 2 }, seeds: seq(7001, 8) },
    { key: 'A1-r2.5', group: 'aw1', role: 'deceleration', overrides: { accommodation: 1, expansion: 2.5 }, seeds: seq(7001, 8), framesSeed: 7001 },
    { key: 'A05-r1', group: 'aw05', role: 'attached-control', overrides: { accommodation: 0.5, expansion: 1 }, seeds: seq(7101, 6) },
    { key: 'A05-r2', group: 'aw05', role: 'deceleration', overrides: { accommodation: 0.5, expansion: 2 }, seeds: seq(7101, 4) },
    { key: 'A05-r2.5', group: 'aw05', role: 'deceleration', overrides: { accommodation: 0.5, expansion: 2.5 }, seeds: seq(7101, 4) },
    { key: 'A0-r1', group: 'aw0', role: 'attached-control', overrides: { accommodation: 0, expansion: 1 }, seeds: seq(7201, 4) },
    { key: 'A0-r2.5', group: 'aw0', role: 'deceleration', overrides: { accommodation: 0, expansion: 2.5 }, seeds: seq(7201, 4) },
    {
      key: 'A1-rib',
      group: 'aw0',
      role: 'deceleration',
      overrides: { accommodation: 1, expansion: 1, rib: { x0: 200, x1: 220, height: 20, accommodation: 1 } },
      seeds: seq(7401, 4),
      framesSeed: 7401,
      framesWindow: { x0: 160, x1: 320, height: 30, count: 60, interval: 0.5 },
    },
    {
      key: 'A1-r2.5-dt',
      group: 'variants',
      role: 'variant',
      variant: 'timestep',
      reference: 'A1-r2.5',
      overrides: { accommodation: 1, expansion: 2.5, timestep: { kind: 'adaptive', courant: 0.0125, dtMax: 1, dtMin: 1e-7 } },
      seeds: seq(7301, 4),
    },
    {
      key: 'A1-r2.5-len',
      group: 'variants',
      role: 'variant',
      variant: 'length',
      reference: 'A1-r2.5',
      overrides: { accommodation: 1, expansion: 2.5, length: 660, plate: [100, 600], contraction: [600, 660] },
      seeds: seq(7301, 4),
    },
    {
      key: 'A1-r2.5-res',
      group: 'variants',
      role: 'variant',
      variant: 'resolution',
      reference: 'A1-r2.5',
      overrides: { accommodation: 1, expansion: 2.5, radius: 0.4 },
      seeds: seq(7301, 4),
    },
    {
      key: 'A1-r2.5-H',
      group: 'variants',
      role: 'variant',
      variant: 'height',
      reference: 'A1-r2.5',
      overrides: { accommodation: 1, expansion: 2.5, heightIn: 105, length: 750, diffuser: [180, 510], plate: [100, 660], contraction: [660, 750] },
      seeds: seq(7301, 4),
    },
    {
      key: 'A1-r1-H',
      group: 'variants',
      role: 'variant',
      variant: 'height',
      reference: 'A1-r1',
      overrides: { accommodation: 1, expansion: 1, heightIn: 105 },
      seeds: seq(7301, 4),
    },
  ],
  criteria: {
    observable: { coreFrom: 0.5, coreTo: 0.9, edge: 0.5, nearWallBand: 4, cellY: 2, cellX: 20 },
    stations: [150, 210, 310, 410],
    upstreamStation: 70,
    variantStation: 150,
    searchWindow: [120, 480],
    pressureUpstream: [140, 180],
    pressureDownstream: [420, 480],
    responseWindow: [280, 480],
    deficitStation: 470,
    tStructure: 5,
    tWall: 5,
    specularFraction: 0.2,
    upstreamTolerance: 0.05,
    splitZ: 3,
    alphaColumn: 0.005,
    minColumns: 2,
    alphaPersist: 0.025,
    blockFractionMin: 0.5,
    seedsNegativeFraction: 0.75,
    densityRatioMin: 0.5,
    tolerance: 0.15,
    responseTolerance: { uWall: 0.02, tauW: 0.002 },
    positiveWindow: [220, 400],
    keys: {
      attached: 'A1-r1',
      weak: 'A1-r1.5',
      moderate: 'A1-r2',
      strong: 'A1-r2.5',
      attachedAw05: 'A05-r1',
      seriesAw05: ['A05-r1', 'A05-r2', 'A05-r2.5'],
      specularAttached: 'A0-r1',
      specularStrong: 'A0-r2.5',
      positiveControl: 'A1-rib',
    },
  },
};
