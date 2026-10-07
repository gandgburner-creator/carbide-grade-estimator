import { mean, std, tTwoSidedCritical } from '../measurements/Statistics';
import { UB0_PHI } from './CoarseGrainMap';
import {
  couetteEstimate,
  shearEstimate,
  soundEstimate,
  staticEstimate,
  wallEstimate,
  type StaticEstimate,
} from './UB0Estimators';
import { tauD, type PlannedRun } from './UB0Plans';
import type { UB0Result } from './UB0Run';

/**
 * Stage 0 aggregation (docs/CRITERIA_UB0_STAGE0.md). Universe A only.
 *
 * The ONLY mapping input is K_T,A/(n kT) (`mapping.KTred`). Everything else is a
 * comparison reference: it may define a prediction or band, never a Universe B
 * model parameter (amendment A1 §6).
 */
export interface Stat {
  value: number;
  se: number;
  df: number;
  n: number;
}

export function ens(xs: number[]): Stat {
  const v = xs.filter(Number.isFinite);
  const n = v.length;
  return { value: mean(v), se: n > 1 ? std(v) / Math.sqrt(n) : Number.NaN, df: n - 1, n };
}

/** Welch–Satterthwaite degrees of freedom for a combination Σ c_i X_i. */
export function welchDf(terms: { c: number; s: Stat }[]): number {
  const num = terms.reduce((a, t) => a + (t.c * t.s.se) ** 2, 0) ** 2;
  const den = terms.reduce((a, t) => a + (t.c * t.s.se) ** 4 / t.s.df, 0);
  return num / den;
}

export function ci95(s: Stat): [number, number] {
  const t = tTwoSidedCritical(0.05, s.df);
  return [s.value - t * s.se, s.value + t * s.se];
}

/** Quality gates for one Universe A run (protocol §5). Returns the reasons it fails, if any. */
export function qualityGates(r: UB0Result): string[] {
  const why: string[] = [];
  if (r.info.halted === 1) why.push('halted');
  const m = r.phaseLedgers.measure as
    | { relativeEnergyResidual: number; relativeMomentumResidual: number; lateContactsUnexplained: number; flags: { severity: string }[] }
    | undefined;
  if (!m) {
    why.push('no measure phase');
    return why;
  }
  if (r.lostEvents > 0) why.push(`lost collision events ${r.lostEvents}`);
  if (!(Math.abs(m.relativeEnergyResidual) <= 1e-9)) why.push(`energy ledger residual ${m.relativeEnergyResidual}`);
  if (!(m.relativeMomentumResidual <= 1e-9)) why.push(`momentum ledger residual ${m.relativeMomentumResidual}`);
  if (m.lateContactsUnexplained > 0) why.push(`unexplained late contacts ${m.lateContactsUnexplained}`);
  if (m.flags.some((f) => f.severity === 'failure')) why.push('safety failure flag');
  return why;
}

export interface Stage0Summary {
  runs: number;
  excluded: { id: string; reasons: string[] }[];
  mapping: { KTred: Stat };
  references: Record<string, Stat | Record<string, Stat>>;
  precision: Record<string, { relSE: number; target: number; met: boolean }>;
  /** for scripts/ub0-predictions.ts --inputs */
  predictionInputs: Record<string, unknown>;
}

export function aggregateStage0(results: { plan: PlannedRun; result: UB0Result }[]): Stage0Summary {
  const excluded: { id: string; reasons: string[] }[] = [];
  const ok = results.filter(({ plan, result }) => {
    const why = qualityGates(result);
    if (why.length) excluded.push({ id: plan.id, reasons: why });
    return why.length === 0;
  });
  const by = (g: string) => ok.filter((x) => x.plan.group === g);
  const st = (g: string) => by(g).map((x) => staticEstimate(x.result));
  const n = UB0_PHI / (Math.PI / 4);
  // K_T,A by central difference over φ = 0.18, 0.22 (protocol §4.1)
  const p18 = ens(st('SK18').map((e) => e.Pnorm));
  const p22 = ens(st('SK22').map((e) => e.Pnorm));
  const p20: StaticEstimate[] = st('SK20');
  const P20 = ens(p20.map((e) => e.Pnorm));
  const c = UB0_PHI / 0.04;
  const K: Stat = {
    value: c * (p22.value - p18.value),
    se: c * Math.hypot(p22.se, p18.se),
    df: welchDf([
      { c, s: p22 },
      { c: -c, s: p18 },
    ]),
    n: p18.n + p22.n,
  };
  const KTred: Stat = { ...K, value: K.value / n, se: K.se / n };
  const Z: Stat = { ...P20, value: P20.value / n, se: P20.se / n };
  // long static boxes: structure factor, collision rate, mean free path, equipartition
  const sl = st('SL');
  const S = [0, 1, 2].map((i) => ens(sl.map((e) => e.S[i])));
  const rate = ens(sl.map((e) => e.collisionRate_p));
  const lambda = ens(sl.map((e) => e.lambda_p));
  // shear waves
  const nuOf = (g: string, L: number) => ens(by(g).map((x) => shearEstimate(x.result, tauD(L)).nu_p));
  const nu80 = nuOf('T80a1', 80);
  const nu80h = nuOf('T80a05', 80);
  const nu160 = nuOf('T160a1', 160);
  const nu320 = nuOf('T320a1', 320);
  const nuRaw80 = ens(by('T80a1').map((x) => shearEstimate(x.result, tauD(80)).nuRaw_p));
  // standing sound wave
  const snd = by('L160').map((x) => soundEstimate(x.result, x.plan.periodHint!));
  const cA = ens(snd.map((e) => e.c));
  const cAdens = ens(snd.map((e) => e.cDensity));
  const Gamma: Stat = {
    value: (cA.value * cA.value) / KTred.value,
    se: ((cA.value * cA.value) / KTred.value) * Math.hypot((2 * cA.se) / cA.value, KTred.se / KTred.value),
    df: welchDf([
      { c: 2 / cA.value, s: cA },
      { c: -1 / KTred.value, s: KTred },
    ]),
    n: cA.n + KTred.n,
  };
  // wall box (instrument validation at N_c = 1) and Couette (secondary)
  const wl = by('W40').map((x) => wallEstimate(x.result));
  const cou = (g: string) => by(g).map((x) => couetteEstimate(x.result));
  const references: Record<string, Stat | Record<string, Stat>> = {
    Z_A: Z,
    P_A_phi020: P20,
    P_A_phi018: p18,
    P_A_phi022: p22,
    S_A_shell1: S[0],
    S_A_shell2: S[1],
    S_A_shell3: S[2],
    collisionRate: rate,
    lambda,
    Tkin_long: ens(sl.map((e) => e.T)),
    a2_long: ens(sl.map((e) => e.a2)),
    psi6_long: ens(sl.map((e) => e.psi6 ?? Number.NaN)),
    Dself_long: ens(sl.map((e) => e.Dself_p ?? Number.NaN)),
    nu_L80_U1: nu80,
    nu_L80_U05: nu80h,
    nu_L160_U1: nu160,
    nu_L320_U1: nu320,
    nuRaw_L80_U1: nuRaw80,
    occShare_L80_U1: ens(by('T80a1').map((x) => shearEstimate(x.result, tauD(80)).occShare)),
    nuStress_L80_U1: ens(by('T80a1').map((x) => shearEstimate(x.result, tauD(80)).nuStress_p)),
    c_A: cA,
    c_A_densityMode: cAdens,
    Gamma_A: Gamma,
    Delta_A: { ...Gamma, value: Gamma.value - 1 },
    soundDamping: ens(snd.map((e) => e.gamma_p)),
    wall_gw1: ens(wl.map((e) => e.gw1)),
    wall_gw2: ens(wl.map((e) => e.gw2)),
    wall_gw3: ens(wl.map((e) => e.gw3)),
    wall_contactOverCore: ens(wl.map((e) => e.contactDensity / e.coreDensity)),
    couette_mu_H40: ens(cou('C40').map((e) => e.mu)),
    couette_mu_H80: ens(cou('C80').map((e) => e.mu)),
    couette_slipBottom_H40: ens(cou('C40').map((e) => e.slip[0])),
  };
  const rel = (s: Stat) => Math.abs(s.se / s.value);
  const precision = {
    KTred: { relSE: rel(KTred), target: 0.015, met: rel(KTred) <= 0.015 },
    nu_L80_U1: { relSE: rel(nu80), target: 0.01, met: rel(nu80) <= 0.01 },
    c_A: { relSE: rel(cA), target: 0.01, met: rel(cA) <= 0.01 },
    S_A_shell1: { relSE: rel(S[0]), target: 0.05, met: rel(S[0]) <= 0.05 },
  };
  const src = 'Stage 0 Universe A measurement (results/ub0/stage0)';
  const predictionInputs = {
    label: 'Stage 0 Universe A measurements',
    phi: UB0_PHI,
    Z: { value: Z.value, se: Z.se, df: Z.df, source: `${src}: static boxes φ = 0.20` },
    KTred: { value: KTred.value, se: KTred.se, df: KTred.df, source: `${src}: central difference φ = 0.18/0.22 — THE MAPPING INPUT` },
    cA: { value: cA.value, se: cA.se, df: cA.df, source: `${src}: standing wave L = 160 d` },
    lambda: { value: lambda.value, se: lambda.se, df: lambda.df, source: `${src}: long static boxes` },
    nu: { value: nu80.value, se: nu80.se, df: nu80.df, source: `${src}: shear wave L = 80 d, U₀ = c_th` },
    collisionRate: { value: rate.value, se: rate.se, df: rate.df, source: `${src}: long static boxes` },
  };
  return { runs: results.length, excluded, mapping: { KTred }, references, precision, predictionInputs };
}
