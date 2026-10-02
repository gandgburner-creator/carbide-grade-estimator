/**
 * POST-HOC analysis for Item 3 (boundary layer + separation discovery).
 *
 * Written AFTER the validation data of docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md
 * were seen. Nothing here enters the registered classification
 * (scripts/report-bl-separation.ts). It only describes the measured flow
 * further, with the same raw records and the same estimators:
 *
 *  A. the components of the registered bin-width check I6 (which ones are
 *     undecided);
 *  B. the wall-shear signal as a stand-alone reversal indicator (indicator D
 *     applied to every column, not only inside a u_wall-defined region);
 *  C. the 95 % bound on any mean reverse near-wall velocity in the response
 *     window — what size of recirculation the data exclude;
 *  D. the near-wall velocity in a thinner band (y < 2);
 *  E. the stream function near the wall in the stalled band;
 *  F. the time evolution of the stalled band (block ensembles);
 *  G. order parameters against expansion ratio, both accommodations.
 *
 *   npx tsx scripts/posthoc-bl-separation.ts <record.json> [record.json …]
 */
import { readFileSync } from 'node:fs';
import { agreement, columnsIn, nearestColumn, type BLSCriteria } from '../src/experiments/BLSeparationReport';
import type { BLSParams } from '../src/experiments/BoundaryLayerSeparationExperiment';
import { coarsen, dividingHeight, regionStats, runsOf, seedStat, streamFunction, summarizeCase, tOneSided, type CaseSummary } from '../src/experiments/WallFlowAnalysis';
import type { WallFlowRunResult } from '../src/experiments/WallFlowRun';
import { tTwoSidedCritical } from '../src/measurements/Statistics';

type Rec = { experimentType: string; config: BLSParams & { criteria: BLSCriteria }; results: { runs: WallFlowRunResult[] } };
const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: posthoc-bl-separation.ts <record.json> [record.json …]');
  process.exit(1);
}
const recs: Rec[] = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
const params = recs[0].config;
const C = params.criteria;
const runs = recs.flatMap((r) => r.results.runs);
const byCase: Record<string, WallFlowRunResult[]> = {};
for (const r of runs) (byCase[r.label] ??= []).push(r);
const keys = params.cases.map((c) => c.key).filter((k) => byCase[k]);
const S: Record<string, CaseSummary> = {};
for (const k of keys) S[k] = summarizeCase(k, byCase[k], C.observable);
const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toPrecision(n) : 'n/a');
const ci95 = (s: { mean: number; se: number; n: number }) => {
  const h = tTwoSidedCritical(0.05, Math.max(1, s.n - 1)) * s.se;
  return [s.mean - h, s.mean + h] as const;
};
const caseOf = (k: string) => params.cases.find((c) => c.key === k)!;
const rOf = (k: string) => caseOf(k).overrides.expansion ?? params.base.expansion;
const awOf = (k: string) => caseOf(k).overrides.accommodation ?? params.base.accommodation;

console.log('ITEM 3 — POST-HOC ANALYSIS (not part of the registered classification)');
console.log(`  ${runs.length} runs; cases ${keys.join(', ')}`);

// A. components of the registered bin-width check
if (S[C.keys.attached]) {
  const A1 = S[C.keys.attached];
  const sAlt = summarizeCase(C.keys.attached, byCase[C.keys.attached], { ...C.observable, cellX: 2 * C.observable.cellX, cellY: 2 * C.observable.cellY });
  const sFine = summarizeCase(C.keys.attached, byCase[C.keys.attached], { ...C.observable, cellY: C.observable.cellY / 2 });
  console.log('\nA. I6 components (registered check, shown in full): relative difference and 95 % CI, margin ±' + C.tolerance);
  for (const x of C.stations) {
    const i = nearestColumn(A1, x);
    const j = nearestColumn(sAlt, x);
    const q = nearestColumn(sFine, x);
    const parts = [
      ['y½ (40,4)', agreement(A1.stat.yHalf[i], sAlt.stat.yHalf[j], C.tolerance)],
      ['y½ (20,1)', agreement(A1.stat.yHalf[i], sFine.stat.yHalf[q], C.tolerance)],
      ['u_wall (40,4)', agreement(A1.stat.uWall[i], sAlt.stat.uWall[j], C.tolerance)],
    ] as const;
    console.log(`  x ${A1.x[i]} (coarse column centre ${sAlt.x[j]}): ` + parts.map(([n, a]) => `${n} rel ${f(a.rel, 2)} CI [${f(a.ci[0], 2)}, ${f(a.ci[1], 2)}] ${a.verdict}`).join('; '));
  }
}

// B. wall shear as a stand-alone reversal indicator
console.log('\nB. Wall-shear reversal (floor tangential impulse; every column of the search window)');
console.log(`   columns with τ_w < 0 at one-sided p ≤ 0.005 (**) or ≤ 0.025 (*); runs of ≥ 2 contiguous columns at p ≤ 0.025`);
for (const k of keys) {
  const s = S[k];
  const cols = columnsIn(s, C.searchWindow);
  const mark = cols.map((i) => {
    const t = s.stat.tauW[i];
    return t.mean < 0 && t.t <= -tOneSided(0.005, t.n - 1) ? '**' : t.mean < 0 && t.t <= -tOneSided(0.025, t.n - 1) ? '*' : '';
  });
  const flagged = cols.filter((_, m) => mark[m] !== '');
  const runsNeg = runsOf(cols.map((_, m) => mark[m] !== '')).filter((r) => r.to - r.from >= 1);
  const desc = runsNeg.map((r) => {
    const cs = cols.slice(r.from, r.to + 1);
    const tw = seedStat(s.perSeed.tauW.map((row) => cs.reduce((a, i) => a + row[i], 0) / cs.length));
    const neg = s.perSeed.tauW.filter((row) => cs.reduce((a, i) => a + row[i], 0) < 0).length;
    return `[${s.x[cs[0]] - 10}, ${s.x[cs[cs.length - 1]] + 10}] τ_w ${f(tw.mean)} ± ${f(tw.se, 2)} (t ${f(tw.t)}; ${neg}/${tw.n} seeds negative)`;
  });
  console.log(`  ${k.padEnd(12)} flagged ${flagged.map((i) => `${s.x[i]}${mark[cols.indexOf(i)]}`).join(' ') || 'none'}${desc.length ? '; runs ' + desc.join('; ') : ''}`);
}

// C. bound on mean reverse velocity in the response window, and in the τ_w-negative band
console.log('\nC. Region means with 95 % CIs (response window ' + C.responseWindow.join('–') + ', and band 300–440)');
for (const k of keys) {
  const s = S[k];
  for (const w of [C.responseWindow, [300, 440] as [number, number]]) {
    const cols = columnsIn(s, w);
    const rs = regionStats(s, cols);
    const [ulo, uhi] = ci95(rs.uWall);
    const [tlo, thi] = ci95(rs.tauW);
    console.log(`  ${k.padEnd(12)} (${w.join(', ')}): u_wall ${f(rs.uWall.mean)} CI [${f(ulo)}, ${f(uhi)}]; τ_w ${f(rs.tauW.mean)} CI [${f(tlo)}, ${f(thi)}]; ψ_wall ${f(rs.psiWall.mean)} ± ${f(rs.psiWall.se, 2)}; negative blocks ${f(rs.blockNegative, 2)}; seeds negative ${rs.seedsNegative}/${rs.uWall.n}`);
  }
}

// D. thinner band
console.log('\nD. Near-wall velocity in a thinner band, y < 2 (columns 300–440)');
for (const k of keys) {
  const s2 = summarizeCase(k, byCase[k], { ...C.observable, nearWallBand: 2 });
  const cols = columnsIn(s2, [300, 440]);
  const row = cols.map((i) => `${s2.x[i]}: ${f(s2.stat.uWall[i].mean, 2)}±${f(s2.stat.uWall[i].se, 1)}${s2.stat.uWall[i].mean < 0 && s2.stat.uWall[i].t <= -tOneSided(0.005, s2.stat.uWall[i].n - 1) ? '*' : ''}`);
  const rs = regionStats(s2, cols);
  console.log(`  ${k.padEnd(12)} ${row.join('  ')}  | band mean ${f(rs.uWall.mean)} ± ${f(rs.uWall.se, 2)} (t ${f(rs.uWall.t)})`);
}

// E. stream function near the wall
console.log('\nE. Stream function ψ(y) (seed-summed) in the band 300–440: minimum ψ below y = 20 and the dividing height');
for (const k of keys) {
  const s = S[k];
  const sf = streamFunction(s.nearWall);
  const cols = sf.x.map((x, i) => [x, i] as const).filter(([x]) => x > 300 && x < 440);
  const row = cols.map(([x, i]) => {
    const col = sf.psi[i];
    const below = col.filter((_, r) => sf.yTop[r] <= 20);
    const mn = Math.min(...below);
    const dh = dividingHeight(col, sf.yTop);
    return `${x}: min ${f(mn, 2)} div ${Number.isFinite(dh) && dh > 0 ? f(dh, 2) : '—'}`;
  });
  console.log(`  ${k.padEnd(12)} ${row.join('  ')}`);
}
console.log('   per-seed ψ at y = 10 and y = 20, mean over the band columns (seed ensemble; < 0 = net upstream mass flux below that height)');
for (const k of keys) {
  const at = (yTop: number) =>
    seedStat(
      byCase[k].map((r) => {
        const sf = streamFunction(coarsen(r.nearWall, Math.round(C.observable.cellX / r.nearWall.cellW), 1));
        const row = sf.yTop.findIndex((y) => Math.abs(y - yTop) < 1e-9);
        const cols = sf.x.map((x, i) => [x, i] as const).filter(([x]) => x > 300 && x < 440);
        return cols.reduce((a, [, i]) => a + sf.psi[i][row], 0) / cols.length;
      }),
    );
  const p10 = at(10);
  const p20 = at(20);
  console.log(`  ${k.padEnd(12)} ψ(10) ${f(p10.mean)} ± ${f(p10.se, 2)} (t ${f(p10.t)}); ψ(20) ${f(p20.mean)} ± ${f(p20.se, 2)} (t ${f(p20.t)})`);
}

// F. time evolution of the band
console.log('\nF. Block ensembles of the band 300–440 near-wall velocity (10 blocks of 120 time units)');
for (const k of keys) {
  const s = S[k];
  const cols = columnsIn(s, [300, 440]);
  const K = s.blockU[0].length;
  const row = Array.from({ length: K }, (_, b) => seedStat(s.blockU.map((seed) => cols.reduce((a, i) => a + seed[b][i], 0) / cols.length)));
  console.log(`  ${k.padEnd(12)} ${row.map((r) => `${f(r.mean, 2)}±${f(r.se, 1)}`).join(' ')}`);
}

// G. order parameters vs expansion
console.log('\nG. Order parameters against expansion ratio r (response window ' + C.responseWindow.join('–') + ')');
console.log('  Aw   r     u_wall (t)              τ_w (t)                 min column u_wall   Δp_w');
for (const k of keys.filter((q) => caseOf(q).role !== 'variant' && caseOf(q).overrides.rib === undefined).sort((a, b) => awOf(a) - awOf(b) || rOf(a) - rOf(b))) {
  const s = S[k];
  const cols = columnsIn(s, C.responseWindow);
  const rs = regionStats(s, cols);
  const minCol = Math.min(...columnsIn(s, C.searchWindow).map((i) => s.stat.uWall[i].mean));
  const up = columnsIn(s, C.pressureUpstream);
  const dn = columnsIn(s, C.pressureDownstream);
  const dp = seedStat(s.perSeed.pW.map((row) => dn.reduce((a, i) => a + row[i], 0) / dn.length - up.reduce((a, i) => a + row[i], 0) / up.length));
  console.log(`  ${String(awOf(k)).padEnd(4)} ${String(rOf(k)).padEnd(5)} ${f(rs.uWall.mean)} ± ${f(rs.uWall.se, 2)} (${f(rs.uWall.t)})`.padEnd(42) + `${f(rs.tauW.mean)} ± ${f(rs.tauW.se, 2)} (${f(rs.tauW.t)})`.padEnd(24) + `${f(minCol)}`.padEnd(20) + `${f(dp.mean)} ± ${f(dp.se, 2)}`);
}

// H. positive control (rib) columns and the column-test power
const pcKey = C.keys.positiveControl;
if (S[pcKey]) {
  const s = S[pcKey];
  const n = s.seeds.length;
  console.log(`\nH. Positive control ${pcKey}: columns behind the rib (n = ${n}; the registered column test needs t ≤ −${f(tOneSided(C.alphaColumn, n - 1))} at one-sided p ≤ ${C.alphaColumn})`);
  for (const i of columnsIn(s, [180, 330])) {
    const u = s.stat.uWall[i];
    const t = s.stat.tauW[i];
    if (!Number.isFinite(u.mean)) {
      console.log(`  x ${s.x[i]}: (column covered by the rib below y = ${C.observable.nearWallBand})`);
      continue;
    }
    const neg = s.perSeed.uWall.filter((row) => row[i] < 0).length;
    console.log(`  x ${s.x[i]}: u_wall ${f(u.mean)} ± ${f(u.se, 2)} (t ${f(u.t)}; ${neg}/${n} seeds negative; negative blocks ${f(s.blockNegative[i], 2)}); τ_w ${f(t.mean)} ± ${f(t.se, 2)} (t ${f(t.t)})`);
  }
}
console.log('\n   column-test detection limit (smallest mean reverse u_wall the registered column test can flag, = t_crit × typical column SE):');
for (const k of keys) {
  const s = S[k];
  const cols = columnsIn(s, C.searchWindow).filter((i) => Number.isFinite(s.stat.uWall[i].se));
  const se = cols.map((i) => s.stat.uWall[i].se).sort((a, b) => a - b)[Math.floor(cols.length / 2)];
  const n = s.seeds.length;
  console.log(`  ${k.padEnd(12)} n ${n}, t_crit ${f(tOneSided(C.alphaColumn, n - 1))}, median column SE ${f(se, 2)} → detection limit ≈ ${f(tOneSided(C.alphaColumn, n - 1) * se, 2)}`);
}
