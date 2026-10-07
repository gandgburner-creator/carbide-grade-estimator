import type { CollisionConfig } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import { ParticleStore } from '../core/ParticleStore';
import { Simulation, type ForceModel, type SimulationConfig } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import type { PlaneWallConfig } from '../walls/WallModel';
import { parcelMap, UB0_PHI, type ParcelMap } from './CoarseGrainMap';
import { captureSimulation, captureStore, restoreSimulation, restoreStore, type SimState, type StoreState } from './SimState';
import { UBOccupancyForce } from './UBOccupancyForce';

/**
 * One UB-0 run of any kind, at any N_c (N_c = 1 is Universe A). Units are
 * MOLECULAR (m = d = kT = 1); spec durations are in parcel units D/σ_v = N_c.
 *
 * Phases (design §11.6, amendment A1 §4.2):
 *   prep     the full dynamics from a random, non-overlapping start
 *   rescale  periodic kinds only: one global rescale of CoM peculiar velocities
 *            (KE = N kT) and reservoir energies (mean (N_c − 1) kT); net momentum removed.
 *            A state preparation, never repeated, not a thermostat.
 *   settle   the full dynamics
 *   impose   shear: v_x += U₀ sin(ky) ; sound: v_x += U₀ sin(kx)  (mean removed)
 *   measure  sampling every `sample`
 * Each phase runs in its own Simulation, so every ledger starts at the phase start.
 *
 * The run is a plain state machine; `checkpoint()` returns a JSON-able object and
 * `UB0Run.resume(checkpoint)` continues it bit for bit.
 */
export type UB0Kind = 'static' | 'shear' | 'sound' | 'wall' | 'couette';

export interface UB0Spec {
  id: string;
  kind: UB0Kind;
  Nc: number;
  /** kernel constant c_h (ignored at N_c = 1) */
  ch: number;
  /** restitution (must be 1 at N_c = 1) */
  e: number;
  /** mapping input K_T,A/(n kT) (ignored at N_c = 1, where k_s = 0) */
  KTred: number;
  phi: number;
  courant: number;
  seed: number;
  /** periodic kinds: square side L (in D). wall/couette: width × height (in D) */
  L?: number;
  width?: number;
  height?: number;
  /** shear/sound amplitude, in units of σ_v */
  amplitude?: number;
  /** couette: wall velocity difference in units of σ_v (walls at ∓½ and ±½ of it) */
  wallSpeed?: number;
  /** durations in D/σ_v */
  prep: number;
  settle: number;
  measure: number;
  /** sample interval in D/σ_v */
  sample: number;
  /** static: g(r), ψ₆ and self-diffusion (secondaries) */
  extras?: boolean;
  /** false = stability/timing only: ledgers and timing, no physics observables (pilots, B0) */
  observables: boolean;
}

export type Phase = 'prep' | 'settle' | 'measure' | 'done';

export interface Sample {
  t: number;
  [key: string]: number;
}

/** Accumulated (non-time-series) measurement tallies of the measure phase. */
export interface Tallies {
  /** static: g(r) histogram */
  gr?: number[];
  grSnapshots?: number;
  /** static: unwrapped displacement sums for the self-diffusion (per parcel) */
  dispX?: number[];
  dispY?: number[];
  lastX?: number[];
  lastY?: number[];
  msd?: { t: number; msd: number }[];
  /** wall/couette: fine-bin profiles over the full height */
  count?: number[];
  mvy2?: number[];
  mvx2?: number[];
  mvx?: number[];
  eint?: number[];
  /** method-of-planes normal stress tallies */
  planesOcc?: number[];
  planesColl?: number[];
  occSamples?: number;
  profileSnapshots?: number;
  /** first-layer ψ₆ (report-only) */
  psi6Sum?: number;
  psi6Samples?: number;
}

export interface UB0RunState {
  spec: UB0Spec;
  phase: Phase;
  /** state of the store at the start of the current phase (to rebuild the Simulation) */
  phaseStart: StoreState;
  sim: SimState;
  logCursor: number;
  nextSample: number;
  lastSampleTime: number;
  /** collisional virial sums since the last sample */
  coll: number[];
  samples: Sample[];
  tallies: Tallies;
  info: Record<string, number>;
  lostEvents: number;
  phaseLedgers: Record<string, unknown>;
  timing: Record<string, number>;
}

const FINE = 1 / 20; // fine bin width in D (amendment A1 §2.4)
const PLANE = 1 / 4; // plane spacing in D

/**
 * The map is ALWAYS evaluated at the mapping state point φ = 0.2: k_s is a fixed
 * model constant. A run at another density (the static boxes at φ = 0.18, 0.22)
 * changes only the parcel count, never k_s.
 */
export function mapOf(spec: UB0Spec): ParcelMap {
  return parcelMap({ Nc: spec.Nc, ch: spec.ch, e: spec.Nc === 1 ? 1 : spec.e }, { KTred: spec.KTred, phi: UB0_PHI });
}

/** parcel number density of THIS run (molecular units): φ_run/(πD²/4) */
export function runDensity(spec: UB0Spec, m: ParcelMap): number {
  return spec.phi / m.parcelArea;
}

export function domainOf(spec: UB0Spec, m: ParcelMap): DomainSpec {
  const D = m.diameter;
  if (spec.kind === 'wall' || spec.kind === 'couette') {
    return { xmin: 0, xmax: spec.width! * D, ymin: 0, ymax: spec.height! * D, periodicX: true, periodicY: false };
  }
  return { xmin: 0, xmax: spec.L! * D, ymin: 0, ymax: spec.L! * D, periodicX: true, periodicY: true };
}

export function collisionOf(m: ParcelMap): CollisionConfig {
  return m.Nc === 1
    ? { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' }
    : {
        enabled: true,
        restitution: m.e,
        contact: 'rewind-to-contact',
        dissipationTarget: 'internal',
        reservoirRelease: m.releaseFraction,
      };
}

export function wallsOf(spec: UB0Spec, m: ParcelMap, phase: Phase): PlaneWallConfig[] {
  if (spec.kind !== 'wall' && spec.kind !== 'couette') return [];
  const U = spec.kind === 'couette' ? (spec.wallSpeed ?? 0) * m.sigmaV : 0;
  void phase;
  return [
    { side: 'bottom', accommodation: 1, temperature: m.kT, tangentialVelocity: -U / 2, bins: 1 },
    { side: 'top', accommodation: 1, temperature: m.kT, tangentialVelocity: U / 2, bins: 1 },
  ];
}

export function simConfigOf(spec: UB0Spec, m: ParcelMap, phase: Phase): SimulationConfig {
  const hasForces = m.Nc > 1;
  return {
    domain: domainOf(spec, m),
    walls: wallsOf(spec, m, phase),
    collision: collisionOf(m),
    timestep: { kind: 'adaptive', courant: spec.courant, dtMax: m.Nc, dtMin: 1e-7 * m.Nc },
    seed: spec.seed,
    referenceKT: m.kT,
    // with forces, velocity Verlet does not conserve energy to round-off; the
    // drift is measured (PQ7) and only gross blow-ups halt a run
    safety: hasForces ? { energyTolerance: 1e-2 } : {},
  };
}

function forcesOf(m: ParcelMap): ForceModel[] {
  return m.Nc > 1 ? [new UBOccupancyForce({ ks: m.ks, h: m.h })] : [];
}

/** Initial gas: random sequential placement, Maxwell velocities, reservoirs at (N_c − 1) kT. */
export function initialStore(spec: UB0Spec, m: ParcelMap): ParticleStore {
  const domain = domainOf(spec, m);
  const area = (domain.xmax - domain.xmin) * (domain.ymax - domain.ymin);
  const count = Math.round(runDensity(spec, m) * area);
  const { store } = createGas({
    count,
    radius: m.radius,
    mass: m.mass,
    kT: m.kT,
    distribution: 'maxwell',
    seed: spec.seed,
    domain,
    removeDrift: true,
    exactKT: true,
  });
  for (let i = 0; i < store.count; i++) store.energy[i] = m.internalEnergy;
  return store;
}

const hasRescale = (k: UB0Kind) => k === 'static' || k === 'shear' || k === 'sound';

export class UB0Run {
  readonly spec: UB0Spec;
  readonly map: ParcelMap;
  readonly k: number;
  readonly area: number;
  phase: Phase;
  sim: Simulation;
  private occ: UBOccupancyForce | null;
  private phaseStart: StoreState;
  private logCursor = 0;
  private nextSample = 0;
  private lastSampleTime = 0;
  private coll: number[] = [0, 0, 0, 0, 0, 0];
  samples: Sample[] = [];
  tallies: Tallies = {};
  info: Record<string, number> = {};
  lostEvents = 0;
  phaseLedgers: Record<string, unknown> = {};
  timing: Record<string, number> = {};
  private phaseClock = 0;

  /** time unit D/σ_v in molecular units */
  get unit(): number {
    return this.map.Nc;
  }

  constructor(spec: UB0Spec, state?: UB0RunState) {
    this.spec = spec;
    this.map = mapOf(spec);
    const dom = domainOf(spec, this.map);
    this.area = (dom.xmax - dom.xmin) * (dom.ymax - dom.ymin);
    this.k = spec.kind === 'shear' || spec.kind === 'sound' ? (2 * Math.PI) / (dom.xmax - dom.xmin) : 0;
    if (state) {
      this.phase = state.phase;
      this.phaseStart = state.phaseStart;
      const store = new ParticleStore(state.phaseStart.count);
      restoreStore(store, state.phaseStart);
      const forces = forcesOf(this.map);
      this.occ = (forces[0] as UBOccupancyForce | undefined) ?? null;
      this.sim = new Simulation(simConfigOf(spec, this.map, this.phase), store, forces);
      restoreSimulation(this.sim, state.sim);
      this.logCursor = state.logCursor;
      this.nextSample = state.nextSample;
      this.lastSampleTime = state.lastSampleTime;
      this.coll = state.coll.slice();
      this.samples = state.samples.map((s) => ({ ...s }));
      this.tallies = JSON.parse(JSON.stringify(state.tallies)) as Tallies;
      this.info = { ...state.info };
      this.lostEvents = state.lostEvents;
      this.phaseLedgers = JSON.parse(JSON.stringify(state.phaseLedgers)) as Record<string, unknown>;
      this.timing = { ...state.timing };
    } else {
      this.phase = 'prep';
      const store = initialStore(spec, this.map);
      this.phaseStart = captureStore(store);
      const forces = forcesOf(this.map);
      this.occ = (forces[0] as UBOccupancyForce | undefined) ?? null;
      this.sim = new Simulation(simConfigOf(spec, this.map, 'prep'), store, forces);
      this.info.parcels = store.count;
      this.info.area = this.area;
      this.logCursor = this.sim.log.count;
    }
    this.phaseClock = Date.now();
  }

  static resume(state: UB0RunState): UB0Run {
    return new UB0Run(state.spec, state);
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /** duration of the current phase in molecular time */
  private phaseDuration(): number {
    const s = this.spec;
    const d = this.phase === 'prep' ? s.prep : this.phase === 'settle' ? s.settle : s.measure;
    return d * this.unit;
  }

  checkpoint(): UB0RunState {
    return {
      spec: this.spec,
      phase: this.phase,
      phaseStart: this.phaseStart,
      sim: captureSimulation(this.sim),
      logCursor: this.logCursor,
      nextSample: this.nextSample,
      lastSampleTime: this.lastSampleTime,
      coll: this.coll.slice(),
      samples: this.samples,
      tallies: this.tallies,
      info: this.info,
      lostEvents: this.lostEvents,
      phaseLedgers: this.phaseLedgers,
      timing: this.timing,
    };
  }

  /** Advance by at most maxSteps simulation steps. Returns steps taken. */
  advance(maxSteps: number): number {
    let taken = 0;
    while (taken < maxSteps && this.phase !== 'done') {
      if (this.sim.halted) {
        this.finishPhase(true);
        break;
      }
      if (this.sim.time >= this.phaseDuration()) {
        this.finishPhase(false);
        continue;
      }
      this.sim.step();
      taken++;
      if (this.phase === 'measure') {
        this.consumeCollisions();
        if (this.spec.observables && this.sim.time >= this.nextSample) this.takeSample();
      } else {
        this.logCursor = this.sim.log.count;
      }
    }
    return taken;
  }

  private finishPhase(halted: boolean): void {
    const now = Date.now();
    this.timing[`${this.phase}Seconds`] = (this.timing[`${this.phase}Seconds`] ?? 0) + (now - this.phaseClock) / 1000;
    this.timing[`${this.phase}Steps`] = this.sim.stepCount;
    this.phaseClock = now;
    this.phaseLedgers[this.phase] = {
      time: this.sim.time,
      steps: this.sim.stepCount,
      energyResidual: this.sim.energyResidual(),
      relativeEnergyResidual: this.sim.relativeEnergyResidual(),
      momentumResidual: this.sim.momentumResidual(),
      relativeMomentumResidual: this.sim.relativeMomentumResidual(),
      E0: this.sim.E0,
      ledger: this.sim.ledger.toJSON(),
      pairCollisions: this.sim.log.count,
      lateContacts: this.sim.log.lateContacts,
      lateContactsUnexplained: this.sim.log.lateContactsUnexplained,
      multiCollisions: this.sim.log.multiCollisions,
      maxOverlapFraction: this.sim.log.maxOverlapFraction,
      wallLateContacts: this.sim.walls.reduce((s, w) => s + w.lateContacts, 0),
      wallTotals: this.sim.walls.map((w) => w.totals()),
      flags: this.sim.flags.map((f) => ({ ...f })),
      halted: this.sim.halted,
    };
    if (halted || this.phase === 'measure') {
      this.phase = 'done';
      this.info.halted = halted ? 1 : 0;
      return;
    }
    const store = this.sim.store;
    if (this.phase === 'prep' && hasRescale(this.spec.kind)) this.rescale(store);
    if (this.phase === 'settle' || (this.phase === 'prep' && this.spec.settle === 0)) {
      this.impose(store);
      this.phase = 'measure';
    } else {
      this.phase = 'settle';
    }
    this.phaseStart = captureStore(store);
    const forces = forcesOf(this.map);
    this.occ = (forces[0] as UBOccupancyForce | undefined) ?? null;
    this.sim = new Simulation(simConfigOf(this.spec, this.map, this.phase), store, forces);
    this.logCursor = this.sim.log.count;
    if (this.phase === 'measure') this.startMeasure();
  }

  /** One global rescale: zero momentum, KE = N kT, mean reservoir (N_c − 1) kT. */
  private rescale(s: ParticleStore): void {
    const N = s.count;
    let px = 0;
    let py = 0;
    let M = 0;
    for (let i = 0; i < N; i++) {
      px += s.mass[i] * s.vx[i];
      py += s.mass[i] * s.vy[i];
      M += s.mass[i];
    }
    const ux = px / M;
    const uy = py / M;
    let ke = 0;
    for (let i = 0; i < N; i++) {
      s.vx[i] -= ux;
      s.vy[i] -= uy;
      ke += 0.5 * s.mass[i] * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]);
    }
    const f = Math.sqrt((N * this.map.kT) / ke);
    for (let i = 0; i < N; i++) {
      s.vx[i] *= f;
      s.vy[i] *= f;
    }
    this.info.rescaleVelocityFactor = f;
    if (this.map.Nc > 1) {
      let E = 0;
      for (let i = 0; i < N; i++) E += s.energy[i];
      const g = (N * this.map.internalEnergy) / E;
      for (let i = 0; i < N; i++) s.energy[i] *= g;
      this.info.rescaleReservoirFactor = g;
    }
  }

  private impose(s: ParticleStore): void {
    const kind = this.spec.kind;
    if (kind !== 'shear' && kind !== 'sound') return;
    const U = (this.spec.amplitude ?? 0) * this.map.sigmaV;
    const N = s.count;
    const add = new Float64Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) {
      add[i] = U * Math.sin(this.k * (kind === 'shear' ? s.y[i] : s.x[i]));
      mean += add[i];
    }
    mean /= N;
    let waveKE = 0;
    for (let i = 0; i < N; i++) {
      const before = s.vx[i];
      s.vx[i] += add[i] - mean;
      waveKE += 0.5 * s.mass[i] * (s.vx[i] * s.vx[i] - before * before);
    }
    this.info.imposedAmplitude = U;
    this.info.imposedKineticEnergy = waveKE;
  }

  private startMeasure(): void {
    this.nextSample = 0;
    this.lastSampleTime = 0;
    this.coll = [0, 0, 0, 0, 0, 0];
    this.samples = [];
    const s = this.sim.store;
    const kind = this.spec.kind;
    if (!this.spec.observables) return;
    if (kind === 'static' && this.spec.extras) {
      this.tallies.gr = new Array(150).fill(0);
      this.tallies.grSnapshots = 0;
      this.tallies.dispX = new Array(s.count).fill(0);
      this.tallies.dispY = new Array(s.count).fill(0);
      this.tallies.lastX = Array.from(s.x.subarray(0, s.count));
      this.tallies.lastY = Array.from(s.y.subarray(0, s.count));
      this.tallies.msd = [];
    }
    if (kind === 'wall' || kind === 'couette') {
      const H = this.sim.domain.height;
      const D = this.map.diameter;
      const nb = Math.ceil(H / (FINE * D));
      const np = Math.floor((H - D) / (PLANE * D)) + 1;
      this.tallies.count = new Array(nb).fill(0);
      this.tallies.mvy2 = new Array(nb).fill(0);
      this.tallies.mvx2 = new Array(nb).fill(0);
      this.tallies.mvx = new Array(nb).fill(0);
      this.tallies.eint = new Array(nb).fill(0);
      this.tallies.planesOcc = new Array(np).fill(0);
      this.tallies.planesColl = new Array(np).fill(0);
      this.tallies.occSamples = 0;
      this.tallies.profileSnapshots = 0;
      this.tallies.psi6Sum = 0;
      this.tallies.psi6Samples = 0;
    }
  }

  /** Consume this step's pair-collision events (collisional virial, projections, planes). */
  private consumeCollisions(): void {
    const log = this.sim.log;
    const fresh = log.count - this.logCursor;
    if (fresh <= 0) return;
    const avail = Math.min(fresh, log.retained);
    this.lostEvents += fresh - avail;
    this.logCursor = log.count;
    if (!this.spec.observables) return;
    const kind = this.spec.kind;
    const R = this.map.diameter;
    const k = this.k;
    const D = this.map.diameter;
    for (let q = 0; q < avail; q++) {
      const ev = log.recent(q);
      // centre separation r_ij = R n at contact; Δp of i
      this.coll[0] += R * ev.nx * ev.dpx;
      this.coll[1] += R * ev.ny * ev.dpy;
      this.coll[2] += R * ev.nx * ev.dpy;
      if (kind === 'shear') {
        const yij = R * ev.ny;
        const u = 0.5 * k * yij;
        const sinc = u === 0 ? 1 : Math.sin(u) / u;
        const w = ev.dpx * yij * sinc;
        this.coll[3] += w * Math.cos(k * ev.y);
        this.coll[4] += w * Math.sin(k * ev.y);
      } else if ((kind === 'wall' || kind === 'couette') && this.tallies.planesColl) {
        const yi = ev.y + ev.ny * (R / 2);
        const yj = ev.y - ev.ny * (R / 2);
        const lo = Math.min(yi, yj);
        const hi = Math.max(yi, yj);
        const sign = yi > yj ? 1 : -1;
        const pc = this.tallies.planesColl;
        let p = Math.ceil((lo - D / 2) / (PLANE * D));
        if (p < 0) p = 0;
        for (; p < pc.length; p++) {
          if (D / 2 + p * PLANE * D >= hi) break;
          pc[p] += sign * ev.dpy;
        }
      }
    }
  }

  private takeSample(): void {
    const sim = this.sim;
    const s = sim.store;
    const N = s.count;
    const t = sim.time;
    const dtColl = t - this.lastSampleTime;
    const A = this.area;
    const kind = this.spec.kind;
    const M = this.map.mass;
    let ke = 0;
    let eint = 0;
    for (let i = 0; i < N; i++) {
      ke += 0.5 * s.mass[i] * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i]);
      eint += s.energy[i];
    }
    const sample: Sample = {
      t: t / this.unit,
      Tkin: ke / N,
      Tint: this.map.Nc > 1 ? eint / (N * (this.map.Nc - 1)) : 0,
      energyResidual: sim.energyResidual(),
      momentumResidual: sim.relativeMomentumResidual(),
      collisions: sim.log.count,
    };
    if (kind === 'static') {
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let v2 = 0;
      let v4 = 0;
      let vabs = 0;
      for (let i = 0; i < N; i++) {
        const a = s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i];
        sxx += s.mass[i] * s.vx[i] * s.vx[i];
        syy += s.mass[i] * s.vy[i] * s.vy[i];
        sxy += s.mass[i] * s.vx[i] * s.vy[i];
        v2 += a;
        v4 += a * a;
        vabs += Math.sqrt(a);
      }
      sample.Pkin = (sxx + syy) / (2 * A);
      sample.Pxy = sxy / A;
      sample.Pcoll = dtColl > 0 ? (this.coll[0] + this.coll[1]) / (2 * A * dtColl) : 0;
      sample.Pocc = 0;
      if (this.occ) {
        const o = this.occ.measure(s, sim.domain, 0);
        sample.Pocc = (o.wxx + o.wyy) / (2 * A);
      }
      sample.a2 = (N * v4) / (2 * v2 * v2) - 1;
      sample.meanSpeed = vabs / N;
      // structure factor at the lowest shells: |m|² = 1, 2, 4 in units of 2π/L
      const L = sim.domain.width;
      const shells: [number, number][][] = [
        [[1, 0], [0, 1]],
        [[1, 1], [1, -1]],
        [[2, 0], [0, 2]],
      ];
      shells.forEach((vecs, si) => {
        let acc = 0;
        for (const [mx, my] of vecs) {
          const kx = (2 * Math.PI * mx) / L;
          const ky = (2 * Math.PI * my) / L;
          let re = 0;
          let im = 0;
          for (let i = 0; i < N; i++) {
            const ph = kx * s.x[i] + ky * s.y[i];
            re += Math.cos(ph);
            im -= Math.sin(ph);
          }
          acc += (re * re + im * im) / N;
        }
        sample[`S${si + 1}`] = acc / vecs.length;
      });
      if (this.spec.extras) this.staticExtras(sample);
      void M;
    } else if (kind === 'shear') {
      const k = this.k;
      let us = 0;
      let uc = 0;
      for (let i = 0; i < N; i++) {
        us += s.vx[i] * Math.sin(k * s.y[i]);
        uc += s.vx[i] * Math.cos(k * s.y[i]);
      }
      us *= 2 / N;
      uc *= 2 / N;
      let kep = 0;
      let akc = 0;
      let aks = 0;
      for (let i = 0; i < N; i++) {
        const sn = Math.sin(k * s.y[i]);
        const cs = Math.cos(k * s.y[i]);
        const u = us * sn + uc * cs;
        const dvx = s.vx[i] - u;
        kep += 0.5 * s.mass[i] * (dvx * dvx + s.vy[i] * s.vy[i]);
        const m = s.mass[i] * s.vx[i] * s.vy[i];
        akc += m * cs;
        aks += m * sn;
      }
      sample.Us = us;
      sample.Uc = uc;
      sample.Tkin = kep / N;
      sample.akc = (2 / A) * akc;
      sample.aks = (2 / A) * aks;
      sample.acc = dtColl > 0 ? ((2 / A) * this.coll[3]) / dtColl : 0;
      sample.acs = dtColl > 0 ? ((2 / A) * this.coll[4]) / dtColl : 0;
      sample.aoc = 0;
      sample.aos = 0;
      if (this.occ) {
        const o = this.occ.measure(s, sim.domain, k);
        sample.aoc = (2 / A) * o.projCos;
        sample.aos = (2 / A) * o.projSin;
      }
    } else if (kind === 'sound') {
      const k = this.k;
      let vs = 0;
      let vc = 0;
      let rc = 0;
      let rs = 0;
      for (let i = 0; i < N; i++) {
        const sn = Math.sin(k * s.x[i]);
        const cs = Math.cos(k * s.x[i]);
        vs += s.vx[i] * sn;
        vc += s.vx[i] * cs;
        rc += cs;
        rs += sn;
      }
      sample.Vs = (2 / N) * vs;
      sample.Vc = (2 / N) * vc;
      sample.Rc = (2 / N) * rc;
      sample.Rs = (2 / N) * rs;
    } else {
      this.profileSample();
    }
    this.coll = [0, 0, 0, 0, 0, 0];
    this.lastSampleTime = t;
    this.samples.push(sample);
    this.nextSample = (Math.floor(t / (this.spec.sample * this.unit) + 1e-9) + 1) * this.spec.sample * this.unit;
  }

  private staticExtras(sample: Sample): void {
    const s = this.sim.store;
    const d = this.sim.domain;
    const N = s.count;
    const T = this.tallies;
    // self-diffusion: unwrapped displacements by minimum image between samples
    let msd = 0;
    for (let i = 0; i < N; i++) {
      T.dispX![i] += d.imageDx(s.x[i] - T.lastX![i]);
      T.dispY![i] += d.imageDy(s.y[i] - T.lastY![i]);
      T.lastX![i] = s.x[i];
      T.lastY![i] = s.y[i];
      msd += T.dispX![i] * T.dispX![i] + T.dispY![i] * T.dispY![i];
    }
    T.msd!.push({ t: sample.t, msd: msd / N });
    // g(r) up to 3 D and ψ₆ (neighbours within 1.4 D), every 10th sample
    if (this.samples.length % 10 !== 0) return;
    const D = this.map.diameter;
    const rmax = 3 * D;
    const bw = rmax / T.gr!.length;
    const cell = Math.max(rmax, d.width / Math.floor(d.width / rmax));
    void cell;
    const nb = 1.4 * D;
    const psiRe = new Float64Array(N);
    const psiIm = new Float64Array(N);
    const nn = new Int32Array(N);
    // simple O(N²) on a cell list built here
    const nc = Math.max(3, Math.floor(d.width / rmax));
    const cw = d.width / nc;
    const heads = new Int32Array(nc * nc).fill(-1);
    const next = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const cx = Math.min(nc - 1, Math.floor(s.x[i] / cw));
      const cy = Math.min(nc - 1, Math.floor(s.y[i] / cw));
      next[i] = heads[cy * nc + cx];
      heads[cy * nc + cx] = i;
    }
    for (let i = 0; i < N; i++) {
      const cx = Math.min(nc - 1, Math.floor(s.x[i] / cw));
      const cy = Math.min(nc - 1, Math.floor(s.y[i] / cw));
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const qx = (cx + ox + nc) % nc;
          const qy = (cy + oy + nc) % nc;
          for (let j = heads[qy * nc + qx]; j >= 0; j = next[j]) {
            if (j <= i) continue;
            const dx = d.imageDx(s.x[j] - s.x[i]);
            const dy = d.imageDy(s.y[j] - s.y[i]);
            const r = Math.hypot(dx, dy);
            if (r < rmax) T.gr![Math.floor(r / bw)] += 2;
            if (r < nb) {
              const th = Math.atan2(dy, dx);
              psiRe[i] += Math.cos(6 * th);
              psiIm[i] += Math.sin(6 * th);
              psiRe[j] += Math.cos(6 * (th + Math.PI));
              psiIm[j] += Math.sin(6 * (th + Math.PI));
              nn[i]++;
              nn[j]++;
            }
          }
        }
      }
    }
    let gr = 0;
    let gi = 0;
    for (let i = 0; i < N; i++) {
      if (nn[i] > 0) {
        gr += psiRe[i] / nn[i];
        gi += psiIm[i] / nn[i];
      }
    }
    sample.psi6 = Math.hypot(gr, gi) / N;
    T.grSnapshots! += 1;
  }

  private profileSample(): void {
    const s = this.sim.store;
    const N = s.count;
    const D = this.map.diameter;
    const T = this.tallies;
    const nb = T.count!.length;
    const bw = FINE * D;
    for (let i = 0; i < N; i++) {
      let b = Math.floor(s.y[i] / bw);
      if (b < 0) b = 0;
      else if (b >= nb) b = nb - 1;
      T.count![b] += 1;
      T.mvy2![b] += s.mass[i] * s.vy[i] * s.vy[i];
      T.mvx2![b] += s.mass[i] * s.vx[i] * s.vx[i];
      T.mvx![b] += s.mass[i] * s.vx[i];
      T.eint![b] += s.energy[i];
    }
    T.profileSnapshots! += 1;
    if (this.occ) {
      const flux = new Float64Array(T.planesOcc!.length);
      this.occ.measure(s, this.sim.domain, 0, { y0: D / 2, spacing: PLANE * D, flux });
      for (let p = 0; p < flux.length; p++) T.planesOcc![p] += flux[p];
      T.occSamples! += 1;
    }
    // first-layer ψ₆ (report-only): parcels within 0.6 D of either wall, neighbours within 1.4 D
    const H = this.sim.domain.height;
    const near = (yy: number) => yy < D / 2 + 0.6 * D || yy > H - D / 2 - 0.6 * D;
    let sum = 0;
    let n = 0;
    const W = this.sim.domain.width;
    for (let i = 0; i < N; i++) {
      if (!near(s.y[i])) continue;
      let re = 0;
      let im = 0;
      let c = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        let dx = s.x[j] - s.x[i];
        dx -= W * Math.round(dx / W);
        const dy = s.y[j] - s.y[i];
        if (dx * dx + dy * dy < 1.96 * D * D) {
          const th = Math.atan2(dy, dx);
          re += Math.cos(6 * th);
          im += Math.sin(6 * th);
          c++;
        }
      }
      if (c > 0) {
        sum += Math.hypot(re, im) / c;
        n++;
      }
    }
    if (n > 0) {
      T.psi6Sum! += sum / n;
      T.psi6Samples! += 1;
    }
  }

  /** Final record (deterministic content; `timing` is wall-clock and excluded from comparisons). */
  result() {
    if (!this.done) throw new Error('run not finished');
    const walls = this.sim.walls.map((w) => w.totals());
    return {
      spec: this.spec,
      map: this.map,
      info: this.info,
      measureTime: this.sim.time / this.unit,
      samples: this.samples,
      tallies: this.tallies,
      walls,
      lostEvents: this.lostEvents,
      phaseLedgers: this.phaseLedgers,
      timing: this.timing,
    };
  }
}

export type UB0Result = ReturnType<UB0Run['result']>;
