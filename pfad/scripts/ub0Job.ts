import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { blindRecord } from '../src/universeB/UB0Blind';
import { UB0Run, type UB0RunState, type UB0Spec } from '../src/universeB/UB0Run';

export interface JobMessage {
  spec: UB0Spec;
  statePath: string;
  resultPath: string;
  checkpointSeconds: number;
}

export function writeAtomic(path: string, data: Buffer | string): void {
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

export function readJsonGz<T>(path: string): T {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as T;
}

export function writeJsonGz(path: string, obj: unknown): void {
  writeAtomic(path, gzipSync(Buffer.from(JSON.stringify(obj))));
}

/** Run (or resume) one job to completion. Deterministic for its spec. */
export function runJob(m: JobMessage): { seconds: number; resumed: boolean; halted: boolean } {
  const t0 = Date.now();
  let run: UB0Run;
  let resumed = false;
  if (existsSync(m.statePath)) {
    const st = readJsonGz<UB0RunState>(m.statePath);
    if (JSON.stringify(st.spec) !== JSON.stringify(m.spec)) throw new Error(`checkpoint ${m.statePath} belongs to a different spec`);
    run = UB0Run.resume(st);
    resumed = true;
  } else {
    run = new UB0Run(m.spec);
  }
  let last = Date.now();
  while (!run.done) {
    run.advance(2000);
    if (!run.done && Date.now() - last > m.checkpointSeconds * 1000) {
      writeJsonGz(m.statePath, run.checkpoint());
      last = Date.now();
    }
  }
  const res = run.result();
  // a blind run (stability pilot) stores the whitelisted record only (A1 §4.3)
  writeJsonGz(m.resultPath, m.spec.observables ? res : blindRecord(res));
  // the checkpoint holds the microstate: removed on completion, never read except to resume
  if (existsSync(m.statePath)) rmSync(m.statePath);
  return { seconds: (Date.now() - t0) / 1000, resumed, halted: res.info.halted === 1 };
}
