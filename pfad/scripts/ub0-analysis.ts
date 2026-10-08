/**
 * UB-0 judged analysis — pre-registered (docs/CRITERIA_UB0_COARSE_GRAINING.md).
 * To be run ONLY on the judged Universe B runs made at the approved
 * pre-registration commit (scripts/ub0-run.ts --plan ub0 --approved-commit …).
 *
 *   npx tsx scripts/ub0-analysis.ts [--dir results/ub0/ub0] [--frozen results/ub0/frozen_inputs.json]
 *        [--power results/ub0/power_plan.json] [--timestep-decision results/ub0/pilots/timestep_decision.json]
 *        [--extension <dir>/extension_request.json]
 *        [--b0 results/ub0/b0/b0.json] [--pred results/ub0/predictions_stage0b.json]
 *
 * The plan is regenerated from the frozen inputs, the FINAL power plan and the pilot
 * timestep decision (amendment A2): seeds, counts and per-group Courant numbers.
 *
 * Mechanical, in this order (src/universeB/UB0Pipeline.ts):
 *  1. per-run automatic exclusions (§11.6) → reserve seeds in seed order; if a
 *     needed reserve has no result, list it and exit 3;
 *  2. first look at 95 %; NON-STATIONARY static groups make their primaries
 *     INCONCLUSIVE (§11.5.1);
 *  3. the single extension (§11.7): if any primary is INCONCLUSIVE with its point
 *     estimate inside its margin, write <dir>/extension_request.json and the
 *     first-look report and exit 6. The request is committed, its reserve seeds
 *     are run, and this script is re-run with --extension; only the extended
 *     primaries take the doubled data, at 97.5 %;
 *  4. labels F0–F6 (precedence F0 > F3 > F1 > F2 > T-FAIL > F4 > F6), the bulk
 *     verdict, the overall category, the separate wall verdict, the F7 forecast
 *     and the L1–L4 crossing ledger.
 * Exit 0 when the final report is written.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NcKey } from '../src/universeB/UB0Analysis';
import { PRIMARY_KEYS } from '../src/universeB/UB0Judged';
import { f7Forecast, runPipeline, type FrozenJudged } from '../src/universeB/UB0Pipeline';
import { ub0Plan } from '../src/universeB/UB0Plans';
import type { UB0Result } from '../src/universeB/UB0Run';
import { PRIMARY_GROUPS } from '../src/universeB/UB0Selection';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const dir = arg('--dir', 'results/ub0/ub0');
const frozen = JSON.parse(readFileSync(arg('--frozen', 'results/ub0/frozen_inputs.json'), 'utf8')) as FrozenJudged;
const power = JSON.parse(readFileSync(arg('--power', 'results/ub0/power_plan.json'), 'utf8')) as { status: 'final' | 'provisional'; groups: Record<string, { n: number }> };
const decision = arg('--timestep-decision', 'results/ub0/pilots/timestep_decision.json');
const halved = existsSync(decision) ? ((JSON.parse(readFileSync(decision, 'utf8')) as { halved?: string[] }).halved ?? []) : [];
const extFile = arg('--extension', '');
const b0File = arg('--b0', 'results/ub0/b0/b0.json');
const predFile = arg('--pred', 'results/ub0/predictions_stage0b.json');

const plan = ub0Plan(frozen, { status: power.status, n: Object.fromEntries(Object.entries(power.groups).map(([g, v]) => [g, v.n])) }, { reserve: true, halved });
const cache = new Map<string, UB0Result | null>();
const load = (id: string) => {
  if (!cache.has(id)) {
    const f = join(dir, 'runs', `${id}.json.gz`);
    cache.set(id, existsSync(f) ? readJsonGz<UB0Result>(f) : null);
  }
  return cache.get(id)!;
};
const extended = extFile ? (JSON.parse(readFileSync(extFile, 'utf8')) as { primaries: string[] }).primaries : null;
const res = runPipeline(plan, load, frozen, extended);

if (res.status === 'need-runs') {
  console.log(`runs needed before the analysis can proceed (${res.toRun.length}):`);
  for (const id of res.toRun) console.log(`  ${id}`);
  console.log(`\nrun: npx tsx scripts/ub0-run.ts --plan ub0 --reserve --approved-commit <commit> --filter '^(${res.toRun.join('|')})$'`);
  process.exit(3);
}

const out: string[] = [];
const say = (s = '') => out.push(s);
const f = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const ci = (c: [number, number]) => `[${f(c[0])}, ${f(c[1])}]`;
type Iv = { estimate: number; ci: [number, number] };
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function primaryLines(d: D, key: string): string {
  const [name, sub] = key.split('.');
  const n = sub as unknown as NcKey;
  const iv = (x: { interval: Iv }) => `${f(x.interval.estimate)} ${ci(x.interval.ci)}`;
  switch (name) {
    case 'pq1':
      return sub === 'arm' ? `ν(c_h 4)/ν_A ${iv(d.arm1)} margin [0.9, 1.1] → ${d.arm1.outcome}` : `ν_B/ν_A ${iv(d.r1[n])} margin [0.9, 1.1] → ${d.r1[n].outcome}`;
    case 'pq2':
      return sub === 'arm' ? `K(c_h 4)/K_A ${iv(d.arm2)} margin [0.9, 1.1] → ${d.arm2.outcome}` : `K_B/K_T,A ${iv(d.r2[n])} margin [0.9, 1.1] → ${d.r2[n].outcome}`;
    case 'pq3':
      return `Γ_self ${iv(d.r3[n])} judged ${ci(d.r3[n].judged)} → ${d.r3[n].outcome}`;
    case 'pq4':
      return `T_kin/T_int ${iv(d.r4[n].ratio)} [0.97, 1.03] → ${d.r4[n].ratio.outcome}; a₂ ${iv(d.r4[n].a2)} |a₂| ≤ 0.03 → ${d.r4[n].a2.outcome}; → ${d.r4[n].outcome}`;
    case 'pq5':
      return `${d.r5[n].shells.map((s: { interval: Iv; prediction: number; outcome: string }, i: number) => `S/S_RPA shell ${i + 1} ${f(s.interval.estimate)} ${ci(s.interval.ci)} (S_RPA ${f(s.prediction)}) → ${s.outcome}`).join('; ')}; → ${d.r5[n].outcome}`;
    case 'pq6a':
      return `ν(σ_v)/ν(σ_v/2) ${iv(d.r6a[n])} margin [0.95, 1.05] → ${d.r6a[n].outcome}`;
    case 'pq6b':
      return `ν(e 0.8)/ν(e 0.95) ${iv(d.r6b)} margin [0.95, 1.05] → ${d.r6b.outcome}`;
    case 'pq6c':
      return `ν(c_h 4)/ν(c_h 2) ${iv(d.r6c.nu)} [0.93, 1.07] → ${d.r6c.nu.outcome}; K(c_h 4)/K(c_h 2) ${iv(d.r6c.K)} [0.9, 1.1] → ${d.r6c.K.outcome}; → ${d.r6c.outcome}`;
    case 'pq7d':
      return `ν(dt/2)/ν(dt) ${iv(d.r7.d)} margin [0.97, 1.03] → ${d.r7.d.outcome}`;
    case 'pq8':
      return `occupancy share ${iv(d.r8[n])} PASS iff CI < 0.2 → ${d.r8[n].outcome}`;
    default:
      return '';
  }
}

const first = res.first;
say('UB-0 judged analysis (pre-registered; src/universeB/UB0Pipeline.ts)');
say(`plan: ${plan.length} seeds incl. reserves; Courant per comparability group (A2), halved: ${halved.length ? halved.join(', ') : 'none'}; frozen inputs ${JSON.stringify((frozen as unknown as { provenance?: unknown }).provenance ?? {})}`);
say();
say('── exclusions (§11.6) ──');
for (const [g, s] of Object.entries(res.selections)) {
  if (s.excluded.length || s.shortfall) say(`  ${g}: used ${s.used.length}/${s.target}; excluded ${s.excluded.map((e) => `${e.id} (${e.reasons.join('; ')})`).join(', ')}${s.shortfall ? `; SHORTFALL ${s.shortfall}` : ''}${s.excessExclusions ? '; EXCLUSIONS > max(1, 10 %): F0' : ''}`);
}
say();
say('── run halves (§11.5.1) ──');
for (const s of res.stationarity) {
  if (s.flag) say(`  NON-STATIONARY ${s.group} ${s.quantity}: first − second = ${f(s.diff, 5)} ${ci(s.ci)}, threshold ±${f(s.threshold, 5)} → INCONCLUSIVE: ${s.primaries.join(', ')}`);
}
say(`  ${res.stationarity.filter((s) => !s.flag).length} of ${res.stationarity.length} checks stationary`);
say();
say(`── primaries, first look (95 %) ──`);
for (const k of PRIMARY_KEYS) say(`  ${k.padEnd(8)} ${primaryLines(first.details as D, k)}`);
const r7 = (first.details as D).r7;
say(`  PQ7: ${r7.violations.length} run(s) violating (a)/(b)/(e) among included runs; (c) drift(dt)/drift(dt/2) = ${f(r7.driftRatio, 2)} (≥ 2.5) → ${r7.c}`);
say();
if (!extended && res.candidates.length) {
  const groups = [...new Set(res.candidates.flatMap((k) => PRIMARY_GROUPS[k]))];
  const req = { primaries: res.candidates, groups, rule: 'design §11.7: one extension; reserves double each group; 97.5 % for the extended primaries only' };
  writeFileSync(join(dir, 'extension_request.json'), `${JSON.stringify(req, null, 1)}\n`);
  say(`── EXTENSION REQUIRED (§11.7) for ${res.candidates.join(', ')} ──`);
  say(`  groups doubled from their reserves: ${groups.join(', ')}`);
  say('  first-look verdicts of all other primaries are final. Commit extension_request.json, run the reserves,');
  say('  then re-run with --extension. No verdict is stated before that.');
  writeFileSync(join(dir, 'first_look_report.txt'), `${out.join('\n')}\n`);
  writeFileSync(join(dir, 'first_look.json'), `${JSON.stringify({ outcomes: first.outcomes, labels: first.labels, candidates: res.candidates, details: first.details }, null, 1)}\n`);
  console.log(out.join('\n'));
  process.exit(6);
}
if (res.second) {
  say(`── the extension (§11.7): ${extended!.join(', ')} at 97.5 % on doubled data ──`);
  for (const k of extended!) say(`  ${k.padEnd(8)} ${primaryLines(res.second.details as D, k)}`);
  say();
}
const fin = res.final;
say('── verdict ──');
say(`  F-labels: ${fin.labels.length ? fin.labels.join(', ') : 'none'}`);
say(`  bulk verdict: ${fin.bulk}`);
say(`  OVERALL CATEGORY: ${fin.overall}`);
say();
say(`── wall verdict (separate; A1 §2.4): ${res.wall.verdict} ──`);
for (const [g, c] of Object.entries(res.wall.configs)) {
  say(`  ${g}: G-W1 ${ci(c.gates.gw1.interval.ci)} ${c.gates.gw1.outcome}; G-W2 ${ci(c.gates.gw2.interval.ci)} ${c.gates.gw2.outcome}; G-W3 ${ci(c.gates.gw3.interval.ci)} ${c.gates.gw3.outcome}; R ${f(c.R.interval.estimate)} ${ci(c.R.interval.ci)} → ${c.R.outcome}${c.excessExclusions ? '; EXCLUSIONS > max(1, 10 %) (VOID)' : ''}${g === 'W4c4' ? ' (secondary arm)' : ''}`);
}
say();
say('── Couette: not part of UB-0 (deferred to UB-0W, amendment A2 §1.6) ──');
say();
say('── timestep diagnostics (§11.6, report only) ──');
const omega = Object.entries(res.diagnostics).filter(([, v]) => Number.isFinite(v.maxOmegaDt));
for (const [g, v] of omega) say(`  ${g.padEnd(10)} max ω·dt = ${f(v.maxOmegaDt, 4)}${v.maxOmegaDt > 0.02 ? '  > 0.02 (caveat)' : ''}`);
say();

// F7 forecast
let gain: number | null = null;
if (existsSync(b0File)) {
  const b0 = JSON.parse(readFileSync(b0File, 'utf8')) as { gains: { Nc: number; ch: number; L: number; G: number }[] };
  const nStar = fin.bulk === 'PASS' ? 64 : fin.bulk === 'PASS-NARROW' ? 16 : null;
  const g = nStar ? b0.gains.find((x) => x.Nc === nStar && x.ch === 2 && x.L === 160) : undefined;
  gain = g ? g.G : null;
}
const d1 = first.details as D;
const fin6a = (n: 4 | 16) => ({ outcome: fin.outcomes.pq6a[n], estimate: (extended?.includes(`pq6a.${n}`) ? (res.second!.details as D) : d1).r6a[n].interval.estimate });
const f7 = f7Forecast(fin.labels, fin.bulk, { 4: fin6a(4), 16: fin6a(16) }, gain);
say(`── F7 (forecast only, never a verdict): ${f7.triggered ? 'TRIGGERED' : 'not triggered'} ──`);
for (const r of f7.reasons) say(`  ${r}`);
say();

// L1–L4 crossing ledger (design §14)
const pred = existsSync(predFile) ? (JSON.parse(readFileSync(predFile, 'utf8')) as { values: Record<string, number> }).values : null;
const line = (o: string) => (o === 'PASS' ? 'held' : o === 'FAIL' ? 'CROSSED' : 'not established');
say('── crossing ledger (design §14) ──');
say('  L1 (input): held by construction — no transport coefficient or operator in the model (code audit, MODEL_ASSUMPTIONS)');
say(`  L2 (calibration): e → PQ6b ${fin.outcomes.pq6b} (${line(fin.outcomes.pq6b)}); c_h → PQ6c ${fin.outcomes.pq6c} (${line(fin.outcomes.pq6c)}); kernel shape untested`);
say(`  L3 (mechanism): PQ8 ${([4, 16, 64] as const).map((n) => `N_c ${n} ${fin.outcomes.pq8[n]} (${line(fin.outcomes.pq8[n])})`).join('; ')}`);
if (pred) {
  const win = (Nc: number, ch: number, L: number) => {
    const eps = pred[`wave.Kn.${Nc}.${L}`];
    const F = pred[`cp.F.${Nc}.${ch}`];
    const nb = pred[`cp.Nnb.${Nc}.${ch}`];
    const ok = eps <= 0.1 && F <= 0.8 && nb >= 12;
    return `N_c ${Nc} c_h ${ch}: ε_p ${f(eps, 3)}, rms F·D ${f(F, 3)} kT, N_nb ${f(nb, 1)} → ${ok ? 'inside' : 'OUTSIDE'}`;
  };
  say(`  L4 (window, analytic): ${[win(4, 2, 80), win(16, 2, 80), win(64, 2, 160), win(4, 4, 80)].join('; ')}`);
}
say(`  L4 (window, measured): PQ6a N_c 4 ${fin.outcomes.pq6a[4]}, N_c 16 ${fin.outcomes.pq6a[16]}; PQ6c ${fin.outcomes.pq6c}`);

writeFileSync(join(dir, 'judged_report.txt'), `${out.join('\n')}\n`);
writeFileSync(
  join(dir, 'judged_summary.json'),
  `${JSON.stringify({ final: fin, first: { outcomes: first.outcomes, labels: first.labels }, extended, wall: { verdict: res.wall.verdict, configs: res.wall.configs }, f7, stationarity: res.stationarity, selections: res.selections, diagnostics: res.diagnostics, details: first.details, second: res.second?.details }, null, 1)}\n`,
);
console.log(out.join('\n'));
