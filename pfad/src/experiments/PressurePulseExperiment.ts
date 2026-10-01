import { aggregateEmptySpace, EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { hendersonCompressibility, idealSoundSpeed2D } from '../benchmarks/KineticTheory';
import type { ContactResolution, DissipationTarget } from '../core/CollisionModel';
import { SoftContactForce } from '../core/DeformationModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import { ParticleStore } from '../core/ParticleStore';
import type { SafetyFlag } from '../core/Safety';
import { Simulation, type ForceModel } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { ensembleProfiles, jackknife, profileNoise, trackPulse, type PulseTrack } from '../measurements/PulseAnalysis';
import { chi2UpperP, difference, linearRegression, mean, weightedLinearFit, type Estimate } from '../measurements/Statistics';
import { OccupancyForce } from '../occupancy/OccupancyModel';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * PRESSURE PULSE / DISTURBANCE PROPAGATION (Master prompt §14, Bible §12).
 *
 * A periodic box (length L along x, height H along y) of uniform gas.
 * Phase 1 (equilibration, `equilibrationTime`): the uniform gas relaxes — this
 * removes the potential energy of the random initial placement (occupancy,
 * soft contact) and fills the Universe B reservoir in place. Peculiar
 * velocities are then rescaled once to the target kT (documented, A-04).
 * Phase 2 (pulse), one of:
 *   'density' — extra particles (fractional excess A) are inserted into a
 *               central slab of width w by random addition among the existing
 *               ones (no overlaps), Maxwellian at the current kT, internal
 *               energy = current mean (Universe B);
 *   'kick'    — slab particles receive an outward velocity kick ±U.
 * Two pulses run outward. The pulse phase starts a fresh energy ledger.
 *
 * Tracked signal: the OUTWARD MOMENTUM DENSITY j(x, t) = Σ m v_x / A_bin
 * (y-averaged), folded onto one outward coordinate (right half +j, mirrored
 * left half −j) and averaged over seeds, then tracked by template matching
 * (measurements/PulseAnalysis). Momentum rather than number density, because
 * an isothermal density excess also leaves a stationary entropy mode (excess
 * density at lower temperature, no momentum) that masks the travelling pulse
 * in n(x, t); this was observed and is reported as `sourceResidualDensity`.
 * Density profiles are recorded too. c_p is MEASURED from particle data only.
 *
 * Model configurations (Master prompt §13):
 *   A  collision pressure only (Universe A)
 *   B  collisions + occupancy force (ks, h)
 *   C  inelastic parcels + internal reservoir with release (Universe B)
 *   D  inelastic parcels (energy leaves the model) + occupancy
 *   E  inelastic parcels + reservoir + occupancy
 * plus soft-contact (stiffness K) and occupancy-only configurations.
 *
 * The internal/kinetic energy ratio of Universe B at the end of phase 1 is
 * recorded, with a steadiness check (last two quarters of phase 1).
 */
export interface PulseModel {
  collisions: boolean;
  restitution: number;
  dissipationTarget: DissipationTarget;
  reservoirRelease: number;
  occupancy: null | { ks: number; h: number };
  softContactK: null | number;
}

export interface PulseCase {
  label: string;
  model: PulseModel;
  areaFraction: number;
  kT: number;
  radius: number;
  mass: number;
  perturbation: 'density' | 'kick';
  /** 'density': fractional density excess A in the slab; 'kick': outward velocity U */
  amplitude: number;
  slabWidth: number;
  /** phase-1 relaxation of the uniform gas (time units) */
  equilibrationTime: number;
  /** rescale peculiar velocities to kT after phase 1 */
  rescaleAfterEquilibration: boolean;
  length: number;
  height: number;
  duration: number;
  snapshotInterval: number;
  binWidth: number;
  timestep?: TimestepPolicy;
  seeds?: number[];
}

export interface PulseParams {
  cases: PulseCase[];
  seeds: number[];
  contact: ContactResolution;
  timestep: TimestepPolicy;
  /** relative energy-ledger residual allowed for force-integrated models */
  forceEnergyTolerance: number;
  /** which cases form the ks = m c_p²/φ₀ calibration (occupancy-only) */
  calibrationGroup?: string;
  /**
   * Cases forming an amplitude series (same model, φ, width; different
   * amplitude). The record then reports c_p extrapolated to zero amplitude by
   * a weighted linear fit of c_p against amplitude (the linear limit).
   */
  linearLimit?: { caseIndices: number[] };
}

export const MODEL_A: PulseModel = { collisions: true, restitution: 1, dissipationTarget: 'external', reservoirRelease: 0, occupancy: null, softContactK: null };
const OCC = { ks: 20, h: 4 };
export const MODEL_B: PulseModel = { ...MODEL_A, occupancy: OCC };
export const MODEL_C: PulseModel = { ...MODEL_A, restitution: 0.9, dissipationTarget: 'internal', reservoirRelease: 0.5 };
export const MODEL_D: PulseModel = { ...MODEL_A, restitution: 0.9, dissipationTarget: 'external', occupancy: OCC };
export const MODEL_E: PulseModel = { ...MODEL_C, occupancy: OCC };

// φ = 0.2: Enskog mean free path ≈ 1 diameter, so the 20-wide pulse is ≈ 20 λ.
// (λ ≈ 2.4 at φ = 0.1 and ≈ 5.1 at φ = 0.05.) An early version tracked number
// density; at φ = 0.1 the stationary entropy mode left at the source masked the
// travelling pulse, which is why the tracked signal is the momentum density.
const BASE_CASE: Omit<PulseCase, 'label' | 'model'> = {
  areaFraction: 0.2,
  kT: 1,
  radius: 0.5,
  mass: 1,
  perturbation: 'density',
  amplitude: 0.5,
  slabWidth: 20,
  equilibrationTime: 60,
  rescaleAfterEquilibration: true,
  length: 400,
  height: 60,
  duration: 100,
  snapshotInterval: 1,
  binWidth: 4,
};

export const PULSE_REFERENCE: PulseParams = {
  cases: [
    { ...BASE_CASE, label: 'A: collisions only', model: MODEL_A },
    { ...BASE_CASE, label: 'B: collisions + occupancy', model: MODEL_B },
    { ...BASE_CASE, label: 'C: parcels + reservoir', model: MODEL_C },
    { ...BASE_CASE, label: 'D: parcels + occupancy', model: MODEL_D },
    { ...BASE_CASE, label: 'E: parcels + reservoir + occupancy', model: MODEL_E },
  ],
  seeds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56],
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 0.05, dtMin: 1e-7 },
  forceEnergyTolerance: 1e-3,
};

const occOnly = (ks: number): PulseModel => ({ ...MODEL_A, collisions: false, occupancy: { ks, h: 4 } });
const soft = (K: number): PulseModel => ({ ...MODEL_A, collisions: false, softContactK: K });
const softDt = (K: number): TimestepPolicy => ({ kind: 'fixed', dt: SoftContactForce.contactTime(K, 1) / 25 });

/**
 * Linear-limit series (Collisions only, φ = 0.2): the reference sweeps showed
 * the tracked speed rising with pulse amplitude and width (finite-amplitude
 * propagation). Amplitudes 0.1–0.5 at width 20 are extrapolated to zero
 * amplitude; widths 10 and 40 at amplitude 0.2 test width dependence near the
 * linear regime. Taller strip (120) and 24 seeds for the weak pulses.
 */
export const PULSE_LINEAR: PulseParams = {
  ...PULSE_REFERENCE,
  seeds: Array.from({ length: 24 }, (_, k) => 401 + k),
  cases: [
    ...[0.1, 0.2, 0.3, 0.5].map((a) => ({ ...BASE_CASE, label: `A amplitude ${a}`, model: MODEL_A, amplitude: a, height: 120 })),
    { ...BASE_CASE, label: 'A amplitude 0.2, width 10', model: MODEL_A, amplitude: 0.2, height: 120, slabWidth: 10 },
    { ...BASE_CASE, label: 'A amplitude 0.2, width 40', model: MODEL_A, amplitude: 0.2, height: 120, slabWidth: 40 },
  ],
  linearLimit: { caseIndices: [0, 1, 2, 3] },
};

export const PULSE_SWEEPS: PulseParams = {
  ...PULSE_REFERENCE,
  seeds: [61, 62, 63, 64, 65, 66, 67, 68],
  calibrationGroup: 'calibration',
  cases: [
    { ...BASE_CASE, label: 'A φ=0.05', model: MODEL_A, areaFraction: 0.05, duration: 120 },
    { ...BASE_CASE, label: 'A φ=0.1', model: MODEL_A, areaFraction: 0.1, duration: 110 },
    { ...BASE_CASE, label: 'A φ=0.2', model: MODEL_A },
    { ...BASE_CASE, label: 'A φ=0.3', model: MODEL_A, areaFraction: 0.3, duration: 80 },
    { ...BASE_CASE, label: 'A amplitude 0.25', model: MODEL_A, amplitude: 0.25 },
    { ...BASE_CASE, label: 'A amplitude 1.0', model: MODEL_A, amplitude: 1 },
    { ...BASE_CASE, label: 'A velocity kick 0.5 (other perturbation)', model: MODEL_A, perturbation: 'kick', amplitude: 0.5 },
    { ...BASE_CASE, label: 'A width 10', model: MODEL_A, slabWidth: 10 },
    { ...BASE_CASE, label: 'A width 40', model: MODEL_A, slabWidth: 40 },
    { ...BASE_CASE, label: 'A particle radius 0.35', model: MODEL_A, radius: 0.35 },
    { ...BASE_CASE, label: 'A particle radius 0.25', model: MODEL_A, radius: 0.25 },
    { ...BASE_CASE, label: 'B kT=0.25', model: MODEL_B, kT: 0.25, duration: 120, equilibrationTime: 120 },
    { ...BASE_CASE, label: 'B kT=4', model: MODEL_B, kT: 4, duration: 60, equilibrationTime: 30 },
    { ...BASE_CASE, label: 'soft K=100', model: soft(100), timestep: softDt(100) },
    { ...BASE_CASE, label: 'soft K=1000', model: soft(1000), timestep: softDt(1000) },
    { ...BASE_CASE, label: 'soft K=10000', model: soft(10000), timestep: softDt(10000), seeds: [61, 62, 63, 64] },
    { ...BASE_CASE, label: 'calibration occupancy-only ks=5', model: occOnly(5), kT: 0.05, duration: 220, equilibrationTime: 150 },
    { ...BASE_CASE, label: 'calibration occupancy-only ks=20', model: occOnly(20), kT: 0.05, duration: 120, equilibrationTime: 100 },
    { ...BASE_CASE, label: 'calibration occupancy-only ks=80', model: occOnly(80), kT: 0.05, duration: 70, equilibrationTime: 60 },
  ],
};

interface Spec {
  caseIndex: number;
  seed: number;
}

export interface PulseRunResult {
  /** no-empty-space summary over the pulse phase (Master prompt §20) */
  emptySpace: EmptySpaceSummary | null;
  caseIndex: number;
  seed: number;
  times: number[];
  /** folded outward momentum-density profiles j(x', t) (tracked signal) */
  outward: number[][];
  /** folded density-excess profiles δn(x', t) */
  outwardDensity: number[][];
  meanDensity: number;
  kTStart: number;
  kTEnd: number;
  internalPerParticleStart: number;
  internalPerParticleEnd: number;
  /** phase 1: internal/kinetic energy ratio samples and the kT before the rescale */
  equilibration: { ratio: number[]; kTBeforeRescale: number; settled: boolean; energyResidual: number };
  count: number;
  conservation: ReturnType<ConservationMonitor['summary']>;
  safetyFlags: SafetyFlag[];
  halted: boolean;
}

type Result = PulseRunResult;

function forceModels(m: PulseModel): ForceModel[] {
  const f: ForceModel[] = [];
  if (m.occupancy && m.occupancy.ks > 0) f.push(new OccupancyForce(m.occupancy));
  if (m.softContactK) f.push(new SoftContactForce(m.softContactK));
  return f;
}

function simConfig(p: PulseParams, c: PulseCase, domain: DomainSpec, seed: number) {
  const hasForces = !!(c.model.occupancy?.ks || c.model.softContactK);
  return {
    domain,
    walls: [],
    collision: {
      enabled: c.model.collisions,
      restitution: c.model.restitution,
      contact: p.contact,
      dissipationTarget: c.model.dissipationTarget,
      reservoirRelease: c.model.reservoirRelease,
    },
    timestep: c.timestep ?? p.timestep,
    seed,
    referenceKT: c.kT,
    safety: {
      energyTolerance: hasForces ? p.forceEnergyTolerance : 1e-6,
      // soft contact: overlaps are the model, not an error; the overlap check is for rigid contact
      ...(c.model.softContactK ? { overlapWarning: 10, overlapFailure: 10 } : {}),
    },
  };
}

/** One pulse run: phase 1 equilibration, rescale, perturbation, phase 2. Exported so measurement-only subclasses reuse the identical physics. */
export class PulseRun implements Run<Result> {
  readonly label: string;
  done = false;
  protected phase: 'equilibrate' | 'pulse' = 'equilibrate';
  private sim1: Simulation;
  private sim2: Simulation | null = null;
  private readonly p: PulseParams;
  protected readonly c: PulseCase;
  private readonly caseIndex: number;
  private readonly seed: number;
  protected readonly store: ParticleStore;
  private readonly domain: DomainSpec;
  protected readonly times: number[] = [];
  private readonly outward: number[][] = [];
  private readonly outwardDensity: number[][] = [];
  private conservation: ConservationMonitor | null = null;
  private empty: EmptySpaceMonitor | null = null;
  protected readonly meanDensity: number;
  protected readonly extra: number;
  private kTStart = Number.NaN;
  private intStart = Number.NaN;
  private kTBeforeRescale = Number.NaN;
  private readonly ratio: number[] = [];
  private nextRatioSample = 0;
  protected nextSnapshot = 0;

  constructor(p: PulseParams, caseIndex: number, seed: number) {
    const c = p.cases[caseIndex];
    this.p = p;
    this.c = c;
    this.caseIndex = caseIndex;
    this.seed = seed;
    this.label = `pulse: ${c.label} seed=${seed}`;
    this.domain = { xmin: 0, xmax: c.length, ymin: 0, ymax: c.height, periodicX: true, periodicY: true };
    const n0 = c.areaFraction / (Math.PI * c.radius * c.radius);
    this.extra = c.perturbation === 'density' ? Math.round(c.amplitude * n0 * c.slabWidth * c.height) : 0;
    const { store } = createGas({
      count: Math.round(n0 * c.length * c.height),
      radius: c.radius,
      mass: c.mass,
      kT: c.kT,
      distribution: 'maxwell',
      seed,
      domain: this.domain,
      extraCapacity: this.extra,
    });
    this.store = store;
    this.meanDensity = (store.count + this.extra) / (c.length * c.height);
    this.sim1 = new Simulation(simConfig(p, c, this.domain, seed), store, forceModels(c.model));
  }

  get sim(): Simulation {
    return this.sim2 ?? this.sim1;
  }

  private startPulse(): void {
    const c = this.c;
    const s = this.store;
    this.kTBeforeRescale = s.kineticEnergy() / s.count;
    if (c.rescaleAfterEquilibration && this.kTBeforeRescale > 0) {
      const f = Math.sqrt(c.kT / this.kTBeforeRescale);
      const P = s.momentum();
      const ux = P.x / s.totalMass();
      const uy = P.y / s.totalMass();
      for (let i = 0; i < s.count; i++) {
        s.vx[i] = ux + (s.vx[i] - ux) * f;
        s.vy[i] = uy + (s.vy[i] - uy) * f;
      }
    }
    const xc = c.length / 2;
    if (c.perturbation === 'kick') {
      for (let i = 0; i < s.count; i++) {
        const d = s.x[i] - xc;
        if (Math.abs(d) < c.slabWidth / 2) s.vx[i] += d >= 0 ? c.amplitude : -c.amplitude;
      }
    } else if (this.extra > 0) {
      const first = s.count;
      const eMean = s.internalEnergy() / s.count;
      createGas(
        {
          count: this.extra,
          radius: c.radius,
          mass: c.mass,
          kT: s.kineticEnergy() / s.count,
          distribution: 'maxwell',
          seed: this.seed * 8 + 2,
          domain: this.domain,
          region: { xmin: xc - c.slabWidth / 2, xmax: xc + c.slabWidth / 2, ymin: 0, ymax: c.height },
        },
        s,
      );
      for (let i = first; i < s.count; i++) s.energy[i] = eMean;
    }
    this.kTStart = s.kineticEnergy() / s.count;
    this.intStart = s.internalEnergy() / s.count;
    // fresh simulation (and ledger) for the pulse phase; same particles, derived seed
    this.sim2 = new Simulation(simConfig(this.p, c, this.domain, this.seed * 8 + 1), s, forceModels(c.model));
    this.conservation = new ConservationMonitor(this.sim2);
    this.empty = new EmptySpaceMonitor(this.sim2);
    this.phase = 'pulse';
    this.snapshot();
  }

  protected snapshot() {
    const c = this.c;
    const nb = Math.round(c.length / c.binWidth);
    const counts = new Array<number>(nb).fill(0);
    const mom = new Array<number>(nb).fill(0);
    const { x, vx, mass } = this.store;
    for (let i = 0; i < this.store.count; i++) {
      let b = Math.floor(x[i] / c.binWidth);
      if (b < 0) b = 0;
      else if (b >= nb) b = nb - 1;
      counts[b]++;
      mom[b] += mass[i] * vx[i];
    }
    const area = c.binWidth * c.height;
    const dn = counts.map((k) => k / area - this.meanDensity);
    const j = mom.map((p) => p / area);
    // fold: bins right of centre, and mirrored bins left of centre (outward = +x on the right, −x on the left)
    const half = nb / 2;
    const outN: number[] = [];
    const outJ: number[] = [];
    for (let q = 0; q < half; q++) {
      outN.push(0.5 * (dn[half + q] + dn[half - 1 - q]));
      outJ.push(0.5 * (j[half + q] - j[half - 1 - q]));
    }
    this.outwardDensity.push(outN);
    this.outward.push(outJ);
    this.times.push(this.sim.time);
    this.nextSnapshot = this.sim.time + c.snapshotInterval;
  }

  advance(maxSteps: number): number {
    let k = 0;
    while (k < maxSteps && !this.done) {
      const sim = this.sim;
      if (!sim.step()) {
        this.done = true;
        break;
      }
      k++;
      if (this.phase === 'equilibrate') {
        if (sim.time >= this.nextRatioSample) {
          const ke = this.store.kineticEnergy();
          this.ratio.push(ke > 0 ? this.store.internalEnergy() / ke : 0);
          this.nextRatioSample += this.c.equilibrationTime / 40;
        }
        if (sim.time >= this.c.equilibrationTime) this.startPulse();
        continue;
      }
      if (sim.time >= this.nextSnapshot) {
        this.snapshot();
        this.conservation!.sample();
        this.empty!.sample();
      }
      if (sim.time >= this.c.duration) this.done = true;
    }
    return k;
  }

  progress() {
    const c = this.c;
    const t = this.phase === 'equilibrate' ? this.sim.time : c.equilibrationTime + this.sim.time;
    return Math.min(1, t / (c.equilibrationTime + c.duration));
  }

  live() {
    return {
      phase: this.phase,
      time: this.sim.time,
      kT: this.store.kineticEnergy() / this.store.count,
      internalOverKinetic: this.store.internalEnergy() / Math.max(1e-300, this.store.kineticEnergy()),
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): PulseRunResult {
    this.sim.checkSafety();
    const r = this.ratio;
    const q = Math.floor(r.length / 4);
    const m3 = mean(r.slice(r.length - 2 * q, r.length - q));
    const m4 = mean(r.slice(r.length - q));
    const flags = [...this.sim1.flags, ...(this.sim2?.flags ?? [])];
    const cons = this.conservation ?? new ConservationMonitor(this.sim);
    return {
      emptySpace: this.empty ? this.empty.summary() : null,
      caseIndex: this.caseIndex,
      seed: this.seed,
      times: this.times,
      outward: this.outward,
      outwardDensity: this.outwardDensity,
      meanDensity: this.meanDensity,
      kTStart: this.kTStart,
      kTEnd: this.store.kineticEnergy() / this.store.count,
      internalPerParticleStart: this.intStart,
      internalPerParticleEnd: this.store.internalEnergy() / this.store.count,
      equilibration: {
        ratio: r,
        kTBeforeRescale: this.kTBeforeRescale,
        settled: q < 1 || m4 === 0 || Math.abs(m3 - m4) <= 0.05 * Math.abs(m4),
        energyResidual: this.sim1.relativeEnergyResidual(),
      },
      count: this.store.count,
      conservation: cons.summary(),
      safetyFlags: flags,
      halted: this.sim1.halted || !!this.sim2?.halted,
    };
  }
}

export interface CaseAnalysis {
  label: string;
  model: PulseModel;
  case: Omit<PulseCase, 'model'>;
  seeds: number;
  track: Omit<PulseTrack, 'times' | 'shifts' | 'amplitudes' | 'widths' | 'peakPositions'> & {
    times: number[];
    shifts: number[];
    amplitudes: number[];
    widths: number[];
  };
  speed: Estimate | null;
  speedLeaveOneOut: number[];
  /**
   * Ambiguous tracking: a leave-one-seed-out speed differs from the median of
   * the leave-one-out speeds by more than 10 % — different seed subsets lock
   * onto different features, so the full-ensemble speed is not a single
   * feature's speed.
   */
  tracking: { ambiguous: boolean; looMedian: number; looMaxRelDeviation: number };
  attenuation: { value: number; se: number };
  widthGrowth: { value: number; se: number };
  kTStart: number;
  kTEnd: number;
  internalOverKinetic: number | null;
  kTBeforeRescale: number;
  equilibrationSettled: boolean;
  energyResidualMax: number;
  /** seed-averaged outward momentum density at four times */
  profileSnapshots: { t: number; profile: number[] }[];
  /** seed-averaged density excess at the same times */
  densitySnapshots: { t: number; profile: number[] }[];
  /** density excess remaining in the source region at the end (entropy-mode signature) / initial */
  sourceResidualDensity: number;
}

/** Leave-one-out spread test for ambiguous tracking (threshold fixed at 10 % of the median). */
export function trackingAmbiguity(loo: number[]): { ambiguous: boolean; looMedian: number; looMaxRelDeviation: number } {
  const v = loo.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 3) return { ambiguous: false, looMedian: Number.NaN, looMaxRelDeviation: Number.NaN };
  const med = v.length % 2 ? v[(v.length - 1) / 2] : 0.5 * (v[v.length / 2 - 1] + v[v.length / 2]);
  const dev = Math.max(...v.map((x) => Math.abs(x - med))) / Math.abs(med);
  return { ambiguous: dev > 0.1 || v.length < loo.length, looMedian: med, looMaxRelDeviation: dev };
}

export class PressurePulseExperiment extends SequentialExperiment<Spec, Result> {
  readonly type: 'sound-speed' | 'sound-speed-sweeps' | 'sound-speed-linear';
  readonly params: PulseParams;

  constructor(p: PulseParams, type: 'sound-speed' | 'sound-speed-sweeps' | 'sound-speed-linear' = 'sound-speed') {
    const specs: Spec[] = [];
    p.cases.forEach((c, i) => {
      for (const seed of c.seeds ?? p.seeds) specs.push({ caseIndex: i, seed });
    });
    super(specs);
    this.params = p;
    this.type = type;
  }

  protected createRun(spec: Spec): Run<Result> {
    return new PulseRun(this.params, spec.caseIndex, spec.seed);
  }

  analyseCase(i: number): CaseAnalysis | null {
    const c = this.params.cases[i];
    const runs = this.results.filter((r) => r.caseIndex === i && !r.halted);
    if (runs.length === 0) return null;
    const times = runs[0].times;
    const perSeed = runs.map((r) => r.outward);
    const startBeyond = c.slabWidth / 2 + c.binWidth;
    const maxPos = c.length / 2 - c.binWidth;
    const halfWindow = Math.max(c.slabWidth, 3 * c.binWidth);
    // noise level: first snapshot, bins well beyond the source (seed-averaged → per-ensemble noise)
    const track = (prof: number[][]) =>
      trackPulse(prof, times, c.binWidth, startBeyond, maxPos, halfWindow, profileNoise(prof, c.binWidth, c.slabWidth + 2 * c.binWidth));
    const full = track(ensembleProfiles(perSeed));
    const jkSpeed = jackknife(perSeed, (p) => track(p).speed);
    const jkAtt = jackknife(perSeed, (p) => track(p).attenuationPerLength);
    const jkW = jackknife(perSeed, (p) => track(p).widthGrowthRate);
    const n = runs.length;
    const speed: Estimate | null = Number.isFinite(full.speed)
      ? {
          mean: full.speed,
          se: jkSpeed.se,
          ci95: [full.speed - 1.96 * jkSpeed.se, full.speed + 1.96 * jkSpeed.se],
          relHalfWidth: (1.96 * jkSpeed.se) / Math.abs(full.speed),
          sd: jkSpeed.se * Math.sqrt(n),
          n,
          nIndependent: n,
          method: 'ensemble',
          reliable: n >= 3 && full.valid,
        }
      : null;
    const ens = ensembleProfiles(perSeed);
    const ensN = ensembleProfiles(runs.map((r) => r.outwardDensity));
    const pick = [0, Math.floor(ens.length / 4), Math.floor(ens.length / 2), Math.floor((3 * ens.length) / 4)];
    const srcBins = Math.max(1, Math.round(c.slabWidth / 2 / c.binWidth));
    const srcSum = (prof: number[]) => prof.slice(0, srcBins).reduce((a, v) => a + v, 0);
    const sourceResidualDensity = ensN.length > 1 && srcSum(ensN[0]) !== 0 ? srcSum(ensN[ensN.length - 1]) / srcSum(ensN[0]) : Number.NaN;
    const { model, ...caseRest } = c;
    return {
      label: c.label,
      model,
      case: caseRest,
      seeds: n,
      track: {
        ...full,
        times: full.times,
        shifts: full.shifts,
        amplitudes: full.amplitudes,
        widths: full.widths,
      },
      speed,
      /** leave-one-seed-out speeds behind the jackknife SE (a spread here shows which subsets track differently) */
      speedLeaveOneOut: jkSpeed.leaveOneOut,
      tracking: trackingAmbiguity(jkSpeed.leaveOneOut),
      attenuation: { value: jkAtt.value, se: jkAtt.se },
      widthGrowth: { value: jkW.value, se: jkW.se },
      kTStart: mean(runs.map((r) => r.kTStart)),
      kTEnd: mean(runs.map((r) => r.kTEnd)),
      internalOverKinetic: mean(runs.map((r) => r.internalPerParticleStart)) / mean(runs.map((r) => r.kTStart)),
      kTBeforeRescale: mean(runs.map((r) => r.equilibration.kTBeforeRescale)),
      equilibrationSettled: runs.every((r) => r.equilibration.settled),
      energyResidualMax: Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual)),
      profileSnapshots: pick.map((k) => ({ t: times[k], profile: ens[k] })),
      densitySnapshots: pick.map((k) => ({ t: times[k], profile: ensN[k] })),
      sourceResidualDensity,
    };
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const cases = p.cases.map((_, i) => this.analyseCase(i));
    const runs = this.results;
    const halted = runs.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures',
      halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const empty = aggregateEmptySpace(runs.map((r) => r.emptySpace).filter((e): e is EmptySpaceSummary => e !== null));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region during the pulse (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
      empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));
    // energy accounting: exact for rigid, O(dt²) for force-integrated models
    const rigid = cases.filter((c) => c && !c.model.occupancy && !c.model.softContactK) as CaseAnalysis[];
    const forced = cases.filter((c) => c && (c.model.occupancy || c.model.softContactK)) as CaseAnalysis[];
    if (rigid.length) {
      const m = Math.max(...rigid.map((c) => c.energyResidualMax));
      checks.push(check('energy-accounting-rigid', 'Rigid-contact models close the energy ledger to round-off', 'max |relative residual| < 1e-9', m.toExponential(2), m < 1e-9));
    }
    if (forced.length) {
      const m = Math.max(...forced.map((c) => c.energyResidualMax));
      checks.push(check('energy-accounting-forces', 'Force-integrated models (occupancy, soft contact) conserve energy to the integrator accuracy',
        `max |relative residual| < ${p.forceEnergyTolerance}`, m.toExponential(2), m < p.forceEnergyTolerance));
    }
    const missing = cases.map((c, i) => (c ? null : p.cases[i].label)).filter(Boolean);
    const invalid = cases.filter((c) => c && !c.track.valid) as CaseAnalysis[];
    checks.push(check('pulse-tracked', 'A propagating pulse is identified and tracked in every case',
      'shift vs time linear with r² > 0.9 and ≥ 5 snapshots, in every case',
      invalid.length || missing.length ? `not tracked: ${[...missing, ...invalid.map((c) => `${c.label} (${c.track.reason})`)].join('; ')}` : 'all tracked',
      invalid.length === 0 && missing.length === 0, 'INCONCLUSIVE'));
    const ambiguous = cases.filter((c) => c && c.tracking.ambiguous) as CaseAnalysis[];
    checks.push(check('tracking-unambiguous', 'Every seed subset tracks the same feature',
      'every leave-one-seed-out speed within 10 % of their median, in every case',
      ambiguous.length ? ambiguous.map((c) => `${c.label}: max deviation ${(100 * c.tracking.looMaxRelDeviation).toFixed(0)} %`).join('; ') : 'unambiguous',
      ambiguous.length === 0, 'INCONCLUSIVE'));
    const imprecise = cases.filter((c) => c?.speed && !(c.speed.relHalfWidth < 0.05)) as CaseAnalysis[];
    checks.push(check('speed-precision', 'Disturbance speed measured precisely enough to compare models',
      '95 % CI half-width < 5 % in every case (jackknife over seeds)',
      imprecise.length ? imprecise.map((c) => `${c.label}: ${(100 * c.speed!.relHalfWidth).toFixed(1)} %`).join('; ') : 'all < 5 %',
      imprecise.length === 0, 'INCONCLUSIVE'));
    const reservoirCases = cases.filter((c) => c && c.model.dissipationTarget === 'internal') as CaseAnalysis[];
    if (reservoirCases.length) {
      const unsettled = reservoirCases.filter((c) => !c.equilibrationSettled);
      checks.push(check('reservoir-steady-state', 'Universe B reservoir reached a steady internal/kinetic energy ratio before the pulse',
        'last two quarters of phase 1 agree within 5 %', unsettled.length ? unsettled.map((c) => c.label).join('; ') : 'settled', unsettled.length === 0, 'NOT CONVERGED'));
    }

    // linear limit: c_p extrapolated to zero amplitude over the amplitude series
    let linearLimit: unknown = null;
    if (p.linearLimit) {
      const pts = p.linearLimit.caseIndices
        .map((i) => cases[i])
        .filter((c): c is CaseAnalysis => !!c && !!c.speed && c.track.valid && !c.tracking.ambiguous && c.speed.se > 0);
      if (pts.length >= 3) {
        const fit = weightedLinearFit(pts.map((c) => c.case.amplitude), pts.map((c) => c.speed!.mean), pts.map((c) => c.speed!.se));
        const pLin = chi2UpperP(fit.chi2, fit.dof);
        const rel = (1.96 * fit.seIntercept) / Math.abs(fit.intercept);
        linearLimit = {
          model: 'c_p(A) = c₀ + k·A, weighted least squares over the tracked, unambiguous cases of the amplitude series',
          c0: { mean: fit.intercept, se: fit.seIntercept, relHalfWidth95: rel },
          slope: { mean: fit.slope, se: fit.seSlope },
          chi2: fit.chi2,
          dof: fit.dof,
          linearityP: pLin,
          points: pts.map((c) => ({ label: c.label, amplitude: c.case.amplitude, speed: c.speed!.mean, se: c.speed!.se })),
        };
        checks.push(check('linear-limit-precision', 'Zero-amplitude disturbance speed extrapolated precisely',
          '95 % CI half-width of c₀ < 5 %, from ≥ 3 tracked amplitudes', `${(100 * rel).toFixed(1)} % from ${pts.length} amplitudes`, rel < 0.05, 'INCONCLUSIVE'));
        checks.push(check('linear-limit-linearity', 'c_p is linear in amplitude over the series (the extrapolation model fits)',
          'χ² p > 0.01', `p = ${pLin.toPrecision(3)}`, pLin > 0.01, 'INCONCLUSIVE'));
      } else {
        checks.push(check('linear-limit-precision', 'Zero-amplitude disturbance speed extrapolated precisely',
          '95 % CI half-width of c₀ < 5 %, from ≥ 3 tracked amplitudes', `only ${pts.length} usable amplitude(s)`, false, 'INCONCLUSIVE'));
      }
    }

    // model comparison (A/B style: difference, uncertainty) relative to case 0
    const ref = cases[0];
    const comparisons = cases.slice(1).map((c) =>
      c && c.speed && ref?.speed ? { label: c.label, versus: ref.label, ...difference(c.speed, ref.speed) } : null,
    );

    // ks = m c_p² / φ₀ calibration (occupancy-only cases)
    let ksCalibration: unknown = null;
    const occOnlyCases = cases.filter((c) => c && c.model.occupancy && !c.model.collisions && !c.model.softContactK && c.speed) as CaseAnalysis[];
    if (occOnlyCases.length >= 2) {
      const x = occOnlyCases.map((c) => (c.model.occupancy!.ks * c.case.areaFraction) / c.case.mass);
      const y = occOnlyCases.map((c) => c.speed!.mean ** 2);
      const reg = linearRegression(x, y);
      // through-origin slope
      const slope0 = x.reduce((a, xi, i) => a + xi * y[i], 0) / x.reduce((a, xi) => a + xi * xi, 0);
      ksCalibration = {
        hypothesis: 'k_s = m c_p² / φ₀  ⇔  c_p² = k_s φ₀ / m  (slope 1 through the origin)',
        points: occOnlyCases.map((c, i) => ({ label: c.label, ksPhiOverM: x[i], cp2: y[i], cp2Se: 2 * c.speed!.mean * c.speed!.se })),
        fit: { slope: reg.slope, seSlope: reg.seSlope, intercept: reg.intercept, seIntercept: reg.seIntercept, r2: reg.r2 },
        slopeThroughOrigin: slope0,
        note: 'Measured slope ≠ 1 means the relation does not describe this discretised occupancy universe at the tested temperature and kernel width; it is not adjusted to fit.',
      };
    }

    // benchmarks (comparison only)
    const bench = cases.map((c) => {
      if (!c) return null;
      const kT = c.kTStart;
      const phi = c.case.areaFraction;
      const Z = hendersonCompressibility(phi);
      const h = 1e-5;
      const dZ = (hendersonCompressibility(phi + h) - hendersonCompressibility(phi - h)) / (2 * h);
      const cHD = Math.sqrt((kT / c.case.mass) * (Z + phi * dZ + Z * Z));
      const cMF = c.model.occupancy ? Math.sqrt(cHD * cHD + (c.model.occupancy.ks * phi) / c.case.mass) : null;
      return {
        label: c.label,
        idealGas_sqrt2kT_m: idealSoundSpeed2D(kT, c.case.mass),
        hardDiskAdiabatic: c.model.collisions ? cHD : null,
        hardDiskPlusOccupancyMeanField: c.model.collisions ? cMF : null,
        occupancyMeanFieldOnly: c.model.occupancy && !c.model.collisions ? Math.sqrt((c.model.occupancy.ks * phi) / c.case.mass) : null,
        measured: c.speed?.mean ?? null,
      };
    });

    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`case ${r.caseIndex} seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    for (const c of cases) if (c && c.kTEnd < 0.9 * c.kTStart) warnings.push(`${c.label}: kinetic temperature fell from ${c.kTStart.toPrecision(3)} to ${c.kTEnd.toPrecision(3)} during the run (energy leaves this model); c_p is an average over a cooling gas.`);
    const c0 = p.cases[0];
    return {
      ...recordHeader(
        this.type,
        this.type === 'sound-speed'
          ? 'Pressure pulse: disturbance speed, models A–E'
          : this.type === 'sound-speed-linear'
            ? 'Pressure pulse: linear (zero-amplitude) limit'
            : 'Pressure pulse: sweeps (density, amplitude, width, particle scale, temperature, stiffness, k_s calibration)',
        p.seeds,
      ),
      particleCount: runs[0]?.count ?? 0,
      particleScale: { radius: c0.radius, diameter: 2 * c0.radius, mass: c0.mass },
      density: { numberDensity: c0.areaFraction / (Math.PI * c0.radius ** 2), massDensity: (c0.mass * c0.areaFraction) / (Math.PI * c0.radius ** 2), areaFraction: c0.areaFraction },
      temperature: { kT: c0.kT, definition: 'kT = KE/N (A-03)' },
      speed: null,
      geometry: `periodic box ${c0.length} × ${c0.height}; ${c0.perturbation === 'density' ? `density excess ${c0.amplitude}` : `outward kick ±${c0.amplitude}`} in a central slab of width ${c0.slabWidth}`,
      wallModel: 'none (periodic)',
      accommodation: 0,
      restitution: p.cases.map((c) => c.model.restitution),
      occupancyModel: p.cases.some((c) => c.model.occupancy) ? 'per case (see config)' : 'off',
      ks: Math.max(0, ...p.cases.map((c) => c.model.occupancy?.ks ?? 0)),
      timestep: p.timestep,
      domain: { xmin: 0, xmax: c0.length, ymin: 0, ymax: c0.height, periodicX: true, periodicY: true },
      duration: {
        time: runs.reduce((a, r) => a + (r.times[r.times.length - 1] ?? 0), 0),
        steps: this.steps,
        collisionsPerParticle: Number.NaN,
      },
      reynolds: { simulation: null, effective: null, physical: null, note: 'No mean flow.' },
      mach: {
        Mp: null,
        benchmark: null,
        note: 'This experiment MEASURES c_p. Later experiments report Mp = V/c_p using the c_p measured here for the matching configuration.',
      },
      results: {
        emptySpace: empty,
        linearLimit,
        cases,
        comparisonsToFirstCase: comparisons,
        ksCalibration,

      },
      uncertainty: { note: 'c_p, attenuation and width growth: jackknife over seeds of the seed-averaged profiles.' },
      convergence: { status: 'NOT ASSESSED', note: 'Resolution, width, amplitude and particle-scale dependence are cases of the sweep experiment.' },
      benchmarks: { note: 'Classical references for comparison only. Hard-disk adiabatic: c² = (kT/m)(Z + φZ′ + Z²), c_v = k, Henderson Z.', perCase: bench },
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07', 'A-13', 'A-15', 'A-16'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
