/**
 * Stability-pilot evaluation (amendment A2 §1.5, §1.7). Reads ONLY the blind records
 * written for `--plan pilots` / `--plan pilots-r2` (scripts/ub0Job.ts → UB0Blind.blindRecord)
 * and applies the pre-declared rule. No physics observable exists in these files.
 *
 *   npx tsx scripts/ub0-pilots-eval.ts [--round 1|2] [--dir results/ub0/pilots]
 *        [--frozen results/ub0/frozen_inputs.json] [--power results/ub0/power_plan.json]
 *
 * The rule (UB0Timestep.pilotDecision): a pilot above ½ of its A2 gate halves its
 * comparability group once (round 2 repeats that group's pilots at the halved Courant
 * number); above ½ again, a halt, an instrument defect, or a dt-arm pilot drift ratio
 * below 2.5 ⇒ review. Then the feasibility rules: T64a1 is postponed (never shrunk) if its
 * pilot exceeds 2 × the B0 projection per seed; a pilot-measured judged cost above
 * 1.5 × the committed projection ⇒ review. Timing feeds the cost only.
 *
 * Writes <dir>/timestep_decision.json: `kind` (proceed | halve | review) and `halved`, the
 * comparability groups halved so far, which the runner reads for round 2 and the judged plan.
 * Exit codes: 0 proceed; 4 groups halved (run round 2); 5 review.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pilotGate, type BlindRecord } from '../src/universeB/UB0Blind';
import { pilotPlan, type FrozenInputs } from '../src/universeB/UB0Plans';
import { comparabilityOf, DT_ARM, pilotDecision } from '../src/universeB/UB0Timestep';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const round = Number(arg('--round', '1')) as 1 | 2;
const dir = arg('--dir', 'results/ub0/pilots');
const frozen = JSON.parse(readFileSync(arg('--frozen', 'results/ub0/frozen_inputs.json'), 'utf8')) as FrozenInputs;
const power = JSON.parse(readFileSync(arg('--power', 'results/ub0/power_plan.json'), 'utf8')) as {
  status: string;
  groups: Record<string, { n: number }>;
  cost: { groups: { group: string; coreHoursPerSeed: number }[]; judgedPlannedCoreHours: number };
};
if (power.status !== 'final') throw new Error('pilots are evaluated against the FINAL power plan only');
const decisionFile = join(dir, 'timestep_decision.json');
const previous = round === 2 ? (JSON.parse(readFileSync(decisionFile, 'utf8')) as { kind: string; halved: string[] }) : null;
if (previous && previous.kind !== 'halve') throw new Error(`round 2 follows a round-1 halving only (round 1 was '${previous.kind}')`);
const halvedBefore = previous?.halved ?? [];

const recs = readdirSync(join(dir, 'runs'))
  .filter((f) => f.endsWith('.json.gz'))
  .map((f) => readJsonGz<BlindRecord>(join(dir, 'runs', f)));
for (const r of recs) if (r.blind !== true) throw new Error(`${r.spec?.id}: not a blind record; refusing to read it`);
const byId = new Map(recs.map((r) => [r.spec.id, r]));
const plan = pilotPlan(frozen, round === 2 ? { round: 2, halved: halvedBefore } : { round: 1 });
const missing = plan.filter((p) => !byId.has(p.id)).map((p) => p.id);
if (missing.length) {
  console.error(`missing pilot results: ${missing.join(', ')}`);
  process.exit(1);
}

const gates = plan.map((p) => ({ p, gate: pilotGate(byId.get(p.id)!, p.group), rec: byId.get(p.id)! }));
const dtPair = (() => {
  const ref = gates.find((g) => g.p.group === DT_ARM.reference);
  const arm = gates.find((g) => g.p.group === DT_ARM.group);
  return ref && arm ? ([ref.gate.drift, arm.gate.drift] as [number, number]) : undefined;
})();
console.log(`stability pilots, round ${round}: ${gates.length} runs (one design seed per judged configuration)\n`);
console.log('  group        comparability   Courant   drift / gate   defects   wall-clock (h)');
for (const { p, gate, rec } of gates) {
  const sec = Object.values(rec.seconds).reduce((s, v) => s + v, 0);
  console.log(
    `  ${p.group.padEnd(12)} ${comparabilityOf(p.group).padEnd(14)} ${String(gate.courant).padStart(8)}   ${gate.fraction.toFixed(3).padStart(11)}   ${String(gate.defects.length).padStart(7)}   ${(sec / 3600).toFixed(3).padStart(8)}`,
  );
  for (const d of gate.defects) console.log(`      defect: ${d}`);
}
const decision = pilotDecision(
  gates.map((g) => g.gate),
  halvedBefore,
  dtPair,
);
const review: string[] = decision.kind === 'review' ? [...decision.reasons] : [];

// feasibility (A2 §1.7): measured pilot cost per seed against the committed B0 projection
const projected = new Map(power.cost.groups.map((c) => [c.group, c.coreHoursPerSeed]));
const measured = new Map(gates.map(({ p, rec }) => [p.group, Object.values(rec.seconds).reduce((s, v) => s + v, 0) / 3600]));
const t64 = { measured: measured.get('T64a1'), projected: projected.get('T64a1') };
const postpone64 = t64.measured !== undefined && t64.projected !== undefined && t64.measured > 2 * t64.projected;
let pilotCost = 0;
for (const [g, v] of Object.entries(power.groups)) pilotCost += (measured.get(g) ?? projected.get(g) ?? 0) * v.n;
if (round === 1 && pilotCost > 1.5 * power.cost.judgedPlannedCoreHours) {
  review.push(`pilot-measured judged cost ${pilotCost.toFixed(0)} core-h > 1.5 × the committed projection ${power.cost.judgedPlannedCoreHours.toFixed(0)}`);
}

console.log('\nA2 pilot rule:');
if (dtPair) console.log(`  dt-arm pilot pair: drift ratio ${(Math.abs(dtPair[0]) / Math.abs(dtPair[1])).toFixed(2)} (PQ7c needs ≥ 2.5)`);
if (review.length) console.log(`  REVIEW (nothing changes automatically):\n    ${review.join('\n    ')}`);
else if (decision.kind === 'halve') console.log(`  HALVE once: ${decision.halve.join(', ')} (triggered by ${decision.trigger.join(', ')}) → run round 2: npx tsx scripts/ub0-run.ts --plan pilots-r2`);
else console.log('  every pilot within ½ of its gate → proceed with the assigned Courant numbers' + (halvedBefore.length ? ` (halved: ${halvedBefore.join(', ')})` : ''));
console.log(`  T64a1: pilot ${t64.measured?.toFixed(2) ?? '—'} core-h per seed vs projection ${t64.projected?.toFixed(2) ?? '—'} → ${postpone64 ? 'POSTPONED (not shrunk): the bulk verdict covers N_c ≤ 16, "64 not run (infeasible)"' : 'feasible'}`);
console.log(`  judged plan from pilot wall time: ${pilotCost.toFixed(0)} core-h (projection ${power.cost.judgedPlannedCoreHours.toFixed(0)})`);

writeFileSync(
  decisionFile,
  `${JSON.stringify(
    {
      evaluated: new Date().toISOString(),
      round,
      kind: review.length ? 'review' : decision.kind,
      ...(decision.kind === 'halve' && !review.length ? { trigger: decision.trigger } : {}),
      // the comparability groups halved so far: round 2 repeats them; the judged plan uses them once round 2 proceeds
      halved: !review.length && decision.kind === 'halve' ? decision.halve : halvedBefore,
      review,
      dtArmDriftRatio: dtPair ? Math.abs(dtPair[0]) / Math.abs(dtPair[1]) : null,
      T64a1: { ...t64, postponed: postpone64 },
      pilotCostCoreHours: pilotCost,
      gates: gates.map((g) => ({ ...g.gate, comparability: comparabilityOf(g.p.group) })),
    },
    null,
    1,
  )}\n`,
);
console.log(`\nwrote ${decisionFile}`);
process.exit(review.length ? 5 : decision.kind === 'halve' ? 4 : 0);
