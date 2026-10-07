import { henderson, UB0_PHI } from './CoarseGrainMap';
import type { UB0Spec } from './UB0Run';

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

interface GroupDef {
  group: string;
  n: number;
  base: Omit<UB0Spec, 'id' | 'seed'>;
  periodHint?: number;
}

/** Contiguous seed blocks of 2 × planned per group (planned first, then reserve), from `start`. */
function allocate(defs: GroupDef[], start: number, prefix: string, withReserve: boolean): PlannedRun[] {
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

// ───────────────────────── Universe B (UB-0) ─────────────────────────

/** Frozen inputs for the Universe B plan: the mapping input and the G3 sound-band edges. */
export interface FrozenInputs {
  /** K_T,A/(n kT) from Stage 0 — the only Universe A quantity that sets a Universe B parameter */
  KTred: number;
  /** G3 c_B/c_A band per N_c and the Stage 0 c_A (molecular), for the standing-wave length and amplitude */
  cA: number;
  cRatio: Record<number, [number, number]>;
}

export const UB0_SEED_START = 20001;
export const PILOT_SEED_START = 9501;

/** Universe B judged configurations (design §4.3, §11.2; amendment A1 §2.4, §4.2). */
export function ub0Groups(f: FrozenInputs, courant = COURANT_BASE): GroupDef[] {
  const B = (Nc: number, ch = 2, e = 0.9, cour = courant) => ({ Nc, ch, e, KTred: f.KTred, courant: cour, observables: true });
  const stat = (Nc: number, ch: number, phi: number, measure: number, extras: boolean) => ({
    ...B(Nc, ch),
    kind: 'static' as const,
    phi,
    L: 80,
    prep: 100,
    settle: 20,
    measure,
    sample: 1,
    extras,
  });
  const shear = (b: ReturnType<typeof B>, L: number, amplitude: number) => ({
    ...b,
    kind: 'shear' as const,
    phi: UB0_PHI,
    L,
    amplitude,
    prep: 100,
    settle: 20,
    measure: 1.5 * tauD(L),
    sample: 0.5,
  });
  const sound = (Nc: number): GroupDef => {
    const [lo, hi] = f.cRatio[Nc];
    const cLo_p = f.cA * lo * Math.sqrt(Nc); // σ_v units
    const cMid_p = f.cA * 0.5 * (lo + hi) * Math.sqrt(Nc);
    const P = 160 / cLo_p;
    return {
      group: `L${Nc}`,
      n: 4,
      periodHint: P,
      base: { ...B(Nc), kind: 'sound', phi: UB0_PHI, L: 160, amplitude: 0.02 * cMid_p, prep: 100, settle: 20, measure: 14 * P, sample: 0.5 },
    };
  };
  const wall = (Nc: number, ch: number): GroupDef => ({
    group: `W${Nc}c${ch}`,
    n: 4,
    base: { ...B(Nc, ch), kind: 'wall', phi: UB0_PHI, width: 40, height: 10 * ch * Math.sqrt(Nc), prep: 640, settle: 0, measure: 2000, sample: 1 },
  });
  const couette = (Nc: number): GroupDef => ({
    group: `C${Nc}`,
    n: 4,
    base: { ...B(Nc), kind: 'couette', phi: UB0_PHI, width: 40, height: 40, wallSpeed: 1, prep: (3 * 40 * 40) / NU_D, settle: 0, measure: 3000, sample: 1 },
  });
  const sk: GroupDef[] = [];
  for (const [Nc, ch] of [[4, 2], [16, 2], [64, 2], [4, 4]]) {
    for (const phi of [0.18, 0.2, 0.22]) sk.push({ group: `SK${Nc}c${ch}p${Math.round(phi * 100)}`, n: 8, base: stat(Nc, ch, phi, 500, false) });
  }
  return [
    ...sk,
    { group: 'SL4', n: 4, base: stat(4, 2, UB0_PHI, 4200, true) },
    { group: 'SL16', n: 4, base: stat(16, 2, UB0_PHI, 4200, true) },
    { group: 'T4a1', n: 48, base: shear(B(4), 80, 1) },
    { group: 'T4a05', n: 96, base: shear(B(4), 80, 0.5) },
    { group: 'T16a1', n: 48, base: shear(B(16), 80, 1) },
    { group: 'T16a05', n: 96, base: shear(B(16), 80, 0.5) },
    { group: 'T64a1', n: 6, base: shear(B(64), 160, 1) },
    { group: 'T16e08', n: 48, base: shear(B(16, 2, 0.8), 80, 1) },
    { group: 'T16e095', n: 48, base: shear(B(16, 2, 0.95), 80, 1) },
    { group: 'T4c4', n: 24, base: shear(B(4, 4), 80, 1) },
    { group: 'T16dt', n: 48, base: shear(B(16, 2, 0.9, courant / 2), 80, 1) },
    sound(4),
    sound(16),
    sound(64),
    wall(4, 2),
    wall(16, 2),
    wall(4, 4),
    couette(4),
    couette(16),
  ];
}

export function ub0Plan(f: FrozenInputs, opts: { reserve?: boolean; courant?: number } = {}): PlannedRun[] {
  return allocate(ub0Groups(f, opts.courant), UB0_SEED_START, 'ub0', opts.reserve ?? false);
}

/**
 * Stability pilots (A1 §4.3): ONE design-seed run of each Universe B judged
 * configuration, full planned length, observables off (ledgers, drift, halts, timing only).
 */
export function pilotPlan(f: FrozenInputs, courant = COURANT_BASE): PlannedRun[] {
  return ub0Groups(f, courant).map((d, i) => ({
    ...d.base,
    observables: false,
    id: `pilot-${d.group}-${PILOT_SEED_START + i}`,
    seed: PILOT_SEED_START + i,
    group: d.group,
    planned: true,
    periodHint: d.periodHint,
  }));
}
