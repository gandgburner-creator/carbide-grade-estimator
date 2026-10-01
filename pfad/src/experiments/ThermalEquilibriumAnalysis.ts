import type { VelocityDistribution } from '../gas/InitialConditions';
import { hendersonCompressibility } from '../benchmarks/KineticTheory';
import { cumulativeMean, halfMeans, mean, pairedTTest, seedSummary, tailMean, tTwoSidedCritical, welchTTest } from '../measurements/Statistics';
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
      criteria: 'docs/CRITERIA_THERMAL_VISCOSITY.md (E1–E5; E6′ from §6)',
      temperatureProxy: 'kT = peculiar KE / N (A-03); in a closed elastic box it is fixed by energy conservation, so its constancy is the E1 ledger check; kT_x / kT_y tests equipartition',
      configurations: perConfig,
      stationarityTests: { m, alpha, tests },
    },
    checks,
  };
}

/**
 * E6′ — relaxation judged against an equilibrium-start control
 * (docs/CRITERIA_THERMAL_VISCOSITY.md §6; replaces E6 for validation runs).
 *
 * For every non-Maxwell start, observable (a₂, anisotropy) and block of the
 * late half of the relaxation run: Welch t-test of the per-seed block means
 * against the per-seed block means of the Maxwell-start runs (which begin in
 * equilibrium). Blocks: the late half (window index ≥ ⌊n/2⌋ of each run) is
 * cut into `blocks` consecutive blocks of ⌊(n − ⌊n/2⌋)/blocks⌋ windows; the
 * remaining ≤ blocks − 1 final windows are not used. m = starts × 2 × blocks
 * tests, Bonferroni: each passes at p > 0.05/m, so the family-wise false-alarm
 * probability is ≤ 5 % whatever the correlation between the tests.
 * PASS: every p > 0.05/m. FAIL: any p < 1e-6. Otherwise INCONCLUSIVE. Fewer
 * than 3 usable runs in the control or in any start: INCONCLUSIVE.
 */
export const E6_PRIME = {
  blocks: 4,
  observables: ['a2', 'anisotropy'] as const,
  control: 'maxwell' as VelocityDistribution,
  familyAlpha: 0.05,
  failP: 1e-6,
  minSeeds: 3,
};

/** Window-index ranges [from, to) of the late-half blocks of a series of n windows. */
export function lateHalfBlocks(n: number, blocks = E6_PRIME.blocks): { from: number; to: number }[] {
  const half = Math.floor(n / 2);
  const len = Math.floor((n - half) / blocks);
  return Array.from({ length: blocks }, (_, b) => ({ from: half + b * len, to: half + (b + 1) * len }));
}

interface RelaxRun {
  distribution: VelocityDistribution;
  seed: number;
  halted?: boolean;
  series: { c: number[]; a2?: number[]; anisotropy?: number[] };
}

export function relaxationVersusControl(runs: RelaxRun[], blocks = E6_PRIME.blocks): { results: Record<string, unknown>; check: AcceptanceCheck } {
  const usable = runs.filter((r) => !r.halted && r.series.a2 && r.series.anisotropy);
  const control = usable.filter((r) => r.distribution === E6_PRIME.control).sort((a, b) => a.seed - b.seed);
  const starts = [...new Set(usable.map((r) => r.distribution))].filter((d) => d !== E6_PRIME.control);
  const blockMeans = (r: RelaxRun, o: (typeof E6_PRIME.observables)[number]) => {
    const x = r.series[o]!;
    return lateHalfBlocks(x.length, blocks).map((bl) => mean(x.slice(bl.from, bl.to)));
  };
  const blockWindows = (r: RelaxRun) => lateHalfBlocks(r.series.c.length, blocks).map((bl) => bl.to - bl.from);
  const m = starts.length * E6_PRIME.observables.length * blocks;
  const alpha = E6_PRIME.familyAlpha / Math.max(1, m);
  const tests = starts.flatMap((d) => {
    const g = usable.filter((r) => r.distribution === d).sort((a, b) => a.seed - b.seed);
    return E6_PRIME.observables.flatMap((o) => {
      const gm = g.map((r) => blockMeans(r, o));
      const cm = control.map((r) => blockMeans(r, o));
      return Array.from({ length: blocks }, (_, b) => {
        const w = welchTTest(gm.map((q) => q[b]), cm.map((q) => q[b]));
        const ref = g[0] ?? control[0];
        const bl = ref ? lateHalfBlocks(ref.series.c.length, blocks)[b] : { from: 0, to: 0 };
        const tCrit = w.dof > 0 ? tTwoSidedCritical(alpha, w.dof) : Number.NaN;
        return {
          distribution: d,
          observable: o,
          block: b + 1,
          cFrom: ref ? ref.series.c[bl.from] : Number.NaN,
          cTo: ref ? ref.series.c[bl.to - 1] : Number.NaN,
          seedsStart: w.nA,
          seedsControl: w.nB,
          windowsStart: g.reduce((a, r) => a + blockWindows(r)[b], 0),
          windowsControl: control.reduce((a, r) => a + blockWindows(r)[b], 0),
          perSeedStart: g.map((r, k) => ({ seed: r.seed, blockMean: gm[k][b] })),
          perSeedControl: control.map((r, k) => ({ seed: r.seed, blockMean: cm[k][b] })),
          meanStart: mean(gm.map((q) => q[b])),
          meanControl: mean(cm.map((q) => q[b])),
          difference: w.diff,
          se: w.se,
          t: w.t,
          dof: w.dof,
          p: w.p,
          minimumDetectableDifference: tCrit * w.se,
          violation: !(w.p > alpha),
        };
      });
    });
  });
  const enough = control.length >= E6_PRIME.minSeeds && starts.every((d) => usable.filter((r) => r.distribution === d).length >= E6_PRIME.minSeeds) && starts.length > 0;
  const violations = tests.filter((t) => t.violation);
  const decisive = tests.filter((t) => t.p < E6_PRIME.failP);
  const worst = tests.reduce<(typeof tests)[number] | null>((a, t) => (!a || t.p < a.p ? t : a), null);
  const maxAbsT = tests.reduce((a, t) => Math.max(a, Math.abs(t.t)), 0);
  const windowsTested = usable.reduce((a, r) => a + E6_PRIME.observables.length * blockWindows(r).reduce((x, y) => x + y, 0), 0);
  const passed = enough && violations.length === 0;
  const status: ValidationStatus = !enough ? 'INCONCLUSIVE' : decisive.length ? 'FAILED' : 'INCONCLUSIVE';
  const measured = !enough
    ? `not evaluable: control ${control.length} run(s), starts ${starts.map((d) => `${d} ${usable.filter((r) => r.distribution === d).length}`).join(', ')} (need ≥ ${E6_PRIME.minSeeds})`
    : violations.length
      ? `${violations.length} of ${m} test(s) at p ≤ ${alpha.toExponential(2)}: ${violations.map((t) => `${t.distribution} / ${t.observable} / block ${t.block} p = ${t.p.toExponential(2)}`).join('; ')}`
      : `0 of ${m} violations; smallest p = ${worst ? worst.p.toPrecision(3) : 'n/a'} (${worst?.distribution} / ${worst?.observable} / block ${worst?.block}), max |t| = ${maxAbsT.toFixed(2)}`;
  return {
    results: {
      criterion: "E6′, docs/CRITERIA_THERMAL_VISCOSITY.md §6",
      control: E6_PRIME.control,
      starts,
      blocks,
      observables: E6_PRIME.observables,
      m,
      perTestAlpha: alpha,
      familyWiseFalseAlarmBound: E6_PRIME.familyAlpha,
      expectedFalseViolationsUnderH0: m * alpha,
      failP: E6_PRIME.failP,
      windowsTested,
      violations: violations.length,
      smallestP: worst?.p ?? Number.NaN,
      maxAbsT,
      tests,
    },
    check: check(
      'E6prime-relaxation-vs-control',
      'Every non-Maxwell start is indistinguishable from the equilibrium-start (Maxwell) control in the late half of the relaxation run (a2, anisotropy; per-seed block means, Welch t)',
      `${m} tests, each p > 0.05/${m} = ${alpha.toExponential(2)} (Bonferroni, family-wise false alarm ≤ 5 %); FAIL if any p < 1e-6`,
      measured,
      passed,
      status,
    ),
  };
}

