/**
 * Report for the thermal-equilibrium and viscosity reruns (Phase 0 item 1):
 * plots, per-seed tables and the PASS / INCONCLUSIVE / FAIL classification
 * under docs/CRITERIA_THERMAL_VISCOSITY.md. Reads records only; runs nothing.
 *
 *   npx tsx scripts/report-thermal-viscosity.ts \
 *     results/thermal_reference.json results/viscosity_reference.json \
 *     results/viscosity_courant-0.05.json results/plots
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { svgPlot, type Series } from './svgPlot';

/* eslint-disable @typescript-eslint/no-explicit-any */
const [thermalPath, viscPath, viscDtPath, outDir] = process.argv.slice(2);
if (!thermalPath || !viscPath || !viscDtPath || !outDir) {
  console.error('usage: report-thermal-viscosity.ts <thermal.json> <viscosity.json> <viscosity_courant-0.05.json> <outdir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const thermal = JSON.parse(readFileSync(thermalPath, 'utf8'));
const visc = JSON.parse(readFileSync(viscPath, 'utf8'));
const viscDt = JSON.parse(readFileSync(viscDtPath, 'utf8'));
const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a', '#0a7ea4', '#bf3989'];
const files: string[] = [];
const put = (name: string, svg: string) => {
  writeFileSync(join(outDir, name), svg);
  files.push(join(outDir, name));
};
const f = (v: number, d = 4) => (Number.isFinite(v) ? v.toPrecision(d) : 'n/a');
const ci = (s: any) => `[${f(s.ci95[0], 5)}, ${f(s.ci95[1], 5)}]`;

// ------------------------------------------------------------------ thermal
const eq = thermal.results.equilibrium;
console.log(`THERMAL  (${thermal.experimentId}, model ${thermal.modelVersion}, seeds ${thermal.seeds.join(',')})`);
eq.configurations.forEach((cfg: any, k: number) => {
  const a = cfg.aggregate;
  console.log(`\n  ${cfg.config}${cfg.note ? `  [${cfg.note}]` : ''}`);
  console.log(`    per seed: ${cfg.perSeed.map((s: any) => `${s.seed}: Z ${f(s.Z, 6)}, kTx/kTy ${f(s.kTx / s.kTy, 5)}, a2 ${f(s.a2, 3)}, kurt ${f(s.kurtosis, 4)}, disp ${f(s.dispersion, 3)} (${s.windows} windows, ${f(s.collisionsPerParticle, 3)} coll/particle)`).join('\n              ')}`);
  console.log(`    Z = ${f(a.Z.mean, 6)}  var ${f(a.Z.variance, 3)}  SD ${f(a.Z.sd, 3)}  SE ${f(a.Z.se, 3)}  95% CI ${ci(a.Z)}  (±${f(100 * a.Z.relHalfWidth95, 3)} %)  between-seed CV ${f(100 * a.Z.betweenSeedCV, 3)} %   | Henderson ${f(cfg.externalDiagnostics.hendersonZ, 5)}`);
  console.log(`    kT = ${f(a.kT.mean, 6)}, kTx/kTy = ${f(a.kTxOverKTy.mean, 5)} ± ${f(a.kTxOverKTy.se, 2)}, a2 = ${f(a.a2.mean, 3)} ± ${f(a.a2.se, 2)}, kurtosis = ${f(a.kurtosis.mean, 4)} ± ${f(a.kurtosis.se, 2)}, anisotropy = ${f(a.anisotropy.mean, 3)} ± ${f(a.anisotropy.se, 2)}, dispersion = ${f(a.dispersion.mean, 4)} ± ${f(a.dispersion.se, 2)} (hard-disk S(0) ${f(cfg.externalDiagnostics.hardDiskDispersionS0, 4)})`);
  console.log(`    stationarity (late − early half, seed-paired): ${cfg.stationarity.map((s: any) => `${s.observable} ${f(s.mean, 3)} ± ${f(s.se, 2)} p ${f(s.p, 3)}`).join('; ')}`);
  console.log(`    window sensitivity (Z from the last x of the measurement): ${cfg.windowSensitivity.map((w: any) => `${w.lastFraction}: ${f(w.Z.mean, 6)} ± ${f(w.Z.se, 2)}`).join('; ')}`);
  // convergence plot
  const conv = cfg.convergence;
  const series: Series[] = conv.perSeed.map((s: any) => ({ label: '', x: s.c, y: s.Z, color: '#8c959f', thin: true }));
  series.push({
    label: 'seed mean ± 95 % CI',
    x: conv.ensemble.map((q: any) => q.c),
    y: conv.ensemble.map((q: any) => q.mean),
    err: conv.ensemble.map((q: any) => 0.5 * (q.ci95[1] - q.ci95[0])),
    color: COLORS[0],
  });
  const hZ = cfg.externalDiagnostics.hendersonZ;
  const xs = conv.ensemble.map((q: any) => q.c);
  series.push({ label: `Henderson EOS ${f(hZ, 5)} (diagnostic)`, x: [xs[0], xs[xs.length - 1]], y: [hZ, hZ], color: COLORS[1], dashed: true });
  const allY = series.flatMap((s) => s.y).filter(Number.isFinite);
  put(`thermal_Z_convergence_${k + 1}.svg`, svgPlot({
    title: `Thermal: running mean of Z = P/(nkT) — ${cfg.config}`,
    xLabel: 'collisions per particle in the equilibrium window', yLabel: 'cumulative mean Z',
    series, yMin: Math.min(...allY) - 0.005, yMax: Math.max(...allY) + 0.005,
  }));
});
// relaxation curves from non-equilibrium starts
const curves = thermal.results.distributionDependence?.curves ?? [];
const dists = [...new Set(curves.map((c: any) => c.distribution))] as string[];
for (const key of ['a2', 'anisotropy'] as const) {
  const series: Series[] = [];
  dists.forEach((d, i) => {
    const cs = curves.filter((c: any) => c.distribution === d);
    cs.forEach((c: any, j: number) => series.push({ label: j === 0 ? d : '', x: c.c, y: c[key], color: COLORS[i % COLORS.length], thin: j > 0 }));
  });
  put(`thermal_relaxation_${key}.svg`, svgPlot({
    title: `Thermal: ${key} relaxation from four initial distributions (one line per seed)`,
    xLabel: 'collisions per particle', yLabel: key, series,
  }));
}
// window sensitivity (normalised to the full-window mean)
{
  const series: Series[] = eq.configurations.map((cfg: any, i: number) => {
    const full = cfg.windowSensitivity[0].Z.mean;
    return {
      label: cfg.config.split(' (')[0].slice(0, 32),
      x: cfg.windowSensitivity.map((w: any) => w.lastFraction),
      y: cfg.windowSensitivity.map((w: any) => w.Z.mean / full - 1),
      err: cfg.windowSensitivity.map((w: any) => (w.Z.ci95[1] - w.Z.ci95[0]) / 2 / full),
      color: COLORS[i % COLORS.length],
      markers: true,
    };
  });
  put('thermal_window_sensitivity.svg', svgPlot({
    title: 'Thermal: Z from the last fraction of the window, relative to the full window (95 % CI)',
    xLabel: 'fraction of the equilibrium window used (from the end)', yLabel: 'Z / Z(full) − 1', series,
  }));
}

// ---------------------------------------------------------------- viscosity
const vc = visc.results.cases[0];
const vcDt = viscDt.results.cases[0];
console.log(`\nVISCOSITY  (${visc.experimentId}, model ${visc.modelVersion}, ${vc.seeds} seeds ${visc.seeds[0]}–${visc.seeds[visc.seeds.length - 1]})`);
console.log(`  per seed: ${vc.perSeed.map((a: any) => `${a.seed}: μ ${f(a.muEff.mean, 4)} ± ${f(a.muEff.se, 2)} (τ ${f(a.shearStress.mean, 3)}, γ ${f(a.gradient.mean, 3)}, fit p ${f(a.linearityP, 2)})`).join('\n            ')}`);
const ms = vc.muEffSummary;
console.log(`  μ_eff = ${f(ms.mean)}  var ${f(ms.variance, 3)}  SD ${f(ms.sd, 3)}  SE ${f(ms.se, 3)}  95% CI ${ci(ms)} (±${f(100 * ms.relHalfWidth95, 3)} %)  between-seed CV ${f(100 * ms.betweenSeedCV, 3)} %`);
console.log(`  pooled (per-run SEs): ${f(vc.muEffPooled.mean)} ± ${f(vc.muEffPooled.se, 3)}, seed χ² p ${f(vc.muEffPooled.chi2p, 3)}`);
const cv = vc.convergence;
console.log(`  halves: first ${f(cv.halves.first.mean)} ± ${f(cv.halves.first.se, 2)}, second ${f(cv.halves.second.mean)} ± ${f(cv.halves.second.se, 2)}; paired Δ ${f(cv.halves.pairedDifference.mean, 3)} ± ${f(cv.halves.pairedDifference.se, 2)} (p ${f(cv.halves.pairedDifference.p, 3)})`);
console.log(`  core fraction: 0.4 ${f(cv.coreFraction['0.4'].mean)} ± ${f(cv.coreFraction['0.4'].se, 2)}, 0.6 ${f(cv.coreFraction['0.6'].mean)} ± ${f(cv.coreFraction['0.6'].se, 2)}, 0.8 ${f(cv.coreFraction['0.8'].mean)} ± ${f(cv.coreFraction['0.8'].se, 2)}; paired 0.4−0.6 p ${f(cv.coreFraction.pairedDifference04vs06.p, 3)}, 0.8−0.6 p ${f(cv.coreFraction.pairedDifference08vs06_diagnostic.p, 3)} (diagnostic)`);
console.log(`  cumulative μ(t): ${cv.cumulative.map((q: any) => `${f(q.c, 3)}: ${f(q.mu.mean, 4)} ± ${f(q.mu.se, 2)}`).join('; ')}`);
// V7 timestep: independent seeds
const a = vc.muEffSummary;
const b = vcDt.muEffSummary;
const z7 = (b.mean - a.mean) / Math.hypot(a.se, b.se);
console.log(`  V7 timestep: Courant 0.025 ${f(a.mean)} ± ${f(a.se, 2)} vs Courant 0.05 ${f(b.mean)} ± ${f(b.se, 2)} → z = ${f(z7, 3)}`);
// profile plot
{
  const pe = vc.profileEnsemble;
  const fit = pe.fit;
  const series: Series[] = [
    { label: 'u(y), seed mean ± 95 % CI', x: pe.y, y: pe.ux.map((s: any) => s.mean), err: pe.ux.map((s: any) => (s.ci95[1] - s.ci95[0]) / 2), color: COLORS[0], markers: true, noLine: true },
    { label: `core fit (y ∈ [${f(fit.coreFrom, 3)}, ${f(fit.coreTo, 3)}])`, x: [fit.coreFrom, fit.coreTo], y: [fit.intercept + fit.slope * fit.coreFrom, fit.intercept + fit.slope * fit.coreTo], color: COLORS[1] },
  ];
  put('viscosity_profile.svg', svgPlot({ title: `Couette: velocity profile (${vc.seeds} seeds; walls at y = 0 and ${vc.case.height}, U = ${vc.case.wallSpeed})`, xLabel: 'y', yLabel: 'u_x', series }));
}
// convergence plots
{
  const series: Series[] = cv.perSeed.map((s: any) => ({ label: '', x: cv.blockCollisions, y: s.cumulative, color: '#8c959f', thin: true }));
  series.push({ label: 'seed mean ± 95 % CI', x: cv.cumulative.map((q: any) => q.c), y: cv.cumulative.map((q: any) => q.mu.mean), err: cv.cumulative.map((q: any) => (q.mu.ci95[1] - q.mu.ci95[0]) / 2), color: COLORS[0], markers: true });
  put('viscosity_mu_convergence.svg', svgPlot({ title: 'Couette: running μ_eff (blocks 1…k) against measurement length', xLabel: 'collisions per particle measured', yLabel: 'μ_eff (cumulative)', series, yMin: 0 }));
  const s2: Series[] = [{ label: 'per-block μ_eff, seed mean ± 95 % CI', x: cv.perBlock.map((q: any) => q.c), y: cv.perBlock.map((q: any) => q.mu.mean), err: cv.perBlock.map((q: any) => (q.mu.ci95[1] - q.mu.ci95[0]) / 2), color: COLORS[2], markers: true }];
  put('viscosity_mu_per_block.svg', svgPlot({ title: 'Couette: μ_eff in each consecutive block (no drift ⇒ stationary)', xLabel: 'end of block, collisions per particle', yLabel: 'μ_eff (block)', series: s2, yMin: 0 }));
}
// per-seed plot
{
  const xs = vc.perSeed.map((_: any, i: number) => i + 1);
  put('viscosity_per_seed.svg', svgPlot({
    title: `Couette: μ_eff per seed (± per-run SE) and the seed mean`,
    xLabel: 'seed index', yLabel: 'μ_eff',
    series: [
      { label: 'per seed ± SE', x: xs, y: vc.perSeed.map((q: any) => q.muEff.mean), err: vc.perSeed.map((q: any) => q.muEff.se), color: COLORS[0], markers: true, noLine: true },
      { label: `mean ${f(ms.mean)} (95 % CI ${ci(ms)})`, x: [1, xs.length], y: [ms.mean, ms.mean], color: COLORS[1] },
      { label: '', x: [1, xs.length], y: [ms.ci95[0], ms.ci95[0]], color: COLORS[1], dashed: true },
      { label: '', x: [1, xs.length], y: [ms.ci95[1], ms.ci95[1]], color: COLORS[1], dashed: true },
    ],
  }));
}
// averaging-window sensitivity
{
  const pts = [
    ['core 0.4', cv.coreFraction['0.4']],
    ['core 0.6 (reported)', cv.coreFraction['0.6']],
    ['core 0.8 (Knudsen layers)', cv.coreFraction['0.8']],
    ['first half', cv.halves.first],
    ['second half', cv.halves.second],
    ['Courant 0.05', b],
  ] as [string, any][];
  put('viscosity_window_sensitivity.svg', svgPlot({
    title: 'Couette: μ_eff by averaging window and timestep (seed mean ± 95 % CI); order: ' + pts.map((q) => q[0]).join(' · '),
    xLabel: 'variant (see title order)', yLabel: 'μ_eff',
    series: [{ label: 'variant', x: pts.map((_, i) => i + 1), y: pts.map((q) => q[1].mean), err: pts.map((q) => (q[1].ci95[1] - q[1].ci95[0]) / 2), color: COLORS[4], markers: true, noLine: true }],
    width: 900,
  }));
}

// ------------------------------------------------------------ classification
const classify = (checks: { id: string; status: string }[]) => {
  if (checks.some((c) => c.status === 'FAILED')) return 'FAIL';
  if (checks.every((c) => c.status === 'PASSED')) return 'PASS';
  return 'INCONCLUSIVE';
};
const thermalChecks = thermal.acceptance.map((c: any) => ({ id: c.id, status: c.status, measured: c.measured }));
const viscChecks = [
  ...visc.acceptance.map((c: any) => ({ id: c.id, status: c.status, measured: c.measured })),
  { id: 'V7-timestep', status: Math.abs(z7) < 3 ? 'PASSED' : 'INCONCLUSIVE', measured: `z = ${f(z7, 3)} (Courant 0.05 − 0.025, independent seeds)` },
];
const out = {
  criteria: 'docs/CRITERIA_THERMAL_VISCOSITY.md',
  thermal: { record: thermalPath, classification: classify(thermalChecks), checks: thermalChecks },
  viscosity: { record: viscPath, timestepRecord: viscDtPath, classification: classify(viscChecks), checks: viscChecks, v7: { z: z7, reference: a, courant005: b } },
  plots: files,
};
writeFileSync(join(outDir, 'report_thermal_viscosity.json'), JSON.stringify(out, null, 1));
console.log('\nCLASSIFICATION');
for (const [name, r] of [['thermal', out.thermal], ['viscosity', out.viscosity]] as const) {
  console.log(`  ${name}: ${r.classification}`);
  for (const c of r.checks) console.log(`    [${c.status}] ${c.id}: ${c.measured}`);
}
console.log(`\nplots: ${files.join(', ')}`);
