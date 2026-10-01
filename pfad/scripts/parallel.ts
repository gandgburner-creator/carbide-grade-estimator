import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ExperimentRecord, ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';

/**
 * Run an experiment's independent runs on `threads` worker threads, then
 * analyse them together on the main thread. Runs are handed out from a shared
 * queue (the next free worker takes the next run, longest first when the
 * experiment provides a cost estimate), and results are placed in
 * specification order, so the record is identical to a serial run.
 *
 * Checkpointing (optional `checkpointDir`): every finished run is written to
 * `<dir>/run-<index>.json` together with its specification and a hash of the
 * experiment parameters. A restarted call with the same parameters loads
 * those files and runs only the missing specifications. Runs are independent
 * and deterministic for their specification, so the record does not depend
 * on whether or when it was resumed (only wall-clock timings differ).
 */
export async function runParallel(
  type: ExperimentType,
  params: unknown,
  threads: number,
  onProgress?: (done: number, total: number) => void,
  checkpointDir?: string,
): Promise<ExperimentRecord> {
  const exp = EXPERIMENTS[type]!.create(params);
  const n = exp.specs.length;
  const results: unknown[] = new Array(n);
  const have = new Array<boolean>(n).fill(false);
  const paramsHash = createHash('sha256').update(JSON.stringify(params)).digest('hex');
  if (checkpointDir) {
    mkdirSync(checkpointDir, { recursive: true });
    for (let i = 0; i < n; i++) {
      const f = join(checkpointDir, `run-${i}.json`);
      if (!existsSync(f)) continue;
      const c = JSON.parse(readFileSync(f, 'utf8')) as { paramsHash: string; spec: unknown; result: unknown };
      if (c.paramsHash !== paramsHash || JSON.stringify(c.spec) !== JSON.stringify(exp.specs[i])) {
        throw new Error(`checkpoint ${f} belongs to different parameters or specification`);
      }
      results[i] = c.result;
      have[i] = true;
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => !have[i]);
  const cost = (exp as { specCost?: (i: number) => number }).specCost;
  if (cost) order.sort((a, b) => cost.call(exp, b) - cost.call(exp, a) || a - b);
  let next = 0;
  let done = n - order.length;
  if (done > 0) onProgress?.(done, n);
  const save = (i: number, r: unknown) => {
    if (!checkpointDir) return;
    const f = join(checkpointDir, `run-${i}.json`);
    writeFileSync(`${f}.tmp`, JSON.stringify({ paramsHash, spec: exp.specs[i], result: r }));
    renameSync(`${f}.tmp`, f);
  };
  if (order.length > 0) {
    await Promise.all(
      Array.from(
        { length: Math.min(threads, order.length) },
        () =>
          new Promise<void>((resolve, reject) => {
            // .mjs bootstrap registers tsx's loader inside the worker before importing TypeScript
            const w = new Worker(new URL('./parallelWorker.mjs', import.meta.url), { workerData: { type, params } });
            const feed = () => {
              if (next < order.length) w.postMessage({ i: order[next++] });
              else w.postMessage({ stop: true });
            };
            w.on('message', (m: { ready?: boolean; i?: number; r?: unknown }) => {
              if (!m.ready) {
                results[m.i!] = m.r;
                save(m.i!, m.r);
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
  }
  exp.setResults(results);
  return exp.buildRecord();
}
