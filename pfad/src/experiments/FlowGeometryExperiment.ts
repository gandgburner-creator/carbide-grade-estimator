import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { bodyPolygon, edgeOfSegment, flatPlate, junctionVertex, meanSpacing, place, placementAt, stationX, type Placement, type Side, type SurfaceGeometry } from '../geometry/SurfaceGeometry';
import { createGas } from '../gas/InitialConditions';
import { aggregateEmptySpace, EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { FieldAverager } from '../measurements/FieldAverager';
import { type FlowBlock, type SamplerSide, SurfaceFlowSampler } from '../measurements/SurfaceFlowSampler';
import { independentEstimate, type Estimate } from '../measurements/Statistics';
import { check, combineStatus } from '../validation/Status';
import type { ReservoirBoundaryConfig } from '../walls/ReservoirBoundary';
import { PolygonBody, type PolygonBodyConfig } from '../walls/SolidBody';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';
import { analyseSurfaceFlow, DETECTOR_SPEC, type DetectorSpec, type FlowData, type SurfaceFlowAnalysis } from '../measurements/SeparationDetector';
import { analyseWake, type WakeAnalysis } from '../measurements/WakeVoid';

/**
 * FLOW-GUIDED GEOMETRY (experimental).
 *
 * One body — a polygon built from a SurfaceGeometry (a flat plate to start with) —
 * sits in a gas that starts as a uniform stream U (impulsive start) with all four domain
 * sides open reservoirs, exactly the Kutta experiment's rig (A-18, A-19). The body is
 * rebuilt for every run, so a geometry is just an experiment parameter. Nothing about
 * circulation, separation or a trailing-edge condition is imposed.
 *
 * Measured over the window after the start-up period:
 *   - near-surface mean flow on both sides in normal strips (SurfaceFlowSampler)
 *   - wall momentum transfer per station (pressure, shear) and the force on the body
 *   - cell-averaged density, mean velocity and temperature fields
 *   - energy and momentum ledgers (including body impulse and open-boundary fluxes)
 * and analysed by the separation-region detector (SeparationDetector), whose criteria
 * are fixed in that module. The detector is an EXPERIMENTAL operational definition: it
 * is not validated, and PFAD has not validated any separation detector.
 */
/**
 * What a person typed in plain units (see PhysicalScenario.ts). Recorded with the run for
 * provenance only: the simulation reads none of it. The simulated values derived from it
 * (chord, thickness, speed, angle) are ordinary parameters below.
 */
export interface PhysicalInputs {
  /** plate length [cm] */
  lengthCm: number;
  /** plate thickness [cm]: the diameter of the leading round end */
  thicknessCm: number;
  /** diameter of the trailing round end [cm]; absent: the same as the thickness */
  trailingThicknessCm?: number;
  /** ambient air temperature [°C] */
  tempC: number;
  /** height above sea level [m] */
  altitudeM: number;
  /** wind speed relative to the plate [km/h] */
  speedKmh: number;
  /** angle of attack [°] */
  alphaDeg: number;
}

export interface FlowGeometryParams {
  geometry: SurfaceGeometry;
  /** the plain-unit description this setup was made from (provenance only; not read by the simulation) */
  scenario?: PhysicalInputs;
  alphaDeg: number;
  length: number;
  height: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  speed: number;
  accommodation: number;
  wallKT: number;
  seeds: number[];
  /** start-up before measuring (the impulsive start develops during it) */
  startup: number;
  /** measurement window */
  measure: number;
  sampleInterval: number;
  /** time blocks in the window (the unit of uncertainty and persistence) */
  blocks: number;
  /** surface-normal bin width and count (n from r to r + bins · width) */
  normalWidth: number;
  normalBins: number;
  /** cell size of the 2-D fields */
  cell: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  detector: DetectorSpec;
}

const BASE: Omit<FlowGeometryParams, 'geometry' | 'length' | 'height' | 'startup' | 'measure' | 'seeds' | 'cell'> = {
  alphaDeg: 65,
  areaFraction: 0.1,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  accommodation: 1,
  wallKT: 1,
  sampleInterval: 0.5,
  blocks: 16,
  normalWidth: 1,
  normalBins: 12,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  detector: DETECTOR_SPEC,
};

/** Reduced setup for looking in a browser (not for reported results). */
export const FLOW_GEOMETRY_QUICK: FlowGeometryParams = {
  ...BASE,
  geometry: flatPlate(30, 3),
  length: 180,
  height: 100,
  startup: 150,
  measure: 240,
  seeds: [301, 302, 303],
  cell: 3,
};

/**
 * More statistics at the same size: 6 seeds, twice the window. Near-wall backflow in this model is
 * weak (|u| of order 0.1 of the thermal speed), so the detector needs far more samples than a
 * quick look gives; this is roughly what a candidate region at the steepest angles needs.
 */
export const FLOW_GEOMETRY_EXTENDED: FlowGeometryParams = { ...FLOW_GEOMETRY_QUICK, measure: 480, seeds: [301, 302, 303, 304, 305, 306] };

/** Larger setup: the Kutta experiment's rig scaled to a chord of 60 d. */
export const FLOW_GEOMETRY_REFERENCE: FlowGeometryParams = {
  ...BASE,
  geometry: flatPlate(60, 4),
  length: 360,
  height: 200,
  startup: 250,
  measure: 400,
  seeds: [301, 302, 303, 304],
  cell: 4,
};

/** Where the body sits in the domain: the mid-chord at 1/3 of the length, mid-height. */
export function placementFor(p: Pick<FlowGeometryParams, 'geometry' | 'length' | 'height' | 'alphaDeg'>): Placement {
  return placementAt(p.geometry, p.length / 3, p.height / 2, p.alphaDeg);
}

/** Sampler sides (simulation frame) for a geometry and placement. */
export function samplerSidesFor(g: SurfaceGeometry, pl: Placement): SamplerSide[] {
  const n = g.stations;
  const xs = stationX(g);
  return (['upper', 'lower'] as const).map((side: Side) => {
    const y = side === 'upper' ? g.upper : g.lower;
    const body = xs.flatMap((x, i) => [x, y[i]]);
    return {
      side,
      points: place(body, pl),
      outward: side === 'upper' ? 1 : -1,
      edges: Array.from({ length: n }, (_, k) => edgeOfSegment(g, side, k)),
      junctions: Array.from({ length: n - 1 }, (_, k) => junctionVertex(g, side, k)),
    };
  });
}

export interface FlowRunResult {
  seed: number;
  blocks: FlowBlock[];
  measureTime: number;
  /** body impulse per block: force x, force y, moment about the quarter chord */
  forces: { fx: number[]; fy: number[]; moment: number[] };
  field: { nx: number; ny: number; cell: number; ux: number[]; uy: number[]; density: number[]; kT: number[]; occupancy: number[] };
  particles: number;
  conservation: ReturnType<ConservationMonitor['summary']>;
  emptySpace: EmptySpaceSummary;
  insideDetections: number;
  lateContacts: number;
  safetyFlags: SafetyFlag[];
  halted: boolean;
}

interface Spec {
  seed: number;
}

export function bodyConfigFor(p: FlowGeometryParams): PolygonBodyConfig {
  const pl = placementFor(p);
  const vertices = place(bodyPolygon(p.geometry), pl);
  const a = (p.alphaDeg * Math.PI) / 180;
  return {
    name: `flow-guided body α=${p.alphaDeg}°`,
    vertices,
    accommodation: p.accommodation,
    temperature: p.wallKT,
    // one measurement bin per edge (edges are about one station long)
    binLength: 1.5 * meanSpacing(p.geometry),
    momentOrigin: { x: pl.x + 0.25 * p.geometry.chord * Math.cos(a), y: pl.y - 0.25 * p.geometry.chord * Math.sin(a) },
  };
}

/** The simulation of one body version in an open-boundary stream (shared by the measurement run and the live-construction run). */
export function makeSimulation(p: FlowGeometryParams, seed: number): Simulation {
  const bodyConfig = bodyConfigFor(p);
  const probe = new PolygonBody(bodyConfig);
  const domain: DomainSpec = { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false };
  const n0 = p.areaFraction / (Math.PI * p.radius * p.radius);
  const N0 = Math.round(n0 * p.length * p.height);
  const { store } = createGas({
    count: N0,
    radius: p.radius,
    mass: p.mass,
    kT: p.kT,
    distribution: 'maxwell',
    seed,
    domain,
    flow: { x: p.speed, y: 0 },
    extraCapacity: N0,
    exclude: (x, y, r) => probe.closest(x, y).d < r,
  });
  const res = { numberDensity: n0, kT: p.kT, mass: p.mass, radius: p.radius, velocity: { x: p.speed, y: 0 } };
  const boundaries: ReservoirBoundaryConfig[] = (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, ...res }));
  return new Simulation(
    {
      domain,
      walls: [],
      boundaries,
      bodies: [bodyConfig],
      collision: { enabled: true, restitution: 1, contact: p.contact, dissipationTarget: 'external' },
      timestep: p.timestep,
      seed,
      referenceKT: p.kT,
    },
    store,
  );
}

class FlowGeometryRun implements Run<FlowRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: FlowGeometryParams;
  private readonly seed: number;
  private readonly body: PolygonBody;
  private readonly sampler: SurfaceFlowSampler;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private readonly field: FieldAverager;
  private nextEmpty = 0;
  private measuring = false;
  private t0 = 0;
  private nextSample = 0;
  private nextBlock = 0;
  private readonly blockTime: number;
  private blockImpulse = { x: 0, y: 0, m: 0 };
  private readonly forces = { fx: [] as number[], fy: [] as number[], moment: [] as number[] };

  constructor(p: FlowGeometryParams, seed: number) {
    this.p = p;
    this.seed = seed;
    this.label = `flow-guided geometry, α = ${p.alphaDeg}°, seed ${seed}`;
    this.sim = makeSimulation(p, seed);
    this.body = this.sim.bodies[0];
    this.sampler = new SurfaceFlowSampler(this.body, samplerSidesFor(p.geometry, placementFor(p)), { radius: p.radius, normalWidth: p.normalWidth, normalBins: p.normalBins }, 0);
    this.conservation = new ConservationMonitor(this.sim);
    const body = this.body;
    this.empty = new EmptySpaceMonitor(this.sim, 40, 0.1, 5, (x0, y0, x1, y1) => x1 > body.xmin - 1 && x0 < body.xmax + 1 && y1 > body.ymin - 1 && y0 < body.ymax + 1);
    this.field = new FieldAverager(this.sim.domain, Math.round(p.length / p.cell), Math.round(p.height / p.cell));
    this.blockTime = p.measure / p.blocks;
  }

  advance(maxSteps: number): number {
    const p = this.p;
    let k = 0;
    while (k < maxSteps && !this.done) {
      if (!this.sim.step()) {
        this.done = true;
        break;
      }
      k++;
      const t = this.sim.time;
      if (t >= this.nextEmpty) {
        this.empty.sample();
        this.nextEmpty += 10;
      }
      if (!this.measuring && t >= p.startup) {
        // the measurement window starts on a step boundary; tallies are differenced from here
        this.measuring = true;
        this.t0 = t;
        this.nextSample = t;
        this.nextBlock = t + this.blockTime;
        this.blockImpulse = { x: this.body.impulseX, y: this.body.impulseY, m: this.body.moment };
        this.sampler.restart(t);
        this.conservation.sample();
      }
      if (this.measuring) {
        if (t >= this.nextSample) {
          this.sampler.sample(this.sim.store);
          this.field.add(this.sim.store);
          this.nextSample += p.sampleInterval;
        }
        if (t >= this.nextBlock && this.sampler.blocks.length < p.blocks) {
          const T = t - (this.sampler.currentStart());
          this.sampler.closeBlock(t);
          this.forces.fx.push((this.body.impulseX - this.blockImpulse.x) / T);
          this.forces.fy.push((this.body.impulseY - this.blockImpulse.y) / T);
          this.forces.moment.push((this.body.moment - this.blockImpulse.m) / T);
          this.blockImpulse = { x: this.body.impulseX, y: this.body.impulseY, m: this.body.moment };
          this.nextBlock += this.blockTime;
        }
        if (this.sampler.blocks.length >= p.blocks) this.done = true;
      }
    }
    return k;
  }

  progress() {
    const T = this.p.startup + this.p.measure;
    return Math.min(1, this.sim.time / T);
  }

  live() {
    const last = this.sampler.blocks[this.sampler.blocks.length - 1];
    return {
      phase: this.measuring ? 'measuring' : 'start-up',
      time: this.sim.time,
      particles: this.sim.store.count,
      blocks: `${this.sampler.blocks.length}/${this.p.blocks}`,
      forceX: this.forces.fx.length ? this.forces.fx[this.forces.fx.length - 1] : Number.NaN,
      forceY: this.forces.fy.length ? this.forces.fy[this.forces.fy.length - 1] : Number.NaN,
      energyError: this.sim.relativeEnergyResidual(),
      ...(last ? {} : {}),
    };
  }

  result(): FlowRunResult {
    this.sim.checkSafety();
    this.conservation.sample();
    const f = this.field;
    return {
      seed: this.seed,
      blocks: this.sampler.blocks,
      measureTime: this.sim.time - this.t0,
      forces: this.forces,
      field: {
        nx: f.nx,
        ny: f.ny,
        cell: this.p.cell,
        ux: Array.from(f.field('ux')),
        uy: Array.from(f.field('uy')),
        density: Array.from(f.field('density')),
        kT: Array.from(f.field('kT')),
        occupancy: Array.from(f.field('occupancy')),
      },
      particles: this.sim.store.count,
      conservation: this.conservation.summary(),
      emptySpace: this.empty.summary(),
      insideDetections: this.body.insideDetections,
      lateContacts: this.body.lateContacts,
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
    };
  }
}

/** Detector input from finished runs: both sides, every seed's blocks. */
export function flowDataOf(p: FlowGeometryParams, runs: FlowRunResult[]): FlowData {
  const g = p.geometry;
  const n = g.stations;
  const pl = placementFor(p);
  const sides = samplerSidesFor(g, pl);
  const seg = (side: Side) => {
    const pts = sides.find((s) => s.side === side)!.points;
    return Array.from({ length: n }, (_, k) => Math.hypot(pts[2 * k + 2] - pts[2 * k], pts[2 * k + 3] - pts[2 * k + 1]));
  };
  // the imposed stream U = (speed, 0) in the simulation frame: leeward where it moves away from the surface
  const reference = {} as NonNullable<FlowData['reference']>;
  for (const sd of sides) {
    const leeward: boolean[] = [];
    const streamAlong: number[] = [];
    for (let k = 0; k < n; k++) {
      const dx = sd.points[2 * k + 2] - sd.points[2 * k];
      const dy = sd.points[2 * k + 3] - sd.points[2 * k + 1];
      const L = Math.hypot(dx, dy);
      const tx = dx / L;
      const ty = dy / L;
      const nx = -ty * sd.outward;
      streamAlong.push(p.speed * tx);
      leeward.push(p.speed * nx > 0);
    }
    reference[sd.side] = { leeward, streamAlong };
  }
  return {
    reference,
    radius: p.radius,
    normalWidth: p.normalWidth,
    normalBins: p.normalBins,
    xs: stationX(g).slice(0, n).map((x, k) => 0.5 * (x + stationX(g)[k + 1])),
    lengths: { upper: seg('upper'), lower: seg('lower') },
    runs: runs.map((r) => ({ seed: r.seed, blocks: r.blocks })),
    ambientDensity: p.areaFraction / (Math.PI * p.radius * p.radius),
  };
}

export interface FlowGeometryResults {
  kind: 'flow-geometry';
  detector: string;
  geometry: SurfaceGeometry;
  placement: Placement;
  alphaDeg: number;
  regime: { numberDensity: number; meanFreePath: number; knudsenChord: number; speed: number; note: string };
  surfaceFlow: Record<Side, SurfaceFlowAnalysis> | null;
  /** do the particles touch the surface? (WakeVoid.ts; experimental) */
  wake?: Record<Side, WakeAnalysis> | null;
  forces: { fx: Estimate; fy: Estimate; moment: Estimate; note: string };
  fields: { nx: number; ny: number; cell: number; ux: number[]; uy: number[]; density: number[]; kT: number[]; occupancy: number[] } | null;
  perSeed: { seed: number; particles: number; halted: boolean; forceX: number; forceY: number }[];
}

export class FlowGeometryExperiment extends SequentialExperiment<Spec, FlowRunResult> {
  readonly type = 'flow-geometry' as const;
  readonly params: FlowGeometryParams;

  constructor(p: FlowGeometryParams) {
    if (p.blocks < 4) throw new Error('at least 4 blocks');
    if (p.seeds.length === 0) throw new Error('at least one seed');
    super(p.seeds.map((seed) => ({ seed })));
    this.params = p;
  }

  protected createRun(spec: Spec): Run<FlowRunResult> {
    return new FlowGeometryRun(this.params, spec.seed);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results.filter((r) => !r.halted && r.blocks.length >= 4);
    const checks = [];
    const warnings: string[] = [
      'STATUS reflects the numerical-integrity checks of these runs only. It says nothing about whether the detector’s finding is real: the detector is experimental and unvalidated.',
    ];
    const halted = this.results.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const inside = this.results.reduce((a, r) => a + r.insideDetections, 0);
    checks.push(check('no-penetration', 'No particle centre ever inside the body', '0 detections', `${inside}`, inside === 0));
    const maxE = Math.max(...this.results.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...this.results.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger incl. body and open-boundary fluxes closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Momentum ledger incl. body impulse and open-boundary fluxes closes', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));
    const empty = aggregateEmptySpace(this.results.map((r) => r.emptySpace));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag', empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));
    const late = this.results.reduce((a, r) => a + r.lateContacts, 0);
    if (late > 0) warnings.push(`${late} body contacts were already overlapping at the start of their step (placed at the step start).`);
    for (const r of this.results) for (const f of r.safetyFlags) warnings.push(`seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    const g = p.geometry;
    const pl = placementFor(p);
    const n0 = p.areaFraction / (Math.PI * p.radius * p.radius);
    // kinetic-theory estimate for 2-D hard disks (an ESTIMATE, not measured): λ = 1 / (√2 n d)
    const lambda = 1 / (Math.SQRT2 * n0 * 2 * p.radius);
    let surfaceFlow: Record<Side, SurfaceFlowAnalysis> | null = null;
    let wake: Record<Side, WakeAnalysis> | null = null;
    let forces: FlowGeometryResults['forces'];
    let fields: FlowGeometryResults['fields'] = null;
    if (runs.length > 0) {
      const data = flowDataOf(p, runs);
      surfaceFlow = { upper: analyseSurfaceFlow(data, 'upper', p.detector), lower: analyseSurfaceFlow(data, 'lower', p.detector) };
      const wu = analyseWake(data, 'upper');
      const wl = analyseWake(data, 'lower');
      wake = wu && wl ? { upper: wu, lower: wl } : null;
      const pool = (pick: (r: FlowRunResult) => number[]) => independentEstimate(runs.flatMap(pick), 'block-average');
      forces = {
        fx: pool((r) => r.forces.fx),
        fy: pool((r) => r.forces.fy),
        moment: pool((r) => r.forces.moment),
        note: 'impulse delivered to the body per unit time, pooled over time blocks of all seeds (block independence assumed): raw momentum-transfer rates in the simulation frame, not coefficients',
      };
      const f0 = runs[0].field;
      const avg = (pick: (r: FlowRunResult) => number[]) => pick(runs[0]).map((_, i) => runs.reduce((a, r) => a + pick(r)[i], 0) / runs.length);
      fields = { nx: f0.nx, ny: f0.ny, cell: f0.cell, ux: avg((r) => r.field.ux), uy: avg((r) => r.field.uy), density: avg((r) => r.field.density), kT: avg((r) => r.field.kT), occupancy: avg((r) => r.field.occupancy) };
    } else {
      forces = { fx: independentEstimate([]), fy: independentEstimate([]), moment: independentEstimate([]), note: 'no run completed' };
      warnings.push('No run completed: there is no measurement to analyse.');
    }
    const results: FlowGeometryResults = {
      kind: 'flow-geometry',
      detector: p.detector.id,
      geometry: g,
      placement: pl,
      alphaDeg: p.alphaDeg,
      regime: {
        numberDensity: n0,
        meanFreePath: lambda,
        knudsenChord: lambda / g.chord,
        speed: p.speed,
        note: 'Kinetic-theory ESTIMATES (λ = 1/(√2 n d), 2-D hard disks; Enskog corrections ignored), not measured. The flow is in the slip/transitional regime, not a continuum boundary layer.',
      },
      surfaceFlow,
      wake,
      forces,
      fields,
      perSeed: this.results.map((r) => ({ seed: r.seed, particles: r.particles, halted: r.halted, forceX: r.forces.fx.length ? r.forces.fx.reduce((a, b) => a + b, 0) / r.forces.fx.length : Number.NaN, forceY: r.forces.fy.length ? r.forces.fy.reduce((a, b) => a + b, 0) / r.forces.fy.length : Number.NaN })),
    };
    return {
      ...recordHeader('flow-geometry', 'Flow-guided geometry: near-surface flow of one body version', p.seeds),
      particleCount: this.results[0]?.particles ?? 0,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: n0, massDensity: n0 * p.mass, areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: 'reservoir and wall temperature kT; the near-wall kT in the results is the peculiar kinetic energy per particle (A-03)' },
      speed: p.speed,
      geometry: `polygon body (chord ${g.chord} d, ${g.stations} stations per side) at α = ${p.alphaDeg}° in an open-boundary stream, domain ${p.length} × ${p.height} d`,
      wallModel: `diffuse Maxwell faces, Aw = ${p.accommodation}, wall kT = ${p.wallKT}`,
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'none',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: p.startup + p.measure, steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: { simulation: null, effective: null, physical: null, note: 'not measured in this experiment (no viscosity measurement); see the Kutta reference for the same density and speed' },
      mach: { Mp: null, benchmark: null, note: 'not measured in this experiment; the Kutta reference at this density and speed reported Mp ≈ 0.55' },
      results: results as unknown as Record<string, unknown>,
      uncertainty: { method: 'standard errors from the spread of time blocks pooled over seeds (batch means; block independence assumed, not tested)', blocks: p.blocks, seeds: p.seeds.length },
      convergence: { status: 'NOT ASSESSED', note: 'no timestep, size or particle-scale study within one run: compare versions run at different particle scales' },
      benchmarks: {},
      assumptions: [
        'A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-18', 'A-19',
        'The body is a polygon of straight edges; a curved surface is a polyline whose smoothness is limited by its stations.',
        'The flow is taken as statistically stationary after the start-up period; the mean mass flux is then divergence-free and a stream function exists.',
        `The detector ${p.detector.id} is an operational definition and has not been validated against any independent separation criterion.`,
      ],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: this.results.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
