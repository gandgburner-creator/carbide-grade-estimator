/// <reference lib="webworker" />
import type { Simulation } from '../core/Simulation';
import type { SequentialExperiment } from '../experiments/Experiment';
import { EXPERIMENTS } from '../experiments/registry';
import { FieldAverager } from '../measurements/FieldAverager';
import { OccupancyField } from '../occupancy/OccupancyField';
import type { ValidationStatus } from '../validation/Status';
import type { FieldKind, FromWorker, InspectData, ToWorker } from './protocol';

/**
 * Simulation worker: owns the experiment, advances it in time slices, and
 * posts render frames at most ~30 times per second. Simulation rate and render
 * rate are decoupled (Master prompt §35).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;

let experiment: SequentialExperiment<unknown, unknown> | null = null;
let running = false;
let finished = false;
let field: FieldKind = 'none';
let perCell = 25;
let average = true;
let averager: FieldAverager | null = null;
let averagerSim: Simulation | null = null;
let trails = false;
let inspected: number | null = null;
let trajectory: number[] = [];
let lastSim: Simulation | null = null;
let stepsTotal = 0;
let rateWindow: { t: number; steps: number }[] = [];
let lastStepMs = 0;
const series: { t: number; c: number; value: number; label: string }[] = [];
let lastSeriesT = -Infinity;
let recordStatus: ValidationStatus | null = null;
let epoch = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function currentSim(): Simulation | null {
  return experiment?.currentRun()?.sim ?? lastSim;
}

function computeField(sim: Simulation) {
  if (field === 'none') return { data: null, ms: 0 };
  const t0 = performance.now();
  if (!average || !averager || averagerSim !== sim) {
    averager = FieldAverager.forParticlesPerCell(sim.domain, sim.store.count, perCell);
    averagerSim = sim;
  }
  averager.add(sim.store);
  const f = averager.field(field === 'speed' ? 'speed' : field);
  const n = f.length;
  const values = new Float32Array(f);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let c = 0; c < n; c++) {
    if (values[c] < min) min = values[c];
    if (values[c] > max) max = values[c];
    sum += values[c];
  }
  const data = {
    kind: field,
    nx: averager.nx,
    ny: averager.ny,
    values,
    min,
    max,
    mean: sum / n,
    snapshots: averager.snapshots,
    particlesPerCell: averager.meanParticlesPerCell(),
  };
  if (!average) averager = null;
  return { data, ms: performance.now() - t0 };
}

function inspect(sim: Simulation): InspectData | null {
  if (inspected === null || inspected >= sim.store.count) return null;
  const s = sim.store;
  const i = inspected;
  // local occupancy and gradient from a small field around the particle
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
    recentCollisions: sim.log.eventsInvolving(i, 12).map((e) => ({
      t: e.t,
      partner: e.i === i ? e.j : e.i,
      J: e.J,
      vn: e.vn,
      dKE: e.dKE,
    })),
    trajectory: trajectory.slice(),
  };
}

function sendFrame() {
  if (!experiment) return;
  const sim = currentSim();
  if (!sim) return;
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
  const { data: fieldData, ms: fieldMs } = computeField(sim);
  const run = experiment.currentRun();
  const live = run ? run.live() : {};
  if (typeof live.time === 'number' && live.time > lastSeriesT) {
    const value = typeof live.pressure === 'number' ? live.pressure : typeof live.kT === 'number' ? live.kT : Number.NaN;
    if (Number.isFinite(value)) {
      series.push({ t: live.time as number, c: (live.collisionsPerParticle as number) ?? 0, value, label: typeof live.pressure === 'number' ? 'wall pressure' : 'kT' });
      if (series.length > 600) series.splice(0, series.length - 600);
      lastSeriesT = live.time as number;
    }
  }
  const now = performance.now();
  rateWindow = rateWindow.filter((r) => now - r.t < 1000);
  const stepsPerSecond = rateWindow.reduce((a, r) => a + r.steps, 0);
  const transfer: Transferable[] = [positions.buffer, velocities.buffer, radii.buffer, collisions.buffer];
  if (fieldData) transfer.push(fieldData.values.buffer);
  post(
    {
      type: 'frame',
      epoch,
      runLabel: run?.label ?? 'finished',
      runIndex: experiment.runIndex,
      runCount: experiment.specs.length,
      progress: experiment.progress(),
      running,
      finished,
      status: running ? 'RUNNING' : (recordStatus ?? 'UNTESTED'),
      domain: sim.domain.toSpec(),
      walls: sim.walls.map((w) => ({
        side: w.config.side,
        accommodation: w.config.accommodation,
        tangentialVelocity: w.config.tangentialVelocity,
        segments: w.config.segments.map((sg) => ({ from: sg.from, to: sg.to, accommodation: sg.accommodation })),
      })),
      openSides: sim.boundaries.map((b) => b.config.side),
      count: n,
      positions,
      velocities,
      radii,
      collisions,
      field: fieldData,
      live,
      perf: {
        stepsPerSecond,
        stepMsPerFrame: lastStepMs,
        fieldMs,
        time: sim.time,
        dt: sim.lastDt,
        maxSpeed: s.maxSpeed(),
        energyError: sim.relativeEnergyResidual(),
        momentumError: sim.relativeMomentumResidual(),
        collisionCount: sim.log.count,
        steps: stepsTotal,
      },
      flags: sim.flags,
      series: series.slice(),
      inspected: inspect(sim),
    },
    transfer,
  );
}

function advance(steps: number) {
  if (!experiment || finished) return;
  const before = experiment.currentRun()?.sim;
  if (before) lastSim = before;
  const t0 = performance.now();
  const taken = experiment.advance(steps);
  lastStepMs = performance.now() - t0;
  stepsTotal += taken;
  rateWindow.push({ t: performance.now(), steps: taken });
  const sim = currentSim();
  if (sim && sim !== before) {
    // a new run started: reset per-run state
    trajectory = [];
    series.length = 0;
    lastSeriesT = -Infinity;
  }
  if (sim && inspected !== null && inspected < sim.store.count && trails) {
    trajectory.push(sim.store.x[inspected], sim.store.y[inspected]);
    if (trajectory.length > 4000) trajectory.splice(0, trajectory.length - 4000);
  }
  if (experiment.done && !finished) {
    finished = true;
    running = false;
    try {
      const record = experiment.buildRecord();
      recordStatus = record.status;
      post({ type: 'record', record, epoch });
    } catch (e) {
      post({ type: 'error', message: `analysis failed: ${(e as Error).message}`, epoch });
    }
  }
}

let stepsPerSlice = 50;
function loop() {
  if (!running) return;
  const t0 = performance.now();
  // aim for ~12 ms of simulation per slice
  advance(stepsPerSlice);
  const ms = performance.now() - t0;
  if (ms < 8) stepsPerSlice = Math.min(20000, Math.ceil(stepsPerSlice * 1.25));
  else if (ms > 16) stepsPerSlice = Math.max(1, Math.floor(stepsPerSlice * 0.8));
  maybeFrame();
  setTimeout(loop, 0);
}

let lastFrame = 0;
function maybeFrame(force = false) {
  const now = performance.now();
  if (force || now - lastFrame > 33) {
    lastFrame = now;
    sendFrame();
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'init': {
        const entry = EXPERIMENTS[m.experiment];
        if (!entry) throw new Error(`experiment ${m.experiment} is not implemented yet`);
        epoch = m.epoch;
        experiment = entry.create(m.params);
        running = false;
        finished = false;
        stepsTotal = 0;
        inspected = null;
        trajectory = [];
        series.length = 0;
        lastSeriesT = -Infinity;
        lastSim = null;
        recordStatus = null;
        averager = null;
        maybeFrame(true);
        break;
      }
      case 'run':
        if (experiment && !finished && !running) {
          running = true;
          loop();
        }
        break;
      case 'pause':
        running = false;
        maybeFrame(true);
        break;
      case 'step':
        running = false;
        advance(m.steps);
        maybeFrame(true);
        break;
      case 'stop':
        running = false;
        if (experiment && !finished) {
          finished = true;
          post({ type: 'error', message: 'Stopped by user: the experiment is incomplete and produced no record.', epoch });
        }
        maybeFrame(true);
        break;
      case 'inspect':
        inspected = m.index;
        trajectory = [];
        maybeFrame(true);
        break;
      case 'view':
        if (m.perCell !== perCell || m.average !== average) averager = null;
        field = m.field;
        perCell = m.perCell;
        average = m.average;
        trails = m.trails;
        maybeFrame(true);
        break;
      case 'resetAverage':
        averager = null;
        maybeFrame(true);
        break;
      case 'unload':
        epoch = m.epoch;
        running = false;
        experiment = null;
        lastSim = null;
        averager = null;
        finished = false;
        recordStatus = null;
        break;
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).message, epoch });
  }
};
