import {
  collisionWeightedVn2,
  enskogCollisionFrequency2D,
  haffHalvingCollisions,
  hardDiskPressure2D,
  hendersonCompressibility,
  idealGasPressure2D,
} from '../benchmarks/KineticTheory';
import type { ContactResolution } from '../core/CollisionModel';
import type { TimestepPolicy } from '../core/Integrator';
import type { VelocityDistribution } from '../gas/InitialConditions';
import {
  consistency,
  ensembleEstimate,
  isotonicNonIncreasing,
  linearRegression,
  type Estimate,
} from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { BoxGasRun, type BoxGasRunParams, type BoxGasRunResult } from './BoxGasRun';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * STATIC BOX (Bible §8, Master prompt §9–10).
 *
 * A closed square box of hard disks with specular walls (Aw = 0), no occupancy
 * force, no external force. Pressure is measured ONLY from wall impulses.
 *
 * e = 1 runs: equilibrate for `equilibrationCollisions` per particle, then
 *   measure for `measurementCollisions` per particle.
 * e < 1 runs: start from the same initial condition (same seed) and record the
 *   pressure from t = 0 until the kinetic energy has fallen below
 *   `decayStopKineticFraction` of its initial value or `decayMaxCollisions` is
 *   reached. The decay is normalised by the elastic pressure measured for the
 *   same seed. No decay value is assumed anywhere; the experiment finds it.
 */
export interface StaticBoxParams {
  count: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  restitutions: number[];
  seeds: number[];
  distribution: VelocityDistribution;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  equilibrationCollisions: number;
  measurementCollisions: number;
  decayMaxCollisions: number;
  decayStopKineticFraction: number;
  /** pressure sampling window, in collisions per particle */
  windowCollisions: number;
  /** safety stop on simulated time */
  maxTime: number;
  gridCellSize?: number;
}

/** The reference configuration reported in Bible §8. */
export const STATIC_BOX_REFERENCE: StaticBoxParams = {
  count: 2000,
  areaFraction: 0.05,
  radius: 0.5,
  mass: 1,
  kT: 1,
  restitutions: [1, 0.99, 0.9],
  seeds: [7],
  distribution: 'maxwell',
  contact: 'rewind-to-contact',
  // courant 0.025: at 0.05 the pre-registered late-contact criterion (< 1e-3) failed
  // (1.2e-3, all explained by within-step event ordering) — docs/MODEL_CHANGELOG.md
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  equilibrationCollisions: 10,
  measurementCollisions: 100,
  decayMaxCollisions: 300,
  decayStopKineticFraction: 0.02,
  windowCollisions: 0.25,
  maxTime: 1e7,
};

interface Spec {
  restitution: number;
  seed: number;
}

export type StaticBoxRunResult = BoxGasRunResult;

/** Map the static-box parameters onto one closed-box run. */
export function staticBoxRunParams(p: StaticBoxParams, spec: Spec): BoxGasRunParams {
  const elastic = spec.restitution === 1;
  return {
    count: p.count,
    areaFraction: p.areaFraction,
    radius: p.radius,
    mass: p.mass,
    kT: p.kT,
    distribution: p.distribution,
    restitution: spec.restitution,
    dissipationTarget: 'external',
    contact: p.contact,
    timestep: p.timestep,
    seed: spec.seed,
    equilibrationCollisions: elastic ? p.equilibrationCollisions : 0,
    measurementCollisions: elastic ? p.measurementCollisions : p.decayMaxCollisions,
    stopKineticFraction: elastic ? undefined : p.decayStopKineticFraction,
    windowCollisions: p.windowCollisions,
    maxTime: p.maxTime,
    gridCellSize: p.gridCellSize,
    label: `static box e=${spec.restitution} seed=${spec.seed}`,
  };
}

/** Per-seed decay analysis of an inelastic run. */
export interface DecayAnalysis {
  seed: number;
  restitution: number;
  referencePressure: number;
  referenceSource: 'elastic run, same seed' | 'first window (fallback)';
  /**
   * c where P/P_ref falls below 1/2, located on the isotonic (non-increasing)
   * regression of the windowed pressure, weighted by window duration.
   * Assumes only that the expected pressure of a closed, freely cooling gas
   * does not increase. Linear interpolation between window ends.
   */
  cHalfPressure: number | null;
  /** c where kT/kT_0 first falls below 1/2 (kT is exact from KE) */
  cHalfTemperature: number | null;
  /** fit ln(P/P_ref) = a − k·c over 0.15 < P/P_ref ≤ 1 */
  fit: { k: number; seK: number; intercept: number; r2: number; cHalf: number; points: number } | null;
  finalKineticFraction: number;
  totalCollisionsPerParticle: number;
}

function firstCrossing(c: number[], y: number[], level: number): number | null {
  for (let i = 1; i < y.length; i++) {
    if (y[i] < level && y[i - 1] >= level) {
      const f = (y[i - 1] - level) / (y[i - 1] - y[i]);
      return c[i - 1] + f * (c[i] - c[i - 1]);
    }
    if (i === 1 && y[0] < level) return c[0];
  }
  return null;
}

export function analyseDecay(run: StaticBoxRunResult, elasticRef: StaticBoxRunResult | undefined): DecayAnalysis {
  const { c, pressure, kT } = run.series;
  let Pref: number;
  let source: DecayAnalysis['referenceSource'];
  if (elasticRef?.equilibrium) {
    Pref = elasticRef.equilibrium.pressure.mean;
    source = 'elastic run, same seed';
  } else {
    Pref = pressure[0];
    source = 'first window (fallback)';
  }
  const y = pressure.map((p) => p / Pref);
  const cHalfPressure = firstCrossing(c, isotonicNonIncreasing(y, run.series.duration), 0.5);
  const kT0 = run.kTInitial;
  const cHalfTemperature = firstCrossing(
    [0, ...c],
    [1, ...kT.map((v) => v / kT0)],
    0.5,
  );
  const fx: number[] = [];
  const fy: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (y[i] > 0.15 && y[i] <= 1.2 && c[i] > 0) {
      fx.push(c[i]);
      fy.push(Math.log(y[i]));
    }
  }
  let fit: DecayAnalysis['fit'] = null;
  if (fx.length >= 8) {
    const r = linearRegression(fx, fy);
    fit = {
      k: -r.slope,
      seK: r.seSlope,
      intercept: r.intercept,
      r2: r.r2,
      cHalf: (r.intercept - Math.log(0.5)) / -r.slope,
      points: fx.length,
    };
  }
  return {
    seed: run.seed,
    restitution: run.restitution,
    referencePressure: Pref,
    referenceSource: source,
    cHalfPressure,
    cHalfTemperature,
    fit,
    finalKineticFraction: kT.length > 0 ? kT[kT.length - 1] / kT0 : Number.NaN,
    totalCollisionsPerParticle: run.totals.collisionsPerParticle,
  };
}

/**
 * P/P_ref averaged in bins of collisions per particle (time-weighted within a
 * run, then averaged across seeds). A bin whose covered collision range is
 * less than half the bin width (the ragged end of a run) is dropped and
 * counted in `droppedPartialBins`, because a bin holding one or two windows is
 * far noisier than its neighbours.
 */
export function pressureCurve(runs: StaticBoxRunResult[], refs: Map<number, number>, binWidth: number) {
  const bins = new Map<number, number[]>();
  let droppedPartialBins = 0;
  for (const r of runs) {
    const Pref = refs.get(r.seed);
    if (!Pref) continue;
    const start = r.measurementStartCollisions;
    const acc = new Map<number, { w: number; s: number; cover: number }>();
    let prevC = start;
    for (let i = 0; i < r.series.c.length; i++) {
      const b = Math.floor((r.series.c[i] - start) / binWidth);
      const a = acc.get(b) ?? { w: 0, s: 0, cover: 0 };
      a.w += r.series.duration[i];
      a.s += r.series.pressure[i] * r.series.duration[i];
      a.cover += r.series.c[i] - prevC;
      prevC = r.series.c[i];
      acc.set(b, a);
    }
    for (const [b, a] of acc) {
      if (a.cover < 0.5 * binWidth) {
        droppedPartialBins++;
        continue;
      }
      if (!bins.has(b)) bins.set(b, []);
      bins.get(b)!.push(a.s / a.w / Pref);
    }
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const points = keys.map((b) => {
    const v = bins.get(b)!;
    const m = v.reduce((x, y) => x + y, 0) / v.length;
    const sd = v.length > 1 ? Math.sqrt(v.reduce((x, y) => x + (y - m) ** 2, 0) / (v.length - 1)) : Number.NaN;
    return { c: (b + 0.5) * binWidth, pOverPref: m, se: sd / Math.sqrt(v.length), seeds: v.length };
  });
  return { binWidth, droppedPartialBins, points };
}

export class StaticBoxExperiment extends SequentialExperiment<Spec, StaticBoxRunResult> {
  readonly type = 'static-box' as const;
  readonly params: StaticBoxParams;

  constructor(params: StaticBoxParams) {
    // elastic runs first, so every inelastic run has its same-seed reference
    const rs = [...params.restitutions].sort((a, b) => b - a);
    const specs: Spec[] = [];
    for (const restitution of rs) for (const seed of params.seeds) specs.push({ restitution, seed });
    super(specs);
    this.params = params;
  }

  protected createRun(spec: Spec): Run<StaticBoxRunResult> {
    return new BoxGasRun(staticBoxRunParams(this.params, spec));
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results;
    const elasticRuns = runs.filter((r) => r.restitution === 1);
    const inelasticRuns = runs.filter((r) => r.restitution < 1);
    const g = runs[0]?.geometry;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const results: Record<string, unknown> = {};
    const uncertainty: Record<string, unknown> = {};
    const benchmarks: Record<string, unknown> = {};

    // ---------- numerical safety (all runs)
    const halted = runs.filter((r) => r.halted);
    checks.push(
      check(
        'numerical-safety',
        'No run was halted by the numerical-safety monitor',
        'zero safety failures',
        halted.length === 0 ? 'none' : halted.map((r) => `${r.label}: ${r.stopReason}`).join('; '),
        halted.length === 0,
      ),
    );
    const maxERes = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxPRes = Math.max(...runs.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(
      check(
        'energy-accounting',
        'Energy ledger closes (elastic: KE conserved; inelastic: KE + dissipated = E0)',
        'max |relative residual| < 1e-9',
        maxERes.toExponential(2),
        maxERes < 1e-9,
      ),
    );
    checks.push(
      check(
        'momentum-accounting',
        'Gas momentum change equals impulse received from walls',
        'max relative residual < 1e-9',
        maxPRes.toExponential(2),
        maxPRes < 1e-9,
      ),
    );
    const totalColl = runs.reduce((a, r) => a + r.collisions.count, 0);
    const late = runs.reduce((a, r) => a + r.collisions.lateContacts, 0);
    const maxOv = Math.max(...runs.map((r) => r.collisions.maxOverlapFraction));
    checks.push(
      check(
        'timestep-quality',
        'Contacts are resolved within the step they occur in, with small overlap',
        'late-contact fraction < 1e-3 and max overlap < 25 % of contact distance',
        `late fraction ${(late / Math.max(1, totalColl)).toExponential(2)}, max overlap ${(100 * maxOv).toFixed(2)} %`,
        late / Math.max(1, totalColl) < 1e-3 && maxOv < 0.25,
        'INCONCLUSIVE',
      ),
    );

    // ---------- elastic pressure
    if (elasticRuns.length > 0) {
      const perSeed = elasticRuns.filter((r) => r.equilibrium).map((r) => ({
        seed: r.seed,
        pressure: r.equilibrium!.pressure,
        walls: r.equilibrium!.walls.map((w) => ({ mean: w.mean, se: w.se })),
        isotropyP: r.equilibrium!.isotropy.pValue,
        stationarityZ: r.equilibrium!.stationarity.z,
        kT: r.equilibrium!.kTMean,
        collisionRatePerParticle: r.equilibrium!.collisionRatePerParticle,
        collisionsPerParticleMeasured: r.totals.collisionsPerParticle - r.measurementStartCollisions,
        emptySpace: r.emptySpace,
      }));
      const P =
        perSeed.length >= 2 ? ensembleEstimate(perSeed.map((s) => s.pressure.mean)) : perSeed[0]?.pressure;
      const kT = perSeed.reduce((a, s) => a + s.kT, 0) / perSeed.length;
      // dimensionless pressure: P in units of n·kT (n = N/A_box, kT = KE/N measured) — a normalisation only
      const nkT = g ? (p.count / g.area) * kT : Number.NaN;
      const scaleEst = (e: Estimate): Estimate => ({
        ...e,
        mean: e.mean / nkT,
        se: e.se / nkT,
        sd: e.sd / nkT,
        ci95: [e.ci95[0] / nkT, e.ci95[1] / nkT],
      });
      results.elastic = {
        measuredPressure: P,
        dimensionlessPressure: P ? scaleEst(P) : null,
        dimensionlessPressureDefinition: 'P · A_box / (N · kT), with kT = KE/N measured',
        perSeed,
        kTMean: kT,
        definition: 'P = Σ normal wall impulse / (Δt · wall length), all four walls',
      };
      uncertainty.elasticPressure = P
        ? {
            method: P.method,
            se: P.se,
            ci95: P.ci95,
            relHalfWidth: P.relHalfWidth,
            independentSamples: P.nIndependent,
            highUncertainty: P.relHalfWidth > 0.02,
          }
        : null;
      if (P) {
        checks.push(
          check(
            'pressure-precision',
            'Wall pressure measured with adequate statistical precision',
            '95 % CI half-width < 2 % of the mean',
            `${(100 * P.relHalfWidth).toFixed(2)} % (${P.nIndependent.toFixed(0)} independent samples)`,
            P.relHalfWidth < 0.02,
            'INCONCLUSIVE',
          ),
        );
        // The uncertainty that is REPORTED must be valid. With ≥ 3 seeds it comes from the
        // spread of independent seeds (valid without block-averaging assumptions); with
        // fewer it comes from block averaging, which is only trustworthy on a plateau.
        const plateaus = elasticRuns.filter((r) => r.equilibrium?.pressure.reliable).length;
        const ensembleBased = perSeed.length >= 3;
        checks.push(
          check(
            'uncertainty-reliable',
            'The reported pressure uncertainty is statistically valid',
            'ensemble of ≥ 3 independent seeds, or block-averaging plateau in every run',
            `${ensembleBased ? `ensemble of ${perSeed.length} seeds` : 'block averaging'}; plateau in ${plateaus}/${elasticRuns.length} runs`,
            ensembleBased || plateaus === elasticRuns.length,
            'INCONCLUSIVE',
          ),
        );
      }
      const minIso = Math.min(...perSeed.map((s) => s.isotropyP));
      checks.push(
        check(
          'isotropy',
          'All four walls measure the same pressure',
          'χ² consistency p > 0.001 in every run',
          `min p = ${minIso.toPrecision(3)}`,
          minIso > 0.001,
        ),
      );
      const maxZ = Math.max(...perSeed.map((s) => Math.abs(s.stationarityZ)));
      checks.push(
        check(
          'stationarity',
          'Pressure in the first and second half of the measurement agree',
          '|z| < 3 in every run',
          `max |z| = ${maxZ.toFixed(2)}`,
          maxZ < 3,
          'NOT CONVERGED',
        ),
      );
      if (perSeed.length >= 2) {
        const cons = consistency(
          perSeed.map((s) => s.pressure.mean),
          perSeed.map((s) => s.pressure.se),
        );
        checks.push(
          check(
            'seed-consistency',
            'Different seeds give statistically consistent pressures',
            'χ² p > 0.001',
            `p = ${cons.pValue.toPrecision(3)}`,
            cons.pValue > 0.001,
          ),
        );
      }
      const elasticEmpty = perSeed.filter((s) => s.emptySpace.flag);
      checks.push(
        check(
          'no-empty-space',
          'No sustained near-zero-occupancy region in the elastic gas',
          'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
          elasticEmpty.length === 0 ? 'none' : `${elasticEmpty.length} run(s) flagged`,
          elasticEmpty.length === 0,
        ),
      );

      // ---------- benchmarks (comparison only)
      if (P && g) {
        const Pideal = idealGasPressure2D(p.count, kT, g.area);
        const PidealAcc = idealGasPressure2D(p.count, kT, g.accessibleArea);
        const Phd = hardDiskPressure2D(p.count, kT, g.area, g.areaFraction);
        const ratio = (ref: number) => ({
          benchmark: ref,
          measuredOverBenchmark: P.mean / ref,
          ci95: [P.ci95[0] / ref, P.ci95[1] / ref],
          agreesWithin95: P.ci95[0] <= ref && ref <= P.ci95[1],
        });
        benchmarks.pressure = {
          note: 'Classical references for comparison only; none of these entered the simulation.',
          idealGas_NkT_over_A: { ...ratio(Pideal), formula: 'N kT / A_box' },
          idealGas_accessibleArea: { ...ratio(PidealAcc), formula: 'N kT / (L − d)²  (centre-accessible area)' },
          hardDiskHenderson: {
            ...ratio(Phd),
            formula: 'N kT / A_box · (1 + φ²/8)/(1 − φ)²',
            Z: hendersonCompressibility(g.areaFraction),
          },
        };
        const omega = enskogCollisionFrequency2D(g.numberDensity, 2 * p.radius, kT, p.mass, g.areaFraction);
        const measOmega = perSeed.reduce((a, s) => a + s.collisionRatePerParticle, 0) / perSeed.length;
        benchmarks.collisionFrequency = {
          enskog: omega,
          measured: measOmega,
          measuredOverBenchmark: measOmega / omega,
          formula: '2 σ n g(σ) sqrt(π kT/m), g(σ) from Henderson EOS',
        };
        const vn2 = elasticRuns.reduce((a, r) => a + r.collisions.meanVn2, 0) / elasticRuns.length;
        benchmarks.collisionWeightedVn2 = {
          benchmark: collisionWeightedVn2(kT, p.mass),
          measured: vn2,
          measuredOverBenchmark: vn2 / collisionWeightedVn2(kT, p.mass),
        };
      }
    }

    // ---------- inelastic decay
    if (inelasticRuns.length > 0) {
      const refBySeed = new Map<number, StaticBoxRunResult>();
      for (const r of elasticRuns) refBySeed.set(r.seed, r);
      const byE = new Map<number, DecayAnalysis[]>();
      for (const r of inelasticRuns) {
        const d = analyseDecay(r, refBySeed.get(r.seed));
        if (d.referenceSource !== 'elastic run, same seed') {
          warnings.push(`e=${r.restitution} seed=${r.seed}: no elastic reference; normalised by first window`);
        }
        if (!byE.has(r.restitution)) byE.set(r.restitution, []);
        byE.get(r.restitution)!.push(d);
      }
      const decay: Record<string, unknown> = {};
      const decayBench: Record<string, unknown> = {};
      for (const [e, list] of byE) {
        const est = (xs: (number | null | undefined)[]) => {
          const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
          return v.length === 0 ? null : v.length === 1 ? { mean: v[0], n: 1, note: 'single seed: no ensemble uncertainty' } : ensembleEstimate(v);
        };
        const cHalfP = est(list.map((d) => d.cHalfPressure));
        const cHalfT = est(list.map((d) => d.cHalfTemperature));
        const k = est(list.map((d) => d.fit?.k));
        decay[`e=${e}`] = {
          perSeed: list,
          collisionsPerParticleToHalvePressure: cHalfP,
          collisionsPerParticleToHalveKT: cHalfT,
          logPressureDecayRatePerCollision: k,
        };
        const bench = haffHalvingCollisions(e);
        const meanOf = (x: { mean: number } | null) => (x ? x.mean : Number.NaN);
        decayBench[`e=${e}`] = {
          haffHomogeneousCooling_cHalf: bench,
          formula: '2 ln 2 / (1 − e²)  (homogeneous, Maxwellian, 2D)',
          measuredPressure_over_benchmark: meanOf(cHalfP) / bench,
          measuredKT_over_benchmark: meanOf(cHalfT) / bench,
          haffRate: (1 - e * e) / 2,
        };
        const flagged = inelasticRuns.filter((r) => r.restitution === e && r.emptySpace.flag);
        if (flagged.length > 0) {
          warnings.push(
            `e=${e}: POTENTIAL MODEL / NUMERICAL FAILURE — sustained near-zero occupancy (inelastic clustering) in ${flagged.length} run(s). Reported, not suppressed.`,
          );
        }
      }
      results.inelasticDecay = decay;
      benchmarks.inelasticDecay = decayBench;
    }

    // ---------- pressure vs collisions per particle (plot data)
    const refs = new Map<number, number>();
    for (const r of elasticRuns) if (r.equilibrium) refs.set(r.seed, r.equilibrium.pressure.mean);
    const curves: Record<string, unknown> = {};
    for (const e of [...new Set(runs.map((r) => r.restitution))]) {
      curves[`e=${e}`] = pressureCurve(
        runs.filter((r) => r.restitution === e),
        refs,
        e === 1 ? 5 : 1,
      );
    }
    results.pressureVsCollisions = {
      note: 'P/P_ref vs collisions per particle since measurement start; P_ref = elastic pressure, same seed',
      curves,
    };
    results.runs = runs.map((r) => ({
      label: r.label,
      stopReason: r.stopReason,
      totals: r.totals,
      dt: r.dt,
      conservation: r.conservation,
      collisions: r.collisions,
      emptySpace: r.emptySpace,
      series: r.series,
    }));
    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`${r.label}: [${f.severity}] ${f.code} ${f.message}`);

    const status = combineStatus(checks);
    const duration = runs.reduce(
      (a, r) => ({
        time: a.time + r.totals.time,
        steps: a.steps + r.totals.steps,
        collisionsPerParticle: a.collisionsPerParticle + r.totals.collisionsPerParticle,
      }),
      { time: 0, steps: 0, collisionsPerParticle: 0 },
    );
    const L = g?.side ?? 0;
    return {
      ...recordHeader('static-box', 'Static box: pressure from wall impulses', p.seeds),
      particleCount: p.count,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: {
        numberDensity: g?.numberDensity ?? Number.NaN,
        massDensity: (g?.numberDensity ?? Number.NaN) * p.mass,
        areaFraction: g?.areaFraction ?? Number.NaN,
      },
      temperature: { kT: p.kT, definition: 'kT = KE/N (2D, 2 translational DOF per particle; A-03)' },
      speed: null,
      geometry: `closed square box, side L = ${L.toPrecision(6)} (model units)`,
      wallModel: 'planar walls, Maxwell accommodation',
      accommodation: 0,
      restitution: p.restitutions,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: false, periodicY: false },
      duration,
      reynolds: {
        simulation: null,
        effective: null,
        physical: null,
        note: 'Not definable: the static box has no mean flow and no flow length scale.',
      },
      mach: { Mp: 0, benchmark: null, note: 'No mean flow (V = 0).' },
      results,
      uncertainty,
      convergence: {
        status: 'NOT ASSESSED',
        note: 'Single resolution. Timestep / particle-count convergence is a separate study (validation/Convergence).',
      },
      benchmarks,
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07'],
      acceptance: checks,
      status,
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
