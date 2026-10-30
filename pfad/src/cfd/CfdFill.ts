import { cfdGapAt, type CfdGapStation } from '../geometry/PointerMeasure';
import { addPointerPoint, anchorOf, clonePaths, DEFAULT_POINTER_STEP, planPointerStep, plateGeometry, pointerOf, type PlateSpec, type PointerPaths, type PointerStepConfig, type Pt } from '../geometry/Pointer';
import { bodyPolygon, place, type Side, type SurfaceGeometry } from '../geometry/SurfaceGeometry';
import { CfdRun, profileSpec, type CfdParams } from './CfdRun';
import type { LbmSolver } from './Lbm';
import { rasterize } from './Raster';
import { dividingStreamline, sampleProfiles, wallStations, type ProfileSpec } from './Walls';

/**
 * AUTO FILL for the CFD workspace: the construction pointer moves by itself while ONE CFD run goes on.
 *
 * The flow develops around the starting body. Then, again and again: the velocity is averaged over a short window, the dividing
 * streamline of the reversed flow beside the surface gives the gap between the surface and the flow along the side, the same
 * pointer rule as the measured step of the workspace (planPointerStep) moves the pointer one step toward the trailing-edge anchor
 * and up by a fraction of the gap above it, the body is redrawn through the new pointer position, rasterised again and handed to the
 * running solver (LbmSolver.reshape), and the flow is given time to adjust before the next window. The pointer stops at the anchor
 * (ONE PASS: a station is passed once and never filled again, so the surface cannot keep growing after a vortex that a surface
 * does not close), or when it is asked to stop and keep what it has drawn.
 *
 * The result is a SHAPE (the pointer paths) and the story of how it was drawn. It is not a measurement of that shape: the
 * flow around a body that changed during the run is a transient, and the time-mean forces and wall shear of the final shape
 * need an ordinary run on it, which the workspace starts next. Conventional CFD (lattice Boltzmann); nothing about a classical
 * airfoil, a Kutta condition or a target shape is used; the anchor is a construction constraint, not a flow law. EXPERIMENTAL.
 */
export interface CfdFillConfig {
  side: Side;
  /** convective times of start-up on the starting body before the first measurement window (absent: the run's own warm-up) */
  develop?: number;
  /** convective times the flow is left to adjust after each move before the window that decides the next one */
  settle: number;
  /** convective times averaged for each decision */
  window: number;
  step: PointerStepConfig;
  /** the most moves in one fill */
  maxMoves: number;
}

export const DEFAULT_CFD_FILL: CfdFillConfig = { side: 'upper', settle: 1, window: 1.5, step: DEFAULT_POINTER_STEP, maxMoves: 40 };

export type CfdFillStop = 'anchor' | 'nothing-measured' | 'limit' | 'user' | 'failed';

export interface CfdFillMove {
  n: number;
  /** convective time of the decision */
  t: number;
  from: Pt;
  to: Pt;
  /** the height of the surface at the pointer's next x, the measured gap above it and the rise that followed */
  surface: number;
  gap: number;
  rise: number;
  /** stations of the side with a dividing streamline in this window, and the tallest */
  reversedStations: number;
  maxH: number;
  note: string;
}

export interface CfdFillResult {
  schema: 'pfad-cfd-fill/1';
  side: Side;
  plate: PlateSpec;
  spacing: number;
  startPaths: PointerPaths;
  paths: PointerPaths;
  geometry: SurfaceGeometry;
  moves: CfdFillMove[];
  stop: { kind: CfdFillStop; reason: string };
  config: CfdFillConfig;
  /** the run's own set-up (everything but the geometry) */
  params: Omit<CfdParams, 'geometry'>;
  steps: number;
  convective: number;
  /** a stability monitor of the run: the largest lattice Mach number seen at the decisions, and whether the state stayed finite */
  maxMach: number;
  finite: boolean;
  /** the total height added to the surface (sum of the rises) [d] */
  totalRise: number;
}

export class CfdFillRun {
  readonly p: CfdParams;
  readonly cfg: CfdFillConfig;
  readonly plate: PlateSpec;
  readonly spacing: number;
  readonly base: CfdRun;
  readonly startPaths: PointerPaths;
  private paths: PointerPaths;
  private geometry: SurfaceGeometry;
  private readonly spec: ProfileSpec;
  private readonly rho: Float64Array;
  private readonly ux: Float64Array;
  private readonly uy: Float64Array;
  private readonly sRho: Float64Array;
  private readonly sUx: Float64Array;
  private readonly sUy: Float64Array;
  private nSamples = 0;
  private readonly conv: number;
  private readonly developSteps: number;
  private readonly settleSteps: number;
  private readonly windowSteps: number;
  private readonly expectedMoves: number;
  private phaseStart = 0;
  private maxMach = 0;
  private finite = true;
  private stopped: { kind: CfdFillStop; reason: string } | null = null;
  readonly moves: CfdFillMove[] = [];
  /** 'develop' | 'settle' | 'measure' | 'done' */
  phase: 'develop' | 'settle' | 'measure' | 'done' = 'develop';

  constructor(p: CfdParams, plate: PlateSpec, paths: PointerPaths, spacing: number, cfg: CfdFillConfig = DEFAULT_CFD_FILL) {
    if (!(cfg.settle >= 0) || !(cfg.window > 0)) throw new Error('the fill needs a positive averaging window');
    this.p = p;
    this.cfg = cfg;
    this.plate = plate;
    this.spacing = spacing;
    this.startPaths = clonePaths(paths);
    this.paths = clonePaths(paths);
    this.geometry = plateGeometry(plate, this.paths, spacing);
    this.base = new CfdRun({ ...p, geometry: this.geometry });
    this.spec = profileSpec(p.cells);
    const N = this.base.nx * this.base.ny;
    this.rho = new Float64Array(N);
    this.ux = new Float64Array(N);
    this.uy = new Float64Array(N);
    this.sRho = new Float64Array(N);
    this.sUx = new Float64Array(N);
    this.sUy = new Float64Array(N);
    this.conv = this.base.conv;
    this.developSteps = Math.round((cfg.develop ?? p.warmup) * this.conv);
    this.settleSteps = Math.round(cfg.settle * this.conv);
    this.windowSteps = Math.max(p.sampleEvery, Math.round(cfg.window * this.conv));
    const from = pointerOf(this.paths, cfg.side);
    this.expectedMoves = Math.max(1, Math.min(cfg.maxMoves, Math.ceil((anchorOf(plate, this.paths, cfg.side).x - from.x) / cfg.step.step - 1e-9)));
    if (from.x >= anchorOf(plate, this.paths, cfg.side).x - 1e-9) {
      this.stopped = { kind: 'anchor', reason: 'the pointer of this side is already at the trailing-edge anchor: there is nothing to draw' };
      this.phase = 'done';
    }
  }

  // ---- what the worker needs of a run
  get solver() {
    return this.base.solver;
  }
  /** the fill is computed on the CPU solver (it moves the body inside the running flow); a run on the graphics card has none */
  private get cpuSolver(): LbmSolver {
    return this.base.solver as LbmSolver;
  }
  get nx() {
    return this.base.nx;
  }
  get ny() {
    return this.base.ny;
  }
  get cpu() {
    return this.base.cpu;
  }
  get tau() {
    return this.base.tau;
  }
  get time(): number {
    return this.base.solver.steps / this.conv;
  }
  snapshot(kind: 'speed' | 'vorticity' | 'pressure' | 'total' | 'ux' | 'uy', stride: number) {
    return this.base.snapshot(kind, stride);
  }
  progress(): number {
    if (this.phase === 'done') return 1;
    const dev = Math.min(1, this.base.solver.steps / Math.max(1, this.developSteps)) * 0.15;
    return Math.min(0.99, dev + 0.85 * (this.moves.length / this.expectedMoves));
  }
  live() {
    const last = this.moves[this.moves.length - 1];
    return {
      phase: this.phase === 'develop' ? 'fill: developing the flow' : this.phase === 'settle' ? 'fill: the flow adjusts' : this.phase === 'measure' ? 'fill: measuring the gap' : 'fill: finished',
      steps: this.base.solver.steps,
      convective: this.time,
      blocks: `${this.moves.length}/${this.expectedMoves} moves`,
      fx: this.base.solver.fx,
      fy: this.base.solver.fy,
      ...(last ? { lastGap: last.gap, lastRise: last.rise } : {}),
    };
  }
  /** the body as it is now, and the pointer, for the picture of a fill in progress */
  fillState(): { geometry: SurfaceGeometry; paths: PointerPaths; pointer: Pt; moves: number; lastGap: number | null; lastRise: number | null } {
    const last = this.moves[this.moves.length - 1];
    return { geometry: this.geometry, paths: this.paths, pointer: pointerOf(this.paths, this.cfg.side), moves: this.moves.length, lastGap: last ? last.gap : null, lastRise: last ? last.rise : null };
  }

  /** End the fill now and keep the shape drawn so far (the person pressed STOP AND KEEP). */
  finishEarly(): void {
    if (this.phase === 'done') return;
    this.finish('user', `you stopped it after ${this.moves.length} of about ${this.expectedMoves} moves: the shape drawn so far is kept`);
  }

  private finishAtAnchor() {
    const rise = this.moves.reduce((a, q) => a + q.rise, 0);
    if (rise < 1e-9) this.finish('nothing-measured', 'the pointer went all the way to the anchor without ever finding reversed flow beside the surface to fill: nothing was added');
    else this.finish('anchor', `the pointer reached the trailing-edge anchor: one pass is complete (${this.moves.length} moves, ${rise.toFixed(2)} d of rise in all)`);
  }

  private finish(kind: CfdFillStop, reason: string) {
    this.stopped = { kind, reason };
    this.phase = 'done';
  }

  advance(maxSteps: number): number {
    let k = 0;
    const s = this.base.solver;
    while (k < maxSteps && this.phase !== 'done') {
      if (!s.step()) {
        this.finite = false;
        this.finish('failed', 'the simulation became unstable');
        break;
      }
      k++;
      const t = s.steps;
      if (this.phase === 'develop') {
        if (t >= this.developSteps) this.beginMeasure(t);
      } else if (this.phase === 'settle') {
        if (t - this.phaseStart >= this.settleSteps) this.beginMeasure(t);
      } else if (this.phase === 'measure') {
        if ((t - this.phaseStart) % this.p.sampleEvery === 0) this.sample();
        if (t - this.phaseStart >= this.windowSteps) this.decide();
      }
    }
    return k;
  }

  private beginMeasure(t: number) {
    this.phase = 'measure';
    this.phaseStart = t;
    this.sRho.fill(0);
    this.sUx.fill(0);
    this.sUy.fill(0);
    this.nSamples = 0;
  }

  private sample() {
    this.base.solver.fields(this.rho, this.ux, this.uy);
    const N = this.rho.length;
    for (let n = 0; n < N; n++) {
      this.sRho[n] += this.rho[n];
      this.sUx[n] += this.ux[n];
      this.sUy[n] += this.uy[n];
    }
    this.nSamples++;
  }

  /** the window is over: measure the gap along the side, move the pointer, redraw the body, hand it to the solver */
  private decide() {
    const b = this.base;
    const m = Math.max(1, this.nSamples);
    for (let n = 0; n < this.sRho.length; n++) {
      this.sRho[n] /= m;
      this.sUx[n] /= m;
      this.sUy[n] /= m;
    }
    const mon = this.cpuSolver.monitor();
    this.maxMach = Math.max(this.maxMach, mon.maxSpeed * Math.sqrt(3));
    if (!mon.finite) return this.finish('failed', 'the state became non-finite');
    const side = this.cfg.side;
    const st = wallStations(this.geometry, b.placement, b.cpu)[side];
    const prof = sampleProfiles(this.sUx, this.sUy, this.sRho, b.solver.solid, b.nx, b.ny, st, this.spec);
    const stations: CfdGapStation[] = st.map((w, k) => {
      const d = dividingStreamline(prof.ut[k], this.spec.first, this.spec.step);
      return { x: w.x, h: d.h !== null ? { mean: d.h / b.cpu } : null, hShare: d.h !== null ? 1 : 0 };
    });
    const reversed = stations.filter((q) => q.h);
    const maxH = reversed.length ? Math.max(...reversed.map((q) => q.h!.mean)) : 0;
    const from = pointerOf(this.paths, side);
    const next = planPointerStep(this.plate, this.paths, side, cfdGapAt(stations, this.plate), this.cfg.step);
    if (!next) return this.finishAtAnchor();
    const added = addPointerPoint(this.plate, this.paths, side, next.to, this.cfg.step.limits);
    if (!added.ok) return this.finish('limit', `the next move is not allowed: ${added.reason}`);
    this.paths = added.paths;
    this.geometry = plateGeometry(this.plate, this.paths, this.spacing);
    const poly = place(bodyPolygon(this.geometry), b.placement).map((v) => v * b.cpu);
    const r = rasterize(b.nx, b.ny, poly);
    this.cpuSolver.reshape(r.solid, r.wallQ);
    this.moves.push({ n: this.moves.length + 1, t: this.time, from, to: next.to, surface: next.surface, gap: next.gap, rise: next.rise, reversedStations: reversed.length, maxH, note: next.note });
    if (next.atAnchor) return this.finishAtAnchor();
    if (this.moves.length >= this.cfg.maxMoves) return this.finish('limit', `the limit of ${this.cfg.maxMoves} moves was reached before the anchor`);
    this.phase = 'settle';
    this.phaseStart = b.solver.steps;
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  result(): CfdFillResult {
    const { geometry, ...params } = this.p;
    void geometry;
    const totalRise = this.moves.reduce((a, q) => a + q.rise, 0);
    return {
      schema: 'pfad-cfd-fill/1',
      side: this.cfg.side,
      plate: this.plate,
      spacing: this.spacing,
      startPaths: this.startPaths,
      paths: this.paths,
      geometry: this.geometry,
      moves: this.moves,
      stop: this.stopped ?? { kind: 'user', reason: 'not finished' },
      config: this.cfg,
      params,
      steps: this.base.solver.steps,
      convective: this.time,
      maxMach: this.maxMach,
      finite: this.finite,
      totalRise,
    };
  }
}

