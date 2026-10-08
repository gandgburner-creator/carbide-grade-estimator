# UB-0 Stage 0 protocol: Universe A inputs and references

**Status.** This protocol was written and committed before any Stage 0 run.

- It covers **Universe A only** (N_c = 1). No Universe B run is part of it.
- It implements:
  - design amendment A1 (`UB0_DESIGN_AMENDMENT_1.md`, 7b8e548), §6 (separate Stage 0 protocol), §4 (fixed run lengths) and §5 (uncertainty propagation);
  - the design review (`REVIEW_UB0_PREREGISTRATION_DESIGN.md`, d068755), §4.3, §11 and §15.2 (gate G2).
- Stage 0 has **no pass/fail on Universe A physics**. Universe A is the reference. Only the quality gates of §5 apply.
- The Item 1, 2 and 3 classifications are untouched.

---

## 1. What Stage 0 is for

| role | quantity | use |
|---|---|---|
| **The mapping input (the only one)** | K_T,A/(n kT), Universe A's reduced isothermal bulk modulus at φ = 0.2 | Sets the occupancy stiffness k_s = (N_c − 1) K_T,A/(nφ) of every Universe B run. Nothing else measured in Stage 0 may change any Universe B model parameter. |
| Comparison references | ν_A (L = 80, 160, 320 d); c_A and Γ_A = ρc_A²/K_T,A; S_A(k) at the lowest shells; Z_A(0.2); collision rate and λ_A; equipartition and a₂; Universe A wall-box profile and wall gates; Universe A Couette | Targets of the Universe B primaries, or inputs to *predictions and bands* (for example c_A in the PQ3 band). Never a Universe B model parameter. |

Universe A is measured with **the same code as Universe B**: `src/universeB/UB0Run.ts` and `UB0Estimators.ts`, at N_c = 1. A test checks that N_c = 1 reproduces the Universe A engine bit for bit (`tests/universeB.instrument.test.ts`).

## 2. Code

| file | content |
|---|---|
| `src/universeB/UB0Run.ts` | the run (phases, sampling, exact checkpoint state) |
| `src/universeB/UB0Estimators.ts` | per-run estimators |
| `src/universeB/UB0Stage0.ts` | aggregation, quality gates, precision targets |
| `src/universeB/UB0Plans.ts` | the Stage 0 plan and seeds |
| `scripts/ub0-run.ts` | checkpointed parallel runner |
| `scripts/ub0-stage0-analysis.ts` | reserve activation, aggregation, outputs |

All estimators are validated on synthetic data (`tests/universeB.estimators.test.ts`, `tests/universeB.stage0.test.ts`). Checkpoint/resume is byte-identical (`tests/universeB.instrument.test.ts`).

## 3. Configurations, seeds and run lengths

**Common settings.**

- Molecular units m = d = kT = 1; φ = 0.2 unless stated.
- Rigid elastic disks (e = 1), rewind-to-contact, adaptive timestep at Courant 0.025 (A-05, A-06).
- **Durations in d/c_th:**
  - preparation 100;
  - one rescale to KE = N kT with zero momentum (periodic kinds only);
  - settle 20;
  - then the measurement.
- **Every run length is fixed now** (A1 §4.2). None depends on any Stage 0 or Universe B result.
  - τ_D = L²/(4π² ν_D), with ν_D = 0.351/ρ = 1.378 (Item 1's φ = 0.2 value).
  - The sound period is P = 160/2.094, using the lower 95 % limit of Item 2's c₀.

**Seeds.**

- Each group has a contiguous block of 2 × planned seeds: planned first, then reserves.
- The blocks run from 10001 to 10424, in the order of the table.

| group | kind | geometry | measurement | sample | planned seeds |
|---|---|---|---|---|---|
| SK18 | static | periodic 80 × 80 d, φ = 0.18 | 500 | 1 | 8 (10001–10008) |
| SK20 | static | periodic 80 × 80 d, φ = 0.20 | 500 | 1 | 8 (10017–10024) |
| SK22 | static | periodic 80 × 80 d, φ = 0.22 | 500 | 1 | 8 (10033–10040) |
| SL | static, long, with g(r), ψ₆, self-diffusion | periodic 80 × 80 d | 4200 | 1 | 8 (10049–10056) |
| T80a1 | shear wave, U₀ = c_th | periodic L = 80 d | 1.5 τ_D | 0.5 | 48 (10065–10112) |
| T80a05 | shear wave, U₀ = c_th/2 | periodic L = 80 d | 1.5 τ_D | 0.5 | 96 (10161–10256) |
| T160a1 | shear wave, U₀ = c_th | periodic L = 160 d | 1.5 τ_D | 0.5 | 12 (10353–10364) |
| T320a1 | shear wave, U₀ = c_th | periodic L = 320 d | 1.5 τ_D | 0.5 | 4 (10377–10380) |
| L160 | standing sound wave, U₀ = 0.02 × 2.17 c_th | periodic L = 160 d | 14 P | 0.5 | 8 (10385–10392) |
| W40 | wall box: Maxwell walls Aw = 1, kT_w = 1 | 40 × 40 d | relax 640, measure 2000 | 1 | 4 (10401–10404) |
| C40 | Couette, walls at ∓c_th/2 | 40 × 40 d | develop 3H²/ν_D, measure 3000 | 1 | 4 (10409–10412) |
| C80 | Couette, walls at ∓c_th/2 | 40 × 80 d | develop 3H²/ν_D, measure 3000 | 1 | 4 (10417–10420) |

The planned seed counts are the design's (§11.2).

**A numbering change from A1.** A1 §6 named the block 8001–8199. That block holds fewer seeds than the 212 planned runs plus their reserves. This is a numbering change only, made before any run.

**Estimated cost:** 130 × 10⁹ particle-steps, about 7–12 core-hours. This is an ESTIMATE from Universe A's measured 0.2–0.33 µs per particle-step. The four T320 runs are the largest share.

## 4. Estimators

Every estimator is computed per run. Seeds are the unit of replication.

1. **Static pressure.**
   - Virial pressure P = P_kin + P_coll (+ P_occ, which is zero at N_c = 1).
   - P_kin = ΣMv²/(2A).
   - P_coll = Σ_events R n·Δp / (2A Δt), from every pair collision.
   - It is temperature-normalised per run: P_norm = (P_kin + P_coll)/T̄ + P_occ (design §11.4). The kinetic and collisional parts are exactly ∝ T at fixed φ.
   - The first sample is dropped because it closes a partial interval.
   - The within-run SE is by block averaging and is used for diagnostics only.

   **K_T,A** (the mapping input):
   - K = φ·(P̄_norm(0.22) − P̄_norm(0.18))/0.04.
   - SE = (φ/0.04)·√(SE₂₂² + SE₁₈²), from the seed spreads, with Welch–Satterthwaite df.
   - **K_T,A/(n kT) = K/n**, with n = 0.2/(π/4).
   - This central difference is the *operational definition* of the input. Its curvature bias against the exact derivative is about 0.3 % (Henderson estimate). It is disclosed, not corrected; the same bias appears wherever K_T,A is used.

   **Z_A** = P̄_norm(0.20)/n, from SK20.
2. **Structure factor.**
   - S(k) = |Σ e^{−ik·r}|²/N, averaged over the vectors of each shell: |m|² = 1, 2 and 4 in units of 2π/L.
   - Measured in SL, L = 80 d.
3. **Collision rate and mean free path.**
   - Collision rate = 2 Δ(collisions)/(N Δt).
   - λ = ⟨|v|⟩ / rate.
   - Both from SL.
4. **Shear-wave viscosity ν.**
   - Mode amplitude U(t) = (2/N) Σ v_x sin(ky).
   - Thermal time s = ∫ √T_kin dt, with T_ref = 1.
   - Least squares in linear amplitude, U = U₀ exp(−ν k² s), over s ∈ [0.1 τ_D, min(1.5 τ_D, s_end)].
   - The raw-time fit is reported alongside.
   - Also reported: the projected stress decomposition and the stress-route ν (design SQ9).
5. **Sound speed c_A.**
   - Velocity mode V(t) = (2/N) Σ v_x sin(kx), fitted by e^{−γt}(a cos ωt + b sin ωt) over t ≥ 2P.
   - The fit is variable projection, starting from the periodogram peak.
   - c_A = ω/k. The density-mode fit is reported as a secondary.
   - **Γ_A = c_A²/(K_T,A/(n kT))**, with its SE by the delta method and Welch–Satterthwaite df. Δ_A = Γ_A − 1.
6. **Wall box** (instrument validation at N_c = 1).
   - The wall gates of A1 §2.4 (G-W1, G-W2, G-W3) are measured on Universe A, with h := 4d for the windows.
   - Their Universe A values show what the instrument achieves where the physics is plain hard disks.
   - They are reported, not judged.
7. **Couette** (secondary). μ = τ_w/γ̇_core, slip, core temperature.

## 5. Quality gates and exclusions

A run is **excluded** if any of the following holds:

- it halted;
- it lost collision events;
- the measured-phase energy-ledger residual exceeds 10⁻⁹ relative;
- the momentum-ledger residual exceeds 10⁻⁹ relative;
- an unexplained late contact occurred;
- a safety failure was flagged.

These are decided by `qualityGates` before any observable of the run is used.

An excluded planned run is replaced by the next unused reserve seed of its group. Every exclusion is reported.

## 6. Precision targets

| quantity | target (relative SE) |
|---|---|
| K_T,A/(n kT) (the mapping input) | ≤ 1.5 % |
| ν_A at L = 80 d, U₀ = c_th | ≤ 1 % |
| c_A | ≤ 1 % |
| S_A(k), lowest shell | ≤ 5 % |

## 7. One pre-declared extension

- If a target is missed with the planned seeds (plus any replacements), **all reserve seeds of the groups feeding that quantity are activated, once**:
  - K → SK18 and SK22;
  - ν → T80a1;
  - c_A → L160;
  - S → SL.
- After that, the values are frozen whatever their precision. The SEs carry the uncertainty forward (A1 §5).
- No other additional runs are permitted.
- `scripts/ub0-stage0-analysis.ts` applies §5–§7 mechanically. It exits with the list of reserve runs needed if any are missing.

## 8. Outputs and the freeze

`results/ub0/stage0/` contains:

| file | content |
|---|---|
| `runs/*.json.gz` | every run's full record |
| `manifest.json` | plan, plan hash, git commit |
| `timings.log` | wall-clock per run (not data) |
| `stage0_summary.json` | all statistics, exclusions, extensions |
| `stage0_reference.json` | value, SE and df of the inputs for the analytical predictions |
| `stage0_report.txt` | human-readable summary |

**The freeze.**

- These files are committed.
- The analytical predictions are then regenerated with

  ```
  npx tsx scripts/ub0-predictions.ts --inputs results/ub0/stage0/stage0_reference.json --label stage0
  ```

  This is gate G3. Its output, including k_s per N_c and the PQ3 band with propagated uncertainty, is the frozen prediction set for the UB-0 pre-registration.

## 9. Timestep contingency (A1 §4.3)

- Stage 0 runs at Courant 0.025.
- If the Universe B stability pilots later trigger the timestep rule, all Stage 0 runs are repeated at Courant 0.0125 with the same seeds. The inputs are then re-frozen before the pre-registration.

> **Notice added 2026-10-08.** This contingency is superseded by amendment A2 §1.8. Stage 0 is not repeated. Its data and its frozen mapping input K_T,A stand. Universe A's timestep dependence is checked, and the references matched to the N_c = 4 Courant numbers are measured, by the separate Stage 0b protocol (`CRITERIA_UB0_STAGE0B.md`). Stage 0b supplements Stage 0 and does not replace it.

## 10. Reproduction

```
npx tsx scripts/ub0-run.ts --plan stage0 --threads 4
npx tsx scripts/ub0-stage0-analysis.ts            # may list reserve runs needed (exit code 3)
npx tsx scripts/ub0-run.ts --plan stage0 --reserve --filter '<listed ids>'   # only if listed
npx tsx scripts/ub0-stage0-analysis.ts
```

Runs are deterministic per seed. A restarted runner resumes from mid-run checkpoints with a byte-identical continuation.
