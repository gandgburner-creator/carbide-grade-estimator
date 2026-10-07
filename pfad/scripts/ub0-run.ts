/**
 * UB-0 runner (Stage 0 now; Universe B plans are added at the Universe B completion stage).
 *
 *   npx tsx scripts/ub0-run.ts --plan stage0 [--threads 4] [--out results/ub0/stage0]
 *                              [--filter <regex on run id>] [--reserve] [--checkpoint-seconds 300]
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
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { pilotPlan, specCost, stage0Plan, ub0Plan, type FrozenInputs, type PlannedRun } from '../src/universeB/UB0Plans';
import { readJsonGz, writeAtomic, type JobMessage } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const planName = arg('--plan', '');
const threads = Number(arg('--threads', String(Math.min(4, cpus().length))));
const out = arg('--out', `results/ub0/${planName}`);
const filter = arg('--filter', '');
const reserve = argv.includes('--reserve');
const checkpointSeconds = Number(arg('--checkpoint-seconds', '300'));
const courant = Number(arg('--courant', '0.025'));
const frozenFile = arg('--frozen', 'results/ub0/frozen_inputs.json');
const frozen = (): FrozenInputs => JSON.parse(readFileSync(frozenFile, 'utf8')) as FrozenInputs;

const plans: Record<string, () => PlannedRun[]> = {
  stage0: () => stage0Plan({ reserve, courant }),
  pilots: () => pilotPlan(frozen(), courant),
  ub0: () => ub0Plan(frozen(), { reserve, courant }),
};
// Interlock: judged Universe B runs only at the approved pre-registration commit, on a clean tree.
if (planName === 'ub0') {
  const approved = arg('--approved-commit', '');
  let head = '';
  let dirty = '';
  try {
    head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    dirty = execSync('git status --porcelain -- src scripts docs', { encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
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
