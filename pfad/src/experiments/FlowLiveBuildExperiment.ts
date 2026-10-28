import { Simulation } from '../core/Simulation';
import { applyDelta, capByParticles, DEFAULT_LIVE, fitToLimits, planIncrement, type LiveFillConfig, type LiveStep, type LiveStop } from '../geometry/LiveFill';
import { sideY, unplace, validateGeometry, type Placement, type Side, type SurfaceGeometry } from '../geometry/SurfaceGeometry';
import { ConservationMonitor } from '../measurements/EnergyMonitor';
import { SurfaceFlowSampler } from '../measurements/SurfaceFlowSampler';
import { wakeFromTotals, WakeAccumulator, WAKE_LABEL, WAKE_SPEC, type WakeAnalysis } from '../measurements/WakeVoid';
import { check, combineStatus } from '../validation/Status';
import { PolygonBody } from '../walls/SolidBody';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';
import { bodyConfigFor, FLOW_GEOMETRY_QUICK, makeSimulation, placementFor, samplerSidesFor, type FlowGeometryParams } from './FlowGeometryExperiment';

/**
 * LIVE FILL ON THE REAL ENGINE (experimental): one simulation in which the surface grows while the gas flows.
 *
 * Phase 1, start-up: the starting geometry (a flat plate) in an open-boundary stream until the flow, and its
 * wake, have developed. Phase 2, live fill: every `interval` of simulation time the strip counts of the last
 * interval (with a decaying memory of the earlier ones) say how well the particles touch each station of the
 * chosen side (WakeVoid.ts). From the separation point, where they stop touching, to a front that advances
 * toward the trailing edge, a small amount of material is added where the particle cloud stands off the surface
 * (LiveFill.ts), only in space that holds no particle, and the polygon of the running simulation is reshaped
 * in place (PolygonBody.reshape). It stops when the void has closed, when nothing was ever unwetted, when the
 * geometry limits or the particles leave no room, or at the update limit.
 *
 * One seed builds the shape (the builder). The result is a GEOMETRY and the story of how it grew. It is not a
 * flow measurement of that geometry: that needs the ordinary `flow-geometry` experiment on the final shape, with
 * its own seeds, which is how the new version is then compared with the old one.
 *
 * Experimental: the unwetted-surface definition and the fill rule are conventions, not validated physics; nothing
 * about a classical airfoil, a Kutta condition or a target shape is used.
 */
export interface LiveBuildParams extends FlowGeometryParams {
  live: LiveFillConfig;
}

export const LIVE_BUILD_QUICK: LiveBuildParams = { ...FLOW_GEOMETRY_QUICK, seeds: [401], live: DEFAULT_LIVE };

export type { LiveStep, LiveStop };

export interface LiveBuildRunResult {
  seed: number;
  side: Side | null;
  startGeometry: SurfaceGeometry;
  finalGeometry: SurfaceGeometry;
  trajectory: LiveStep[];
  stop: { kind: LiveStop; reason: string };
  wakeStart: WakeAnalysis | null;
  wakeEnd: WakeAnalysis | null;
  /** the first onset, and the farthest the front reached */
  treated: { xLo: number; xHi: number } | null;
  particles: number;
  conservation: ReturnType<ConservationMonitor['summary']>;
  insideDetections: number;
  lateContacts: number;
  halted: boolean;
  safetyFlags: Simulation['flags'];
  time: number;
}

class LiveBuildRun implements Run<LiveBuildRunResult> {
  readonly label: string;
  readonly sim: Simulation;
  done = false;
  private readonly p: LiveBuildParams;
  private readonly cfg: LiveFillConfig;
  private readonly seed: number;
  private readonly body: PolygonBody;
  private readonly placement: Placement;
  private readonly conservation: ConservationMonitor;
  private readonly n0: number;
  private sampler: SurfaceFlowSampler;
  private geometry: SurfaceGeometry;
  private readonly startGeometry: SurfaceGeometry;
  private readonly acc: Record<Side, WakeAccumulator>;
  private side: Side | null;
  private started = false;
  private nextSample = 0;
  private nextUpdate = 0;
  private front: number | null = null;
  private updates = 0;
  private wetted = 0;
  private closed = 0;
  private stalled = 0;
  private blocked = 0;
  private limited = 0;
  private readonly trajectory: LiveStep[] = [];
  private stop: { kind: LiveStop; reason: string } | null = null;
  private wakeStart: WakeAnalysis | null = null;
  private wakeEnd: WakeAnalysis | null = null;
  private treated: { xLo: number; xHi: number } | null = null;
  private readonly maxTime: number;
  private last: LiveStep | null = null;

  constructor(p: LiveBuildParams, seed: number) {
    this.p = p;
    this.cfg = p.live;
    this.seed = seed;
    this.label = `live fill, α = ${p.alphaDeg}°, seed ${seed}`;
    this.sim = makeSimulation(p, seed);
    this.body = this.sim.bodies[0];
    this.placement = placementFor(p);
    this.geometry = p.geometry;
    this.startGeometry = p.geometry;
    this.side = p.live.side === 'auto' ? null : p.live.side;
    this.n0 = p.areaFraction / (Math.PI * p.radius * p.radius);
    this.sampler = this.newSampler(0);
    this.acc = { upper: new WakeAccumulator(p.geometry.stations, p.normalBins), lower: new WakeAccumulator(p.geometry.stations, p.normalBins) };
    this.conservation = new ConservationMonitor(this.sim);
    this.maxTime = p.startup + p.live.maxUpdates * p.live.interval + 1;
  }

  private newSampler(t: number): SurfaceFlowSampler {
    return new SurfaceFlowSampler(this.body, samplerSidesFor(this.geometry, this.placement), { radius: this.p.radius, normalWidth: this.p.normalWidth, normalBins: this.p.normalBins }, t);
  }

  advance(maxSteps: number): number {
    const p = this.p;
    let k = 0;
    while (k < maxSteps && !this.done) {
      if (!this.sim.step()) {
        this.finish('failed', 'the simulation stopped (the safety monitor halted it)');
        break;
      }
      k++;
      const t = this.sim.time;
      if (t < p.startup) continue;
      if (!this.started) {
        this.started = true;
        this.conservation.sample();
        this.sampler = this.newSampler(t);
        this.nextSample = t;
        this.nextUpdate = t + this.cfg.interval;
      }
      if (t >= this.nextSample) {
        this.sampler.sample(this.sim.store);
        this.nextSample += p.sampleInterval;
      }
      if (t >= this.nextUpdate) {
        this.update(t);
        this.nextUpdate += this.cfg.interval;
      }
      if (!this.done && t >= this.maxTime) this.finish('max-updates', `the update limit (${this.cfg.maxUpdates}) was reached`);
    }
    return k;
  }

  private finish(kind: LiveStop, reason: string) {
    if (!this.stop) this.stop = { kind, reason };
    this.done = true;
  }

  private analyses(): Record<Side, WakeAnalysis> {
    const xs = Array.from({ length: this.geometry.stations }, (_, k) => ((k + 0.5) * this.geometry.chord) / this.geometry.stations);
    const mk = (s: Side) => wakeFromTotals(this.acc[s].totals(xs, this.n0, this.p.normalWidth), s, WAKE_SPEC);
    return { upper: mk('upper'), lower: mk('lower') };
  }

  private update(t: number) {
    const cfg = this.cfg;
    const blk = this.sampler.closeBlock(t);
    for (const side of ['upper', 'lower'] as const) {
      const sd = blk.sides[side];
      if (sd) this.acc[side].fold(sd.sums, blk.snapshots, this.sampler.lengths(side), this.p.normalWidth, this.updates === 0 ? 0 : cfg.decay);
    }
    const wakes = this.analyses();
    if (!this.side) {
      const score = (w: WakeAnalysis) => (w.run ? (w.run.last - w.run.first + 1) * w.meanGap : 0);
      this.side = score(wakes.lower) > score(wakes.upper) ? 'lower' : 'upper';
    }
    const side = this.side;
    const wake = wakes[side];
    if (this.updates === 0) this.wakeStart = wake;
    this.wakeEnd = wake;
    const n = this.updates + 1;
    const step = (s: Partial<LiveStep>): LiveStep => ({ update: n, t, onset: null, front: this.front ?? 0, maxGap: 0, meanGap: 0, added: 0, area: 0, capped: 0, scale: 1, note: '', ...s });

    const plan = planIncrement(this.geometry, wake, cfg, this.front);
    if (!plan) {
      this.wetted++;
      this.record(step({ note: 'every station is touched by particles: nothing to fill' }));
      this.restartEpoch(t);
      if (this.treated === null) return this.finish('wetted', `the particles touch the whole ${side} surface: there is no void to fill`);
      if (this.wetted >= 2) return this.finish('converged', 'the void is closed: the particles touch the whole surface again');
      return;
    }
    this.wetted = 0;
    if (!this.treated) this.treated = { xLo: plan.onset, xHi: plan.front };
    this.treated.xHi = Math.max(this.treated.xHi, plan.front);

    // keep to space without particles: cap by every particle near the surface, then check the real polygon
    const g = this.geometry;
    const r = this.p.radius;
    const st = this.sim.store;
    const near: { x: number; y: number }[] = [];
    {
      const pts: number[] = [];
      for (let i = 0; i < st.count; i++) pts.push(st.x[i], st.y[i]);
      const b = unplace(pts, this.placement);
      const yy = sideY(g, side);
      const ymax = Math.max(...yy.map(Math.abs)) + 20;
      for (let i = 0; i < st.count; i++) {
        const bx = b[2 * i];
        const by = b[2 * i + 1];
        if (bx > -2 && bx < g.chord + 2 && Math.abs(by) < ymax) near.push({ x: bx, y: by });
      }
    }
    const cap = capByParticles(g, side, plan.delta, near, r, cfg.clearance);
    const delta = cap.delta;
    const fitted = fitToLimits(g, side, delta, cfg.limits);
    const fit = 'geometry' in fitted ? fitted : null;
    let candidate: SurfaceGeometry | null = null;
    let scale = 1;
    if (fit) {
      // the increment the limits allow (non-negative material on this side), then halved until the real polygon holds no overlap
      const sign = side === 'upper' ? 1 : -1;
      const yf = sideY(fit.geometry, side);
      const yo = sideY(g, side);
      const fd = yf.map((v, i) => Math.max(0, sign * (v - yo[i])));
      for (let attempt = 0; attempt < 5; attempt++) {
        const cand = applyDelta(g, side, fd, Math.pow(0.5, attempt));
        if (validateGeometry(cand, cfg.limits).length) continue;
        const tmp = new PolygonBody({ ...bodyConfigFor({ ...this.p, geometry: cand }) });
        let clear = true;
        for (let i = 0; i < st.count && clear; i++) {
          if (tmp.closest(st.x[i], st.y[i]).d < r - 1e-6) clear = false;
        }
        if (clear) {
          candidate = cand;
          scale = fit.scale * Math.pow(0.5, attempt);
          break;
        }
      }
    }
    if (!fit) {
      this.limited++;
      this.record(step({ onset: plan.onset, front: plan.front, maxGap: plan.maxGap, meanGap: plan.meanGap, capped: cap.capped, note: `the geometry limits leave no room for this increment (${'reason' in fitted ? fitted.reason : ''})` }));
      this.restartEpoch(t);
      if (this.limited >= 4) this.finish('limit', 'the geometry limits (thickness, slope, curvature) leave no room for another increment');
      return this.afterUpdate();
    }
    this.limited = 0;
    if (!candidate) {
      this.blocked++;
      this.record(step({ onset: plan.onset, front: plan.front, maxGap: plan.maxGap, meanGap: plan.meanGap, capped: cap.capped, note: 'particles are in the way: nothing added this update' }));
      this.restartEpoch(t);
      if (this.blocked >= 6) this.finish('blocked', 'particles kept the new surface from advancing for six updates in a row');
      return this.afterUpdate();
    }
    this.blocked = 0;
    // reshape the running body, then measure the new surface from here on
    const y0 = sideY(g, side);
    const y1 = sideY(candidate, side);
    let added = 0;
    let area = 0;
    const dx = g.chord / g.stations;
    for (let i = 0; i < y0.length; i++) {
      const d = Math.abs(y1[i] - y0[i]);
      added = Math.max(added, d);
      area += d * dx;
    }
    this.body.reshape(bodyConfigFor({ ...this.p, geometry: candidate }).vertices);
    this.geometry = candidate;
    this.front = Math.min(g.chord - cfg.teReserve, Math.max(plan.front, plan.onset) + cfg.frontSpeed);
    this.record(step({ onset: plan.onset, front: plan.front, maxGap: plan.maxGap, meanGap: plan.meanGap, added, area, capped: cap.capped, scale, note: cap.capped ? `${cap.capped} station(s) held back by particles` : 'material added' }));
    this.restartEpoch(t);
    // converged: the front has reached the trailing edge and the gap stays small
    const atTe = plan.front >= g.chord - cfg.teReserve - 1e-9;
    this.closed = atTe && plan.maxGap < cfg.convergeGap ? this.closed + 1 : 0;
    if (this.closed >= cfg.convergeUpdates) return this.finish('converged', `the fill reached the trailing edge and the gap stayed under ${cfg.convergeGap} d for ${cfg.convergeUpdates} updates`);
    this.afterUpdate();
  }

  private afterUpdate() {
    if (this.done) return;
    if (this.stalled > this.cfg.convergeUpdates) {
      this.finish('stalled', 'the front is at the trailing edge and almost nothing more could be added for several updates: the surface has reached what the geometry limits and the particles allow, while a void is still left');
      return;
    }
    if (this.updates >= this.cfg.maxUpdates) this.finish('max-updates', `the update limit (${this.cfg.maxUpdates}) was reached`);
  }

  private record(s: LiveStep) {
    this.trajectory.push(s);
    this.last = s;
    this.updates++;
    // the front has met the trailing edge and the surface hardly grows
    const atTe = s.onset !== null && s.front >= this.geometry.chord - this.cfg.teReserve - 1e-9;
    this.stalled = atTe && s.area < 0.25 ? this.stalled + 1 : 0;
  }

  /** a fresh strip sample on the (possibly new) surface */
  private restartEpoch(t: number) {
    this.sampler = this.newSampler(t);
  }

  progress() {
    return this.done ? 1 : Math.min(0.99, Math.max(this.sim.time / this.maxTime, this.updates / this.cfg.maxUpdates));
  }

  live() {
    const l = this.last;
    return {
      phase: this.started ? 'live fill' : 'start-up',
      time: this.sim.time,
      particles: this.sim.store.count,
      updates: `${this.updates}/${this.cfg.maxUpdates}`,
      separationX: l && l.onset !== null ? l.onset : Number.NaN,
      front: l ? l.front : Number.NaN,
      maxGap: l ? l.maxGap : Number.NaN,
      meanGap: l ? l.meanGap : Number.NaN,
      energyError: this.sim.relativeEnergyResidual(),
    };
  }

  result(): LiveBuildRunResult {
    this.sim.checkSafety();
    this.conservation.sample();
    return {
      seed: this.seed,
      side: this.side,
      startGeometry: this.startGeometry,
      finalGeometry: this.geometry,
      trajectory: this.trajectory,
      stop: this.stop ?? { kind: 'failed', reason: 'the run ended without a stop reason' },
      wakeStart: this.wakeStart,
      wakeEnd: this.wakeEnd,
      treated: this.treated,
      particles: this.sim.store.count,
      conservation: this.conservation.summary(),
      insideDetections: this.body.insideDetections,
      lateContacts: this.body.lateContacts,
      halted: this.sim.halted,
      safetyFlags: [...this.sim.flags],
      time: this.sim.time,
    };
  }
}

export interface LiveBuildResults {
  kind: 'flow-live-build';
  seed: number;
  side: Side | null;
  alphaDeg: number;
  placement: Placement;
  live: LiveFillConfig;
  wakeSpec: string;
  startGeometry: SurfaceGeometry;
  finalGeometry: SurfaceGeometry;
  trajectory: LiveStep[];
  stop: { kind: LiveStop; reason: string };
  wakeStart: WakeAnalysis | null;
  wakeEnd: WakeAnalysis | null;
  treated: { xLo: number; xHi: number } | null;
  /** total material added [d²] */
  areaAdded: number;
  note: string;
}

export class FlowLiveBuildExperiment extends SequentialExperiment<{ seed: number }, LiveBuildRunResult> {
  readonly type = 'flow-live-build' as const;
  readonly params: LiveBuildParams;

  constructor(p: LiveBuildParams) {
    if (p.seeds.length !== 1) throw new Error('live fill uses exactly one seed (the builder); measure the result with the flow-geometry experiment');
    if (!(p.live.interval > 0) || !(p.live.maxUpdates >= 1)) throw new Error('live fill needs a positive interval and at least one update');
    super([{ seed: p.seeds[0] }]);
    this.params = p;
  }

  protected createRun(spec: { seed: number }): Run<LiveBuildRunResult> {
    return new LiveBuildRun(this.params, spec.seed);
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const r = this.results[0];
    const checks = [];
    const warnings: string[] = [
      'STATUS reflects the numerical-integrity checks of this run only. The unwetted-surface definition and the fill rule are experimental conventions, not validated physics, and the shape is whatever the particle cloud left: it is not an optimised or validated airfoil.',
    ];
    if (r) {
      checks.push(check('numerical-safety', 'The run was not halted by the safety monitor', 'not halted', r.halted ? 'halted' : 'no', !r.halted));
      checks.push(check('no-penetration', 'No particle centre ever inside the body, while it was being reshaped', '0 detections', `${r.insideDetections}`, r.insideDetections === 0));
      checks.push(check('energy-accounting', 'Energy ledger incl. body and open-boundary fluxes closes', 'max |relative residual| < 1e-9', r.conservation.maxAbsRelativeEnergyResidual.toExponential(2), r.conservation.maxAbsRelativeEnergyResidual < 1e-9));
      checks.push(check('momentum-accounting', 'Momentum ledger incl. body impulse and open-boundary fluxes closes', 'max relative residual < 1e-9', r.conservation.maxRelativeMomentumResidual.toExponential(2), r.conservation.maxRelativeMomentumResidual < 1e-9));
      const issues = validateGeometry(r.finalGeometry, p.live.limits);
      checks.push(check('geometry-limits', 'The final surface respects the thickness, slope and curvature limits', 'no issue', issues.length ? issues[0].message : 'none', issues.length === 0));
      const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
      const te = r.finalGeometry.upper[r.finalGeometry.stations] === r.startGeometry.upper[r.startGeometry.stations] && r.finalGeometry.lower[r.finalGeometry.stations] === r.startGeometry.lower[r.startGeometry.stations];
      checks.push(check('trailing-edge-fixed', 'The trailing edge was not moved (nothing is imposed there)', 'unchanged', te ? 'unchanged' : 'moved', te));
      const other = r.side === 'upper' ? same(r.finalGeometry.lower, r.startGeometry.lower) : r.side === 'lower' ? same(r.finalGeometry.upper, r.startGeometry.upper) : true;
      checks.push(check('other-side-untouched', 'The side that was not filled is unchanged', 'unchanged', other ? 'unchanged' : 'changed', other));
      if (r.lateContacts > 0) warnings.push(`${r.lateContacts} body contacts were already overlapping at the start of their step (placed at the step start).`);
      for (const f of r.safetyFlags) warnings.push(`seed ${r.seed}: [${f.severity}] ${f.code} ${f.message}`);
    } else warnings.push('The run did not complete.');
    const n0 = p.areaFraction / (Math.PI * p.radius * p.radius);
    const g = p.geometry;
    const results: LiveBuildResults = {
      kind: 'flow-live-build',
      seed: p.seeds[0],
      side: r?.side ?? null,
      alphaDeg: p.alphaDeg,
      placement: placementFor(p),
      live: p.live,
      wakeSpec: WAKE_SPEC.id,
      startGeometry: r?.startGeometry ?? g,
      finalGeometry: r?.finalGeometry ?? g,
      trajectory: r?.trajectory ?? [],
      stop: r?.stop ?? { kind: 'failed', reason: 'the run did not complete' },
      wakeStart: r?.wakeStart ?? null,
      wakeEnd: r?.wakeEnd ?? null,
      treated: r?.treated ?? null,
      areaAdded: (r?.trajectory ?? []).reduce((a, s) => a + s.area, 0),
      note: WAKE_LABEL,
    };
    return {
      ...recordHeader('flow-live-build', 'Flow-guided geometry: live fill of the unwetted surface (one builder seed)', p.seeds),
      particleCount: r?.particles ?? 0,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: n0, massDensity: n0 * p.mass, areaFraction: p.areaFraction },
      temperature: { kT: p.kT, definition: 'reservoir and wall temperature kT' },
      speed: p.speed,
      geometry: `polygon body reshaped during the run (chord ${g.chord} d, ${g.stations} stations per side) at α = ${p.alphaDeg}° in an open-boundary stream, domain ${p.length} × ${p.height} d`,
      wallModel: `diffuse Maxwell faces, Aw = ${p.accommodation}, wall kT = ${p.wallKT}`,
      accommodation: p.accommodation,
      restitution: 1,
      occupancyModel: 'none',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: p.length, ymin: 0, ymax: p.height, periodicX: false, periodicY: false },
      duration: { time: r?.time ?? 0, steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: { simulation: null, effective: null, physical: null, note: 'not measured in this experiment' },
      mach: { Mp: null, benchmark: null, note: 'not measured in this experiment' },
      results: results as unknown as Record<string, unknown>,
      uncertainty: { method: 'the gap and the contact density come from strip counts of a short, decaying window: Poisson-level noise, one seed; treat each update as a point estimate', seeds: 1 },
      convergence: { status: 'NOT ASSESSED', note: 'the shape depends on the builder seed; run it with another seed to see how much' },
      benchmarks: {},
      assumptions: [
        'A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-18', 'A-19',
        'The body is a polygon of straight edges, reshaped in place during the run without moving or removing particles: material is only ever added where no particle centre lies within its radius of the new surface.',
        `The unwetted-surface measure ${WAKE_SPEC.id} is an occupancy definition (do the particles touch the surface?), not validated against any independent separation criterion.`,
      ],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: r?.safetyFlags ?? [],
      config: p,
    };
  }
}
