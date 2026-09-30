/**
 * Headless experiment runner.
 *
 *   npm run exp -- <experiment-type> [--quick] [--set key=<json>]... [--out dir] [--name file-stem]
 *   npm run exp -- replay <record.json>
 *
 * Writes <out>/<name>.json (the full ExperimentRecord) and, where a plot is
 * defined, <out>/<name>.svg. Prints the acceptance checks and headline numbers.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperimentRecord, ExperimentType } from '../src/experiments/Experiment';
import { EXPERIMENTS, runFromRecord } from '../src/experiments/registry';
import { runConvergenceStudy } from '../src/validation/Convergence';
import { CONVERGENCE_STUDIES } from '../src/validation/studies';
import { svgPlot, type Series } from './svgPlot';

const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a'];

function parseArgs(argv: string[]) {
  const args = { type: argv[0], quick: false, set: {} as Record<string, unknown>, out: 'results', name: '', file: '' };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') args.quick = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--set') {
      const kv = argv[++i];
      const eq = kv.indexOf('=');
      const key = kv.slice(0, eq);
      const raw = kv.slice(eq + 1);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      args.set[key] = value;
    } else if (!args.file) args.file = a;
  }
  return args;
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(5);
  return String(v);
}

function printRecord(rec: ExperimentRecord): void {
  console.log(`\n=== ${rec.title} — status: ${rec.status} ===`);
  console.log(`model ${rec.modelVersion}, seeds ${rec.seeds.join(',')}, N = ${rec.particleCount}`);
  for (const c of rec.acceptance) {
    console.log(`  [${c.status.padEnd(13)}] ${c.id}: ${c.measured}   (criterion: ${c.criterion})`);
  }
  if (rec.experimentType === 'static-box') printStaticBox(rec);
  if (rec.experimentType === 'thermal') printThermal(rec);
  if (rec.experimentType === 'wall-accommodation') printWall(rec);
  if (rec.warnings.length) {
    console.log('warnings:');
    for (const w of rec.warnings.slice(0, 20)) console.log('  - ' + w);
    if (rec.warnings.length > 20) console.log(`  … ${rec.warnings.length - 20} more`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printStaticBox(rec: any): void {
  const el = rec.results.elastic;
  if (el?.measuredPressure) {
    const P = el.measuredPressure;
    console.log(
      `\nMEASURED elastic wall pressure: ${fmt(P.mean)} ± ${fmt(P.se)} (SE), 95% CI [${fmt(P.ci95[0])}, ${fmt(P.ci95[1])}], sd ${fmt(P.sd)} (${P.method === 'ensemble' ? 'between seeds' : 'between windows'}), method ${P.method}, independent samples ${fmt(P.nIndependent)}`,
    );
    console.log(`  kT (KE/N) = ${fmt(el.kTMean)}`);
    for (const s of el.perSeed) {
      console.log(
        `  seed ${s.seed}: P = ${fmt(s.pressure.mean)} ± ${fmt(s.pressure.se)}; walls ${s.walls.map((w: { mean: number }) => fmt(w.mean)).join(', ')}; isotropy p = ${fmt(s.isotropyP)}; stationarity z = ${fmt(s.stationarityZ)}; collisions/particle measured = ${fmt(s.collisionsPerParticleMeasured)}`,
      );
    }
    const b = rec.benchmarks.pressure;
    console.log('BENCHMARK comparison (reference only):');
    for (const k of ['idealGas_NkT_over_A', 'idealGas_accessibleArea', 'hardDiskHenderson']) {
      const r = b[k];
      console.log(
        `  ${k.padEnd(24)} ref ${fmt(r.benchmark)}  measured/ref = ${fmt(r.measuredOverBenchmark)}  95% CI [${fmt(r.ci95[0])}, ${fmt(r.ci95[1])}]  within CI: ${r.agreesWithin95}`,
      );
    }
    const cf = rec.benchmarks.collisionFrequency;
    console.log(`  collision frequency: measured ${fmt(cf.measured)}, Enskog ${fmt(cf.enskog)}, ratio ${fmt(cf.measuredOverBenchmark)}`);
  }
  const dec = rec.results.inelasticDecay;
  if (dec) {
    console.log('\nMEASURED inelastic decay:');
    for (const [e, d] of Object.entries<any>(dec)) {
      const b = rec.benchmarks.inelasticDecay[e];
      const cp = d.collisionsPerParticleToHalvePressure;
      const ct = d.collisionsPerParticleToHalveKT;
      console.log(
        `  ${e}: pressure halves after ${cp ? fmt(cp.mean) : 'n/a'}${cp?.se ? ' ± ' + fmt(cp.se) : ''} collisions/particle; kT halves after ${ct ? fmt(ct.mean) : 'n/a'}; decay rate k = ${d.logPressureDecayRatePerCollision ? fmt(d.logPressureDecayRatePerCollision.mean) : 'n/a'} per collision   | benchmark (Haff) ${fmt(b.haffHomogeneousCooling_cHalf)}`,
      );
      for (const s of d.perSeed) {
        console.log(
          `     seed ${s.seed}: c½(P) = ${fmt(s.cHalfPressure)}, c½(kT) = ${fmt(s.cHalfTemperature)}, fit k = ${s.fit ? fmt(s.fit.k) + ' ± ' + fmt(s.fit.seK) : 'n/a'}, final KE fraction ${fmt(s.finalKineticFraction)} at c = ${fmt(s.totalCollisionsPerParticle)}`,
        );
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printThermal(rec: any): void {
  const est = (e: any) => (e ? `${fmt(e.mean)} ± ${fmt(e.se)}` : 'n/a');
  const T = rec.results.temperatureDependence;
  if (T) {
    console.log('\nMEASURED temperature dependence (P/(nkT) per kT):');
    for (const r of T.table) console.log(`  kT=${r.kT} (class ${fmt(r.temperatureClass)}): P = ${est(r.pressure)}, Z = ${est(r.dimensionlessPressure)} (${r.seeds} seeds; seed ensemble ${est(r.dimensionlessPressure.seedEnsemble)})`);
    console.log(`  fit P = a + b kT: a = ${fmt(T.fit.intercept)} ± ${fmt(T.fit.seIntercept)}, b = ${fmt(T.fit.slope)} ± ${fmt(T.fit.seSlope)}; Z consistency across classes p = ${fmt(T.zConsistencyAcrossTemperatureClasses.pValue)}; same-seed same-class spread ${fmt(T.sameSeedSameClassRelativeSpread)}`);
  }
  const D = rec.results.densityDependence;
  if (D) {
    console.log('MEASURED equation of state Z(φ):');
    for (const [i, r] of D.table.entries()) {
      const b = rec.benchmarks.equationOfState.points[i];
      console.log(`  φ=${r.areaFraction}: Z = ${est(r.dimensionlessPressure)}   | benchmark Henderson ${fmt(b.hendersonZ)}, ratio ${fmt(b.measuredOverHenderson)}`);
    }
    console.log(`  fit (Z−1)/φ = B + Cφ: B = ${fmt(D.fit.B)} ± ${fmt(D.fit.seB)}, C = ${fmt(D.fit.C)} ± ${fmt(D.fit.seC)}   | benchmark B = 2`);
  }
  const X = rec.results.distributionDependence;
  if (X) {
    console.log('MEASURED relaxation from initial distributions:');
    for (const r of X.rows) {
      console.log(`  ${r.distribution.padEnd(14)} a2: ${fmt(r.initial.a2)} → ${est(r.equilibrium_a2_pooled)} after ${est(r.relaxationCollisions_a2)} coll/particle; anisotropy ${fmt(r.initial.anisotropy)} relaxed after ${est(r.relaxationCollisions_anisotropy)}; kurtosis ${est(r.equilibrium_kurtosis)}; Z = ${est(r.equilibriumZ)}; settled ${r.settled}`);
    }
    for (const k of rec.benchmarks.velocityDistribution.ksAgainstRayleigh) console.log(`  benchmark KS vs Rayleigh (${k.distribution}): D = ${fmt(k.D)}, n = ${k.n}, p = ${fmt(k.pValue)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printWall(rec: any): void {
  const est = (e: any) => (e && Number.isFinite(e.mean) ? `${fmt(e.mean)} ± ${fmt(e.se)}` : 'n/a');
  console.log(`\nMEASURED thermal accommodation (hot wall kT = ${rec.config.hotWallKT}, cold wall kT = ${rec.config.coldWallKT}):`);
  for (const t of rec.results.thermal) {
    console.log(`  Aw=${t.Aw}: diffuse ${est(t.realisedDiffuseFraction)}, α_E hot ${est(t.alphaE_hotWall)} cold ${est(t.alphaE_coldWall)}, q_in ${est(t.heatIntoGasAtHotWallPerTimePerLength)}, q_out ${est(t.heatOutOfGasAtColdWallPerTimePerLength)}, imbalance ${est(t.heatImbalance)} (z ${fmt(t.heatImbalance.z)}), gas kT at hot wall ${est(t.gasKTNextToHotWall)}, at cold wall ${est(t.gasKTNextToColdWall)}`);
  }
  console.log(`MEASURED shear response (top wall U = ${rec.config.shearWallSpeed}):`);
  for (const s of rec.results.shear) {
    console.log(`  Aw=${s.Aw}: τ_bottom ${est(s.bottomShear)}, τ_top ${est(s.topShear)}, imbalance ${est(s.shearImbalance)} (z ${fmt(s.shearImbalance.z)}), α_t bottom ${est(s.alphaT_bottom)} top ${est(s.alphaT_top)}, slip bottom ${est(s.slipBottom)} top ${est(s.slipTop)}, work ${est(s.wallWorkOnGasPerTime)} heat ${est(s.heatRemovedPerTime)}, gas kT ${est(s.gasKT)}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function plotStaticBox(rec: any): string | null {
  const curves = rec.results.pressureVsCollisions?.curves;
  if (!curves) return null;
  const series: Series[] = Object.entries<any>(curves).map(([e, curve], k) => ({
    label: `${e} (bin ${curve.binWidth})`,
    x: curve.points.map((p: any) => p.c),
    y: curve.points.map((p: any) => p.pOverPref),
    err: curve.points.map((p: any) => p.se),
    color: COLORS[k % COLORS.length],
  }));
  return svgPlot({
    title: `Static box: wall pressure vs collisions per particle (N=${rec.particleCount}, seeds ${rec.seeds.join(',')})`,
    xLabel: 'collisions per particle',
    yLabel: 'P / P_elastic (measured)',
    series,
    yMin: 0,
    yMax: 1.1,
  });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  let record: ExperimentRecord;
  const t0 = Date.now();
  if (args.type === 'convergence') {
    const def = CONVERGENCE_STUDIES[args.file];
    if (!def) {
      console.error(`unknown study '${args.file}'. Available: ${Object.keys(CONVERGENCE_STUDIES).join(', ')}`);
      process.exit(1);
    }
    const res = runConvergenceStudy({ ...def, base: { ...def.base, ...args.set } }, (lvl, f) =>
      process.stdout.write(`\r${lvl.padEnd(8)} ${(100 * f).toFixed(0).padStart(3)}%   `),
    );
    process.stdout.write('\n');
    console.log(`\n=== convergence ${args.file}: ${res.status} ===\n${res.verdict}`);
    for (const L of res.levels) {
      console.log(
        `  ${L.name.padEnd(7)} ${JSON.stringify(L.overrides)}  ${res.metricName} = ${L.estimate ? `${fmt(L.estimate.mean)} ± ${fmt(L.estimate.se)} (n=${L.estimate.n})` : 'n/a'}  [run status ${L.status}, ${L.wallSeconds.toFixed(0)} s]`,
      );
    }
    if (res.extrapolation) {
      console.log(`  extrapolation ${res.extrapolation.model}: M∞ = ${fmt(res.extrapolation.infinite)} ± ${fmt(res.extrapolation.seInfinite)}`);
    }
    const stem = args.name || `convergence_${args.file.replace(/\//g, '_')}`;
    writeFileSync(join(args.out, `${stem}.json`), JSON.stringify({ study: args.file, ...res }, null, 1));
    console.log(`written ${join(args.out, `${stem}.json`)}`);
    return;
  }
  if (args.type === 'replay') {
    const saved = JSON.parse(readFileSync(args.file, 'utf8')) as ExperimentRecord;
    console.log(`replaying ${saved.experimentId} (${saved.experimentType}, model ${saved.modelVersion})`);
    record = runFromRecord(saved);
  } else {
    const entry = EXPERIMENTS[args.type as ExperimentType];
    if (!entry) {
      console.error(`unknown experiment '${args.type}'. Available: ${Object.keys(EXPERIMENTS).join(', ')}`);
      process.exit(1);
    }
    const params = { ...(args.quick ? entry.quick : entry.defaults), ...args.set };
    const exp = entry.create(params);
    record = exp.runToCompletion((f, label) => {
      process.stdout.write(`\r${(100 * f).toFixed(0).padStart(3)}%  ${label.padEnd(50)}`);
    });
    process.stdout.write('\n');
  }
  const secs = (Date.now() - t0) / 1000;
  printRecord(record);
  const stem = args.name || record.experimentId;
  const jsonPath = join(args.out, `${stem}.json`);
  writeFileSync(jsonPath, JSON.stringify(record));
  console.log(`\nrecord: ${jsonPath}  (${secs.toFixed(1)} s wall time)`);
  if (record.experimentType === 'static-box') {
    const svg = plotStaticBox(record);
    if (svg) {
      writeFileSync(join(args.out, `${stem}.svg`), svg);
      console.log(`plot:   ${join(args.out, `${stem}.svg`)}`);
    }
  }
}

main();
