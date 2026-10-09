/**
 * POST-HOC DIAGNOSTIC (not part of the Stage 0b protocol; no rule depends on it). Universe A only.
 *
 *   npx tsx scripts/ub0-stage0b-pooling-check.ts [--repro s0-T80a1-10065,...]
 *
 * Stage 0b pools Stage 0's used runs with Stage 0b runs of identical spec, made at a
 * later code version (protocol §7). This checks that the two are exchangeable:
 *  1. re-runs Stage 0 seeds with the current code and compares them with the stored
 *     Stage 0 records (identical apart from the unexplained-late-contact counter, which the
 *     7b1f3b7 instrument fix changes by design);
 *  2. compares Stage 0 and Stage 0b means of every pooled group (Welch t), and the four
 *     T80a1 cells (Stage 0 and Stage 0b at 0.025; 0.0125; 0.00625) by one-way ANOVA.
 */
import { readFileSync } from 'node:fs';
import { oneWayAnova, tTwoSidedP } from '../src/measurements/Statistics';
import { stage0bPlan, stage0Plan, type PlannedRun } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Result } from '../src/universeB/UB0Run';
import { estimatesOf } from '../src/universeB/UB0Stage0b';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const repro = (argv.includes('--repro') ? argv[argv.indexOf('--repro') + 1] : 's0-T80a1-10065,s0-T80a1-10113,s0-SL-10049,s0-L160-10385').split(',').filter(Boolean);
const R = 'results/ub0/';
const s0 = JSON.parse(readFileSync(`${R}stage0/stage0_summary.json`, 'utf8'));
const s0b = JSON.parse(readFileSync(`${R}stage0b/stage0b_summary.json`, 'utf8'));
const a0 = new Set<string>(s0.activeRuns);
const a1 = new Set<string>(s0b.activeRuns);

console.log('1. Stage 0 seeds re-run with the current code:');
const all0 = stage0Plan({ reserve: true });
for (const id of repro) {
  const p = all0.find((x) => x.id === id);
  if (!p) throw new Error(`unknown Stage 0 run ${id}`);
  const { group, planned, periodHint, ...spec } = p;
  void group;
  void planned;
  void periodHint;
  const stored = readJsonGz<UB0Result>(`${R}stage0/runs/${id}.json.gz`);
  const run = new UB0Run(spec);
  while (!run.done) run.advance(5000);
  const strip = (x: UB0Result) => {
    const { timing, ...rest } = x;
    void timing;
    const s = JSON.parse(JSON.stringify(rest));
    for (const ph of Object.values(s.phaseLedgers) as { lateContactsUnexplained?: number }[]) delete ph.lateContactsUnexplained;
    return JSON.stringify(s);
  };
  console.log(`   ${id}: identical apart from the late-contact counter: ${strip(run.result()) === strip(stored)}`);
}

const pooled = ['T80a1', 'T160a1', 'SL', 'W40', 'L160'];
const load = (plans: PlannedRun[], active: Set<string>, dir: string) =>
  plans.filter((p) => active.has(p.id)).map((plan) => ({ plan, result: readJsonGz<UB0Result>(`${R}${dir}/runs/${plan.id}.json.gz`) }));
const E = estimatesOf(load(all0.filter((p) => pooled.includes(p.group)), a0, 'stage0'), 's0');
estimatesOf(load(stage0bPlan({ phase: 1, reserve: true }).filter((p) => [...pooled, 'T80a1c0125', 'T80a1c00625'].includes(p.group)), a1, 'stage0b'), 's0b', E);
const st = (v: number[]) => {
  const n = v.length;
  const m = v.reduce((a, x) => a + x, 0) / n;
  return { n, m, se2: v.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1) / n };
};
console.log('\n2. Stage 0 against Stage 0b, identical specs (Welch):');
for (const [g, q] of [['T80a1', 'nu'], ['T160a1', 'nu'], ['SL', 'S1'], ['SL', 'S2'], ['L160', 'c'], ['W40', 'gw1'], ['W40', 'gw2'], ['W40', 'gw3']] as const) {
  const a = st(E[`s0:${g}`][q]!);
  const b = st(E[`s0b:${g}`][q]!);
  const t = (b.m - a.m) / Math.sqrt(a.se2 + b.se2);
  const df = (a.se2 + b.se2) ** 2 / (a.se2 ** 2 / (a.n - 1) + b.se2 ** 2 / (b.n - 1));
  console.log(`   ${`${g} ${q}`.padEnd(11)} ${a.m.toFixed(4)} (n ${a.n}) vs ${b.m.toFixed(4)} (n ${b.n}): ${(100 * (b.m / a.m - 1)).toFixed(2)} %, t ${t.toFixed(2)}, p ${tTwoSidedP(t, df).toFixed(3)}`);
}
const cells = [E['s0:T80a1'].nu!, E['s0b:T80a1'].nu!, E['s0b:T80a1c0125'].nu!, E['s0b:T80a1c00625'].nu!];
const an = oneWayAnova(cells);
console.log(`\n   T80a1 ν, four cells (Stage 0 0.025 / Stage 0b 0.025 / 0.0125 / 0.00625): means ${cells.map((c) => st(c).m.toFixed(4)).join(' / ')}; F ${an.F.toFixed(2)} (${an.df1}, ${an.df2}), p ${an.pValue.toFixed(3)}`);
