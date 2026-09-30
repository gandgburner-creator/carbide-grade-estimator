import type { SafetyFlag } from '../core/Safety';
import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import type { ValidationStatus } from '../validation/Status';

/** Messages between the UI thread and the simulation worker. */

export type FieldKind = 'none' | 'occupancy' | 'occupancyGradient' | 'density' | 'speed' | 'kT';

export type ToWorker =
  | { type: 'init'; experiment: ExperimentType; params: unknown; epoch: number }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'step'; steps: number }
  | { type: 'stop' }
  | { type: 'inspect'; index: number | null }
  | { type: 'view'; field: FieldKind; perCell: number; average: boolean; trails: boolean }
  | { type: 'resetAverage' }
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
    /** mean particles per cell per snapshot */
    particlesPerCell: number;
  };
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
  series: { t: number; c: number; value: number; label: string }[];
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

export type FromWorker =
  | Frame
  | { type: 'record'; record: ExperimentRecord; epoch: number }
  | { type: 'error'; message: string; epoch: number };
