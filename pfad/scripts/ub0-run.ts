/**
 * UB-0 runner.
 *
 *   npx tsx scripts/ub0-run.ts --plan <name> [--threads 4] [--out results/ub0/<name>]
 *                              [--filter <regex on run id>] [--reserve] [--checkpoint-seconds 300]
 *
 * Plans:
 *   stage0       Universe A Stage 0 (frozen at 9c5d530; kept for reproduction)
 *   stage0b-1    Universe A Stage 0b phase 1 (docs/CRITERIA_UB0_STAGE0B.md)
 *   stage0b-2    Universe A Stage 0b phase 2, at the amplitude in results/ub0/stage0b/amplitude_decision.json
 *   stage0b-x    Universe A Stage 0b contingency (protocol §8): the groups the pilot halving in
 *                results/ub0/pilots/timestep_decision.json needs (activated reserves of existing
 *                groups run with --plan stage0b-1/-2 --reserve --filter, as the analysis lists them)
 *   pilots       blind stability pilots, round 1 (amendment A2 §1.5)
 *   pilots-r2    round 2: the comparability groups halved in results/ub0/pilots/timestep_decision.json
 *   ub0          the judged Universe B runs (approval interlock)
 *
 * Interlocks (refuse to start):
 *   stage0b-*    unless the Stage 0b protocol is committed and src/, scripts/, docs/ are clean
 *   pilots*      unless frozen inputs (A2), the FINAL power plan and the seed plan exist (A2 §8)
 *   ub0          unless --approved-commit equals HEAD on a clean tree
 *
 * - One result file per run: <out>/runs/<id>.json.gz (atomic). Present = complete.
 * - Mid-run checkpoints: <out>/state/<id>.json.gz (atomic), deleted on completion;
 *   a restarted runner resumes from them (byte-identical continuation).
 * - A result whose stored spec differs from the plan's aborts the run (no mixing).
 * - <out>/manifest.json records the plan, its hash and the git commit;
 *   <out>/timings.log appends one line per finished run (wall-clock is not data).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { pilotPlan, specCost, stage0bContingency, stage0bPlan, stage0Plan, ub0Plan, type FrozenInputs, type PlannedRun, type SeedCounts, type SoundAmplitude } from '../src/universeB/UB0Plans';
import { readJsonGz, writeAtomic, type JobMessage } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const planName = arg('--plan', '');
const threads = Number(arg('--threads', String(Math.min(4, cpus().length))));
const out = arg('--out', planName.startsWith('stage0b') ? 'results/ub0/stage0b' : planName.startsWith('pilots') ? 'results/ub0/pilots' : `results/ub0/${planName}`);
const filter = arg('--filter', '');
const reserve = argv.includes('--reserve');
const checkpointSeconds = Number(arg('--checkpoint-seconds', '300'));
const courant = Number(arg('--courant', '0.025')); // Stage 0 only; Universe B Courant numbers come from A2's assignment
const frozenFile = arg('--frozen', 'results/ub0/frozen_inputs.json');
const powerFile = arg('--power', 'results/ub0/power_plan.json');
const seedPlanFile = arg('--seed-plan', 'results/ub0/seed_plan.json');
const decisionFile = arg('--timestep-decision', 'results/ub0/pilots/timestep_decision.json');
const amplitudeFile = arg('--amplitude', 'results/ub0/stage0b/amplitude_decision.json');
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
const frozen = (): FrozenInputs => readJson<FrozenInputs>(frozenFile);
const halved = (): string[] => (existsSync(decisionFile) ? (readJson<{ halved?: string[] }>(decisionFile).halved ?? []) : []);
const counts = (): SeedCounts => {
  const p = readJson<{ status: SeedCounts['status']; groups: Record<string, { n: number }> }>(powerFile);
  return { status: p.status, n: Object.fromEntries(Object.entries(p.groups).map(([g, v]) => [g, v.n])) };
};

const plans: Record<string, () => PlannedRun[]> = {
  stage0: () => stage0Plan({ reserve, courant }),
  'stage0b-1': () => stage0bPlan({ phase: 1, reserve }),
  'stage0b-2': () => stage0bPlan({ phase: 2, reserve, amplitude: readJson<{ selected: SoundAmplitude }>(amplitudeFile).selected }),
  'stage0b-x': () => stage0bContingency(halved(), readJson<{ selected: SoundAmplitude }>(amplitudeFile).selected).plan,
  pilots: () => pilotPlan(frozen(), { round: 1 }),
  'pilots-r2': () => pilotPlan(frozen(), { round: 2, halved: halved() }),
  ub0: () => ub0Plan(frozen(), counts(), { reserve, halved: halved() }),
};
const git = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const refuse = (why: string): never => {
  console.error(`refusing to run ${planName}: ${why}`);
  process.exit(2);
};
if (planName.startsWith('stage0b')) {
  if (!git('git ls-files docs/CRITERIA_UB0_STAGE0B.md')) refuse('the Stage 0b protocol docs/CRITERIA_UB0_STAGE0B.md is not committed');
  if (git('git status --porcelain -- src scripts docs')) refuse('uncommitted changes in src/, scripts/ or docs/');
}
if (planName.startsWith('pilots')) {
  if (!existsSync(frozenFile) || frozen().version !== 'A2') refuse('frozen inputs in the A2 structure are required (Stage 0b, then scripts/ub0-freeze.ts)');
  if (!existsSync(powerFile) || counts().status !== 'final') refuse('the FINAL power plan is required (scripts/ub0-power.ts after Stage 0b)');
  if (!existsSync(seedPlanFile)) refuse('the seed plan generated from the final power plan is required');
}
// Interlock: judged Universe B runs only at the approved pre-registration commit, on a clean tree.
if (planName === 'ub0') {
  const approved = arg('--approved-commit', '');
  const head = git('git rev-parse HEAD');
  const dirty = git('git status --porcelain -- src scripts docs');
  if (!approved || approved !== head || dirty) {
    console.error('refusing to run judged UB-0: pass --approved-commit <the approved pre-registration commit>, which must be HEAD, with a clean tree');
    process.exit(2);
  }
}
if (!plans[planName]) {
  console.error(`unknown plan '${planName}'; known: ${Object.keys(plans).join(', ')}`);
  process.exit(1);
}
let specs = plans[planName]();
if (filter) specs = specs.filter((s) => new RegExp(filter).test(s.id));

mkdirSync(join(out, 'runs'), { recursive: true });
mkdirSync(join(out, 'state'), { recursive: true });
let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const dirty = execSync('git status --porcelain -- src scripts', { encoding: 'utf8' }).trim();
  if (dirty) commit += ' (+uncommitted changes in src/ or scripts/)';
} catch {
  /* not a git checkout */
}
const planHash = createHash('sha256').update(JSON.stringify(plans[planName]())).digest('hex');
writeAtomic(
  join(out, 'manifest.json'),
  JSON.stringify({ plan: planName, planHash, commit, started: new Date().toISOString(), runs: specs.length, threads, reserve, filter }, null, 1),
);

const todo: PlannedRun[] = [];
let done = 0;
for (const s of specs) {
  const f = join(out, 'runs', `${s.id}.json.gz`);
  if (existsSync(f)) {
    const r = readJsonGz<{ spec: unknown }>(f);
    const { group, planned, periodHint, ...core } = s;
    void group;
    void planned;
    void periodHint;
    if (JSON.stringify(r.spec) !== JSON.stringify(core)) throw new Error(`existing result ${f} does not match the plan spec`);
    done++;
  } else todo.push(s);
}
todo.sort((a, b) => specCost(b) - specCost(a) || a.seed - b.seed);
console.log(`${planName}: ${specs.length} runs, ${done} already complete, ${todo.length} to run on ${threads} threads; commit ${commit}`);
const log = (line: string) => appendFileSync(join(out, 'timings.log'), `${line}\n`);
log(`START ${new Date().toISOString()} plan=${planName} commit=${commit} todo=${todo.length} threads=${threads}`);

let next = 0;
const t0 = Date.now();
let failed = 0;
await Promise.all(
  Array.from(
    { length: Math.min(threads, todo.length) },
    () =>
      new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL('./ub0Worker.mjs', import.meta.url));
        const feed = () => {
          if (next >= todo.length) {
            w.postMessage({ stop: true });
            return;
          }
          const s = todo[next++];
          const { group, planned, periodHint, ...spec } = s;
          void group;
          void planned;
          void periodHint;
          const msg: JobMessage = {
            spec,
            statePath: join(out, 'state', `${s.id}.json.gz`),
            resultPath: join(out, 'runs', `${s.id}.json.gz`),
            checkpointSeconds,
          };
          w.postMessage(msg);
        };
        w.on('message', (m: { ready?: boolean; id?: string; ok?: boolean; seconds?: number; resumed?: boolean; halted?: boolean; error?: string }) => {
          if (!m.ready) {
            done++;
            if (!m.ok) {
              failed++;
              log(`FAIL ${m.id} ${m.error}`);
              console.error(`FAIL ${m.id}: ${m.error}`);
            } else {
              log(`END ${new Date().toISOString()} ${m.id} seconds=${m.seconds!.toFixed(1)}${m.resumed ? ' resumed' : ''}${m.halted ? ' HALTED' : ''}`);
            }
            const el = (Date.now() - t0) / 1000;
            console.log(`[${done}/${specs.length}] ${m.id} ${m.ok ? `${m.seconds!.toFixed(1)} s` : 'FAILED'}  (elapsed ${(el / 60).toFixed(1)} min)`);
          }
          feed();
        });
        w.on('error', reject);
        w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
      }),
  ),
);
log(`FINISH ${new Date().toISOString()} failed=${failed} wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`finished; ${failed} failed`);
if (failed > 0) process.exit(1);
