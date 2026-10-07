/**
 * UB-0 worker thread: runs one planned run at a time with mid-run checkpoints.
 * Checkpoint and result files are written atomically (tmp + rename); a result
 * file is complete or absent. The worker only computes; the main thread decides
 * what to run.
 */
import { parentPort } from 'node:worker_threads';
import { runJob, type JobMessage } from './ub0Job';

parentPort!.on('message', (m: JobMessage | { stop: true }) => {
  if ('stop' in m) {
    parentPort!.close();
    return;
  }
  try {
    const r = runJob(m);
    parentPort!.postMessage({ id: m.spec.id, ok: true, seconds: r.seconds, resumed: r.resumed, halted: r.halted });
  } catch (e) {
    parentPort!.postMessage({ id: m.spec.id, ok: false, error: String((e as Error).stack ?? e) });
  }
});
parentPort!.postMessage({ ready: true });
