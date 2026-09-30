import { difference, type Estimate } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type ExperimentType, type Run } from './Experiment';

/**
 * MODEL A/B TEST (Master prompt §40).
 *
 * Runs two configurations of the same experiment under equivalent conditions
 * — the same experiment type and the same seeds, so initial conditions match
 * wherever the two configurations allow — and reports, for every named metric,
 * the difference B − A, its uncertainty and its significance, next to the
 * validation status (including convergence) of each side.
 *
 * The two sides are complete, ordinary experiments; their full records are
 * embedded in the result. Nothing is pooled across the two sides.
 */
export interface ABSide {
  label: string;
  params: Record<string, unknown>;
}

export interface ABTestParams {
  experiment: ExperimentType;
  a: ABSide;
  b: ABSide;
}

/** Named scalar metrics extracted from a record, per experiment type. */
type Metric = { name: string; estimate: Estimate | { mean: number; se: number } | null };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function metricsOf(rec: ExperimentRecord): Metric[] {
  const r = rec.results as any;
  switch (rec.experimentType) {
    case 'static-box': {
      const out: Metric[] = [
        { name: 'P·A/(N·kT) (elastic)', estimate: r.elastic?.dimensionlessPressure ?? null },
        { name: 'wall pressure (elastic)', estimate: r.elastic?.measuredPressure ?? null },
      ];
      for (const [e, d] of Object.entries<any>(r.inelasticDecay ?? {})) {
        out.push({ name: `${e}: collisions/particle to halve P`, estimate: d.collisionsPerParticleToHalvePressure?.se ? d.collisionsPerParticleToHalvePressure : null });
      }
      return out;
    }
    case 'thermal':
      return (r.densityDependence?.table ?? []).map((t: any) => ({ name: `Z at φ=${t.areaFraction}`, estimate: t.dimensionlessPressure }));
    case 'wall-accommodation':
      return (r.shear ?? []).map((s: any) => ({ name: `shear stress, Aw=${s.Aw}`, estimate: s.bottomShear }));
    case 'sound-speed':
    case 'sound-speed-sweeps':
      return (r.cases ?? []).filter(Boolean).map((c: any) => ({ name: `c_p: ${c.label}`, estimate: c.speed }));
    case 'viscosity':
    case 'viscosity-sweeps':
      return (r.cases ?? []).map((c: any) => ({ name: `μ_eff: ${c.label}`, estimate: c.muEff }));
    case 'boundary-layer': {
      const st = (r.stations ?? []).filter((s: any) => s.xFromLeadingEdge > 0);
      const last = st[st.length - 1];
      if (!last) return [];
      return [
        { name: `δ* at ${last.label}`, estimate: last.displacementThickness },
        { name: `near-wall deficit at ${last.label}`, estimate: last.deficitAtWall },
        { name: `wall shear at ${last.label}`, estimate: last.wallShear },
      ];
    }
    case 'kutta':
      return (r.cases ?? []).filter(Boolean).flatMap((c: any) => [
        { name: `lift: ${c.label}`, estimate: c.lift },
        { name: `drag: ${c.label}`, estimate: c.drag },
        { name: `Γ_body: ${c.label}`, estimate: c.gammaBody },
      ]);
    default:
      return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Pair metrics by name; difference = B − A with SE √(SE_A² + SE_B²). */
export function compareMetrics(mA: Metric[], mB: Metric[]) {
  return mA.map((ma) => {
    const mb = mB.find((m) => m.name === ma.name);
    if (!ma.estimate || !mb?.estimate) return { metric: ma.name, a: ma.estimate, b: mb?.estimate ?? null, difference: null };
    // B − A: difference(x, y) returns x − y
    const d = difference(mb.estimate as Estimate, ma.estimate as Estimate);
    return {
      metric: ma.name,
      a: { mean: ma.estimate.mean, se: ma.estimate.se },
      b: { mean: mb.estimate.mean, se: mb.estimate.se },
      difference: d.difference,
      se: d.se,
      z: d.z,
      pValue: d.pValue,
      relative: d.difference / ma.estimate.mean,
      verdict: !Number.isFinite(d.z) ? 'undetermined' : Math.abs(d.z) > 3 ? 'DIFFERENT (|z| > 3)' : Math.abs(d.z) < 2 ? 'no significant difference' : 'marginal (2 < |z| < 3)',
    };
  });
}

interface Spec {
  side: 'a' | 'b';
  index: number;
}

// Registry access is injected to avoid a circular import (registry → ABTest → registry).
type Factory = (type: ExperimentType, params: unknown) => SequentialExperiment<unknown, unknown>;
let factory: Factory | null = null;
export function setABFactory(f: Factory) {
  factory = f;
}

export class ABTestExperiment extends SequentialExperiment<Spec, unknown> {
  readonly type = 'ab-test' as const;
  readonly params: ABTestParams;
  private readonly expA: SequentialExperiment<unknown, unknown>;
  private readonly expB: SequentialExperiment<unknown, unknown>;

  constructor(p: ABTestParams) {
    if (!factory) throw new Error('A/B test factory not registered');
    const expA = factory(p.experiment, p.a.params);
    const expB = factory(p.experiment, p.b.params);
    const specs: Spec[] = [
      ...expA.specs.map((_, index) => ({ side: 'a' as const, index })),
      ...expB.specs.map((_, index) => ({ side: 'b' as const, index })),
    ];
    super(specs);
    this.params = p;
    this.expA = expA;
    this.expB = expB;
  }

  protected createRun(spec: Spec): Run<unknown> {
    const exp = spec.side === 'a' ? this.expA : this.expB;
    // delegate to the side's own run factory
    return (exp as unknown as { createRun(s: unknown, i: number): Run<unknown> }).createRun(exp.specs[spec.index], spec.index);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const nA = this.expA.specs.length;
    this.expA.setResults(this.results.slice(0, nA));
    this.expB.setResults(this.results.slice(nA));
    const recA = this.expA.buildRecord();
    const recB = this.expB.buildRecord();
    const mA = metricsOf(recA);
    const mB = metricsOf(recB);
    const comparisons = compareMetrics(mA, mB);
    const checks: AcceptanceCheck[] = [
      check('side-A-valid', `Side A (${p.a.label}) passed its own checks`, 'status PASSED', recA.status, recA.status === 'PASSED', recA.status === 'FAILED' ? 'FAILED' : 'INCONCLUSIVE'),
      check('side-B-valid', `Side B (${p.b.label}) passed its own checks`, 'status PASSED', recB.status, recB.status === 'PASSED', recB.status === 'FAILED' ? 'FAILED' : 'INCONCLUSIVE'),
      check('comparable', 'At least one metric could be compared with an uncertainty', '≥ 1 comparison with finite SE',
        `${comparisons.filter((c) => c.difference !== null).length} comparable metric(s)`, comparisons.some((c) => c.difference !== null), 'INCONCLUSIVE'),
    ];
    return {
      ...recA,
      ...recordHeader('ab-test', `A/B: ${p.a.label} vs ${p.b.label} (${p.experiment})`, recA.seeds),
      results: {
        experiment: p.experiment,
        a: { label: p.a.label, status: recA.status, convergence: recA.convergence },
        b: { label: p.b.label, status: recB.status, convergence: recB.convergence },
        comparisons,
        records: { a: recA, b: recB },
      },
      uncertainty: { note: 'Difference SE = √(SE_A² + SE_B²); the two sides are independent experiments.' },
      convergence: {
        status: recA.convergence.status === recB.convergence.status ? recA.convergence.status : 'NOT ASSESSED',
        note: `A: ${recA.convergence.status}; B: ${recB.convergence.status}`,
      },
      benchmarks: { note: 'See the embedded side records.' },
      acceptance: checks,
      status: combineStatus(checks),
      warnings: [...recA.warnings.map((w) => `A: ${w}`), ...recB.warnings.map((w) => `B: ${w}`)],
      safetyFlags: [...recA.safetyFlags, ...recB.safetyFlags],
      config: p,
    };
  }
}
