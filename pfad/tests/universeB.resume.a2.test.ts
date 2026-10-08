import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonGz, runJob, writeJsonGz } from '../scripts/ub0Job';
import { pilotPlan, stage0bGroups, type FrozenInputs } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';

/**
 * Checkpoint/resume at the A2 settings (amendment A2 §1.3; Stage 0b protocol §10): a Stage 0b
 * Universe A run at Courant 0.00625, a contingency-Courant (0.003125) run, and a blind pilot
 * at its group's assigned Courant number continue byte-identically from a mid-run checkpoint,
 * in memory and through the runner's on-disk job.
 */
const strip = (r: ReturnType<UB0Run['result']>) => {
  const { timing, ...rest } = r;
  void timing;
  return JSON.stringify(rest);
};
const shrink = (s: UB0Spec): UB0Spec => ({ ...s, L: s.L !== undefined ? 12 : undefined, width: s.width !== undefined ? 10 : undefined, height: s.height !== undefined ? 14 : undefined, prep: 1, settle: s.settle ? 0.5 : 0, measure: 2, sample: 0.5 }) as UB0Spec;
const F: FrozenInputs = { version: 'A2', KTred: 2.37564, cA: { 4: 2.19, 16: 2.19, 64: 2.19 }, cRatio: { 4: [0.72, 0.79], 16: [0.7, 0.72], 64: [0.7, 0.71] }, soundAmplitude: 0.04 };

function spec(g: string, seed: number, courant?: number): UB0Spec {
  const d = stage0bGroups(0.04).find((x) => x.group === g)!;
  return shrink({ ...d.base, id: `r-${g}`, seed, ...(courant ? { courant } : {}) } as UB0Spec);
}
const pilot = (g: string) => {
  const p = pilotPlan(F).find((x) => x.group === g)!;
  const { group, planned, periodHint, ...s } = p;
  void group;
  void planned;
  void periodHint;
  return shrink({ ...s, L: s.kind === 'wall' ? undefined : Math.max(14, Math.ceil(3.1 * s.ch * Math.sqrt(s.Nc))) } as UB0Spec);
};

const cases: [string, UB0Spec][] = [
  ['Stage 0b SLc00625 (N_c 1, Courant 0.00625)', spec('SLc00625', 9091)],
  ['Stage 0b L160c00625 (N_c 1, sound)', spec('L160c00625', 9092)],
  ['contingency Courant 0.003125 (N_c 1, static)', spec('SK18c00625', 9093, 0.003125)],
  ['blind pilot SK4c2p20 (N_c 4, Courant 0.00625)', pilot('SK4c2p20')],
  ['blind pilot T4dt (N_c 4, Courant 0.00625)', pilot('T4dt')],
];

describe('checkpoint/resume at the A2 Courant numbers', () => {
  for (const [name, s] of cases) {
    it(`${name}: byte-identical continuation`, { timeout: 120_000 }, () => {
      const ref = new UB0Run(s);
      while (!ref.done) ref.advance(1000);
      const want = strip(ref.result());
      const run = new UB0Run(s);
      run.advance(700);
      const resumed = UB0Run.resume(JSON.parse(JSON.stringify(run.checkpoint())));
      while (!resumed.done) resumed.advance(1000);
      expect(strip(resumed.result())).toBe(want);
    });
  }
  it('the runner job resumes a blind pilot from disk and stores only the blind record', { timeout: 120_000 }, () => {
    const s = pilot('T4dt');
    const dir = mkdtempSync(join(tmpdir(), 'ub0-a2-resume-'));
    try {
      const run = new UB0Run(s);
      run.advance(500);
      writeJsonGz(join(dir, 'state.json.gz'), run.checkpoint());
      const r = runJob({ spec: s, statePath: join(dir, 'state.json.gz'), resultPath: join(dir, 'res.json.gz'), checkpointSeconds: 0 });
      expect(r.resumed).toBe(true);
      const rec = readJsonGz<{ blind: boolean; spec: UB0Spec }>(join(dir, 'res.json.gz'));
      expect(rec.blind).toBe(true);
      expect(rec.spec.courant).toBe(0.00625);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
