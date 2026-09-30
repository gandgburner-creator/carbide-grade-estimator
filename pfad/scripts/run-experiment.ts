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
import { runParallel } from './parallel';
import { svgPlot, type Series } from './svgPlot';

const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a'];

function parseArgs(argv: string[]) {
  const args = { type: argv[0], quick: false, set: {} as Record<string, unknown>, out: 'results', name: '', file: '', parallel: 1 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') args.quick = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--parallel') args.parallel = Number(argv[++i]);
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

function fmt(v: unknown, digits = 5): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(digits);
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
  if (rec.experimentType === 'sound-speed' || rec.experimentType === 'sound-speed-sweeps') printPulse(rec);
  if (rec.experimentType === 'viscosity' || rec.experimentType === 'viscosity-sweeps') printCouette(rec);
  if (rec.experimentType === 'ab-test') printAB(rec);
  if (rec.experimentType === 'boundary-layer') printBL(rec);
  if (rec.experimentType === 'separation') printSeparation(rec);
  if (rec.experimentType === 'kutta') printKutta(rec);
  if (rec.experimentType === 'scaling') printScaling(rec);
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
function printPulse(rec: any): void {
  console.log('\nMEASURED disturbance propagation:');
  rec.results.cases.forEach((c: any, i: number) => {
    if (!c) return console.log(`  case ${i}: no data`);
    const b = rec.benchmarks.perCase[i];
    const refs = [b.hardDiskAdiabatic && `hard-disk ${fmt(b.hardDiskAdiabatic)}`, b.hardDiskPlusOccupancyMeanField && `HD+occ MF ${fmt(b.hardDiskPlusOccupancyMeanField)}`, b.occupancyMeanFieldOnly && `occ MF ${fmt(b.occupancyMeanFieldOnly)}`, `ideal ${fmt(b.idealGas_sqrt2kT_m)}`].filter(Boolean).join(', ');
    console.log(`  ${c.label.padEnd(38)} c_p = ${c.speed ? `${fmt(c.speed.mean)} ± ${fmt(c.speed.se)}` : 'n/a'}  (r² ${fmt(c.track.r2)}, ${c.track.usedSnapshots} snapshots, ${c.seeds} seeds; kT ${fmt(c.kTStart)}→${fmt(c.kTEnd)}; attenuation ${fmt(c.attenuation.value)} ± ${fmt(c.attenuation.se)}/length; width² growth ${fmt(c.widthGrowth.value)})   | benchmarks: ${refs}`);
  });
  for (const cmp of rec.results.comparisonsToFirstCase ?? []) if (cmp) console.log(`  Δ(${cmp.label} − ${cmp.versus}) = ${fmt(cmp.difference)} ± ${fmt(cmp.se)} (z ${fmt(cmp.z)})`);
  if (rec.results.ksCalibration) {
    const k = rec.results.ksCalibration;
    console.log(`  ks calibration: c_p² vs ks φ/m slope ${fmt(k.fit.slope)} ± ${fmt(k.fit.seSlope)}, intercept ${fmt(k.fit.intercept)} ± ${fmt(k.fit.seIntercept)}, through-origin slope ${fmt(k.slopeThroughOrigin)}`);
  }
  for (const c of rec.results.cases) if (c && c.model.dissipationTarget === 'internal') console.log(`  reservoir (${c.label}): E_int/KE at pulse start = ${fmt(c.internalOverKinetic)}, phase-1 settled ${c.equilibrationSettled}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printCouette(rec: any): void {
  const est = (e: any) => (e && Number.isFinite(e.mean) ? `${fmt(e.mean)} ± ${fmt(e.se)}` : 'n/a');
  console.log('\nMEASURED Couette flow:');
  rec.results.cases.forEach((c: any, i: number) => {
    const b = rec.benchmarks.perCase[i];
    console.log(`  ${c.label.padEnd(34)} μ_eff = ${est(c.muEff)} (95% ±${fmt(100 * c.muEff.relHalfWidth, 3)} %)  τ = ${est(c.shearStress)}  γ = ${est(c.gradient)}  slip ${fmt(c.slipBottom.mean, 3)}/${fmt(c.slipTop.mean, 3)}  core kT ${fmt(c.coreKT)}  λ ${fmt(c.meanFreePath, 3)} Kn ${fmt(c.knudsen, 3)}  Re_sim ${fmt(c.reynolds.simulation, 3)}  Mp ${c.mach.Mp === null ? 'n/a' : fmt(c.mach.Mp, 3)}   | benchmark Enskog ${fmt(b.enskogEta)} (ratio ${fmt(b.measuredOverEnskog)})`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printAB(rec: any): void {
  const r = rec.results;
  console.log(`\nA/B on ${r.experiment}: A = ${r.a.label} [${r.a.status}], B = ${r.b.label} [${r.b.status}]`);
  for (const c of r.comparisons) {
    if (c.difference === null) console.log(`  ${c.metric}: not comparable`);
    else console.log(`  ${c.metric}: A ${fmt(c.a.mean)} ± ${fmt(c.a.se, 3)}, B ${fmt(c.b.mean)} ± ${fmt(c.b.se, 3)}; B − A = ${fmt(c.difference)} ± ${fmt(c.se, 3)} (z ${fmt(c.z, 3)}, ${(100 * c.relative).toFixed(2)} %) → ${c.verdict}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printBL(rec: any): void {
  const r = rec.results;
  const est = (e: any, d = 4) => (e && Number.isFinite(e.mean) ? `${fmt(e.mean, d)} ± ${fmt(e.se, 2)}` : 'n/a');
  console.log(`\nDETERMINATION: ${r.determination}`);
  console.log(`free stream (realised): U_e ${fmt(r.freeStream.Ue, 4)}, ρ_e ${fmt(r.freeStream.density, 4)} (stated ${fmt(r.freeStream.statedDensity, 4)}); apparent wall μ ${est(r.apparentWallViscosity)}; growth exponent of δ* ${est(r.growthExponent)}`);
  for (const s of r.stations) {
    console.log(`  ${s.label.padEnd(34)} x=${fmt(s.x, 4)}  U_e ${est(s.Ue)}  wall deficit ${est(s.deficitAtWall)}  δ* ${est(s.displacementThickness)}  θ ${est(s.momentumThickness)}  δ90 ${est(s.delta90)}  τ_w ${est(s.wallShear)}  c_f ${est(s.skinFriction)}`);
  }
  for (const v of r.vonKarman) console.log(`  von Kármán ${v.from} → ${v.to}: dθ/dx ${fmt(v.dThetaDx, 3)} vs τ/(ρU²) − (2θ+δ*)U'/U ${fmt(v.rhs, 3)} (ratio ${fmt(v.ratio, 3)})`);
  console.log(`  Re: ${rec.reynolds.note} → simulation ${fmt(rec.reynolds.simulation, 4)}, effective ${fmt(rec.reynolds.effective, 4)}; Mp ${fmt(rec.mach.Mp, 3)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printSeparation(rec: any): void {
  const r = rec.results;
  console.log(`\nMEASURED separation (${r.generator}):`);
  for (const c of r.configurations) {
    console.log(`  s=${c.strength} [${c.role}] ${c.classification}${c.separated ? ` at x=${fmt(c.onset, 4)}` : ''}; S at onset ${fmt(c.indicatorsAtOnset.slowMomentum, 3)}, H at onset ${fmt(c.indicatorsAtOnset.shapeFactor, 3)}; min S ${fmt(c.minSlowMomentum, 3)}, max H ${fmt(c.maxShapeFactor, 3)}, max reverse fraction ${fmt(c.maxReverseFraction, 3)}, outer deceleration ${fmt(100 * c.outerDeceleration, 3)} %`);
    console.log(`     τ_w(x): ${c.rows.map((w: any) => fmt(w.tau.mean, 2)).join(' ')}`);
  }
  for (const h of r.thresholdHypotheses) {
    console.log(`  hypothesis ${h.indicator}: critical ${h.critical === null ? 'n/a' : fmt(h.critical, 4)} (trained on ${h.trainedOn}); test accuracy ${h.classificationAccuracy ?? 'n/a'}, mean |Δx| ${h.meanAbsPositionError ?? 'n/a'} ${h.note ?? ''}`);
  }
  console.log(`  Re: ${rec.reynolds.note} → simulation ${rec.reynolds.simulation === null ? 'n/a' : fmt(rec.reynolds.simulation, 4)}; Mp ${rec.mach.Mp === null ? 'n/a' : fmt(rec.mach.Mp, 3)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printScaling(rec: any): void {
  const r = rec.results;
  console.log(`\nMEASURED scaling (${r.mode}): ${r.question}`);
  for (const L of r.levels) {
    console.log(`  ${L.name.padEnd(6)} size ${fmt(L.size, 3)} d, U ${fmt(L.speed, 3)}, N ${L.particleCount}, Re ${L.reynolds === null ? 'n/a' : fmt(L.reynolds, 3)}, Mp ${L.mach === null ? 'n/a' : fmt(L.mach, 3)}, status ${L.status}`);
    for (const m of L.metrics) console.log(`         ${m.name}: ${m.mean === null ? 'n/a' : `${fmt(m.mean, 4)} ± ${fmt(m.se, 2)}`}`);
  }
  for (const m of r.perMetric) console.log(`  [${m.status}] ${m.metric}: ${m.verdict}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function printKutta(rec: any): void {
  const est = (e: any, d = 3) => (e ? `${fmt(e.mean, d)} ± ${fmt(e.se, 2)}` : 'n/a');
  console.log(`\nMEASURED (late window, seed ensemble; ${rec.results.conventions})`);
  for (const c of rec.results.cases) {
    if (!c) continue;
    console.log(`  ${c.label}`);
    console.log(`     ${c.determination}`);
    console.log(`     L = ${est(c.lift)}, D = ${est(c.drag)}, Γ_body = ${est(c.gammaBody)}, Γ_domain = ${est(c.gammaDomain)}; late drift ΔL = ${est(c.liftDriftLateHalves)}`);
    console.log(`     departure angle to bisector ${est(c.departure.angleToBisectorDeg)}° (band ±${fmt(c.departure.toleranceDeg, 3)}°), cross-bisector velocity ${est(c.departure.crossVelocity)}, along ${est(c.departure.alongVelocity)}`);
    console.log(`     tail near-wall velocity (downstream +): upper ${est(c.tailVelocity.upper)}, lower ${est(c.tailVelocity.lower)}; TE loading Δp ${c.trailingEdgeLoading ? `${fmt(c.trailingEdgeLoading.deltaP, 3)} ± ${fmt(c.trailingEdgeLoading.se, 2)} (mean loading ${fmt(c.trailingEdgeLoading.meanLoading, 3)})` : 'n/a'}`);
    console.log(`     near-wall reversal: upper ${c.surfaceReversal.upper.reversedBins}/${c.surfaceReversal.upper.bins} bins${c.surfaceReversal.upper.firstReversedAt !== null ? ` from x/c = ${fmt(c.surfaceReversal.upper.firstReversedAt, 3)}` : ''}, lower ${c.surfaceReversal.lower.reversedBins}/${c.surfaceReversal.lower.bins}`);
    console.log(`     early departure (t ≤ ${fmt(c.earlyDeparture.until, 3)}): angle ${est(c.earlyDeparture.angleToBisectorDeg)}°, cross-bisector velocity ${est(c.earlyDeparture.crossVelocity)}`);
    console.log(`     starting vortex (sign ${c.startingVortex.sign}): slab peaks ${c.startingVortex.slabs.map((q: any) => `t=${fmt(q.peakTime, 3)} Γ=${fmt(q.peakCirculation, 3)}${q.significant ? '' : ' (n.s.)'}`).join(', ')}; convection speed ${c.startingVortex.convectionSpeed ? `${fmt(c.startingVortex.convectionSpeed.value, 3)} ± ${fmt(c.startingVortex.convectionSpeed.se, 2)}` : 'n/a'}`);
    console.log(`     shedding: ${c.shedding.seedsWithPeriodicLift}/${c.shedding.perSeed.length} seeds with periodic lift (${c.shedding.criterion})`);
    console.log(`     wake: ${c.wake.map((w: any) => `x−x_TE=${fmt(w.xBehindTE, 3)}: deficit ${fmt(w.maxDeficit, 2)}, width ${fmt(w.halfDeficitWidth, 3)}, D_wake ${fmt(w.momentumDeficitDrag, 3)}`).join('; ')}`);
    console.log(`     realised free stream U_e ${fmt(c.realised.freeStreamU, 3)}, ρ_e ${fmt(c.realised.density, 3)}; occupancy min/mean/max ${fmt(c.occupancy.min, 3)}/${fmt(c.occupancy.mean, 3)}/${fmt(c.occupancy.max, 3)}`);
  }
  console.log(`  Re: ${rec.reynolds.note} → ${rec.reynolds.simulation === null ? 'n/a' : fmt(rec.reynolds.simulation, 4)}; Mp ${rec.mach.Mp === null ? 'n/a' : fmt(rec.mach.Mp, 3)}`);
  console.log('\nBENCHMARK (shown after the measurement; not used by the run):');
  for (const b of rec.benchmarks.perCase ?? []) {
    console.log(`  ${b.label}: thin-airfoil Γ ${fmt(b.thinAirfoilCirculation, 3)}, L ${fmt(b.thinAirfoilLift, 3)}; measured/benchmark Γ ${fmt(b.measuredCirculationOverThinAirfoil, 3)}, L ${fmt(b.measuredLiftOverThinAirfoil, 3)}; Kutta–Joukowski lift from measured Γ ${fmt(b.kuttaJoukowskiLiftFromMeasuredCirculation, 3)}`);
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

async function main(): Promise<void> {
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
    if (args.parallel > 1) {
      record = await runParallel(args.type as ExperimentType, params, args.parallel, (d, n) =>
        process.stdout.write(`\r${d}/${n} runs finished on ${args.parallel} threads   `),
      );
    } else {
      const exp = entry.create(params);
      record = exp.runToCompletion((f, label) => {
        process.stdout.write(`\r${(100 * f).toFixed(0).padStart(3)}%  ${label.padEnd(50)}`);
      });
    }
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
