/**
 * Report for the small-amplitude sound-speed experiment (Item 2,
 * docs/CRITERIA_SOUND_SPEED.md): tables, plots and the PASS / INCONCLUSIVE /
 * FAIL classification stored in the record. Reads one record; runs nothing.
 *
 *   npx tsx scripts/report-sound-speed.ts results/sound-speed_validation.json results/plots/sound_speed
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { svgPlot, type Series } from './svgPlot';

/* eslint-disable @typescript-eslint/no-explicit-any */
const [path, outDir] = process.argv.slice(2);
if (!path || !outDir) {
  console.error('usage: report-sound-speed.ts <record.json> <outdir>');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const rec = JSON.parse(readFileSync(path, 'utf8'));
if (rec.experimentType !== 'sound-speed-validation') throw new Error('not a sound-speed-validation record');
const R = rec.results;
const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a', '#0a7ea4', '#bf3989'];
const files: string[] = [];
const put = (name: string, svg: string) => {
  writeFileSync(join(outDir, name), svg);
  files.push(join(outDir, name));
};
const f = (v: number | null | undefined, n = 4) => (v === null || v === undefined || !Number.isFinite(v) ? 'n/a' : v.toPrecision(n));
const pct = (v: number) => `${(100 * v).toFixed(2)} %`;
const cases: any[] = R.cases;
const amps = cases.filter((c) => c.role === 'amplitude').sort((a, b) => b.amplitude - a.amplitude);
const probes: number[] = R.settings.measurement.probes;

console.log(`SMALL-AMPLITUDE SOUND SPEED  ${rec.experimentId}`);
console.log(`  model ${rec.modelVersion}; ${rec.seeds.length} seeds ${rec.seeds[0]}–${rec.seeds[rec.seeds.length - 1]}; criteria ${R.criteria}`);
console.log(`  probes ${probes.join(', ')} (width ${R.settings.measurement.widths[0]}); sampling ${R.settings.measurement.snapshotInterval}; window ≤ ${R.settings.analysis.tEnd}`);

// ------------------------------------------------------------------ cases
console.log('\nPER CASE (primary: stacked-template cross-correlation of the outward momentum pulse)');
for (const c of cases) {
  if (!c.primary) {
    console.log(`  ${c.label}: ${c.missing} run(s) missing`);
    continue;
  }
  const p = c.primary;
  console.log(`\n  ${c.label}  [${c.role}${c.variant ? `, ${c.variant.kind}${c.variant.judged ? '' : ', reported only'}` : ''}]  N ≈ ${f(c.particles, 5)}, realized amplitude ${f(c.realizedAmplitude, 3)}, kT ${f(c.kTStart, 5)} → ${f(c.kTEnd, 5)}`);
  console.log(`    c = ${f(p.speed, 5)} ± ${f(p.se, 3)} (jackknife SE), 95 % CI [${f(p.ci95[0], 5)}, ${f(p.ci95[1], 5)}], seed-to-seed SD ${f(p.seedSd, 3)}`);
  console.log(`    detection: stack SNR ${f(p.stackSnr, 3)}, probes with correlation ≥ 3σ: ${p.probesDetected}/${probes.length} → ${p.detected ? 'DETECTED' : 'not detected'}; ambiguous: ${p.ambiguous ? 'YES' : 'no'}`);
  if (p.competingMoveouts.length) console.log(`    competing coherent moveouts: ${p.competingMoveouts.map((q: any) => `${f(q.speed, 4)} (ratio ${f(q.ratio, 2)}, SNR ${f(q.snr, 2)})`).join('; ')}`);
  if (p.competingCorrelation.length) console.log(`    competing correlation peaks: ${p.competingCorrelation.map((q: any) => `d ${q.probe}: τ ${f(q.tau, 4)} (ratio ${f(q.ratio, 2)}, SNR ${f(q.snr, 2)})`).join('; ')}`);
  if (p.looUnstable.slowness || p.looUnstable.probes.length) console.log(`    leave-one-out unstable: slowness ${p.looUnstable.slowness}, probes ${p.looUnstable.probes.join(', ')}`);
  console.log(`    arrival vs distance: R² ${f(p.fit.r2, 6)}, residual RMS ${f(p.fit.residualRms, 3)}, curvature z ${f(p.curvature.z, 3)}; slant-stack speed ${f(p.slantStackSpeed, 5)}; inward stack SNR ${f(p.inward.snr, 3)} (ratio ${f(p.inward.ratio, 2)})`);
  console.log(`    features (reported): ${c.features.map((q: any) => `${q.name}: ${Number.isFinite(q.speed) ? `${f(q.speed, 4)} ± ${f(q.se, 2)}` : 'not fitted'} (${q.probes.filter((x: any) => x.detected).length} probes)`).join('; ')}`);
  console.log(`    sides: right ${f(c.sides.right.speed, 4)} ± ${f(c.sides.right.se, 2)}, left ${f(c.sides.left.speed, 4)} ± ${f(c.sides.left.se, 2)}; placement: inner ${f(c.placement.inner.speed, 4)} ± ${f(c.placement.inner.se, 2)}, outer ${f(c.placement.outer.speed, 4)} ± ${f(c.placement.outer.se, 2)}`);
  console.log(`    pairwise: ${c.pairwise.map((q: any) => `${q.from}→${q.to} ${f(q.speed, 3)}±${f(q.se, 2)}`).join(', ')}`);
  console.log(`    energy residual ${f(c.energyResidualMax, 2)}; sampling grid deviation ≤ ${f(c.gridDeviationMax, 2)}`);
}

// ---------------------------------------------------------- extrapolation
const X = R.extrapolation;
console.log('\nAMPLITUDE SERIES AND ZERO-AMPLITUDE EXTRAPOLATION');
for (const a of R.amplitudeSeries) console.log(`  A ${a.amplitude} (realized ${f(a.realized, 3)}): c ${f(a.speed, 5)} ± ${f(a.se, 3)}, SNR ${f(a.stackSnr, 3)}, ${a.detected ? 'detected' : 'NOT detected'}${a.ambiguous ? ', AMBIGUOUS' : ''}, R² ${f(a.r2, 5)}, curvature z ${f(a.curvatureZ, 3)} → distance linearity ${a.status}`);
console.log(`  noise-dominated: ${X.noiseDominated.map((q: any) => q.amplitude).join(', ') || 'none'}; dropped (top-down rule): ${X.dropped.map((q: any) => `${q.amplitude} (${q.reason})`).join('; ') || 'none'}`);
if (X.c0 !== undefined) {
  console.log(`  set ${X.set.join(', ')}: c₀ = ${f(X.c0, 5)} ± ${f(X.c0Se, 3)} (joint jackknife), 95 % CI [${f(X.ci95[0], 5)}, ${f(X.ci95[1], 5)}] (±${pct(X.relHalfWidth95)}); slope k = ${f(X.slope, 4)} ± ${f(X.slopeSe, 2)}; c(A) curvature z ${f(X.curvature.z, 3)}; χ² ${f(X.chi2, 3)} (${X.dofFit} dof, diagonal SEs, reported)`);
  if (X.smallestThree) console.log(`  sensitivity: smallest three amplitudes → c₀ = ${f(X.smallestThree.c0, 5)} ± ${f(X.smallestThree.c0Se, 3)}`);
}
if (X.allDetected) console.log(`  sensitivity: all detected amplitudes → c₀ = ${f(X.allDetected.c0, 5)} ± ${f(X.allDetected.c0Se, 3)}, curvature z ${f(X.allDetected.curvature.z, 3)}`);
if (R.reproducibility) {
  const r = R.reproducibility;
  console.log(`  split halves: ${r.halves.map((h: any) => `${f(h.c0, 5)} ± ${f(h.se, 3)}`).join(' vs ')} (z ${f(r.halvesZ, 3)}); ${r.groups.length} groups: ${r.groups.map((g: any) => f(g.c0, 5)).join(', ')} (SD ${f(r.groupC0Sd, 3)})`);
}

// ------------------------------------------------------------- invariance
console.log('\nINVARIANCE (relative speed difference vs the reference amplitude case, joint jackknife, 95 % CI; margin ±' + pct(R.settings.criteria.equivalence) + ')');
for (const q of R.invariance) console.log(`  ${q.id.padEnd(22)} ${q.what.padEnd(36)} ${pct(q.rel).padStart(9)} [${pct(q.ci95[0])}, ${pct(q.ci95[1])}]  ${q.judged ? q.status : `(reported) ${q.status}`}${q.detected ? '' : ' not detected'}${q.ambiguous ? ' ambiguous' : ''}`);
console.log('\nCONTROL (A = 0): ' + JSON.stringify({ outward: R.control?.outwardStackSnr, inward: R.control?.inwardStackSnr, maxProbe: R.control?.maxProbeSnr }));
console.log('REFLECTION: ' + R.reflection.map((q: any) => `${q.label}: wrapped ≥ ${f(q.earliestWrappedArrival, 4)} (window ${q.windowEnd}), inward SNR ${f(q.inwardStackSnr, 3)}`).join('; '));
console.log('\nEXTERNAL BENCHMARKS (comparison only, not criteria): ' + JSON.stringify(rec.benchmarks));

console.log(`\nCLASSIFICATION: ${R.classification}`);
for (const c of rec.acceptance) console.log(`  [${c.status}] ${c.id}: ${c.measured}`);

// ------------------------------------------------------------------ plots
const caseFile = (c: any) => c.label.replace(/[^A-Za-z0-9.]+/g, '_').replace(/_+$/, '');
// x–t diagram of the ensemble outward momentum density
const heat = (c: any) => {
  const F = c.field;
  const W = 760;
  const H = 460;
  const m = { l: 60, r: 20, t: 40, b: 50 };
  const rows = F.rows;
  const bins = F.bins;
  const vals: number[] = F.values.map((v: number | null) => v ?? 0);
  const vmax = Math.max(1e-12, ...vals.map((v) => Math.abs(v))) * 0.8;
  const cw = (W - m.l - m.r) / bins;
  const ch = (H - m.t - m.b) / rows;
  const col = (v: number) => {
    const x = Math.max(-1, Math.min(1, v / vmax));
    const r = x > 0 ? 255 : Math.round(255 * (1 + x));
    const b = x < 0 ? 255 : Math.round(255 * (1 - x));
    const g = Math.round(255 * (1 - Math.abs(x)));
    return `rgb(${r},${g},${b})`;
  };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="12"><rect width="${W}" height="${H}" fill="#fff"/>`];
  parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600">${c.label}: outward momentum density j(d, t), seed mean (red outward, blue inward; ±${vmax.toPrecision(2)})</text>`);
  for (let k = 0; k < rows; k++)
    for (let b = 0; b < bins; b++) parts.push(`<rect x="${(m.l + b * cw).toFixed(1)}" y="${(H - m.b - (k + 1) * ch).toFixed(1)}" width="${(cw + 0.5).toFixed(1)}" height="${(ch + 0.5).toFixed(1)}" fill="${col(vals[k * bins + b])}"/>`);
  const tMax = F.times[rows - 1];
  for (let i = 0; i <= 5; i++) {
    const d = (i / 5) * bins * F.binWidth;
    parts.push(`<text x="${m.l + (i / 5) * (W - m.l - m.r)}" y="${H - m.b + 16}" text-anchor="middle">${d.toFixed(0)}</text>`);
    parts.push(`<text x="${m.l - 6}" y="${H - m.b - (i / 5) * (H - m.t - m.b) + 4}" text-anchor="end">${((i / 5) * tMax).toFixed(0)}</text>`);
  }
  for (const p of probes) parts.push(`<line x1="${m.l + (p / (bins * F.binWidth)) * (W - m.l - m.r)}" x2="${m.l + (p / (bins * F.binWidth)) * (W - m.l - m.r)}" y1="${H - m.b}" y2="${H - m.b + 5}" stroke="#333"/>`);
  parts.push(`<text x="${W / 2}" y="${H - 12}" text-anchor="middle">distance from the disturbance d (ticks: probes)</text>`);
  parts.push(`<text transform="translate(16 ${H / 2}) rotate(-90)" text-anchor="middle">time</text></svg>`);
  return parts.join('\n');
};
for (const c of cases.filter((x) => x.field && x.role !== 'variant')) put(`xt_${caseFile(c)}.svg`, heat(c));

// probe waveforms ("seismogram") and arrival vs distance per amplitude/control
for (const c of cases.filter((x) => x.series)) {
  const per = c.series.perProbe as (number | null)[][][];
  const dt = R.settings.measurement.snapshotInterval;
  const E = per.map((ps) => ps[0].map((_, k) => ps.reduce((a, s) => a + (s[k] ?? 0), 0) / ps.length));
  const amp = Math.max(1e-12, ...E.flat().map((v) => Math.abs(v)));
  const scale = 8 / amp;
  const series: Series[] = E.map((e, p) => ({ label: p === 0 ? 'seed-mean j at each probe (offset = distance)' : '', x: e.map((_, k) => k * dt), y: e.map((v) => probes[p] + scale * v), color: COLORS[0], thin: p > 0 }));
  const pk = c.features[0].probes;
  series.push({ label: 'momentum-peak centroid (secondary feature)', x: pk.filter((q: any) => q.detected).map((q: any) => q.t), y: pk.filter((q: any) => q.detected).map((q: any) => q.d), color: COLORS[1], markers: true, noLine: true });
  put(`waveforms_${caseFile(c)}.svg`, svgPlot({ title: `${c.label}: seed-mean outward momentum at each probe`, xLabel: 'time', yLabel: `distance d (signal × ${scale.toPrecision(2)})`, series, width: 760, height: 520 }));
}
for (const c of amps.filter((x) => x.primary)) {
  const p = c.primary;
  const fitY = probes.map((d) => (d - probes[0]) / p.speed + (p.delays[0] - 0));
  put(`arrival_${caseFile(c)}.svg`, svgPlot({
    title: `${c.label}: arrival delay against distance (primary), R² ${f(p.fit.r2, 5)}`,
    xLabel: 'probe distance d', yLabel: 'delay relative to the first probe',
    series: [
      { label: 'delay ± jackknife SE', x: probes, y: p.delays, err: p.delaySe, color: COLORS[0], markers: true, noLine: true },
      { label: `fit: c = ${f(p.speed, 4)} ± ${f(p.se, 2)}`, x: probes, y: fitY.map((y, i) => y + (p.fit.intercept - fitY[0] + p.delays[0] - p.delays[0]) * 0 + (p.fit.intercept + p.fit.slope * probes[i] - y)), color: COLORS[1] },
    ],
  }));
}
// c(A) and extrapolation
{
  const pts = R.amplitudeSeries.filter((a: any) => Number.isFinite(a.speed));
  const inSet = pts.filter((a: any) => (X.set ?? []).includes(a.amplitude));
  const outSet = pts.filter((a: any) => !(X.set ?? []).includes(a.amplitude));
  const series: Series[] = [
    { label: 'amplitudes in the extrapolation set (± SE)', x: inSet.map((a: any) => a.amplitude), y: inSet.map((a: any) => a.speed), err: inSet.map((a: any) => a.se), color: COLORS[0], markers: true, noLine: true },
  ];
  if (outSet.length) series.push({ label: 'not in the set (noise-dominated or dropped)', x: outSet.map((a: any) => a.amplitude), y: outSet.map((a: any) => a.speed), err: outSet.map((a: any) => a.se), color: COLORS[5], markers: true, noLine: true });
  if (X.c0 !== undefined) {
    const xs = [0, Math.max(...pts.map((a: any) => a.amplitude))];
    series.push({ label: `c₀ + k·A, c₀ = ${f(X.c0, 4)} [${f(X.ci95[0], 4)}, ${f(X.ci95[1], 4)}]`, x: xs, y: xs.map((a) => X.c0 + X.slope * a), color: COLORS[1] });
    series.push({ label: '', x: [0, 0], y: X.ci95, err: undefined, color: COLORS[1], thin: true });
  }
  const pk = amps.filter((c) => Number.isFinite(c.features?.[0]?.speed));
  if (pk.length) series.push({ label: 'momentum-peak centroid speed (secondary)', x: pk.map((c) => c.amplitude), y: pk.map((c) => c.features[0].speed), err: pk.map((c) => c.features[0].se), color: COLORS[2], markers: true, noLine: true });
  put('speed_vs_amplitude.svg', svgPlot({ title: 'Propagation speed against disturbance amplitude, and the zero-amplitude limit', xLabel: 'amplitude A (fractional density excess in the slab)', yLabel: 'speed', series }));
}
// invariance
{
  const inv = R.invariance;
  put('invariance.svg', svgPlot({
    title: `Invariance tests at A = ${R.settings.criteria.referenceAmplitude}: relative speed difference, 95 % CI (order: ${inv.map((q: any) => q.id).join(' · ')})`,
    xLabel: 'test (see title order)', yLabel: 'relative difference',
    width: 1000,
    series: [
      { label: 'difference, 95 % CI', x: inv.map((_: any, i: number) => i + 1), y: inv.map((q: any) => q.rel), err: inv.map((q: any) => (q.ci95[1] - q.ci95[0]) / 2), color: COLORS[4], markers: true, noLine: true },
      { label: `±${pct(R.settings.criteria.equivalence)} margin`, x: [1, inv.length], y: [R.settings.criteria.equivalence, R.settings.criteria.equivalence], color: COLORS[5], dashed: true },
      { label: '', x: [1, inv.length], y: [-R.settings.criteria.equivalence, -R.settings.criteria.equivalence], color: COLORS[5], dashed: true, thin: true },
    ],
  }));
}
// stack power vs speed
{
  const series: Series[] = amps.filter((c) => c.primary?.stackPower).map((c, i) => ({ label: c.label, x: c.primary.stackPower.speed, y: c.primary.stackPower.power, color: COLORS[i % COLORS.length] }));
  put('stack_power.svg', svgPlot({ title: 'Slant-stack power against trial speed (outward > 0, inward < 0), normalised; one coherent maximum expected', xLabel: 'trial speed (negative: inward-moving)', yLabel: 'P / P_max', series, yMin: 0, yMax: 1.05 }));
}
// halves and groups
if (R.reproducibility) {
  const r = R.reproducibility;
  const series: Series[] = [
    ...r.halves.map((h: any, i: number) => ({ label: `half ${i + 1}: c₀ ${f(h.c0, 4)} ± ${f(h.se, 2)}`, x: h.perAmplitude.map((q: any) => q.amplitude), y: h.perAmplitude.map((q: any) => q.speed), err: h.perAmplitude.map((q: any) => q.se), color: COLORS[i], markers: true })),
    ...r.groups.map((g: any, i: number) => ({ label: i === 0 ? 'independent groups of seeds' : '', x: g.perAmplitude.map((q: any) => q.amplitude), y: g.perAmplitude.map((q: any) => q.speed), color: '#8c959f', thin: true })),
  ];
  put('seed_halves_groups.svg', svgPlot({ title: 'Seed reproducibility: speed against amplitude for independent halves and groups of seeds', xLabel: 'amplitude A', yLabel: 'speed', series }));
}
writeFileSync(join(outDir, 'report_sound_speed.json'), JSON.stringify({ record: path, experimentId: rec.experimentId, classification: R.classification, checks: rec.acceptance, extrapolation: { ...X, looC0: undefined }, invariance: R.invariance, plots: files }, null, 1));
console.log(`\nplots: ${files.join(', ')}`);
