/** Worker thread: runs the experiment's run specifications it is handed, one at a time. */
import { parentPort, workerData } from 'node:worker_threads';
import type { ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';

const { type, params } = workerData as { type: ExperimentType; params: unknown };
const exp = EXPERIMENTS[type]!.create(params);
parentPort!.on('message', (m: { i?: number; stop?: boolean }) => {
  if (m.stop) {
    parentPort!.close();
    return;
  }
  const r = exp.runSpecToCompletion(m.i!);
  parentPort!.postMessage({ i: m.i, r });
});
parentPort!.postMessage({ ready: true });
