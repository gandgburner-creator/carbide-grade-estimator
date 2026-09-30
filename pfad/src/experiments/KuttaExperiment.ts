import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import { aggregateEmptySpace, EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { FieldAverager } from '../measurements/FieldAverager';
import { ensembleEstimate, linearRegression, mean } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import type { ReservoirBoundaryConfig } from '../walls/ReservoirBoundary';
import { PolygonBody, type PolygonBodyConfig } from '../walls/SolidBody';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';


/** time between no-empty-space samples (Master prompt §20) */
const EMPTY_SPACE_INTERVAL = 10;
/**
 * KUTTA DISCOVERY (Master prompt §19, Bible §18).
 *
 * A fixed body with a sharp trailing edge sits in a gas that starts, at t = 0,
 * as a uniform stream U everywhere (impulsive start). All four domain sides are
 * open reservoirs with the same stream (A-18). NOTHING about circulation, the
 * Kutta condition or trailing-edge velocities is imposed: the body is a
 * polygon of Maxwell-accommodating faces (A-19) and the gas is hard disks.
 *
 * Measured (per time window, then averaged over seeds at equal times):
 *   lift L and drag D     — components of the impulse delivered to the body
 *   circulation Γ_body    — ∮ u·dl of the window-averaged particle velocity
 *                           field on a rectangle around the body (counter-
 *                           clockwise positive); Γ_domain on a rectangle just
 *                           inside the domain; Γ in downstream wake slabs
 *   starting vortex       — the time at which each wake slab's circulation
 *                           peaks, hence its convection speed
 *   trailing-edge departure — mean velocity of the gas in a half-disk fan
 *                           behind the trailing edge: its angle to the
 *                           trailing-edge bisector and cross-bisector velocity
 *   tail velocities       — near-wall velocity along each surface in the
 *                           surface bin next to the trailing edge
 *   surface attachment    — near-wall tangential velocity along both surfaces
 *                           (late window): reversed-flow regions
 *   surface pressure      — normal impulse per bin (late window)
 *   wake                  — late-window velocity deficit and momentum-deficit
 *                           drag at stations behind the body
 *   vortex shedding       — periodogram of the late lift series (Fisher g test)
 *
 * The determination criteria are fixed here, before any reference run:
 *   departure along the bisector: |angle| ≤ half wedge angle + 15°
 *   flow around the edge: the fan's cross-bisector velocity is significant
 *     (> 3 SE) and points to a side whose tail flow runs AWAY from the edge
 *     (u_s + 2 SE < 0 in its trailing bin)
 *   lift significant: |L| > 3 SE (seed ensemble of late-window means)
 * A classical Kutta/thin-airfoil value is shown only in `benchmarks`, after the
 * measurement, and is never used by the run or the determination.
 */
export type KuttaShape = 'rhombus' | 'wedge' | 'rectangle';

export interface KuttaCase {
  label: string;
  shape: KuttaShape;
  alphaDeg: number;
}

export interface KuttaParams {
  length: number;
  height: number;
  chord: number;
  thickness: number;
  /** leading-edge x position; the mid-chord sits at mid-height */
  leadingEdgeX: number;
  cases: KuttaCase[];
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  speed: number;
  accommodation: number;
  wallKT: number;
  seeds: number[];
  duration: number;
  /** late (developed) window starts here */
  lateFrom: number;
  window: number;
  sampleInterval: number;
  /** grid for circulation contours and fields */
  cell: number;
  /** contour margin around the body bounding box */
  contourMargin: number;
  wakeSlabs: number;
  /** near-surface band thickness and surface bin length */
  band: number;
  surfaceBin: number;
  /** trailing-edge fan radius */
  fanRadius: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  viscosity: null | { value: number; se: number; source: string };
  soundSpeed: null | { value: number; se: number; source: string };
}

export const KUTTA_REFERENCE: KuttaParams = {
  length: 360,
  height: 200,
  chord: 60,
  thickness: 5,
  leadingEdgeX: 100,
  cases: [
    { label: 'sharp TE (rhombus), α = 0° — symmetry control', shape: 'rhombus', alphaDeg: 0 },
    { label: 'sharp TE (rhombus), α = 8°', shape: 'rhombus', alphaDeg: 8 },
    { label: 'blunt TE (rectangle), α = 8°', shape: 'rectangle', alphaDeg: 8 },
  ],
  areaFraction: 0.1,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  accommodation: 1,
  wallKT: 1,
  seeds: [201, 202, 203, 204],
  duration: 500,
  lateFrom: 300,
  window: 5,
  sampleInterval: 0.5,
  cell: 4,
  contourMargin: 16,
  wakeSlabs: 4,
  band: 2,
  surfaceBin: 3,
  fanRadius: 6,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  viscosity: null,
  soundSpeed: null,
};

/** Body geometry for a case: vertices (CCW), trailing-edge point, chord and bisector directions. */
export function kuttaBody(p: Pick<KuttaParams, 'chord' | 'thickness' | 'leadingEdgeX' | 'height'>, c: KuttaCase) {
  const C = p.chord;
  const t = p.thickness;
  let local: [number, number][];
  switch (c.shape) {
    case 'rhombus':
      local = [[0, 0], [C / 2, -t / 2], [C, 0], [C / 2, t / 2]];
      break;
    case 'wedge':
      local = [[0, -t / 2], [C, 0], [0, t / 2]];
      break;
    case 'rectangle':
      local = [[0, -t / 2], [C, -t / 2], [C, t / 2], [0, t / 2]];
      break;
  }
  const a = (-c.alphaDeg * Math.PI) / 180; // nose up for positive α (flow along +x)
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const x0 = p.leadingEdgeX;
  const y0 = p.height / 2 + (C / 2) * Math.sin((c.alphaDeg * Math.PI) / 180); // mid-chord at mid-height
  const place = ([u, v]: [number, number]) => [x0 + u * ca - v * sa, y0 + u * sa + v * ca] as [number, number];
  const vertices = local.flatMap((q) => place(q));
  const te = place([C, 0]);
  const le = place([0, 0]);
  const chordDir = { x: ca, y: sa };
  const halfWedgeDeg = c.shape === 'rectangle' ? 90 : c.shape === 'rhombus' ? (Math.atan(t / C) * 180) / Math.PI : (Math.atan(t / 2 / C) * 180) / Math.PI;
  return { vertices, te: { x: te[0], y: te[1] }, le: { x: le[0], y: le[1] }, chordDir, halfWedgeDeg };
}

interface Spec {
  caseIndex: number;
  seed: number;
}

interface WindowRow {
  t: number;
  /** window belongs to the late (developed) period */
  late: boolean;
  lift: number;
  drag: number;
  gammaBody: number;
  gammaDomain: number;
  gammaSlabs: number[];
  fan: { ux: number; uy: number; mass: number };
  tailUpper: { us: number; mass: number };
  tailLower: { us: number; mass: number };
}

interface KuttaRunResult {
  caseIndex: number;
  seed: number;
  windows: WindowRow[];
  late: {
    time: number;
    lift: number;
    drag: number;
    moment: number;
    /** per surface bin: near-wall velocity along the edge (a→b), mass sampled */
    bandU: number[];
    bandMass: number[];
    /** per surface bin: pressure (normal impulse / (time · bin length)) */
    pressure: number[];
    shear: number[];
    fan: { ux: number; uy: number; mass: number };
    nx: number;
    ny: number;
    ux: number[];
    uy: number[];
    density: number[];
    occupancy: { min: number; max: number; mean: number };
  };
  lateLiftSeries: number[];
  conservation: ReturnType<ConservationMonitor['summary']>;
  emptySpace: EmptySpaceSummary;
  insideDetections: number;
  lateContacts: number;
  safetyFlags: SafetyFlag[];
  halted: boolean;
}

/** Counter-clockwise circulation on the rectangle through cell centres [i0,i1]×[j0,j1] (trapezoid rule). */
export function contourCirculation(ux: ArrayLike<number>, uy: ArrayLike<number>, nx: number, cw: number, ch: number, i0: number, i1: number, j0: number, j1: number): number {
  const U = (i: number, j: number) => ux[j * nx + i];
  const V = (i: number, j: number) => uy[j * nx + i];
  let g = 0;
  for (let i = i0; i < i1; i++) g += 0.5 * (U(i, j0) + U(i + 1, j0)) * cw; // bottom, +x
  for (let j = j0; j < j1; j++) g += 0.5 * (V(i1, j) + V(i1, j + 1)) * ch; // right, +y
  for (let i = i1; i > i0; i--) g -= 0.5 * (U(i, j1) + U(i - 1, j1)) * cw; // top, −x
  for (let j = j1; j > j0; j--) g -= 0.5 * (V(i0, j) + V(i0, j - 1)) * ch; // left, −y
  return g;
}

/** Fisher's g test for a periodic component: p-value for the largest periodogram ordinate. */
export function fisherG(series: number[]): { g: number; p: number; peakFrequency: number } {
  const n = series.length;
  const m = mean(series);
  const K = Math.floor((n - 1) / 2);
  if (K < 2) return { g: Number.NaN, p: Number.NaN, peakFrequency: Number.NaN };
  const I: number[] = [];
  for (let k = 1; k <= K; k++) {
    let re = 0;
    let im = 0;
    for (let s = 0; s < n; s++) {
      re += (series[s] - m) * Math.cos((2 * Math.PI * k * s) / n);
      im += (series[s] - m) * Math.sin((2 * Math.PI * k * s) / n);
    }
    I.push(re * re + im * im);
  }
  const tot = I.reduce((a, b) => a + b, 0);
  let kmax = 0;
  for (let k = 1; k < K; k++) if (I[k] > I[kmax]) kmax = k;
  const g = tot > 0 ? I[kmax] / tot : 0;
  // P(g > x) ≈ K (1 − x)^(K−1) (first term; accurate for small p)
  const p = Math.min(1, K * Math.pow(1 - g, K - 1));
  return { g, p, peakFrequency: (kmax + 1) / n };
}

type Side = 'upper' | 'lower' | 'face';

/** Classify each edge relative to the chord: lower (a→b runs downstream), upper (runs upstream), face. */
function edgeSides(body: PolygonBody, chordDir: { x: number; y: number }): Side[] {
  return body.edges.map((e) => {
    const d = e.tx * chordDir.x + e.ty * chordDir.y;
    return d > 0.5 ? 'lower' : d < -0.5 ? 'upper' : 'face';
  });
}

/** Surface bins next to the trailing edge: last bin of the most downstream lower edge, first bin of the most downstream upper edge. */
function tailBins(body: PolygonBody, sides: Side[], le: { x: number; y: number }, chordDir: { x: number; y: number }) {
  const proj = (x: number, y: number) => (x - le.x) * chordDir.x + (y - le.y) * chordDir.y;
  let lower = -1;
  let upper = -1;
  let bestL = -Infinity;
  let bestU = -Infinity;
  body.edges.forEach((e, k) => {
    if (sides[k] === 'lower' && proj(e.bx, e.by) > bestL) {
      bestL = proj(e.bx, e.by);
      lower = e.binOffset + e.bins - 1;
    }
    if (sides[k] === 'upper' && proj(e.ax, e.ay) > bestU) {
      bestU = proj(e.ax, e.ay);
      upper = e.binOffset;
    }
  });
  return { lower, upper };
}

class KuttaRun implements Run<KuttaRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: KuttaParams;
  private readonly spec: Spec;
  private readonly body: PolygonBody;
  private readonly geom: ReturnType<typeof kuttaBody>;
  private readonly sides: Side[];
  private readonly tails: { lower: number; upper: number };
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private nextEmpty = 0;
  private readonly nxCells: number;
  private readonly nyCells: number;
  private readonly contour: { i0: number; i1: number; j0: number; j1: number };
  private readonly domainContour: { i0: number; i1: number; j0: number; j1: number };
  private readonly slabs: { i0: number; i1: number; j0: number; j1: number }[];
  // current window
  private winField: FieldAverager;
  private winStart = 0;
  private winImpulse = { x: 0, y: 0 };
  private winFan = { ux: 0, uy: 0, mass: 0 };
  private winTail = { upper: { p: 0, m: 0 }, lower: { p: 0, m: 0 } };
  private readonly windows: WindowRow[] = [];
  // late window
  private lateStarted = false;
  private lateT0 = 0;
  private lateImpulse0 = { x: 0, y: 0, moment: 0 };
  private lateNormal0: Float64Array | null = null;
  private lateTangential0: Float64Array | null = null;
  private readonly lateField: FieldAverager;
  private readonly bandU: Float64Array;
  private readonly bandMass: Float64Array;
  private readonly lateFan = { ux: 0, uy: 0, mass: 0 };
  private readonly lateLift: number[] = [];
  private nextSample = 0;

  constructor(p: KuttaParams, spec: Spec) {
    this.p = p;
    this.spec = spec;
    const c = p.cases[spec.caseIndex];
    this.label = `kutta ${c.label} seed=${spec.seed}`;
    this.geom = kuttaBody(p, c);
    const bodyConfig: PolygonBodyConfig = {
      name: `${c.shape} α=${c.alphaDeg}°`,
      vertices: this.geom.vertices,
      accommodation: p.accommodation,
      temperature: p.wallKT,
      binLength: p.surfaceBin,
      momentOrigin: { x: this.geom.le.x + 0.25 * p.chord * this.geom.chordDir.x, y: this.geom.le.y + 0.25 * p.chord * this.geom.chordDir.y },
    };
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
      seed: spec.seed,
      domain,
      flow: { x: p.speed, y: 0 },
      extraCapacity: N0,
      exclude: (x, y, r) => probe.closest(x, y).d < r,
    });
    const res = { numberDensity: n0, kT: p.kT, mass: p.mass, radius: p.radius, velocity: { x: p.speed, y: 0 } };
    const boundaries: ReservoirBoundaryConfig[] = (['left', 'right', 'bottom', 'top'] as const).map((side) => ({ side, ...res }));
    this.sim = new Simulation(
      {
        domain,
        walls: [],
        boundaries,
        bodies: [bodyConfig],
        collision: { enabled: true, restitution: 1, contact: p.contact, dissipationTarget: 'external' },
        timestep: p.timestep,
        seed: spec.seed,
        referenceKT: p.kT,
      },
      store,
    );
    this.body = this.sim.bodies[0];
    this.sides = edgeSides(this.body, this.geom.chordDir);
    this.tails = tailBins(this.body, this.sides, this.geom.le, this.geom.chordDir);
    this.conservation = new ConservationMonitor(this.sim);
    // cells the body touches are geometry, not empty space
    const body = this.sim.bodies[0];
    this.empty = new EmptySpaceMonitor(this.sim, 40, 0.1, 5, (x0, y0, x1, y1) => x1 > body.xmin - 1 && x0 < body.xmax + 1 && y1 > body.ymin - 1 && y0 < body.ymax + 1);
    this.nxCells = Math.round(p.length / p.cell);
    this.nyCells = Math.round(p.height / p.cell);
    this.winField = new FieldAverager(this.sim.domain, this.nxCells, this.nyCells);
    this.lateField = new FieldAverager(this.sim.domain, this.nxCells, this.nyCells);
    const cw = p.length / this.nxCells;
    const ch = p.height / this.nyCells;
    const ci = (x: number) => Math.min(this.nxCells - 1, Math.max(0, Math.round(x / cw - 0.5)));
    const cj = (y: number) => Math.min(this.nyCells - 1, Math.max(0, Math.round(y / ch - 0.5)));
    const m = p.contourMargin;
    this.contour = { i0: ci(this.body.xmin - m), i1: ci(this.body.xmax + m), j0: cj(this.body.ymin - m), j1: cj(this.body.ymax + m) };
    this.domainContour = { i0: ci(m), i1: ci(p.length - m), j0: cj(m), j1: cj(p.height - m) };
    const wx0 = this.contour.i1;
    const wx1 = this.domainContour.i1;
    const K = Math.max(1, p.wakeSlabs);
    this.slabs = Array.from({ length: K }, (_, k) => ({
      i0: wx0 + Math.round(((wx1 - wx0) * k) / K),
      i1: wx0 + Math.round(((wx1 - wx0) * (k + 1)) / K),
      j0: this.domainContour.j0,
      j1: this.domainContour.j1,
    }));
    this.bandU = new Float64Array(this.body.totalBins);
    this.bandMass = new Float64Array(this.body.totalBins);
  }

  /** Near-body sampling: surface band velocities and the trailing-edge fan. */
  private sampleNearBody(late: boolean) {
    const s = this.sim.store;
    const b = this.body;
    const p = this.p;
    const reach = Math.max(p.band, p.fanRadius) + 1;
    const te = this.geom.te;
    const cd = this.geom.chordDir;
    for (let i = 0; i < s.count; i++) {
      const x = s.x[i];
      const y = s.y[i];
      if (x < b.xmin - reach || x > b.xmax + reach || y < b.ymin - reach || y > b.ymax + reach) continue;
      const m = s.mass[i];
      // trailing-edge fan: half-disk behind the trailing edge
      const dx = x - te.x;
      const dy = y - te.y;
      if (dx * dx + dy * dy <= p.fanRadius * p.fanRadius && dx * cd.x + dy * cd.y > 0) {
        this.winFan.ux += m * s.vx[i];
        this.winFan.uy += m * s.vy[i];
        this.winFan.mass += m;
        if (late) {
          this.lateFan.ux += m * s.vx[i];
          this.lateFan.uy += m * s.vy[i];
          this.lateFan.mass += m;
        }
      }
      const c = b.closest(x, y);
      if (c.vertex >= 0 || c.d < 0 || c.d > p.band) continue;
      const e = b.edges[c.edge];
      let k = Math.floor((c.s / e.length) * e.bins);
      if (k >= e.bins) k = e.bins - 1;
      const bin = e.binOffset + k;
      const ut = s.vx[i] * e.tx + s.vy[i] * e.ty;
      if (late) {
        this.bandU[bin] += m * ut;
        this.bandMass[bin] += m;
      }
      if (bin === this.tails.upper) {
        this.winTail.upper.p += -m * ut; // upper edges run a→b upstream: downstream = −t
        this.winTail.upper.m += m;
      } else if (bin === this.tails.lower) {
        this.winTail.lower.p += m * ut;
        this.winTail.lower.m += m;
      }
    }
  }

  private closeWindow(t: number) {
    const f = this.winField;
    const T = t - this.winStart;
    const ux = f.field('ux');
    const uy = f.field('uy');
    const nx = f.nx;
    const cw = f.cellW;
    const ch = f.cellH;
    const circ = (q: { i0: number; i1: number; j0: number; j1: number }) => contourCirculation(ux, uy, nx, cw, ch, q.i0, q.i1, q.j0, q.j1);
    const lift = (this.body.impulseY - this.winImpulse.y) / T;
    this.windows.push({
      t: 0.5 * (t + this.winStart),
      late: this.lateStarted,
      lift,
      drag: (this.body.impulseX - this.winImpulse.x) / T,
      gammaBody: circ(this.contour),
      gammaDomain: circ(this.domainContour),
      gammaSlabs: this.slabs.map(circ),
      fan: { ...this.winFan },
      tailUpper: { us: this.winTail.upper.m > 0 ? this.winTail.upper.p / this.winTail.upper.m : Number.NaN, mass: this.winTail.upper.m },
      tailLower: { us: this.winTail.lower.m > 0 ? this.winTail.lower.p / this.winTail.lower.m : Number.NaN, mass: this.winTail.lower.m },
    });
    if (this.lateStarted) this.lateLift.push(lift);
    this.winField = new FieldAverager(this.sim.domain, this.nxCells, this.nyCells);
    this.winStart = t;
    this.winImpulse = { x: this.body.impulseX, y: this.body.impulseY };
    this.winFan = { ux: 0, uy: 0, mass: 0 };
    this.winTail = { upper: { p: 0, m: 0 }, lower: { p: 0, m: 0 } };
  }

  advance(maxSteps: number): number {
    let k = 0;
    const p = this.p;
    while (k < maxSteps && !this.done) {
      if (!this.sim.step()) {
        this.done = true;
        break;
      }
      k++;
      const t = this.sim.time;
      if (t >= this.nextEmpty) {
        this.empty.sample();
        this.nextEmpty += EMPTY_SPACE_INTERVAL;
      }
      if (t >= this.nextSample) {
        this.winField.add(this.sim.store);
        if (this.lateStarted) this.lateField.add(this.sim.store);
        this.sampleNearBody(this.lateStarted);
        this.nextSample += p.sampleInterval;
        if (this.winField.snapshots === 1) this.conservation.sample();
      }
      if (t - this.winStart >= p.window) {
        this.closeWindow(t);
        if (!this.lateStarted && t >= p.lateFrom) {
          // the late period starts on a window boundary
          this.lateStarted = true;
          this.lateT0 = t;
          this.lateImpulse0 = { x: this.body.impulseX, y: this.body.impulseY, moment: this.body.moment };
          this.lateNormal0 = this.body.normalImpulse.slice();
          this.lateTangential0 = this.body.tangentialImpulse.slice();
        }
      }
      if (t >= p.duration) this.done = true;
    }
    return k;
  }

  progress() {
    return Math.min(1, this.sim.time / this.p.duration);
  }

  live() {
    const w = this.windows[this.windows.length - 1];
    return {
      phase: this.lateStarted ? 'late window' : 'start-up',
      time: this.sim.time,
      particles: this.sim.store.count,
      lift: w ? w.lift : Number.NaN,
      circulation: w ? w.gammaBody : Number.NaN,
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): KuttaRunResult {
    this.sim.checkSafety();
    this.conservation.sample();
    const b = this.body;
    const T = this.sim.time - this.lateT0;
    const n0 = this.lateNormal0 ?? b.normalImpulse;
    const t0 = this.lateTangential0 ?? b.tangentialImpulse;
    const binLen = new Float64Array(b.totalBins);
    for (const e of b.edges) for (let k = 0; k < e.bins; k++) binLen[e.binOffset + k] = e.length / e.bins;
    const f = this.lateField;
    const occ = f.field('occupancy');
    const occVals: number[] = [];
    const cw = f.cellW;
    const ch = f.cellH;
    for (let j = 0; j < f.ny; j++) {
      for (let i = 0; i < f.nx; i++) {
        const xc = (i + 0.5) * cw;
        const yc = (j + 0.5) * ch;
        if (b.closest(xc, yc).d > 2 * Math.max(cw, ch)) occVals.push(occ[j * f.nx + i]);
      }
    }
    return {
      caseIndex: this.spec.caseIndex,
      seed: this.spec.seed,
      windows: this.windows,
      late: {
        time: T,
        lift: (b.impulseY - this.lateImpulse0.y) / T,
        drag: (b.impulseX - this.lateImpulse0.x) / T,
        moment: (b.moment - this.lateImpulse0.moment) / T,
        bandU: Array.from(this.bandU, (v, k) => (this.bandMass[k] > 0 ? v / this.bandMass[k] : Number.NaN)),
        bandMass: Array.from(this.bandMass),
        pressure: Array.from(b.normalImpulse, (v, k) => (v - n0[k]) / (T * binLen[k])),
        shear: Array.from(b.tangentialImpulse, (v, k) => (v - t0[k]) / (T * binLen[k])),
        fan: { ...this.lateFan },
        nx: f.nx,
        ny: f.ny,
        ux: Array.from(f.field('ux')),
        uy: Array.from(f.field('uy')),
        density: Array.from(f.field('density')),
        occupancy: { min: Math.min(...occVals), max: Math.max(...occVals), mean: mean(occVals) },
      },
      lateLiftSeries: this.lateLift,
      conservation: this.conservation.summary(),
      emptySpace: this.empty.summary(),
      insideDetections: b.insideDetections,
      lateContacts: b.lateContacts,
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
    };
  }
}

const deg = (r: number) => (r * 180) / Math.PI;
/** angle difference in degrees, wrapped to (−180, 180] */
const angleDeg = (a: number, b: number) => {
  let d = deg(a - b);
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
};

export class KuttaExperiment extends SequentialExperiment<Spec, KuttaRunResult> {
  readonly type = 'kutta' as const;
  readonly params: KuttaParams;

  constructor(p: KuttaParams) {
    const specs: Spec[] = [];
    p.cases.forEach((_, caseIndex) => {
      for (const seed of p.seeds) specs.push({ caseIndex, seed });
    });
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<KuttaRunResult> {
    return new KuttaRun(this.params, spec);
  }

  private analyseCase(caseIndex: number) {
    const p = this.params;
    const c = p.cases[caseIndex];
    const runs = this.results.filter((r) => r.caseIndex === caseIndex && !r.halted);
    if (runs.length === 0) return null;
    const geom = kuttaBody(p, c);
    const body = new PolygonBody({ name: 'analysis', vertices: geom.vertices, accommodation: p.accommodation, temperature: p.wallKT, binLength: p.surfaceBin });
    const sides = edgeSides(body, geom.chordDir);
    const tails = tailBins(body, sides, geom.le, geom.chordDir);
    const cd = geom.chordDir;
    const perp = { x: -cd.y, y: cd.x }; // toward the upper side

    // ---- late-window forces
    const lift = ensembleEstimate(runs.map((r) => r.late.lift));
    const drag = ensembleEstimate(runs.map((r) => r.late.drag));
    const moment = ensembleEstimate(runs.map((r) => r.late.moment));

    // ---- late circulation: mean of late windows per seed
    const lateRows = (r: KuttaRunResult) => r.windows.filter((w) => w.late);
    const gammaBody = ensembleEstimate(runs.map((r) => mean(lateRows(r).map((w) => w.gammaBody))));
    const gammaDomain = ensembleEstimate(runs.map((r) => mean(lateRows(r).map((w) => w.gammaDomain))));

    // ---- steadiness of the late window: first vs second half of the late lift
    const halves = runs.map((r) => {
      const s = r.lateLiftSeries;
      const h = Math.floor(s.length / 2);
      return mean(s.slice(h)) - mean(s.slice(0, h));
    });
    const liftDrift = ensembleEstimate(halves);

    // ---- trailing-edge departure (late)
    const fanAngles = runs.map((r) => angleDeg(Math.atan2(r.late.fan.uy, r.late.fan.ux), Math.atan2(cd.y, cd.x)));
    const fanPerp = runs.map((r) => (r.late.fan.mass > 0 ? (r.late.fan.uy * perp.y + r.late.fan.ux * perp.x) / r.late.fan.mass : Number.NaN));
    const fanAlong = runs.map((r) => (r.late.fan.mass > 0 ? (r.late.fan.ux * cd.x + r.late.fan.uy * cd.y) / r.late.fan.mass : Number.NaN));
    const departureAngle = ensembleEstimate(fanAngles);
    const crossVelocity = ensembleEstimate(fanPerp);
    const alongVelocity = ensembleEstimate(fanAlong);

    // ---- surface: near-wall downstream velocity and pressure per bin, ordered by chord fraction
    const proj = (x: number, y: number) => ((x - geom.le.x) * cd.x + (y - geom.le.y) * cd.y) / p.chord;
    const surface: Record<'upper' | 'lower', { xc: number; us: { mean: number; se: number }; pressure: { mean: number; se: number }; shear: number }[]> = { upper: [], lower: [] };
    body.edges.forEach((e, k) => {
      const side = sides[k];
      if (side === 'face') return;
      const sign = side === 'lower' ? 1 : -1;
      for (let b = 0; b < e.bins; b++) {
        const bin = e.binOffset + b;
        const sMid = ((b + 0.5) / e.bins) * e.length;
        const xc = proj(e.ax + sMid * e.tx, e.ay + sMid * e.ty);
        const us = ensembleEstimate(runs.map((r) => sign * r.late.bandU[bin]).filter(Number.isFinite));
        const pr = ensembleEstimate(runs.map((r) => r.late.pressure[bin]));
        surface[side].push({ xc, us: { mean: us.mean, se: us.se }, pressure: { mean: pr.mean, se: pr.se }, shear: mean(runs.map((r) => r.late.shear[bin])) });
      }
    });
    surface.upper.sort((a, b) => a.xc - b.xc);
    surface.lower.sort((a, b) => a.xc - b.xc);
    const reversal = (rows: typeof surface.upper) => {
      const rev = rows.filter((r) => r.us.mean + 2 * r.us.se < 0);
      return { reversedBins: rev.length, bins: rows.length, firstReversedAt: rev.length ? rev[0].xc : null, lastReversedAt: rev.length ? rev[rev.length - 1].xc : null };
    };
    const tail = (bin: number, sign: number) => {
      const v = runs.map((r) => sign * r.late.bandU[bin]).filter(Number.isFinite);
      return bin >= 0 && v.length ? ensembleEstimate(v) : null;
    };
    const tailUpper = tail(tails.upper, -1);
    const tailLower = tail(tails.lower, 1);
    const teLoad = (() => {
      const lu = surface.upper[surface.upper.length - 1];
      const ll = surface.lower[surface.lower.length - 1];
      if (!lu || !ll) return null;
      return { deltaP: ll.pressure.mean - lu.pressure.mean, se: Math.hypot(ll.pressure.se, lu.pressure.se), meanLoading: lift.mean / p.chord };
    })();

    // ---- determination (criteria fixed in the class comment)
    const tol = geom.halfWedgeDeg + 15;
    const alongBisector = Math.abs(departureAngle.mean) <= tol;
    const crossSig = Math.abs(crossVelocity.mean) > 3 * crossVelocity.se;
    const towardSide = crossVelocity.mean > 0 ? tailUpper : tailLower;
    const sideReversed = towardSide !== null && towardSide.mean + 2 * towardSide.se < 0;
    const wrapAround = crossSig && !alongBisector && sideReversed;
    const liftSig = Math.abs(lift.mean) > 3 * lift.se;
    const determination = wrapAround
      ? 'FLOW AROUND THE TRAILING EDGE: the gas behind the edge turns toward a side whose near-wall flow runs away from the edge'
      : alongBisector && liftSig
        ? 'SMOOTH DEPARTURE WITH LIFT: the gas leaves along the trailing-edge bisector while the body carries significant lift'
        : alongBisector
          ? 'SMOOTH DEPARTURE, NO SIGNIFICANT LIFT'
          : 'UNRESOLVED: departure direction outside the bisector band without the wrap-around signature';

    // ---- time series (seed ensemble at equal times)
    const nW = Math.min(...runs.map((r) => r.windows.length));
    const series = Array.from({ length: nW }, (_, k) => {
      const ws = runs.map((r) => r.windows[k]);
      const est = (xs: number[]) => {
        const f = xs.filter(Number.isFinite);
        if (f.length === 0) return { mean: Number.NaN, se: Number.NaN };
        const e = ensembleEstimate(f);
        return { mean: e.mean, se: e.se };
      };
      const fanM = ws.reduce((a, w) => a + w.fan.mass, 0);
      const fux = ws.reduce((a, w) => a + w.fan.ux, 0) / (fanM || 1);
      const fuy = ws.reduce((a, w) => a + w.fan.uy, 0) / (fanM || 1);
      return {
        t: ws[0].t,
        lift: est(ws.map((w) => w.lift)),
        drag: est(ws.map((w) => w.drag)),
        gammaBody: est(ws.map((w) => w.gammaBody)),
        gammaDomain: est(ws.map((w) => w.gammaDomain)),
        gammaSlabs: ws[0].gammaSlabs.map((_, s) => mean(ws.map((w) => w.gammaSlabs[s]))),
        departureAngle: fanM > 0 ? angleDeg(Math.atan2(fuy, fux), Math.atan2(cd.y, cd.x)) : Number.NaN,
        crossVelocity: est(ws.map((w) => (w.fan.mass > 0 ? (w.fan.ux * perp.x + w.fan.uy * perp.y) / w.fan.mass : Number.NaN))),
        tailUpper: est(ws.map((w) => w.tailUpper.us)),
        tailLower: est(ws.map((w) => w.tailLower.us)),
      };
    });
    // starting vortex: peak |Γ| time per wake slab (sign of the early body circulation's opposite)
    const early = series.filter((s) => s.t <= Math.min(p.lateFrom, 60));
    const gEarly = mean(early.map((s) => s.gammaBody.mean));
    const vortexSign = gEarly !== 0 ? -Math.sign(gEarly) : 1;
    const slabW = (p.length - 2 * p.contourMargin - (body.xmax + p.contourMargin)) / p.wakeSlabs;
    const slabX0 = body.xmax + p.contourMargin;
    // peak searched in the start-up period only; significant if it exceeds 3 SD of the late-window slab series
    const startup = series.filter((row) => row.t < p.lateFrom);
    const lateSeries = series.filter((row) => row.t >= p.lateFrom);
    const peaks = Array.from({ length: p.wakeSlabs }, (_, s) => {
      let best = -Infinity;
      let tBest = Number.NaN;
      for (const row of startup) {
        const v = vortexSign * row.gammaSlabs[s];
        if (v > best) {
          best = v;
          tBest = row.t;
        }
      }
      const lateVals = lateSeries.map((row) => row.gammaSlabs[s]);
      const noise = lateVals.length > 2 ? Math.sqrt(lateVals.reduce((a, v) => a + (v - mean(lateVals)) ** 2, 0) / (lateVals.length - 1)) : Number.NaN;
      return { slabCentre: slabX0 + (s + 0.5) * slabW, peakTime: tBest, peakCirculation: vortexSign * best, lateNoiseSd: noise, significant: best > 3 * noise };
    });
    const sigPeaks = peaks.filter((q) => q.significant);
    const conv = sigPeaks.length >= 2 ? linearRegression(sigPeaks.map((q) => q.peakTime), sigPeaks.map((q) => q.slabCentre)) : null;

    // trailing-edge departure in the first windows after the start versus the late window
    const earlyUntil = Math.min(4 * p.window, p.lateFrom);
    const earlyFan = runs.map((r) => {
      const ws = r.windows.filter((w) => w.t <= earlyUntil);
      const m = ws.reduce((a, w) => a + w.fan.mass, 0);
      return { ux: ws.reduce((a, w) => a + w.fan.ux, 0) / (m || 1), uy: ws.reduce((a, w) => a + w.fan.uy, 0) / (m || 1) };
    });
    const earlyDeparture = {
      until: earlyUntil,
      angleToBisectorDeg: ensembleEstimate(earlyFan.map((f) => angleDeg(Math.atan2(f.uy, f.ux), Math.atan2(cd.y, cd.x)))),
      crossVelocity: ensembleEstimate(earlyFan.map((f) => f.ux * perp.x + f.uy * perp.y)),
    };

    // ---- shedding: Fisher g per seed on the late lift series
    const shedding = runs.map((r) => ({ seed: r.seed, ...fisherG(r.lateLiftSeries) }));
    const periodicSeeds = shedding.filter((s) => s.p < 0.01).length;

    // ---- wake: late velocity deficit and momentum-deficit drag at stations behind the body
    const nx = runs[0].late.nx;
    const ny = runs[0].late.ny;
    const cw = p.length / nx;
    const ch = p.height / ny;
    const ux = Array.from({ length: nx * ny }, (_, q) => mean(runs.map((r) => r.late.ux[q])));
    const rho = Array.from({ length: nx * ny }, (_, q) => mean(runs.map((r) => r.late.density[q])));
    const wake = [0.5, 1, 2].map((f) => {
      const x = geom.te.x + f * p.chord;
      const i = Math.min(nx - 1, Math.max(0, Math.floor(x / cw)));
      const j0 = Math.round(p.contourMargin / ch);
      const j1 = ny - 1 - j0;
      const col = Array.from({ length: j1 - j0 + 1 }, (_, k) => ux[(j0 + k) * nx + i]);
      const rcol = Array.from({ length: j1 - j0 + 1 }, (_, k) => rho[(j0 + k) * nx + i]);
      const outer = [...col.slice(0, 5), ...col.slice(-5)];
      const Ue = mean(outer);
      let jmin = 0;
      for (let k = 1; k < col.length; k++) if (col[k] < col[jmin]) jmin = k;
      let D = 0;
      for (let k = 0; k < col.length; k++) D += rcol[k] * col[k] * (Ue - col[k]) * ch;
      const half = Ue - 0.5 * (Ue - col[jmin]);
      let width = 0;
      for (let k = 0; k < col.length; k++) if (col[k] < half) width += ch;
      return {
        xBehindTE: f * p.chord,
        outerU: Ue,
        maxDeficit: 1 - col[jmin] / Ue,
        centreY: (j0 + jmin + 0.5) * ch,
        halfDeficitWidth: width,
        momentumDeficitDrag: D,
        note: 'ρu(U_e − u) integrated across the domain; pressure and stress terms are neglected, so this is a diagnostic, not a balance',
      };
    });
    const occ = runs.map((r) => r.late.occupancy);
    // realised free stream: upstream column half a chord ahead of the body, outer fifth of the height on each side
    const iUp = Math.min(nx - 1, Math.max(0, Math.floor((body.xmin - 0.5 * p.chord) / cw)));
    const outerRows = Array.from({ length: ny }, (_, j) => j).filter((j) => (j + 0.5) * ch < 0.2 * p.height || (j + 0.5) * ch > 0.8 * p.height);
    const freeStream = { freeStreamU: mean(outerRows.map((j) => ux[j * nx + iUp])), density: mean(outerRows.map((j) => rho[j * nx + iUp])), stationX: (iUp + 0.5) * cw };

    return {
      label: c.label,
      shape: c.shape,
      alphaDeg: c.alphaDeg,
      halfWedgeDeg: geom.halfWedgeDeg,
      seeds: runs.map((r) => r.seed),
      lift,
      drag,
      momentQuarterChord: moment,
      liftDriftLateHalves: liftDrift,
      gammaBody,
      gammaDomain,
      departure: { angleToBisectorDeg: departureAngle, crossVelocity, alongVelocity, toleranceDeg: tol, alongBisector, crossSignificant: crossSig },
      tailVelocity: { upper: tailUpper, lower: tailLower },
      trailingEdgeLoading: teLoad,
      surfaceReversal: { upper: reversal(surface.upper), lower: reversal(surface.lower) },
      surface,
      determination,
      liftSignificant: liftSig,
      wrapAround,
      series,
      earlyDeparture,
      startingVortex: {
        sign: vortexSign,
        slabs: peaks,
        convectionSpeed: conv ? { value: conv.slope, se: conv.seSlope, fromSlabs: sigPeaks.length } : null,
        note: 'Sign opposite to the early body circulation. Peak of the seed-mean slab circulation in the start-up period; significant if > 3 SD of the late-window slab series.',
      },
      shedding: { perSeed: shedding, seedsWithPeriodicLift: periodicSeeds, criterion: 'Fisher g test p < 0.01 on the late lift series' },
      wake,
      occupancy: { min: Math.min(...occ.map((o) => o.min)), max: Math.max(...occ.map((o) => o.max)), mean: mean(occ.map((o) => o.mean)) },
      realised: freeStream,
      field: { nx, ny, ux: ux.map((v) => +v.toFixed(4)), uy: Array.from({ length: nx * ny }, (_, q) => +mean(runs.map((r) => r.late.uy[q])).toFixed(4)) },
      body: { vertices: geom.vertices, te: geom.te, le: geom.le },
    };
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const halted = this.results.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const inside = this.results.reduce((a, r) => a + r.insideDetections, 0);
    checks.push(check('no-penetration', 'No particle centre ever inside the body', '0 detections', `${inside}`, inside === 0));
    const maxE = Math.max(...this.results.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...this.results.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger incl. body and open-boundary fluxes closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Momentum ledger incl. body impulse and open-boundary fluxes closes', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));
    const empty = aggregateEmptySpace(this.results.map((r) => r.emptySpace));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
      empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));

    const cases = p.cases.map((_, k) => this.analyseCase(k));
    cases.forEach((c, k) => {
      if (!c) return;
      if (p.cases[k].alphaDeg === 0 && p.cases[k].shape !== 'wedge') {
        checks.push(check(`symmetry-control-${k}`, `${c.label}: a symmetric body at zero incidence carries no mean lift`, '|L| < 3 SE', `L = ${c.lift.mean.toPrecision(3)} ± ${c.lift.se.toPrecision(2)}`, !c.liftSignificant));
      }
      const steady = Math.abs(c.liftDriftLateHalves.mean) <= 3 * c.liftDriftLateHalves.se + 0.05 * Math.abs(c.lift.mean);
      checks.push(check(`late-steady-${k}`, `${c.label}: late-window lift is stationary (second half vs first half)`, '|ΔL| ≤ 3 SE + 5 % of |L|', `ΔL = ${c.liftDriftLateHalves.mean.toPrecision(3)} ± ${c.liftDriftLateHalves.se.toPrecision(2)}`, steady, 'NOT CONVERGED'));
      if (Math.abs(c.gammaDomain.mean) > 3 * c.gammaDomain.se) {
        warnings.push(`${c.label}: circulation on the domain contour ${c.gammaDomain.mean.toPrecision(3)} ± ${c.gammaDomain.se.toPrecision(2)} is non-zero: vorticity remains in the domain in the late window.`);
      }
    });
    for (const r of this.results) for (const f of r.safetyFlags) warnings.push(`case ${r.caseIndex} seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    const late = this.results.reduce((a, r) => a + r.lateContacts, 0);
    if (late > 0) warnings.push(`${late} body contacts were already overlapping at the start of their step (placed at the step start).`);

    const valid = cases.filter((c): c is NonNullable<typeof c> => c !== null);
    const first = valid[0];
    const rhoE = first ? first.realised.density : Number.NaN;
    const UE = first ? first.realised.freeStreamU : Number.NaN;
    const re = p.viscosity ? (rhoE * UE * p.chord) / p.viscosity.value : null;

    return {
      ...recordHeader('kutta', 'Kutta discovery: does smooth trailing-edge departure emerge?', p.seeds),
      particleCount: Math.round((p.areaFraction / (Math.PI * p.radius ** 2)) * p.length * p.height),
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: p.areaFraction / (Math.PI * p.radius ** 2), massDensity: (p.mass * p.areaFraction) / (Math.PI * p.radius ** 2), areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: 'reservoir kT' },
      speed: p.speed,
      geometry: `${p.length} × ${p.height} domain, open reservoirs on all sides; polygon body, chord ${p.chord}, thickness ${p.thickness}, leading edge at x = ${p.leadingEdgeX}`,
      wallModel: `polygon body with Maxwell accommodation Aw = ${p.accommodation} (A-19); reservoir boundaries (A-18)`,
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: this.results.length * p.duration, steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: {
        simulation: re,
        effective: null,
        physical: null,
        note: p.viscosity
          ? `Re_c = ρ_e U_e c / μ with the realised free stream (first case) and μ from ${p.viscosity.source}.`
          : 'No measured μ supplied (set `viscosity` from a Couette record).',
      },
      mach: p.soundSpeed
        ? { Mp: UE / p.soundSpeed.value, benchmark: null, note: `Mp = U_e/c_p, c_p from ${p.soundSpeed.source}` }
        : { Mp: null, benchmark: null, note: 'No measured c_p supplied.' },
      results: {
        emptySpace: empty,
        cases,
        conventions: 'Flow along +x. Lift = +y force on the body, drag = +x force. Circulation counter-clockwise positive (a body lifting upward in +x flow has negative Γ in this convention). Angles in degrees; departure angle measured from the trailing-edge bisector, positive toward the upper side.',
      },
      uncertainty: { note: 'Seed ensembles (independent realisations of the same impulsive start); time series are seed means at equal times.' },
      convergence: { status: 'NOT ASSESSED', note: 'Single resolution, domain and particle scale (Step 15 addresses scaling).' },
      benchmarks: {
        note: 'Displayed only after the measurement (Master prompt §19). Thin-airfoil theory with the Kutta condition imposed, inviscid, incompressible, unbounded: Γ = −π U c sin α, L = ρ U |Γ| per unit span. Not used by the run or the determination.',
        perCase: valid.map((c) => {
          const a = (c.alphaDeg * Math.PI) / 180;
          const gammaKJ = -Math.PI * c.realised.freeStreamU * p.chord * Math.sin(a);
          const liftKJ = c.realised.density * c.realised.freeStreamU * Math.abs(gammaKJ);
          return {
            label: c.label,
            thinAirfoilCirculation: gammaKJ,
            thinAirfoilLift: liftKJ,
            measuredCirculationOverThinAirfoil: gammaKJ !== 0 ? c.gammaBody.mean / gammaKJ : null,
            measuredLiftOverThinAirfoil: liftKJ !== 0 ? c.lift.mean / liftKJ : null,
            kuttaJoukowskiLiftFromMeasuredCirculation: -c.realised.density * c.realised.freeStreamU * c.gammaBody.mean,
          };
        }),
      },
      assumptions: ['A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-18', 'A-19'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: this.results.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
