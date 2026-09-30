import { hendersonCompressibility, maxwellSpeedPdf2D } from '../benchmarks/KineticTheory';
import type { ContactResolution } from '../core/CollisionModel';
import type { TimestepPolicy } from '../core/Integrator';
import type { VelocityDistribution } from '../gas/InitialConditions';
import {
  consistency,
  ensembleEstimate,
  linearRegression,
  mean,
  std,
  type Estimate,
} from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { BoxGasRun, type BoxGasRunParams, type BoxGasRunResult } from './BoxGasRun';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * THERMAL EQUILIBRIUM (Master prompt §11, Bible §23 exp. 3).
 *
 * Three sub-studies on the closed elastic box (specular walls):
 *  temperature  — P measured at several kT (fixed N, φ)
 *  density      — P measured at several φ (fixed kT): the model's own EOS Z(φ)
 *  distribution — relaxation from four initial velocity distributions,
 *                 recorded from t = 0
 * The equation of state is MEASURED, not assumed; classical EOS values appear
 * only in `benchmarks`.
 */
export interface ThermalParams {
  count: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  seeds: number[];
  temperatures: number[];
  areaFractions: number[];
  distributions: VelocityDistribution[];
  equilibrationCollisions: number;
  measurementCollisions: number;
  windowCollisions: number;
  relaxationCollisions: number;
  relaxationWindowCollisions: number;
  maxTime: number;
}

export const THERMAL_REFERENCE: ThermalParams = {
  count: 2000,
  areaFraction: 0.05,
  radius: 0.5,
  mass: 1,
  kT: 1,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  seeds: [21, 22, 23],
  temperatures: [0.5, 1, 2, 4],
  areaFractions: [0.02, 0.05, 0.1, 0.2],
  distributions: ['maxwell', 'uniform-speed', 'uniform-box', 'two-beam'],
  equilibrationCollisions: 10,
  measurementCollisions: 50,
  windowCollisions: 0.25,
  relaxationCollisions: 40,
  relaxationWindowCollisions: 0.1,
  maxTime: 1e7,
};

type Study = 'temperature' | 'density' | 'distribution';
interface Spec {
  study: Study;
  seed: number;
  kT: number;
  areaFraction: number;
  distribution: VelocityDistribution;
}

type ThermalRunResult = BoxGasRunResult & { study: Study; distribution: VelocityDistribution };

/**
 * Model-free relaxation time: the collision count of the last window at which
 * X deviates from its late-time mean by more than 4 late-time standard
 * deviations. `settled` is false if that last excursion is in the late half.
 */
export function relaxationCollisions(c: number[], x: number[]) {
  const half = Math.floor(x.length / 2);
  const late = x.slice(half);
  const xEq = mean(late);
  const sd = std(late);
  let lastOut = -1;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - xEq) > 4 * sd) lastOut = i;
  return {
    equilibriumValue: xEq,
    equilibriumSd: sd,
    initialValue: x[0],
    relaxationCollisions: lastOut >= 0 ? c[lastOut] : 0,
    settled: lastOut < half,
  };
}

/** Kolmogorov–Smirnov distance of reduced speeds to a reference CDF (benchmark use only). */
function ksDistance(samples: number[], cdf: (s: number) => number) {
  const s = [...samples].sort((a, b) => a - b);
  const n = s.length;
  let D = 0;
  for (let i = 0; i < n; i++) {
    const F = cdf(s[i]);
    D = Math.max(D, Math.abs((i + 1) / n - F), Math.abs(F - i / n));
  }
  // asymptotic Kolmogorov p-value
  const lam = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * D;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lam * lam);
  return { D, n, pValue: Math.min(1, Math.max(0, p)) };
}

export class ThermalExperiment extends SequentialExperiment<Spec, ThermalRunResult> {
  readonly type = 'thermal' as const;
  readonly params: ThermalParams;

  constructor(p: ThermalParams) {
    const specs: Spec[] = [];
    for (const seed of p.seeds) {
      for (const kT of p.temperatures) {
        specs.push({ study: 'temperature', seed, kT, areaFraction: p.areaFraction, distribution: 'maxwell' });
      }
      for (const areaFraction of p.areaFractions) {
        specs.push({ study: 'density', seed, kT: p.kT, areaFraction, distribution: 'maxwell' });
      }
      for (const distribution of p.distributions) {
        specs.push({ study: 'distribution', seed, kT: p.kT, areaFraction: p.areaFraction, distribution });
      }
    }
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<ThermalRunResult> {
    const p = this.params;
    const relax = spec.study === 'distribution';
    const rp: BoxGasRunParams = {
      count: p.count,
      areaFraction: spec.areaFraction,
      radius: p.radius,
      mass: p.mass,
      kT: spec.kT,
      distribution: spec.distribution,
      restitution: 1,
      dissipationTarget: 'external',
      contact: p.contact,
      timestep: p.timestep,
      seed: spec.seed,
      equilibrationCollisions: relax ? 0 : p.equilibrationCollisions,
      measurementCollisions: relax ? p.relaxationCollisions : p.measurementCollisions,
      windowCollisions: relax ? p.relaxationWindowCollisions : p.windowCollisions,
      maxTime: p.maxTime,
      recordFromStart: relax,
      velocityStats: true,
      keepFinalSpeeds: relax,
      analysisFromCollisions: relax ? p.relaxationCollisions / 2 : 0,
      label: `thermal ${spec.study}: kT=${spec.kT} φ=${spec.areaFraction} ${spec.distribution} seed=${spec.seed}`,
    };
    const run = new BoxGasRun(rp);
    const wrapped: Run<ThermalRunResult> = {
      label: run.label,
      sim: run.sim,
      get done() {
        return run.done;
      },
      advance: (n) => run.advance(n),
      progress: () => run.progress(),
      live: () => run.live(),
      result: () => ({ ...run.result(), study: spec.study, distribution: spec.distribution }),
    };
    return wrapped;
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const results: Record<string, unknown> = {};
    const benchmarks: Record<string, unknown> = {};
    const uncertainty: Record<string, unknown> = {};

    const Z = (r: ThermalRunResult) => {
      const e = r.equilibrium!;
      const nkT = r.geometry.numberDensity * e.kTMean;
      return { mean: e.pressure.mean / nkT, se: e.pressure.se / nkT };
    };
    const group = <K extends string | number>(rs: ThermalRunResult[], key: (r: ThermalRunResult) => K) => {
      const m = new Map<K, ThermalRunResult[]>();
      for (const r of rs) {
        const k = key(r);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(r);
      }
      return m;
    };
    const zEnsemble = (rs: ThermalRunResult[]): Estimate => ensembleEstimate(rs.map((r) => Z(r).mean));

    // ---- safety / conservation
    const halted = runs.filter((r) => r.halted);
    checks.push(
      check('numerical-safety', 'No run halted by the safety monitor', 'zero failures',
        halted.length ? halted.map((r) => r.label).join('; ') : 'none', halted.length === 0),
    );
    const maxE = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    checks.push(check('energy-conservation', 'Elastic runs conserve energy', 'max |relative residual| < 1e-9',
      maxE.toExponential(2), maxE < 1e-9));
    const missing = runs.filter((r) => !r.equilibrium);
    if (missing.length) warnings.push(`${missing.length} run(s) had too few windows for equilibrium averages`);
    const ok = runs.filter((r) => r.equilibrium);

    // ---- temperature study
    const tRuns = ok.filter((r) => r.study === 'temperature');
    if (tRuns.length) {
      const byT = group(tRuns, (r) => r.params.kT);
      const table = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([kT, rs]) => ({
        kT,
        pressure: ensembleEstimate(rs.map((r) => r.equilibrium!.pressure.mean)),
        dimensionlessPressure: zEnsemble(rs),
        seeds: rs.length,
      }));
      const x = tRuns.map((r) => r.equilibrium!.kTMean);
      const y = tRuns.map((r) => r.equilibrium!.pressure.mean);
      const reg = linearRegression(x, y);
      const cons = consistency(table.map((t) => t.dimensionlessPressure.mean), table.map((t) => t.dimensionlessPressure.se));
      results.temperatureDependence = {
        table,
        fit: { model: 'P = a + b·kT (per-run means)', ...reg },
        zConsistencyAcrossTemperatures: cons,
      };
      // Rigid disks have no energy scale: with an adaptive (C·d/v_max) timestep a run at
      // kT' is the kT run in rescaled time, so same-seed Z values must agree exactly.
      const bySeed = group(tRuns, (r) => r.seed);
      let maxSeedSpread = 0;
      for (const rs of bySeed.values()) {
        const zs = rs.map((r) => Z(r).mean);
        maxSeedSpread = Math.max(maxSeedSpread, (Math.max(...zs) - Math.min(...zs)) / mean(zs));
      }
      const adaptive = p.timestep.kind === 'adaptive';
      (results.temperatureDependence as Record<string, unknown>).sameSeedRelativeSpread = maxSeedSpread;
      (results.temperatureDependence as Record<string, unknown>).interpretation = adaptive
        ? 'Rigid-contact model: kT is not an independent parameter (time-rescaling symmetry). Same-seed runs at different kT are the same trajectory in rescaled time, so P ∝ kT holds exactly; this sub-study tests for hidden energy scales, not for thermal physics. Non-trivial temperature dependence needs a model with an energy scale (soft contact K, occupancy ks, wall temperature).'
        : 'Fixed dt introduces a numerical time scale, so same-seed runs at different kT differ.';
      if (adaptive && bySeed.size > 0 && [...bySeed.values()].some((rs) => rs.length > 1)) {
        checks.push(check('no-hidden-energy-scale',
          'Same-seed runs at different kT give identical P/(nkT) (exact time-rescaling symmetry of rigid disks)',
          'relative spread < 1e-9', maxSeedSpread.toExponential(2), maxSeedSpread < 1e-9));
      }
      const interceptOk = Math.abs(reg.intercept) < 3 * reg.seIntercept;
      checks.push(check('temperature-scaling', 'Pressure scales linearly with kT through the origin, with the same P/(nkT) at every temperature',
        'fit intercept within 3σ of 0 and χ² consistency of P/(nkT) across kT with p > 0.001',
        `intercept ${reg.intercept.toExponential(2)} ± ${reg.seIntercept.toExponential(2)}, p = ${cons.pValue.toPrecision(3)}`,
        interceptOk && cons.pValue > 0.001));
    }

    // ---- density study
    const dRuns = ok.filter((r) => r.study === 'density');
    if (dRuns.length) {
      const byPhi = group(dRuns, (r) => r.params.areaFraction);
      const table = [...byPhi.entries()].sort((a, b) => a[0] - b[0]).map(([phi, rs]) => ({
        areaFraction: phi,
        dimensionlessPressure: zEnsemble(rs),
        seeds: rs.length,
      }));
      // measured "virial-like" coefficients: Z − 1 = B φ + C φ² (unweighted per-run LS)
      const phis = dRuns.map((r) => r.geometry.areaFraction);
      const zs = dRuns.map((r) => Z(r).mean);
      // fit (Z−1)/φ = B + C φ
      const reg = linearRegression(phis, zs.map((z, i) => (z - 1) / phis[i]));
      results.densityDependence = {
        definition: 'Z = P·A/(N·kT), measured',
        table,
        fit: { model: '(Z − 1)/φ = B + C·φ', B: reg.intercept, seB: reg.seIntercept, C: reg.slope, seC: reg.seSlope, r2: reg.r2 },
      };
      const worst = Math.max(...table.map((t) => t.dimensionlessPressure.relHalfWidth));
      checks.push(check('eos-precision', 'Measured Z(φ) at every density is precise enough to compare',
        '95 % CI half-width < 2 % at every φ', `worst ${(100 * worst).toFixed(2)} %`, worst < 0.02, 'INCONCLUSIVE'));
      benchmarks.equationOfState = {
        note: 'Comparison only. Hard-disk Henderson EOS; ideal gas has Z = 1 at every φ.',
        points: table.map((t) => ({
          areaFraction: t.areaFraction,
          measuredZ: t.dimensionlessPressure.mean,
          hendersonZ: hendersonCompressibility(t.areaFraction),
          measuredOverHenderson: t.dimensionlessPressure.mean / hendersonCompressibility(t.areaFraction),
          idealZ: 1,
        })),
        secondVirialB_hardDisks: 2,
        measuredB: reg.intercept,
      };
    }

    // ---- distribution study
    const xRuns = runs.filter((r) => r.study === 'distribution');
    if (xRuns.length) {
      const byD = group(xRuns, (r) => r.distribution);
      const rows = [...byD.entries()].map(([dist, rs]) => {
        const relaxA2 = rs.map((r) => relaxationCollisions(r.series.c, r.series.a2!));
        const relaxAn = rs.map((r) => relaxationCollisions(r.series.c, r.series.anisotropy!));
        const withEq = rs.filter((r) => r.equilibrium);
        return {
          distribution: dist,
          seeds: rs.length,
          initial: { a2: mean(relaxA2.map((x) => x.initialValue)), anisotropy: mean(relaxAn.map((x) => x.initialValue)) },
          relaxationCollisions_a2: ensembleEstimate(relaxA2.map((x) => x.relaxationCollisions)),
          relaxationCollisions_anisotropy: ensembleEstimate(relaxAn.map((x) => x.relaxationCollisions)),
          equilibrium_a2: ensembleEstimate(relaxA2.map((x) => x.equilibriumValue)),
          equilibrium_kurtosis: ensembleEstimate(rs.map((r) => mean(r.series.kurtosis!.slice(Math.floor(r.series.kurtosis!.length / 2))))),
          settled: relaxA2.every((x) => x.settled) && relaxAn.every((x) => x.settled),
          equilibriumZ: withEq.length ? zEnsemble(withEq) : null,
        };
      });
      results.distributionDependence = {
        note: 'Relaxation measured as the last window deviating > 4σ from the late-time mean (model-free).',
        rows,
        curves: xRuns.map((r) => ({ distribution: r.distribution, seed: r.seed, c: r.series.c, a2: r.series.a2, anisotropy: r.series.anisotropy, kurtosis: r.series.kurtosis })),
      };
      const zRows = rows.filter((r) => r.equilibriumZ);
      if (zRows.length >= 2) {
        const cz = consistency(zRows.map((r) => r.equilibriumZ!.mean), zRows.map((r) => r.equilibriumZ!.se));
        const ca = consistency(rows.map((r) => r.equilibrium_a2.mean), rows.map((r) => r.equilibrium_a2.se));
        checks.push(check('equilibrium-independent-of-initial-distribution',
          'Every initial distribution reaches the same equilibrium pressure and velocity-distribution shape',
          'χ² consistency p > 0.001 for P/(nkT) and for late-time a2 across distributions',
          `p(Z) = ${cz.pValue.toPrecision(3)}, p(a2) = ${ca.pValue.toPrecision(3)}`,
          cz.pValue > 0.001 && ca.pValue > 0.001));
      }
      const unsettled = rows.filter((r) => !r.settled);
      checks.push(check('relaxation-settled', 'Relaxation completes within the recorded time',
        'last > 4σ excursion in the first half of every run', unsettled.length ? unsettled.map((r) => r.distribution).join(', ') : 'all settled',
        unsettled.length === 0, 'NOT CONVERGED'));

      // benchmark: final speeds vs 2D Maxwellian (Rayleigh)
      const ks = [...byD.entries()].map(([dist, rs]) => {
        const speeds = rs.flatMap((r) => r.finalSpeeds ?? []);
        return { distribution: dist, ...ksDistance(speeds, (s) => 1 - Math.exp((-s * s) / 2)) };
      });
      benchmarks.velocityDistribution = {
        note: 'Comparison only: 2D Maxwell–Boltzmann has component kurtosis 3, a2 = 0, reduced-speed CDF 1 − exp(−s²/2).',
        maxwellianKurtosis: 3,
        maxwellianA2: 0,
        ksAgainstRayleigh: ks,
        rayleighPdfAtPeak: maxwellSpeedPdf2D(1, 1, 1),
      };
    }

    uncertainty.note = 'Ensemble over seeds for every tabulated estimate; per-run pressures are block-averaged.';
    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`${r.label}: [${f.severity}] ${f.code} ${f.message}`);
    const duration = runs.reduce((a, r) => ({ time: a.time + r.totals.time, steps: a.steps + r.totals.steps, collisionsPerParticle: a.collisionsPerParticle + r.totals.collisionsPerParticle }), { time: 0, steps: 0, collisionsPerParticle: 0 });
    return {
      ...recordHeader('thermal', 'Thermal equilibrium: temperature, density and initial-distribution dependence', p.seeds),
      particleCount: p.count,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: Number.NaN, massDensity: Number.NaN, areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: 'kT = peculiar KE/N (A-03)' },
      speed: null,
      geometry: 'closed square box (side set by N and φ)',
      wallModel: 'planar walls, specular (Aw = 0)',
      accommodation: 0,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: 0, ymin: 0, ymax: 0, periodicX: false, periodicY: false },
      duration,
      reynolds: { simulation: null, effective: null, physical: null, note: 'No mean flow.' },
      mach: { Mp: 0, benchmark: null, note: 'No mean flow.' },
      results,
      uncertainty,
      convergence: { status: 'NOT ASSESSED', note: 'See static-box convergence studies for the same engine.' },
      benchmarks,
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-08', 'A-09', 'A-10'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
