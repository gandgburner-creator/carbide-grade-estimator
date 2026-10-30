import type { SafetyFlag } from '../core/Safety';
import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import type { ValidationStatus } from '../validation/Status';

/** Messages between the UI thread and the simulation worker. */

export type FieldKind =
  | 'none'
  | 'occupancy'
  | 'occupancyGradient'
  | 'density'
  | 'speed'
  | 'ux'
  | 'uy'
  | 'momentumX'
  | 'momentumY'
  | 'kT'
  | 'pressure'
  | 'shear';

/** Near-wall / cross-stream profile request: bins along y inside the x window [x0, x1]. */
export interface ProfileRequest {
  x0: number;
  x1: number;
  bins: number;
}

export type ToWorker =
  | { type: 'init'; experiment: ExperimentType; params: unknown; epoch: number; resume?: unknown }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'step'; steps: number }
  | { type: 'stop' }
  /** end the run now and keep what has been built so far (live fill) */
  | { type: 'finishNow' }
  | { type: 'inspect'; index: number | null }
  | { type: 'view'; field: FieldKind; perCell: number; average: boolean; trails: boolean; profile?: ProfileRequest | null; vectors?: boolean }
  | { type: 'resetAverage' }
  | { type: 'checkpoint' }
  | { type: 'unload'; epoch: number };

export interface WallGeometry {
  side: string;
  accommodation: number;
  tangentialVelocity: number;
  segments: { from: number; to: number; accommodation: number }[];
}

export interface Frame {
  type: 'frame';
  /** session id of the experiment this frame belongs to; stale frames are ignored */
  epoch: number;
  runLabel: string;
  runIndex: number;
  runCount: number;
  progress: number;
  running: boolean;
  finished: boolean;
  status: ValidationStatus;
  domain: { xmin: number; xmax: number; ymin: number; ymax: number; periodicX: boolean; periodicY: boolean };
  walls: WallGeometry[];
  /** sides that are open reservoir boundaries */
  openSides: string[];
  /** solid polygon bodies: interleaved vertices and mean accommodation */
  bodies: { vertices: number[]; accommodation: number }[];
  count: number;
  /** interleaved x, y */
  positions: Float32Array;
  /** interleaved vx, vy */
  velocities: Float32Array;
  radii: Float32Array;
  /** recent collision contact points, interleaved x, y */
  collisions: Float32Array;
  field: null | {
    kind: FieldKind;
    nx: number;
    ny: number;
    values: Float32Array;
    min: number;
    max: number;
    mean: number;
    /** snapshots in the time average (1 = instantaneous) */
    snapshots: number;
    /** how the value was formed, when it needs saying (e.g. which stress parts are included) */
    note?: string;
    /** mean particles per cell per snapshot */
    particlesPerCell: number;
    /** simulation time of the first and the latest snapshot in the average */
    t0: number;
    t1: number;
  };
  /**
   * the running average of the cell velocity (both components) since the current run began, when asked for (`vectors`):
   * what the streamlines of a run in progress are drawn from. It is not the measurement window's mean.
   */
  flow?: null | { nx: number; ny: number; ux: Float32Array; uy: Float32Array; snapshots: number; particlesPerCell: number; t0: number; t1: number };
  /** wall and body momentum transfer since the start of the current run phase */
  transfer: TransferData | null;
  /** near-wall profile, when requested */
  profile: ProfileData | null;
  /** time series of every numeric live value (columnar) */
  history: { t: number[]; columns: Record<string, number[]> };
  /** active compute time of this experiment session, ms */
  activeMs: number;
  /** the experiment can return a resumable checkpoint */
  checkpointable: boolean;
  live: Record<string, number | string>;
  perf: {
    stepsPerSecond: number;
    stepMsPerFrame: number;
    fieldMs: number;
    time: number;
    dt: number;
    maxSpeed: number;
    energyError: number;
    momentumError: number;
    collisionCount: number;
    steps: number;
  };
  flags: SafetyFlag[];
  inspected: null | InspectData;
}

export interface InspectData {
  index: number;
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  kineticEnergy: number;
  internalEnergy: number;
  collisions: number;
  wallHits: number;
  localOccupancy: number;
  occupancyGradient: [number, number];
  recentCollisions: { t: number; partner: number; J: number; vn: number; dKE: number }[];
  trajectory: number[];
}

export interface TransferData {
  /** averaging window: simulation time since the monitor started */
  t0: number;
  t1: number;
  walls: {
    side: string;
    length: number;
    accommodation: number;
    hits: number;
    /** Σ normal impulse / (Δt · L): wall pressure from momentum transfer */
    pressure: number;
    /** Σ tangential impulse / (Δt · L) */
    shear: number;
  }[];
  bodies: {
    hits: number;
    /** Δ(body impulse) / Δt: mean force on the body from particle impacts */
    fx: number;
    fy: number;
  }[];
}

export interface ProfileBin {
  mean: number;
  se: number;
}

export interface ProfileData {
  x0: number;
  x1: number;
  /** bin centres, distance from the bottom of the domain (y − ymin) */
  y: number[];
  binWidth: number;
  snapshots: number;
  batches: number;
  numberDensity: ProfileBin[];
  ux: ProfileBin[];
  uy: ProfileBin[];
  kT: ProfileBin[];
}

export type FromWorker =
  | Frame
  | { type: 'record'; record: ExperimentRecord; epoch: number; activeMs: number }
  | { type: 'stopped'; message: string; epoch: number; activeMs: number }
  | { type: 'failed'; message: string; epoch: number; activeMs: number }
  | { type: 'checkpoint'; state: unknown; epoch: number; activeMs: number }
  | { type: 'error'; message: string; epoch: number };
