import { Worker } from 'node:worker_threads';
import type { ExperimentRecord, ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';

/**
 * Run an experiment's independent runs on `threads` worker threads, then
 * analyse them together on the main thread. Runs are handed out from a shared
 * queue (the next free worker takes the next run, longest first when the
 * experiment provides a cost estimate), and results are placed in
 * specification order, so the record is identical to a serial run.
 */
export async function runParallel(
  type: ExperimentType,
  params: unknown,
  threads: number,
  onProgress?: (done: number, total: number) => void,
): Promise<ExperimentRecord> {
  const exp = EXPERIMENTS[type]!.create(params);
  const n = exp.specs.length;
  const results: unknown[] = new Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  const cost = (exp as { specCost?: (i: number) => number }).specCost;
  if (cost) order.sort((a, b) => cost.call(exp, b) - cost.call(exp, a) || a - b);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(threads, n) },
      () =>
        new Promise<void>((resolve, reject) => {
          // .mjs bootstrap registers tsx's loader inside the worker before importing TypeScript
          const w = new Worker(new URL('./parallelWorker.mjs', import.meta.url), { workerData: { type, params } });
          const feed = () => {
            if (next < n) w.postMessage({ i: order[next++] });
            else w.postMessage({ stop: true });
          };
          w.on('message', (m: { ready?: boolean; i?: number; r?: unknown }) => {
            if (!m.ready) {
              results[m.i!] = m.r;
              done++;
              onProgress?.(done, n);
            }
            feed();
          });
          w.on('error', reject);
          w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
        }),
    ),
  );
  exp.setResults(results);
  return exp.buildRecord();
}
