import type { Simulation } from '../core/Simulation';
import type { ExperimentType, SequentialExperiment } from '../experiments/Experiment';
import { EXPERIMENTS } from '../experiments/registry';
import { UBInstrumentExperiment, type UBInstrumentCheckpoint } from '../experiments/UBInstrumentExperiment';
import { FieldAverager } from '../measurements/FieldAverager';
import { OccupancyField } from '../occupancy/OccupancyField';
import type { ValidationStatus } from '../validation/Status';
import type { FieldKind, Frame, FromWorker, InspectData, ProfileRequest, ToWorker } from '../workers/protocol';
import { ProfileAccumulator } from './profiles';
import { SeriesRecorder } from './series';
import { TransferMonitor } from './transfer';

/**
 * One laboratory session: owns an experiment from the registry (the real
 * engine), advances it in time slices and produces render frames, records and
 * status messages. It has no DOM or worker dependency; the simulation worker
 * is a thin adapter around it, and tests drive it directly.
 *
 * Simulation rate and render rate are decoupled (Master prompt §35): the host
 * calls `tick()` repeatedly; a frame is emitted at most every `frameMs`.
 */
export type Clock = () => number;

export class LabSession {
  private readonly emit: (msg: FromWorker, transfer?: Transferable[]) => void;
  private readonly now: Clock;
  readonly frameMs: number;

  private experiment: SequentialExperiment<unknown, unknown> | null = null;
  running = false;
  finished = false;
  private field: FieldKind = 'none';
  private perCell = 25;
  private average = true;
  private averager: FieldAverager | null = null;
  private averagerSim: Simulation | null = null;
  private fieldT0 = 0;
  private trails = false;
  private inspected: number | null = null;
  private trajectory: number[] = [];
  private lastSim: Simulation | null = null;
  private stepsTotal = 0;
  private rateWindow: { t: number; steps: number }[] = [];
  private lastStepMs = 0;
  private readonly history = new SeriesRecorder(1500);
  private lastHistoryT = -Infinity;
  private transfer: TransferMonitor | null = null;
  private profileReq: ProfileRequest | null = null;
  private profile: ProfileAccumulator | null = null;
  private profileSim: Simulation | null = null;
  private recordStatus: ValidationStatus | null = null;
  private epoch = 0;
  private activeMs = 0;
  private lastFrame = -Infinity;
  stepsPerSlice = 50;

  constructor(emit: (msg: FromWorker, transfer?: Transferable[]) => void, opts: { now?: Clock; frameMs?: number } = {}) {
    this.emit = emit;
    this.now = opts.now ?? (() => performance.now());
    this.frameMs = opts.frameMs ?? 33;
  }

  get loaded(): boolean {
    return this.experiment !== null;
  }

  private currentSim(): Simulation | null {
    return this.experiment?.currentRun()?.sim ?? this.lastSim;
  }

  handle(m: ToWorker): void {
    try {
      switch (m.type) {
        case 'init':
          this.init(m.experiment, m.params, m.epoch, m.resume);
          break;
        case 'run':
          if (this.experiment && !this.finished) this.running = true;
          break;
        case 'pause':
          this.running = false;
          this.frame(true);
          break;
        case 'step':
          this.running = false;
          this.advance(m.steps);
          this.frame(true);
          break;
        case 'stop':
          this.running = false;
          if (this.experiment && !this.finished) {
            this.finished = true;
            this.emit({ type: 'stopped', message: 'Stopped by user: the experiment is incomplete and produced no record.', epoch: this.epoch, activeMs: this.activeMs });
          }
          this.frame(true);
          break;
        case 'inspect':
          this.inspected = m.index;
          this.trajectory = [];
          this.frame(true);
          break;
        case 'view': {
          if (m.perCell !== this.perCell || m.average !== this.average || m.field !== this.field) this.averager = null;
          this.field = m.field;
          this.perCell = m.perCell;
          this.average = m.average;
          this.trails = m.trails;
          const req = m.profile ?? null;
          if (JSON.stringify(req) !== JSON.stringify(this.profileReq)) {
            this.profileReq = req;
            this.profile = null;
          }
          this.frame(true);
          break;
        }
        case 'resetAverage': {
          this.averager = null;
          this.profile = null;
          const sim = this.currentSim();
          this.transfer = sim ? new TransferMonitor(sim) : null;
          this.frame(true);
          break;
        }
        case 'checkpoint':
          this.running = false;
          if (!(this.experiment instanceof UBInstrumentExperiment)) throw new Error('this experiment does not support checkpoints (only the UB-0 instrument does)');
          if (this.finished) throw new Error('the experiment has finished; there is nothing to resume');
          this.emit({ type: 'checkpoint', state: this.experiment.checkpoint(), epoch: this.epoch, activeMs: this.activeMs });
          this.frame(true);
          break;
        case 'unload':
          this.epoch = m.epoch;
          this.running = false;
          this.experiment = null;
          this.lastSim = null;
          this.averager = null;
          this.finished = false;
          this.recordStatus = null;
          break;
      }
    } catch (e) {
      this.running = false;
      this.emit({ type: 'error', message: (e as Error).message, epoch: this.epoch });
    }
  }

  private init(type: ExperimentType, params: unknown, epoch: number, resume?: unknown) {
    const entry = EXPERIMENTS[type];
    this.epoch = epoch;
    this.experiment = null;
    if (!entry) throw new Error(`experiment ${type} is not implemented`);
    this.experiment = resume !== undefined ? UBInstrumentExperiment.resume(resume as UBInstrumentCheckpoint) : entry.create(params);
    this.running = false;
    this.finished = false;
    this.stepsTotal = this.experiment.steps;
    this.inspected = null;
    this.trajectory = [];
    this.history.reset();
    this.lastHistoryT = -Infinity;
    this.lastSim = null;
    this.recordStatus = null;
    this.averager = null;
    this.profile = null;
    this.transfer = null;
    this.activeMs = 0;
    this.stepsPerSlice = 50;
    this.frame(true);
  }

  /** One host slice: advance ~12 ms of simulation when running, then maybe emit a frame. */
  tick(): void {
    if (!this.running) return;
    const t0 = this.now();
    this.advance(this.stepsPerSlice);
    const ms = this.now() - t0;
    if (ms < 8) this.stepsPerSlice = Math.min(20000, Math.ceil(this.stepsPerSlice * 1.25));
    else if (ms > 16) this.stepsPerSlice = Math.max(1, Math.floor(this.stepsPerSlice * 0.8));
    this.frame();
  }

  advance(steps: number): void {
    const x = this.experiment;
    if (!x || this.finished) return;
    const before = x.currentRun()?.sim;
    if (before) this.lastSim = before;
    const t0 = this.now();
    let taken = 0;
    try {
      taken = x.advance(steps);
    } catch (e) {
      this.running = false;
      this.finished = true;
      this.activeMs += this.now() - t0;
      this.emit({ type: 'failed', message: `simulation failed: ${(e as Error).message}`, epoch: this.epoch, activeMs: this.activeMs });
      this.frame(true);
      return;
    }
    this.lastStepMs = this.now() - t0;
    this.activeMs += this.lastStepMs;
    this.stepsTotal += taken;
    this.rateWindow.push({ t: this.now(), steps: taken });
    const sim = this.currentSim();
    if (sim && sim !== before) {
      // a new run (or run phase) started: per-run state restarts
      this.trajectory = [];
      this.history.reset();
      this.lastHistoryT = -Infinity;
    }
    if (sim && this.inspected !== null && this.inspected < sim.store.count && this.trails) {
      this.trajectory.push(sim.store.x[this.inspected], sim.store.y[this.inspected]);
      if (this.trajectory.length > 4000) this.trajectory.splice(0, this.trajectory.length - 4000);
    }
    if (x.done && !this.finished) {
      this.finished = true;
      this.running = false;
      try {
        const t1 = this.now();
        const record = x.buildRecord();
        this.activeMs += this.now() - t1;
        this.recordStatus = record.status;
        this.emit({ type: 'record', record, epoch: this.epoch, activeMs: this.activeMs });
      } catch (e) {
        this.emit({ type: 'failed', message: `analysis failed: ${(e as Error).message}`, epoch: this.epoch, activeMs: this.activeMs });
      }
      this.frame(true); // the final state, at 100 %
    }
  }

  private computeField(sim: Simulation) {
    if (this.field === 'none') return { data: null, ms: 0 };
    const t0 = this.now();
    if (!this.average || !this.averager || this.averagerSim !== sim) {
      this.averager = FieldAverager.forParticlesPerCell(sim.domain, sim.store.count, this.perCell);
      this.averagerSim = sim;
      this.fieldT0 = sim.time;
    }
    const av = this.averager;
    av.add(sim.store);
    let note: string | undefined;
    if (this.field === 'pressure' || this.field === 'shear') {
      av.addCollisions(sim.log, 2 * (sim.store.count > 0 ? sim.store.radius[0] : 0.5), sim.time);
      note =
        av.collisionTime > 0
          ? `kinetic + collisional stress (${av.collisionsUsed} collisions over t = ${av.collisionTime.toPrecision(3)}${av.collisionsLost ? `, ${av.collisionsLost} events lost from the log` : ''})`
          : 'kinetic part only — the collisional part needs time-averaging over several frames';
    }
    const f = av.field(this.field);
    const values = new Float32Array(f);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let c = 0; c < values.length; c++) {
      if (values[c] < min) min = values[c];
      if (values[c] > max) max = values[c];
      sum += values[c];
    }
    const data = {
      kind: this.field,
      nx: av.nx,
      ny: av.ny,
      values,
      min,
      max,
      mean: sum / values.length,
      snapshots: av.snapshots,
      particlesPerCell: av.meanParticlesPerCell(),
      note,
      t0: this.fieldT0,
      t1: sim.time,
    };
    if (!this.average) this.averager = null;
    return { data, ms: this.now() - t0 };
  }

  private computeProfile(sim: Simulation) {
    const req = this.profileReq;
    if (!req) return null;
    if (!this.profile || this.profileSim !== sim) {
      const d = sim.domain;
      const x0 = Math.max(d.xmin, Math.min(req.x0, req.x1));
      const x1 = Math.min(d.xmax, Math.max(req.x0, req.x1));
      if (!(x1 > x0)) return null;
      this.profile = new ProfileAccumulator({ x0, x1, ymin: d.ymin, ymax: d.ymax }, req.bins);
      this.profileSim = sim;
    }
    this.profile.sample(sim.store);
    return this.profile.result();
  }

  private inspect(sim: Simulation): InspectData | null {
    const i = this.inspected;
    if (i === null || i >= sim.store.count) return null;
    const s = sim.store;
    const f = new OccupancyField(sim.domain, Math.max(4, Math.round(sim.domain.width / 8)), Math.max(4, Math.round(sim.domain.height / 8)));
    f.compute(s);
    const c = f.cellIndex(s.x[i], s.y[i]);
    const cx = c % f.nx;
    const cy = Math.floor(c / f.nx);
    const at = (x: number, y: number) => f.phi[Math.min(f.ny - 1, Math.max(0, y)) * f.nx + Math.min(f.nx - 1, Math.max(0, x))];
    return {
      index: i,
      id: s.id[i],
      x: s.x[i],
      y: s.y[i],
      vx: s.vx[i],
      vy: s.vy[i],
      mass: s.mass[i],
      radius: s.radius[i],
      kineticEnergy: 0.5 * s.mass[i] * (s.vx[i] ** 2 + s.vy[i] ** 2),
      internalEnergy: s.energy[i],
      collisions: s.collisions[i],
      wallHits: s.wallHits[i],
      localOccupancy: f.phi[c],
      occupancyGradient: [(at(cx + 1, cy) - at(cx - 1, cy)) / (2 * f.cellW), (at(cx, cy + 1) - at(cx, cy - 1)) / (2 * f.cellH)],
      recentCollisions: sim.log.eventsInvolving(i, 12).map((e) => ({ t: e.t, partner: e.i === i ? e.j : e.i, J: e.J, vn: e.vn, dKE: e.dKE })),
      trajectory: this.trajectory.slice(),
    };
  }

  /** Emit a frame if `frameMs` has passed (or always, when forced). Returns it for tests. */
  frame(force = false): Frame | null {
    const now = this.now();
    if (!force && now - this.lastFrame <= this.frameMs) return null;
    this.lastFrame = now;
    const x = this.experiment;
    if (!x) return null;
    const sim = this.currentSim();
    if (!sim) return null;
    const s = sim.store;
    const n = s.count;
    const positions = new Float32Array(2 * n);
    const velocities = new Float32Array(2 * n);
    const radii = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions[2 * i] = s.x[i];
      positions[2 * i + 1] = s.y[i];
      velocities[2 * i] = s.vx[i];
      velocities[2 * i + 1] = s.vy[i];
      radii[i] = s.radius[i];
    }
    const nc = Math.min(sim.log.retained, 400);
    const collisions = new Float32Array(2 * nc);
    for (let k = 0; k < nc; k++) {
      const e = sim.log.recent(k);
      collisions[2 * k] = e.x;
      collisions[2 * k + 1] = e.y;
    }
    const { data: fieldData, ms: fieldMs } = this.computeField(sim);
    if (!this.transfer || this.transfer.sim !== sim) this.transfer = new TransferMonitor(sim);
    const transfer = this.transfer.read();
    const profile = this.computeProfile(sim);
    const run = x.currentRun();
    const live = run ? run.live() : {};
    const energyError = sim.relativeEnergyResidual();
    const momentumError = sim.relativeMomentumResidual();
    if (sim.time > this.lastHistoryT) {
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(live)) if (typeof v === 'number') values[k] = v;
      values['energy residual (rel.)'] = energyError;
      values['momentum residual (rel.)'] = momentumError;
      transfer?.walls.forEach((w) => (values[`P_wall ${w.side} (running mean)`] = w.pressure));
      transfer?.bodies.forEach((b, i) => {
        values[`F_x body ${i} (running mean)`] = b.fx;
        values[`F_y body ${i} (running mean)`] = b.fy;
      });
      this.history.push(sim.time, values);
      this.lastHistoryT = sim.time;
    }
    this.rateWindow = this.rateWindow.filter((r) => now - r.t < 1000);
    const stepsPerSecond = this.rateWindow.reduce((a, r) => a + r.steps, 0);
    const frame: Frame = {
      type: 'frame',
      epoch: this.epoch,
      runLabel: run?.label ?? 'finished',
      runIndex: x.runIndex,
      runCount: x.specs.length,
      progress: x.progress(),
      running: this.running,
      finished: this.finished,
      status: this.running ? 'RUNNING' : (this.recordStatus ?? 'UNTESTED'),
      domain: sim.domain.toSpec(),
      walls: sim.walls.map((w) => ({
        side: w.config.side,
        accommodation: w.config.accommodation,
        tangentialVelocity: w.config.tangentialVelocity,
        segments: w.config.segments.map((sg) => ({ from: sg.from, to: sg.to, accommodation: sg.accommodation })),
      })),
      openSides: sim.boundaries.map((b) => b.config.side),
      bodies: sim.bodies.map((b) => ({ vertices: b.config.vertices, accommodation: b.accommodation.reduce((a, v) => a + v, 0) / b.accommodation.length })),
      count: n,
      positions,
      velocities,
      radii,
      collisions,
      field: fieldData,
      transfer,
      profile,
      history: this.history.snapshot(),
      activeMs: this.activeMs,
      checkpointable: x instanceof UBInstrumentExperiment && !this.finished,
      live,
      perf: {
        stepsPerSecond,
        stepMsPerFrame: this.lastStepMs,
        fieldMs,
        time: sim.time,
        dt: sim.lastDt,
        maxSpeed: s.maxSpeed(),
        energyError,
        momentumError,
        collisionCount: sim.log.count,
        steps: this.stepsTotal,
      },
      flags: sim.flags,
      inspected: this.inspect(sim),
    };
    const transferList: Transferable[] = [positions.buffer, velocities.buffer, radii.buffer, collisions.buffer];
    if (fieldData) transferList.push(fieldData.values.buffer);
    this.emit(frame, transferList);
    return frame;
  }
}
