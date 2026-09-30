import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import { aggregateEmptySpace, EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { FieldAverager } from '../measurements/FieldAverager';
import { ensembleEstimate, linearRegression, mean, type Estimate } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';


/** time between no-empty-space samples (Master prompt §20) */
const EMPTY_SPACE_INTERVAL = 10;
/**
 * FLAT-WALL BOUNDARY LAYER (Master prompt §17, Bible §16).
 *
 * A uniform stream enters from a reservoir on the left and leaves into one on
 * the right (walls/ReservoirBoundary, stated state n₀, kT₀, U). The floor is
 * specular except for a flat plate [x_le, x_te] that is diffuse (Aw) at kT_w.
 * The top is also an open reservoir boundary (far field), so fluid displaced
 * by the growing layer can leave instead of accelerating the outer flow; a
 * closed specular top was tried first and produced a 35 % outer-flow
 * acceleration along the plate (blockage). The run starts impulsively.
 * No boundary-layer profile, thickness law or skin-friction law is imposed or
 * fitted as a model — the experiment asks whether a near-wall layer emerges.
 *
 * Measured after the start-up transient, averaged over time and seeds:
 *   u(x, y), n(x, y), kT(x, y)            (FieldAverager)
 *   τ_w(x), p_w(x)                        (plate wall tallies per bin)
 *   U_e(x)   outer velocity: mean u over y ∈ [outerFrom, outerTo]·H
 *   δ*(x) = ∫(1 − u/U_e)dy, θ(x) = ∫(u/U_e)(1 − u/U_e)dy over y ∈ [0, outerFrom·H]
 *   δ₉₀(x)   first height where u ≥ 0.9 U_e
 *   growth exponent p from ln δ* = a + p ln(x − x_le)  (a measured exponent, not a law)
 *   μ_wall(x) = τ_w / (∂u/∂y from the first two cells) — an APPARENT wall viscosity;
 *            the first cells lie in the Knudsen layer, so this is not the bulk μ
 *   von Kármán check: dθ/dx vs τ_w/(ρ_e U_e²) + (2θ + δ*)(dU_e/dx)/U_e — both sides measured
 * The realised free stream is measured (A-18: the kinetic-only reservoir leaves
 * a dense interior below the stated density).
 */
export interface BoundaryLayerParams {
  length: number;
  height: number;
  plateStart: number;
  plateEnd: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  speed: number;
  accommodation: number;
  wallKT: number;
  seeds: number[];
  startupTime: number;
  measurementTime: number;
  sampleInterval: number;
  cellX: number;
  cellY: number;
  wallBinWidth: number;
  stationFractions: number[];
  outerFrom: number;
  outerTo: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  /** measured effective viscosity / sound speed from other records (for Re_x, Mp) */
  viscosity: null | { value: number; se: number; source: string };
  soundSpeed: null | { value: number; se: number; source: string };
}

export const BOUNDARY_LAYER_REFERENCE: BoundaryLayerParams = {
  length: 450,
  height: 200,
  plateStart: 100,
  plateEnd: 400,
  areaFraction: 0.1,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  accommodation: 1,
  wallKT: 1,
  seeds: [91, 92, 93, 94, 95, 96, 97, 98],
  startupTime: 800,
  measurementTime: 800,
  sampleInterval: 1,
  cellX: 10,
  cellY: 4,
  wallBinWidth: 10,
  stationFractions: [0.1, 0.25, 0.5, 0.75, 0.95],
  outerFrom: 0.6,
  outerTo: 0.9,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  viscosity: null,
  soundSpeed: null,
};

interface Spec {
  seed: number;
}

interface BLRunResult {
  seed: number;
  nx: number;
  ny: number;
  cellX: number;
  cellY: number;
  ux: number[];
  uy: number[];
  density: number[];
  kT: number[];
  wallBins: number;
  wallShear: number[];
  wallPressure: number[];
  /** τ_w over the whole plate in the first and second half of the measurement */
  plateShearHalves: [number, number];
  particleCountMean: number;
  boundaryStats: unknown[];
  conservation: ReturnType<ConservationMonitor['summary']>;
  emptySpace: EmptySpaceSummary;
  safetyFlags: SafetyFlag[];
  halted: boolean;
}

class BoundaryLayerRun implements Run<BLRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: BoundaryLayerParams;
  private readonly seed: number;
  private readonly field: FieldAverager;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private nextEmpty = 0;
  private measuring = false;
  private nextSample = 0;
  private tally0: { tan: Float64Array; nor: Float64Array } | null = null;
  private tallyMid: Float64Array | null = null;
  private tMeasure0 = 0;
  private countSum = 0;
  private countN = 0;

  constructor(p: BoundaryLayerParams, seed: number) {
    this.p = p;
    this.seed = seed;
    this.label = `boundary layer seed=${seed}`;
    const domain: DomainSpec = { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false };
    const n0 = p.areaFraction / (Math.PI * p.radius * p.radius);
    const N0 = Math.round(n0 * p.length * p.height);
    const { store } = createGas({
      count: N0,
      radius: p.radius,
      mass: p.mass,
      kT: p.kT,
      distribution: 'maxwell',
      seed,
      domain,
      flow: { x: p.speed, y: 0 },
      extraCapacity: Math.round(0.6 * N0),
    });
    const reservoir = { numberDensity: n0, kT: p.kT, velocity: { x: p.speed, y: 0 }, mass: p.mass, radius: p.radius };
    const bins = Math.round(p.length / p.wallBinWidth);
    this.sim = new Simulation(
      {
        domain,
        walls: [
          {
            side: 'bottom',
            accommodation: 0,
            bins,
            segments: [{ from: p.plateStart, to: p.plateEnd, accommodation: p.accommodation, temperature: p.wallKT, tangentialVelocity: 0 }],
          },
        ],
        boundaries: [
          { side: 'left', ...reservoir },
          { side: 'right', ...reservoir },
          { side: 'top', ...reservoir },
        ],
        collision: { enabled: true, restitution: 1, contact: p.contact, dissipationTarget: 'external' },
        timestep: p.timestep,
        seed,
        referenceKT: p.kT,
      },
      store,
    );
    this.field = new FieldAverager(this.sim.domain, Math.round(p.length / p.cellX), Math.round(p.height / p.cellY));
    this.conservation = new ConservationMonitor(this.sim);
    this.empty = new EmptySpaceMonitor(this.sim);
  }

  private wallTally() {
    const w = this.sim.walls[0];
    return { tan: w.tangentialImpulse.slice(), nor: w.normalImpulse.slice() };
  }

  advance(maxSteps: number): number {
    let k = 0;
    const p = this.p;
    while (k < maxSteps && !this.done) {
      if (!this.sim.step()) {
        this.done = true;
        break;
      }
      k++;
      const t = this.sim.time;
      if (t >= this.nextEmpty) {
        this.empty.sample();
        this.nextEmpty += EMPTY_SPACE_INTERVAL;
      }
      if (!this.measuring && t >= p.startupTime) {
        this.measuring = true;
        this.tally0 = this.wallTally();
        this.tMeasure0 = t;
        this.nextSample = t;
      }
      if (this.measuring) {
        if (!this.tallyMid && t >= p.startupTime + p.measurementTime / 2) this.tallyMid = this.wallTally().tan;
        if (t >= this.nextSample) {
          this.field.add(this.sim.store);
          this.countSum += this.sim.store.count;
          this.countN++;
          this.nextSample += p.sampleInterval;
          if (this.countN % 50 === 0) this.conservation.sample();
        }
        if (t >= p.startupTime + p.measurementTime) this.done = true;
      }
    }
    return k;
  }

  progress() {
    return Math.min(1, this.sim.time / (this.p.startupTime + this.p.measurementTime));
  }

  live() {
    const s = this.sim.store;
    return {
      phase: this.measuring ? 'measure' : 'start-up',
      time: this.sim.time,
      particles: s.count,
      meanVelocity: s.momentum().x / s.totalMass(),
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): BLRunResult {
    this.sim.checkSafety();
    this.conservation.sample();
    const p = this.p;
    const end = this.wallTally();
    const T = this.sim.time - this.tMeasure0;
    const bw = p.wallBinWidth;
    const t0 = this.tally0 ?? end;
    // shear ON the wall along +x; the flow drags the plate forward → positive
    const wallShear = Array.from(end.tan, (v, b) => (v - t0.tan[b]) / (T * bw));
    const wallPressure = Array.from(end.nor, (v, b) => (v - t0.nor[b]) / (T * bw));
    const plate = (arr: ArrayLike<number>) => {
      let s = 0;
      for (let b = 0; b < arr.length; b++) {
        const xc = (b + 0.5) * bw;
        if (xc > p.plateStart && xc < p.plateEnd) s += arr[b];
      }
      return s;
    };
    const mid = this.tallyMid ?? end.tan;
    const halves: [number, number] = [
      (plate(mid) - plate(t0.tan)) / ((T / 2) * (p.plateEnd - p.plateStart)),
      (plate(end.tan) - plate(mid)) / ((T / 2) * (p.plateEnd - p.plateStart)),
    ];
    return {
      seed: this.seed,
      nx: this.field.nx,
      ny: this.field.ny,
      cellX: this.field.cellW,
      cellY: this.field.cellH,
      ux: Array.from(this.field.field('ux')),
      uy: Array.from(this.field.field('uy')),
      density: Array.from(this.field.field('density')),
      kT: Array.from(this.field.field('kT')),
      wallBins: end.tan.length,
      wallShear,
      wallPressure,
      plateShearHalves: halves,
      particleCountMean: this.countN > 0 ? this.countSum / this.countN : Number.NaN,
      boundaryStats: this.sim.boundaries.map((b) => b.stats()),
      conservation: this.conservation.summary(),
      emptySpace: this.empty.summary(),
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
    };
  }
}

/** Boundary-layer integral measures of one velocity column (model-free definitions). */
export function columnMeasures(u: number[], cellY: number, height: number, outerFrom: number, outerTo: number) {
  const ny = u.length;
  const yc = (j: number) => (j + 0.5) * cellY;
  const outer = u.filter((_, j) => yc(j) >= outerFrom * height && yc(j) <= outerTo * height);
  const Ue = mean(outer);
  let dstar = 0;
  let theta = 0;
  let d90 = Number.NaN;
  for (let j = 0; j < ny && yc(j) < outerFrom * height; j++) {
    const r = u[j] / Ue;
    dstar += (1 - r) * cellY;
    theta += r * (1 - r) * cellY;
  }
  for (let j = 0; j < ny; j++) {
    if (u[j] >= 0.9 * Ue) {
      if (j === 0) d90 = yc(0);
      else d90 = yc(j - 1) + ((0.9 * Ue - u[j - 1]) / (u[j] - u[j - 1])) * cellY;
      break;
    }
  }
  // wall gradient from the first two cell centres (one-sided, u(0) not assumed)
  const gradWall = (u[1] - u[0]) / cellY;
  return { Ue, dstar, theta, d90, nearWall: u[0], gradWall };
}

export class BoundaryLayerExperiment extends SequentialExperiment<Spec, BLRunResult> {
  readonly type = 'boundary-layer' as const;
  readonly params: BoundaryLayerParams;

  constructor(p: BoundaryLayerParams) {
    super(p.seeds.map((seed) => ({ seed })));
    this.params = p;
  }

  protected createRun(spec: Spec): Run<BLRunResult> {
    return new BoundaryLayerRun(this.params, spec.seed);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results.filter((r) => !r.halted);
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const halted = this.results.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const maxE = Math.max(...this.results.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...this.results.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger incl. wall heat and open-boundary fluxes closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Momentum ledger incl. wall and open-boundary fluxes closes', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));
    const empty = aggregateEmptySpace(this.results.map((r) => r.emptySpace));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
      empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));
    if (runs.length === 0) {
      return this.emptyRecord(checks, warnings);
    }
    const { nx, ny, cellX, cellY } = runs[0];
    const col = (r: BLRunResult, i: number) => Array.from({ length: ny }, (_, j) => r.ux[j * nx + i]);
    const colOf = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor(x / cellX)));
    const Lp = p.plateEnd - p.plateStart;
    // upstream control a quarter of the way from the inlet to the leading edge
    const stationXs = [0.25 * p.plateStart, ...p.stationFractions.map((f) => p.plateStart + f * Lp)];

    // per-seed column measures at each station
    const stations = stationXs.map((x, s) => {
      const i = colOf(x);
      const per = runs.map((r) => columnMeasures(col(r, i), cellY, p.height, p.outerFrom, p.outerTo));
      const rhoE = runs.map((r) => {
        const js = Array.from({ length: ny }, (_, j) => j).filter((j) => (j + 0.5) * cellY >= p.outerFrom * p.height && (j + 0.5) * cellY <= p.outerTo * p.height);
        return mean(js.map((j) => r.density[j * nx + i]));
      });
      const wb = Math.min(runs[0].wallBins - 1, Math.floor(x / p.wallBinWidth));
      const tau = runs.map((r) => r.wallShear[wb]);
      return {
        label: s === 0 ? 'upstream control (specular floor)' : `plate ${Math.round(100 * p.stationFractions[s - 1])} %`,
        x,
        xFromLeadingEdge: x - p.plateStart,
        Ue: ensembleEstimate(per.map((q) => q.Ue)),
        densityOuter: ensembleEstimate(rhoE),
        deficitAtWall: ensembleEstimate(per.map((q) => 1 - q.nearWall / q.Ue)),
        displacementThickness: ensembleEstimate(per.map((q) => q.dstar)),
        momentumThickness: ensembleEstimate(per.map((q) => q.theta)),
        delta90: ensembleEstimate(per.map((q) => q.d90).filter(Number.isFinite)),
        wallShear: ensembleEstimate(tau),
        skinFriction: ensembleEstimate(tau.map((t, k) => t / (0.5 * rhoE[k] * per[k].Ue ** 2))),
        wallGradient: ensembleEstimate(per.map((q) => q.gradWall)),
        inSituViscosity: ensembleEstimate(tau.map((t, k) => t / per[k].gradWall)),
        meanProfile: Array.from({ length: ny }, (_, j) => mean(runs.map((r) => r.ux[j * nx + i]))),
      };
    });
    const control = stations[0];
    const plateSt = stations.slice(1);

    // thickness growth exponent (per seed, then ensemble)
    const growth = ensembleEstimate(
      runs.map((r) => {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const f of p.stationFractions) {
          const x = p.plateStart + f * Lp;
          const q = columnMeasures(col(r, colOf(x)), cellY, p.height, p.outerFrom, p.outerTo);
          if (q.dstar > 0) {
            xs.push(Math.log(x - p.plateStart));
            ys.push(Math.log(q.dstar));
          }
        }
        return xs.length >= 3 ? linearRegression(xs, ys).slope : Number.NaN;
      }).filter(Number.isFinite),
    );

    // von Kármán momentum-integral consistency between consecutive plate stations (seed-mean profiles)
    const vk = plateSt.slice(1).map((b, k) => {
      const a = plateSt[k];
      const dx = b.x - a.x;
      const lhs = (b.momentumThickness.mean - a.momentumThickness.mean) / dx;
      const Ue = 0.5 * (a.Ue.mean + b.Ue.mean);
      const rho = 0.5 * (a.densityOuter.mean + b.densityOuter.mean);
      const tauMid = 0.5 * (a.wallShear.mean + b.wallShear.mean);
      const theta = 0.5 * (a.momentumThickness.mean + b.momentumThickness.mean);
      const dstar = 0.5 * (a.displacementThickness.mean + b.displacementThickness.mean);
      const dUdx = (b.Ue.mean - a.Ue.mean) / dx;
      const rhs = tauMid / (rho * Ue * Ue) - ((2 * theta + dstar) * dUdx) / Ue;
      return { from: a.label, to: b.label, dThetaDx: lhs, rhs, ratio: lhs / rhs };
    });

    // steady state: plate-mean shear in the two halves of the measurement
    const halfA = runs.map((r) => r.plateShearHalves[0]);
    const halfB = runs.map((r) => r.plateShearHalves[1]);
    const dHalf = ensembleEstimate(halfA.map((v, k) => halfB[k] - v));
    checks.push(check('steady-state', 'Plate-averaged wall shear is the same in both halves of the measurement',
      '|mean difference| < 3 SE (seed ensemble)', `Δ = ${dHalf.mean.toExponential(2)} ± ${dHalf.se.toExponential(2)}`,
      !(Math.abs(dHalf.mean) > 3 * dHalf.se), 'NOT CONVERGED'));
    const ctrlDeficit = control.deficitAtWall;
    checks.push(check('upstream-control', 'No near-wall velocity deficit over the specular floor upstream of the plate (control)',
      'deficit within 3 SE of zero', `${ctrlDeficit.mean.toPrecision(3)} ± ${ctrlDeficit.se.toPrecision(2)}`,
      Math.abs(ctrlDeficit.mean) < 3 * ctrlDeficit.se + 0.02, 'INCONCLUSIVE'));
    const last = plateSt[plateSt.length - 1];
    const first = plateSt[0];

    // determination (a finding, reported separately from validity checks)
    const deficitSignificant = last.deficitAtWall.mean > 3 * last.deficitAtWall.se && last.deficitAtWall.mean > 0.05;
    const grows = last.displacementThickness.mean - first.displacementThickness.mean > 3 * Math.hypot(last.displacementThickness.se, first.displacementThickness.se);
    const determination = deficitSignificant && grows
      ? 'EMERGED: a near-wall velocity deficit exists over the plate and its displacement thickness grows downstream'
      : deficitSignificant
        ? 'PARTIAL: a near-wall deficit exists but downstream growth is not statistically resolved'
        : 'NOT DETECTED: no significant near-wall velocity deficit';

    const n0 = p.areaFraction / (Math.PI * p.radius ** 2);
    const rhoE = mean(plateSt.map((s) => s.densityOuter.mean));
    const UeMean = mean(plateSt.map((s) => s.Ue.mean));
    if (Math.abs(rhoE / (n0 * p.mass) - 1) > 0.05) {
      warnings.push(`Realised free-stream density ${rhoE.toPrecision(3)} differs from the reservoir's stated ${(n0 * p.mass).toPrecision(3)} by ${(100 * (rhoE / (n0 * p.mass) - 1)).toFixed(1)} % (A-18). All normalisations use the realised value.`);
    }
    for (const r of this.results) for (const f of r.safetyFlags) warnings.push(`seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    const mu = p.viscosity;
    const muInSitu = ensembleEstimate(plateSt.map((s) => s.inSituViscosity.mean));
    const muForRe = mu ? mu.value : muInSitu.mean;
    const muSource = mu ? mu.source : 'the apparent wall viscosity measured here (Knudsen-layer affected; no Couette value supplied)';
    const reAtEnd = (rhoE * UeMean * Lp) / muForRe;
    const reDelta = (rhoE * last.Ue.mean * last.displacementThickness.mean) / muForRe;
    return {
      ...recordHeader('boundary-layer', 'Flat-wall boundary layer: does a near-wall layer emerge?', p.seeds),
      particleCount: Math.round(mean(runs.map((r) => r.particleCountMean))),
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: rhoE / p.mass, massDensity: rhoE, areaFraction: (rhoE / p.mass) * Math.PI * p.radius ** 2 },
      temperature: { kT: p.kT, definition: 'reservoir kT; local kT measured (A-03)' },
      speed: p.speed,
      geometry: `${p.length} × ${p.height} domain; diffuse plate on [${p.plateStart}, ${p.plateEnd}] in a specular floor; open (reservoir) inlet, outlet and top`,
      wallModel: 'segmented planar floor (Maxwell accommodation on the plate); reservoir inlet, outlet and far-field top (A-18)',
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: runs.length * (p.startupTime + p.measurementTime), steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: {
        simulation: reAtEnd,
        effective: reDelta,
        physical: null,
        note: `Re_sim = ρ_e U_e L_plate / μ at the plate end; Re_eff = ρ_e U_e δ* / μ from the layer's own measured displacement thickness at the last station. μ from ${muSource}. Apparent wall viscosity τ_w/(∂u/∂y) measured here: ${muInSitu.mean.toPrecision(3)} ± ${muInSitu.se.toPrecision(2)}.`,
      },
      mach: p.soundSpeed
        ? { Mp: UeMean / p.soundSpeed.value, benchmark: null, note: `Mp = U_e/c_p, c_p from ${p.soundSpeed.source} (measured at the stated, not the realised, density)` }
        : { Mp: null, benchmark: null, note: 'No measured c_p supplied.' },
      results: {
        emptySpace: empty,
        determination,
        stations,
        growthExponent: growth,
        vonKarman: vk,
        apparentWallViscosity: muInSitu,
        freeStream: { Ue: UeMean, density: rhoE, statedDensity: n0 * p.mass, statedSpeed: p.speed },
        wallShearProfile: {
          x: Array.from({ length: runs[0].wallBins }, (_, b) => (b + 0.5) * p.wallBinWidth),
          tau: Array.from({ length: runs[0].wallBins }, (_, b) => mean(runs.map((r) => r.wallShear[b]))),
          pressure: Array.from({ length: runs[0].wallBins }, (_, b) => mean(runs.map((r) => r.wallPressure[b]))),
        },
        meanField: { nx, ny, cellX, cellY, ux: Array.from({ length: nx * ny }, (_, c) => mean(runs.map((r) => r.ux[c]))) },
        boundaryStats: runs.map((r) => r.boundaryStats),
      },
      uncertainty: { note: 'Ensemble over independent seeds (t-based CIs) for every station quantity.' },
      convergence: { status: 'NOT ASSESSED', note: 'Single resolution; domain height and plate length dependence not yet studied.' },
      benchmarks: this.benchmarks(plateSt, rhoE, UeMean, muForRe),
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-08', 'A-18'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: this.results.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }

  private benchmarks(st: { xFromLeadingEdge: number; displacementThickness: Estimate; skinFriction: Estimate }[], rho: number, U: number, mu: number) {
    // BENCHMARK ONLY: Blasius flat plate (incompressible, high Re, no slip)
    const nu = mu / rho;
    return {
      note: 'Blasius (incompressible continuum, no slip, Re → ∞): comparison only. At Re ~ 10² and with wall slip it is not expected to hold.',
      viscosityUsed: mu,
      stations: st.map((s) => {
        const x = s.xFromLeadingEdge;
        const Rex = (U * x) / nu;
        return {
          x,
          Rex,
          blasiusDisplacementThickness: 1.7208 * Math.sqrt((nu * x) / U),
          measuredDisplacementThickness: s.displacementThickness.mean,
          blasiusSkinFriction: 0.664 / Math.sqrt(Rex),
          measuredSkinFriction: s.skinFriction.mean,
        };
      }),
      blasiusGrowthExponent: 0.5,
    };
  }

  private emptyRecord(checks: AcceptanceCheck[], warnings: string[]): ExperimentRecord {
    const p = this.params;
    return {
      ...recordHeader('boundary-layer', 'Flat-wall boundary layer', p.seeds),
      particleCount: 0,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: Number.NaN, massDensity: Number.NaN, areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: '' },
      speed: p.speed,
      geometry: '',
      wallModel: '',
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: 0, steps: 0, collisionsPerParticle: 0 },
      reynolds: { simulation: null, effective: null, physical: null, note: 'no data' },
      mach: { Mp: null, benchmark: null, note: 'no data' },
      results: {},
      uncertainty: {},
      convergence: { status: 'NOT ASSESSED', note: '' },
      benchmarks: {},
      assumptions: [],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: [],
      config: p,
    };
  }
}
