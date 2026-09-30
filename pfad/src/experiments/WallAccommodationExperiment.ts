import type { ContactResolution } from '../core/CollisionModel';
import type { TimestepPolicy } from '../core/Integrator';
import { consistency, ensembleEstimate, pooled, tScaledDeviation, type Estimate } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck } from '../validation/Status';
import { ChannelGasRun, type ChannelGasRunResult } from './ChannelGasRun';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';

/**
 * WALL ACCOMMODATION (Master prompt §15, Bible §14).
 *
 * Aw is a microscopic wall-interaction parameter. This experiment measures what
 * it does — it does not call it viscosity or friction.
 *
 * Part A (thermal): steady two-temperature channel — bottom wall at kT_hot, top
 *   wall at kT_cold, both with accommodation Aw. After equilibration, measures
 *   the heat flux through each wall, the heat balance, the temperature profile
 *   and the realised energy accommodation coefficient of each wall.
 * Part B (shear): bottom wall at rest, top wall moving at U, both at kT_w, both
 *   with accommodation Aw. Measures tangential and normal momentum transfer to
 *   each wall, heat removed, the realised tangential accommodation, and the gas
 *   velocity next to each wall (slip).
 *
 * Measured accommodation coefficients (definitions, per wall, over all hits):
 *   α_E = (E_in − E_out) / (E_in − N_hits·E_w),  E_w = (3/2)kT_w + ½ m U_w²
 *   α_t = (P_t,in − P_t,out) / (P_t,in − N_hits·m·U_w)
 * E_w and m·U_w are the mean energy and tangential momentum of the wall's own
 * re-emission distribution (a property of the wall model, A-08).
 * Both coefficients are ratios whose denominator vanishes when the incident gas
 * is already in equilibrium with the wall; an estimate whose seed-to-seed SE
 * exceeds 0.2 is reported as ill-conditioned (INCONCLUSIVE), not as agreement.
 *
 * Energy exchanged with a wall moving at U splits into mechanical work and heat:
 *   E_into_gas = Q_wall-frame + U · ΔP_x,gas.
 */
export interface WallAccommodationParams {
  count: number;
  areaFraction: number;
  radius: number;
  mass: number;
  kT: number;
  height: number;
  accommodations: number[];
  seeds: number[];
  hotWallKT: number;
  coldWallKT: number;
  thermalEquilibrationCollisions: number;
  thermalCollisions: number;
  shearWallSpeed: number;
  shearWallKT: number;
  shearEquilibrationCollisions: number;
  shearCollisions: number;
  windowCollisions: number;
  profileBins: number;
  contact: ContactResolution;
  timestep: TimestepPolicy;
  maxTime: number;
}

export const WALL_ACCOMMODATION_REFERENCE: WallAccommodationParams = {
  count: 1000,
  areaFraction: 0.05,
  radius: 0.5,
  mass: 1,
  kT: 1,
  height: 40,
  accommodations: [0, 0.25, 0.5, 0.75, 1],
  seeds: [31, 32, 33],
  hotWallKT: 1.5,
  coldWallKT: 0.5,
  thermalEquilibrationCollisions: 120,
  thermalCollisions: 100,
  shearWallSpeed: 1,
  shearWallKT: 1,
  shearEquilibrationCollisions: 120,
  shearCollisions: 100,
  windowCollisions: 0.25,
  profileBins: 12,
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
  maxTime: 1e7,
};

type Part = 'thermal' | 'shear';
interface Spec {
  part: Part;
  Aw: number;
  seed: number;
}
type AccRunResult = ChannelGasRunResult & { part: Part; Aw: number };

function alphaE(t: ChannelGasRunResult['walls']['bottom'], kTw: number, m: number, Uw: number) {
  const Ew = 1.5 * kTw + 0.5 * m * Uw * Uw;
  const den = t.incidentEnergy - t.hits * Ew;
  return den !== 0 ? (t.incidentEnergy - t.emittedEnergy) / den : Number.NaN;
}

function alphaT(t: ChannelGasRunResult['walls']['bottom'], m: number, Uw: number) {
  const den = t.incidentTangential - t.hits * m * Uw;
  return den !== 0 ? (t.incidentTangential - t.emittedTangential) / den : Number.NaN;
}

export class WallAccommodationExperiment extends SequentialExperiment<Spec, AccRunResult> {
  readonly type = 'wall-accommodation' as const;
  readonly params: WallAccommodationParams;

  constructor(p: WallAccommodationParams) {
    const specs: Spec[] = [];
    for (const part of ['thermal', 'shear'] as Part[]) {
      for (const Aw of p.accommodations) for (const seed of p.seeds) specs.push({ part, Aw, seed });
    }
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<AccRunResult> {
    const p = this.params;
    const thermal = spec.part === 'thermal';
    const run = new ChannelGasRun({
      count: p.count,
      areaFraction: p.areaFraction,
      radius: p.radius,
      mass: p.mass,
      kT: p.kT,
      distribution: 'maxwell',
      restitution: 1,
      contact: p.contact,
      timestep: p.timestep,
      seed: spec.seed,
      height: p.height,
      bottom: { accommodation: spec.Aw, temperature: thermal ? p.hotWallKT : p.shearWallKT, tangentialVelocity: 0 },
      top: {
        accommodation: spec.Aw,
        temperature: thermal ? p.coldWallKT : p.shearWallKT,
        tangentialVelocity: thermal ? 0 : p.shearWallSpeed,
      },
      equilibrationCollisions: thermal ? p.thermalEquilibrationCollisions : p.shearEquilibrationCollisions,
      measurementCollisions: thermal ? p.thermalCollisions : p.shearCollisions,
      windowCollisions: p.windowCollisions,
      profileBins: p.profileBins,
      maxTime: p.maxTime,
      label: `wall ${spec.part} Aw=${spec.Aw} seed=${spec.seed}`,
    });
    return {
      label: run.label,
      sim: run.sim,
      get done() {
        return run.done;
      },
      advance: (n) => run.advance(n),
      progress: () => run.progress(),
      live: () => run.live(),
      result: () => ({ ...run.result(), part: spec.part, Aw: spec.Aw }),
    };
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const runs = this.results;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const byAw = (part: Part) => {
      const m = new Map<number, AccRunResult[]>();
      for (const r of runs.filter((x) => x.part === part)) {
        if (!m.has(r.Aw)) m.set(r.Aw, []);
        m.get(r.Aw)!.push(r);
      }
      return [...m.entries()].sort((a, b) => a[0] - b[0]);
    };
    const est = (xs: number[]): Estimate => ensembleEstimate(xs.filter(Number.isFinite));

    const halted = runs.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures',
      halted.length ? halted.map((r) => r.label).join('; ') : 'none', halted.length === 0));
    const maxE = Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    const maxP = Math.max(...runs.map((r) => r.conservation.maxRelativeMomentumResidual));
    checks.push(check('energy-accounting', 'Energy ledger (incl. wall heat) closes', 'max |relative residual| < 1e-9', maxE.toExponential(2), maxE < 1e-9));
    checks.push(check('momentum-accounting', 'Gas momentum change equals wall impulse', 'max relative residual < 1e-9', maxP.toExponential(2), maxP < 1e-9));

    // ---- Part A: thermal (steady two-temperature channel)
    const ill = (e: Estimate) => !(e.se <= 0.2);
    const thermal = byAw('thermal').map(([Aw, rs]) => {
      const ok = rs.filter((r) => r.profile);
      const T = (r: AccRunResult) => r.measurementTime;
      return {
        Aw,
        seeds: rs.length,
        realisedDiffuseFraction: est(rs.map((r) => (r.walls.bottom.diffuseHits + r.walls.top.diffuseHits) / (r.walls.bottom.hits + r.walls.top.hits))),
        alphaE_hotWall: est(rs.map((r) => alphaE(r.walls.bottom, p.hotWallKT, p.mass, 0))),
        alphaE_coldWall: est(rs.map((r) => alphaE(r.walls.top, p.coldWallKT, p.mass, 0))),
        heatIntoGasAtHotWallPerTimePerLength: est(rs.map((r) => -r.walls.bottom.energyIn / T(r) / r.geometry.width)),
        heatOutOfGasAtColdWallPerTimePerLength: est(rs.map((r) => r.walls.top.energyIn / T(r) / r.geometry.width)),
        // net energy flux into the gas per window, block-averaged per run, pooled over runs
        heatImbalance: pooled(ok.filter((r) => r.stress).map((r) => r.stress!.energyImbalance)),
        gasKTNextToHotWall: est(ok.map((r) => r.profile!.kT[0].mean)),
        gasKTNextToColdWall: est(ok.map((r) => r.profile!.kT[r.profile!.kT.length - 1].mean)),
        profile: ok[0]?.profile
          ? { y: ok[0].profile.centers, kT: ok[0].profile.kT.map((e) => e.mean), kTSe: ok[0].profile.kT.map((e) => e.se), n: ok[0].profile.numberDensity.map((e) => e.mean), seed: ok[0].seed }
          : null,
      };
    });
    const t0 = byAw('thermal').find(([a]) => a === 0);
    if (t0) {
      const maxHeat = Math.max(...t0[1].map((r) => Math.abs(r.walls.bottom.energyIn) + Math.abs(r.walls.top.energyIn)));
      checks.push(check('specular-exchanges-no-energy', 'Aw = 0 walls exchange no energy with the gas',
        '|energy exchanged| < 1e-9 (absolute, model units)', maxHeat.toExponential(2), maxHeat < 1e-9));
    }
    const heated = thermal.filter((t) => t.Aw > 0);
    if (heated.length) {
      const zq = heated.map((t) => Math.abs(t.heatImbalance.z));
      checks.push(check('heat-balance', 'In the steady state the heat entering at the hot wall leaves at the cold wall',
        '|q_hot − q_cold| < 3 SE (per-run block averages of the window series, pooled) for every Aw > 0',
        `max |z| = ${Math.max(...zq).toFixed(2)}`, Math.max(...zq) < 3, 'NOT CONVERGED'));
      const good = heated.flatMap((t) => [
        { Aw: t.Aw, e: t.alphaE_hotWall },
        { Aw: t.Aw, e: t.alphaE_coldWall },
      ]);
      const conditioned = good.filter((g) => !ill(g.e));
      const worst = conditioned.length ? Math.max(...conditioned.map((g) => tScaledDeviation(g.e, g.Aw))) : Number.NaN;
      checks.push(check('energy-accommodation-matches-Aw',
        'Measured energy accommodation α_E equals the wall parameter Aw (tests the re-emission kernel)',
        '|α_E − Aw| < 2·t₀.₉₇₅(seeds−1)·SE for every well-conditioned estimate (SE ≤ 0.2); none may be ill-conditioned',
        `${conditioned.length}/${good.length} well-conditioned, max deviation ${Number.isFinite(worst) ? worst.toFixed(2) : 'n/a'} of threshold`,
        conditioned.length === good.length && worst < 1,
        conditioned.length === good.length ? 'FAILED' : 'INCONCLUSIVE'));
    }

    // ---- Part B: shear
    const shear = byAw('shear').map(([Aw, rs]) => {
      const ok = rs.filter((r) => r.stress && r.profile);
      const slipBottom = ok.map((r) => r.profile!.ux[0].mean - 0);
      const slipTop = ok.map((r) => p.shearWallSpeed - r.profile!.ux[r.profile!.ux.length - 1].mean);
      return {
        Aw,
        seeds: rs.length,
        bottomShear: est(ok.map((r) => r.stress!.bottomShear.mean)),
        topShear: est(ok.map((r) => r.stress!.topShear.mean)),
        shearImbalance: pooled(ok.map((r) => r.stress!.shearImbalance)),
        energyImbalance: pooled(ok.map((r) => r.stress!.energyImbalance)),
        bottomPressure: est(ok.map((r) => r.stress!.bottomPressure.mean)),
        topPressure: est(ok.map((r) => r.stress!.topPressure.mean)),
        // mechanical power delivered by the moving top wall (U · momentum given to the gas)
        wallWorkOnGasPerTime: est(ok.map((r) => (-p.shearWallSpeed * r.walls.top.tangentialImpulse) / r.measurementTime)),
        // heat removed by both walls, each in its own rest frame:
        // Q_removed = energyIn − U·(tangential impulse on the wall)   (E_into_gas = Q + U·ΔP_x,gas)
        heatRemovedPerTime: est(ok.map((r) => (r.walls.bottom.energyIn + r.walls.top.energyIn - p.shearWallSpeed * r.walls.top.tangentialImpulse) / r.measurementTime)),
        alphaT_bottom: est(ok.map((r) => alphaT(r.walls.bottom, p.mass, 0))),
        alphaT_top: est(ok.map((r) => alphaT(r.walls.top, p.mass, p.shearWallSpeed))),
        gasVelocityNextToBottom: est(ok.map((r) => r.profile!.ux[0].mean)),
        gasVelocityNextToTop: est(ok.map((r) => r.profile!.ux[r.profile!.ux.length - 1].mean)),
        slipBottom: est(slipBottom),
        slipTop: est(slipTop),
        gasKT: est(ok.map((r) => r.stress!.kT)),
        profile: ok[0]?.profile
          ? { y: ok[0].profile.centers, ux: ok[0].profile.ux.map((e) => e.mean), uxSe: ok[0].profile.ux.map((e) => e.se), kT: ok[0].profile.kT.map((e) => e.mean), seed: ok[0].seed }
          : null,
      };
    });
    const s0 = byAw('shear').find(([a]) => a === 0);
    if (s0) {
      const maxT = Math.max(...s0[1].map((r) => Math.abs(r.walls.bottom.tangentialImpulse) + Math.abs(r.walls.top.tangentialImpulse)));
      checks.push(check('specular-transfers-no-shear', 'A moving Aw = 0 wall transmits no tangential momentum',
        '|tangential impulse| = 0', maxT.toExponential(2), maxT === 0));
    }
    const sheared = shear.filter((s) => s.Aw > 0);
    if (sheared.length) {
      const zs = sheared.map((s) => Math.abs(s.shearImbalance.z));
      checks.push(check('shear-momentum-balance', 'In steady shear the two walls feel equal and opposite tangential stress',
        '|τ_bottom + τ_top| < 3 SE (per-run block averages, pooled) for every Aw > 0', `max |z| = ${Math.max(...zs).toFixed(2)}`, Math.max(...zs) < 3, 'NOT CONVERGED'));
      const all = sheared.flatMap((s) => [
        { Aw: s.Aw, e: s.alphaT_bottom },
        { Aw: s.Aw, e: s.alphaT_top },
      ]);
      const cond = all.filter((g) => !ill(g.e));
      const w = cond.length ? Math.max(...cond.map((g) => tScaledDeviation(g.e, g.Aw))) : Number.NaN;
      checks.push(check('tangential-accommodation-matches-Aw', 'Measured tangential accommodation α_t equals Aw',
        '|α_t − Aw| < 2·t₀.₉₇₅(seeds−1)·SE for every well-conditioned estimate (SE ≤ 0.2); none may be ill-conditioned',
        `${cond.length}/${all.length} well-conditioned, max deviation ${Number.isFinite(w) ? w.toFixed(2) : 'n/a'} of threshold`,
        cond.length === all.length && w < 1,
        cond.length === all.length ? 'FAILED' : 'INCONCLUSIVE'));
      const zw = sheared.map((s) => Math.abs(s.energyImbalance.z));
      checks.push(check('shear-energy-balance', 'In steady shear the work done by the moving wall leaves as heat through the walls',
        'net energy flux gas→walls = 0 within 3 SE (per-run block averages, pooled) for every Aw > 0', `max |z| = ${Math.max(...zw).toFixed(2)}`, Math.max(...zw) < 3, 'NOT CONVERGED'));
      const cons = consistency(sheared.map((s) => s.bottomShear.mean), sheared.map((s) => s.bottomShear.se));
      warnings.push(`Shear stress depends on Aw (χ² p across Aw = ${cons.pValue.toPrecision(3)}); see results.shear. This is the macroscopic effect of Aw; it is not labelled viscosity.`);
    }

    for (const r of runs) for (const f of r.safetyFlags) warnings.push(`${r.label}: [${f.severity}] ${f.code} ${f.message}`);
    const g = runs[0]?.geometry;
    const duration = runs.reduce((a, r) => ({ time: a.time + r.totals.time, steps: a.steps + r.totals.steps, collisionsPerParticle: a.collisionsPerParticle + r.totals.collisionsPerParticle }), { time: 0, steps: 0, collisionsPerParticle: 0 });
    const shearRe = shear.find((s) => s.Aw === 1);
    return {
      ...recordHeader('wall-accommodation', 'Wall accommodation: momentum and energy transfer', p.seeds),
      particleCount: p.count,
      particleScale: { radius: p.radius, diameter: 2 * p.radius, mass: p.mass },
      density: { numberDensity: g?.numberDensity ?? Number.NaN, massDensity: (g?.numberDensity ?? Number.NaN) * p.mass, areaFraction: g?.areaFraction ?? Number.NaN },
      temperature: { kT: p.kT, definition: 'kT = peculiar KE/N (A-03)' },
      speed: p.shearWallSpeed,
      geometry: `channel, periodic in x (width ${g?.width.toPrecision(5)}), walls at y = 0 and y = ${p.height}`,
      wallModel: 'planar walls, Maxwell accommodation (A-08)',
      accommodation: Object.fromEntries(p.accommodations.map((a) => [`Aw=${a}`, a])),
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: g?.width ?? 0, ymin: 0, ymax: p.height, periodicX: true, periodicY: false },
      duration,
      reynolds: {
        simulation: null,
        effective: null,
        physical: null,
        note: 'Re needs a measured viscosity; it is defined in the Couette experiment, not here.',
      },
      mach: {
        Mp: null,
        benchmark: null,
        note: `Wall speed U = ${p.shearWallSpeed} (model units); Mp = U/c_p needs the measured disturbance speed (pressure-pulse experiment).`,
      },
      results: { thermal, shear },
      uncertainty: { note: 'Ensemble over seeds (independent) for every tabulated value; stresses per run are block-averaged.' },
      convergence: { status: 'NOT ASSESSED', note: 'Single resolution.' },
      benchmarks: {
        note: 'None used: the accommodation coefficients are compared with the wall parameter Aw itself, not with a classical law.',
        fullyDiffuseTopWallShear: shearRe ? shearRe.topShear.mean : null,
      },
      assumptions: ['A-01', 'A-02', 'A-03', 'A-05', 'A-06', 'A-08', 'A-09', 'A-10'],
      acceptance: checks,
      status: combineStatus(checks),
      warnings,
      safetyFlags: runs.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}
