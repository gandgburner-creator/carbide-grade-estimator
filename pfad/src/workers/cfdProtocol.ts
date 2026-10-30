import type { CfdFillConfig, CfdFillResult } from '../cfd/CfdFill';
import type { CfdParams, CfdResult } from '../cfd/CfdRun';
import type { PlateSpec, PointerPaths, Pt } from '../geometry/Pointer';
import type { SurfaceGeometry } from '../geometry/SurfaceGeometry';

/** Messages between the UI thread and the CFD worker. */
export type CfdViewKind = 'speed' | 'vorticity' | 'pressure' | 'ux' | 'uy';

export type CfdToWorker =
  | { type: 'start'; epoch: number; params: CfdParams; view: CfdViewKind; vectors?: boolean }
  | { type: 'view'; kind: CfdViewKind; vectors?: boolean }
  /** the auto fill: the pointer moves by itself during one run (see cfd/CfdFill.ts) */
  | { type: 'startFill'; epoch: number; params: CfdParams; plate: PlateSpec; paths: PointerPaths; spacing: number; fill: CfdFillConfig; view: CfdViewKind; vectors?: boolean }
  /** end an auto fill now and keep the shape drawn so far */
  | { type: 'finishNow' }
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
  /** both velocity components (in units of the free-stream speed, NaN inside the body) at this instant, when asked for: what the streamlines of a run in progress are drawn from */
  flow?: { nx: number; ny: number; ux: Float32Array; uy: Float32Array; stride: number };
  /** an auto fill in progress: the body as it is now and where the pointer is */
  fill?: { geometry: SurfaceGeometry; paths: PointerPaths; pointer: Pt; moves: number; lastGap: number | null; lastRise: number | null };
}

export type CfdFromWorker = CfdFrame | { type: 'done'; epoch: number; result: CfdResult; activeMs: number } | { type: 'filled'; epoch: number; result: CfdFillResult; activeMs: number } | { type: 'stopped'; epoch: number; message: string; activeMs: number } | { type: 'failed'; epoch: number; message: string; activeMs: number };
