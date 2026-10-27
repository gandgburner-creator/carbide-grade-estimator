/**
 * Seed ranges owned by the UB-0 protocol (docs/UB0_DESIGN_AMENDMENT_2.md §6,
 * docs/CRITERIA_UB0_STAGE0.md, docs/CRITERIA_UB0_STAGE0B.md). The laboratory
 * app never runs the UB-0 instrument on these seeds: a run there would either
 * duplicate a recorded protocol run or touch a seed that is reserved for a
 * judged or blind run. Each range covers its plan with room for reserves
 * (tests/app.seeds.test.ts checks the plans lie inside).
 */
export interface SeedRange {
  from: number;
  to: number;
  owner: string;
}

export const UB0_RESERVED_SEEDS: readonly SeedRange[] = [
  { from: 9001, to: 9500, owner: 'UB-0 design seeds (integrator and design checks)' },
  { from: 9501, to: 9999, owner: 'UB-0 blind stability pilots (need approval; never run from the app)' },
  { from: 10001, to: 10999, owner: 'UB-0 Stage 0 (Universe A anchors, recorded)' },
  { from: 11001, to: 12999, owner: 'UB-0 Stage 0b (Universe A, recorded) and its contingency' },
  { from: 20001, to: 29999, owner: 'UB-0 judged seed plan and reserves (preregistered; never run from the app)' },
];

export function reservedOwner(seed: number): SeedRange | null {
  return UB0_RESERVED_SEEDS.find((r) => seed >= r.from && seed <= r.to) ?? null;
}

/** The first `n` consecutive seeds from `start` that avoid every reserved range. */
export function freeSeeds(start: number, n: number): number[] {
  const out: number[] = [];
  for (let s = Math.max(1, Math.floor(start)); out.length < n; s++) {
    const r = reservedOwner(s);
    if (r) s = r.to;
    else out.push(s);
  }
  return out;
}
