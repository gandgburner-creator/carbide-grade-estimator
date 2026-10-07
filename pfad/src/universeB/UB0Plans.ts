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
