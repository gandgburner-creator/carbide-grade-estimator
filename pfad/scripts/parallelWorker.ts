/** Worker thread: runs a subset of an experiment's run specifications. */
import { parentPort, workerData } from 'node:worker_threads';
import type { ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';

const { type, params, indices } = workerData as { type: ExperimentType; params: unknown; indices: number[] };
const exp = EXPERIMENTS[type]!.create(params);
for (const i of indices) {
  const r = exp.runSpecToCompletion(i);
  parentPort!.postMessage({ i, r });
}
