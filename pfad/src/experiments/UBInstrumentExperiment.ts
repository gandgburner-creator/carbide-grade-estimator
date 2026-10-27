import { independentEstimate, type Estimate } from '../measurements/Statistics';
import { henderson, UB0_PHI } from '../universeB/CoarseGrainMap';
import { couetteEstimate, shearEstimate, soundEstimate, staticEstimate, wallEstimate } from '../universeB/UB0Estimators';
import { C_LO_A, tauD } from '../universeB/UB0Plans';
import { domainOf, mapOf, simConfigOf, UB0Run, type UB0Kind, type UB0Result, type UB0RunState, type UB0Spec } from '../universeB/UB0Run';
import { combineStatus } from '../validation/Status';
import type { AcceptanceCheck } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * The UB-0 instrument (UB0Run and its estimators) driven from the laboratory,
 * UNIVERSE A ONLY (N_c = 1). Universe A is the reference and unrestricted
 * (design §11.7). Universe B runs (N_c > 1) are refused: UB-0 is preregistered
 * and blind, and Universe B observables are first computed by the preregistered
 * scripts after gate G5. These are exploratory runs outside the UB-0 protocol;
 * nothing here is judged, pooled or frozen. The laboratory additionally refuses
 * the protocol's seed ranges (src/app/seeds.ts).
 */
export interface UBInstrumentParams {
  kind: UB0Kind;
  /** coarse-graining level; must be 1 (Universe A) */
  Nc: number;
  phi: number;
  courant: number;
  /** periodic kinds: square side in D */
  L: number;
  /** wall/couette: width × height in D */
  width: number;
  height: number;
  /** shear/sound amplitude in units of σ_v */
  amplitude: number;
  /** couette wall speed difference in units of σ_v */
  wallSpeed: number;
  /** durations in D/σ_v */
  prep: number;
  settle: number;
  measure: number;
  sample: number;
  /** static: g(r), ψ₆ and self-diffusion */
  extras: boolean;
  seeds: number[];
}

export const UB_LOCK_MESSAGE =
  'Universe B (N_c > 1) is locked in the laboratory: UB-0 is preregistered and blind, and Universe B observables are first computed by the preregistered scripts after gate G5 (docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md §11.7).';

/** Reduced per-kind setups for looking (not for reported results). */
export const UB_INSTRUMENT_QUICK: Record<UB0Kind, UBInstrumentParams> = {
  static: { kind: 'static', Nc: 1, phi: UB0_PHI, courant: 0.025, L: 30, width: 20, height: 20, amplitude: 0, wallSpeed: 0, prep: 20, settle: 5, measure: 60, sample: 1, extras: false, seeds: [101, 102, 103] },
  shear: { kind: 'shear', Nc: 1, phi: UB0_PHI, courant: 0.025, L: 30, width: 20, height: 20, amplitude: 1, wallSpeed: 0, prep: 20, settle: 5, measure: Math.round(1.5 * tauD(30)), sample: 0.5, extras: false, seeds: [101, 102, 103] },
  sound: { kind: 'sound', Nc: 1, phi: UB0_PHI, courant: 0.025, L: 60, width: 20, height: 20, amplitude: 0.04 * 2.17, wallSpeed: 0, prep: 20, settle: 5, measure: Math.round(8 * (60 / C_LO_A)), sample: 0.5, extras: false, seeds: [101, 102, 103] },
  wall: { kind: 'wall', Nc: 1, phi: UB0_PHI, courant: 0.025, L: 30, width: 20, height: 20, amplitude: 0, wallSpeed: 0, prep: 60, settle: 0, measure: 200, sample: 1, extras: false, seeds: [101, 102, 103] },
  couette: { kind: 'couette', Nc: 1, phi: UB0_PHI, courant: 0.025, L: 30, width: 20, height: 20, amplitude: 0, wallSpeed: 1, prep: 150, settle: 0, measure: 300, sample: 1, extras: false, seeds: [101, 102, 103] },
};

/** UB-0 Stage 0 reference specs (docs/CRITERIA_UB0_STAGE0.md), at the app's own seeds. */
export const UB_INSTRUMENT_REFERENCE: Record<UB0Kind, UBInstrumentParams> = {
  static: { ...UB_INSTRUMENT_QUICK.static, L: 80, prep: 100, settle: 20, measure: 500 },
  shear: { ...UB_INSTRUMENT_QUICK.shear, L: 80, prep: 100, settle: 20, measure: 1.5 * tauD(80) },
  sound: { ...UB_INSTRUMENT_QUICK.sound, L: 160, prep: 100, settle: 20, measure: 14 * (160 / C_LO_A) },
  wall: { ...UB_INSTRUMENT_QUICK.wall, width: 40, height: 40, prep: 640, settle: 0, measure: 2000 },
  couette: { ...UB_INSTRUMENT_QUICK.couette, width: 40, height: 40, prep: (3 * 40 * 40) / (0.351 / (UB0_PHI / (Math.PI / 4))), settle: 0, measure: 3000 },
};

export function specOf(p: UBInstrumentParams, seed: number): UB0Spec {
  if (p.Nc !== 1) throw new Error(UB_LOCK_MESSAGE);
  const periodic = p.kind === 'static' || p.kind === 'shear' || p.kind === 'sound';
  return {
    id: `app-${p.kind}-${seed}`,
    kind: p.kind,
    Nc: 1,
    ch: 0,
    e: 1,
    KTred: henderson.KTred(UB0_PHI),
    phi: p.phi,
    courant: p.courant,
    seed,
    ...(periodic ? { L: p.L } : { width: p.width, height: p.height }),
    ...(p.kind === 'shear' || p.kind === 'sound' ? { amplitude: p.amplitude } : {}),
    ...(p.kind === 'couette' ? { wallSpeed: p.wallSpeed } : {}),
    prep: p.prep,
    settle: p.settle,
    measure: p.measure,
    sample: p.sample,
    extras: p.kind === 'static' ? p.extras : undefined,
    observables: true,
  };
}

class InstrumentRun implements Run<UB0Result> {
  readonly label: string;
  readonly run: UB0Run;
  constructor(spec: UB0Spec, state?: UB0RunState) {
    this.run = state ? UB0Run.resume(state) : new UB0Run(spec);
    this.label = `${spec.kind}, N_c = 1, seed ${spec.seed}`;
  }
  get sim() {
    return this.run.sim;
  }
  get done() {
    return this.run.done;
  }
  advance(maxSteps: number) {
    return this.run.advance(maxSteps);
  }
  progress() {
    const s = this.run.spec;
    const total = s.prep + s.settle + s.measure;
    const t = this.run.sim.time / this.run.unit;
    const before = this.run.phase === 'prep' ? 0 : this.run.phase === 'settle' ? s.prep : this.run.phase === 'measure' ? s.prep + s.settle : total;
    return total > 0 ? Math.min(1, (before + t) / total) : 1;
  }
  live() {
    const r = this.run;
    const out: Record<string, number | string> = {
      phase: r.phase,
      'phase time [D/σ_v]': r.sim.time / r.unit,
      parcels: r.sim.store.count,
      samples: r.samples.length,
    };
    const last = r.samples[r.samples.length - 1];
    if (last && r.phase === 'measure') for (const [k, v] of Object.entries(last)) if (k !== 't' && typeof v === 'number') out[`sample.${k}`] = v;
    return out;
  }
  result() {
    return this.run.result();
  }
}

/** Scalar estimates of one run, by kind (the UB-0 estimators; arrays dropped). */
export function estimateRun(p: UBInstrumentParams, r: UB0Result): Record<string, number> {
  const pick = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
  switch (p.kind) {
    case 'static':
      return pick(staticEstimate(r));
    case 'shear':
      return pick(shearEstimate(r, tauD(p.L)));
    case 'sound':
      return pick(soundEstimate(r, p.L / C_LO_A));
    case 'wall':
      return pick(wallEstimate(r));
    case 'couette': {
      const c = couetteEstimate(r);
      return { ...pick(c), slipBottom: c.slip[0], slipTop: c.slip[1] };
    }
  }
}

export interface UBInstrumentCheckpoint {
  format: 'pfad-ub-instrument-checkpoint/1';
  params: UBInstrumentParams;
  index: number;
  steps: number;
  results: UB0Result[];
  run: UB0RunState | null;
}

export class UBInstrumentExperiment extends SequentialExperiment<UB0Spec, UB0Result> {
  readonly type = 'ub-instrument' as const;
  readonly params: UBInstrumentParams;

  constructor(params: UBInstrumentParams) {
    if (params.Nc !== 1) throw new Error(UB_LOCK_MESSAGE);
    super(params.seeds.map((s) => specOf(params, s)));
    this.params = params;
  }

  protected createRun(spec: UB0Spec): Run<UB0Result> {
    return new InstrumentRun(spec);
  }

  /** JSON-able state: finished runs and the current run's UB0Run checkpoint. */
  checkpoint(): UBInstrumentCheckpoint {
    const run = this.done ? null : (this.currentRun() as InstrumentRun);
    return { format: 'pfad-ub-instrument-checkpoint/1', params: this.params, index: this.index, steps: this.totalSteps, results: this.results.slice(), run: run ? run.run.checkpoint() : null };
  }

  static resume(c: UBInstrumentCheckpoint): UBInstrumentExperiment {
    if (c.format !== 'pfad-ub-instrument-checkpoint/1') throw new Error('not a UB instrument checkpoint');
    const x = new UBInstrumentExperiment(c.params);
    x.results.push(...c.results);
    x.index = c.index;
    x.totalSteps = c.steps;
    if (c.run && c.index < x.specs.length) x.current = new InstrumentRun(x.specs[c.index], c.run);
    return x;
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const perSeed = this.results.map((r) => estimateRun(p, r));
    const keys = [...new Set(perSeed.flatMap((e) => Object.keys(e)))].filter((k) => k !== 'Nc');
    const ensemble: Record<string, Estimate> = {};
    for (const k of keys) ensemble[k] = independentEstimate(perSeed.map((e) => e[k]).filter((v) => Number.isFinite(v)));
    const spec0 = this.specs[0];
    const map = mapOf(spec0);
    const dom = domainOf(spec0, map);
    const config = simConfigOf(spec0, map, 'measure');
    const halted = this.results.filter((r) => Object.values(r.phaseLedgers as Record<string, { halted?: boolean }>).some((l) => l.halted)).length;
    const acceptance: AcceptanceCheck[] = [];
    const status = combineStatus(acceptance);
    const area = (dom.xmax - dom.xmin) * (dom.ymax - dom.ymin);
    const parcels = this.results[0]?.info.parcels ?? Math.round((p.phi / map.parcelArea) * area);
    const time = this.results.reduce((s, r) => s + r.measureTime, 0);
    return {
      ...recordHeader('ub-instrument', `UB-0 instrument, Universe A (N_c = 1): ${p.kind}`, p.seeds),
      particleCount: parcels,
      particleScale: { radius: map.radius, diameter: map.diameter, mass: map.mass },
      density: { numberDensity: p.phi / map.parcelArea, massDensity: (p.phi / map.parcelArea) * map.mass, areaFraction: p.phi },
      temperature: { kT: map.kT, definition: 'kT = 1 (molecular units); prepared by one global rescale for periodic kinds (A1 §4.2), then free dynamics' },
      speed: p.kind === 'couette' ? p.wallSpeed * map.sigmaV : null,
      geometry: p.kind === 'wall' || p.kind === 'couette' ? `periodic-x channel ${p.width} × ${p.height} D` : `periodic square L = ${p.L} D`,
      wallModel: p.kind === 'wall' || p.kind === 'couette' ? 'diffuse (Aw = 1) walls at kT = 1' : 'none (periodic)',
      accommodation: p.kind === 'wall' || p.kind === 'couette' ? 1 : 0,
      restitution: 1,
      occupancyModel: 'none (N_c = 1)',
      ks: 0,
      timestep: config.timestep,
      domain: dom,
      duration: { time, steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: { simulation: null, effective: null, physical: null, note: 'not computed for instrument runs' },
      mach: { Mp: null, benchmark: null, note: 'not computed for instrument runs' },
      results: { kind: p.kind, units: 'molecular units (m = d = kT = 1); ν and D_self in D·σ_v, durations in D/σ_v', ensemble, perSeed },
      uncertainty: { method: 'seed ensemble: mean ± SE over independent seeds (t-based 95 % CI)', seeds: p.seeds.length },
      convergence: { status: 'NOT ASSESSED', note: 'no timestep, size or duration study in this run' },
      benchmarks: {},
      assumptions: [
        'Universe A (N_c = 1): hard disks only, no occupancy force, no reservoir, e = 1.',
        'Exploratory instrument run outside the UB-0 protocol: not judged, not pooled with Stage 0/0b, no acceptance criteria.',
        'Estimators are those of src/universeB/UB0Estimators.ts with the design time scales τ_D and L/c_lo of UB0Plans.',
      ],
      acceptance,
      status,
      warnings: halted ? [`${halted} run(s) had a halted phase (safety failure); their estimates are unreliable`] : [],
      safetyFlags: this.results.flatMap((r) => Object.values(r.phaseLedgers as Record<string, { flags?: [] }>).flatMap((l) => l.flags ?? [])),
      config: p,
    };
  }
}
