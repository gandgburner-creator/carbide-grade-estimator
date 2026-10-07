/**
 * B0 — the empirical cost benchmark (design §12.4; amendment A1 §4.3).
 *
 *   npx tsx scripts/ub0-b0.ts [--frozen results/ub0/frozen_inputs.json] [--out results/ub0/b0]
 *                             [--repeats 3] [--warmup 500] [--steps 2000]
 *
 * Static periodic boxes at φ = 0.2, N_c ∈ {1, 4, 16, 64} × c_h ∈ {2, 4}, wherever
 * L ≥ 3h, at N ≈ 1630 (L = 80 D) and N ≈ 6520 (L = 160 D). Design seeds 9901+,
 * never judged. Each repeat starts from the same seed: 500 warm-up steps, then
 * 2000 timed steps; the median of the repeats is reported.
 *
 * Blind-safe: NO physics observable is computed. Recorded: wall-clock per phase
 * and the parcel count. The mean timestep is recorded at N_c = 1 only: at N_c > 1
 * it would carry the speed tail, i.e. T_kin (PQ4). Universe B projections use the
 * Universe A timestep in parcel units (the design's dt ∝ D/σ_v); the stability
 * pilots then measure the actual wall time. The engine is not modified; the phases are timed by
 *   - a wrapper around the occupancy force (occupancy total),
 *   - separate builds of identically sized grids on the same store (grid costs),
 *   - the step total (the rest = drift, kicks, collision search and resolve, safety).
 *
 * B0 re-budgets run lengths only; it never changes a configuration, seed or
 * threshold (design §12.4). The 64-postponement rule is evaluated and printed.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Domain } from '../src/core/Domain';
import type { ParticleStore } from '../src/core/ParticleStore';
import { Simulation, type ForceModel } from '../src/core/Simulation';
import { SpatialGrid } from '../src/core/SpatialGrid';
import { henderson, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { ub0Groups, type FrozenInputs } from '../src/universeB/UB0Plans';
import { initialStore, mapOf, simConfigOf, type UB0Spec } from '../src/universeB/UB0Run';
import { UBOccupancyForce } from '../src/universeB/UBOccupancyForce';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const frozenFile = arg('--frozen', 'results/ub0/frozen_inputs.json');
const out = arg('--out', 'results/ub0/b0');
const repeats = Number(arg('--repeats', '3'));
const warmup = Number(arg('--warmup', '500'));
const steps = Number(arg('--steps', '2000'));
const B0_SEED_START = 9901;

const frozen: FrozenInputs | null = existsSync(frozenFile) ? (JSON.parse(readFileSync(frozenFile, 'utf8')) as FrozenInputs) : null;
const KTred = frozen?.KTred ?? henderson.KTred(UB0_PHI);

class TimedForce implements ForceModel {
  readonly name: string;
  readonly version: string;
  ms = 0;
  constructor(private readonly inner: UBOccupancyForce) {
    this.name = inner.name;
    this.version = inner.version;
  }
  computeForces(store: ParticleStore, domain: Domain): number {
    const t = performance.now();
    const U = this.inner.computeForces(store, domain);
    this.ms += performance.now() - t;
    return U;
  }
}

interface Case {
  Nc: number;
  ch: number;
  L: number;
  seed: number;
}

const cases: Case[] = [];
let seed = B0_SEED_START;
for (const Nc of [1, 4, 16, 64]) {
  for (const ch of Nc === 1 ? [0] : [2, 4]) {
    for (const L of [80, 160]) {
      const hD = ch * Math.sqrt(Nc); // h in D
      if (Nc > 1 && L < 3 * hD) continue;
      cases.push({ Nc, ch, L, seed: seed++ });
    }
  }
}

interface Rep {
  stepUs: number;
  occUs: number;
  occGridUs: number;
  collGridUs: number;
  /** N_c = 1 only (NaN otherwise) */
  meanDtP: number;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function bench(c: Case): { N: number; reps: Rep[] } {
  const spec: UB0Spec = {
    id: `b0-${c.Nc}-${c.ch}-${c.L}`,
    kind: 'static',
    Nc: c.Nc,
    ch: c.ch,
    e: c.Nc === 1 ? 1 : 0.9,
    KTred,
    phi: UB0_PHI,
    courant: 0.025,
    seed: c.seed,
    L: c.L,
    prep: 0,
    settle: 0,
    measure: 0,
    sample: 1,
    observables: false,
  };
  const m = mapOf(spec);
  const reps: Rep[] = [];
  let N = 0;
  for (let r = 0; r < repeats; r++) {
    const store = initialStore(spec, m);
    N = store.count;
    const occ = c.Nc > 1 ? new TimedForce(new UBOccupancyForce({ ks: m.ks, h: m.h })) : null;
    const sim = new Simulation(simConfigOf(spec, m, 'prep'), store, occ ? [occ] : []);
    for (let k = 0; k < warmup && sim.step(); k++);
    const cell = (sim as unknown as { gridCellSize: number }).gridCellSize;
    const collGrid = new SpatialGrid(sim.domain, cell, store.capacity);
    const occGrid = c.Nc > 1 ? new SpatialGrid(sim.domain, m.h, store.capacity) : null;
    if (occ) occ.ms = 0;
    const t0Sim = sim.time;
    const t0 = performance.now();
    let taken = 0;
    for (; taken < steps && sim.step(); taken++);
    const stepMs = performance.now() - t0;
    if (sim.halted) throw new Error(`${spec.id}: halted during B0`);
    // grid builds on the final configuration, 200 repetitions each
    const reb = 200;
    let t = performance.now();
    for (let k = 0; k < reb; k++) collGrid.build(store);
    const collGridMs = (performance.now() - t) / reb;
    let occGridMs = 0;
    if (occGrid) {
      t = performance.now();
      for (let k = 0; k < reb; k++) occGrid.build(store);
      occGridMs = (performance.now() - t) / reb;
    }
    const perPS = (ms: number) => (1000 * ms) / (N * taken);
    reps.push({
      stepUs: perPS(stepMs),
      occUs: occ ? perPS(occ.ms) : 0,
      occGridUs: (1000 * occGridMs) / N,
      collGridUs: (1000 * collGridMs) / N,
      meanDtP: c.Nc === 1 ? (sim.time - t0Sim) / taken : NaN, // in D/σ_v (= molecular at N_c = 1)
    });
  }
  return { N, reps };
}

let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  if (execSync('git status --porcelain -- src scripts', { encoding: 'utf8' }).trim()) commit += ' (+uncommitted changes in src/ or scripts/)';
} catch {
  /* not a git checkout */
}
const machine = { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, node: process.version, loadavgAtStart: loadavg() };
console.log(`B0 on ${machine.cpu} × ${machine.cores}, Node ${machine.node}, load ${machine.loadavgAtStart.map((x) => x.toFixed(2)).join(' ')}; commit ${commit}`);
console.log(`KTred = ${KTred} (${frozen ? 'frozen Stage 0 value' : 'Henderson; no frozen inputs'}); ${repeats} repeats × (${warmup} warm-up + ${steps} timed steps)\n`);

interface Row {
  Nc: number;
  ch: number;
  L: number;
  N: number;
  seed: number;
  stepUs: number;
  occUs: number;
  occGridUs: number;
  occPairUs: number;
  collGridUs: number;
  restUs: number;
  meanDtP: number;
  repeatsStepUs: number[];
}
const rows: Row[] = [];
console.log('  N_c  c_h    L      N   step µs  occ grid  occ pairs  coll grid    rest   dt (D/σ_v)');
for (const c of cases) {
  const { N, reps } = bench(c);
  const md = (f: (r: Rep) => number) => median(reps.map(f));
  const stepUs = md((r) => r.stepUs);
  const occUs = md((r) => r.occUs);
  const occGridUs = md((r) => r.occGridUs);
  const collGridUs = md((r) => r.collGridUs);
  const row: Row = {
    ...c,
    N,
    stepUs,
    occUs,
    occGridUs,
    occPairUs: Math.max(0, occUs - occGridUs),
    collGridUs,
    restUs: Math.max(0, stepUs - occUs - collGridUs),
    meanDtP: c.Nc === 1 ? md((r) => r.meanDtP) : NaN,
    repeatsStepUs: reps.map((r) => r.stepUs),
  };
  rows.push(row);
  console.log(
    `${String(c.Nc).padStart(5)} ${String(c.ch).padStart(4)} ${String(c.L).padStart(4)} ${String(N).padStart(6)} ${stepUs.toFixed(3).padStart(9)} ${occGridUs.toFixed(3).padStart(9)} ${row.occPairUs.toFixed(3).padStart(10)} ${collGridUs.toFixed(3).padStart(10)} ${row.restUs.toFixed(3).padStart(7)} ${(c.Nc === 1 ? row.meanDtP.toFixed(5) : '—').padStart(11)}`,
  );
}

// fit cost = a + b · c_h² N_c over N_c > 1 (µs per parcel-step), per box size and pooled
function fit(rs: Row[]): { a: number; b: number } {
  const x = rs.map((r) => r.ch * r.ch * r.Nc);
  const y = rs.map((r) => r.stepUs);
  const mx = x.reduce((s, v) => s + v, 0) / x.length;
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) * (x[i] - mx);
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}
const fitAll = fit(rows.filter((r) => r.Nc > 1));
console.log(`\nfit (N_c > 1, both N): µs per parcel-step = ${fitAll.a.toFixed(3)} + ${(1000 * fitAll.b).toFixed(2)} ns · c_h² N_c`);

// effective gain G = N_c² · c_A/c_B (design §12.3: parcels per area ∝ 1/N_c, steps per time ∝ 1/N_c)
const design: Record<string, number> = { '4/2': 0.45, '4/4': 1.2, '16/2': 1.2, '16/4': 4.2, '64/2': 4.3 };
console.log('\n  N_c  c_h    L   c_B/c_A   G(N_c)   design µs (×3?)');
const gains: { Nc: number; ch: number; L: number; G: number; ratio: number; designUs?: number; withinX3?: boolean }[] = [];
for (const r of rows.filter((x) => x.Nc > 1)) {
  const A = rows.find((x) => x.Nc === 1 && x.L === r.L)!;
  const G = r.Nc * r.Nc * (A.stepUs / r.stepUs);
  const dUs = design[`${r.Nc}/${r.ch}`];
  const within = dUs ? r.stepUs / dUs <= 3 && dUs / r.stepUs <= 3 : undefined;
  gains.push({ Nc: r.Nc, ch: r.ch, L: r.L, G, ratio: r.stepUs / A.stepUs, designUs: dUs, withinX3: within });
  console.log(
    `${String(r.Nc).padStart(5)} ${String(r.ch).padStart(4)} ${String(r.L).padStart(4)} ${(r.stepUs / A.stepUs).toFixed(2).padStart(9)} ${G.toFixed(1).padStart(8)}   ${dUs ? `${dUs} (${within ? 'within ×3' : 'OUTSIDE ×3'})` : '—'}`,
  );
}

// Projection of the judged plan (ESTIMATE; the stability pilots measure the actual per-run wall time)
const projection: { group: string; n: number; coreHoursPerSeed: number; coreHours: number }[] = [];
let total = 0;
if (frozen) {
  for (const g of ub0Groups(frozen)) {
    const b = g.base;
    const box = b.kind === 'wall' || b.kind === 'couette' ? b.width! * b.height! : b.L! * b.L!;
    const N = (b.phi / (Math.PI / 4)) * box;
    // nearest benchmark row for (N_c, c_h): per-step cost interpolated in N between the two box sizes
    const rs = rows.filter((r) => r.Nc === b.Nc && r.ch === b.ch).sort((x, y) => x.N - y.N);
    let us = rs[rs.length - 1].stepUs;
    if (rs.length === 2) {
      const [r1, r2] = rs;
      const w = Math.min(1, Math.max(0, (N - r1.N) / (r2.N - r1.N)));
      us = r1.stepUs + w * (r2.stepUs - r1.stepUs);
    }
    const A = rows.find((r) => r.Nc === 1 && r.L === 160)!;
    const dtStatic = A.meanDtP * (b.courant / 0.025); // Universe A timestep in parcel units
    // waves add U to the speed tail: dt ≈ courant·D/(v_max + U), v_max from the static dt
    const vmax = b.courant / dtStatic; // in σ_v
    const U = b.kind === 'shear' || b.kind === 'sound' ? (b.amplitude ?? 0) : b.kind === 'couette' ? 0.5 * (b.wallSpeed ?? 0) : 0;
    const dt = b.courant / (vmax + U);
    const stepsTotal = (b.prep + b.settle + b.measure) / dt;
    const perSeed = (N * stepsTotal * us) / 3.6e9;
    projection.push({ group: g.group, n: g.n, coreHoursPerSeed: perSeed, coreHours: perSeed * g.n });
    total += perSeed * g.n;
  }
  console.log('\nprojected judged-plan cost (ESTIMATE, idle single core; planned seeds only):');
  for (const p of projection) console.log(`  ${p.group.padEnd(12)} ${String(p.n).padStart(3)} × ${p.coreHoursPerSeed.toFixed(3)} = ${p.coreHours.toFixed(2)} core-h`);
  console.log(`  total ≈ ${total.toFixed(1)} core-h ≈ ${(total / 4).toFixed(1)} h on 4 cores (before contention)`);
  const t64 = projection.find((p) => p.group === 'T64a1');
  if (t64) {
    const postponed = t64.coreHoursPerSeed > 4;
    console.log(
      `  64-postponement rule (design §12.4): T64a1 ≈ ${t64.coreHoursPerSeed.toFixed(2)} core-h per seed → ${postponed ? 'ABOVE 4: the N_c = 64 T runs are POSTPONED, not shrunk' : 'not triggered'}`,
    );
  }
}

mkdirSync(out, { recursive: true });
const record = {
  machine,
  commit,
  KTred,
  KTredSource: frozen ? frozenFile : 'henderson',
  repeats,
  warmup,
  steps,
  finished: new Date().toISOString(),
  loadavgAtEnd: loadavg(),
  rows,
  fit: fitAll,
  gains,
  projection,
  projectedCoreHours: total,
};
writeFileSync(join(out, 'b0.json'), `${JSON.stringify(record, null, 1)}\n`);
console.log(`\nwrote ${join(out, 'b0.json')}`);
