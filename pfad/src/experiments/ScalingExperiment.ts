import { compare, judgeConvergence } from '../validation/ConvergenceJudge';
import { check, combineStatus, type AcceptanceCheck, type ValidationStatus } from '../validation/Status';
import { COUETTE_REFERENCE, type CouetteParams } from './CouetteExperiment';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type ExperimentType, type Run } from './Experiment';
import { KUTTA_REFERENCE, type KuttaParams } from './KuttaExperiment';

/**
 * SCALING (Master prompt §22, Step 15).
 *
 * Do results converge across scaled particle universes? One experiment is
 * rerun at geometrically similar sizes, measured in particle diameters
 * (particle count ∝ size² at fixed occupancy). Two families:
 *   fixed-mach      U fixed, so Mp is fixed while Re ∝ size and Kn ∝ 1/size.
 *                   Asks: do dimensionless results settle as the universe grows?
 *   fixed-reynolds  U ∝ 1/size, so Re is fixed while Kn ∝ 1/size and Mp ∝ 1/size.
 *                   Asks: is Re the governing parameter (continuum similarity)?
 * Time parameters scale with the convective time size/U. Dimensionless
 * outcomes use the measured, realised free stream (reporting normalisation,
 * not a solver input). The verdict per outcome is the shared convergence
 * judge (largest size vs the next): PASSED / NOT CONVERGED / INCONCLUSIVE.
 */
export type ScalingMode = 'fixed-mach' | 'fixed-reynolds';

export interface ScalingParams {
  experiment: 'kutta' | 'viscosity';
  mode: ScalingMode;
  /** sizes in particle diameters: chord (kutta) or channel height (viscosity), ascending */
  sizes: number[];
  /** size and speed of the reference configuration the family is built from */
  referenceSize: number;
  referenceSpeed: number;
  seeds: number[];
  /** kutta: index of the case of KUTTA_REFERENCE to scale */
  caseIndex: number;
  relTolerance: number;
  /** optional overrides applied to the base experiment's parameters */
  base: Record<string, unknown>;
  viscosity: null | { value: number; se: number; source: string };
}

export const SCALING_REFERENCE: ScalingParams = {
  experiment: 'kutta',
  mode: 'fixed-mach',
  sizes: [30, 42, 60],
  referenceSize: 60,
  referenceSpeed: 1,
  seeds: [301, 302, 303, 304, 305, 306],
  caseIndex: 1,
  relTolerance: 0.1,
  base: {},
  viscosity: null,
};

/** Parameters of one level of the family. */
export function levelParams(p: ScalingParams, size: number): { params: unknown; speed: number } {
  const speed = p.mode === 'fixed-reynolds' ? (p.referenceSpeed * p.referenceSize) / size : p.referenceSpeed;
  if (p.experiment === 'kutta') {
    const b = { ...KUTTA_REFERENCE, ...(p.base as Partial<KuttaParams>) };
    const f = size / b.chord; // geometry factor relative to the base
    const tf = (f * b.speed) / speed; // convective-time factor
    const params: KuttaParams = {
      ...b,
      cases: [b.cases[p.caseIndex]],
      seeds: p.seeds,
      speed,
      length: Math.round(b.length * f),
      height: Math.round(b.height * f),
      chord: size,
      thickness: b.thickness * f,
      leadingEdgeX: b.leadingEdgeX * f,
      contourMargin: b.contourMargin * f,
      fanRadius: b.fanRadius * f,
      surfaceBin: b.surfaceBin * f,
      cell: b.cell * f,
      duration: b.duration * tf,
      lateFrom: b.lateFrom * tf,
      window: b.window * tf,
    };
    return { params, speed };
  }
  const b = { ...COUETTE_REFERENCE, ...(p.base as Partial<CouetteParams>) };
  const c0 = b.cases[0];
  const f = size / c0.height;
  const params: CouetteParams = {
    ...b,
    seeds: p.seeds,
    cases: [{ ...c0, label: `H=${size}, U=${speed.toPrecision(3)}`, height: size, count: Math.round(c0.count * f), wallSpeed: speed }],
  };
  return { params, speed };
}

type Metric = { name: string; estimate: { mean: number; se: number } | null; relative: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Dimensionless (or material) outcomes of one level. */
export function scalingMetrics(rec: ExperimentRecord): Metric[] {
  const r = rec.results as any;
  if (rec.experimentType === 'kutta') {
    const c = r.cases?.[0];
    if (!c) return [];
    const cfg = rec.config as KuttaParams;
    const q = 0.5 * c.realised.density * c.realised.freeStreamU ** 2 * cfg.chord;
    const ref = c.realised.freeStreamU * cfg.chord;
    return [
      { name: 'C_L = L / (½ ρ_e U_e² c)', estimate: { mean: c.lift.mean / q, se: c.lift.se / q }, relative: true },
      { name: 'C_D = D / (½ ρ_e U_e² c)', estimate: { mean: c.drag.mean / q, se: c.drag.se / q }, relative: true },
      { name: 'Γ / (U_e c)', estimate: { mean: c.gammaBody.mean / ref, se: c.gammaBody.se / ref }, relative: true },
      { name: 'TE departure angle to bisector (deg)', estimate: c.departure.angleToBisectorDeg, relative: false },
    ];
  }
  if (rec.experimentType === 'viscosity') {
    const c = r.cases?.[0];
    if (!c) return [];
    return [
      { name: 'μ_eff', estimate: c.muEff, relative: true },
      { name: 'Kn = λ/H (measured λ)', estimate: { mean: c.knudsen, se: 0 }, relative: false },
    ];
  }
  return [];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Spec {
  level: number;
  index: number;
}

type Factory = (type: ExperimentType, params: unknown) => SequentialExperiment<unknown, unknown>;
let factory: Factory | null = null;
export function setScalingFactory(f: Factory) {
  factory = f;
}

export class ScalingExperiment extends SequentialExperiment<Spec, unknown> {
  readonly type = 'scaling' as const;
  readonly params: ScalingParams;
  private readonly levels: { size: number; speed: number; exp: SequentialExperiment<unknown, unknown> }[];

  constructor(p: ScalingParams) {
    if (!factory) throw new Error('scaling factory not registered');
    if (p.sizes.some((s, k) => k > 0 && !(s > p.sizes[k - 1]))) throw new Error('scaling sizes must be ascending');
    const levels = p.sizes.map((size) => {
      const { params, speed } = levelParams(p, size);
      return { size, speed, exp: factory!(p.experiment, params) };
    });
    const specs: Spec[] = levels.flatMap((L, level) => L.exp.specs.map((_, index) => ({ level, index })));
    super(specs);
    this.params = p;
    this.levels = levels;
  }

  protected createRun(spec: Spec): Run<unknown> {
    const exp = this.levels[spec.level].exp;
    return (exp as unknown as { createRun(s: unknown, i: number): Run<unknown> }).createRun(exp.specs[spec.index], spec.index);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    let offset = 0;
    const recs = this.levels.map((L) => {
      const n = L.exp.specs.length;
      L.exp.setResults(this.results.slice(offset, offset + n));
      offset += n;
      return L.exp.buildRecord();
    });
    const names = LEVEL_NAMES(recs.length);
    const levelRows = recs.map((rec, k) => {
      const L = this.levels[k];
      const rhoU = (() => {
        const c = (rec.results as { cases?: { realised?: { density: number; freeStreamU: number } }[] }).cases?.[0];
        return c?.realised ? c.realised.density * c.realised.freeStreamU : rec.density.massDensity * L.speed;
      })();
      return {
        name: names[k],
        size: L.size,
        speed: L.speed,
        particleCount: rec.particleCount,
        reynolds: p.viscosity ? (rhoU * L.size) / p.viscosity.value : null,
        mach: rec.mach.Mp,
        status: rec.status,
        metrics: scalingMetrics(rec).map((m) => ({ name: m.name, mean: m.estimate?.mean ?? null, se: m.estimate?.se ?? null })),
      };
    });
    const metricNames = scalingMetrics(recs[recs.length - 1]).map((m) => ({ name: m.name, relative: m.relative }));
    const perMetric = metricNames.map(({ name, relative }) => {
      const vals = recs.map((rec) => scalingMetrics(rec).find((m) => m.name === name)?.estimate ?? null);
      const n = vals.length;
      const hm = n >= 2 ? compare(vals[n - 1], vals[n - 2]) : null;
      const ml = n >= 3 ? compare(vals[n - 2], vals[n - 3]) : null;
      const judged = relative ? judgeConvergence(hm, p.relTolerance) : null;
      return {
        metric: name,
        values: vals.map((v, k) => ({ size: this.levels[k].size, mean: v?.mean ?? null, se: v?.se ?? null })),
        highVsMedium: hm,
        mediumVsLow: ml,
        status: (judged?.status ?? 'NOT ASSESSED') as ValidationStatus | 'NOT ASSESSED',
        verdict: judged?.verdict ?? 'reported only (no relative tolerance for this quantity)',
      };
    });

    const checks: AcceptanceCheck[] = recs.map((rec, k) =>
      check(`level-${names[k]}-valid`, `${names[k]} (size ${this.levels[k].size}) passed its own checks`, 'status not FAILED', rec.status, rec.status !== 'FAILED', 'FAILED'),
    );
    for (const m of perMetric) {
      if (m.status === 'NOT ASSESSED') continue;
      checks.push(check(`scale-converged: ${m.metric}`, `${m.metric} converged across ${p.mode === 'fixed-mach' ? 'universe size at fixed Mp' : 'universe size at fixed Re'}`,
        `|HIGH − MEDIUM| within ${(100 * p.relTolerance).toFixed(0)} % or not significant`, m.verdict, m.status === 'PASSED', m.status === 'PASSED' ? 'PASSED' : (m.status as ValidationStatus)));
    }
    const last = recs[recs.length - 1];
    return {
      ...last,
      ...recordHeader('scaling', `Scaling (${p.mode}): ${p.experiment} across sizes ${p.sizes.join(', ')} d`, p.seeds),
      particleCount: last.particleCount,
      geometry: `${p.experiment} family scaled to sizes ${p.sizes.join(', ')} particle diameters`,
      reynolds: {
        simulation: levelRows[levelRows.length - 1].reynolds,
        effective: null,
        physical: null,
        note: p.viscosity ? `Re = ρ_e U_e · size / μ per level (μ from ${p.viscosity.source}); ${p.mode === 'fixed-mach' ? 'Re grows with size' : 'Re held fixed by U ∝ 1/size'}.` : 'No measured μ supplied.',
      },
      results: {
        experiment: p.experiment,
        mode: p.mode,
        question: p.mode === 'fixed-mach' ? 'Do dimensionless results settle as the particle universe grows at fixed Mp (Re ∝ size, Kn ∝ 1/size)?' : 'At fixed Re, do universes of different size (Kn, Mp ∝ 1/size) give the same dimensionless results?',
        levels: levelRows,
        perMetric,
        records: recs,
      },
      uncertainty: { note: 'Each level: its own seed ensemble. Level differences: √(SE_hi² + SE_lo²).' },
      convergence: {
        status: combineStatus(checks.filter((c) => c.id.startsWith('scale-converged'))) as ValidationStatus,
        note: 'Scale convergence per outcome, largest size vs the next (Master prompt §23 verdict).',
      },
      benchmarks: { note: 'None: the comparison is between particle universes only.' },
      acceptance: checks,
      status: combineStatus(checks),
      warnings: recs.flatMap((rec, k) => rec.warnings.map((w) => `${names[k]}: ${w}`)),
      safetyFlags: recs.flatMap((rec) => rec.safetyFlags),
      config: p,
    };
  }
}

function LEVEL_NAMES(n: number): string[] {
  if (n === 3) return ['LOW', 'MEDIUM', 'HIGH'];
  if (n === 2) return ['LOW', 'HIGH'];
  return Array.from({ length: n }, (_, k) => `L${k + 1}`);
}
