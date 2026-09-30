import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import type { Simulation } from '../core/Simulation';
import { MODEL_COMPONENTS, PFAD_MODEL_VERSION } from '../core/version';
import type { AcceptanceCheck, ValidationStatus } from '../validation/Status';

export type ExperimentType =
  | 'static-box'
  | 'energy'
  | 'thermal'
  | 'wall-accommodation'
  | 'sound-speed'
  | 'sound-speed-sweeps'
  | 'viscosity'
  | 'viscosity-sweeps'
  | 'boundary-layer'
  | 'separation'
  | 'kutta'
  | 'scaling'
  | 'ab-test';

/**
 * Serializable experiment record (Master prompt §24, Bible §33).
 *
 * `results` holds MEASURED quantities only. Classical reference values live in
 * `benchmarks`, separately, and never feed back into a run. `config` holds the
 * complete experiment parameters, so `runFromRecord` regenerates the
 * experiment; with the same model version the replay is bit-for-bit.
 */
export interface ExperimentRecord {
  experimentId: string;
  experimentType: ExperimentType;
  title: string;
  modelVersion: string;
  modelComponents: Record<string, string>;
  seed: number;
  seeds: number[];
  timestamp: string;
  particleCount: number;
  particleScale: { radius: number; diameter: number; mass: number };
  density: { numberDensity: number; massDensity: number; areaFraction: number };
  temperature: { kT: number; definition: string };
  speed: number | null;
  geometry: string;
  wallModel: string;
  accommodation: number | Record<string, number>;
  restitution: number | number[];
  occupancyModel: string;
  ks: number;
  timestep: TimestepPolicy;
  domain: DomainSpec;
  duration: { time: number; steps: number; collisionsPerParticle: number };
  reynolds: { simulation: number | null; effective: number | null; physical: number | null; note: string };
  mach: { Mp: number | null; benchmark: number | null; note: string };
  results: Record<string, unknown>;
  uncertainty: Record<string, unknown>;
  convergence: { status: ValidationStatus | 'NOT ASSESSED'; note: string; studies?: unknown };
  benchmarks: Record<string, unknown>;
  assumptions: string[];
  acceptance: AcceptanceCheck[];
  status: ValidationStatus;
  warnings: string[];
  safetyFlags: SafetyFlag[];
  config: unknown;
}

export function recordHeader(type: ExperimentType, title: string, seeds: number[]) {
  const timestamp = new Date().toISOString();
  return {
    experimentId: `${type}-${timestamp.replace(/[:.]/g, '-')}-s${seeds.join('_')}`,
    experimentType: type,
    title,
    modelVersion: PFAD_MODEL_VERSION,
    modelComponents: { ...MODEL_COMPONENTS } as Record<string, string>,
    seed: seeds[0],
    seeds,
    timestamp,
  };
}

/** One simulation run inside an experiment. */
export interface Run<R> {
  readonly label: string;
  readonly sim: Simulation;
  readonly done: boolean;
  /** advance by at most maxSteps; returns steps taken */
  advance(maxSteps: number): number;
  /** 0..1 */
  progress(): number;
  /** small set of live numbers for the UI */
  live(): Record<string, number | string>;
  result(): R;
}

/**
 * An experiment = an ordered list of run specifications (configurations ×
 * seeds) executed one after another, then analysed together.
 * The same object is driven headless by the CLI and step-wise by the UI worker.
 */
export abstract class SequentialExperiment<Spec, R> {
  abstract readonly type: ExperimentType;
  readonly specs: Spec[];
  readonly results: R[] = [];
  private current: Run<R> | null = null;
  private index = 0;
  private totalSteps = 0;

  constructor(specs: Spec[]) {
    if (specs.length === 0) throw new Error('experiment has no runs');
    this.specs = specs;
  }

  protected abstract createRun(spec: Spec, index: number): Run<R>;
  abstract buildRecord(): ExperimentRecord;

  get done(): boolean {
    return this.index >= this.specs.length;
  }

  get runIndex(): number {
    return this.index;
  }

  get steps(): number {
    return this.totalSteps;
  }

  currentRun(): Run<R> | null {
    if (this.done) return null;
    if (!this.current) this.current = this.createRun(this.specs[this.index], this.index);
    return this.current;
  }

  /** Advance the experiment by at most maxSteps simulation steps. */
  advance(maxSteps: number): number {
    let taken = 0;
    while (taken < maxSteps && !this.done) {
      const run = this.currentRun()!;
      const k = run.advance(maxSteps - taken);
      taken += k;
      if (!run.done && k === 0) break; // a run must either step or finish
      if (run.done) {
        this.results.push(run.result());
        this.current = null;
        this.index++;
      }
    }
    this.totalSteps += taken;
    return taken;
  }

  /** Run one specification to completion, independently of the others (parallel execution). */
  runSpecToCompletion(i: number, chunk = 5000): R {
    const run = this.createRun(this.specs[i], i);
    while (!run.done) {
      const k = run.advance(chunk);
      if (!run.done && k === 0) break;
    }
    return run.result();
  }

  /** Install results computed elsewhere (e.g. worker threads), in specification order. */
  setResults(results: R[]): void {
    if (results.length !== this.specs.length) throw new Error(`expected ${this.specs.length} results, got ${results.length}`);
    this.results.length = 0;
    this.results.push(...results);
    this.current = null;
    this.index = this.specs.length;
  }

  progress(): number {
    if (this.done) return 1;
    const run = this.currentRun();
    return (this.index + (run ? run.progress() : 0)) / this.specs.length;
  }

  /** Headless execution (CLI, tests). */
  runToCompletion(onProgress?: (fraction: number, label: string) => void, chunk = 2000): ExperimentRecord {
    let lastReport = -1;
    while (!this.done) {
      this.advance(chunk);
      if (onProgress) {
        const p = Math.floor(this.progress() * 100);
        if (p !== lastReport) {
          lastReport = p;
          onProgress(this.progress(), this.currentRun()?.label ?? 'analysis');
        }
      }
    }
    return this.buildRecord();
  }
}
