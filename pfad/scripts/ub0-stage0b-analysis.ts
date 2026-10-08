/**
 * Stage 0b analysis (docs/CRITERIA_UB0_STAGE0B.md §6–§9). Universe A only.
 *
 *   npx tsx scripts/ub0-stage0b-analysis.ts            # after phase 1: the amplitude decision
 *   npx tsx scripts/ub0-stage0b-analysis.ts --final    # after phase 2: references, checks, noise basis
 *        [--dir results/ub0/stage0b] [--stage0 results/ub0/stage0]
 *        [--halved N4-static,...]   # protocol §8: after a pilot halving, the contingency references
 *
 * Applied mechanically:
 *  - quality gates of Stage 0 (protocol §6) per run; an excluded run is replaced by the
 *    next unused reserve seed of its group; missing runs are listed (exit 3);
 *  - Stage 0's USED runs are pooled with the Stage 0b groups of identical spec; Stage 0's
 *    runs and its frozen mapping input K_T,A are never changed;
 *  - phase 1 → results/ub0/stage0b/amplitude_decision.json (protocol §4);
 *  - --final → stage0b_summary.json, stage0b_reference.json (input of the predictions),
 *    stage0b_report.txt; exit 4 if any review trigger fired (protocol §5), in which case
 *    nothing may be frozen until the review.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Interval } from '../src/universeB/UB0Analysis';
import { stage0bContingency, stage0bPlan, stage0Plan, type PlannedRun, type SoundAmplitude } from '../src/universeB/UB0Plans';
import { planningFactor, planningSD } from '../src/universeB/UB0Power';
import type { UB0Result } from '../src/universeB/UB0Run';
import { ci95, qualityGates, type Stat } from '../src/universeB/UB0Stage0';
import { amplitudeDecision, dtChecks, estimatesOf, matchedReferences, noiseBasis, pooledReferences, type Estimates } from '../src/universeB/UB0Stage0b';
import { COURANT_ASSIGNMENT } from '../src/universeB/UB0Timestep';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const dir = arg('--dir', 'results/ub0/stage0b');
const s0dir = arg('--stage0', 'results/ub0/stage0');
const final = argv.includes('--final');
const halved = arg('--halved', '').split(',').filter(Boolean);
for (const g of halved) if (!(g in COURANT_ASSIGNMENT)) throw new Error(`unknown comparability group ${g}`);
const assignment = Object.fromEntries(Object.entries(COURANT_ASSIGNMENT).map(([g, c]) => [g, halved.includes(g) ? c / 2 : c]));
const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();

const s0summary = JSON.parse(readFileSync(join(s0dir, 'stage0_summary.json'), 'utf8'));
const s0active = new Set<string>(s0summary.activeRuns);
const s0runs = stage0Plan({ reserve: true })
  .filter((p) => s0active.has(p.id))
  .map((plan) => ({ plan, result: readJsonGz<UB0Result>(join(s0dir, 'runs', `${plan.id}.json.gz`)) }));

/** Stage 0's rule 1: excluded planned runs replaced by the next unused reserve of their group. `extra`: groups whose reserves are activated (protocol §8). */
function select(all: PlannedRun[], extra: string[] = []) {
  const load = (p: PlannedRun) => {
    const f = join(dir, 'runs', `${p.id}.json.gz`);
    return existsSync(f) ? readJsonGz<UB0Result>(f) : null;
  };
  const active = new Set(all.filter((p) => p.planned || extra.includes(p.group)).map((p) => p.id));
  const notes: string[] = [];
  const missing: string[] = [];
  for (const g of [...new Set(all.map((p) => p.group))]) {
    const inG = all.filter((p) => p.group === g);
    const reserves = inG.filter((p) => !p.planned);
    let ri = 0;
    for (const p of inG.filter((q) => q.planned)) {
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
  const need = [...active].filter((id) => !existsSync(join(dir, 'runs', `${id}.json.gz`)));
  return { notes, need, runs: all.filter((p) => active.has(p.id) && existsSync(join(dir, 'runs', `${p.id}.json.gz`))).map((plan) => ({ plan, result: load(plan)! })), active };
}

const p1 = select(stage0bPlan({ phase: 1, reserve: true }));
if (p1.need.length) {
  console.log(p1.notes.join('\n'));
  console.log(`RUN NEEDED (phase 1, ${p1.need.length}):\n${p1.need.join('\n')}`);
  process.exit(3);
}
const E: Estimates = estimatesOf(s0runs, 's0');
estimatesOf(p1.runs, 's0b', E);
const fmtI = (r: Interval, d = 4) => `${r.estimate.toFixed(d)} [${r.ci[0].toFixed(d)}, ${r.ci[1].toFixed(d)}]`;
const fmtS = (s: Stat, d = 5) => {
  const [lo, hi] = ci95(s);
  return `${s.value.toFixed(d)} ± ${s.se.toFixed(d)} (95 % CI [${lo.toFixed(d)}, ${hi.toFixed(d)}], n = ${s.n})`;
};

if (!final) {
  const d = amplitudeDecision(E);
  writeFileSync(join(dir, 'amplitude_decision.json'), `${JSON.stringify({ commit, generated: new Date().toISOString(), notes: p1.notes, ...d }, null, 1)}\n`);
  console.log('Stage 0b phase 1 — the standing-wave amplitude decision (protocol §4), Courant 0.025');
  console.log(`  per-seed relative SD of c: 0.02 → ${(100 * d.sd.a02).toFixed(2)} % (n ${d.n.a02}, plan ${(100 * d.sdPlan.a02).toFixed(2)} %); 0.04 → ${(100 * d.sd.a04).toFixed(2)} % (n ${d.n.a04}, plan ${(100 * d.sdPlan.a04).toFixed(2)} %)`);
  console.log(`  c(0.04)/c(0.02) = ${fmtI(d.ratio)}`);
  console.log(`  (i) precision gain ${d.rule.precisionGain}; (ii) CI contains 1 ${d.rule.ciContainsOne}; (iii) |shift| ≤ 1 % ${d.rule.shiftWithin1pct}`);
  console.log(`  SELECTED amplitude: ${d.selected} of c → run phase 2: npx tsx scripts/ub0-run.ts --plan stage0b-2`);
  process.exit(0);
}

const dec = JSON.parse(readFileSync(join(dir, 'amplitude_decision.json'), 'utf8')) as { selected: SoundAmplitude };
const a = dec.selected;
const cont = stage0bContingency(halved, a);
// the contingency activates whole reserve blocks of existing groups; their reserves then serve as planned runs
const p1x = cont.activateReserves.includes('T80a1c00625') ? select(stage0bPlan({ phase: 1, reserve: true }), ['T80a1c00625']) : p1;
const p2 = select(stage0bPlan({ phase: 2, amplitude: a, reserve: true }), cont.activateReserves);
const p3 = select(cont.plan.map((p) => ({ ...p, planned: true })));
const needAll = [...p1x.need, ...p2.need, ...p3.need];
if (needAll.length) {
  console.log([...p2.notes, ...p3.notes].join('\n'));
  console.log(`RUN NEEDED (phase 2${halved.length ? ' and contingency' : ''}, ${needAll.length}):\n${needAll.join('\n')}`);
  process.exit(3);
}
if (p1x !== p1) {
  for (const k of Object.keys(E)) if (k.startsWith('s0b:')) delete E[k];
  estimatesOf(p1x.runs, 's0b', E);
}
estimatesOf(p2.runs, 's0b', E);
estimatesOf(p3.runs, 's0b', E);
const KTred: Stat = s0summary.mapping.KTred;
const checks = dtChecks(E, KTred, a, [0.0125, 0.00625, ...(halved.includes('N4-static') ? [0.003125] : [])]);
const refs = matchedReferences(E, a, assignment);
const noise = noiseBasis(E, a);
const pooled = pooledReferences(E, a);
const review = checks.filter((c) => c.review).map((c) => `${c.quantity} at Courant ${c.courant}: ${fmtI(c.ratio)} → ${c.outcome}`);

const src = 'Stage 0 + Stage 0b Universe A measurements (results/ub0/stage0, results/ub0/stage0b)';
const s0in = s0summary.predictionInputs;
const reference = {
  label: 'Stage 0 + Stage 0b Universe A measurements',
  phi: s0in.phi,
  Z: s0in.Z,
  KTred: s0in.KTred, // the frozen mapping input, unchanged
  cA: { value: pooled.cA.value, se: pooled.cA.se, df: pooled.cA.df, source: `${src}: standing wave L = 160 d, amplitude ${a}, Courant 0.025` },
  lambda: { value: pooled.lambda.value, se: pooled.lambda.se, df: pooled.lambda.df, source: `${src}: long static boxes, Courant 0.025` },
  nu: { value: pooled.nuL80.value, se: pooled.nuL80.se, df: pooled.nuL80.df, source: `${src}: shear wave L = 80 d, U₀ = c_th, Courant 0.025` },
  collisionRate: { value: pooled.collisionRate.value, se: pooled.collisionRate.se, df: pooled.collisionRate.df, source: `${src}: long static boxes, Courant 0.025` },
  cAByNc: Object.fromEntries(
    ([4, 16, 64] as const).map((n) => [n, { value: refs.cA[n].value, se: refs.cA[n].se, df: refs.cA[n].df, source: `${src}: standing wave L = 160 d, amplitude ${a}, Courant ${refs.courant[n === 4 ? 'N4-static' : n === 16 ? 'N16-static' : 'N64-static']} (matched to L${n})` }]),
  ),
};
const summary = {
  commit,
  generated: new Date().toISOString(),
  notes: [...p1x.notes, ...p2.notes, ...p3.notes],
  activeRuns: [...p1x.active, ...p2.active, ...p3.active].sort(),
  halved,
  amplitude: a,
  mapping: { KTred, note: 'Stage 0 mapping input, unchanged by Stage 0b' },
  matchedReferences: refs,
  dtChecks: checks,
  review,
  noiseBasis: Object.fromEntries(Object.entries(noise).map(([k, e]) => [k, { ...e, planningFactor: planningFactor(e.df), sdPlan: planningSD(e) }])),
  pooledReferences: pooled,
};
writeFileSync(join(dir, 'stage0b_summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
writeFileSync(join(dir, 'stage0b_reference.json'), `${JSON.stringify(reference, null, 1)}\n`);
const lines = [
  'UB-0 Stage 0b — Universe A supplement (references, amplitude study, timestep checks)',
  `analysis commit ${commit}; Universe A only (N_c = 1); Stage 0 runs pooled where the spec is identical`,
  '',
  `MAPPING INPUT (Stage 0, unchanged): K_T,A/(n kT) = ${fmtS(KTred)}`,
  `AMPLITUDE (protocol §4): ${a} of c`,
  '',
  'MATCHED REFERENCES (A2 §1.4):',
  ...([4, 16, 64] as const).map((n) => `  ν_A for N_c = ${n}: ${fmtS(refs.nu[n])}`),
  ...([4, 16, 64] as const).map((n) => `  c_A for N_c = ${n}: ${fmtS(refs.cA[n])}`),
  ...([4, 16] as const).flatMap((n) => refs.SA[n].map((s, i) => `  S_A shell ${i + 1} for N_c = ${n}: ${fmtS(s)}`)),
  '',
  'TIMESTEP CHECKS (protocol §5; K: CI inside ±1/30 else review; ν, c, S: review if CI entirely outside [0.97, 1.03]):',
  ...checks.map((c) => `  ${c.quantity.padEnd(48)} Courant ${String(c.courant).padEnd(7)} ${fmtI(c.ratio)} → ${c.outcome}${c.review ? '  REVIEW' : ''}`),
  '',
  'NOISE BASIS OF THE POWER PLAN (pooled within Courant cells; planning SD = 80 % upper bound):',
  ...Object.entries(noise).map(([k, e]) => `  ${k.padEnd(9)} SD ${e.relative ? `${(100 * e.sd).toFixed(3)} %` : e.sd.toExponential(3)} df ${e.df}  plan ${e.relative ? `${(100 * planningSD(e)).toFixed(3)} %` : planningSD(e).toExponential(3)}  — ${e.source}`),
  '',
  'UNIVERSE A WALL GATES (reported, not judged):',
  `  G-W1 ${fmtS(pooled.wall.gw1)}`,
  `  G-W2 ${fmtS(pooled.wall.gw2)}`,
  `  G-W3 ${fmtS(pooled.wall.gw3)}`,
  '',
  'EXCLUSIONS:',
  ...(summary.notes.length ? summary.notes.map((n) => `  ${n}`) : ['  none']),
  '',
  review.length ? `REVIEW REQUIRED (${review.length}): nothing may be frozen until it is resolved` : 'no review trigger fired',
];
writeFileSync(join(dir, 'stage0b_report.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
process.exit(review.length ? 4 : 0);
