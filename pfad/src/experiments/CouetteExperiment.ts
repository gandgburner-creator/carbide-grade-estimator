import { aggregateEmptySpace } from '../measurements/EmptySpaceMonitor';
import { dilutePlusEnskogViscosity2D } from '../benchmarks/KineticTheory';
import type { ContactResolution } from '../core/CollisionModel';
import type { TimestepPolicy } from '../core/Integrator';
import { ensembleEstimate, mean, pooled, weightedLinearFit, type Estimate } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { ChannelGasRun, type ChannelGasRunResult } from './ChannelGasRun';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * COUETTE VISCOSITY (Master prompt §16, Bible §15).
 *
 * Gas between a resting bottom wall and a top wall moving at U (+x), periodic
 * in x. Both walls are diffuse (accommodation Aw) at fixed temperature kT_w, so
 * the heat produced by shearing leaves through the walls. The gas starts at
 * rest; no velocity profile is imposed. No viscosity enters the solver.
 *
 * Measured, per run, in the steady state:
 *   τ      wall shear stress from wall tangential impulses: (τ_bottom − τ_top)/2
 *   γ      velocity gradient: weighted straight-line fit of u_x(y) over the core
 *          (the middle `coreFraction` of the channel, away from Knudsen layers),
 *          with the χ² of that fit reported (is the core profile linear?)
 *   μ_eff  = τ / γ
 * plus wall slip (core fit extrapolated to each wall vs the wall speed),
 * kT(y), n(y), the measured mean free path λ = ⟨|c|⟩/ω and Kn = λ/H.
 */
export interface CouetteCase {
  label: string;
  count: number;
  areaFraction: number;
  height: number;
  radius: number;
  mass: number;
  wallKT: number;
  wallSpeed: number;
  accommodation: number;
  equilibrationCollisions: number;
  measurementCollisions: number;
  seeds?: number[];
}

export interface CouetteParams {
  cases: CouetteCase[];
  seeds: number[];
  profileBins: number;
  coreFraction: number;
  windowCollisions: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  maxTime: number;
  /** measured disturbance speed for Mp = U/c_p (from a sound-speed record), per areaFraction */
  soundSpeed: { areaFraction: number; value: number; se: number; source: string }[];
}

const BASE: Omit<CouetteCase, 'label'> = {
  count: 1000,
  areaFraction: 0.1,
  height: 40,
  radius: 0.5,
  mass: 1,
  wallKT: 1,
  wallSpeed: 0.5,
  accommodation: 1,
  equilibrationCollisions: 200,
  measurementCollisions: 300,
};

export const COUETTE_REFERENCE: CouetteParams = {
  // 30 seeds and a doubled measurement window (was 5 seeds × 300 collisions/particle, 23 % half-width)
  cases: [{ ...BASE, label: 'base: φ=0.1, H=40, U=0.5, Aw=1', measurementCollisions: 600 }],
  seeds: Array.from({ length: 30 }, (_, k) => 71 + k),
  profileBins: 20,
  coreFraction: 0.6,
  windowCollisions: 0.5,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  maxTime: 1e7,
  soundSpeed: [],
};

export const COUETTE_SWEEPS: CouetteParams = {
  ...COUETTE_REFERENCE,
  seeds: Array.from({ length: 12 }, (_, k) => 131 + k), // disjoint from the reference seeds 71–100
  cases: [
    { ...BASE, label: 'U=0.25', wallSpeed: 0.25 },
    { ...BASE, label: 'U=0.5 (base)' },
    { ...BASE, label: 'U=1.0', wallSpeed: 1 },
    { ...BASE, label: 'Aw=0.5', accommodation: 0.5 },
    { ...BASE, label: 'Aw=0.25', accommodation: 0.25 },
    { ...BASE, label: 'φ=0.05', areaFraction: 0.05, count: 500 },
    { ...BASE, label: 'φ=0.2', areaFraction: 0.2, count: 2000 },
    // H²/(π²ν) ≈ 260 time units at H = 80: 1500 collisions/particle ≈ 11 relaxation times (500 was ≈ 3.7)
    { ...BASE, label: 'H=80 (count ×2)', height: 80, count: 2000, equilibrationCollisions: 1500 },
    { ...BASE, label: 'H=20 (count ÷2)', height: 20, count: 500, equilibrationCollisions: 100 },
    { ...BASE, label: 'kT_w=4, U=1 (U/√kT fixed)', wallKT: 4, wallSpeed: 1 },
    { ...BASE, label: 'particle radius 0.35 (same φ, H)', radius: 0.35, count: 2041 },
  ],
};

interface Spec {
  caseIndex: number;
  seed: number;
}
type R = ChannelGasRunResult & { caseIndex: number; meanPeculiarSpeed: number; collisionRate: number };

export interface CouetteRunAnalysis {
  seed: number;
  shearStress: { mean: number; se: number };
  gradient: { mean: number; se: number };
  linearityP: number;
  muEff: { mean: number; se: number };
  slipBottom: number;
  slipTop: number;
  coreKT: number;
  meanFreePath: number;
  knudsen: number;
  shearImbalance: { mean: number; se: number; z: number };
  energyImbalance: { mean: number; se: number; z: number };
}

export function analyseCouetteRun(r: R, coreFraction: number): CouetteRunAnalysis | null {
  if (!r.profile || !r.stress) return null;
  const H = r.params.height;
  const U = r.params.top.tangentialVelocity ?? 0;
  const lo = (H * (1 - coreFraction)) / 2;
  const hi = H - lo;
  const idx = r.profile.centers.map((y, i) => (y >= lo && y <= hi ? i : -1)).filter((i) => i >= 0);
  const y = idx.map((i) => r.profile!.centers[i]);
  const u = idx.map((i) => r.profile!.ux[i].mean);
  const se = idx.map((i) => Math.max(r.profile!.ux[i].se, 1e-12));
  const fit = weightedLinearFit(y, u, se);
  const tb = r.stress.bottomShear;
  const tt = r.stress.topShear;
  const tau = { mean: 0.5 * (tb.mean - tt.mean), se: 0.5 * Math.hypot(tb.se, tt.se) };
  const mu = tau.mean / fit.slope;
  const muSe = Math.abs(mu) * Math.hypot(tau.se / tau.mean, fit.seSlope / fit.slope);
  const coreKT = mean(idx.map((i) => r.profile!.kT[i].mean));
  const lambda = r.meanPeculiarSpeed / r.collisionRate;
  const si = r.stress.shearImbalance;
  const ei = r.stress.energyImbalance;
  return {
    seed: r.seed,
    shearStress: tau,
    gradient: { mean: fit.slope, se: fit.seSlope },
    linearityP: fit.pValue,
    muEff: { mean: mu, se: muSe },
    slipBottom: fit.intercept - 0,
    slipTop: U - (fit.intercept + fit.slope * H),
    coreKT,
    meanFreePath: lambda,
    knudsen: lambda / H,
    shearImbalance: { mean: si.mean, se: si.se, z: si.mean / si.se },
    energyImbalance: { mean: ei.mean, se: ei.se, z: ei.mean / ei.se },
  };
}

export class CouetteExperiment extends SequentialExperiment<Spec, R> {
  readonly type: 'viscosity' | 'viscosity-sweeps';
  readonly params: CouetteParams;

  constructor(p: CouetteParams, type: 'viscosity' | 'viscosity-sweeps' = 'viscosity') {
    const specs: Spec[] = [];
    p.cases.forEach((c, i) => {
      for (const seed of c.seeds ?? p.seeds) specs.push({ caseIndex: i, seed });
    });
    super(specs);
    this.params = p;
    this.type = type;
  }

  protected createRun(spec: Spec): Run<R> {
    const p = this.params;
    const c = p.cases[spec.caseIndex];
    const run = new ChannelGasRun({
      count: c.count,
      areaFraction: c.areaFraction,
      radius: c.radius,
      mass: c.mass,
      kT: c.wallKT,
      distribution: 'maxwell',
      restitution: 1,
      contact: p.contact,
      timestep: p.timestep,
      seed: spec.seed,
      height: c.height,
      bottom: { accommodation: c.accommodation, temperature: c.wallKT, tangentialVelocity: 0 },
      top: { accommodation: c.accommodation, temperature: c.wallKT, tangentialVelocity: c.wallSpeed },
      equilibrationCollisions: c.equilibrationCollisions,
      measurementCollisions: c.measurementCollisions,
      windowCollisions: p.windowCollisions,
      profileBins: p.profileBins,
      maxTime: p.maxTime,
      label: `couette ${c.label} seed=${spec.seed}`,
    });
    let c0 = 0;
    let t0 = 0;
    let started = false;
    return {
      label: run.label,
      sim: run.sim,
      get done() {
        return run.done;
      },
      advance: (n) => {
        const k = run.advance(n);
        const live = run.live();
        if (!started && live.phase === 'measure') {
          started = true;
          c0 = (2 * run.sim.log.count) / run.sim.store.count;
          t0 = run.sim.time;
        }
        return k;
      },
      progress: () => run.progress(),
      live: () => run.live(),
      result: () => {
        const res = run.result();
        const s = run.sim.store;
        // mean peculiar speed relative to the measured profile (for λ = ⟨|c|⟩/ω)
        let sum = 0;
        const prof = res.profile;
        for (let i = 0; i < s.count; i++) {
          let ux = 0;
          if (prof) {
            const b = Math.min(prof.centers.length - 1, Math.max(0, Math.floor(s.y[i] / prof.binWidth)));
            ux = prof.ux[b].mean;
          }
          sum += Math.hypot(s.vx[i] - ux, s.vy[i]);
        }
        const cNow = (2 * run.sim.log.count) / s.count;
        return {
          ...res,
          caseIndex: spec.caseIndex,
          meanPeculiarSpeed: sum / s.count,
          collisionRate: (cNow - c0) / Math.max(1e-12, run.sim.time - t0),
        };
      },
    };
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const halted = runs.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const empty = aggregateEmptySpace(runs.map((r) => r.emptySpace));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no POTENTIAL MODEL / NUMERICAL FAILURE flag',
      empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : `none (φ ${empty.phiMin.toPrecision(3)} … ${empty.phiMax.toPrecision(3)}, mean ${empty.phiMean.toPrecision(3)})`, empty.flaggedRuns === 0));
    const maxE = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...runs.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger (incl. wall work and heat) closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Gas momentum change equals wall impulse', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));

    const cases = p.cases.map((c, i) => {
      const rs = runs.filter((r) => r.caseIndex === i && !r.halted);
      const per = rs.map((r) => analyseCouetteRun(r, p.coreFraction)).filter((a): a is CouetteRunAnalysis => a !== null);
      if (per.length === 0) return null;
      const muEns: Estimate = ensembleEstimate(per.map((a) => a.muEff.mean));
      const muPooled = pooled(per.map((a) => a.muEff));
      const n = (c.areaFraction / (Math.PI * c.radius * c.radius));
      const rho = n * c.mass;
      const cs = p.soundSpeed.find((s) => Math.abs(s.areaFraction - c.areaFraction) < 1e-9);
      const gamma = mean(per.map((a) => a.gradient.mean));
      const knudsen = mean(per.map((a) => a.knudsen));
      const shearBal = pooled(per.map((a) => a.shearImbalance));
      const energyBal = pooled(per.map((a) => a.energyImbalance));
      const prof = rs[0]?.profile;
      return {
        label: c.label,
        case: c,
        seeds: per.length,
        muEff: muEns,
        muEffPooled: muPooled,
        shearStress: ensembleEstimate(per.map((a) => a.shearStress.mean)),
        gradient: ensembleEstimate(per.map((a) => a.gradient.mean)),
        minLinearityP: Math.min(...per.map((a) => a.linearityP)),
        slipBottom: ensembleEstimate(per.map((a) => a.slipBottom)),
        slipTop: ensembleEstimate(per.map((a) => a.slipTop)),
        coreKT: mean(per.map((a) => a.coreKT)),
        meanFreePath: mean(per.map((a) => a.meanFreePath)),
        knudsen,
        shearBalance: shearBal,
        energyBalance: energyBal,
        reynolds: {
          simulation: (rho * c.wallSpeed * c.height) / muEns.mean,
          effective: (rho * gamma * c.height * c.height) / muEns.mean,
          note: 'Re_sim = ρ U H / μ_eff (wall speed); Re_eff = ρ (γ H) H / μ_eff (velocity difference actually carried by the core, i.e. net of wall slip)',
        },
        mach: cs
          ? { Mp: c.wallSpeed / cs.value, MpSe: (c.wallSpeed * cs.se) / (cs.value * cs.value), soundSpeedSource: cs.source }
          : { Mp: null, note: `no measured c_p supplied for φ = ${c.areaFraction}; run the sound-speed experiment for this configuration` },
        profile: prof
          ? {
              y: prof.centers,
              ux: prof.ux.map((e) => e.mean),
              uxSe: prof.ux.map((e) => e.se),
              kT: prof.kT.map((e) => e.mean),
              n: prof.numberDensity.map((e) => e.mean),
              seed: rs[0].seed,
            }
          : null,
        perSeed: per,
      };
    });
    const ok = cases.filter((c) => c !== null) as NonNullable<(typeof cases)[number]>[];
    const zs = ok.map((c) => Math.abs(c.shearBalance.z));
    checks.push(check('steady-state-momentum', 'Steady shear: equal and opposite wall stresses',
      '|τ_bottom + τ_top| < 3 SE (per-run block averages, pooled) in every case', `max |z| = ${Math.max(...zs).toFixed(2)}`, Math.max(...zs) < 3, 'NOT CONVERGED'));
    const ze = ok.map((c) => Math.abs(c.energyBalance.z));
    checks.push(check('steady-state-energy', 'Steady shear: wall work leaves as heat (no net heating)',
      'net energy flux gas→walls = 0 within 3 SE in every case', `max |z| = ${Math.max(...ze).toFixed(2)}`, Math.max(...ze) < 3, 'NOT CONVERGED'));
    const nonlin = ok.filter((c) => !(c.minLinearityP > 0.001));
    checks.push(check('core-profile-linear', 'The core velocity profile is a straight line (a single gradient exists)',
      'χ² p > 0.001 for the core fit in every run', nonlin.length ? nonlin.map((c) => `${c.label} (min p ${c.minLinearityP.toExponential(1)})`).join('; ') : 'all linear',
      nonlin.length === 0, 'INCONCLUSIVE'));
    const imprecise = ok.filter((c) => !(c.muEff.relHalfWidth < 0.1));
    checks.push(check('viscosity-precision', 'μ_eff measured with ≤ 10 % uncertainty',
      '95 % CI half-width (seed ensemble) < 10 % in every case', imprecise.length ? imprecise.map((c) => `${c.label}: ${(100 * c.muEff.relHalfWidth).toFixed(1)} %`).join('; ') : 'all < 10 %',
      imprecise.length === 0, 'INCONCLUSIVE'));
    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`${r.label}: [${f.severity}] ${f.code} ${f.message}`);
    for (const c of ok) if (c.knudsen > 0.1) warnings.push(`${c.label}: Kn = λ/H = ${c.knudsen.toFixed(3)} (measured λ); slip and Knudsen layers are significant, μ_eff is a channel property, not a bulk one.`);

    const bench = ok.map((c) => {
      const b = dilutePlusEnskogViscosity2D(2 * c.case.radius, c.case.mass, c.coreKT, c.case.areaFraction);
      return { label: c.label, kT: c.coreKT, eta0: b.eta0, enskogFactor: b.enskogFactor, enskogEta: b.eta, measuredOverEnskog: c.muEff.mean / b.eta };
    });
    const base = ok[0];
    const c0 = p.cases[0];
    return {
      ...recordHeader(this.type, this.type === 'viscosity' ? 'Couette flow: emergent effective viscosity' : 'Couette flow sweeps: U, Aw, φ, H, T, particle scale', p.seeds),
      particleCount: c0.count,
      particleScale: { radius: c0.radius, diameter: 2 * c0.radius, mass: c0.mass },
      density: { numberDensity: c0.areaFraction / (Math.PI * c0.radius ** 2), massDensity: (c0.mass * c0.areaFraction) / (Math.PI * c0.radius ** 2), areaFraction: c0.areaFraction },
      temperature: { kT: c0.wallKT, definition: 'wall temperature kT_w; gas kT measured per bin (A-03)' },
      speed: c0.wallSpeed,
      geometry: `channel periodic in x, walls at y = 0 (rest) and y = ${c0.height} (moving at U)`,
      wallModel: 'planar walls, Maxwell accommodation, fixed wall temperature',
      accommodation: c0.accommodation,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: runs[0]?.geometry.width ?? 0, ymin: 0, ymax: c0.height, periodicX: true, periodicY: false },
      duration: {
        time: runs.reduce((a, r) => a + r.totals.time, 0),
        steps: runs.reduce((a, r) => a + r.totals.steps, 0),
        collisionsPerParticle: runs.reduce((a, r) => a + r.totals.collisionsPerParticle, 0),
      },
      reynolds: base
        ? { simulation: base.reynolds.simulation, effective: base.reynolds.effective, physical: null, note: base.reynolds.note + '. Re_physical: no physical fluid properties supplied.' }
        : { simulation: null, effective: null, physical: null, note: 'no data' },
      mach: base && base.mach.Mp !== null
        ? { Mp: base.mach.Mp, benchmark: null, note: `Mp = U/c_p with c_p measured (${(base.mach as { soundSpeedSource: string }).soundSpeedSource})` }
        : { Mp: null, benchmark: null, note: 'No measured c_p supplied for this configuration.' },
      results: { cases: ok, coreFraction: p.coreFraction, emptySpace: empty },
      uncertainty: { note: 'μ_eff: ensemble over independent seeds (t-based CI); per-run μ_eff SE from block-averaged wall stress and batch-means profile fit, pooled as a cross-check.' },
      convergence: { status: 'NOT ASSESSED', note: 'Channel height, particle scale and U dependence are cases of the sweep experiment.' },
      benchmarks: { note: 'Chapman–Enskog + Enskog (Gass 1971) hard-disk viscosity, comparison only; the channel value includes slip/Knudsen effects.', perCase: bench },
      assumptions: ['A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-08', 'A-09', 'A-10'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
