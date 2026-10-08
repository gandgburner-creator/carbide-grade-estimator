# UB-0 Stage 0b protocol: Universe A supplement (references, sound amplitude, timestep checks)

**Status.** This protocol and the code it names are committed **before any Stage 0b run**. The runner refuses the Stage 0b plans unless this file is committed and `src/`, `scripts/` and `docs/` are clean.

- **Universe A only** (N_c = 1). No Universe B run is part of it.
- It implements design amendment A2 (`UB0_DESIGN_AMENDMENT_2.md`) §1.4, §1.8, §3 and §5.
- **It supplements Stage 0** (`CRITERIA_UB0_STAGE0.md`, frozen at 9c5d530). It does not replace it:
  - Stage 0's runs, its exclusions and its recorded reference values are not modified;
  - **Stage 0's mapping input K_T,A/(n kT) = 2.37564 ± 0.00249 is not modified.** It alone sets k_s, and Stage 0b only checks it (§5.3).
- Like Stage 0, Stage 0b has **no pass/fail on Universe A physics**. Only quality gates (§6) and review triggers (§5) apply.
- The Item 1, 2 and 3 classifications are untouched.

---

## 1. What Stage 0b is for

| purpose | why (A2) |
|---|---|
| **More reference seeds** at Courant 0.025 for ν_A (L 80 d and L 160 d), S_A, c_A and the Universe A wall gates | Stage 0's references were sized by the design's noise estimate, which Stage 0 showed to be 3–10× too low. A reference's SE enters the judged CIs (A1 §5), and its df sets the planning factor of the power plan (A2 §3.4). |
| **The sound-amplitude study** (0.02 and 0.04 of c) | c's per-seed scatter, 4.8 %, is ≈ 10× the design's assumption and not understood. A larger amplitude may reduce it (A2 §3.1). |
| **Timestep checks** at Courant 0.0125 and 0.00625 for ν, K, c and S | A1's "repeat Stage 0 at 0.0125" is superseded (A2 §1.8). Universe A's convergence is checked directly instead. |
| **Matched references** at the N_c = 4 Courant numbers | ν_A at 0.0125 (N4-shear); c_A and S_A at 0.00625 (N4-static) (A2 §1.4) |
| **The noise basis** of the power plan | per-seed scatter of every Universe A estimator the Universe B primaries reuse (A2 §3.3) |

Nothing measured in Stage 0b may set a Universe B model parameter. Stage 0b's results define references, prediction bands, run lengths and amplitudes of the Universe B sound runs (as Stage 0's c_A already did, A1 §4.2), and seed counts.

## 2. Code

| file | content |
|---|---|
| `src/universeB/UB0Plans.ts` (`stage0bGroups`, `stage0bPlan`) | the groups, specs and seeds of §3 |
| `src/universeB/UB0Stage0b.ts` | per-run estimates (the committed Stage 0 estimators), pooling with Stage 0, the amplitude rule (§4), the timestep checks (§5), the matched references, the noise basis |
| `src/universeB/UB0Stage0.ts` (`qualityGates`) | the quality gates, unchanged from Stage 0 |
| `scripts/ub0-run.ts` (`--plan stage0b-1`, `--plan stage0b-2`) | the checkpointed runner, with the interlock above |
| `scripts/ub0-stage0b-analysis.ts` | reserve replacement, the amplitude decision, the final aggregation and outputs |

The tests are `tests/universeB.stage0b.test.ts` (rules on synthetic values, and the estimators on tiny real runs) and `tests/universeB.plans.test.ts` (plan, seeds, identity of the pooled specs). The instrument is the one Stage 0 used, with the phase-boundary contact-history fix of 7b1f3b7 (implementation record §3.5). That fix leaves the dynamics bit-identical and changes only the "unexplained late contact" counter. Stage 0's six exclusions for that artifact stand as recorded.

## 3. Configurations, seeds and run lengths

**Common settings** are those of Stage 0 §3:

- molecular units, φ = 0.2, rigid elastic disks (e = 1);
- preparation 100, one rescale, settle 20;
- every run length fixed in advance (A1 §4.2): τ_D = L²/(4π² ν_D), and the sound period P = 160/2.094;
- the five reference groups at Courant 0.025 use **exactly Stage 0's specs** (tested), so they pool with Stage 0's used runs.

**Seeds.**

- Each group has a contiguous block of 2 × planned seeds: planned first, then reserve.
- The blocks run from 11001 in the order of the table, over both phases at once. So no seed depends on the amplitude decision.
- The block 11001–12382 is disjoint from Stage 0 (10001–10424), the design and test seeds (9001–9999) and the judged block (from 20001).

| phase | group | kind | Courant | geometry / amplitude | measured window | planned | seeds (planned; reserve) | with Stage 0 |
|---|---|---|---|---|---|---|---|---|
| 1 | T80a1 | shear wave, U₀ = c_th | 0.025 | L 80 d | 1.5 τ_D = 176.4 | 106 | 11001–11106; 11107–11212 | 94 + 106 = 200 |
| 1 | T160a1 | shear wave, U₀ = c_th | 0.025 | L 160 d | 705.7 | 88 | 11213–11300; 11301–11388 | 12 + 88 = 100 |
| 1 | SL | static, long, with S(k) | 0.025 | L 80 d | 4200 | 24 | 11389–11412; 11413–11436 | 8 + 24 = 32 |
| 1 | W40 | wall box, Maxwell walls | 0.025 | 40 × 40 d | 2000 (after 640) | 28 | 11437–11464; 11465–11492 | 4 + 28 = 32 |
| 1 | L160 | standing wave | 0.025 | L 160 d, 0.02 × 2.17 c_th | 14 P = 1069.7 | 17 | 11493–11509; 11510–11526 | 15 + 17 = 32 |
| 1 | L160a04 | standing wave | 0.025 | L 160 d, **0.04** × 2.17 c_th | 1069.7 | 32 | 11527–11558; 11559–11590 | — |
| 1 | T80a1c0125 | shear wave | **0.0125** | L 80 d | 176.4 | 200 | 11591–11790; 11791–11990 | — |
| 1 | T80a1c00625 | shear wave | **0.00625** | L 80 d | 176.4 | 100 | 11991–12090; 12091–12190 | — |
| 1 | SK18c0125, SK22c0125 | static, φ 0.18 / 0.22 | **0.0125** | L 80 d | 500 | 8 each | 12191–12198, 12207–12214; reserves after each | — |
| 1 | SK18c00625, SK22c00625 | static, φ 0.18 / 0.22 | **0.00625** | L 80 d | 500 | 8 each | 12223–12230, 12239–12246; reserves after each | — |
| 1 | SLc00625 | static, long | **0.00625** | L 80 d | 4200 | 16 | 12255–12270; 12271–12286 | — |
| 2 | L160c0125 | standing wave | **0.0125** | L 160 d, the **selected** amplitude (§4) | 1069.7 | 16 | 12287–12302; 12303–12318 | — |
| 2 | L160c00625 | standing wave | **0.00625** | L 160 d, the **selected** amplitude | 1069.7 | 32 | 12319–12350; 12351–12382 | — |

**Why these counts.** They are fixed here, not by any Stage 0b result. Each one is chosen so that the Universe A side does not limit a Universe B primary:

- ν_A at L 80 d: 200 at each of 0.025 (N_c 16) and 0.0125 (N_c 4). The reference's SE (≈ 0.75 %) is then ≈ 20 % of PQ1's variance budget.
- ν_A at L 160 d: 100, the cost-optimal split for PQ1.64 (A2 §3.8).
- S_A: 32 at 0.025 (N_c 16) and 16 at 0.00625 (N_c 4). PQ5's Universe A term is suppressed by S_RPA/S_A (A2 §3.1), so 16 suffice.
- c_A: 32 per amplitude at 0.025, and 32 at the selected amplitude at 0.00625 (N_c 4). 16 at 0.0125 serve the timestep check only.
- K: 8 per density per finer Courant number. K's per-seed scatter is 0.1 %, so 8 resolve ±1/30 easily.
- W40: 32, for the planning SD of the wall gates (Stage 0's 4 seeds give a planning factor of 1.72).
- T80a1 at 0.00625: 100, for the timestep check, and as the contingency reference if N4-shear is halved (§8).

**Estimated cost:** ≈ 38 core-hours (B0 model): phase 1 ≈ 24, phase 2 ≈ 14. That is ≈ 10 h on 4 cores.

## 4. The sound-amplitude study and its pre-registered selection rule

Both amplitudes run at Courant 0.025, with 32 seeds each:

- 0.02 c: Stage 0's 15 used runs plus L160's 17;
- 0.04 c: L160a04.

The estimator is Stage 0's (§4.5): a variable-projection fit of the velocity mode over t ≥ 2P.

**Select 0.04 iff all three hold** (`UB0Stage0b.amplitudeDecision`):

1. **A material precision gain:** s_plan(0.04) ≤ 0.75 · s_plan(0.02), where s_plan is the 80 % upper confidence bound on the per-seed relative SD (A2 §3.4);
2. **No detected amplitude effect:** the 95 % CI of c(0.04)/c(0.02) (log scale, Welch) contains 1;
3. **No material shift:** |c(0.04)/c(0.02) − 1| ≤ 1 %.

Otherwise the design's 0.02 is kept.

**Why this rule.**

- A larger amplitude raises the signal against thermal noise.
- Nonlinear effects scale as the amplitude squared (Mach 0.04: an O(10⁻³) frequency shift).
- Conditions 2 and 3 together guard against trading precision for bias. Condition 3 is deliberately strict: a chance shift above 1 % keeps 0.02, which is the conservative outcome.

**The decision.**

- It is written by `scripts/ub0-stage0b-analysis.ts` (phase 1) to `results/ub0/stage0b/amplitude_decision.json` and committed.
- Phase 2 then runs at the selected amplitude.
- The selected amplitude, as a fraction of each universe's own sound speed (A1 §4.2), becomes the amplitude of the Universe B standing-wave runs, through `frozen_inputs.json` `soundAmplitude`.

## 5. Timestep checks and review triggers

All checks are ratios of seed means: the finer Courant number over Courant 0.025, log-scale 95 % CI, Welch. They are computed by `UB0Stage0b.dtChecks`.

### 5.1 ν, c, S (diagnostics)

| quantity | cells compared | review if |
|---|---|---|
| ν (L 80 d, U₀ = c_th) | 0.0125 and 0.00625 against 0.025 (Stage 0 + Stage 0b) | the CI lies **entirely outside [0.97, 1.03]** (PQ7d's margin, the design's dt tolerance) |
| c (L 160 d, selected amplitude) | 0.0125 and 0.00625 against 0.025 | same |
| S, shells 1 and 2 | 0.00625 against 0.025 | same |

**Why "review" and not "FAIL".**

- The Universe B comparisons use matched references (A2 §1.4), so a small dt effect in Universe A cannot bias them.
- A large one, entirely outside ±3 %, would mean Universe A itself is not converged at the precision UB-0 assumes. That is a finding to review before anything is frozen.

### 5.2 Reported only

- The Universe A wall gates G-W1–G-W3 (32 seeds).
- λ, the collision rate, and the remaining Stage 0 references, pooled.

### 5.3 The K check (the mapping input)

- K_T,A(c)/(n kT) at c = 0.0125 and 0.00625 is computed by Stage 0's central difference (§4.1 of the Stage 0 protocol), from SK18c and SK22c.
- It is compared with the **frozen** Stage 0 K_T,A.
- **PASS iff its 95 % CI lies inside [1 − 1/30, 1 + 1/30]** (⅓ of PQ2's ± 10 % margin). **Anything else ⇒ review.**
- K_T,A is never replaced or re-frozen by this check. It is the mapping input (A1 M6), and A2 keeps it.

If any review trigger fires, the analysis exits with code 4, and `scripts/ub0-freeze.ts` refuses to freeze until the review is resolved.

## 6. Quality gates, exclusions, reserves

The quality gates are **unchanged from Stage 0** (§5 of its protocol; `qualityGates`). A run is excluded if:

- it halted;
- it lost collision events;
- its measured-phase energy residual exceeds 10⁻⁹ relative;
- its momentum residual exceeds 10⁻⁹ relative;
- it had an unexplained late contact;
- a safety failure was flagged.

These are decided before any observable of the run is used.

- An excluded planned run is replaced by the next unused reserve seed of its group.
- **There are no precision targets and no extension.** The counts of §3 are final. The SEs carry the uncertainty forward (A1 §5), and the power plan's planning factors account for the df (A2 §3.4).
- No other additional runs are permitted, except the contingency of §8.

## 7. Pooling with Stage 0

**What is pooled.**

- Stage 0's **used** runs (`stage0_summary.json` `activeRuns`) of T80a1, T160a1, SL, W40 and L160 pool with Stage 0b's groups of the same name. Their specs are identical apart from the seed (tested).
- Pooling is by run: the per-seed estimates of both stages enter one ensemble.

**Noise basis** (`UB0Stage0b.noiseBasis`):

- the per-seed SD pooled **within Courant cells**, as A2 §3.3 defines it;
- T80a05 (Stage 0, 96 runs) is used as is: it is not a reference, only the noise basis for PQ6a's σ_v/2 arm.

**Not pooled:**

- different Courant numbers (their cells stay separate);
- the two amplitudes at 0.025;
- Stage 0's SK groups (K_T,A is frozen from them alone).

## 8. Contingency: matched references after a pilot halving

The Universe B pilots may halve a comparability group's Courant number once (A2 §1.5). If that moves a group with matched Universe A references to a Courant number not measured here, the references are measured there **before the freeze**, with this protocol's definitions:

Contingency groups are allocated now, from **12401**, over the full list, so no seed depends on which are needed (`UB0Plans.stage0bContingency`, 12401–12792). Each block is 2n, and every run in it is active.

| halved group | new Courant | Universe A runs added |
|---|---|---|
| N4-shear | 0.00625 | T80a1c00625's 100 reserve seeds (12091–12190) are activated, giving 200 at 0.00625 |
| N4-static | 0.003125 | SLc003125 (16), L160c003125 at the selected amplitude (32), SK18c003125 and SK22c003125 (8 each), for the K check |
| N16-static | 0.0125 | SLc0125 (32); L160c0125's 16 reserves activated, giving 32 |
| N64-static | 0.0125 | L160c0125's 16 reserves activated, giving 32 |
| N16-shear | 0.0125 | none: ν at 0.0125 exists (T80a1c0125, 200) |
| N64-shear | 0.0125 | T160a1c0125 (100) |
| W4c2, W4c4, W16c2 | — | none: no Universe A reference |

Run with `--plan stage0b-x`, then `scripts/ub0-stage0b-analysis.ts --final --halved <groups>`, which lists any activated reserves still to run.

The K check (§5.3) is repeated at the new Courant number. Nothing else changes.

## 9. Outputs and the freeze sequence

`results/ub0/stage0b/` contains:

| file | content |
|---|---|
| `runs/*.json.gz`, `manifest.json`, `timings.log` | as in Stage 0 |
| `amplitude_decision.json` | phase 1: §4 |
| `stage0b_summary.json` | matched references, timestep checks, review list, noise basis, pooled references, exclusions |
| `stage0b_reference.json` | the input of the analytical predictions: Stage 0's K_T,A and Z unchanged; c_A, ν, λ and the collision rate pooled at 0.025; `cAByNc` (c_A matched per N_c) |
| `stage0b_report.txt` | human-readable summary |

Then, in this order (A2 §7):

```
npx tsx scripts/ub0-predictions.ts --inputs results/ub0/stage0b/stage0b_reference.json --label stage0b
npx tsx scripts/ub0-freeze.ts          # frozen_inputs.json, A2 structure; K_T,A from Stage 0
npx tsx scripts/ub0-power.ts           # power_plan.json (final) and seed_plan.json
```

Each output is committed before the next step. The blind pilots come only after the seed plan.

## 10. Reproduction

```
npx tsx scripts/ub0-run.ts --plan stage0b-1 --threads 4
npx tsx scripts/ub0-stage0b-analysis.ts                 # lists replacement runs needed (exit 3), else writes the amplitude decision
npx tsx scripts/ub0-run.ts --plan stage0b-1 --reserve --filter '<listed ids>'   # only if listed
npx tsx scripts/ub0-run.ts --plan stage0b-2 --threads 4  # at the committed amplitude decision
npx tsx scripts/ub0-stage0b-analysis.ts --final         # exit 4 if a review trigger fired
```

Runs are deterministic per seed. A restarted runner resumes from mid-run checkpoints with a byte-identical continuation (`tests/universeB.instrument.test.ts`).
