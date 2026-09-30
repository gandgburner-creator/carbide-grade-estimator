import { PlaneWall, type PlaneWallConfig } from '../walls/WallModel';
import { CollisionLog } from './CollisionLog';
import { HardDiskCollider, type CollisionConfig } from './CollisionModel';
import { Domain, type DomainSpec } from './Domain';
import { chooseTimestep, validateTimestepPolicy, type TimestepPolicy } from './Integrator';
import { Ledger } from './Ledger';
import type { ParticleStore } from './ParticleStore';
import { Rng, RNG_STREAM } from './Random';
import { DEFAULT_SAFETY_LIMITS, type SafetyCode, type SafetyFlag, type SafetyLimits } from './Safety';
import { SpatialGrid } from './SpatialGrid';

/**
 * A force model adds conservative or external forces (e.g. the occupancy
 * hypothesis). Forces enter through a velocity-Verlet kick–drift–kick split.
 * computeForces must fill store.fx/fy and return the potential energy that
 * belongs to the energy ledger (0 for non-conservative forces).
 */
export interface ForceModel {
  readonly name: string;
  readonly version: string;
  computeForces(store: ParticleStore, domain: Domain): number;
}

export interface SimulationConfig {
  domain: DomainSpec;
  walls: PlaneWallConfig[];
  collision: CollisionConfig;
  timestep: TimestepPolicy;
  /** seed for dynamical randomness (wall re-emission) */
  seed: number;
  /** reference kT for the particle-explosion check; defaults to initial KE/N */
  referenceKT?: number;
  safety?: Partial<SafetyLimits>;
  collisionLogCapacity?: number;
  /**
   * Grid cell size for contact detection (numerical only; results must not
   * depend on it). Default: max(contact distance, sqrt(2·area/N)), i.e. about
   * two particles per cell, which keeps dilute gases from iterating mostly
   * empty cells.
   */
  gridCellSize?: number;
}

export interface StepInfo {
  dt: number;
  pairCollisions: number;
  wallInteractions: number;
}

export class Simulation {
  readonly config: SimulationConfig;
  readonly store: ParticleStore;
  readonly domain: Domain;
  readonly walls: PlaneWall[];
  readonly collider: HardDiskCollider;
  readonly grid: SpatialGrid;
  readonly ledger = new Ledger();
  readonly log: CollisionLog;
  readonly limits: SafetyLimits;
  readonly forceModels: ForceModel[] = [];

  time = 0;
  stepCount = 0;
  lastDt = 0;
  potentialEnergy = 0;
  halted = false;
  readonly flags: SafetyFlag[] = [];

  /** energy and momentum at t = 0 (after construction) */
  readonly E0: number;
  readonly P0: { x: number; y: number };
  /** Σ m|v| at t = 0, the scale for relative momentum residuals */
  readonly momentumScale: number;
  readonly referenceKT: number;
  /** actual grid cell size used (part of the replay configuration) */
  readonly gridCellSize: number;

  private readonly wallRng: Rng;
  private readonly contactCutoff: number;
  private readonly minDiameter: number;
  private readonly warned = new Set<SafetyCode>();

  constructor(config: SimulationConfig, store: ParticleStore, forceModels: ForceModel[] = []) {
    validateTimestepPolicy(config.timestep);
    this.config = config;
    this.store = store;
    this.domain = new Domain(config.domain);
    this.walls = config.walls.map((w) => new PlaneWall(w, this.domain));
    const sides = new Set(config.walls.map((w) => w.side));
    if (sides.size !== config.walls.length) throw new Error('duplicate wall side');
    if (!this.domain.periodicX && !(sides.has('left') && sides.has('right'))) {
      throw new Error('bounded x axis needs left and right walls');
    }
    if (!this.domain.periodicY && !(sides.has('bottom') && sides.has('top'))) {
      throw new Error('bounded y axis needs bottom and top walls');
    }
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...config.safety };
    this.collider = new HardDiskCollider(config.collision, store.capacity);
    this.log = new CollisionLog(config.collisionLogCapacity ?? 65536);
    const rmax = store.count > 0 ? store.maxRadius() : 1;
    this.contactCutoff = 2 * rmax;
    this.minDiameter = store.count > 0 ? 2 * store.minRadius() : 1;
    let autoCell = store.count > 0 ? Math.sqrt((2 * this.domain.area) / store.count) : this.contactCutoff;
    // a periodic axis needs ≥ 3 cells
    if (this.domain.periodicX) autoCell = Math.min(autoCell, this.domain.width / 3);
    if (this.domain.periodicY) autoCell = Math.min(autoCell, this.domain.height / 3);
    this.gridCellSize = Math.max(this.contactCutoff, config.gridCellSize ?? autoCell);
    this.grid = new SpatialGrid(this.domain, this.gridCellSize, store.capacity);
    this.wallRng = new Rng(config.seed, RNG_STREAM.walls);
    this.forceModels.push(...forceModels);
    if (this.forceModels.length > 0) this.potentialEnergy = this.computeForces();

    this.E0 = this.totalEnergy();
    this.P0 = store.momentum();
    let ms = 0;
    for (let i = 0; i < store.count; i++) {
      ms += store.mass[i] * Math.hypot(store.vx[i], store.vy[i]);
    }
    this.momentumScale = ms;
    this.referenceKT = config.referenceKT ?? (store.count > 0 ? store.kineticEnergy() / store.count : 0);
    this.checkInitialOverlaps();
    this.checkSafety();
  }

  /** KE + internal + potential energy of the gas. */
  totalEnergy(): number {
    return this.store.kineticEnergy() + this.store.internalEnergy() + this.potentialEnergy;
  }

  /** Energy-accounting residual: E(t) + energy that left through ledgered channels − E(0). */
  energyResidual(): number {
    const L = this.ledger;
    return this.totalEnergy() + L.dissipatedExternal + L.wallEnergyOut + L.forceWorkOut - this.E0;
  }

  relativeEnergyResidual(): number {
    return this.E0 !== 0 ? this.energyResidual() / Math.abs(this.E0) : this.energyResidual();
  }

  /** Momentum-accounting residual: P(t) − P(0) − impulse delivered by walls and external forces. */
  momentumResidual(): { x: number; y: number } {
    const p = this.store.momentum();
    const L = this.ledger;
    return {
      x: p.x - this.P0.x - L.wallImpulseX - L.forceImpulseX,
      y: p.y - this.P0.y - L.wallImpulseY - L.forceImpulseY,
    };
  }

  relativeMomentumResidual(): number {
    const r = this.momentumResidual();
    const m = Math.hypot(r.x, r.y);
    return this.momentumScale > 0 ? m / this.momentumScale : m;
  }

  private computeForces(): number {
    const { fx, fy, count } = this.store;
    fx.fill(0, 0, count);
    fy.fill(0, 0, count);
    let pe = 0;
    for (const f of this.forceModels) pe += f.computeForces(this.store, this.domain);
    return pe;
  }

  private kick(half: number): void {
    const { vx, vy, fx, fy, mass, count } = this.store;
    for (let i = 0; i < count; i++) {
      vx[i] += (fx[i] / mass[i]) * half;
      vy[i] += (fy[i] / mass[i]) * half;
    }
  }

  /** Advance one timestep. Returns false (and does nothing) once halted. */
  step(): StepInfo | null {
    if (this.halted) return null;
    const s = this.store;
    const dt = chooseTimestep(this.config.timestep, s.maxSpeed(), this.minDiameter);
    const hasForces = this.forceModels.length > 0;

    if (hasForces) this.kick(0.5 * dt);

    const { x, y, vx, vy, count } = s;
    for (let i = 0; i < count; i++) {
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
    }
    this.wrap();

    let pairCollisions = 0;
    if (this.config.collision.enabled && count > 1) {
      this.grid.build(s);
      pairCollisions = this.collider.resolveAll(
        s,
        this.grid,
        this.domain,
        dt,
        this.time + dt,
        this.stepCount,
        this.log,
        this.ledger,
        this.contactCutoff,
      );
    }
    let wallInteractions = 0;
    for (const w of this.walls) wallInteractions += w.interact(s, dt, this.wallRng, this.ledger);
    this.wrap();

    if (hasForces) {
      this.potentialEnergy = this.computeForces();
      this.kick(0.5 * dt);
    }

    this.time += dt;
    this.stepCount++;
    this.lastDt = dt;
    if (this.stepCount % this.limits.checkInterval === 0) this.checkSafety();
    return { dt, pairCollisions, wallInteractions };
  }

  /** Run up to n steps; stops early if halted. Returns steps taken. */
  run(n: number): number {
    let k = 0;
    while (k < n && this.step()) k++;
    return k;
  }

  runUntil(t: number, maxSteps = Number.MAX_SAFE_INTEGER): number {
    let k = 0;
    while (this.time < t && k < maxSteps && this.step()) k++;
    return k;
  }

  private wrap(): void {
    const d = this.domain;
    if (!d.periodicX && !d.periodicY) return;
    const { x, y, count } = this.store;
    for (let i = 0; i < count; i++) {
      if (d.periodicX && (x[i] < d.xmin || x[i] >= d.xmax)) x[i] = d.wrapX(x[i]);
      if (d.periodicY && (y[i] < d.ymin || y[i] >= d.ymax)) y[i] = d.wrapY(y[i]);
    }
  }

  /** Overlapping disks at t = 0 are reported (the collision law assumes they never start overlapped). */
  private checkInitialOverlaps(): void {
    if (this.store.count < 2) return;
    this.grid.build(this.store);
    let n = 0;
    const r = this.store.radius;
    this.grid.forEachPairWithin(this.store, this.contactCutoff, (i, j, _dx, _dy, r2) => {
      const R = r[i] + r[j];
      if (r2 < R * R) n++;
    });
    if (n > 0) this.flag('INITIAL_OVERLAP', 'warning', `${n} overlapping pairs in the initial condition`);
  }

  private flag(code: SafetyCode, severity: 'warning' | 'failure', message: string): void {
    if (severity === 'warning') {
      if (this.warned.has(code)) return;
      this.warned.add(code);
    }
    this.flags.push({ code, severity, message, time: this.time, step: this.stepCount });
    if (severity === 'failure') this.halted = true;
  }

  /** Run all safety checks now. Failures halt the simulation. */
  checkSafety(): void {
    const s = this.store;
    const d = this.domain;
    const L = this.limits;
    let bad = -1;
    let negMass = -1;
    let outside = -1;
    let v2max = 0;
    for (let i = 0; i < s.count; i++) {
      const xi = s.x[i];
      const yi = s.y[i];
      const vxi = s.vx[i];
      const vyi = s.vy[i];
      if (!Number.isFinite(xi + yi + vxi + vyi + s.energy[i])) bad = i;
      if (!(s.mass[i] > 0)) negMass = i;
      if ((!d.periodicX && (xi < d.xmin || xi > d.xmax)) || (!d.periodicY && (yi < d.ymin || yi > d.ymax))) outside = i;
      const v2 = vxi * vxi + vyi * vyi;
      if (v2 > v2max) v2max = v2;
    }
    if (bad >= 0) this.flag('NAN_OR_INFINITE', 'failure', `particle ${bad} has a non-finite state`);
    if (negMass >= 0) this.flag('NEGATIVE_MASS', 'failure', `particle ${negMass} has non-positive mass`);
    if (outside >= 0) {
      this.flag('OUT_OF_DOMAIN', 'failure', `particle ${outside} centre is outside the bounded domain`);
    }
    if (this.referenceKT > 0 && s.count > 0) {
      const vref = Math.sqrt(this.referenceKT / s.mass[0]);
      if (Math.sqrt(v2max) > L.maxSpeedFactor * vref) {
        this.flag(
          'PARTICLE_EXPLOSION',
          'failure',
          `max speed ${Math.sqrt(v2max).toPrecision(4)} exceeds ${L.maxSpeedFactor} × reference speed ${vref.toPrecision(4)}`,
        );
      }
    }
    const eRes = Math.abs(this.relativeEnergyResidual());
    if (!(eRes <= L.energyTolerance)) {
      this.flag('ENERGY_BLOW_UP', 'failure', `relative energy-accounting residual ${eRes.toExponential(3)}`);
    }
    const pRes = this.relativeMomentumResidual();
    if (!(pRes <= L.momentumTolerance)) {
      this.flag('MOMENTUM_DRIFT', 'failure', `relative momentum-accounting residual ${pRes.toExponential(3)}`);
    }
    const ov = this.log.maxOverlapFraction;
    if (ov > L.overlapFailure) {
      this.flag('EXCESSIVE_OVERLAP', 'failure', `overlap reached ${(100 * ov).toFixed(1)}% of contact distance`);
    } else if (ov > L.overlapWarning) {
      this.flag('EXCESSIVE_OVERLAP', 'warning', `overlap reached ${(100 * ov).toFixed(1)}% of contact distance`);
    }
    if (this.log.degenerateContacts > 0) {
      this.flag('DEGENERATE_CONTACT', 'failure', `${this.log.degenerateContacts} contacts with coincident centres`);
    }
    if (this.config.timestep.kind === 'adaptive' && this.lastDt === this.config.timestep.dtMin && this.stepCount > 0) {
      this.flag('TIMESTEP_FLOOR', 'warning', 'adaptive timestep hit its floor dtMin; courant limit not met');
    }
  }
}
