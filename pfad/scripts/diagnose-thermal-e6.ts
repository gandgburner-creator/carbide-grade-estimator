/**
 * Post-hoc diagnosis of criterion E6 (relaxation settled) in a thermal record.
 * Reads the record only; runs nothing and changes no status. Everything this
 * script prints is a diagnostic: the classification stays the one fixed by
 * docs/CRITERIA_THERMAL_VISCOSITY.md.
 *
 *   npx tsx scripts/diagnose-thermal-e6.ts results/thermal_reference.json [out.json] [plot.svg]
 *
 * 1. Inventory of every window deviating > 4σ from its run's late-half mean
 *    (σ = late-half window SD, exactly the E6 statistic), in the equilibrium
 *    part of every relaxation run (c ≥ 20 collisions/particle) and over the
 *    whole of the Maxwell-start runs, which begin in equilibrium and so are the
 *    empirical null.
 * 2. Relaxation of the seed-ensemble mean curve: 1/e time and the time it first
 *    comes within 3 σ_ens of its late value.
 * 3. A proposed replacement criterion (E6′) evaluated on the same data. It is
 *    post hoc: it does not reclassify this record.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mean, std, tTwoSidedP } from '../src/measurements/Statistics';
import { svgPlot } from './svgPlot';

/* eslint-disable @typescript-eslint/no-explicit-any */
const [path, outPath, plotPath] = process.argv.slice(2);
if (!path) {
  console.error('usage: diagnose-thermal-e6.ts <thermal.json> [out.json] [plot.svg]');
  process.exit(1);
}
const rec = JSON.parse(readFileSync(path, 'utf8'));
type Curve = { distribution: string; seed: number; c: number[]; a2: number[]; anisotropy: number[] };
const curves: Curve[] = rec.results.distributionDependence.curves;
const OBS = ['a2', 'anisotropy'] as const;
const EQ_FROM = 20; // collisions/particle; every start has relaxed by ~10 (section 2)

// ---------------------------------------------------------------- 1. excursions
interface Exc { distribution: string; seed: number; observable: string; window: number; c: number; z: number; half: 'early' | 'late' }
const excursions: Exc[] = [];
let windowsInspected = 0;
let lateWindows = 0;
const lateMaxZ: { distribution: string; seed: number; observable: string; maxAbsZ: number; skewness: number }[] = [];
for (const cv of curves) {
  for (const o of OBS) {
    const x = cv[o];
    const half = Math.floor(x.length / 2);
    const late = x.slice(half);
    const m = mean(late);
    const s = std(late);
    lateWindows += late.length;
    lateMaxZ.push({
      distribution: cv.distribution,
      seed: cv.seed,
      observable: o,
      maxAbsZ: Math.max(...late.map((v) => Math.abs((v - m) / s))),
      skewness: mean(late.map((v) => ((v - m) / s) ** 3)),
    });
    for (let i = 0; i < x.length; i++) {
      if (cv.distribution !== 'maxwell' && cv.c[i] < EQ_FROM) continue;
      windowsInspected++;
      const z = (x[i] - m) / s;
      if (Math.abs(z) > 4) excursions.push({ distribution: cv.distribution, seed: cv.seed, observable: o, window: i, c: cv.c[i], z, half: i >= half ? 'late' : 'early' });
    }
  }
}
// consecutive windows of one series form one episode
const episodes: (Exc & { windows: number; maxZ: number; cTo: number })[] = [];
for (const e of excursions) {
  const last = episodes[episodes.length - 1];
  if (last && last.distribution === e.distribution && last.seed === e.seed && last.observable === e.observable && e.window - (last.window + last.windows - 1) <= 10) {
    last.windows = e.window - last.window + 1;
    last.cTo = e.c;
    if (Math.abs(e.z) > Math.abs(last.maxZ)) last.maxZ = e.z;
  } else episodes.push({ ...e, windows: 1, maxZ: e.z, cTo: e.c });
}
// episode rate per series per collision/particle in equilibrium, and what E6 then flags by chance
const series = curves.length * OBS.length;
const eqSpan = (cv: Curve) => cv.c[cv.c.length - 1] - (cv.distribution === 'maxwell' ? 0 : EQ_FROM);
const exposure = curves.reduce((a, cv) => a + OBS.length * eqSpan(cv), 0);
const rate = episodes.length / exposure;
const lateSpan = mean(curves.map((cv) => cv.c[cv.c.length - 1] - cv.c[Math.floor(cv.c.length / 2)]));
const perStartSeries = OBS.length * curves.filter((c) => c.distribution === 'uniform-box').length;
const lambdaStart = rate * perStartSeries * lateSpan;
const starts = [...new Set(curves.map((c) => c.distribution))];
const pAnyFlag = 1 - Math.exp(-lambdaStart * starts.length);

console.log(`E6 statistic: |x − late mean| > 4 × late SD, per window, per seed, per observable`);
console.log(`  windows inspected (equilibrium part): ${windowsInspected} in ${series} series; late-half windows ${lateWindows}`);
console.log(`  > 4σ episodes: ${episodes.length}`);
for (const e of episodes) console.log(`    ${e.distribution} seed ${e.seed} ${e.observable}: c ${e.c.toFixed(2)}–${e.cTo.toFixed(2)} (${e.windows} windows), max z ${e.maxZ.toFixed(2)}, ${e.half} half`);
console.log(`  episode rate in equilibrium: ${rate.toExponential(2)} per series per collision/particle`);
console.log(`  expected chance episodes in the late halves of one start (${perStartSeries} series × ${lateSpan.toFixed(1)} collisions/particle): ${lambdaStart.toFixed(2)}`);
console.log(`  chance that E6 flags at least one of ${starts.length} starts with no relaxation defect at all: ${(100 * pAnyFlag).toFixed(0)} %`);
for (const o of OBS) {
  const L = lateMaxZ.filter((q) => q.observable === o);
  console.log(`  ${o}: late-half skewness mean ${mean(L.map((q) => q.skewness)).toFixed(3)} (range ${Math.min(...L.map((q) => q.skewness)).toFixed(2)} … ${Math.max(...L.map((q) => q.skewness)).toFixed(2)}); late max|z| mean ${mean(L.map((q) => q.maxAbsZ)).toFixed(2)}, max ${Math.max(...L.map((q) => q.maxAbsZ)).toFixed(2)}`);
}

// --------------------------------------------------- 2. ensemble relaxation
const relaxation = starts.flatMap((d) => {
  const cs = curves.filter((c) => c.distribution === d);
  const n = Math.min(...cs.map((c) => c.c.length));
  return OBS.map((o) => {
    const ens = Array.from({ length: n }, (_, i) => mean(cs.map((c) => c[o][i])));
    const cc = Array.from({ length: n }, (_, i) => mean(cs.map((c) => c.c[i])));
    const half = Math.floor(n / 2);
    const m = mean(ens.slice(half));
    const sEns = std(ens.slice(half));
    const dev0 = Math.abs(ens[0] - m);
    const iE = ens.findIndex((v) => Math.abs(v - m) < dev0 / Math.E);
    const iB = ens.findIndex((v) => Math.abs(v - m) < 3 * sEns);
    return {
      distribution: d,
      observable: o,
      initial: ens[0],
      late: m,
      sigmaEnsemble: sEns,
      initialDeviationInSigma: dev0 / sEns,
      tOneOverE: iE >= 0 ? cc[iE] : null,
      tWithin3Sigma: iB >= 0 ? cc[iB] : null,
      runLength: cc[n - 1],
    };
  });
});
console.log(`\nSeed-ensemble relaxation (collisions/particle):`);
for (const q of relaxation) console.log(`  ${q.distribution.padEnd(13)} ${q.observable.padEnd(10)} initial ${q.initial.toFixed(4)} → ${q.late.toExponential(2)} (${q.initialDeviationInSigma.toFixed(1)} σ_ens): 1/e at ${q.tOneOverE?.toFixed(2) ?? '—'}, within 3 σ_ens at ${q.tWithin3Sigma?.toFixed(2) ?? '—'} of ${q.runLength.toFixed(0)}`);

// ------------------------------------------ 3. proposed criterion E6′ (post hoc)
const B = 4;
const blockMeans = (x: number[]) => {
  const half = Math.floor(x.length / 2);
  const len = Math.floor((x.length - half) / B);
  return Array.from({ length: B }, (_, b) => mean(x.slice(half + b * len, half + (b + 1) * len)));
};
const welch = (a: number[], b: number[]) => {
  const va = std(a) ** 2 / a.length;
  const vb = std(b) ** 2 / b.length;
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { t, df, p: tTwoSidedP(t, df) };
};
const control = curves.filter((c) => c.distribution === 'maxwell');
const tests = starts
  .filter((d) => d !== 'maxwell')
  .flatMap((d) =>
    OBS.flatMap((o) =>
      Array.from({ length: B }, (_, b) => {
        const w = welch(
          curves.filter((c) => c.distribution === d).map((c) => blockMeans(c[o])[b]),
          control.map((c) => blockMeans(c[o])[b]),
        );
        return { distribution: d, observable: o, block: b + 1, t: w.t, df: w.df, p: w.p };
      }),
    ),
  );
const alpha = 0.05 / tests.length;
const worst = tests.reduce((a, t) => (t.p < a.p ? t : a), tests[0]);
const e6prime = tests.every((t) => t.p > alpha) ? 'PASS' : tests.some((t) => t.p < 1e-6) ? 'FAIL' : 'INCONCLUSIVE';
console.log(`\nProposed E6′ (post hoc, NOT used for classification): late half in ${B} blocks; per block, the non-Maxwell starts' per-seed block means vs the Maxwell-start control (Welch t); PASS if all p > 0.05/${tests.length} = ${alpha.toExponential(2)}, FAIL if any p < 1e-6`);
console.log(`  smallest p = ${worst.p.toPrecision(3)} (${worst.distribution} / ${worst.observable} / block ${worst.block}, t = ${worst.t.toFixed(2)}); outcome on this record: ${e6prime}`);

const official = rec.acceptance.find((c: any) => c.id === 'E6-relaxation-settled');
console.log(`\nOfficial E6 in the record: ${official?.status} (${official?.measured}); the classification is unchanged by this script.`);

if (outPath) {
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        source: rec.experimentId,
        note: 'Post-hoc diagnosis of E6; does not change the pre-registered classification (docs/CRITERIA_THERMAL_VISCOSITY.md).',
        officialE6: official,
        excursions: { equilibriumFrom: EQ_FROM, windowsInspected, lateWindows, series, episodes, ratePerSeriesPerCollision: rate, expectedChanceEpisodesPerStart: lambdaStart, chanceAnyStartFlagged: pAnyFlag, lateMaxZ },
        relaxation,
        proposedE6prime: { blocks: B, m: tests.length, alpha, tests, outcome: e6prime, postHoc: true },
      },
      null,
      1,
    ),
  );
  console.log(`written ${outPath}`);
}

if (plotPath) {
  // the flagged series next to the largest excursion of the equilibrium-start control
  const flagged = episodes.filter((e) => e.half === 'late');
  const ctrlEp = episodes.filter((e) => e.distribution === 'maxwell').reduce<(typeof episodes)[number] | null>((a, e) => (!a || Math.abs(e.maxZ) > Math.abs(a.maxZ) ? e : a), null);
  const pick = [...flagged, ...(ctrlEp ? [ctrlEp] : [])];
  const colors = ['#d1242f', '#1f6feb', '#1a7f37', '#9a6700'];
  const zSeries = pick.map((e, k) => {
    const cv = curves.find((c) => c.distribution === e.distribution && c.seed === e.seed)!;
    const x = cv[e.observable as (typeof OBS)[number]];
    const late = x.slice(Math.floor(x.length / 2));
    const m = mean(late);
    const s = std(late);
    // the initial relaxation (z ≈ −14 for a2) is clipped to the axis
    return { label: `${e.distribution} s${e.seed} ${e.observable}${e.distribution === 'maxwell' ? ' (control)' : ' (flagged)'}`, x: cv.c, y: x.map((v) => Math.max(-6, Math.min(6, (v - m) / s))), color: colors[k % colors.length] };
  });
  const c0 = curves[0].c;
  const cHalf = c0[Math.floor(c0.length / 2)];
  writeFileSync(
    plotPath,
    svgPlot({
      title: 'E6 statistic z = (x − late mean) / late SD per window (clipped at ±6)',
      xLabel: `collisions per particle (late half starts at ${cHalf.toFixed(1)})`,
      yLabel: 'z',
      yMin: -6,
      yMax: 6,
      width: 740,
      series: [
        ...zSeries,
        { label: '±4σ (E6 limit)', x: [c0[0], c0[c0.length - 1]], y: [4, 4], color: '#57606a', dashed: true },
        { label: '', x: [c0[0], c0[c0.length - 1]], y: [-4, -4], color: '#57606a', dashed: true, thin: true },
        { label: '', x: [cHalf, cHalf], y: [-6, 6], color: '#57606a', thin: true },
      ],
    }),
  );
  console.log(`written ${plotPath}`);
}
