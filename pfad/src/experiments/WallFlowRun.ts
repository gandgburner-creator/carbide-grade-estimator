import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import { Rng } from '../core/Random';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import { EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { GridSums, type GridSumsData } from '../measurements/GridSums';
import { PolygonBody, type PolygonBodyConfig } from '../walls/SolidBody';
import type { Run } from './Experiment';

/**
 * FLAT-WALL FLOW RIG for Item 3 (docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md).
 *
 * Geometry (model units, disk diameter 1):
 *   x ∈ [0, L) periodic; floor at y = 0; ceiling at y = H(x).
 *   floor  — specular (Aw = 0) everywhere except the PLATE [x_le, x_te], a
 *            stationary Maxwell wall with accommodation Aw at kT_w (A-08).
 *   ceiling — specular (no shear, no heat). H(x) = H_in, except that it ramps
 *            linearly up to H_out = r·H_in over the DIFFUSER [x_d0, x_d1], stays
 *            at H_out, and ramps back down over the CONTRACTION [x_c0, x_c1].
 *            The ceiling is the domain's top plane wall at H_out plus two fixed
 *            specular polygon bodies (A-19) that fill the space above H(x) where
 *            H(x) < H_out. r = 1 means a straight channel with no bodies.
 *   inflow conditioning — the FRINGE [x_f0, x_f1] (all y), upstream of the
 *            plate: each step every particle in it is, with probability
 *            1 − exp(−ν dt), given a fresh velocity from the drifting Maxwellian
 *            (U, kT). This is the experiment's controlled bulk-flow condition
 *            (an inlet spread over a zone; A-20). The energy and momentum it
 *            injects are entered in the ledger as external work and impulse,
 *            so the conservation identities stay closed, and are reported.
 *
 * Nothing else acts on the gas: no force acts in the test section, nothing
 * targets near-wall particles, and no velocity profile, thickness law,
 * pressure law or separation criterion appears anywhere. With r > 1 the
 * channel area grows, so the flow must decelerate (mass conservation acts
 * through the particle dynamics alone) and the plate sees whatever pressure
 * rise the gas develops. The pressure rise is MEASURED from wall impulses.
 *
 * Measurement (after `startupTime`, for `measurementTime`), all raw sums:
 *   near-wall grid  y < h_nw, cells Δx × Δy_nw: count, Σmv, Σmv², collisional virial
 *   outer grid      whole channel, cells Δx × Δy_out: same sums
 *   fine grid       y < h_f, cells Δx_f × Δy_f: count, Σmv
 *   time blocks     K consecutive blocks, y < h_b, cells Δx × Δy_b: count, Σmv
 *   floor tallies   per floor bin (start → end and per block): hits, normal and
 *                   tangential impulse, energy in, incident/emitted tangential
 *                   momentum, diffuse hits
 *   ceiling bodies  impulse on each body
 *   fringe          energy and momentum injected, resamplings
 *   series          KE, kT, ledger totals every `seriesInterval`
 *   frames          (optional) particle positions/velocities in a window, for animation
 */
export const FRINGE_RNG_STREAM = 7;

export interface WallFlowConfig {
  label: string;
  // ---- geometry
  length: number;
  heightIn: number;
  /** r = H_out / H_in (1 = straight channel) */
  expansion: number;
  fringe: [number, number];
  plate: [number, number];
  diffuser: [number, number];
  contraction: [number, number];
  /** straight edges per (half-cosine) ceiling ramp */
  rampSegments: number;
  // ---- gas and inflow
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  /**
   * reference speed U: the inflow mass flux is held at Q = n₀ m U H_in.
   * The fringe drift varies linearly from U_a at the fringe entrance to U_b at
   * its exit. During start-up two controllers act: U_a is adjusted (PI) until
   * the mass flux through the lead-in equals Q, and U_b relaxes towards the
   * mean velocity in the lead-in, so that the gas leaves the fringe already at
   * the lead-in state and the pumping compression happens inside the fringe
   * (no compression jump after it). Both are then frozen (see `control`).
   */
  speed: number;
  /** fringe resampling rate ν (per unit time) */
  fringeRate: number;
  /** relocate each resampled fringe particle to a uniformly random height at the same x, when that spot is free */
  fringeMixY: boolean;
  /**
   * inflow control (start-up only). Both controllers freeze at `freezeAt` to
   * their means over the preceding `freezeAverage`; between `freezeAt` and
   * `startupTime` the flow settles with constant forcing before measurement.
   */
  control: { interval: number; gainP: number; gainI: number; exitRate: number; freezeAverage: number; freezeAt: number };
  // ---- plate
  accommodation: number;
  wallKT: number;
  // ---- numerics
  timestep: TimestepPolicy;
  contact: ContactResolution;
  // ---- schedule
  startupTime: number;
  measurementTime: number;
  sampleInterval: number;
  blocks: number;
  seriesInterval: number;
  // ---- measurement grids
  cellX: number;
  nearWallHeight: number;
  nearWallCellY: number;
  outerCellY: number;
  fineCellX: number;
  fineCellY: number;
  fineHeight: number;
  blockCellY: number;
  blockHeight: number;
  wallBin: number;
  /** optional particle frames for animation */
  frames?: { x0: number; x1: number; height: number; count: number; interval: number };
  /**
   * optional rectangular RIB on the floor (a fixed polygon body, A-19) with
   * Maxwell accommodation on its faces: the geometric-separation positive
   * control (flow over an obstacle), not part of the flat-wall cases
   */
  rib?: { x0: number; x1: number; height: number; accommodation: number };
}

export interface WallFlowGeometry {
  heightOut: number;
  /** ceiling height at x (periodic) */
  ceiling: (x: number) => number;
  bodies: PolygonBodyConfig[];
  fluidArea: number;
  /** fraction of each cell (x0 + i·w, y0 + j·h) that is fluid (below the ceiling) */
  fluidFraction: (x0: number, x1: number, y0: number, y1: number) => number;
  /** ceiling knots (x, h), periodic piecewise-linear */
  knots: { x: number; h: number }[];
  /** area of the floor rib (0 without one) */
  ribArea: number;
}

/** Ceiling contour and solid bodies of the rig. */
export function wallFlowGeometry(c: WallFlowConfig): WallFlowGeometry {
  const L = c.length;
  const H0 = c.heightIn;
  const H1 = c.heightIn * c.expansion;
  const [d0, d1] = c.diffuser;
  const [k0, k1] = c.contraction;
  const [f0, f1] = c.fringe;
  const [p0, p1] = c.plate;
  const K = c.rampSegments;
  if (!(c.expansion >= 1)) throw new Error('expansion must be ≥ 1');
  if (!(Number.isInteger(K) && K >= 1)) throw new Error('rampSegments must be a positive integer');
  if (!(0 <= f0 && f0 < f1 && f1 <= p0 && p0 < p1 && p1 <= L)) throw new Error('need 0 ≤ fringe < plate ≤ L');
  if (!(0 < d0 && d0 < d1 && d1 < k0 && k0 < k1 && k1 <= L)) throw new Error('need 0 < diffuser < contraction ≤ L');
  if (f1 > d0) throw new Error('the fringe must lie in the inlet section, upstream of the diffuser');
  // ramps: half-cosine shapes sampled at K + 1 knots and joined by straight edges;
  // the ceiling function and the solid bodies use exactly the same knots
  const ramp = (a: number, b: number, ha: number, hb: number) =>
    Array.from({ length: K + 1 }, (_, k) => ({ x: a + ((b - a) * k) / K, h: ha + (hb - ha) * 0.5 * (1 - Math.cos((Math.PI * k) / K)) }));
  const up = ramp(d0, d1, H0, H1);
  const down = ramp(k0, k1, H1, H0);
  const knots = [{ x: 0, h: H0 }, ...up, ...down, { x: L, h: H0 }];
  const ceiling = (xIn: number): number => {
    const x = xIn - L * Math.floor(xIn / L);
    let k = 0;
    while (k + 2 < knots.length && knots[k + 1].x <= x) k++;
    const a = knots[k];
    const b = knots[k + 1];
    return b.x > a.x ? a.h + ((x - a.x) / (b.x - a.x)) * (b.h - a.h) : b.h;
  };
  const bodies: PolygonBodyConfig[] = [];
  if (c.expansion > 1) {
    const pad = 20;
    const cap = 2;
    const flat = (pts: { x: number; h: number }[]) => pts.flatMap((q) => [q.x, q.h]);
    bodies.push({
      name: 'ceiling-inlet',
      vertices: [-pad, H0, ...flat(up), d1, H1 + cap, -pad, H1 + cap],
      accommodation: 0,
      binLength: 5,
    });
    bodies.push({
      name: 'ceiling-outlet',
      vertices: [...flat(down), L + pad, H0, L + pad, H1 + cap, k0, H1 + cap],
      accommodation: 0,
      binLength: 5,
    });
  }
  // exact area under the piecewise-linear ceiling
  let area = 0;
  for (let k = 0; k + 1 < knots.length; k++) area += 0.5 * (knots[k + 1].x - knots[k].x) * (knots[k].h + knots[k + 1].h);
  const fluidFraction = (x0: number, x1: number, y0: number, y1: number) => {
    const S = 40;
    let f = 0;
    for (let s = 0; s < S; s++) {
      const h = ceiling(x0 + ((s + 0.5) / S) * (x1 - x0));
      f += Math.min(1, Math.max(0, (h - y0) / (y1 - y0)));
    }
    return f / S;
  };
  let ribArea = 0;
  if (c.rib) {
    const { x0, x1, height } = c.rib;
    if (!(c.plate[0] < x0 && x0 < x1 && x1 < c.plate[1] && height > 0 && height < H0)) throw new Error('the rib must sit on the plate and below the inlet ceiling');
    bodies.push({
      name: 'floor-rib',
      vertices: [x0, 0, x1, 0, x1, height, x0, height],
      accommodation: c.rib.accommodation,
      temperature: c.wallKT,
      binLength: 2,
    });
    ribArea = (x1 - x0) * height;
    area -= ribArea;
  }
  return { heightOut: H1, ceiling, bodies, fluidArea: area, fluidFraction, knots, ribArea };
}

type WallTally = {
  hits: number[];
  normalImpulse: number[];
  tangentialImpulse: number[];
  energyIn: number[];
  incidentTangential: number[];
  emittedTangential: number[];
  diffuseHits: number[];
};

export interface WallFlowFrame {
  t: number;
  /** interleaved x, y, vx, vy (2 decimals) */
  p: number[];
}

export interface WallFlowRunResult {
  label: string;
  seed: number;
  config: WallFlowConfig;
  particles: number;
  fluidArea: number;
  numberDensity: number;
  heightOut: number;
  measurementStart: number;
  measurementTime: number;
  steps: number;
  wallSeconds: number;
  nearWall: GridSumsData;
  outer: GridSumsData;
  fine: GridSumsData;
  blocks: GridSumsData[];
  floor: { bin: number; total: WallTally; blocks: { tangentialImpulse: number[]; normalImpulse: number[]; hits: number[] }[] };
  ceiling: { name: string; impulseX: number; impulseY: number; hits: number; normalImpulse: number[]; binLength: number }[];
  fringe: {
    energyIn: number;
    momentumX: number;
    momentumY: number;
    resamplings: number;
    moves: number;
    energyInTotal: number;
    momentumXTotal: number;
    /** frozen fringe entrance and exit drifts U_a, U_b used during the measurement */
    drift: number;
    exitDrift: number;
  };
  /** realised mass flux through the lead-in during the measurement (mean of Σ m v_x / length), and its target */
  massFlux: { measured: number; target: number };
  series: {
    t: number[];
    kinetic: number[];
    kT: number[];
    plateImpulseX: number[];
    fringeMomentumX: number[];
    fringeEnergy: number[];
    ceilingImpulseX: number[];
    energyResidual: number[];
    tControl: number[];
    uf: number[];
    ub: number[];
    massFlux: number[];
  };
  ledger: ReturnType<Simulation['ledger']['toJSON']>;
  conservation: ReturnType<ConservationMonitor['summary']>;
  collisions: ReturnType<Simulation['log']['summary']>;
  emptySpace: EmptySpaceSummary;
  safetyFlags: SafetyFlag[];
  halted: boolean;
  frames: WallFlowFrame[];
}

/** time between no-empty-space samples */
const EMPTY_SPACE_INTERVAL = 10;

export class WallFlowRun implements Run<WallFlowRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  readonly geometry: WallFlowGeometry;
  done = false;
  private readonly c: WallFlowConfig;
  private readonly seed: number;
  private readonly fringeRng: Rng;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private readonly nearWall: GridSums;
  private readonly outer: GridSums;
  private readonly fine: GridSums;
  private readonly blockGrids: GridSums[];
  private readonly blockWall: { tangentialImpulse: number[]; normalImpulse: number[]; hits: number[] }[] = [];
  private blockStartTally: Float64Array[] | null = null;
  private wall0: WallTally | null = null;
  private ceiling0: { x: number; y: number; hits: number; nor: Float64Array }[] = [];
  private measuring = false;
  private tMeasure0 = 0;
  private nextSample = 0;
  private nextEmpty = 0;
  private nextSeries = 0;
  private nextFrame = 0;
  private block = 0;
  private steps = 0;
  private readonly t0 = Date.now();
  private readonly band: number[] = [];
  private fringeMoves = 0;
  /** fringe entrance drift U_a (controlled during start-up, frozen for the measurement) */
  private uf: number;
  private ctlI = 0;
  /** fringe exit drift U_b (tracks the lead-in velocity during start-up, frozen for the measurement) */
  private ub: number;
  private ubSum = 0;
  private ubFrozen = Number.NaN;
  private ufFrozen = Number.NaN;
  private frozen = false;
  private pxSum = 0;
  private pxN = 0;
  private ufSum = 0;
  private ufN = 0;
  private nextControl = 0;
  private fringeE = 0;
  private fringePx = 0;
  private fringePy = 0;
  private fringeN = 0;
  private fringeE0 = 0;
  private fringePx0 = 0;
  private fringePy0 = 0;
  private fringeN0 = 0;
  private readonly series: WallFlowRunResult['series'] = {
    t: [],
    kinetic: [],
    kT: [],
    plateImpulseX: [],
    fringeMomentumX: [],
    fringeEnergy: [],
    ceilingImpulseX: [],
    energyResidual: [],
    tControl: [],
    uf: [],
    ub: [],
    massFlux: [],
  };
  private readonly frames: WallFlowFrame[] = [];
  private readonly particles: number;
  private readonly n0: number;

  constructor(c: WallFlowConfig, seed: number) {
    this.c = c;
    this.seed = seed;
    this.label = `${c.label} seed=${seed}`;
    const g = wallFlowGeometry(c);
    this.geometry = g;
    const domain: DomainSpec = { xmin: 0, xmax: c.length, ymin: 0, ymax: g.heightOut, periodicX: true, periodicY: false };
    this.n0 = c.areaFraction / (Math.PI * c.radius * c.radius);
    const N = Math.round(this.n0 * g.fluidArea);
    this.particles = N;
    const probes = g.bodies.map((b) => new PolygonBody(b));
    const { store } = createGas({
      count: N,
      radius: c.radius,
      mass: c.mass,
      kT: c.kT,
      distribution: 'maxwell',
      seed,
      domain,
      flow: { x: c.speed, y: 0 },
      exclude: (x, y, r) => y + r > g.ceiling(x) + 1e-9 || probes.some((b) => b.closest(x, y).d < r + 1e-9),
    });
    const bins = Math.round(c.length / c.wallBin);
    if (Math.abs(bins * c.wallBin - c.length) > 1e-9) throw new Error('length must be a whole number of wall bins');
    this.sim = new Simulation(
      {
        domain,
        walls: [
          {
            side: 'bottom',
            accommodation: 0,
            bins,
            segments: c.accommodation > 0 ? [{ from: c.plate[0], to: c.plate[1], accommodation: c.accommodation, temperature: c.wallKT, tangentialVelocity: 0 }] : [],
          },
          { side: 'top', accommodation: 0 },
        ],
        bodies: g.bodies,
        collision: { enabled: true, restitution: 1, contact: c.contact, dissipationTarget: 'external' },
        timestep: c.timestep,
        seed,
        referenceKT: c.kT,
      },
      store,
    );
    this.fringeRng = new Rng(seed, FRINGE_RNG_STREAM);
    this.uf = c.speed;
    this.ub = c.speed;
    this.conservation = new ConservationMonitor(this.sim);
    this.empty = new EmptySpaceMonitor(this.sim, 40, 0.1, 5, (x0, y0, x1, y1) => {
      // cells reaching above the ceiling or into the rib are geometry, not empty space
      const S = 8;
      for (let s = 0; s <= S; s++) if (y1 > g.ceiling(x0 + (s / S) * (x1 - x0))) return true;
      if (c.rib && x1 > c.rib.x0 && x0 < c.rib.x1 && y0 < c.rib.height) return true;
      return false;
    });
    const L = c.length;
    this.nearWall = new GridSums({ x0: 0, y0: 0, x1: L, y1: c.nearWallHeight }, c.cellX, c.nearWallCellY, { second: true, collisional: true, periodX: L });
    // whole rows up to (at least) the highest ceiling; rows above the ceiling stay empty
    const outerTop = Math.ceil(g.heightOut / c.outerCellY - 1e-9) * c.outerCellY;
    this.outer = new GridSums({ x0: 0, y0: 0, x1: L, y1: outerTop }, c.cellX, c.outerCellY, { second: true, collisional: true, periodX: L });
    this.fine = new GridSums({ x0: 0, y0: 0, x1: L, y1: c.fineHeight }, c.fineCellX, c.fineCellY, { second: false });
    this.blockGrids = Array.from({ length: c.blocks }, () => new GridSums({ x0: 0, y0: 0, x1: L, y1: c.blockHeight }, c.cellX, c.blockCellY, { second: false }));
  }

  private wallTally(): WallTally {
    const w = this.sim.walls[0];
    const a = (v: Float64Array) => Array.from(v);
    return {
      hits: a(w.hits),
      normalImpulse: a(w.normalImpulse),
      tangentialImpulse: a(w.tangentialImpulse),
      energyIn: a(w.energyIn),
      incidentTangential: a(w.incidentTangential),
      emittedTangential: a(w.emittedTangential),
      diffuseHits: a(w.diffuseHits),
    };
  }

  /**
   * Inflow conditioning: in the fringe each particle is, with probability
   * 1 − exp(−ν dt), given a velocity from the drifting Maxwellian (U_f(x), kT),
   * U_f falling linearly from U_a (entrance) to U (exit), and
   * (fringeMixY) moved to a uniformly random height at the same x if no disk
   * overlaps there. The velocity change is ledgered as external work and
   * impulse; the move changes no velocity (hard disks have no potential energy).
   */
  private applyFringe(dt: number): void {
    const c = this.c;
    const s = this.sim.store;
    const prob = 1 - Math.exp(-c.fringeRate * dt);
    const [f0, f1] = c.fringe;
    const sigma = Math.sqrt(c.kT / c.mass);
    const rng = this.fringeRng;
    const L = c.length;
    let dE = 0;
    let dpx = 0;
    let dpy = 0;
    let n = 0;
    // particles that could overlap a relocated fringe particle
    const band = this.band;
    band.length = 0;
    if (c.fringeMixY) {
      for (let i = 0; i < s.count; i++) {
        let x = s.x[i];
        if (x >= L - 2) x -= L;
        if (x >= f0 - 2 && x < f1 + 2) band.push(i);
      }
    }
    const yLo = c.radius;
    const yHi = c.heightIn - c.radius;
    const events = this.sim.collider.lastEventStep;
    const stepDone = this.sim.stepCount - 1;
    for (let i = 0; i < s.count; i++) {
      const x = s.x[i];
      if (x < f0 || x >= f1) continue;
      if (rng.next() >= prob) continue;
      const m = s.mass[i];
      const drift = this.uf + ((this.ub - this.uf) * (x - f0)) / (f1 - f0);
      const vx = drift + sigma * rng.gaussian();
      const vy = sigma * rng.gaussian();
      dE += 0.5 * m * (vx * vx + vy * vy - s.vx[i] * s.vx[i] - s.vy[i] * s.vy[i]);
      dpx += m * (vx - s.vx[i]);
      dpy += m * (vy - s.vy[i]);
      s.vx[i] = vx;
      s.vy[i] = vy;
      // the resampling is an event of the step just completed (like a wall
      // re-emission): a contact it creates is then an explained late contact
      events[i] = stepDone;
      n++;
      if (c.fringeMixY) {
        const yNew = yLo + (yHi - yLo) * rng.next();
        let free = true;
        for (const j of band) {
          if (j === i) continue;
          let dx = s.x[j] - x;
          dx -= L * Math.round(dx / L);
          const R = s.radius[i] + s.radius[j];
          if (dx > R || dx < -R) continue;
          const dy = s.y[j] - yNew;
          if (dx * dx + dy * dy < R * R) {
            free = false;
            break;
          }
        }
        if (free) {
          s.y[i] = yNew;
          this.fringeMoves++;
        }
      }
    }
    const Lg = this.sim.ledger;
    Lg.forceWorkOut -= dE;
    Lg.forceImpulseX += dpx;
    Lg.forceImpulseY += dpy;
    this.fringeE += dE;
    this.fringePx += dpx;
    this.fringePy += dpy;
    this.fringeN += n;
  }

  /** Mass flux per unit width through the lead-in [fringe exit, plate start) and the mass-weighted mean velocity there. */
  private leadIn(): { Q: number; u: number } {
    const c = this.c;
    const s = this.sim.store;
    const a = c.fringe[1];
    const b = c.plate[0];
    let p = 0;
    let m = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.x[i] >= a && s.x[i] < b) {
        p += s.mass[i] * s.vx[i];
        m += s.mass[i];
      }
    }
    return { Q: p / (b - a), u: m > 0 ? p / m : c.speed };
  }

  /** Inflow control during start-up (see WallFlowConfig.speed). */
  private control(): void {
    const c = this.c;
    const t = this.sim.time;
    if (this.frozen) return;
    if (t >= c.control.freezeAt) {
      this.freeze();
      return;
    }
    const { Q, u } = this.leadIn();
    const Qt = this.n0 * c.mass * c.speed * c.heightIn;
    const e = (Qt - Q) / (this.n0 * c.mass * c.heightIn);
    this.ctlI += c.control.gainI * e * c.control.interval;
    this.uf = c.speed + c.control.gainP * e + this.ctlI;
    this.ub += Math.min(1, c.control.exitRate * c.control.interval) * (u - this.ub);
    if (t >= c.control.freezeAt - c.control.freezeAverage) {
      this.ufSum += this.uf;
      this.ubSum += this.ub;
      this.ufN++;
    }
    this.series.uf.push(this.uf);
    this.series.ub.push(this.ub);
    this.series.tControl.push(t);
    this.series.massFlux.push(Q);
  }

  /** Freeze both inflow controllers at their recent means (constant forcing from now on). */
  private freeze(): void {
    if (this.frozen) return;
    if (this.ufN > 0) {
      this.uf = this.ufSum / this.ufN;
      this.ub = this.ubSum / this.ufN;
    }
    this.ufFrozen = this.uf;
    this.ubFrozen = this.ub;
    this.frozen = true;
  }

  private startMeasurement(): void {
    this.freeze();
    this.measuring = true;
    this.tMeasure0 = this.sim.time;
    this.nextSample = this.sim.time;
    this.wall0 = this.wallTally();
    this.ceiling0 = this.sim.bodies.map((b) => ({ x: b.impulseX, y: b.impulseY, hits: b.totalHits, nor: b.normalImpulse.slice() }));
    this.fringeE0 = this.fringeE;
    this.fringePx0 = this.fringePx;
    this.fringePy0 = this.fringePy;
    this.fringeN0 = this.fringeN;
    this.nearWall.addCollisions(this.sim.log, 2 * this.c.radius, this.sim.time);
    this.outer.addCollisions(this.sim.log, 2 * this.c.radius, this.sim.time);
    this.blockStartTally = this.blockTally();
  }

  private blockTally(): Float64Array[] {
    const w = this.sim.walls[0];
    return [w.tangentialImpulse.slice(), w.normalImpulse.slice(), w.hits.slice()];
  }

  private closeBlock(): void {
    const now = this.blockTally();
    const s = this.blockStartTally!;
    const d = (k: number) => Array.from(now[k], (v, b) => v - s[k][b]);
    this.blockWall.push({ tangentialImpulse: d(0), normalImpulse: d(1), hits: d(2) });
    this.blockStartTally = now;
  }

  private sampleSeries(): void {
    const sim = this.sim;
    const ke = sim.store.kineticEnergy();
    const p = sim.store.momentum();
    const M = sim.store.totalMass();
    const keDrift = (0.5 * (p.x * p.x + p.y * p.y)) / M;
    const w = sim.walls[0];
    let plate = 0;
    for (let b = 0; b < w.tangentialImpulse.length; b++) plate += w.tangentialImpulse[b];
    let ceil = 0;
    for (const b of sim.bodies) ceil += b.impulseX;
    const S = this.series;
    S.t.push(sim.time);
    S.kinetic.push(ke);
    S.kT.push((ke - keDrift) / sim.store.count);
    S.plateImpulseX.push(plate);
    S.fringeMomentumX.push(this.fringePx);
    S.fringeEnergy.push(this.fringeE);
    S.ceilingImpulseX.push(ceil);
    S.energyResidual.push(sim.relativeEnergyResidual());
  }

  private captureFrame(): void {
    const f = this.c.frames!;
    const s = this.sim.store;
    const p: number[] = [];
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (let i = 0; i < s.count; i++) {
      if (s.x[i] < f.x0 || s.x[i] >= f.x1 || s.y[i] >= f.height) continue;
      p.push(r2(s.x[i]), r2(s.y[i]), r2(s.vx[i]), r2(s.vy[i]));
    }
    this.frames.push({ t: this.sim.time, p });
  }

  advance(maxSteps: number): number {
    const c = this.c;
    const sim = this.sim;
    const end = c.startupTime + c.measurementTime;
    let k = 0;
    while (k < maxSteps && !this.done) {
      if (!sim.step()) {
        this.finish();
        break;
      }
      this.applyFringe(sim.lastDt);
      k++;
      this.steps++;
      const t = sim.time;
      if (t >= this.nextEmpty) {
        this.empty.sample();
        this.nextEmpty += EMPTY_SPACE_INTERVAL;
      }
      if (t >= this.nextSeries) {
        this.sampleSeries();
        this.nextSeries += c.seriesInterval;
      }
      if (!this.measuring && t >= this.nextControl) {
        this.control();
        this.nextControl += c.control.interval;
      }
      if (!this.measuring && t >= c.startupTime) {
        this.startMeasurement();
        if (c.frames) this.nextFrame = t + c.measurementTime - c.frames.count * c.frames.interval;
      }
      if (this.measuring) {
        const blockLen = c.measurementTime / c.blocks;
        while (this.block < c.blocks - 1 && t >= this.tMeasure0 + (this.block + 1) * blockLen) {
          this.closeBlock();
          this.block++;
        }
        if (t >= this.nextSample) {
          this.nearWall.add(sim.store);
          this.outer.add(sim.store);
          this.fine.add(sim.store);
          this.blockGrids[this.block].add(sim.store);
          this.nearWall.addCollisions(sim.log, 2 * c.radius, t);
          this.outer.addCollisions(sim.log, 2 * c.radius, t);
          this.pxSum += this.leadIn().Q;
          this.pxN++;
          this.nextSample += c.sampleInterval;
          if (this.nearWall.snapshots % 50 === 0) this.conservation.sample();
        }
        if (c.frames && this.frames.length < c.frames.count && t >= this.nextFrame) {
          this.captureFrame();
          this.nextFrame += c.frames.interval;
        }
        if (t >= end) this.finish();
      }
    }
    return k;
  }

  private finish(): void {
    if (this.done) return;
    if (this.measuring) this.closeBlock();
    this.sim.checkSafety();
    this.conservation.sample();
    this.empty.sample();
    this.sampleSeries();
    this.done = true;
  }

  progress(): number {
    return Math.min(1, this.sim.time / (this.c.startupTime + this.c.measurementTime));
  }

  live(): Record<string, number | string> {
    const s = this.sim.store;
    return {
      phase: this.measuring ? 'measure' : 'start-up',
      time: this.sim.time,
      particles: s.count,
      meanVelocity: s.momentum().x / s.totalMass(),
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): WallFlowRunResult {
    const c = this.c;
    const end = this.wallTally();
    const w0 = this.wall0 ?? end;
    const diff = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
    const total: WallTally = {
      hits: diff(end.hits, w0.hits),
      normalImpulse: diff(end.normalImpulse, w0.normalImpulse),
      tangentialImpulse: diff(end.tangentialImpulse, w0.tangentialImpulse),
      energyIn: diff(end.energyIn, w0.energyIn),
      incidentTangential: diff(end.incidentTangential, w0.incidentTangential),
      emittedTangential: diff(end.emittedTangential, w0.emittedTangential),
      diffuseHits: diff(end.diffuseHits, w0.diffuseHits),
    };
    return {
      label: c.label,
      seed: this.seed,
      config: c,
      particles: this.particles,
      fluidArea: this.geometry.fluidArea,
      numberDensity: this.particles / this.geometry.fluidArea,
      heightOut: this.geometry.heightOut,
      measurementStart: this.tMeasure0,
      measurementTime: this.measuring ? this.sim.time - this.tMeasure0 : 0,
      steps: this.steps,
      wallSeconds: (Date.now() - this.t0) / 1000,
      nearWall: this.nearWall.data(),
      outer: this.outer.data(),
      fine: this.fine.data(),
      blocks: this.blockGrids.map((g) => g.data()),
      floor: { bin: c.wallBin, total, blocks: this.blockWall },
      ceiling: this.sim.bodies.map((b, k) => {
        const z = this.ceiling0[k] ?? { x: 0, y: 0, hits: 0, nor: new Float64Array(b.normalImpulse.length) };
        return {
          name: b.config.name,
          impulseX: b.impulseX - z.x,
          impulseY: b.impulseY - z.y,
          hits: b.totalHits - z.hits,
          normalImpulse: Array.from(b.normalImpulse, (v, i) => v - z.nor[i]),
          binLength: b.config.binLength ?? 1,
        };
      }),
      fringe: {
        energyIn: this.fringeE - this.fringeE0,
        momentumX: this.fringePx - this.fringePx0,
        momentumY: this.fringePy - this.fringePy0,
        resamplings: this.fringeN - this.fringeN0,
        moves: this.fringeMoves,
        energyInTotal: this.fringeE,
        momentumXTotal: this.fringePx,
        drift: this.ufFrozen,
        exitDrift: this.ubFrozen,
      },
      massFlux: { measured: this.pxN > 0 ? this.pxSum / this.pxN : Number.NaN, target: this.n0 * c.mass * c.speed * c.heightIn },
      series: this.series,
      ledger: this.sim.ledger.toJSON(),
      conservation: this.conservation.summary(),
      collisions: this.sim.log.summary(),
      emptySpace: this.empty.summary(),
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
      frames: this.frames,
    };
  }
}
