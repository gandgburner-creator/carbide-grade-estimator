import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas, type VelocityDistribution } from '../gas/InitialConditions';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { WallPressureSampler } from '../measurements/PressureEstimator';
import { ProfileSampler, type Profile } from '../measurements/ProfileSampler';
import { blockAverage, type Estimate } from '../measurements/Statistics';
import type { PlaneWallConfig } from '../walls/WallModel';
import type { Run } from './Experiment';

/**
 * Gas between two planar walls (bottom, top), periodic in x.
 * Used by the wall-accommodation and Couette experiments.
 *
 * Measured per window (fixed collisions per particle): normal pressure and
 * tangential stress on each wall (wall impulses only), gas kT, and a y-profile
 * snapshot. Wall tallies (hits, incident/emitted energy and tangential momentum,
 * diffuse hits) are differenced between measurement start and end.
 */
export interface ChannelWall extends Omit<PlaneWallConfig, 'side'> {}

export interface ChannelGasRunParams {
  count: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  distribution: VelocityDistribution;
  restitution: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  seed: number;
  /** channel height (wall to wall); width follows from N and φ */
  height: number;
  bottom: ChannelWall;
  top: ChannelWall;
  /** initial uniform flow velocity along x */
  flow?: number;
  equilibrationCollisions: number;
  measurementCollisions: number;
  windowCollisions: number;
  profileBins: number;
  /** record windows from t = 0 (transient studies) */
  recordFromStart?: boolean;
  maxTime: number;
  label?: string;
}

type Tally = ReturnType<Simulation['walls'][number]['totals']>;

export interface ChannelGasRunResult {
  label: string;
  seed: number;
  params: ChannelGasRunParams;
  geometry: { width: number; height: number; area: number; areaFraction: number; numberDensity: number };
  measurementStartCollisions: number;
  measurementStartTime: number;
  series: {
    c: number[];
    t: number[];
    kT: number[];
    bottomPressure: number[];
    topPressure: number[];
    bottomShear: number[];
    topShear: number[];
    bottomEnergyFlux: number[];
    topEnergyFlux: number[];
  };
  stress: null | {
    bottomPressure: Estimate;
    topPressure: Estimate;
    /** tangential stress ON the wall along +x */
    bottomShear: Estimate;
    topShear: Estimate;
    /** energy flux from the gas into each wall (per time per length) */
    bottomEnergyFlux: Estimate;
    topEnergyFlux: Estimate;
    /** τ_bottom + τ_top per window: zero in a steady state (x-momentum balance) */
    shearImbalance: Estimate;
    /** net energy flux into both walls per window: zero in a steady state */
    energyImbalance: Estimate;
    kT: number;
  };
  /** wall tallies accumulated during the measurement phase */
  walls: { bottom: Tally; top: Tally };
  measurementTime: number;
  profile: Profile | null;
  totals: { time: number; steps: number; collisionsPerParticle: number };
  conservation: ReturnType<ConservationMonitor['summary']>;
  collisions: ReturnType<Simulation['log']['summary']>;
  emptySpace: EmptySpaceSummary;
  safetyFlags: SafetyFlag[];
  halted: boolean;
  stopReason: string;
}

export class ChannelGasRun implements Run<ChannelGasRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: ChannelGasRunParams;
  private phase: 'equilibrate' | 'measure';
  private sampler: WallPressureSampler | null = null;
  private readonly profiles: ProfileSampler;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private readonly geometry: ChannelGasRunResult['geometry'];
  private startTally: { bottom: Tally; top: Tally } | null = null;
  private measureStartC = 0;
  private measureStartT = 0;
  private windows = 0;
  private steps = 0;
  private stopReason = '';

  constructor(p: ChannelGasRunParams) {
    this.p = p;
    this.label = p.label ?? `channel seed=${p.seed}`;
    const width = (p.count * Math.PI * p.radius * p.radius) / (p.areaFraction * p.height);
    const domain: DomainSpec = { xmin: 0, xmax: width, ymin: 0, ymax: p.height, periodicX: true, periodicY: false };
    const { store, info } = createGas({
      count: p.count,
      radius: p.radius,
      mass: p.mass,
      kT: p.kT,
      distribution: p.distribution,
      seed: p.seed,
      domain,
      flow: p.flow ? { x: p.flow, y: 0 } : undefined,
      placement: p.areaFraction > 0.35 ? 'lattice' : 'random',
    });
    this.sim = new Simulation(
      {
        domain,
        walls: [
          { side: 'bottom', ...p.bottom },
          { side: 'top', ...p.top },
        ],
        collision: { enabled: true, restitution: p.restitution, contact: p.contact, dissipationTarget: 'external' },
        timestep: p.timestep,
        seed: p.seed,
        referenceKT: Math.max(p.kT, p.bottom.temperature ?? 0, p.top.temperature ?? 0),
      },
      store,
    );
    this.geometry = {
      width,
      height: p.height,
      area: width * p.height,
      areaFraction: info.areaFraction,
      numberDensity: info.numberDensity,
    };
    this.profiles = new ProfileSampler(this.sim.domain, p.profileBins);
    this.conservation = new ConservationMonitor(this.sim);
    this.empty = new EmptySpaceMonitor(this.sim);
    this.phase = p.equilibrationCollisions > 0 && !p.recordFromStart ? 'equilibrate' : 'measure';
    if (this.phase === 'measure') this.startMeasurement();
    this.empty.sample();
  }

  private cpp(): number {
    return (2 * this.sim.log.count) / this.sim.store.count;
  }

  private startMeasurement(): void {
    this.phase = 'measure';
    this.measureStartC = this.cpp();
    this.measureStartT = this.sim.time;
    this.sampler = new WallPressureSampler(this.sim, this.p.windowCollisions);
    this.startTally = { bottom: this.sim.walls[0].totals(), top: this.sim.walls[1].totals() };
  }

  advance(maxSteps: number): number {
    let k = 0;
    const sim = this.sim;
    const p = this.p;
    while (k < maxSteps && !this.done) {
      if (!sim.step()) {
        this.finish('halted by safety monitor');
        break;
      }
      k++;
      this.steps++;
      const c = this.cpp();
      if (this.phase === 'equilibrate' && c >= p.equilibrationCollisions) this.startMeasurement();
      if (this.sampler && this.sampler.update()) {
        this.windows++;
        this.profiles.sample(sim.store);
        this.conservation.sample();
        if (this.windows % 4 === 0) this.empty.sample();
      }
      if (this.phase === 'measure' && c - this.measureStartC >= p.measurementCollisions) {
        this.finish('measurement collisions reached');
      }
      if (!this.done && sim.time >= p.maxTime) this.finish('maxTime reached');
    }
    return k;
  }

  private finish(reason: string): void {
    if (this.done) return;
    this.sim.checkSafety();
    if (this.sampler?.finish()) this.profiles.sample(this.sim.store);
    this.conservation.sample();
    this.empty.sample();
    this.stopReason = this.sim.halted ? `halted by safety monitor (${reason})` : reason;
    this.done = true;
  }

  progress(): number {
    const p = this.p;
    const equil = p.recordFromStart ? 0 : p.equilibrationCollisions;
    const c = this.cpp();
    const elapsed = this.phase === 'equilibrate' ? c : equil + (c - this.measureStartC);
    return Math.min(1, elapsed / (equil + p.measurementCollisions));
  }

  live(): Record<string, number | string> {
    const last = this.sampler?.samples[this.sampler.samples.length - 1];
    return {
      phase: this.phase,
      time: this.sim.time,
      collisionsPerParticle: this.cpp(),
      bottomShear: last ? last.wallShear[0] : Number.NaN,
      topShear: last ? last.wallShear[1] : Number.NaN,
      kT: this.sim.store.kineticEnergy() / this.sim.store.count,
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): ChannelGasRunResult {
    const s = this.sampler?.samples ?? [];
    const series = {
      c: s.map((w) => w.collisionsPerParticle),
      t: s.map((w) => w.tEnd),
      kT: s.map((w) => w.kT),
      bottomPressure: s.map((w) => w.wallPressure[0]),
      topPressure: s.map((w) => w.wallPressure[1]),
      bottomShear: s.map((w) => w.wallShear[0]),
      topShear: s.map((w) => w.wallShear[1]),
      bottomEnergyFlux: s.map((w) => w.wallEnergyFlux[0]),
      topEnergyFlux: s.map((w) => w.wallEnergyFlux[1]),
    };
    const diff = (a: Tally, b: Tally): Tally => {
      const out = { ...a };
      for (const k of Object.keys(a) as (keyof Tally)[]) out[k] = a[k] - b[k];
      return out;
    };
    const walls = this.startTally
      ? {
          bottom: diff(this.sim.walls[0].totals(), this.startTally.bottom),
          top: diff(this.sim.walls[1].totals(), this.startTally.top),
        }
      : { bottom: this.sim.walls[0].totals(), top: this.sim.walls[1].totals() };
    return {
      label: this.label,
      seed: this.p.seed,
      params: this.p,
      geometry: this.geometry,
      measurementStartCollisions: this.measureStartC,
      measurementStartTime: this.measureStartT,
      series,
      stress:
        s.length >= 16
          ? {
              bottomPressure: blockAverage(series.bottomPressure),
              topPressure: blockAverage(series.topPressure),
              bottomShear: blockAverage(series.bottomShear),
              topShear: blockAverage(series.topShear),
              bottomEnergyFlux: blockAverage(series.bottomEnergyFlux),
              topEnergyFlux: blockAverage(series.topEnergyFlux),
              shearImbalance: blockAverage(series.bottomShear.map((v, i) => v + series.topShear[i])),
              energyImbalance: blockAverage(series.bottomEnergyFlux.map((v, i) => v + series.topEnergyFlux[i])),
              kT: series.kT.reduce((a, b) => a + b, 0) / series.kT.length,
            }
          : null,
      walls,
      measurementTime: this.sim.time - this.measureStartT,
      profile: this.profiles.samples >= 4 ? this.profiles.result() : null,
      totals: { time: this.sim.time, steps: this.steps, collisionsPerParticle: this.cpp() },
      conservation: this.conservation.summary(),
      collisions: this.sim.log.summary(),
      emptySpace: this.empty.summary(),
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
      stopReason: this.stopReason,
    };
  }
}
