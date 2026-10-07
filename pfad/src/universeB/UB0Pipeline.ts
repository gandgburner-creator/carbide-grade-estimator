import { sRPA, wallConfig, wallVerdict, type BulkOutcomes, type NcKey, type RunGate, type WallVerdict } from './UB0Analysis';
import {
  couetteEstimate,
  shearEstimate,
  soundEstimate,
  staticEstimate,
  wallEstimate,
  type CouetteEstimate,
  type ShearEstimate,
  type SoundEstimate,
  type WallEstimate,
} from './UB0Estimators';
import { finalize, getOutcome, judge, oscillatoryEnsemble, setOutcome, type JudgedInputs, type StaticRun } from './UB0Judged';
import { tauD, type FrozenInputs, type PlannedRun } from './UB0Plans';
import type { UB0Result } from './UB0Run';
import {
  checkRun,
  extensionCandidates,
  halves,
  nonStationary,
  primariesOfStaticGroup,
  PRIMARY_GROUPS,
  selectGroup,
  stationarityThresholds,
  type GroupSelection,
  type RunCheck,
} from './UB0Selection';
import type { Stat } from './UB0Stage0';

/**
 * The judged UB-0 analysis pipeline (design §6–§7, §11; amendment A1), from run
 * records to verdicts. Pure: the caller supplies the plan and a loader. Fixed
 * before any judged Universe B run; exercised on tiny design-seed runs only
 * (tests/universeB.pipeline.test.ts).
 */

/** results/ub0/frozen_inputs.json (scripts/ub0-freeze.ts) */
export interface FrozenJudged extends FrozenInputs {
  judgedGamma: Record<NcKey, [number, number]>;
  What160: Record<NcKey, number>;
  WhatShells: Record<4 | 16, [number, number]>;
  rpaStrength: Record<4 | 16, number>;
  rho: number;
  A: { nuL80: Stat; nuL160: Stat; KT: Stat; SA: Stat[] };
}

const BULK_PREFIX = /^(SK|SL|T|L)\d/;
const WALL_GROUPS = ['W4c2', 'W16c2', 'W4c4'];

export type PipelineResult =
  | { status: 'need-runs'; toRun: string[]; selections: Record<string, GroupSelection> }
  | {
      status: 'done';
      selections: Record<string, GroupSelection>;
      first: ReturnType<typeof judge>;
      /** extension candidates of the first look (§11.7) */
      candidates: string[];
      /** after the single extension (only when `extended` was given) */
      second?: ReturnType<typeof judge>;
      final: { outcomes: BulkOutcomes; labels: string[]; bulk: string; overall: string };
      stationarity: { group: string; quantity: string; diff: number; ci: [number, number]; threshold: number; flag: boolean; primaries: string[] }[];
      wall: { verdict: WallVerdict; configs: Record<string, ReturnType<typeof wallConfig> & { over10pct: boolean }>; estimates: Record<string, WallEstimate[]> };
      couette: Record<string, CouetteEstimate[]>;
      diagnostics: Record<string, { maxOmegaDt: number; runs: number }>;
    };

export function runPipeline(
  plan: PlannedRun[],
  load: (id: string) => UB0Result | null,
  frozen: FrozenJudged,
  extended: string[] | null = null,
): PipelineResult {
  const results = new Map<string, UB0Result>();
  const checks = new Map<string, RunCheck>();
  for (const p of plan) {
    const r = load(p.id);
    if (!r) continue;
    const { group, planned, periodHint, ...core } = p;
    void group;
    void planned;
    void periodHint;
    if (JSON.stringify(r.spec) !== JSON.stringify(core)) throw new Error(`${p.id}: stored spec differs from the plan`);
    results.set(p.id, r);
    checks.set(p.id, checkRun(r));
  }
  const byGroup = new Map<string, PlannedRun[]>();
  for (const p of plan) byGroup.set(p.group, [...(byGroup.get(p.group) ?? []), p]);
  const planOf = new Map(plan.map((p) => [p.id, p]));

  const extGroups = new Set((extended ?? []).flatMap((k) => PRIMARY_GROUPS[k] ?? []));
  // the first look must be complete before the extension is even considered
  const sel1: Record<string, GroupSelection> = {};
  const toRun1: string[] = [];
  for (const [g, runs] of byGroup) {
    sel1[g] = selectGroup(runs, checks);
    toRun1.push(...sel1[g].toRun);
  }
  if (toRun1.length) return { status: 'need-runs', toRun: toRun1, selections: sel1 };

  // per-run estimates, memoised
  const memo = new Map<string, unknown>();
  const est = <T>(id: string, f: (r: UB0Result, p: PlannedRun) => T): T => {
    if (!memo.has(id)) memo.set(id, f(results.get(id)!, planOf.get(id)!));
    return memo.get(id) as T;
  };
  const stat = (id: string) => est(id, (r) => staticEstimate(r));
  const shear = (id: string) => est(id, (r, p) => shearEstimate(r, tauD(p.L!)));
  const sound = (id: string) => est(id, (r, p) => soundEstimate(r, p.periodHint!));
  const wall = (id: string) => est(id, (r) => wallEstimate(r));
  const couette = (id: string) => est(id, (r) => couetteEstimate(r));

  const th = stationarityThresholds(frozen.A.KT.value, [0, 0]);
  const sThresh = (n: 4 | 16): [number, number] => {
    const s = [0, 1].map((i) => sRPA(frozen.A.SA[i].value, frozen.rpaStrength[n], frozen.WhatShells[n][i]));
    return [s[0] / 30, s[1] / 30];
  };

  function build(sel: Record<string, GroupSelection>, level: Record<string, number>) {
    const ids = (g: string) => sel[g]?.used ?? [];
    const statics: Record<string, StaticRun[]> = {};
    const shears: Record<string, ShearEstimate[]> = {};
    const sounds: Record<string, SoundEstimate[]> = {};
    const walls: Record<string, WallEstimate[]> = {};
    const inconclusive = new Set<string>();
    const st: { group: string; quantity: string; diff: number; ci: [number, number]; threshold: number; flag: boolean; primaries: string[] }[] = [];
    const flagStationarity = (group: string, quantity: 'Pnorm' | 'TkinOverTint' | 'S', pairs: [number, number][], threshold: number) => {
      const prim = primariesOfStaticGroup(group, quantity);
      if (!prim.length || pairs.length < 2) return;
      const ns = nonStationary(pairs, threshold, 0.95);
      st.push({ group, quantity, diff: ns.diff.estimate, ci: ns.diff.ci, threshold, flag: ns.flag, primaries: prim });
      if (ns.flag) for (const k of prim) inconclusive.add(k);
    };
    for (const g of Object.keys(sel)) {
      const runIds = ids(g);
      if (/^S[KL]/.test(g)) {
        const Nc = results.get(runIds[0])?.spec.Nc as NcKey | undefined;
        const W160 = Nc ? frozen.What160[Nc] : 0;
        statics[g] = runIds.map((id) => {
          const e = stat(id);
          return { est: e, qSound: (e.Pkin + e.Pcoll) / e.T + W160 * e.Pocc };
        });
        flagStationarity(g, 'Pnorm', statics[g].map((r) => r.est.PnormHalves), th.Pnorm);
        const tt = runIds.map((id) => {
          const s = results.get(id)!.samples;
          const a = halves(s.map((x) => x.Tkin));
          const b = halves(s.map((x) => x.Tint));
          return [a[0] / b[0], a[1] / b[1]] as [number, number];
        });
        flagStationarity(g, 'TkinOverTint', tt, th.TkinOverTint);
        if (g === 'SL4' || g === 'SL16') {
          const n = g === 'SL4' ? 4 : 16;
          const t = sThresh(n);
          for (const i of [0, 1]) {
            const pairs = runIds.map((id) => halves(results.get(id)!.samples.map((x) => x[`S${i + 1}`])));
            const prim = primariesOfStaticGroup(g, 'S');
            const ns = nonStationary(pairs, t[i], 0.95);
            st.push({ group: g, quantity: `S${i + 1}`, diff: ns.diff.estimate, ci: ns.diff.ci, threshold: t[i], flag: ns.flag, primaries: prim });
            if (ns.flag) for (const k of prim) inconclusive.add(k);
          }
        }
      } else if (/^T/.test(g)) shears[g] = runIds.map(shear);
      else if (/^L/.test(g)) sounds[g] = runIds.map(sound);
      else if (/^W/.test(g)) walls[g] = runIds.map(wall);
    }
    const gates: RunGate[] = Object.values(sel).flatMap((s) => s.used.map((id) => checks.get(id)!.gate));
    const oscillatory: Record<string, boolean> = {};
    for (const g of ['T4a1', 'T16a1', 'T64a1']) {
      const L = planOf.get(ids(g)[0])?.L;
      if (!L) continue;
      oscillatory[g] = oscillatoryEnsemble(
        ids(g).map((id) => ({ t: results.get(id)!.samples.map((s) => s.t), U: results.get(id)!.samples.map((s) => s.Us) })),
        [0.1 * tauD(L), 1.5 * tauD(L)],
      );
    }
    const inputs: JudgedInputs = {
      level,
      A: frozen.A,
      P: { judgedGamma: frozen.judgedGamma, rpaStrength: frozen.rpaStrength, WhatShells: frozen.WhatShells, rho: frozen.rho },
      static: statics,
      shear: shears,
      sound: sounds,
      wall: walls,
      gates,
      oscillatory,
      exclusionsOver10pct: Object.values(sel).some((s) => BULK_PREFIX.test(s.group) && s.over10pct),
      inconclusive: [...inconclusive],
    };
    return { inputs, stationarity: st, walls };
  }

  const b1 = build(sel1, {});
  const first = judge(b1.inputs);
  const outcomes1 = Object.fromEntries(Object.keys(PRIMARY_GROUPS).map((k) => [k, getOutcome(first.outcomes, k)]));
  const inside1 = Object.fromEntries(Object.entries(first.primaries).map(([k, v]) => [k, v.inside]));
  const candidates = extensionCandidates(outcomes1, inside1);

  let second: ReturnType<typeof judge> | undefined;
  let finalOutcomes: BulkOutcomes = first.outcomes;
  let stationarity = b1.stationarity;
  const sel2: Record<string, GroupSelection> = { ...sel1 };
  if (extended && extended.length) {
    const stray = extended.filter((k) => !candidates.includes(k));
    if (stray.length) throw new Error(`extension requested for ${stray.join(', ')}, which the first look does not make eligible`);
    const toRun2: string[] = [];
    for (const g of extGroups) {
      sel2[g] = selectGroup(byGroup.get(g)!, checks, true);
      toRun2.push(...sel2[g].toRun);
    }
    if (toRun2.length) return { status: 'need-runs', toRun: toRun2, selections: sel2 };
    const b2 = build(sel2, Object.fromEntries(extended.map((k) => [k, 0.975])));
    second = judge(b2.inputs);
    finalOutcomes = JSON.parse(JSON.stringify(first.outcomes)) as BulkOutcomes;
    for (const k of extended) setOutcome(finalOutcomes, k, getOutcome(second.outcomes, k), second.primaries[k]?.estimate);
    finalOutcomes.pq7Violations = second.outcomes.pq7Violations;
    finalOutcomes.exclusionsOver10pct = first.outcomes.exclusionsOver10pct || second.outcomes.exclusionsOver10pct;
    stationarity = [...b1.stationarity, ...b2.stationarity.filter((s) => extGroups.has(s.group)).map((s) => ({ ...s, group: `${s.group} (extended)` }))];
  }
  const fin = finalize(finalOutcomes);

  const configs: Record<string, ReturnType<typeof wallConfig> & { over10pct: boolean }> = {};
  for (const g of WALL_GROUPS) {
    const es = b1.walls[g] ?? [];
    configs[g] = { ...wallConfig(es.map((e) => ({ gw1: e.gw1, gw2: e.gw2, gw3: e.gw3, R: e.R }))), over10pct: sel1[g]?.over10pct ?? false };
  }
  let wv = wallVerdict(configs.W4c2, configs.W16c2);
  if (configs.W4c2.over10pct || configs.W16c2.over10pct) wv = 'VOID';
  const cou: Record<string, CouetteEstimate[]> = {};
  for (const g of ['C4', 'C16']) cou[g] = (sel1[g]?.used ?? []).map(couette);
  const diagnostics: Record<string, { maxOmegaDt: number; runs: number }> = {};
  for (const [g, s] of Object.entries(extended ? sel2 : sel1)) {
    const om = s.used.map((id) => checks.get(id)!.maxOmegaDt).filter(Number.isFinite);
    diagnostics[g] = { maxOmegaDt: om.length ? Math.max(...om) : Number.NaN, runs: s.used.length };
  }
  return {
    status: 'done',
    selections: extended ? sel2 : sel1,
    first,
    candidates,
    second,
    final: { outcomes: finalOutcomes, ...fin },
    stationarity,
    wall: { verdict: wv, configs, estimates: b1.walls },
    couette: cou,
    diagnostics,
  };
}

/** F7 (design §7): a forecast only, never a verdict. */
export function f7Forecast(
  labels: string[],
  bulk: string,
  pq6a: Record<4 | 16, { outcome: string; estimate: number }>,
  gainAtNstar: number | null,
): { triggered: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (labels.includes('F4')) reasons.push('(a) F4: c_h = 4 required, and h/δ ≥ 0.5 at the target (h = 4√60 D ≈ 31 D)');
  if (gainAtNstar !== null && gainAtNstar < 10) reasons.push(`(b) B0 effective gain G(N*) = ${gainAtNstar.toFixed(1)} < 10`);
  if (bulk === 'PASS-NARROW') reasons.push('(c) N* < 50 (PASS-NARROW)');
  for (const n of [4, 16] as const) {
    const p = pq6a[n];
    if (p.outcome === 'FAIL' || (p.outcome === 'INCONCLUSIVE' && p.estimate > 1)) reasons.push(`(d) Newtonian window at N_c = ${n}: PQ6a ${p.outcome}, ν(σ_v)/ν(σ_v/2) = ${p.estimate.toFixed(3)}`);
  }
  return { triggered: reasons.length > 0, reasons };
}

