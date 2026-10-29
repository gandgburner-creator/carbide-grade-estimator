import type { CfdParams, CfdResult } from '../cfd/CfdRun';

/** Messages between the UI thread and the CFD worker. */
export type CfdViewKind = 'speed' | 'vorticity' | 'pressure' | 'ux' | 'uy';

export type CfdToWorker =
  | { type: 'start'; epoch: number; params: CfdParams; view: CfdViewKind }
  | { type: 'view'; kind: CfdViewKind }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'unload'; epoch: number };

export interface CfdFrame {
  type: 'frame';
  epoch: number;
  progress: number;
  phase: string;
  steps: number;
  convective: number;
  blocks: string;
  fx: number;
  fy: number;
  running: boolean;
  activeMs: number;
  /** lattice nodes, time step rate */
  stepsPerSecond: number;
  tau: number;
  nx: number;
  ny: number;
  cellsPerUnit: number;
  field: { kind: CfdViewKind; nx: number; ny: number; values: Float32Array; stride: number };
}

export type CfdFromWorker = CfdFrame | { type: 'done'; epoch: number; result: CfdResult; activeMs: number } | { type: 'stopped'; epoch: number; message: string; activeMs: number } | { type: 'failed'; epoch: number; message: string; activeMs: number };
