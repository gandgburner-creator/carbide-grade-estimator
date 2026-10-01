/**
 * Report for the fresh thermal-equilibrium validation run (criteria
 * docs/CRITERIA_THERMAL_VISCOSITY.md §4 with E6 replaced by E6′, §6).
 * Committed together with E6′, before the validation data were generated.
 * Reads one thermal record; runs nothing.
 *
 *   npx tsx scripts/report-thermal-validation.ts results/thermal_validation_s31-40.json results/plots/thermal_validation
 *
 * The classification is printed only for a record whose seeds are disjoint
 * from the seeds used to diagnose E6 and formulate E6′ (21–30): those data
 * cannot validate E6′.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mean, std, tCritical95 } from '../src/measurements/Statistics';
import { svgPlot, type Series } from './svgPlot';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAGNOSIS_SEEDS = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const [path, outDir] = process.argv.slice(2);
if (!path || !outDir) {
  console.error('usage: report-thermal-validation.ts <thermal.json> <outdir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const rec = JSON.parse(readFileSync(path, 'utf8'));
if (rec.experimentType !== 'thermal') throw new Error(`${path} is not a thermal record`);
const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a', '#0a7ea4', '#bf3989'];
const files: string[] = [];
const put = (name: string, svg: string) => {
  writeFileSync(join(outDir, name), svg);
  files.push(join(outDir, name));
};
const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toPrecision(d) : 'n/a');
const ci = (s: any) => `[${f(s.ci95[0], 5)}, ${f(s.ci95[1], 5)}]`;
if (!rec.results.relaxationVersusControl) {
  console.error(`${path} has no E6′ evaluation (made before E6′ existed); it cannot be reported as a validation.`);
  process.exit(1);
}
const overlap = rec.seeds.filter((s: number) => DIAGNOSIS_SEEDS.includes(s));
const eq = rec.results.equilibrium;

console.log(`THERMAL VALIDATION  ${rec.experimentId}`);
console.log(`  model ${rec.modelVersion}; seeds ${rec.seeds.join(', ')}; timestamp ${rec.timestamp}`);
console.log(`  configuration: N = ${rec.config.count}, φ = ${rec.config.areaFraction}, temperatures ${rec.config.temperatures.join('/')}, φ-series ${rec.config.areaFractions.join('/')}, starts ${rec.config.distributions.join('/')}`);
console.log(`  measurement ${rec.config.measurementCollisions} collisions/particle (windows ${rec.config.windowCollisions}); relaxation ${rec.config.relaxationCollisions} (windows ${rec.config.relaxationWindowCollisions}); Courant ${rec.timestep.courant}`);
if (overlap.length) console.log(`  !! seeds ${overlap.join(', ')} belong to the E6 diagnosis set: this record is NOT a validation of E6′`);

// ------------------------------------------------------- per configuration
const configSummary = eq.configurations.map((cfg: any, k: number) => {
  const a = cfg.aggregate;
  const zs = cfg.perSeed.map((s: any) => s.Z);
  const dev = zs.map((z: number) => z - a.Z.mean);
  const iMax = dev.reduce((bi: number, d: number, i: number) => (Math.abs(d) > Math.abs(dev[bi]) ? i : bi), 0);
  const windows = cfg.perSeed.reduce((x: number, s: any) => x + s.windows, 0);
  console.log(`\n  [${k + 1}] ${cfg.config}${cfg.note ? `  (${cfg.note})` : ''}`);
  console.log(`    per seed (Z, kTx/kTy, a2, kurtosis, anisotropy, dispersion; windows, collisions/particle):`);
  for (const s of cfg.perSeed) console.log(`      ${s.seed}: Z ${f(s.Z, 6)}  ${f(s.kTx / s.kTy, 5)}  ${f(s.a2, 3)}  ${f(s.kurtosis, 4)}  ${f(s.anisotropy, 3)}  ${f(s.dispersion, 3)}  (${s.windows}, ${f(s.collisionsPerParticle, 3)})`);
  console.log(`    Z = ${f(a.Z.mean, 6)}  SD ${f(a.Z.sd, 3)}  SE ${f(a.Z.se, 3)}  95% CI ${ci(a.Z)}  (±${f(100 * a.Z.relHalfWidth95, 3)} %)  between-seed CV ${f(100 * a.Z.betweenSeedCV, 3)} %`);
  console.log(`    max deviation of a seed from the mean: ${f(dev[iMax], 3)} (seed ${cfg.perSeed[iMax].seed}, ${f(dev[iMax] / a.Z.sd, 3)} SD); windows used ${windows} (${cfg.perSeed.length} seeds)`);
  console.log(`    kT ${f(a.kT.mean, 6)}, kTx/kTy ${f(a.kTxOverKTy.mean, 5)} ± ${f(a.kTxOverKTy.se, 2)}, a2 ${f(a.a2.mean, 3)} ± ${f(a.a2.se, 2)}, kurtosis ${f(a.kurtosis.mean, 4)} ± ${f(a.kurtosis.se, 2)}, anisotropy ${f(a.anisotropy.mean, 3)} ± ${f(a.anisotropy.se, 2)}, dispersion ${f(a.dispersion.mean, 4)} ± ${f(a.dispersion.se, 2)}`);
  console.log(`    external diagnostics (not judged): Henderson Z ${f(cfg.externalDiagnostics.hendersonZ, 5)}, hard-disk S(0) ${f(cfg.externalDiagnostics.hardDiskDispersionS0, 4)}`);
  console.log(`    stationarity p (late − early half, seed-paired): ${cfg.stationarity.map((s: any) => `${s.observable} ${f(s.p, 3)}`).join(', ')}`);
  console.log(`    window sensitivity (Z from the last 100/75/50/25 %): ${cfg.windowSensitivity.map((w: any) => `${f(w.Z.mean, 6)} ± ${f(w.Z.se, 2)}`).join('; ')}`);
  // convergence plot
  const conv = cfg.convergence;
  const series: Series[] = conv.perSeed.map((s: any) => ({ label: '', x: s.c, y: s.Z, color: '#8c959f', thin: true }));
  series.push({ label: 'seed mean ± 95 % CI', x: conv.ensemble.map((q: any) => q.c), y: conv.ensemble.map((q: any) => q.mean), err: conv.ensemble.map((q: any) => 0.5 * (q.ci95[1] - q.ci95[0])), color: COLORS[0] });
  const allY = series.flatMap((s) => s.y).filter(Number.isFinite);
  put(`Z_convergence_${k + 1}.svg`, svgPlot({
    title: `Validation: running mean of Z — ${cfg.config.split(' (')[0]}`,
    xLabel: 'collisions per particle in the equilibrium window', yLabel: 'cumulative mean Z',
    series, yMin: Math.min(...allY) - 0.005, yMax: Math.max(...allY) + 0.005,
  }));
  // running mean vs its own running CI around the final value
  const e = conv.ensemble;
  const fin = e[e.length - 1];
  const outside = e.slice(0, -1).filter((q: any) => Math.abs(q.mean - fin.mean) > 0.5 * (q.ci95[1] - q.ci95[0])).length;
  return { config: cfg.config, Z: a.Z, maxDeviation: { seed: cfg.perSeed[iMax].seed, value: dev[iMax], inSD: dev[iMax] / a.Z.sd }, windows, convergencePointsOutsideOwnCI: { outside, of: e.length - 1 } };
});

// ------------------------------------------------------- families of tests
const st = eq.stationarityTests;
const e2v = st.tests.filter((t: any) => !(t.p > st.alpha));
const e2min = st.tests.reduce((a: any, t: any) => (t.p < a.p ? t : a), st.tests[0]);
console.log(`\n  E2 stationarity: m = ${st.m}, per-test α = 0.05/${st.m} = ${f(st.alpha, 3)} (Bonferroni; family-wise false alarm ≤ 5 %); violations ${e2v.length}; smallest p ${f(e2min.p, 3)} (${e2min.config} / ${e2min.observable})`);
const td = rec.results.temperatureDependence;
const dd = rec.results.distributionDependence;
console.log(`  E3 temperature classes: ANOVA p = ${f(td.zConsistencyAcrossTemperatureClasses.pValue, 3)} (α = 0.05/3); P = a + b·kT intercept ${f(td.fit.intercept, 3)} ± ${f(td.fit.seIntercept, 2)}`);
console.log(`  E3 initial distributions: ANOVA p(Z) = ${f(dd.anova.Z.pValue, 3)}, p(late a2) = ${f(dd.anova.a2.pValue, 3)} (each α = 0.05/3)`);
const worstE4 = configSummary.reduce((a: any, c: any) => (c.Z.relHalfWidth95 > a.Z.relHalfWidth95 ? c : a), configSummary[0]);
console.log(`  E4 precision: worst Z half-width ${f(100 * worstE4.Z.relHalfWidth95, 3)} % (${worstE4.config}); limit 0.71 %`);
console.log(`  E5 empty space: ${rec.results.emptySpace.flaggedRuns} flagged of ${rec.results.emptySpace.runs} runs`);

// ------------------------------------------------------------------ E6′
const e6 = rec.results.relaxationVersusControl;
console.log(`\n  E6′ relaxation vs Maxwell-start control: m = ${e6.m} (${e6.starts.length} starts × ${e6.observables.length} observables × ${e6.blocks} blocks), per-test α = 0.05/${e6.m} = ${f(e6.perTestAlpha, 3)}`);
console.log(`    family-wise false-alarm bound ${e6.familyWiseFalseAlarmBound} (Bonferroni, valid under any dependence); expected false violations under H0 ≤ ${f(e6.expectedFalseViolationsUnderH0, 3)}; FAIL if any p < ${e6.failP}`);
console.log(`    windows tested ${e6.windowsTested}; violations ${e6.violations}; smallest p ${f(e6.smallestP, 3)}; max |t| ${f(e6.maxAbsT, 3)}`);
console.log(`    start          obs         block  c range        start mean   control mean  Δ ± SE                 t       dof    p          detectable |Δ|`);
for (const t of e6.tests) {
  console.log(`    ${t.distribution.padEnd(14)} ${t.observable.padEnd(10)}  ${t.block}      ${f(t.cFrom, 3).padStart(5)}–${f(t.cTo, 3).padEnd(6)}  ${f(t.meanStart, 3).padStart(10)}  ${f(t.meanControl, 3).padStart(12)}  ${(f(t.difference, 3) + ' ± ' + f(t.se, 2)).padEnd(21)}  ${f(t.t, 3).padStart(6)}  ${f(t.dof, 3).padStart(5)}  ${f(t.p, 3).padEnd(9)}  ${f(t.minimumDetectableDifference, 2)}${t.violation ? '  VIOLATION' : ''}`);
}
for (const o of e6.observables) {
  const series: Series[] = [];
  const groups = [e6.control, ...e6.starts];
  groups.forEach((d: string, i: number) => {
    const rows = e6.tests.filter((t: any) => t.observable === o && t.distribution === (d === e6.control ? e6.starts[0] : d));
    const vals = (t: any) => (d === e6.control ? t.perSeedControl : t.perSeedStart).map((q: any) => q.blockMean);
    const ys = rows.map((t: any) => mean(vals(t)));
    const err = rows.map((t: any) => {
      const v = vals(t);
      return (tCritical95(v.length - 1) * std(v)) / Math.sqrt(v.length);
    });
    series.push({ label: d === e6.control ? `${d} (control)` : d, x: rows.map((t: any) => 0.5 * (t.cFrom + t.cTo) + (i - 1.5) * 0.6), y: ys, err, color: COLORS[i % COLORS.length], markers: true });
  });
  const lo = Math.min(...series.flatMap((q) => q.y.map((y, i) => y - (q.err?.[i] ?? 0))));
  const hi = Math.max(...series.flatMap((q) => q.y.map((y, i) => y + (q.err?.[i] ?? 0))));
  put(`E6prime_${o}.svg`, svgPlot({
    title: `E6′: late-half block means of ${o}, seed mean ± 95 % CI (offset for legibility)`,
    xLabel: 'block centre, collisions per particle', yLabel: `${o} (block mean)`, series,
    yMin: lo - 0.05 * (hi - lo), yMax: hi + 0.05 * (hi - lo),
  }));
}

// ------------------------------------------------- relaxation behaviour
const curves = dd.curves as { distribution: string; seed: number; c: number[]; a2: number[]; anisotropy: number[] }[];
const starts = [...new Set(curves.map((c) => c.distribution))];
console.log('\n  Relaxation of the seed-ensemble mean (collisions/particle; reported, not judged):');
const relaxation = starts.flatMap((d) => {
  const cs = curves.filter((c) => c.distribution === d);
  const n = Math.min(...cs.map((c) => c.c.length));
  return (['a2', 'anisotropy'] as const).map((o) => {
    const ens = Array.from({ length: n }, (_, i) => mean(cs.map((c) => c[o][i])));
    const cc = Array.from({ length: n }, (_, i) => mean(cs.map((c) => c.c[i])));
    const half = Math.floor(n / 2);
    const m = mean(ens.slice(half));
    const s = std(ens.slice(half));
    const dev0 = Math.abs(ens[0] - m);
    const iE = ens.findIndex((v) => Math.abs(v - m) < dev0 / Math.E);
    const iB = ens.findIndex((v) => Math.abs(v - m) < 3 * s);
    const q = { distribution: d, observable: o, initial: ens[0], late: m, initialDeviationInSigma: dev0 / s, tOneOverE: iE >= 0 ? cc[iE] : null, tWithin3Sigma: iB >= 0 ? cc[iB] : null };
    console.log(`    ${d.padEnd(14)} ${o.padEnd(10)} initial ${f(q.initial, 3)} (${f(q.initialDeviationInSigma, 3)} σ_ens) → ${f(q.late, 2)}: 1/e at ${q.tOneOverE === null ? '—' : f(q.tOneOverE, 3)}, within 3 σ_ens at ${q.tWithin3Sigma === null ? '—' : f(q.tWithin3Sigma, 3)}`);
    return q;
  });
});
// retired E6 statistic, for information only
let lateExc = 0;
let lateWin = 0;
for (const cv of curves)
  for (const o of ['a2', 'anisotropy'] as const) {
    const x = cv[o];
    const half = Math.floor(x.length / 2);
    const late = x.slice(half);
    const m = mean(late);
    const s = std(late);
    lateWin += late.length;
    lateExc += late.filter((v) => Math.abs(v - m) > 4 * s).length;
  }
console.log(`  Retired E6 statistic (diagnostic only, not a criterion): late-half windows beyond 4σ ${lateExc} of ${lateWin}; starts E6 would have flagged: ${dd.retiredE6?.unsettledStarts?.length ? dd.retiredE6.unsettledStarts.join(', ') : 'none'}`);
for (const key of ['a2', 'anisotropy'] as const) {
  const series: Series[] = [];
  starts.forEach((d, i) => curves.filter((c) => c.distribution === d).forEach((c, j) => series.push({ label: j === 0 ? d : '', x: c.c, y: c[key], color: COLORS[i % COLORS.length], thin: j > 0 })));
  put(`relaxation_${key}.svg`, svgPlot({ title: `Validation: ${key} relaxation from four initial distributions (one line per seed)`, xLabel: 'collisions per particle', yLabel: key, series }));
}

// -------------------------------------------------------- classification
const checks = rec.acceptance.map((c: any) => ({ id: c.id, status: c.status, criterion: c.criterion, measured: c.measured }));
const classification = overlap.length
  ? 'NOT A VALIDATION (seeds overlap the E6 diagnosis set)'
  : checks.some((c: any) => c.status === 'FAILED')
    ? 'FAIL'
    : checks.every((c: any) => c.status === 'PASSED')
      ? 'PASS'
      : 'INCONCLUSIVE';
console.log('\nCLASSIFICATION (docs/CRITERIA_THERMAL_VISCOSITY.md §4 with E6′ from §6)');
for (const c of checks) console.log(`  [${c.status}] ${c.id}: ${c.measured}`);
console.log(`  thermal equilibrium: ${classification}`);
writeFileSync(
  join(outDir, 'report_thermal_validation.json'),
  JSON.stringify({ record: path, experimentId: rec.experimentId, seeds: rec.seeds, classification, checks, configurations: configSummary, e2: { m: st.m, alpha: st.alpha, violations: e2v.length, smallestP: e2min.p }, e6prime: { ...e6, tests: undefined }, relaxation, retiredE6: { lateWindowsBeyond4Sigma: lateExc, lateWindows: lateWin }, plots: files }, null, 1),
);
console.log(`\nplots: ${files.join(', ')}`);
