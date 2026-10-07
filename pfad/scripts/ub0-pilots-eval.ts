/**
 * Stability-pilot evaluation (A1 §4.3). Reads ONLY the blind records written for
 * `--plan pilots` (scripts/ub0Job.ts → UB0Blind.blindRecord) and applies the
 * pre-declared timestep rule. No physics observable exists in these files.
 *
 *   npx tsx scripts/ub0-pilots-eval.ts [--dir results/ub0/pilots] [--frozen results/ub0/frozen_inputs.json]
 *
 * Exit codes: 0 Courant 0.025 retained; 4 the timestep rule is triggered (0.0125
 * throughout, Universe A inputs repeated and re-frozen); 5 review needed (halt,
 * PQ7 a/e defect, or a gate exceeded at 0.0125). Timing feeds the cost estimate only.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pilotGate, timestepDecision, type BlindRecord } from '../src/universeB/UB0Blind';
import { COURANT_BASE, pilotPlan, ub0Groups, type FrozenInputs } from '../src/universeB/UB0Plans';
import { readJsonGz } from './ub0Job';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const dir = arg('--dir', 'results/ub0/pilots');
const frozen = JSON.parse(readFileSync(arg('--frozen', 'results/ub0/frozen_inputs.json'), 'utf8')) as FrozenInputs;

const files = readdirSync(join(dir, 'runs')).filter((f) => f.endsWith('.json.gz'));
const recs = files.map((f) => readJsonGz<BlindRecord>(join(dir, 'runs', f)));
for (const r of recs) if (r.blind !== true) throw new Error(`${r.spec?.id}: not a blind record; refusing to read it`);
const byId = new Map(recs.map((r) => [r.spec.id, r]));
const courant = recs[0]?.spec.courant ?? COURANT_BASE;
const plan = pilotPlan(frozen, courant);
const missing = plan.filter((p) => !byId.has(p.id)).map((p) => p.id);
if (missing.length) {
  console.error(`missing pilot results: ${missing.join(', ')}`);
  process.exit(1);
}

const gates = plan.map((p) => ({ group: p.group, gate: pilotGate(byId.get(p.id)!), rec: byId.get(p.id)! }));
console.log(`stability pilots: ${gates.length} runs (one design seed per judged configuration)\n`);
console.log('  group         Courant   drift stat     limit   pass   defects   wall-clock (h)');
for (const { group, gate, rec } of gates) {
  const sec = Object.values(rec.seconds).reduce((s, v) => s + v, 0);
  console.log(
    `  ${group.padEnd(12)} ${gate.courant.toString().padStart(7)} ${gate.drift.toExponential(2).padStart(11)} ${gate.driftLimit.toExponential(0).padStart(9)}   ${gate.driftPass ? 'yes' : 'NO '}   ${String(gate.defects.length).padStart(7)}   ${(sec / 3600).toFixed(3).padStart(8)}`,
  );
  for (const d of gate.defects) console.log(`      defect: ${d}`);
}
const decision = timestepDecision(
  gates.map((g) => g.gate),
  COURANT_BASE,
);
console.log('\ntimestep rule (A1 §4.3):');
if (decision.kind === 'retain') console.log(`  all pilots within their drift gates → Courant ${decision.courant} retained`);
else if (decision.kind === 'halve')
  console.log(
    `  TRIGGERED by ${decision.trigger.join(', ')} → Courant ${decision.courant} throughout UB-0; Universe A Stage 0 repeated at ${decision.courant} (same seeds) and re-frozen; dt arm at ${decision.courant / 2}`,
  );
else console.log(`  REVIEW: ${decision.reason}: ${decision.ids.join(', ')} (nothing changes automatically)`);

// cost of the judged plan from the measured pilot wall time (planned seeds; reserves extra)
const groups = ub0Groups(frozen, courant);
let total = 0;
const cost: Record<string, { n: number; hoursPerSeed: number; hours: number }> = {};
for (const g of groups) {
  const r = gates.find((x) => x.group === g.group)!.rec;
  const h = Object.values(r.seconds).reduce((s, v) => s + v, 0) / 3600;
  cost[g.group] = { n: g.n, hoursPerSeed: h, hours: h * g.n };
  total += h * g.n;
}
console.log(`\njudged plan (planned seeds) from pilot wall time: ${total.toFixed(1)} core-h ≈ ${(total / 4).toFixed(1)} h on 4 cores`);
const t64 = cost.T64a1;
if (t64) console.log(`  T64a1: ${t64.hoursPerSeed.toFixed(2)} core-h per seed (pilot wall time; the postponement rule is formally B0's projection)`);

writeFileSync(
  join(dir, 'pilot_gates.json'),
  `${JSON.stringify({ evaluated: new Date().toISOString(), courant, decision, gates: gates.map((g) => ({ group: g.group, ...g.gate })), cost, totalCoreHours: total }, null, 1)}\n`,
);
console.log(`\nwrote ${join(dir, 'pilot_gates.json')}`);
process.exit(decision.kind === 'retain' ? 0 : decision.kind === 'halve' ? 4 : 5);
