import { henderson, UB0_PHI } from './CoarseGrainMap';
import type { UB0Spec } from './UB0Run';
import { comparabilityOf, courantOf, DT_ARM } from './UB0Timestep';

/**
 * Run plans for UB-0, generated deterministically.
 *
 * Fixed design quantities (amendment A1 §4.2), never data-dependent:
 *   ν_D = μ/ρ with Item 1's φ = 0.2 value μ = 0.351  → τ_D = 1/(ν_D k²)
 *   c_lo(A) = 2.094, the lower 95 % limit of Item 2's c₀ (standing-wave period L/c_lo)
 */
export const NU_D = 0.351 / (UB0_PHI / (Math.PI / 4));
export const C_LO_A = 2.094;
export const COURANT_BASE = 0.025;

/** design time scale τ_D = L²/(4π² ν_D) in D/σ_v for a box of side L (in D) */
export function tauD(L: number): number {
  return (L * L) / (4 * Math.PI * Math.PI * NU_D);
}

export interface PlannedRun extends UB0Spec {
  /** configuration group (seeds of one group are compared as an ensemble) */
  group: string;
  /** planned (true) or reserve (false) seed */
  planned: boolean;
  /** sound: the period L/c_lo used to fix the run length and the fit window (D/σ_v) */
  periodHint?: number;
}

export interface GroupDef {
  group: string;
  n: number;
  base: Omit<UB0Spec, 'id' | 'seed'>;
  periodHint?: number;
}

/** Contiguous seed blocks of 2 × planned per group (planned first, then reserve), from `start`. */
export function allocate(defs: GroupDef[], start: number, prefix: string, withReserve: boolean): PlannedRun[] {
  const out: PlannedRun[] = [];
  let seed = start;
  for (const d of defs) {
    for (let i = 0; i < 2 * d.n; i++, seed++) {
      const planned = i < d.n;
      if (!planned && !withReserve) continue;
      out.push({ ...d.base, id: `${prefix}-${d.group}-${seed}`, seed, group: d.group, planned, periodHint: d.periodHint });
    }
  }
  return out;
}

/**
 * Stage 0: Universe A (N_c = 1) inputs and references (docs/CRITERIA_UB0_STAGE0.md).
 * Seeds 10001–10424 (A1 §6 named 8001–8199, which holds fewer seeds than the
 * planned runs plus reserves; this is a numbering change made before any run).
 */
export function stage0Groups(courant = COURANT_BASE): GroupDef[] {
  const A = { Nc: 1, ch: 0, e: 1, KTred: henderson.KTred(UB0_PHI), courant, observables: true };
  const stat = (phi: number, measure: number, extras: boolean) => ({
    ...A,
    kind: 'static' as const,
    phi,
    L: 80,
    prep: 100,
    settle: 20,
    measure,
    sample: 1,
    extras,
  });
  const shear = (L: number, amplitude: number) => ({
    ...A,
    kind: 'shear' as const,
    phi: UB0_PHI,
    L,
    amplitude,
    prep: 100,
    settle: 20,
    measure: 1.5 * tauD(L),
    sample: 0.5,
  });
  const P = 160 / C_LO_A;
  return [
    { group: 'SK18', n: 8, base: stat(0.18, 500, false) },
    { group: 'SK20', n: 8, base: stat(0.2, 500, false) },
    { group: 'SK22', n: 8, base: stat(0.22, 500, false) },
    { group: 'SL', n: 8, base: stat(0.2, 4200, true) },
    { group: 'T80a1', n: 48, base: shear(80, 1) },
    { group: 'T80a05', n: 96, base: shear(80, 0.5) },
    { group: 'T160a1', n: 12, base: shear(160, 1) },
    { group: 'T320a1', n: 4, base: shear(320, 1) },
    {
      group: 'L160',
      n: 8,
      periodHint: P,
      base: { ...A, kind: 'sound' as const, phi: UB0_PHI, L: 160, amplitude: 0.02 * 2.17, prep: 100, settle: 20, measure: 14 * P, sample: 0.5 },
    },
    {
      group: 'W40',
      n: 4,
      base: { ...A, kind: 'wall' as const, phi: UB0_PHI, width: 40, height: 40, prep: 640, settle: 0, measure: 2000, sample: 1 },
    },
    {
      group: 'C40',
      n: 4,
      base: { ...A, kind: 'couette' as const, phi: UB0_PHI, width: 40, height: 40, wallSpeed: 1, prep: (3 * 40 * 40) / NU_D, settle: 0, measure: 3000, sample: 1 },
    },
    {
      group: 'C80',
      n: 4,
      base: { ...A, kind: 'couette' as const, phi: UB0_PHI, width: 40, height: 80, wallSpeed: 1, prep: (3 * 80 * 80) / NU_D, settle: 0, measure: 3000, sample: 1 },
    },
  ];
}

export const STAGE0_SEED_START = 10001;

export function stage0Plan(opts: { reserve?: boolean; courant?: number } = {}): PlannedRun[] {
  return allocate(stage0Groups(opts.courant), STAGE0_SEED_START, 's0', opts.reserve ?? false);
}

/** Rough relative cost (particle-steps) for longest-first scheduling. */
export function specCost(s: UB0Spec): number {
  const D = Math.sqrt(s.Nc);
  const area = s.kind === 'wall' || s.kind === 'couette' ? s.width! * s.height! : s.L! * s.L!;
  const parcels = (s.phi / (Math.PI / 4)) * area * (D * D) / s.Nc;
  const steps = (s.prep + s.settle + s.measure) / (0.2 * s.courant);
  const occ = s.Nc > 1 ? 1 + 0.4 * s.ch * s.ch * s.Nc : 1;
  return parcels * steps * occ;
}

// ───────────────────────── Stage 0b (Universe A only; docs/CRITERIA_UB0_STAGE0B.md) ─────────────────────────

/**
 * Stage 0b supplements Stage 0 (amendment A2 §5; its own protocol). Universe A only.
 * Phase 1 (fixed now): more reference seeds at Courant 0.025 with specs IDENTICAL to
 * Stage 0's groups (so they pool), the sound-amplitude study (0.02 and 0.04 of c), and
 * the timestep checks at 0.0125 and 0.00625. Phase 2 (after the amplitude decision):
 * the standing wave at the selected amplitude at 0.0125 and 0.00625. Seed blocks are
 * allocated over both phases at once, so no seed depends on the decision.
 */
export const STAGE0B_SEED_START = 11001;
export type SoundAmplitude = 0.02 | 0.04;
export const SOUND_AMPLITUDES: readonly SoundAmplitude[] = [0.02, 0.04];

export function stage0bGroups(amplitude: SoundAmplitude = 0.02): (GroupDef & { phase: 1 | 2 })[] {
  const at = (c: number) => Object.fromEntries(stage0Groups(c).map((g) => [g.group, g]));
  const s025 = at(0.025);
  const s0125 = at(0.0125);
  const s00625 = at(0.00625);
  const sound = (g: GroupDef, a: number): GroupDef['base'] => ({ ...g.base, amplitude: a * 2.17 });
  return [
    // phase 1 at the Stage 0 Courant number: more seeds for the references, pooled with Stage 0
    { phase: 1, group: 'T80a1', n: 106, base: s025.T80a1.base },
    { phase: 1, group: 'T160a1', n: 88, base: s025.T160a1.base },
    { phase: 1, group: 'SL', n: 24, base: s025.SL.base },
    { phase: 1, group: 'W40', n: 28, base: s025.W40.base },
    { phase: 1, group: 'L160', n: 17, base: s025.L160.base, periodHint: s025.L160.periodHint },
    // the amplitude study (protocol §4): 0.04 of c against 0.02 of c, both at 0.025
    { phase: 1, group: 'L160a04', n: 32, base: sound(s025.L160, 0.04), periodHint: s025.L160.periodHint },
    // the timestep checks and the matched references (protocol §5)
    { phase: 1, group: 'T80a1c0125', n: 200, base: s0125.T80a1.base },
    { phase: 1, group: 'T80a1c00625', n: 100, base: s00625.T80a1.base },
    { phase: 1, group: 'SK18c0125', n: 8, base: s0125.SK18.base },
    { phase: 1, group: 'SK22c0125', n: 8, base: s0125.SK22.base },
    { phase: 1, group: 'SK18c00625', n: 8, base: s00625.SK18.base },
    { phase: 1, group: 'SK22c00625', n: 8, base: s00625.SK22.base },
    { phase: 1, group: 'SLc00625', n: 16, base: s00625.SL.base },
    // phase 2: the standing wave at the amplitude selected by protocol §4
    { phase: 2, group: 'L160c0125', n: 16, base: sound(s0125.L160, amplitude), periodHint: s0125.L160.periodHint },
    { phase: 2, group: 'L160c00625', n: 32, base: sound(s00625.L160, amplitude), periodHint: s00625.L160.periodHint },
  ];
}

export function stage0bPlan(opts: { phase: 1 | 2; amplitude?: SoundAmplitude; reserve?: boolean }): PlannedRun[] {
  if (opts.phase === 2 && opts.amplitude === undefined) throw new Error('Stage 0b phase 2 needs the amplitude decision (protocol §4)');
  const defs = stage0bGroups(opts.amplitude ?? 0.02);
  const all = allocate(defs, STAGE0B_SEED_START, 's0b', opts.reserve ?? false);
  const phase = new Map(defs.map((d) => [d.group, d.phase]));
  return all.filter((r) => phase.get(r.group) === opts.phase);
}

/**
 * The Stage 0b contingency (protocol §8): matched Universe A references at a Courant
 * number a pilot halving moved a comparability group to. Seeds from 12401 over the full
 * list, so no seed depends on which groups are needed; reserves of existing groups are
 * activated where they suffice.
 */
export const STAGE0B_CONTINGENCY_SEED_START = 12401;
export function stage0bContingency(halved: readonly string[], amplitude: SoundAmplitude): { plan: PlannedRun[]; activateReserves: string[] } {
  const at = (c: number) => Object.fromEntries(stage0Groups(c).map((g) => [g.group, g]));
  const s3 = at(0.003125);
  const s0125 = at(0.0125);
  const defs: (GroupDef & { for: string[] })[] = [
    { for: ['N4-static'], group: 'SLc003125', n: 16, base: s3.SL.base },
    { for: ['N4-static'], group: 'L160c003125', n: 32, base: { ...s3.L160.base, amplitude: amplitude * 2.17 }, periodHint: s3.L160.periodHint },
    { for: ['N4-static'], group: 'SK18c003125', n: 8, base: s3.SK18.base },
    { for: ['N4-static'], group: 'SK22c003125', n: 8, base: s3.SK22.base },
    { for: ['N16-static'], group: 'SLc0125', n: 32, base: s0125.SL.base },
    { for: ['N64-shear'], group: 'T160a1c0125', n: 100, base: s0125.T160a1.base },
  ];
  const all = allocate(defs, STAGE0B_CONTINGENCY_SEED_START, 's0b', true);
  const need = new Set(defs.filter((d) => d.for.some((g) => halved.includes(g))).map((d) => d.group));
  const activateReserves = [
    ...(halved.includes('N4-shear') ? ['T80a1c00625'] : []),
    ...(halved.includes('N16-static') || halved.includes('N64-static') ? ['L160c0125'] : []),
  ];
  return { plan: all.filter((r) => need.has(r.group)), activateReserves };
}

// ───────────────────────── Universe B (UB-0) ─────────────────────────

type NcKey = 4 | 16 | 64;

/**
 * Frozen inputs for the Universe B plan (amendment A2 structure; scripts/ub0-freeze.ts,
 * regenerated after Stage 0b). Universe A data and analytical predictions only.
 */
export interface FrozenInputs {
  version: 'A2';
  /** K_T,A/(n kT) from Stage 0 — the only Universe A quantity that sets a Universe B parameter (unchanged by Stage 0b) */
  KTred: number;
  /** G3 c_B/c_A band per N_c, computed with that N_c's matched c_A */
  cRatio: Record<NcKey, [number, number]>;
  /** c_A at each N_c's matched Courant number (Stage 0 + 0b), for the standing-wave length and amplitude */
  cA: Record<NcKey, number>;
  /** standing-wave amplitude as a fraction of the sound speed (Stage 0b §4: 0.02 or 0.04) */
  soundAmplitude: SoundAmplitude;
}

/** The planned seed counts the power plan sets (results/ub0/power_plan.json). */
export interface SeedCounts {
  status: 'final' | 'provisional';
  n: Record<string, number>;
}

export function assertFrozenA2(f: FrozenInputs): void {
  if (f.version !== 'A2') throw new Error('frozen inputs are not in the A2 structure: regenerate them after Stage 0b (scripts/ub0-freeze.ts)');
}

export const UB0_SEED_START = 20001;
export const PILOT_SEED_START = 9501;

/**
 * Seed counts of the design (§11.2), the floor under the A2 power plan: no group runs
 * fewer seeds than the design gave it. Couette (C4, C16) is deferred to UB-0W (A2 §1.6).
 */
export const DESIGN_COUNTS: Record<string, number> = {
  SK4c2p18: 8, SK4c2p20: 8, SK4c2p22: 8, SK16c2p18: 8, SK16c2p20: 8, SK16c2p22: 8,
  SK64c2p18: 8, SK64c2p20: 8, SK64c2p22: 8, SK4c4p18: 8, SK4c4p20: 8, SK4c4p22: 8,
  SL4: 4, SL16: 4,
  T4a1: 48, T4a05: 96, T16a1: 48, T16a05: 96, T64a1: 6, T16e08: 48, T16e095: 48, T4c4: 24, T4dt: 48,
  L4: 4, L16: 4, L64: 4,
  W4c2: 4, W16c2: 4, W4c4: 4,
};

/**
 * Universe B judged configurations (design §4.3, §11.2; A1 §2.4, §4.2; A2), in the
 * canonical order of the seed allocation. Each group's Courant number is its
 * comparability group's (UB0Timestep.courantOf), halved once for any group the pilot
 * rule halved; `n` is the design count until `counts` replaces it.
 */
export function ub0Groups(f: FrozenInputs, counts?: SeedCounts, halved: readonly string[] = []): GroupDef[] {
  assertFrozenA2(f);
  const B = (group: string, Nc: number, ch = 2, e = 0.9) => ({ Nc, ch, e, KTred: f.KTred, courant: courantOf(group, halved), observables: true });
  const stat = (group: string, Nc: number, ch: number, phi: number, measure: number, extras: boolean) => ({
    ...B(group, Nc, ch),
    kind: 'static' as const,
    phi,
    L: 80,
    prep: 100,
    settle: 20,
    measure,
    sample: 1,
    extras,
  });
  const shear = (group: string, Nc: number, L: number, amplitude: number, ch = 2, e = 0.9) => ({
    ...B(group, Nc, ch, e),
    kind: 'shear' as const,
    phi: UB0_PHI,
    L,
    amplitude,
    prep: 100,
    settle: 20,
    measure: 1.5 * tauD(L),
    sample: 0.5,
  });
  const sound = (Nc: NcKey): Omit<GroupDef, 'n'> => {
    const [lo, hi] = f.cRatio[Nc];
    const cLo_p = f.cA[Nc] * lo * Math.sqrt(Nc); // σ_v units
    const cMid_p = f.cA[Nc] * 0.5 * (lo + hi) * Math.sqrt(Nc);
    const P = 160 / cLo_p;
    const group = `L${Nc}`;
    return {
      group,
      periodHint: P,
      base: { ...B(group, Nc), kind: 'sound', phi: UB0_PHI, L: 160, amplitude: f.soundAmplitude * cMid_p, prep: 100, settle: 20, measure: 14 * P, sample: 0.5 },
    };
  };
  const wall = (Nc: number, ch: number): Omit<GroupDef, 'n'> => {
    const group = `W${Nc}c${ch}`;
    return { group, base: { ...B(group, Nc, ch), kind: 'wall', phi: UB0_PHI, width: 40, height: 10 * ch * Math.sqrt(Nc), prep: 640, settle: 0, measure: 2000, sample: 1 } };
  };
  const defs: Omit<GroupDef, 'n'>[] = [];
  for (const [Nc, ch] of [[4, 2], [16, 2], [64, 2], [4, 4]]) {
    for (const phi of [0.18, 0.2, 0.22]) {
      const group = `SK${Nc}c${ch}p${Math.round(phi * 100)}`;
      defs.push({ group, base: stat(group, Nc, ch, phi, 500, false) });
    }
  }
  defs.push(
    { group: 'SL4', base: stat('SL4', 4, 2, UB0_PHI, 4200, true) },
    { group: 'SL16', base: stat('SL16', 16, 2, UB0_PHI, 4200, true) },
    { group: 'T4a1', base: shear('T4a1', 4, 80, 1) },
    { group: 'T4a05', base: shear('T4a05', 4, 80, 0.5) },
    { group: 'T16a1', base: shear('T16a1', 16, 80, 1) },
    { group: 'T16a05', base: shear('T16a05', 16, 80, 0.5) },
    { group: 'T64a1', base: shear('T64a1', 64, 160, 1) },
    { group: 'T16e08', base: shear('T16e08', 16, 80, 1, 2, 0.8) },
    { group: 'T16e095', base: shear('T16e095', 16, 80, 1, 2, 0.95) },
    { group: 'T4c4', base: shear('T4c4', 4, 80, 1, 4) },
    // the dt arm (PQ7c, PQ7d) at N_c = 4, half the N4-shear Courant number (A2 §1.4)
    { group: DT_ARM.group, base: shear(DT_ARM.group, 4, 80, 1) },
    sound(4),
    sound(16),
    sound(64),
    wall(4, 2),
    wall(16, 2),
    wall(4, 4),
  );
  return defs.map((d) => {
    const n = counts ? counts.n[d.group] : DESIGN_COUNTS[d.group];
    if (!Number.isInteger(n) || n < DESIGN_COUNTS[d.group]) throw new Error(`group ${d.group}: seed count ${n} is not an integer ≥ the design count ${DESIGN_COUNTS[d.group]}`);
    comparabilityOf(d.group); // every group must belong to a comparability group
    return { ...d, n };
  });
}

/**
 * The judged plan. Seed blocks are generated from the committed power plan (`counts`,
 * status 'final'); a provisional plan is refused unless explicitly allowed (tests and
 * cost projections only — never for a judged run).
 */
export function ub0Plan(
  f: FrozenInputs,
  counts: SeedCounts,
  opts: { reserve?: boolean; halved?: readonly string[]; allowProvisional?: boolean } = {},
): PlannedRun[] {
  if (counts.status !== 'final' && !opts.allowProvisional) throw new Error('the judged plan needs the FINAL power plan (after Stage 0b); refusing a provisional one');
  return allocate(ub0Groups(f, counts, opts.halved ?? []), UB0_SEED_START, 'ub0', opts.reserve ?? false);
}

/** Seed blocks: one record per group, for results/ub0/seed_plan.json. */
export function seedBlocks(defs: GroupDef[], start: number): { group: string; n: number; planned: [number, number]; reserve: [number, number] }[] {
  let s = start;
  return defs.map((d) => {
    const b = { group: d.group, n: d.n, planned: [s, s + d.n - 1] as [number, number], reserve: [s + d.n, s + 2 * d.n - 1] as [number, number] };
    s += 2 * d.n;
    return b;
  });
}

/** Every seed range used anywhere in UB-0 must be disjoint (A2 §6). Throws on an overlap. */
export function assertDisjoint(ranges: { name: string; range: [number, number] }[]): void {
  const sorted = [...ranges].sort((a, b) => a.range[0] - b.range[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].range[0] <= sorted[i - 1].range[1]) throw new Error(`seed ranges overlap: ${sorted[i - 1].name} ${sorted[i - 1].range.join('–')} and ${sorted[i].name} ${sorted[i].range.join('–')}`);
  }
}

/**
 * Stability pilots (A2 §1.5): ONE design-seed run of each judged configuration at its
 * assigned Courant number, full planned length, observables off (ledgers, drift, halts,
 * timing only). Round 2 repeats, with the same seeds, only the groups the round-1 pilots
 * halved. Seeds 9501 + the group's index; they are never judged.
 */
export function pilotPlan(f: FrozenInputs, opts: { round?: 1 | 2; halved?: readonly string[] } = {}): PlannedRun[] {
  const round = opts.round ?? 1;
  const halved = opts.halved ?? [];
  if (round === 2 && !halved.length) throw new Error('pilot round 2 repeats only halved groups: none given');
  return ub0Groups(f, undefined, round === 2 ? halved : [])
    .map((d, i) => ({ d, seed: PILOT_SEED_START + i }))
    .filter(({ d }) => round === 1 || halved.includes(comparabilityOf(d.group)))
    .map(({ d, seed }) => ({
      ...d.base,
      observables: false,
      id: `pilot${round === 2 ? '-r2' : ''}-${d.group}-${seed}`,
      seed,
      group: d.group,
      planned: true,
      periodHint: d.periodHint,
    }));
}
