import { Worker } from 'node:worker_threads';
import type { ExperimentRecord, ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';

/**
 * Run an experiment's independent runs on `threads` worker threads, then
 * analyse them together on the main thread. Results are placed in
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
  const buckets: number[][] = Array.from({ length: Math.min(threads, n) }, () => []);
  for (let i = 0; i < n; i++) buckets[i % buckets.length].push(i);
  let done = 0;
  await Promise.all(
    buckets.map(
      (indices) =>
        new Promise<void>((resolve, reject) => {
          // .mjs bootstrap registers tsx's loader inside the worker before importing TypeScript
          const w = new Worker(new URL('./parallelWorker.mjs', import.meta.url), { workerData: { type, params, indices } });
          w.on('message', (m: { i: number; r: unknown }) => {
            results[m.i] = m.r;
            done++;
            onProgress?.(done, n);
          });
          w.on('error', reject);
          w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
        }),
    ),
  );
  exp.setResults(results);
  return exp.buildRecord();
}
