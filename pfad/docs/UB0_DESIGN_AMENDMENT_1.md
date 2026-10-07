# UB-0 design amendment 1 (A1)

**Date:** 2026-10-07.

**What it amends:**
- the design review `docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md` (commit d068755), "the design";
- the Phase 1 analytical record (commit a7a1889, `docs/UB0_ANALYTICAL_PREDICTIONS.md`), "the Phase 1 record".

**Status.**

- This amendment is written before any Universe B simulation of any kind. No Universe B dynamics has been run, and no Universe B observable exists.
- Everything that prompted it is analytical: the deterministic calculation committed in a7a1889.
- The design is not edited in place. Its text, numbers and rules stay as committed in d068755, which keeps them recoverable from git. A dated notice at the top of that document points here.
- Where this amendment and the design differ, this amendment governs the UB-0 pre-registration.
- The Item 1, 2 and 3 classifications are untouched; Item 3 stays INCONCLUSIVE.

---

## 0. Correction of the scientific record: implementation status

The Universe B occupancy-force class with stress diagnostics has **not** been scientifically tested.

- A draft exists as implementation work outside the repository.
- The planned bit-identity test against the existing A-15 force model (`occupancy/OccupancyModel`) has **not** been run.
- No statement in any PFAD document or report should describe it as validated.
- It becomes testable only when committed together with that test (§10, implementation stage).

---

## 1. M1 — Errata

### 1.1 Three numerical values

| quantity | design (d068755) | authoritative (a7a1889) | cause |
|---|---|---|---|
| Γ_c = u(0)/kT, N_c = 64, c_h = 2 (design §2.4) | 3.7 | **3.647** | Double rounding when the design was written: 3.647 → 3.65 → 3.7. Γ_c is a closed formula, k_s a W(0)/kT, so there is no numerical-method difference. |
| u(D)/kT, N_c = 4, c_h = 2 (design §2.4) | 2.0 | **2.051** | Double rounding: 2.051 → 2.05 → 2.0. Closed formula k_s a W(D)/kT. |
| minimum Re_δ, N_c = 16, Ma = 0.3 (design §13) | 48 | **47.2** | The design rounded its inputs (c_A ≈ 2.2, a = ν/λ ≈ 1.44) instead of using 2.170 and 1.436. Closed formula N_c (Ma c_A)²/(ε a). |

None of the three enters a criterion, margin, configuration or seed count.

The only numerical-method differences between the design's working and a7a1889 are in the RPA coupling integrals (a wavenumber cutoff of 30/h versus 40/h, and the Bessel evaluation). Every integral-based value agreed at the printed precision.

**Authority.** From a7a1889 on, the committed analytical code and its output are the authoritative source of every predicted number:

- `src/universeB/Predictions.ts`
- `scripts/ub0-predictions.ts`
- `results/ub0/predictions_*.{txt,json}`

Numbers quoted in prose documents, the design included, are copies. Where a copy and the code output disagree, the output governs.

The values used in the pre-registration will be those regenerated with the Stage 0 Universe A inputs (gate G3). Those supersede the a7a1889 values too.

### 1.2 Terminology: "fundamental-measure"

The design (§9.3 and §15.2) named the weighted-density hard-core functional "(fundamental-measure)".

- **That was wrong** with respect to what was implemented.
- The calculation in a7a1889 is a **Nordholm-type smoothed-density approximation (SDA)**. Its features are listed in §3.
- **No fundamental-measure theory (FMT) has been implemented** anywhere in PFAD.

---

## 2. M2 — The wall rule

### 2.1 The original rule, preserved

Design §9.3 (d068755), verbatim, for the hard-core functional check:

> **INCONCLUSIVE-THEORY:** pre-declared before any data. It applies if, when the predictions are computed at gate G3, the local-density and a weighted-density (fundamental-measure) hard-core functional differ by more than 20 % in the integrated excess at either N_c. Then the prediction itself is not sharp enough to classify against.

The rest of the original classification is in the same section. It had four parts:

- instrumentation identities (wall pressure = core virial pressure within 1 %; contact theorem within 3 %);
- F5-impl:
  - (a) integrated excess within ±30 % of the canonical mean-field prediction;
  - (b) c_h-arm excess ratio in [1.6, 2.4];
  - (c) component stress profiles as predicted;
- the "unavoidable consequence" class;
- F5-phys: (a) or (b) fails decisively, or first-layer ordering ψ₆ > 0.5 where the mean field predicts a fluid.

**The rule was triggered.** a7a1889 (`results/ub0/predictions_review-inputs.txt`, §5) computed the integrated excess over [D/2, D/2 + 1.5h], canonical, H = 10h:

| case | LDA | SDA | difference |
|---|---|---|---|
| N_c = 4, c_h = 2 | 0.1282 | 0.1886 | **47.1 %** |
| N_c = 16, c_h = 2 | 0.1932 | 0.2466 | **27.7 %** |

(Values in units of n_b h.)

**Under the original rule the wall verdict would have been INCONCLUSIVE-THEORY, independently of any data.** This is recorded here and is not reversed retroactively. The amendment replaces the rule for the pre-registration that has not yet been written.

### 2.2 Why the original statistic could not be made sharp

The integrated density excess combines two different pieces of physics:

1. **The occupancy defect.**
   - There is no wall term in the occupancy sum, so the occupancy normal stress vanishes at the wall and recovers over ≈ h.
   - Its description is the mean-field closure. That closure is part of the coarse-graining hypothesis under test.
2. **Hard-core packing at a wall.**
   - This is the contact layer and its layering.
   - It is Universe A's own hard-disk physics, at parcel scale.
   - Predicting it requires an approximate hard-core density functional. That functional is not part of the coarse-graining hypothesis.

a7a1889 shows that the LDA–SDA disagreement originates in item 2, the contact layer. The rest of the profile also differs, because the contact layer's mass feeds back through the occupancy field.

| case | exact (contact theorem) | LDA | SDA |
|---|---|---|---|
| plain hard wall, no occupancy | 0.314 | 0.200 | 0.309 |
| N_c = 4 | 1.025 | 0.379 | 0.926 |
| N_c = 16 | 3.871 | 0.587 | 3.085 |

(Contact density as a φ-equivalent.) Any criterion on the excess therefore tests the approximate hard-core functional as much as Universe B.

### 2.3 Selection criterion

The replacement was chosen by a criterion stated before choosing:

> **A judged statistic must be predictable from (i) exact mechanics or (ii) the coarse-graining hypothesis's own closure. It must not depend on any approximate theory that lies outside the hypothesis.**

The same criterion already governs the bulk tests.

- PQ2 tests the mean-field closure directly.
- PQ3 normalises by Universe B's own measured modulus.
- No bulk primary depends on an external approximate theory.

Four options were considered against it:

| option | assessment |
|---|---|
| A — keep the rule | Satisfies the criterion trivially: it judges nothing. It gives up the only measurement that can characterise the dominant known defect. |
| B — the exact identities plus an LDA-to-SDA band | **Fails the criterion.** The band is built from two approximate hard-core functionals, one of which (LDA) is shown to be wrong at the wall. At N_c = 4 the band [LDA − 30 %, SDA + 30 %] = [0.090, 0.245] n_b h is about 2.7 times wide. The identities cannot falsify anything. |
| C — implement FMT and recompute | **Fails the criterion.** FMT is a better approximation for 2D disks but still approximate, and least reliable near freezing. The N_c = 16 contact layer is in that region. FMT belongs to UB-0W, where wall physics is the subject. |
| D — the mean-field occupancy-stress test (below) | **Satisfies it.** Exact identities plus a prediction made by the hypothesis's own closure from the measured density profile. No hard-core functional enters. |

**D was not chosen because it is expected to pass.** No prediction of its outcome beyond the mean-field value R = 1 exists. §8 sets out the reasons it can fail.

### 2.4 The new rule

**Configurations.** These are unchanged from the design:

- static wall boxes at N_c ∈ {4, 16} with c_h = 2, plus the N_c = 4, c_h = 4 arm;
- H = 10h, periodic width 40 D;
- Maxwell walls with Aw = 1 and kT_w = kT;
- 4 seeds each;
- N_c = 64 excluded (§2.5).

**Measured profiles.** Both walls are folded by symmetry where stated.

- n(y): parcel-centre density, in bins of width D/20 for y < D/2 + 2D and D/4 elsewhere.
- Normal stress P_yy(y₀) on planes y₀ = D/2 + p·D/4, by component:
  - occupancy: method of planes, Σ over pairs straddling y₀ of f|y_ij|/W, accumulated in the force loop;
  - collisional: method of planes from contact impulses;
  - kinetic: Σ M v_y²/(W Δy) in the D/20-wide bin containing y₀. This is a bin-density approximation of the plane value.
- P_wall: total normal impulse on both walls / (2 W t).

**Wall gates.** These are exact identities that check the measurement.

Each uses the CI rule of design §6.1: PASS if the CI is inside the tolerance; FAIL if it is entirely outside; INCONCLUSIVE otherwise.

| gate | statistic | tolerance | if FAIL |
|---|---|---|---|
| G-W1 | P_wall / (core total normal stress, mean over planes in [3h, H − 3h]) | [0.99, 1.01] | wall box F0 (void) |
| G-W2 | contact theorem n_contact kT_w / P_wall | [0.97, 1.03] | wall box F0 |
| G-W3 | total normal stress in the near-wall region (mean over planes in [D/2 + D/4, D/2 + 1.5h]) / P_wall | [0.98, 1.02] | wall box F0 |

- For G-W2, n_contact is a quadratic fit to the first three D/20 bins, extrapolated to y = D/2.
- G-W3 includes the requirement that the occupancy normal stress is zero at the contact plane and the parcel-contact stress carries P_wall there. Both are mechanical identities.
- G-W3's tolerance is twice G-W1's, because its kinetic term is a bin approximation. The 1 % and 3 % tolerances are the design's (§9.3).

**The wall test, W-MF.** This is a mean-field occupancy-stress comparison with no hard-core functional.

- **Mean-field prediction from the measured density.** For each seed, compute
  P^occ_MF[n](y₀) = Σ_{j: y_j < y₀} Σ_{l: y_l > y₀} n_j n_l Δ_j Δ_l g(y_l − y_j),
  where g(s) = ∫ dx F_y(x, s) is the y-force between two parcels at offset (x, s), integrated along x. It uses the Lucy pair force with the frozen k_s and h.
- In the continuum limit, for a uniform density, this reduces exactly to ½ k_s a n², the bulk closure. The discretised sum is checked against this limit by a unit test.
- Since k_s multiplies both the measured and the predicted occupancy stress, the statistic below does not depend on k_s, or on the Universe A input that fixes it.
- **Core normalisation.** Ĉ_meas and Ĉ_MF are the means of P^occ_meas and P^occ_MF over planes in [3h, H − 3h]. This removes the bulk mean-field bias, which PQ2 tests separately.
- **Deficit integrals** over planes y₀ ∈ [D/2, D/2 + 1.5h]:
  Δ_meas = Σ (Ĉ_meas − P^occ_meas(y₀))·(D/4), and Δ_MF likewise.
- **Statistic:** R = (Δ_meas/Ĉ_meas) / (Δ_MF/Ĉ_MF), one value per seed (both walls averaged).
- **Margin:** R ∈ [0.90, 1.10]. Its origin is given in §8, check 2.

**Wall verdict.** This is separate from the bulk verdict and never part of it.

| verdict | condition |
|---|---|
| VOID | any wall gate FAILs at the configuration in question |
| **F5-impl** | the R CI lies inside [0.90, 1.10] at both N_c = 4 and N_c = 16 (c_h = 2), and no gate FAILs |
| **F5-phys** | the R CI lies entirely outside [0.90, 1.10] at N_c = 4 or N_c = 16 (c_h = 2) |
| INCONCLUSIVE | otherwise |

Gates that are INCONCLUSIVE but not FAILing are reported as caveats.

**What the verdicts mean.**

- **F5-impl:** the baseline wall defect is the missing wall contribution to the occupancy sum, described by the mean-field closure given the actual near-wall density.
  - A mean-field wall term derived from the same closure is then a justified candidate for UB-0W.
  - That term is tested only in UB-0W, never in UB-0.
- **F5-phys:** near-wall occupancy stress is not described by the mean field of the measured density.
  - Correlations in the dense contact layer matter.
  - UB-0W cannot assume a mean-field wall term suffices.

**The c_h = 4 arm.** R is reported as a secondary result, not part of the verdict. It shows whether a failure depends on the coupling strength.

**Report only.** These are never judged:

- the density excess against the LDA and SDA predictions (canonical, run geometry);
- the density profile against both functionals;
- the excess ratio between the c_h arms (functional-dependent: LDA 1.98, SDA 1.71 at N_c = 4);
- first-layer ψ₆;
- residual structure within 2D of the wall compared with Universe A's own wall profile;
- R per plane group;
- the bulk ratio Ĉ_meas/Ĉ_MF;
- Couette.

**Removed from the judged rule, with reasons:**

| removed item | reason |
|---|---|
| (a) the ±30 % excess criterion | functional-dependent (§2.2) |
| (b) the c_h-ratio criterion | functional-dependent |
| the ψ₆ > 0.5 ordering trigger | it relied on the LDA contact value 0.38. Wall-induced layering in hard disks below bulk melting is ordinary hard-disk physics that no closure in the hypothesis predicts |
| the "unavoidable consequence" class | needs a hard-core functional to subtract |

The rule's separation from the bulk verdict is unchanged. Wall transport, slip and wall heat transfer remain deferred to UB-0W.

### 2.5 N_c = 64 stays out of the wall tests, on a regime argument only

The reason is the physical regime, independent of any hard-core functional.

- **The mechanics.** At the wall the occupancy normal stress is zero, so the parcel-contact (hard-core) normal stress equals the bulk pressure P_B. This is exact.
- **In parcel units:** βP_B D² = (P_B / n_p kT) · n_p D² = 1.31, 4.93 and 19.4 for N_c = 4, 16 and 64. P_B is the mean-field bulk pressure from a7a1889.
- **External comparison:** the hard-disk liquid–hexatic transition pressure is βPσ² ≈ 9.2 (Bernard & Krauth 2011).

Conclusion:

- At N_c = 64 the contact layer is compressed above the bulk melting pressure, so an ordered layer is expected. The mean-field occupancy-stress test presumes a fluid layer and is ill-posed there.
- At N_c ≤ 16 the contact pressure is below melting.

**Robustness and approximations.**

- The conclusion holds for any error in the mean-field P_B smaller than a factor of 2.
- Approximation: it treats the anisotropic near-wall stress as if it were an isotropic pressure.
- The design also cited cost and the LDA contact value 0.77. Neither is relied on any more.

---

## 3. M3 — The weighted-density calculation: what it is

`src/universeB/Predictions.ts`, `wallProfile(..., functional: 'SDA')`, is:

- **a Nordholm-type smoothed-density approximation** for hard disks:
  - the excess free energy per particle is evaluated at a density smoothed with a uniform disk weight of radius D (the parcel diameter);
  - it uses the Henderson 2D equation of state (an EXTERNAL benchmark);
- combined with the mean-field occupancy potential, in planar geometry;
- solved in the canonical ensemble at the run geometry.

It is **not** fundamental-measure theory, and it is **not** part of Universe B.

- It is a theory tool used only to show that the LDA is unreliable at the contact layer. It was checked against the exact contact theorem: 0.309 against 0.314 at a plain hard wall.
- Under the new wall rule (§2.4) it enters **no** judged statistic. It never enters the Universe B dynamics.
- It stays fixed as a documented limitation. FMT is not required for UB-0. It may be needed in UB-0W.

---

## 4. M4 — No Universe B pilot result may shape the design

### 4.1 Withdrawn from the design

The design allowed blind Universe B pilots to record "seed-to-seed standard errors with central values suppressed" (§11.7). It also allowed "run lengths … fixed from blind SE-only pilots" (§6.2 PQ2, §11.2, §15.2 G4).

**These provisions are withdrawn.** Universe B scatter would have shaped the design. Even with central values hidden, that is a Universe B observable influencing a design choice.

### 4.2 Every judged quantity fixed in advance

All are fixed from Universe A inputs, theory and the rules below. None depends on any Universe B pilot.

| item | rule |
|---|---|
| seed counts | design §11.2, unchanged; set by the analytic noise estimate √(2/N) and the ⅓-margin rule |
| shear-wave run | preparation 100 D/σ_v; single rescale; settle 20 D/σ_v; impose the wave; run to t = 1.5 τ_D; sample every 0.5 D/σ_v |
| shear-wave fit | window s ∈ [0.1 τ_D, min(1.5 τ_D, s(t_end))] in thermal time s (s ≥ t, because viscous heating only raises T_kin) |
| τ_D (design time scale) | 1/(ν_D k²), with ν_D = 1.379 (Item 1's φ = 0.2 value μ = 0.351, ν = μ/ρ). In parcel units it is the same number at every N_c. It is fixed now, so no run length, Universe A's included, depends on a Stage 0 result. It replaces the design's "τ_A from Stage 0", which would have made the Universe A runs' own length depend on their own output. |
| standing-wave run | preparation and settle as above; then 2 settling periods + 12 measured periods |
| standing-wave period | L / c_lo. For Universe B, c_lo is the lower edge of the G3 c_B band (computed from Universe A inputs). For Universe A, it is the lower 95 % limit of Item 2's c₀ (2.094). |
| static boxes (S-K) | preparation as above; measure 500 D/σ_v |
| long static (S-long) | measure 4200 D/σ_v |
| wall box | relax 640 D/σ_v; measure 2000 D/σ_v |
| Couette | develop 3 H²/ν_D; measure 3000 D/σ_v |
| sample intervals | 0.5 D/σ_v (waves); 1 D/σ_v (statics, wall box) |
| margins, tolerances, configurations | as in the design and this amendment |

If a Universe B precision proves insufficient, the primary is INCONCLUSIVE. That risk is accepted.

### 4.3 Stability pilots: the only permitted use, and the timestep rule

This rule is committed before any pilot runs.

- **Pilots.** One design-seed run (seeds 9501–9999) of each Universe B judged configuration, at the baseline Courant number 0.025, for its full planned length. The frozen k_s from G3 is used.
- **Recorded:** wall-clock timing (feeds B0), ledgers, energy drift, halts, safety flags. No physics observable is computed, printed or stored.
- **Energy-drift gate.** This is design PQ7(b), applied to the energy-ledger residual over the measured window:
  - shear and sound waves: ≤ 1 % of the initial wave energy;
  - static boxes, wall box and Couette: ≤ 10⁻⁴ of the total energy.
- **Timestep rule.**
  1. If any pilot exceeds its drift gate at Courant 0.025, **Courant 0.0125 is used throughout UB-0**:
     - in all Universe B runs;
     - in all Universe A reference and input runs, which are then repeated at 0.0125 with the same seeds and re-frozen before the pre-registration;
     - the dt arm (PQ7d) moves to 0.00625.
  2. If a pilot still exceeds its gate at 0.0125, **nothing changes automatically**. The conflict is reported for review.
  3. **A halt in any pilot** is an implementation defect. It is reported, never absorbed into a criterion.
- **Nothing else** from a pilot may change a seed count, run length, precision target, margin or configuration.

---

## 5. M5 — Propagating Universe A uncertainties

**Stage 0 values.** Each is frozen as a value, a standard error and degrees of freedom:

- K_T,A (static boxes, central difference over φ = 0.18 and 0.22);
- c_A (standing wave, L = 160 d);
- S_A(k) at the run's shells.

Item 2's c₀ = 2.170 ± 0.038 is a cross-check only.

**PQ2: K_B/K_T,A.**

- SE²(ln ratio) = (SE_KB/K_B)² + (SE_KA/K_A)². Degrees of freedom by Welch–Satterthwaite.
- The **full** Universe A SE is added in quadrature.
- The actual sensitivity of the ratio to an error in K_T,A is only about 1/N_c, because K_T,A also fixes k_s. Using the full SE deliberately overstates the uncertainty. It never understates it.

**PQ3: the Γ_self band.**

- Γ_A = ρ c_A²/K_T,A, with SE(Γ_A)/Γ_A = √(4 (SE_c/c)² + (SE_K/K)²) (delta method). Δ_A = Γ_A − 1.
- The band edges use the 95 % limits of Δ_A:
  - lower edge 1 + Δ_A,lo/N_c²;
  - upper edge 1 + Δ_A,hi/N_c;
  - Δ_A,lo/hi = Δ_A ∓ t₀.₉₇₅ SE(Δ_A).
- The ±0.05 tolerance is then added outside them.
- **P-INC** if the Γ_self CI lies inside [lower − 0.05, upper + 0.05]. **T-FAIL** if it lies entirely outside.
- The Γ_self CI includes the uncertainties of both c_B and K_B.

**PQ5: S_B(k)/S_RPA(k).** The SE of S_RPA, propagated from S_A(k), is added in quadrature.

**PQ1: ν_B/ν_A.** Unchanged: a Welch interval with the Universe A seeds, as designed.

**Secondary predictions** (Z_B/Z_A, the c_B/c_A band) are reported with their propagated uncertainties.

---

## 6. M6 — The Universe A Stage 0 protocol

A separate document, `docs/CRITERIA_UB0_STAGE0.md`, is required. It must be committed **before** any Stage 0 run, together with the estimator code it references.

It must state:

1. **The mapping input.** Only one Universe A measurement enters the Universe B mapping: the isothermal modulus K_T,A, which fixes k_s. Nothing else measured in Stage 0 may change any Universe B parameter.
2. **Comparison references.** These are targets, never inputs. A reference may define a prediction or an acceptance band (for example, c_A in the Γ_self band). It may never set a Universe B model parameter. The references are:
   - ν_A at L = 80, 160 and 320 d;
   - c_A and Γ_A;
   - S_A(k);
   - Z_A(0.2);
   - the collision rate and λ_A;
   - the Universe A wall-box profile;
   - Universe A Couette.
3. **Run specification.** Configurations, the seed block 8001–8199, run lengths, estimators, precision targets, quality gates, one pre-declared extension rule, and the frozen output file (value, SE, df).
4. **No pass/fail on Universe A physics.** Universe A is the reference. Only quality gates apply: ledgers, halts, exclusions.
5. **The Courant contingency** of §4.3.

---

## 7. M7 — Disclosures

1. **Where c_h = 2 came from.**
   - The kernel rule h/D ≳ 2√N_c first appeared in the scale-bridging review (85f0ec5, §4 item 4).
   - There it was derived from a coupling estimate that took the occupancy energy per parcel as ≈ Mc²/1.39.
   - The factor 1.39 is Item 2's occupancy-force calibration, c² = 1.393 k_s φ/m + 0.13, measured at kT = 0.05 with collisions off (EXPERIMENT_LOG §5.2). That is a measurement on an occupancy-force system, i.e. a Universe-B-type observable.
   - The UB-0 design (d068755, §2.4) re-derived c_h = 2 by an RPA estimate using only Universe A inputs, plus cost. That is the justification the pre-registration relies on.
   - The number 2 was nevertheless first proposed on the earlier basis. c_h = 2 is the harsher (stronger-coupling) setting, and the c_h = 4 arm brackets it.
2. **The heating-correction assumption.**
   - The shear-wave estimator rescales time by √(T_kin(t)/T₀), i.e. it assumes ν ∝ √T_kin.
   - This is exact in Universe A (hard-disk scale invariance).
   - It is approximate in Universe B, because the occupancy force is athermal. The estimated bias is ≲ 0.6 % (design §5, ESTIMATE).
   - The uncorrected estimate is always reported alongside.
3. **External equations of state and benchmarks.**
   - The Henderson hard-disk equation of state is used only in:
     - the LDA and SDA wall curves, which are report-only (§2.4);
     - the pre-Stage-0 placeholder values, which Stage 0 replaces.
   - The hard-disk melting pressure (Bernard & Krauth) is used only in the N_c = 64 regime argument (§2.5).
   - Neither enters a judged statistic.
4. **Reservoir heat conduction is not tested in UB-0.**
   - The reservoir carries N_c − 1 of each parcel's heat capacity. Its heat moves only by parcel motion and the A-16 exchange.
   - Its effective conductivity is a property of a phenomenological rate law and is untested.
   - The same law sets the exchange rate, which affects sound attenuation and where Γ_self falls inside its band. The band covers both exchange limits for exactly this reason.
   - This is named as phenomenological, not emergent.

---

## 8. Hindsight audit (done before writing §2–§7)

**Check 1. The new wall test must not be chosen because it is expected to pass.**

- D was selected by the criterion of §2.3, which was formulated before choosing.
- No quantitative expectation of R exists beyond its mean-field value of 1.
- There are concrete reasons it can fail:
  - The bulk mean-field error is O(1/N_nb), about 8 % at N_c = 4.
  - At the wall the occupancy field is built from about half as many neighbours. The wall-specific error may therefore be about twice the bulk error, which would be about the margin at N_c = 4.
  - At N_c = 16 the contact layer is dense (βP D² ≈ 4.9; smoothed-density contact φ-equivalent ≈ 3). Correlations there are strong.
- An F5-phys outcome is plausible. **Clean.**

**Check 2. The ±10 % margin must have an independent origin.**

- It is the margin the design already set for the bulk pressure closure (PQ2, d068755 §6.2). That margin came from the precision at which Items 1 and 2 stated their Universe A references.
- It was not chosen from any wall calculation, any estimate of R or any data.
- Using the bulk closure's tolerance for the same closure at the wall is the consistent choice. **Clean.**

**Check 3. The N_c = 64 exclusion must rest only on the regime argument.**

- §2.5 rests it on the exact wall stress balance plus the external melting pressure, with a factor-of-2 margin.
- Cost and the LDA contact value are explicitly no longer relied on. **Clean.**

**Check 4. No Universe B simulation result may influence the amended criteria.**

- None exists. No Universe B dynamics has been run.
- W-MF does use the measured Universe B density profile at analysis time, but as the *input to a conditional prediction*: given n(y), the closure predicts P^occ. The rule, the margin and the statistic are fixed now.
- k_s cancels in R. **Clean.**

**Check 5. The old rule and its trigger must remain recoverable.**

- The rule is in d068755 (§9.3) and is quoted verbatim in §2.1.
- The trigger computation is in a7a1889 (`results/ub0/predictions_review-inputs.txt`, §5) and is quoted in §2.1.
- The design is not edited in place. **Clean.**

**Further checks.**

- **M5 always errs toward wider intervals.** That makes both PASS and FAIL harder, never easier.
- **M4 removes a channel by which Universe B could shape the design.** It adds none.
- **The pilot timestep rule is fixed here,** before any pilot exists.
- **Remaining approximations in the new rule are disclosed:**
  - G-W3 uses a bin-density kinetic stress at D/20 resolution;
  - G-W2 depends on the stated contact extrapolation;
  - §2.5 treats the anisotropic wall stress as isotropic.

No check failed, so A1 is committed.

---

## 9. What is unchanged

- The hypothesis H1–H4.
- The bulk primaries PQ1–PQ8, their margins and decision rules, except the uncertainty propagation in §5.
- The failure modes F0–F4, F6, F7 and T-FAIL.
- The configurations, the N_c set, the kernel rule and its arm, and the seed counts.
- The philosophy lines L1–L4.
- That the wall verdict never enters the bulk verdict.
- That wall transport and heat transfer are deferred to UB-0W.

## 10. Sequence after A1

1. **Analytical record.** Add the mean-field occupancy-stress functional P^occ_MF[n] with its bulk-limit test, and the βP_B D² versus melting-pressure table. Reclassify the three values of §1.1 as acknowledged errata in the review check. Commit.
2. **`docs/CRITERIA_UB0_STAGE0.md`** (§6), committed **together with the shared measurement code** it references.
   - That code is the N_c-generic run classes and estimators, which the Universe B runs will reuse, so that Universe A and Universe B are measured by identical code.
   - It includes the reduction test N_c = 1 ≡ Universe A engine, byte-identical checkpoint/resume, and synthetic-data tests of every estimator.
3. **Run Stage 0** (Universe A only).
4. **Freeze the Stage 0 values.** Regenerate the predictions (G3).
5. **Universe B completion.**
   - The occupancy force with diagnostics, plus its bit-identity test.
   - The F-rule and W-MF analysis code with synthetic tests.
   - B0 and the stability pilots under §4.3.
6. **Final pre-registration**, committed and frozen.
7. **Stop and report.** No judged Universe B data before approval.
