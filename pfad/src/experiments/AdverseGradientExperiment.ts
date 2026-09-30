import type { ContactResolution } from '../core/CollisionModel';
import type { DomainSpec } from '../core/Domain';
import type { TimestepPolicy } from '../core/Integrator';
import type { SafetyFlag } from '../core/Safety';
import { Simulation } from '../core/Simulation';
import { createGas } from '../gas/InitialConditions';
import { aggregateEmptySpace, EmptySpaceMonitor, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { FieldAverager } from '../measurements/FieldAverager';
import { ensembleEstimate, mean } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import type { ReservoirBoundaryConfig } from '../walls/ReservoirBoundary';
import { columnMeasures } from './BoundaryLayerExperiment';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';


/** time between no-empty-space samples (Master prompt §20) */
const EMPTY_SPACE_INTERVAL = 10;
/**
 * ADVERSE-GRADIENT SEPARATION (Master prompt §18, Bible §17).
 *
 * Reservoir inlet (n₁, kT, U) on the left, reservoir outlet on the right, and a
 * diffuse plate in a specular floor. The adverse gradient comes from a
 * replaceable GRADIENT GENERATOR (strength parameter s):
 *   'back-pressure'  (s = β) — specular lid; the outlet reservoir holds density
 *                    β·n₁ with drift U/β, so the flow must climb a pressure rise.
 *                    Observed: in this lidded channel strong β reverses the WHOLE
 *                    flow before any local separation appears.
 *   'far-field'      (s = Δ) — open top reservoir whose stream slows linearly
 *                    from U to (1 − Δ)U over the middle of the plate, with the
 *                    outward drift v = H·ΔU/L_d that continuity requires there;
 *                    outlet stream (1 − Δ)U. The outer flow decelerates but stays
 *                    forward, as over the aft part of a wing.
 * Both are boundary conditions; no pressure-gradient or separation law is used.
 * A near-wall reversal counts as SEPARATION only if the outer flow at that
 * station still moves forward (U_e > 0); otherwise it is BULK REVERSAL.
 *
 * Measured per configuration (β), averaged over time and seeds:
 *   τ_w(x) on the plate (wall tallies), outer velocity U_e(x), near-wall
 *   velocity, reverse-flow fraction (share of time blocks in which the
 *   near-wall cell's block-mean u < 0), δ*, θ, shape factor H = δ* / θ, and the
 *   slow-layer momentum ratio S(x) = Σ_{y<δ₉₀} ρu² dy / (ρ_e U_e² δ₉₀).
 * Separation onset: the first plate station (beyond the first 10 % of the
 * plate) where the seed-mean τ_w is negative at that and the next station and
 * significantly negative (τ̄ + 2 SE < 0) at the first.
 *
 * Threshold as a hypothesis (never hard-coded): configurations are split into
 * TRAINING and TEST sets. For each candidate indicator (S, H) the critical
 * value is the mean indicator at the observed onset over separated training
 * configurations. It then predicts, for every TEST configuration, whether and
 * where separation occurs; the predictions are scored against the measured
 * test outcomes.
 */
export interface AdverseGradientParams {
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
  generator: 'back-pressure' | 'far-field';
  /** generator strengths: β for back-pressure, Δ for far-field */
  strengths: number[];
  /** far-field: deceleration zone as fractions of the plate */
  decelerationFrom: number;
  decelerationTo: number;
  /** indices into `strengths` used for training; the rest are test configurations */
  trainingIndices: number[];
  seeds: number[];
  startupTime: number;
  measurementTime: number;
  sampleInterval: number;
  reverseBlock: number;
  cellX: number;
  cellY: number;
  outerFrom: number;
  outerTo: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  /** measured effective viscosity / sound speed from other records (for Re, Mp) */
  viscosity: null | { value: number; se: number; source: string };
  soundSpeed: null | { value: number; se: number; source: string };
}

export const ADVERSE_GRADIENT_REFERENCE: AdverseGradientParams = {
  length: 400,
  height: 80,
  plateStart: 40,
  plateEnd: 380,
  areaFraction: 0.1,
  radius: 0.5,
  mass: 1,
  kT: 1,
  speed: 1,
  accommodation: 1,
  wallKT: 1,
  generator: 'far-field',
  strengths: [0, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 0.95],
  decelerationFrom: 0.2,
  decelerationTo: 0.8,
  trainingIndices: [0, 2, 4, 6],
  seeds: [101, 102, 103, 104],
  startupTime: 800,
  measurementTime: 800,
  sampleInterval: 1,
  reverseBlock: 50,
  cellX: 10,
  cellY: 3,
  outerFrom: 0.6,
  outerTo: 0.9,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  viscosity: null,
  soundSpeed: null,
};

interface Spec {
  strengthIndex: number;
  seed: number;
}

interface AGRunResult {
  strengthIndex: number;
  seed: number;
  nx: number;
  ny: number;
  ux: number[];
  density: number[];
  wallShear: number[];
  wallPressure: number[];
  reverseFraction: number[];
  conservation: ReturnType<ConservationMonitor['summary']>;
  emptySpace: EmptySpaceSummary;
  safetyFlags: SafetyFlag[];
  halted: boolean;
}

class AGRun implements Run<AGRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: AdverseGradientParams;
  private readonly spec: Spec;
  private readonly field: FieldAverager;
  private readonly conservation: ConservationMonitor;
  private readonly empty: EmptySpaceMonitor;
  private nextEmpty = 0;
  private measuring = false;
  private nextSample = 0;
  private t0 = 0;
  private tally0: { tan: Float64Array; nor: Float64Array } | null = null;
  private readonly blockSum: Float64Array;
  private readonly blockMass: Float64Array;
  private readonly negBlocks: Float64Array;
  private blocks = 0;
  private inBlock = 0;

  constructor(p: AdverseGradientParams, spec: Spec) {
    this.p = p;
    this.spec = spec;
    const strength = p.strengths[spec.strengthIndex];
    this.label = `adverse gradient ${p.generator} s=${strength} seed=${spec.seed}`;
    const domain: DomainSpec = { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false };
    const n1 = p.areaFraction / (Math.PI * p.radius * p.radius);
    const N0 = Math.round(n1 * p.length * p.height);
    const { store } = createGas({
      count: N0,
      radius: p.radius,
      mass: p.mass,
      kT: p.kT,
      distribution: 'maxwell',
      seed: spec.seed,
      domain,
      flow: { x: p.speed, y: 0 },
      extraCapacity: Math.round(Math.max(1, p.generator === 'back-pressure' ? strength : 1) * N0),
    });
    const res = { numberDensity: n1, kT: p.kT, mass: p.mass, radius: p.radius };
    const inlet: ReservoirBoundaryConfig = { side: 'left', ...res, velocity: { x: p.speed, y: 0 } };
    const floor = {
      side: 'bottom' as const,
      accommodation: 0,
      bins: Math.round(p.length / p.cellX),
      segments: [{ from: p.plateStart, to: p.plateEnd, accommodation: p.accommodation, temperature: p.wallKT }],
    };
    let walls: ConstructorParameters<typeof Simulation>[0]['walls'];
    let boundaries: ReservoirBoundaryConfig[];
    if (p.generator === 'back-pressure') {
      walls = [floor, { side: 'top', accommodation: 0 }];
      boundaries = [inlet, { side: 'right', ...res, numberDensity: strength * n1, velocity: { x: p.speed / strength, y: 0 } }];
    } else {
      const Lp = p.plateEnd - p.plateStart;
      const x0 = p.plateStart + p.decelerationFrom * Lp;
      const x1 = p.plateStart + p.decelerationTo * Lp;
      const Uend = p.speed * (1 - strength);
      const vOut = (p.height * p.speed * strength) / (x1 - x0); // continuity: outward drift in the zone
      walls = [floor];
      boundaries = [
        inlet,
        { side: 'right', ...res, velocity: { x: Uend, y: 0 } },
        {
          side: 'top',
          ...res,
          velocity: { x: p.speed, y: 0 },
          velocityProfile: { at: [x0 - 1, x0, x1, x1 + 1], x: [p.speed, p.speed, Uend, Uend], y: [0, vOut, vOut, 0] },
        },
      ];
    }
    this.sim = new Simulation(
      {
        domain,
        walls,
        boundaries,
        collision: { enabled: true, restitution: 1, contact: p.contact, dissipationTarget: 'external' },
        timestep: p.timestep,
        seed: spec.seed,
        referenceKT: p.kT,
      },
      store,
    );
    this.field = new FieldAverager(this.sim.domain, Math.round(p.length / p.cellX), Math.round(p.height / p.cellY));
    this.conservation = new ConservationMonitor(this.sim);
    this.empty = new EmptySpaceMonitor(this.sim);
    const nx = this.field.nx;
    this.blockSum = new Float64Array(nx);
    this.blockMass = new Float64Array(nx);
    this.negBlocks = new Float64Array(nx);
  }

  private tally() {
    const w = this.sim.walls[0];
    return { tan: w.tangentialImpulse.slice(), nor: w.normalImpulse.slice() };
  }

  /** accumulate near-wall (first row) momentum and mass per column for the reverse-flow blocks */
  private nearWallSample() {
    const s = this.sim.store;
    const cw = this.field.cellW;
    const ch = this.field.cellH;
    for (let i = 0; i < s.count; i++) {
      if (s.y[i] >= ch) continue;
      const c = Math.min(this.field.nx - 1, Math.max(0, Math.floor(s.x[i] / cw)));
      this.blockSum[c] += s.mass[i] * s.vx[i];
      this.blockMass[c] += s.mass[i];
    }
    if (++this.inBlock >= this.p.reverseBlock) {
      for (let c = 0; c < this.field.nx; c++) {
        if (this.blockMass[c] > 0 && this.blockSum[c] / this.blockMass[c] < 0) this.negBlocks[c]++;
      }
      this.blockSum.fill(0);
      this.blockMass.fill(0);
      this.inBlock = 0;
      this.blocks++;
    }
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
        this.t0 = t;
        this.tally0 = this.tally();
        this.nextSample = t;
      }
      if (this.measuring) {
        if (t >= this.nextSample) {
          this.field.add(this.sim.store);
          this.nearWallSample();
          this.nextSample += p.sampleInterval;
          if (this.field.snapshots % 50 === 0) this.conservation.sample();
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
    return { phase: this.measuring ? 'measure' : 'start-up', time: this.sim.time, particles: this.sim.store.count, energyError: this.sim.relativeEnergyResidual() };
  }

  result(): AGRunResult {
    this.sim.checkSafety();
    this.conservation.sample();
    const end = this.tally();
    const t0 = this.tally0 ?? end;
    const T = this.sim.time - this.t0;
    const bw = this.p.cellX;
    return {
      strengthIndex: this.spec.strengthIndex,
      seed: this.spec.seed,
      nx: this.field.nx,
      ny: this.field.ny,
      ux: Array.from(this.field.field('ux')),
      density: Array.from(this.field.field('density')),
      wallShear: Array.from(end.tan, (v, b) => (v - t0.tan[b]) / (T * bw)),
      wallPressure: Array.from(end.nor, (v, b) => (v - t0.nor[b]) / (T * bw)),
      reverseFraction: Array.from(this.negBlocks, (v) => (this.blocks > 0 ? v / this.blocks : Number.NaN)),
      conservation: this.conservation.summary(),
      emptySpace: this.empty.summary(),
      safetyFlags: [...this.sim.flags],
      halted: this.sim.halted,
    };
  }
}

export interface StationRow {
  x: number;
  tau: { mean: number; se: number };
  Ue: number;
  /** realised outer-band mass density */
  rhoE: number;
  nearWallU: number;
  reverseFraction: number;
  dstar: number;
  theta: number;
  shapeFactor: number;
  slowMomentum: number;
  wallPressure: number;
}

/** First plate station (beyond the first 10 %) where τ̄ < 0 here and next, and τ̄ + 2SE < 0 here. */
export function detectOnset(rows: StationRow[], plateStart: number, plateEnd: number): number | null {
  const from = plateStart + 0.1 * (plateEnd - plateStart);
  for (let k = 0; k + 1 < rows.length; k++) {
    const r = rows[k];
    if (r.x < from) continue;
    if (r.tau.mean < 0 && rows[k + 1].tau.mean < 0 && r.tau.mean + 2 * r.tau.se < 0) return r.x;
  }
  return null;
}

/** First station where an indicator crosses its critical value (downward for S, upward for H). */
export function predictOnset(rows: StationRow[], key: 'slowMomentum' | 'shapeFactor', crit: number, plateStart: number, plateEnd: number): number | null {
  const from = plateStart + 0.1 * (plateEnd - plateStart);
  for (const r of rows) {
    if (r.x < from) continue;
    const v = r[key];
    if (!Number.isFinite(v)) continue;
    if (key === 'slowMomentum' ? v <= crit : v >= crit) return r.x;
  }
  return null;
}

export class AdverseGradientExperiment extends SequentialExperiment<Spec, AGRunResult> {
  readonly type = 'separation' as const;
  readonly params: AdverseGradientParams;

  constructor(p: AdverseGradientParams) {
    const specs: Spec[] = [];
    p.strengths.forEach((_, strengthIndex) => {
      for (const seed of p.seeds) specs.push({ strengthIndex, seed });
    });
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<AGRunResult> {
    return new AGRun(this.params, spec);
  }

  /** Per-configuration station table from seed-averaged fields and per-seed wall shear. */
  stationTable(strengthIndex: number): StationRow[] {
    const p = this.params;
    const runs = this.results.filter((r) => r.strengthIndex === strengthIndex && !r.halted);
    if (runs.length === 0) return [];
    const { nx, ny } = runs[0];
    const cellY = p.height / ny;
    const rows: StationRow[] = [];
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * p.cellX;
      if (x < p.plateStart || x > p.plateEnd) continue;
      const u = Array.from({ length: ny }, (_, j) => mean(runs.map((r) => r.ux[j * nx + i])));
      const rho = Array.from({ length: ny }, (_, j) => mean(runs.map((r) => r.density[j * nx + i])));
      const m = columnMeasures(u, cellY, p.height, p.outerFrom, p.outerTo);
      const js = rho.map((_, j) => j).filter((j) => (j + 0.5) * cellY >= p.outerFrom * p.height && (j + 0.5) * cellY <= p.outerTo * p.height);
      const rhoE = mean(js.map((j) => rho[j]));
      let slow = Number.NaN;
      if (Number.isFinite(m.d90) && m.d90 > 0) {
        let s = 0;
        for (let j = 0; j < ny && (j + 0.5) * cellY < m.d90; j++) s += rho[j] * u[j] * Math.abs(u[j]) * cellY;
        slow = s / (rhoE * m.Ue * m.Ue * m.d90);
      }
      const tau = ensembleEstimate(runs.map((r) => r.wallShear[i]));
      rows.push({
        x,
        tau: { mean: tau.mean, se: tau.se },
        Ue: m.Ue,
        rhoE,
        nearWallU: m.nearWall,
        reverseFraction: mean(runs.map((r) => r.reverseFraction[i])),
        dstar: m.dstar,
        theta: m.theta,
        shapeFactor: m.theta !== 0 ? m.dstar / m.theta : Number.NaN,
        slowMomentum: slow,
        wallPressure: mean(runs.map((r) => r.wallPressure[i])),
      });
    }
    return rows;
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const halted = this.results.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const maxE = Math.max(...this.results.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...this.results.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger incl. open-boundary fluxes closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Momentum ledger incl. open-boundary fluxes closes', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));
    const empty = aggregateEmptySpace(this.results.map((r) => r.emptySpace));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
      empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));

    const configs = p.strengths.map((strength, k) => {
      const rows = this.stationTable(k);
      const reversalAt = rows.length ? detectOnset(rows, p.plateStart, p.plateEnd) : null;
      const outerAt = reversalAt === null ? null : rows.find((r) => r.x === reversalAt)!.Ue;
      const bulkReversal = rows.some((r) => r.Ue <= 0);
      // separation = near-wall reversal under a still-forward outer flow
      const onset = reversalAt !== null && outerAt !== null && outerAt > 0 && !bulkReversal ? reversalAt : null;
      const at = (key: 'slowMomentum' | 'shapeFactor') => (onset === null ? null : rows.find((r) => r.x === onset)?.[key] ?? null);
      return {
        strength,
        role: p.trainingIndices.includes(k) ? 'training' : 'test',
        classification: onset !== null ? 'SEPARATED' : bulkReversal ? 'BULK REVERSAL' : reversalAt !== null ? 'NEAR-WALL REVERSAL, OUTER FLOW NOT FORWARD' : 'ATTACHED',
        separated: onset !== null,
        onset,
        nearWallReversalAt: reversalAt,
        indicatorsAtOnset: { slowMomentum: at('slowMomentum'), shapeFactor: at('shapeFactor') },
        minSlowMomentum: Math.min(...rows.map((r) => r.slowMomentum).filter(Number.isFinite)),
        maxShapeFactor: Math.max(...rows.map((r) => r.shapeFactor).filter(Number.isFinite)),
        maxReverseFraction: Math.max(...rows.map((r) => r.reverseFraction).filter(Number.isFinite)),
        outerDeceleration: rows.length ? (rows[rows.length - 1].Ue - rows[0].Ue) / rows[0].Ue : Number.NaN,
        rows,
      };
    });

    // --- threshold hypotheses from TRAINING configurations only
    const hyps = (['slowMomentum', 'shapeFactor'] as const).map((key) => {
      const train = configs.filter((c) => c.role === 'training');
      const vals = train.map((c) => c.indicatorsAtOnset[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
      if (vals.length === 0) {
        return { indicator: key, critical: null, trainedOn: 0, note: 'no separated training configuration: no threshold can be generated', tests: [] as unknown[] };
      }
      const crit = mean(vals);
      const tests = configs
        .filter((c) => c.role === 'test')
        .map((c) => {
          const predicted = predictOnset(c.rows, key, crit, p.plateStart, p.plateEnd);
          return {
            strength: c.strength,
            measuredOnset: c.onset,
            predictedOnset: predicted,
            classificationCorrect: (predicted === null) === (c.onset === null),
            positionError: predicted !== null && c.onset !== null ? predicted - c.onset : null,
          };
        });
      const correct = tests.filter((t) => t.classificationCorrect).length;
      const errs = tests.map((t) => t.positionError).filter((e): e is number => e !== null);
      return {
        indicator: key,
        critical: crit,
        criticalSpread: vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - crit) ** 2, 0) / (vals.length - 1)) : null,
        trainedOn: vals.length,
        tests,
        classificationAccuracy: tests.length ? correct / tests.length : null,
        meanAbsPositionError: errs.length ? mean(errs.map(Math.abs)) : null,
      };
    });

    // Re and Mp from the realised upstream state of the weakest-gradient configuration
    const up = configs[0]?.rows[0];
    const Lp = p.plateEnd - p.plateStart;
    const reSim = up && p.viscosity ? (up.rhoE * up.Ue * Lp) / p.viscosity.value : null;
    const onsetRe = configs.map((c) => {
      const r0 = c.rows[0];
      return c.onset !== null && r0 && p.viscosity ? { strength: c.strength, reX: (r0.rhoE * r0.Ue * (c.onset - p.plateStart)) / p.viscosity.value } : null;
    }).filter((v) => v !== null);

    const anySep = configs.some((c) => c.separated);
    checks.push(check('separation-observed', 'At least one configuration separates, so a threshold can be studied',
      '≥ 1 separated configuration', `${configs.filter((c) => c.separated).length}/${configs.length} separated`, anySep, 'INCONCLUSIVE'));
    const trainSep = configs.filter((c) => c.role === 'training' && c.separated).length;
    const testSep = configs.filter((c) => c.role === 'test' && c.separated).length;
    checks.push(check('hypothesis-testable', 'Separated configurations exist in both the training and the test set',
      '≥ 1 separated training and ≥ 1 separated test configuration', `training ${trainSep}, test ${testSep}`, trainSep > 0 && testSep > 0, 'INCONCLUSIVE'));
    for (const r of this.results) for (const f of r.safetyFlags) warnings.push(`s=${p.strengths[r.strengthIndex]} seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    const bulk = configs.filter((c) => c.classification === 'BULK REVERSAL');
    if (bulk.length) warnings.push(`${bulk.length} configuration(s) reversed the whole flow (U_e ≤ 0 somewhere on the plate); these are not counted as separation.`);

    return {
      ...recordHeader('separation', 'Adverse gradient: separation onset and a data-generated threshold', p.seeds),
      particleCount: Math.round((p.areaFraction / (Math.PI * p.radius ** 2)) * p.length * p.height),
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: p.areaFraction / (Math.PI * p.radius ** 2), massDensity: (p.mass * p.areaFraction) / (Math.PI * p.radius ** 2), areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: 'reservoir kT' },
      speed: p.speed,
      geometry: `${p.length} × ${p.height}, diffuse plate on [${p.plateStart}, ${p.plateEnd}], ${p.generator === 'back-pressure' ? 'specular lid' : 'open far-field top'}`,
      wallModel: `segmented floor (diffuse plate), reservoir inlet/outlet, generator '${p.generator}'`,
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: this.results.length * (p.startupTime + p.measurementTime), steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: {
        simulation: reSim,
        effective: null,
        physical: null,
        note: p.viscosity
          ? `Re_sim = ρ_e U_e L_plate / μ with the realised upstream ρ_e, U_e (first plate station, s = ${p.strengths[0]}); μ from ${p.viscosity.source}. Re_x at separation onset: ${onsetRe.length ? onsetRe.map((o) => `s=${o!.strength}: ${o!.reX.toPrecision(3)}`).join(', ') : 'no onset'}.`
          : 'No measured μ supplied (set `viscosity` from a Couette record).',
      },
      mach: p.soundSpeed && up
        ? { Mp: up.Ue / p.soundSpeed.value, benchmark: null, note: `Mp = U_e/c_p upstream, c_p from ${p.soundSpeed.source} (measured at the stated, not the realised, density)` }
        : { Mp: null, benchmark: null, note: 'No measured c_p supplied.' },
      results: {
        emptySpace: empty,
        generator: p.generator,
        configurations: configs,
        thresholdHypotheses: hyps,
      },
      uncertainty: { note: 'τ_w: seed ensemble per station; fields: seed-averaged; thresholds: spread over training configurations.' },
      convergence: { status: 'NOT ASSESSED', note: 'Single resolution and channel geometry.' },
      benchmarks: {
        note: 'None used. Classical separation criteria (e.g. shape-factor or Thwaites-type values) are NOT used to define onset or thresholds.',
      },
      assumptions: ['A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-08', 'A-18'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: this.results.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
