import type { ContactResolution, DissipationTarget } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas, squareBoxSide, type VelocityDistribution } from '../gas/InitialConditions';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { WallPressureSampler } from '../measurements/PressureEstimator';
import { blockAverage, consistency, type Estimate } from '../measurements/Statistics';
import { reducedSpeeds, velocityStats } from '../measurements/ThermalStatistics';
import type { PlaneWallConfig, WallSide } from '../walls/WallModel';
import type { Run } from './Experiment';

/**
 * One closed-box gas run, shared by the static-box, thermal and wall
 * experiments. Four planar walls; pressure from wall impulses only; optional
 * velocity-distribution statistics at every pressure window.
 *
 * Timeline: [equilibration] → measurement. Windows are recorded during the
 * measurement phase (or from t = 0 if `recordFromStart`). The run stops when
 * `measurementCollisions` per particle have elapsed since measurement start,
 * when the kinetic energy falls below `stopKineticFraction` of its initial
 * value, or at `maxTime`.
 */
export interface BoxGasRunParams {
  count: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  distribution: VelocityDistribution;
  restitution: number;
  dissipationTarget: DissipationTarget;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  seed: number;
  equilibrationCollisions: number;
  measurementCollisions: number;
  stopKineticFraction?: number;
  windowCollisions: number;
  maxTime: number;
  recordFromStart?: boolean;
  velocityStats?: boolean;
  keepFinalSpeeds?: boolean;
  /** equilibrium averages use windows with (c − c_start) ≥ this; default 0 */
  analysisFromCollisions?: number;
  /** per-side wall overrides; default specular */
  walls?: Partial<Record<WallSide, Omit<PlaneWallConfig, 'side'>>>;
  gridCellSize?: number;
  label?: string;
}

export interface BoxGasRunResult {
  label: string;
  seed: number;
  restitution: number;
  params: BoxGasRunParams;
  geometry: { side: number; area: number; accessibleArea: number; areaFraction: number; numberDensity: number };
  kTInitial: number;
  measurementStartCollisions: number;
  series: {
    c: number[];
    t: number[];
    duration: number[];
    pressure: number[];
    kT: number[];
    wallPressure: number[][];
    wallShear: number[][];
    kTx?: number[];
    kTy?: number[];
    anisotropy?: number[];
    kurtosis?: number[];
    a2?: number[];
  };
  equilibrium: null | {
    pressure: Estimate;
    walls: Estimate[];
    isotropy: ReturnType<typeof consistency>;
    stationarity: { firstHalf: Estimate; secondHalf: Estimate; z: number };
    kTMean: number;
    collisionRatePerParticle: number;
    windows: number;
  };
  wallTotals: { side: WallSide; hits: number; normalImpulse: number; tangentialImpulse: number; energyIn: number }[];
  finalSpeeds?: number[];
  totals: { time: number; steps: number; collisionsPerParticle: number; pairCollisions: number; wallHits: number };
  dt: { min: number; max: number; mean: number };
  conservation: ReturnType<ConservationMonitor['summary']>;
  collisions: ReturnType<Simulation['log']['summary']>;
  emptySpace: EmptySpaceSummary;
  safetyFlags: SafetyFlag[];
  halted: boolean;
  stopReason: string;
  discardedPartialWindows: number;
}

export class BoxGasRun implements Run<BoxGasRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: BoxGasRunParams;
  private phase: 'equilibrate' | 'measure';
  private sampler: WallPressureSampler | null = null;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private readonly ke0: number;
  private readonly kTInitial: number;
  private readonly geometry: BoxGasRunResult['geometry'];
  private readonly vstats: { kTx: number[]; kTy: number[]; anisotropy: number[]; kurtosis: number[]; a2: number[] } | null;
  private measureStartC = 0;
  private measureStartT = 0;
  private windows = 0;
  private dtMin = Infinity;
  private dtMax = 0;
  private dtSum = 0;
  private steps = 0;
  private stopReason = '';

  constructor(p: BoxGasRunParams) {
    this.p = p;
    this.label = p.label ?? `box e=${p.restitution} seed=${p.seed}`;
    const L = squareBoxSide(p.count, p.radius, p.areaFraction);
    const domain: DomainSpec = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: false, periodicY: false };
    const { store, info } = createGas({
      count: p.count,
      radius: p.radius,
      mass: p.mass,
      kT: p.kT,
      distribution: p.distribution,
      seed: p.seed,
      domain,
      placement: p.areaFraction > 0.35 ? 'lattice' : 'random',
    });
    const walls: PlaneWallConfig[] = (['left', 'right', 'bottom', 'top'] as const).map((side) => ({
      side,
      accommodation: 0,
      ...(p.walls?.[side] ?? {}),
    }));
    this.sim = new Simulation(
      {
        domain,
        walls,
        collision: {
          enabled: true,
          restitution: p.restitution,
          contact: p.contact,
          dissipationTarget: p.dissipationTarget,
        },
        timestep: p.timestep,
        seed: p.seed,
        referenceKT: p.kT,
        gridCellSize: p.gridCellSize,
      },
      store,
    );
    this.geometry = {
      side: L,
      area: L * L,
      accessibleArea: (L - 2 * p.radius) ** 2,
      areaFraction: info.areaFraction,
      numberDensity: info.numberDensity,
    };
    this.ke0 = store.kineticEnergy();
    this.kTInitial = this.ke0 / store.count;
    this.conservation = new ConservationMonitor(this.sim);
    this.empty = new EmptySpaceMonitor(this.sim);
    this.vstats = p.velocityStats ? { kTx: [], kTy: [], anisotropy: [], kurtosis: [], a2: [] } : null;
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
  }

  private recordVelocityStats(): void {
    if (!this.vstats) return;
    const v = velocityStats(this.sim.store);
    this.vstats.kTx.push(v.kTx);
    this.vstats.kTy.push(v.kTy);
    this.vstats.anisotropy.push(v.anisotropy);
    this.vstats.kurtosis.push(v.kurtosis);
    this.vstats.a2.push(v.a2);
  }

  advance(maxSteps: number): number {
    let k = 0;
    const sim = this.sim;
    const p = this.p;
    while (k < maxSteps && !this.done) {
      const info = sim.step();
      if (!info) {
        this.finish('halted by safety monitor');
        break;
      }
      k++;
      this.steps++;
      this.dtMin = Math.min(this.dtMin, info.dt);
      this.dtMax = Math.max(this.dtMax, info.dt);
      this.dtSum += info.dt;
      const c = this.cpp();
      if (this.phase === 'equilibrate' && c >= p.equilibrationCollisions) this.startMeasurement();
      if (this.sampler && this.sampler.update()) {
        this.windows++;
        this.recordVelocityStats();
        this.conservation.sample();
        if (this.windows % 4 === 0) this.empty.sample();
      }
      if (this.phase === 'measure' && c - this.measureStartC >= p.measurementCollisions) {
        this.finish('measurement collisions reached');
      } else if (p.stopKineticFraction !== undefined && sim.store.kineticEnergy() < p.stopKineticFraction * this.ke0) {
        this.finish('kinetic energy below stop fraction');
      }
      if (!this.done && sim.time >= p.maxTime) this.finish('maxTime reached');
    }
    return k;
  }

  private finish(reason: string): void {
    if (this.done) return;
    this.sim.checkSafety();
    if (this.sampler?.finish()) this.recordVelocityStats();
    this.conservation.sample();
    this.empty.sample();
    this.stopReason = this.sim.halted ? `halted by safety monitor (${reason})` : reason;
    this.done = true;
  }

  progress(): number {
    const c = this.cpp();
    const p = this.p;
    const equil = p.recordFromStart ? 0 : p.equilibrationCollisions;
    const elapsed = this.phase === 'equilibrate' ? c : equil + (c - this.measureStartC);
    const byColl = Math.min(1, elapsed / (equil + p.measurementCollisions));
    if (p.stopKineticFraction === undefined) return byColl;
    const ke = this.sim.store.kineticEnergy();
    const byEnergy = Math.log(this.ke0 / Math.max(ke, 1e-300)) / Math.log(1 / p.stopKineticFraction);
    return Math.min(1, Math.max(byColl, byEnergy));
  }

  live(): Record<string, number | string> {
    const last = this.sampler?.samples[this.sampler.samples.length - 1];
    return {
      phase: this.phase,
      time: this.sim.time,
      collisionsPerParticle: this.cpp(),
      pressure: last ? last.pressure : Number.NaN,
      kT: this.sim.store.kineticEnergy() / this.sim.store.count,
      energyError: this.sim.relativeEnergyResidual(),
      momentumError: this.sim.relativeMomentumResidual(),
    };
  }

  result(): BoxGasRunResult {
    const samples = this.sampler?.samples ?? [];
    const series: BoxGasRunResult['series'] = {
      c: samples.map((s) => s.collisionsPerParticle),
      t: samples.map((s) => s.tEnd),
      duration: samples.map((s) => s.tEnd - s.tStart),
      pressure: samples.map((s) => s.pressure),
      kT: samples.map((s) => s.kT),
      wallPressure: this.sim.walls.map((_, k) => samples.map((s) => s.wallPressure[k])),
      wallShear: this.sim.walls.map((_, k) => samples.map((s) => s.wallShear[k])),
      ...(this.vstats ?? {}),
    };
    let equilibrium: BoxGasRunResult['equilibrium'] = null;
    const from = this.measureStartC + (this.p.analysisFromCollisions ?? 0);
    const idx = series.c.map((c, i) => (c >= from ? i : -1)).filter((i) => i >= 0);
    if (this.p.restitution === 1 && idx.length >= 16) {
      const P = idx.map((i) => series.pressure[i]);
      const pressure = blockAverage(P);
      const walls = series.wallPressure.map((w) => blockAverage(idx.map((i) => w[i])));
      const half = Math.floor(P.length / 2);
      const firstHalf = blockAverage(P.slice(0, half));
      const secondHalf = blockAverage(P.slice(half));
      const z = (firstHalf.mean - secondHalf.mean) / Math.hypot(firstHalf.se, secondHalf.se);
      const i0 = idx[0];
      const t0 = i0 > 0 ? series.t[i0 - 1] : this.measureStartT;
      const c0 = i0 > 0 ? series.c[i0 - 1] : this.measureStartC;
      const lastI = idx[idx.length - 1];
      equilibrium = {
        pressure,
        walls,
        isotropy: consistency(
          walls.map((w) => w.mean),
          walls.map((w) => w.se),
        ),
        stationarity: { firstHalf, secondHalf, z },
        kTMean: idx.reduce((a, i) => a + series.kT[i], 0) / idx.length,
        collisionRatePerParticle: (series.c[lastI] - c0) / (series.t[lastI] - t0),
        windows: idx.length,
      };
    }
    let wallHits = 0;
    const wallTotals = this.sim.walls.map((w) => {
      const t = w.totals();
      wallHits += t.hits;
      return { side: w.config.side, ...t };
    });
    return {
      label: this.label,
      seed: this.p.seed,
      restitution: this.p.restitution,
      params: this.p,
      geometry: this.geometry,
      kTInitial: this.kTInitial,
      measurementStartCollisions: this.measureStartC,
      series,
      equilibrium,
      wallTotals,
      finalSpeeds: this.p.keepFinalSpeeds
        ? reducedSpeeds(this.sim.store, this.sim.store.kineticEnergy() / this.sim.store.count)
        : undefined,
      totals: {
        time: this.sim.time,
        steps: this.steps,
        collisionsPerParticle: this.cpp(),
        pairCollisions: this.sim.log.count,
        wallHits,
      },
      dt: { min: this.dtMin, max: this.dtMax, mean: this.steps > 0 ? this.dtSum / this.steps : Number.NaN },
      conservation: this.conservation.summary(),
      collisions: this.sim.log.summary(),
      emptySpace: this.empty.summary(),
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
      stopReason: this.stopReason,
      discardedPartialWindows: this.sampler?.discardedPartialWindows ?? 0,
    };
  }
}
