/**
 * Stage 0 analysis (docs/CRITERIA_UB0_STAGE0.md §6–§8). Universe A only.
 *
 *   npx tsx scripts/ub0-stage0-analysis.ts [--dir results/ub0/stage0]
 *
 * Pre-declared reserve activation (protocol §7), applied mechanically:
 *  1. a planned run that fails a quality gate is replaced by the next unused
 *     reserve seed of its group;
 *  2. if a precision target is missed with the planned seeds, all reserve seeds
 *     of the groups feeding that quantity are activated, once.
 * If an activated reserve has no result yet, the script lists the runs needed
 * and exits with code 3 (run them with ub0-run.ts --reserve --filter …).
 * Otherwise it writes stage0_summary.json, stage0_reference.json (the input for
 * scripts/ub0-predictions.ts --inputs) and stage0_report.txt.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stage0Plan, type PlannedRun } from '../src/universeB/UB0Plans';
import type { UB0Result } from '../src/universeB/UB0Run';
import { aggregateStage0, ci95, qualityGates, type Stat } from '../src/universeB/UB0Stage0';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const dir = argv.includes('--dir') ? argv[argv.indexOf('--dir') + 1] : 'results/ub0/stage0';
const all = stage0Plan({ reserve: true });
const load = (p: PlannedRun) => {
  const f = join(dir, 'runs', `${p.id}.json.gz`);
  return existsSync(f) ? readJsonGz<UB0Result>(f) : null;
};
const groups = [...new Set(all.map((p) => p.group))];
const active = new Set(all.filter((p) => p.planned).map((p) => p.id));
const missing: string[] = [];
const notes: string[] = [];

// rule 1: replace excluded planned runs by the next reserve of the group
for (const g of groups) {
  const inGroup = all.filter((p) => p.group === g);
  const reserves = inGroup.filter((p) => !p.planned);
  let ri = 0;
  for (const p of inGroup.filter((q) => q.planned)) {
    const r = load(p);
    if (!r) {
      missing.push(p.id);
      continue;
    }
    const why = qualityGates(r);
    if (why.length) {
      active.delete(p.id);
      const rep = reserves[ri++];
      if (!rep) throw new Error(`group ${g}: no reserve left to replace ${p.id}`);
      active.add(rep.id);
      notes.push(`excluded ${p.id} (${why.join('; ')}) → replaced by ${rep.id}`);
    }
  }
}
const collect = () =>
  all
    .filter((p) => active.has(p.id))
    .map((p) => ({ plan: p, result: load(p) }))
    .filter((x): x is { plan: PlannedRun; result: UB0Result } => x.result !== null);
const needed = () => [...active].filter((id) => !existsSync(join(dir, 'runs', `${id}.json.gz`)));
if (needed().length) {
  console.log(`RUN NEEDED (${needed().length}):\n${needed().join('\n')}`);
  process.exit(3);
}
// rule 2: precision targets with the planned (+ replacement) seeds → extension, once
let summary = aggregateStage0(collect());
const feeds: Record<string, string[]> = { KTred: ['SK18', 'SK22'], nu_L80_U1: ['T80a1'], c_A: ['L160'], S_A_shell1: ['SL'] };
const extended: string[] = [];
for (const [q, pr] of Object.entries(summary.precision)) {
  if (pr.met) continue;
  for (const g of feeds[q]) {
    if (extended.includes(g)) continue;
    extended.push(g);
    for (const p of all.filter((x) => x.group === g && !x.planned)) active.add(p.id);
  }
  notes.push(`precision target for ${q} missed (rel SE ${pr.relSE.toFixed(4)} > ${pr.target}) → reserves of ${feeds[q].join(', ')} activated`);
}
if (needed().length) {
  console.log(notes.join('\n'));
  console.log(`RUN NEEDED (${needed().length}):\n${needed().join('\n')}`);
  process.exit(3);
}
if (extended.length) summary = aggregateStage0(collect());

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
const out = { commit, generated: new Date().toISOString(), notes, extendedGroups: extended, activeRuns: [...active].sort(), ...summary };
writeFileSync(join(dir, 'stage0_summary.json'), JSON.stringify(out, null, 1));
writeFileSync(join(dir, 'stage0_reference.json'), JSON.stringify(summary.predictionInputs, null, 1));
const f = (s: Stat, d = 5) => {
  const [lo, hi] = ci95(s);
  return `${s.value.toFixed(d)} ± ${s.se.toFixed(d)} (95 % CI [${lo.toFixed(d)}, ${hi.toFixed(d)}], n = ${s.n}, df = ${s.df.toFixed(1)})`;
};
const lines = [
  'UB-0 Stage 0 — Universe A inputs and references',
  `analysis commit ${commit}; ${summary.runs} runs used; Universe A only (N_c = 1)`,
  '',
  'MAPPING INPUT (the only Stage 0 quantity that may set a Universe B parameter):',
  `  K_T,A/(n kT) = ${f(summary.mapping.KTred)}`,
  '',
  'REFERENCES (targets and prediction inputs; never Universe B parameters):',
  ...Object.entries(summary.references).map(([k, v]) => `  ${k.padEnd(24)} ${'value' in v ? f(v as Stat) : JSON.stringify(v)}`),
  '',
  'PRECISION TARGETS (protocol §7):',
  ...Object.entries(summary.precision).map(([k, v]) => `  ${k.padEnd(12)} rel SE ${v.relSE.toFixed(4)} target ${v.target} ${v.met ? 'met' : 'NOT MET'}`),
  '',
  'EXCLUSIONS AND EXTENSIONS:',
  ...(notes.length ? notes.map((n) => `  ${n}`) : ['  none']),
];
writeFileSync(join(dir, 'stage0_report.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
