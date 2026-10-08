/**
 * The UB-0 power plan and seed plan (amendment A2 §3, §6). Universe A data only.
 *
 *   npx tsx scripts/ub0-power.ts --provisional   # Stage 0 alone → results/ub0/power_plan_provisional.json
 *   npx tsx scripts/ub0-power.ts                 # after Stage 0b and the freeze →
 *                                                #   results/ub0/power_plan.json (status final)
 *                                                #   results/ub0/seed_plan.json
 *        [--stage0 results/ub0/stage0] [--stage0b results/ub0/stage0b]
 *        [--frozen results/ub0/frozen_inputs.json] [--pred results/ub0/predictions_stage0.json]
 *        [--b0 results/ub0/b0/b0.json] [--mc-reps 20000]
 *
 * PROVISIONAL means: Stage 0's noise and references alone, every finer-Courant reference
 * stood in by its Courant 0.025 value. It shows the order of the counts and the cost; it
 * can never generate a judged plan (UB0Plans.ub0Plan refuses it). Every count that depends
 * on Stage 0b — all of them, through the noise basis and the references — is unresolved
 * until the final run of this script.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { lucyHat } from '../src/universeB/Predictions';
import {
  assertDisjoint,
  pilotPlan,
  seedBlocks,
  stage0bGroups,
  STAGE0B_SEED_START,
  STAGE0_SEED_START,
  stage0Plan,
  ub0Groups,
  UB0_SEED_START,
  PILOT_SEED_START,
  type FrozenInputs,
} from '../src/universeB/UB0Plans';
import { coreHoursPerSeed, countsOf, falsePassMC, MARGINS, powerPlan, type B0Row, type PowerInputs } from '../src/universeB/UB0Power';
import type { FrozenJudged } from '../src/universeB/UB0Pipeline';
import type { UB0Result } from '../src/universeB/UB0Run';
import { ens, type Stat } from '../src/universeB/UB0Stage0';
import { estimatesOf, noiseBasis } from '../src/universeB/UB0Stage0b';
import { comparabilityOf, COURANT_ASSIGNMENT } from '../src/universeB/UB0Timestep';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const provisional = argv.includes('--provisional');
const s0dir = arg('--stage0', 'results/ub0/stage0');
const s0bdir = arg('--stage0b', 'results/ub0/stage0b');
const frozenFile = arg('--frozen', 'results/ub0/frozen_inputs.json');
const b0 = JSON.parse(readFileSync(arg('--b0', 'results/ub0/b0/b0.json'), 'utf8')) as { rows: B0Row[]; commit: string };
const reps = Number(arg('--mc-reps', '20000'));
const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
})();
const n = UB0_PHI / (Math.PI / 4);
const s0 = JSON.parse(readFileSync(join(s0dir, 'stage0_summary.json'), 'utf8'));

let inputs: PowerInputs;
let frozen: FrozenInputs;
if (provisional) {
  // Stage 0 alone: noise and references at Courant 0.025; finer-Courant references stood in
  const active = new Set<string>(s0.activeRuns);
  const runs = stage0Plan({ reserve: true })
    .filter((p) => active.has(p.id))
    .map((plan) => ({ plan, result: readJsonGz<UB0Result>(join(s0dir, 'runs', `${plan.id}.json.gz`)) }));
  const E = estimatesOf(runs, 's0');
  const pred = JSON.parse(readFileSync(arg('--pred', 'results/ub0/predictions_stage0.json'), 'utf8')) as { values: Record<string, number>; map?: unknown; commit: string };
  if (!pred.map) throw new Error('the predictions file predates the A2 (D2) correction; regenerate it first');
  const v = pred.values;
  const ref = s0.references as Record<string, Stat>;
  const SA = [ref.S_A_shell1, ref.S_A_shell2];
  const KT = s0.mapping.KTred as Stat;
  const sh = (Nc: number): [number, number] => {
    const h = 2 * Math.sqrt(Nc);
    const k1 = (2 * Math.PI) / 80;
    return [lucyHat(k1, h), lucyHat(Math.SQRT2 * k1, h)];
  };
  inputs = {
    status: 'provisional',
    basis: {
      noise: `Stage 0 (${s0.commit}), Courant 0.025 cells only`,
      references: 'Stage 0 values; the finer-Courant matched references (Stage 0b) stood in by their Courant 0.025 values',
      judgedGamma: `predictions_stage0 (${pred.commit}; post-D2), Stage 0 c_A at every N_c`,
    },
    noise: noiseBasis(E, 0.02),
    refs: { nu: { 4: ref.nu_L80_U1, 16: ref.nu_L80_U1, 64: ref.nu_L160_U1 }, KT: { ...KT, value: KT.value * n, se: KT.se * n }, SA: { 4: SA, 16: SA } },
    judgedGamma: { 4: [v['pq3.lo.4'], v['pq3.hi.4']], 16: [v['pq3.lo.16'], v['pq3.hi.16']], 64: [v['pq3.lo.64'], v['pq3.hi.64']] },
    rpaStrength: { 4: 3 * KT.value, 16: 15 * KT.value },
    WhatShells: { 4: sh(4), 16: sh(16) },
  };
  frozen = {
    version: 'A2',
    KTred: KT.value,
    cRatio: { 4: [v['mf.cLo.4'], v['mf.cHi.4']], 16: [v['mf.cLo.16'], v['mf.cHi.16']], 64: [v['mf.cLo.64'], v['mf.cHi.64']] },
    cA: { 4: ref.c_A.value, 16: ref.c_A.value, 64: ref.c_A.value },
    soundAmplitude: 0.02,
  };
  void ens;
} else {
  const fz = JSON.parse(readFileSync(frozenFile, 'utf8')) as FrozenJudged & { provenance?: Record<string, string> };
  if (fz.version !== 'A2') throw new Error(`${frozenFile} is not in the A2 structure: run Stage 0b and scripts/ub0-freeze.ts first`);
  const s0b = JSON.parse(readFileSync(join(s0bdir, 'stage0b_summary.json'), 'utf8'));
  if (s0b.review?.length) throw new Error('Stage 0b has an open review trigger');
  inputs = {
    status: 'final',
    basis: { noise: `Stage 0 (${s0.commit}) + Stage 0b (${s0b.commit}), pooled within Courant cells`, frozenInputs: frozenFile, ...(fz.provenance ?? {}) },
    noise: s0b.noiseBasis,
    refs: { nu: fz.A.nu, KT: fz.A.KT, SA: fz.A.SA },
    judgedGamma: fz.judgedGamma,
    rpaStrength: fz.rpaStrength,
    WhatShells: fz.WhatShells,
  };
  frozen = fz;
}

const plan = powerPlan(inputs);
const counts = countsOf(plan);
const groups = ub0Groups(frozen, counts);

// cost (B0 model, ESTIMATE): judged plan, reserves for the extension, Stage 0b, pilots
const cost = groups.map((g) => {
  const perSeed = coreHoursPerSeed(g.base, b0.rows);
  return { group: g.group, comparability: comparabilityOf(g.group), courant: g.base.courant, n: g.n, coreHoursPerSeed: perSeed, coreHours: perSeed * g.n };
});
const planned = cost.reduce((s, c) => s + c.coreHours, 0);
const bulk = cost.filter((c) => !c.group.startsWith('W')).reduce((s, c) => s + c.coreHours, 0);
const armGroups = ['T4a1', 'T4a05', 'T16a1', 'T16a05', 'T16e08', 'T16e095', 'T4c4', 'L4', 'L16', 'L64'];
const armExt = cost.filter((c) => armGroups.includes(c.group)).reduce((s, c) => s + c.coreHours, 0);
const s0bCost = stage0bGroups(0.02).map((g) => ({ group: g.group, phase: g.phase, n: g.n, coreHours: coreHoursPerSeed(g.base, b0.rows) * g.n }));
const s0bTotal = s0bCost.reduce((s, c) => s + c.coreHours, 0);
const pilots = pilotPlan(frozen).reduce((s, p) => s + coreHoursPerSeed(p, b0.rows), 0);
const t64 = cost.find((c) => c.group === 'T64a1')!;

// false-PASS control (A2 §3.5): the decision rule simulated at the margin edge with the planned counts
const g = (k: string) => counts.n[k];
const sd = (k: keyof PowerInputs['noise']) => plan.noise[k].sdPlan;
const rel = (s: Stat) => ({ se: s.se / s.value, df: s.df });
const mc = {
  'pq1.4': falsePassMC({ nA: g('T4a1'), sA: sd('nuL80a1'), ref: rel(inputs.refs.nu[4]), margin: MARGINS.pq1, reps, seed: 101 }),
  'pq1.64': falsePassMC({ nA: g('T64a1'), sA: sd('nuL160a1'), ref: rel(inputs.refs.nu[64]), margin: MARGINS.pq1, reps, seed: 102 }),
  'pq6a.4': falsePassMC({ nA: g('T4a1'), sA: sd('nuL80a1'), nB: g('T4a05'), sB: sd('nuL80a05'), margin: MARGINS.pq6a, reps, seed: 103 }),
  pq6b: falsePassMC({ nA: g('T16e08'), sA: sd('nuL80a1'), nB: g('T16e095'), sB: sd('nuL80a1'), margin: MARGINS.pq6b, reps, seed: 104 }),
  'pq6c.nu': falsePassMC({ nA: g('T4c4'), sA: sd('nuL80a1'), nB: g('T4a1'), sB: sd('nuL80a1'), margin: MARGINS.pq6cNu, reps, seed: 105 }),
  'pq5.16 (shell 1)': falsePassMC({ nA: g('SL16'), sA: sd('S1'), margin: MARGINS.pq5, reps, seed: 106 }),
};

const out: Record<string, unknown> = {
  commit,
  generated: new Date().toISOString(),
  note:
    plan.status === 'provisional'
      ? 'PROVISIONAL (Stage 0 only). Not a seed allocation: every count is unresolved until Stage 0b; UB0Plans.ub0Plan refuses this file.'
      : 'FINAL power plan (Stage 0 + Stage 0b). The seed plan (seed_plan.json) is generated from it.',
  b0: { commit: b0.commit, note: 'cost per seed: B0 µs per parcel-step × parcels × steps at the assigned Courant number (ESTIMATE)' },
  courantAssignment: COURANT_ASSIGNMENT,
  ...plan,
  cost: {
    groups: cost,
    judgedPlannedCoreHours: planned,
    extensionUpperBoundCoreHours: bulk,
    extensionArmsOnlyCoreHours: armExt,
    stage0bCoreHours: s0bTotal,
    stage0b: s0bCost,
    pilotsCoreHours: pilots,
    T64a1: { coreHoursPerSeed: t64.coreHoursPerSeed, feasibilityLimitPerSeed: 2 * t64.coreHoursPerSeed, note: 'A2 §1.7: postponed (never shrunk) only if its pilot exceeds 2 × this projection per seed, or cannot complete' },
  },
  falsePassMonteCarlo: { reps, trueRatio: 'at the upper margin edge', results: mc, bound: 'first look ≤ 2.5 % per side; with the single extension ≤ 3.75 % per side (union bound)' },
};
const file = provisional ? 'results/ub0/power_plan_provisional.json' : 'results/ub0/power_plan.json';
writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);

if (!provisional) {
  const blocks = seedBlocks(groups, UB0_SEED_START);
  const s0b = seedBlocks(stage0bGroups(0.02), STAGE0B_SEED_START);
  const s0p = stage0Plan({ reserve: true }).map((p) => p.seed);
  const pil = pilotPlan(frozen).map((p) => p.seed);
  assertDisjoint([
    { name: 'tests/integrator/B0 design seeds 9001–9999', range: [9001, 9999] },
    { name: 'Stage 0', range: [Math.min(...s0p), Math.max(...s0p)] },
    { name: 'Stage 0b', range: [STAGE0B_SEED_START, s0b[s0b.length - 1].reserve[1]] },
    { name: 'UB-0 judged', range: [UB0_SEED_START, blocks[blocks.length - 1].reserve[1]] },
  ]);
  if (Math.min(...pil) < PILOT_SEED_START || Math.max(...pil) > 9999) throw new Error('pilot seeds outside the design block');
  if (STAGE0_SEED_START !== 10001) throw new Error('Stage 0 block moved');
  writeFileSync(
    'results/ub0/seed_plan.json',
    `${JSON.stringify({ commit, generated: new Date().toISOString(), powerPlan: file, rule: 'UB0Plans.allocate: groups in the canonical order of ub0Groups, a contiguous block of 2n per group (planned first, then reserve), from 20001', blocks, total: blocks.reduce((s, b) => s + 2 * b.n, 0) }, null, 1)}\n`,
  );
}

// report
const pct = (x: number) => `${(100 * x).toFixed(2)} %`;
console.log(`UB-0 power plan — ${plan.status.toUpperCase()}  (commit ${commit})`);
console.log('\nnoise basis (Universe A, per seed; planning SD = 80 % upper confidence bound):');
for (const [k, e] of Object.entries(plan.noise)) {
  console.log(`  ${k.padEnd(9)} SD ${e.relative ? pct(e.sd) : e.sd.toExponential(3)}  df ${String(e.df).padStart(4)}  95 % [${e.relative ? pct(e.sd95[0]) : e.sd95[0].toExponential(2)}, ${e.relative ? pct(e.sd95[1]) : e.sd95[1].toExponential(2)}]  ×${e.planningFactor.toFixed(3)} → ${e.relative ? pct(e.sdPlan) : e.sdPlan.toExponential(3)}`);
}
console.log('\nprimaries (expected 95 % CI half-width at the planned counts; log scale for ratios):');
for (const p of plan.primaries) {
  const hw = p.key.startsWith('wall') ? `${(100 * p.halfWidthPlan).toFixed(0)} % of tolerance` : p.key.startsWith('pq3') ? `±${p.halfWidthPlan.toFixed(4)}` : `±${pct(p.halfWidthPlan)}`;
  const tg = p.targetHalfWidth === null ? 'not powered' : p.key.startsWith('wall') ? `target ${(100 * p.targetHalfWidth).toFixed(0)} %` : p.key.startsWith('pq3') ? `target ±${p.targetHalfWidth.toFixed(4)}` : `target ±${pct(p.targetHalfWidth)}`;
  const oc = p.pPassIfExact !== undefined ? `  P(PASS | exact) ${p.pPassIfExact.toFixed(3)}, P(PASS | ⅓ margin off) ${p.pPassIfThirdMargin!.toFixed(3)}, P(FAIL | 2× margin off) ${p.pFailIfTwiceMargin!.toFixed(3)}` : '';
  console.log(`  ${p.key.padEnd(10)} ${p.statistic.padEnd(26)} ${p.margin.padEnd(28)} ${tg.padEnd(22)} plan ${hw}${oc}`);
}
console.log('\nplanned seeds per judged group (design count is the floor):');
for (const c of cost) console.log(`  ${c.group.padEnd(10)} ${String(c.n).padStart(4)} (design ${String(plan.groups[c.group].design).padStart(3)}; ${plan.groups[c.group].setBy.join(', ')})  Courant ${c.courant}  ${c.coreHoursPerSeed.toFixed(3)} core-h/seed → ${c.coreHours.toFixed(1)}`);
console.log(`\ncost (B0 ESTIMATE): judged planned ${planned.toFixed(0)} core-h; extension ≤ ${bulk.toFixed(0)} (all bulk groups doubled; arms and sound only ${armExt.toFixed(0)}); Stage 0b ${s0bTotal.toFixed(0)}; pilots ${pilots.toFixed(1)}`);
console.log(`T64a1 ${t64.coreHoursPerSeed.toFixed(2)} core-h per seed at Courant ${t64.courant}; feasibility limit (A2 §1.7) 2× = ${(2 * t64.coreHoursPerSeed).toFixed(2)}`);
console.log('\nfalse-PASS control at the upper margin edge (simulation; bound 2.5 % first look, 3.75 % with the extension):');
for (const [k, r] of Object.entries(mc)) console.log(`  ${k.padEnd(18)} first look ${pct(r.firstLook)}; with the extension ${pct(r.withExtension)} (extended in ${pct(r.extended)})`);
console.log(`\nwrote ${file}${provisional ? '' : ' and results/ub0/seed_plan.json'}`);
void existsSync;
