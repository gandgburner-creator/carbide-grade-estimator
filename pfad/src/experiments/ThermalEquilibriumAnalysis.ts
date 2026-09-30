import type { VelocityDistribution } from '../gas/InitialConditions';
import { hendersonCompressibility } from '../benchmarks/KineticTheory';
import { cumulativeMean, halfMeans, mean, pairedTTest, seedSummary, tailMean } from '../measurements/Statistics';
import { check, type AcceptanceCheck, type ValidationStatus } from '../validation/Status';
import type { BoxGasRunResult } from './BoxGasRun';

/**
 * Equilibrium analysis of the thermal experiment against the criteria fixed
 * in docs/CRITERIA_THERMAL_VISCOSITY.md (E2, E4 and the reported diagnostics).
 * Every aggregate uncertainty comes from independent seeds; per-run SEs are
 * not used (they overstate the closed-box pressure uncertainty, see §1 there).
 *
 * Distinct configurations only: runs that are bit-identical trajectories of
 * another configuration (power-of-4 temperature classes; the Maxwell-start
 * relaxation run, which is the φ = 0.05 run measured from t = 0) are not
 * counted twice.
 */
type Run = BoxGasRunResult & { study: 'temperature' | 'density' | 'distribution'; distribution: VelocityDistribution };

export const STATIONARITY_OBSERVABLES = ['Z', 'a2', 'kurtosis', 'anisotropy', 'dispersion'] as const;
type Obs = (typeof STATIONARITY_OBSERVABLES)[number];

/** Equilibrium portion of one run: per-window observables and the matching dispersion samples. */
export function equilibriumSeries(r: Run) {
  const s = r.series;
  const c0 = r.measurementStartCollisions + (r.params.analysisFromCollisions ?? 0);
  const idx = s.c.map((c, i) => (c >= c0 ? i : -1)).filter((i) => i >= 0);
  const n = r.geometry.numberDensity;
  const pick = (a?: number[]) => (a ? idx.map((i) => a[i]).filter((v) => v !== undefined) : []);
  const tStart = idx.length ? s.t[idx[0]] - s.duration[idx[0]] : Number.NaN;
  const ds = r.emptySpace.dispersionSeries;
  const dispersion = ds.t.map((t, k) => (t >= tStart ? ds.d[k] : Number.NaN)).filter(Number.isFinite);
  return {
    c: idx.map((i) => s.c[i] - c0),
    Z: idx.map((i) => s.pressure[i] / (n * s.kT[i])),
    kT: pick(s.kT),
    kTx: pick(s.kTx),
    kTy: pick(s.kTy),
    a2: pick(s.a2),
    kurtosis: pick(s.kurtosis),
    anisotropy: pick(s.anisotropy),
    dispersion,
  };
}

interface Config {
  id: string;
  select: (r: Run) => boolean;
  note?: string;
}

export function thermalConfigs(p: { areaFractions: number[]; areaFraction: number; temperatures: number[]; kT: number; distributions: VelocityDistribution[] }): Config[] {
  const out: Config[] = [];
  // temperature classes: kT/kT_ref a power of 4 → same trajectory as the reference-kT density run
  const class2 = p.temperatures.filter((t) => Math.abs(Math.log(t / p.kT) / Math.log(4) - Math.round(Math.log(t / p.kT) / Math.log(4))) > 1e-9);
  if (class2.length) {
    const k = Math.min(...class2);
    out.push({ id: `kT = ${k} (class of ${class2.join(', ')}), φ = ${p.areaFraction}`, select: (r) => r.study === 'temperature' && r.params.kT === k });
  }
  for (const phi of p.areaFractions) {
    out.push({
      id: `φ = ${phi}, kT = ${p.kT}`,
      select: (r) => r.study === 'density' && r.params.areaFraction === phi,
      note: phi === p.areaFraction ? `also represents kT = ${p.temperatures.filter((t) => !class2.includes(t)).join(', ')} (bit-identical in rescaled time) and the Maxwell-start relaxation run` : undefined,
    });
  }
  for (const d of p.distributions) {
    if (d === 'maxwell') continue;
    out.push({ id: `${d} start, φ = ${p.areaFraction} (late half of the relaxation run)`, select: (r) => r.study === 'distribution' && r.distribution === d });
  }
  return out;
}

export function thermalEquilibriumAnalysis(
  p: { areaFractions: number[]; areaFraction: number; temperatures: number[]; kT: number; distributions: VelocityDistribution[] },
  runs: Run[],
): { results: Record<string, unknown>; checks: AcceptanceCheck[] } {
  const configs = thermalConfigs(p);
  const tests: { config: string; observable: Obs; n: number; meanDiff: number; se: number; t: number; p: number }[] = [];
  const perConfig = configs.map((cfg) => {
    const rs = runs.filter((r) => cfg.select(r) && !r.halted).sort((a, b) => a.seed - b.seed);
    const series = rs.map(equilibriumSeries);
    const perSeed = rs.map((r, k) => {
      const s = series[k];
      return {
        seed: r.seed,
        windows: s.Z.length,
        collisionsPerParticle: s.c.length ? s.c[s.c.length - 1] : 0,
        Z: mean(s.Z),
        kT: mean(s.kT),
        kTx: mean(s.kTx),
        kTy: mean(s.kTy),
        a2: mean(s.a2),
        kurtosis: mean(s.kurtosis),
        anisotropy: mean(s.anisotropy),
        dispersion: mean(s.dispersion),
      };
    });
    // E2: stationarity, seed-paired late-half minus early-half
    const stationarity = STATIONARITY_OBSERVABLES.map((o) => {
      const diffs = series.map((s) => {
        const h = halfMeans(s[o]);
        return h.second - h.first;
      });
      const t = pairedTTest(diffs);
      tests.push({ config: cfg.id, observable: o, n: t.n, meanDiff: t.mean, se: t.se, t: t.t, p: t.p });
      return { observable: o, ...t };
    });
    // averaging-window sensitivity: Z from the last 100 / 75 / 50 / 25 % of the equilibrium part
    const windowSensitivity = [1, 0.75, 0.5, 0.25].map((f) => ({ lastFraction: f, Z: seedSummary(series.map((s) => tailMean(s.Z, f))) }));
    // convergence: cumulative mean of Z against collisions/particle, per seed and seed ensemble
    const cum = series.map((s) => {
      const cm = cumulativeMean(s.Z, 60);
      return { c: cm.index.map((i) => s.c[i]), Z: cm.value };
    });
    const nPts = Math.min(...cum.map((q) => q.Z.length));
    const ensembleCurve = Array.from({ length: Number.isFinite(nPts) ? nPts : 0 }, (_, k) => {
      const ss = seedSummary(cum.map((q) => q.Z[k]));
      return { c: mean(cum.map((q) => q.c[k])), mean: ss.mean, ci95: ss.ci95 };
    });
    const phi = rs[0]?.geometry.areaFraction ?? Number.NaN;
    const hZ = hendersonCompressibility(phi);
    const h = 1e-5;
    const dZ = (hendersonCompressibility(phi + h) - hendersonCompressibility(phi - h)) / (2 * h);
    return {
      config: cfg.id,
      note: cfg.note,
      seeds: rs.length,
      perSeed,
      aggregate: {
        Z: seedSummary(perSeed.map((s) => s.Z)),
        kT: seedSummary(perSeed.map((s) => s.kT)),
        kTxOverKTy: seedSummary(perSeed.map((s) => s.kTx / s.kTy)),
        a2: seedSummary(perSeed.map((s) => s.a2)),
        kurtosis: seedSummary(perSeed.map((s) => s.kurtosis)),
        anisotropy: seedSummary(perSeed.map((s) => s.anisotropy)),
        dispersion: seedSummary(perSeed.map((s) => s.dispersion)),
      },
      stationarity,
      windowSensitivity,
      convergence: { perSeed: cum.map((q, k) => ({ seed: rs[k].seed, ...q })), ensemble: ensembleCurve },
      externalDiagnostics: {
        note: 'Comparison only, never a criterion.',
        hendersonZ: hZ,
        maxwellKurtosis: 3,
        maxwellA2: 0,
        hardDiskDispersionS0: 1 / (hZ + phi * dZ),
      },
    };
  });

  const checks: AcceptanceCheck[] = [];
  // E2
  const m = tests.length;
  const alpha = 0.05 / Math.max(1, m);
  const failing = tests.filter((t) => !(t.p > alpha));
  const decisive = tests.filter((t) => t.p < 1e-6);
  const worst = tests.reduce((a, t) => (t.p < a.p ? t : a), tests[0]);
  const e2Status: ValidationStatus = decisive.length ? 'FAILED' : 'INCONCLUSIVE';
  checks.push(check('E2-stationarity', 'Late half equals early half of the measurement (Z, a2, kurtosis, anisotropy, dispersion; every distinct configuration)',
    `seed-paired t-test p > 0.05/${m} = ${alpha.toExponential(2)} for all ${m} tests (FAIL if any p < 1e-6)`,
    failing.length ? `${failing.length} test(s) below: ${failing.map((t) => `${t.config} / ${t.observable} p = ${t.p.toExponential(2)}`).join('; ')}` : `all pass; smallest p = ${worst ? worst.p.toExponential(2) : 'n/a'} (${worst?.config} / ${worst?.observable})`,
    failing.length === 0, e2Status));
  // E4
  const prec = perConfig.map((c) => ({ config: c.config, rel: c.aggregate.Z.relHalfWidth95 }));
  const imprecise = prec.filter((q) => !(q.rel < 0.0071));
  const worstP = prec.reduce((a, q) => (q.rel > a.rel ? q : a), prec[0]);
  checks.push(check('E4-precision', 'Seed-ensemble 95 % CI half-width of Z (Bible §20: resolve 1 % differences between two measurements)',
    '< 0.71 % in every distinct configuration', imprecise.length ? imprecise.map((q) => `${q.config}: ${(100 * q.rel).toFixed(2)} %`).join('; ') : `all < 0.71 %; worst ${(100 * worstP.rel).toFixed(2)} % (${worstP.config})`,
    imprecise.length === 0, 'INCONCLUSIVE'));
  return {
    results: {
      criteria: 'docs/CRITERIA_THERMAL_VISCOSITY.md (E1–E6)',
      temperatureProxy: 'kT = peculiar KE / N (A-03); in a closed elastic box it is fixed by energy conservation, so its constancy is the E1 ledger check; kT_x / kT_y tests equipartition',
      configurations: perConfig,
      stationarityTests: { m, alpha, tests },
    },
    checks,
  };
}
