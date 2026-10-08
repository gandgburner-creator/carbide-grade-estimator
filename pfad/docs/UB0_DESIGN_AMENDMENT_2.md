# UB-0 design amendment 2 (A2)

**Date:** 2026-10-08.

**What it amends:**
- the design review `docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md` (d068755), "the design";
- design amendment 1 `docs/UB0_DESIGN_AMENDMENT_1.md` (7b8e548), "A1";
- the draft pre-registration `docs/CRITERIA_UB0_COARSE_GRAINING.md` (3584597), which stays a DRAFT.

**Status.**

- Written after the D1–D3 decision review and before any further data of any kind.
- No Universe B pilot and no judged Universe B run exists. No Universe B observable has been computed outside unit and plumbing tests on design seeds.
- Every input to this amendment is one of:
  - Universe A data (Stage 0, frozen at 9c5d530);
  - the integrator implementation check (design seeds 9961+, energy ledger only; 2900d89);
  - analytical calculation.
- The design and A1 are not edited. Their text stays recoverable from git, and each rule A2 supersedes is quoted in this document before its replacement.
- Where A2 differs from the design or A1, A2 governs the UB-0 pre-registration.
- The Item 1, 2 and 3 classifications are untouched; Item 3 stays INCONCLUSIVE.
- The hypotheses H1–H5, the map's defining rules, the configurations' physics and every margin are unchanged (§11).

---

## 0. Three kinds of information, kept apart

| kind | what | may change |
|---|---|---|
| **Historical data** | Stage 0 (9c5d530), Items 1–3, the integrator check (2900d89), B0 (a84411a) | Nothing. Immutable. |
| **Pre-freeze design work** | A2; the Stage 0b protocol and its Universe A data; analytical recalculation; the power analysis; implementation tests | Numerical settings, seed counts, Universe A protocols, derived-constant errata, the *form* of a gate. Never in response to an anticipated Universe B outcome. |
| **Judged Universe B data** | runs at the approved pre-registration commit | Nothing except the pre-declared single extension. Prohibited until the pre-registration is frozen and explicitly approved. |

The blind stability pilots are pre-freeze, but they may change only what the pilot rule (§1.5) says.

---

## 1. D1 — the timestep strategy and the energy-drift gate

### 1.1 The rule that is superseded, preserved

**A1 §4.3, verbatim:**

> **Energy-drift gate.** This is design PQ7(b), applied to the energy-ledger residual over the measured window:
>   - shear and sound waves: ≤ 1 % of the initial wave energy;
>   - static boxes, wall box and Couette: ≤ 10⁻⁴ of the total energy.
>
> **Timestep rule.**
>   1. If any pilot exceeds its drift gate at Courant 0.025, **Courant 0.0125 is used throughout UB-0**:
>      - in all Universe B runs;
>      - in all Universe A reference and input runs, which are then repeated at 0.0125 with the same seeds and re-frozen before the pre-registration;
>      - the dt arm (PQ7d) moves to 0.00625.
>   2. If a pilot still exceeds its gate at 0.0125, **nothing changes automatically**. The conflict is reported for review.
>   3. **A halt in any pilot** is an implementation defect. It is reported, never absorbed into a criterion.

The design's PQ7 row (d068755 §6.2) set the same two limits and placed the dt arm at N_c = 16 (T16dt, PQ7c/d).

**Why it is superseded.** The integrator check (`results/ub0/implementation/drift_check.json`, 2900d89; implementation record §4) showed:

1. **The drift is secular and second order.** It grows linearly in time (residual ratio 60/30 D/σ_v ≈ 2) and falls as dt² (0.025 → 0.0125 ratio 2.8–4.8). It is concentrated at the stiffest kernel (N_c = 4, c_h = 2) and in wall boxes.
2. **An absolute limit lets the statistical window set the numerical tolerance.** The S-long window (4200 D/σ_v) fails at a timestep where S-K (500 D/σ_v) passes, with the same drift rate. The 10⁻⁴ figure has no derivation in the design; it appears only in the PQ7 row.
3. **Rule 1 halves everything at once.** It over-resolves run classes that pass by 40× and still fails the classes that need help (S-long N_c 4, the N_c 4 wall box and Couette fail at 0.0125 too). Rule 2 then hands the case to review. The pre-committed rule had reached its limit.
4. **A1's sound-wave gate is not meaningful.** The imposed energy of a small-amplitude standing wave is ≈ 0.001 kT per parcel. By the static drift rates (the sound runs were not in the check; this omission is disclosed in the decision review), L4's drift would be 60–80 % of its wave energy even at Courant 0.0125.
5. **The ω·dt stiffness condition (design §11.6) does not predict the drift.** N_c = 16 has ω·dt similar to N_c = 4 and ≈ 100× less drift.

### 1.2 The new gate

| drift class | runs | PQ7(b) statistic over the measured window | gate |
|---|---|---|---|
| **wave** | shear waves | \|ΔE\| / imposed wave energy | **≤ 1 %** (unchanged) |
| **rate** | static boxes, standing sound waves, wall boxes | \|ΔE/E\| per D/σ_v of measured window | **≤ 2 × 10⁻⁷ per D/σ_v** |

- **The rate gate is the design's own number.** 10⁻⁴ of the total energy over the S-K window of 500 D/σ_v is 2 × 10⁻⁷ per D/σ_v. Applied as a rate, it relaxes the absolute limit for windows longer than 500 D/σ_v, by up to 8.4× for S-long. That relaxation is made here explicitly, as a criterion amendment, with the bias bound below as its justification.
- **Shear waves keep their gate.** It is tied to the energy the wave dissipates (H4), which is the quantity the measurement uses.
- **Sound waves move to the rate gate.** They are near-equilibrium runs: the wave is a 2–4 % perturbation.

**What a drift at the gate does to the judged statistics** (analytical bound, decision review §D1):

| run class | what the drift affects | bias at the gate, relative to the expected CI |
|---|---|---|
| S-K (PQ2) | pressures are temperature-normalised and the φ central difference cancels a common drift | ≤ 1 % |
| S-long (PQ4) | the reservoir lags the kinetic heating, ≈ 4 × 10⁻⁵ in T_kin/T_int | ≈ 1 % |
| S-long (PQ5) | ΔT/T ≈ 1.6 × 10⁻³ over the window | ≈ 1 % |
| sound (PQ3) | δc/c ≈ 10⁻⁴ | ≪ 1 % |
| wall boxes | the Maxwell walls carry the heat away; interior ΔT ≈ 10⁻⁴ | negligible |

Even Courant 0.025 keeps every bias at or below 7 % of its CI. The timestep is therefore set by **numerical integrity and the exclusion risk**, not by the physics.

Implementation: `src/universeB/UB0Timestep.ts` (`gateLimit`, `driftStatistic`), used by `UB0Selection.checkRun` (judged exclusions) and `UB0Blind.pilotGate` (pilots).

### 1.3 The selection criterion and the assignment

**Rule.** Each comparability group (§1.4) runs at the **largest** Courant number in the ladder {0.025, 0.0125, 0.00625} at which **every member's drift is ≤ ¼ of its gate**.

- The drift is taken from the integrator check where it was measured at that Courant number. Otherwise it is extrapolated at second order from the finest measured Courant number.
- If no rung meets ¼ for a group, the group goes to review. Nothing is chosen automatically.
- **¼ rather than 1** leaves room for:
  - seed-to-seed variation (the check is one seed per case);
  - the irregular growth seen at N_c = 16 (60/30 ratio 13 at 0.025);
  - the full-length pilots, which must stay within ½ (§1.5).

**Evidence and proxies.** Each judged group reads one case of the check (`UB0Timestep.EVIDENCE`). Where the check had no matching case, a proxy is used:

| group | proxy | why it is adequate |
|---|---|---|
| L4, L16, L64 | the static box of the same N_c and c_h | same local stiffness; the wave adds 0.06–0.25 σ_v of flow |
| T4c4 | the N_c 4, c_h 2 shear wave | c_h 4 drifts ≈ 30× less in every static case, so the proxy is conservative |
| T16a05 | T16a1 × the measured N_c 4 ratio a0.5/a1 at the same Courant number | the wave energy is 4× smaller |
| T16e08, T16e095 | T16a1 | restitution enters the reservoir exchange, not the force integration |
| T64a1 | T16a1's rate over T64a1's own 705.7 D/σ_v window | drift falls with N_c in every measured family |

**Table 1.3 — the assignment** (`COURANT_ASSIGNMENT`). It is the output of `assignCourant` on the 2900d89 evidence, and a test asserts the equality.

| comparability group | members | Courant | largest member drift / gate at that Courant |
|---|---|---|---|
| **N4-static** | SK4c2p{18,20,22}, SK4c4p{18,20,22}, SL4, L4 | **0.00625** | 0.20 (SK4c2, L4; extrapolated) |
| **N4-shear** | T4a1, T4a05, T4c4 | **0.0125** | 0.18 (T4a05) |
| dt arm | T4dt | **0.00625** (half of N4-shear) | — |
| **W4c2** | W4c2 | **0.00625** | 0.15 (extrapolated) |
| **W4c4** | W4c4 | **0.0125** | 0.09 |
| **W16c2** | W16c2 | **0.0125** | 0.18 |
| N16-static | SK16c2p{18,20,22}, SL16, L16 | 0.025 | 0.03 |
| N16-shear | T16a1, T16a05, T16e08, T16e095 | 0.025 | 0.07 |
| N64-static | SK64c2p{18,20,22}, L64 | 0.025 | 0.002 |
| N64-shear | T64a1 | 0.025 | 0.12 |
| Universe A | all Stage 0 runs | 0.025 | ledger residual ≤ 10⁻⁹ (no force integration) |

Notes on the table:

- At 0.0125, SK4c2 is at 0.81 of its gate and SL4 at 0.60. So the N_c 4 near-equilibrium runs need 0.00625.
- SK4c4 drifts little, but it shares N4-static's Courant number because PQ6c compares it with SK4c2.
- W4c4 at 0.025 would pass the gate itself (0.35), but not ¼ of it.

### 1.4 Comparability, matched references and the dt arm

**Comparability rule.** Every set of runs that is compared or pooled within one primary shares one Courant number.

- The comparability groups of Table 1.3 are exactly the sets linked by the primaries:
  - PQ2, PQ3, PQ4, PQ5 and PQ6c(K) within N4-static;
  - PQ1, PQ6a, PQ6c(ν) and PQ8 within N4-shear;
  - and likewise at N_c 16 and 64.
- The wall boxes are judged one configuration at a time.
- W4c4 (a reported arm) runs at a different Courant number from W4c2. The two are compared only in a secondary report.
- Across N_c, each family is judged against its own references, each converged at its own Courant number.

**Matched Universe A references.** Where a primary compares Universe B with a Universe A reference, the reference is measured at the Universe B group's Courant number (Stage 0b).

| N_c | reference | Courant | source |
|---|---|---|---|
| 4 | ν_A (L 80 d) for PQ1.4 and pq1.arm | 0.0125 | Stage 0b T80a1c0125 |
| 4 | c_A (L 160 d) for the PQ3.4 band and L4's length | 0.00625 | Stage 0b L160c00625 |
| 4 | S_A (L 80 d) for PQ5.4 | 0.00625 | Stage 0b SLc00625 |
| 16 | ν_A, S_A, c_A | 0.025 | Stage 0 + Stage 0b, pooled |
| 64 | ν_A (L 160 d), c_A | 0.025 | Stage 0 + Stage 0b, pooled |
| all | **K_T,A** (PQ2, and the map) | 0.025 | **Stage 0, frozen**. The mapping input is never re-measured. Stage 0b checks it at 0.0125 and 0.00625 (protocol §5.3). |

**The dt arm moves from N_c = 16 to N_c = 4.**

- **Change.** The group is T4dt: identical to T4a1 except at half its Courant number (0.00625 against 0.0125). It replaces T16dt.
- **PQ7(c) and PQ7(d) are unchanged in definition and margin.**
  - (c): mean |drift|(dt) / mean |drift|(dt/2) ≥ 2.5, now T4a1 against T4dt.
  - (d): ν(dt/2)/ν(dt) ∈ [0.97, 1.03], now T4dt against T4a1.
- **Why.**
  - N_c = 4 is where the integration error is largest, so it is where a dt test can see something.
  - At N_c = 16 the drift is near its floor. The measured order there is 2.2 (static) and 15 (shear, irregular), so PQ7(c) could fail spuriously and void UB-0 (F0).
  - At N_c = 4 every measured order is 3.5–4.8.
- `PRIMARY_GROUPS.pq7d` is now ['T4dt', 'T4a1'], and `judge()` evaluates PQ7 there.

### 1.5 The pilot rule (replaces A1 §4.3 rules 1–2; rule 3 is kept)

The pilots are unchanged in form: one design-seed run of each judged configuration, full planned length, blind (A1 §4.3, M4). They now run at **their assigned Courant numbers**, after the final seed plan exists (§8).

1. **Pilot within ½ of its gate:** nothing changes.
2. **Pilot above ½ of its gate:** its **comparability group halves its Courant number once**.
   - The dt arm moves with N4-shear.
   - The group's pilots are repeated at the halved Courant number (round 2), with the same seeds.
3. **Above ½ again in round 2:** **review**. Nothing changes automatically.
4. **A halt, or any instrument defect** (PQ7a, PQ7e, lost events, a failure flag): **review** (A1 rule 3, kept).
5. **The dt-arm pilot pair** (T4a1, T4dt): drift ratio below 2.5 ⇒ **review**. A PQ7(c) failure would void the experiment, so it is checked before any judged run. The ratio is a numerical quantity, not physics.
6. **Halving and the references.**
   - If a halving moves a group with matched Universe A references to a Courant number Stage 0b did not measure, those references are measured there before the freeze, under the Stage 0b protocol's contingency (protocol §8).
   - Seed counts do not change with the Courant number: the noise basis is per-seed scatter (§3).

Implementation: `UB0Timestep.pilotDecision`, `scripts/ub0-pilots-eval.ts`. The A1 function `timestepDecision` is removed from the code.

### 1.6 Couette is deferred to UB-0W

- C4 and C16 are removed from the UB-0 plan, the pipeline and the analysis.
- **Why:**
  - Couette is wall **transport**, which the design already deferred to UB-0W.
  - It entered no UB-0 verdict (it was secondary, "reported only").
  - It is the run class with the hardest drift requirement (≈ 0.0066 at N_c 4 under the old gate).
- Universe A's Stage 0 Couette (C40, C80) stays recorded as historical data for UB-0W.

### 1.7 N_c = 64 shear is retained; the postponement rule is replaced

**The design's rule, verbatim (§12.4):**

> Pre-declared rule: if B0 puts the N_c = 64 T runs above 4 core-hours per seed, those runs are **postponed, not shrunk**. The bulk verdict then covers N_c ≤ 16, labelled "64 not run (cost)", distinct from F6.

**Why it is replaced.**

- The 4 core-hour threshold was a budget proxy for 6 seeds at one Courant number. A2 changes both:
  - the power plan sets T64a1's count (§3);
  - the timestep is now per group.
- As a per-seed number it no longer measures affordability. A numerical change elsewhere (A1 rule 1's "0.0125 throughout" would have doubled T64a1's cost to ≈ 6.4 core-h) could have triggered it without any change in what N_c = 64 costs.
- N_c = 64 is the only point near the bridging target (N_c ≈ 60). It carries PQ1.64, PQ8.64, F6 and F7(c). Its integration error is the smallest of all, so it stays at 0.025, at ≈ 3.2 core-h per seed (B0).

**The feasibility rule (replaces §12.4's threshold).** T64a1 is run in full at its powered seed count. It is **postponed — never shrunk** ("64 not run (infeasible)", distinct from F6) only if:

1. its stability pilot halts or shows an instrument defect that review does not resolve; or
2. its pilot-measured cost per seed exceeds **2 × the B0 projection** at its assigned Courant number. That would mean the cost model on which the UB-0 budget was approved is wrong by more than a factor of 2.

Separately, if the pilot-measured cost of the whole planned judged plan exceeds 1.5 × the committed projection, the case goes to **review**. No seed count is ever shrunk to fit a budget.

### 1.8 Stage 0 is not repeated

- A1 rule 1's "Universe A repeated at 0.0125 and re-frozen" is superseded with the rest of rule 1.
- **Why no repeat is needed:**
  - Universe A has no force-integration error: its ledger residual is ≤ 10⁻⁹.
  - The N_c 16 and 64 groups run at Stage 0's own Courant number.
  - The N_c 4 comparisons use matched references (§1.4).
- **What replaces it.** Stage 0b measures ν, c, S and K at 0.0125 and 0.00625 as a direct timestep check of Universe A (protocol §5).
- **K_T,A stays the frozen Stage 0 mapping input, so k_s is unchanged.**

---

## 2. D2 — the release fraction: a derivation erratum

**Classification.** This is a **correction of a derived constant to match its own definition**. It is an implementation and derivation erratum of the same class as the A1 §1.1 errata.

It is **not** a change to the physical hypothesis, to the A-16 release law, or to the map's defining rule. The design defines ρ_rel as "the equilibrium of A-16 at T_kin = T_int, given e" (§2, §2.3). The corrected value is that equilibrium.

**Why the correction is mathematically required.** A-16 as coded (`CollisionModel`; the A-16 wording was clarified from the code in b63e16e) does two things, in order, at each collision:

1. it deposits the inelastic loss (1 − e²)·½μv_n² into the pair's reservoirs;
2. **then** it releases the fraction ρ of E_i + E_j, **including that loss**.

With flux-weighted contacts, ⟨½μv_n²⟩ = kT_kin, and reservoirs at (N_c − 1)kT_int, the mean reservoir balance per collision is:

  inflow (1 − e²)kT_kin = outflow ρ·[2(N_c − 1)kT_int + (1 − e²)kT_kin]

  ⇔ T_kin/T_int = 2(N_c − 1)ρ / ((1 − e²)(1 − ρ)).

**T_kin = T_int ⇔ ρ = ρ\* = (1 − e²)/(2(N_c − 1) + 1 − e²).**

The design's ρ_rel = (1 − e²)/(2(N_c − 1)) assumed release from the pre-collision reservoir. Under the coded law it gives T_kin/T_int = 1/(1 − ρ_rel).

| N_c, e | design ρ_rel (superseded) | its T_kin/T_int | **ρ\* (A2)** | T_kin/T_int with ρ\* |
|---|---|---|---|---|
| 4, 0.9 | 0.03167 | **1.0327** (outside PQ4's [0.97, 1.03]) | **0.030695** | 1 |
| 16, 0.9 | 0.006333 | 1.0064 | **0.006293** | 1 |
| 64, 0.9 | 0.001508 | 1.0015 | **0.001506** | 1 |
| 16, 0.8 | 0.01200 | 1.0121 | **0.011858** | 1 |
| 16, 0.95 | 0.003250 | 1.0033 | **0.003239** | 1 |

Left as it was, the design would have predicted its own PQ4 FAIL at N_c = 4, hence F1 and an overall FAIL, from a slip in a derived constant.

**Verification** (`tests/universeB.release.test.ts`, `tests/universeB.predictions.test.ts`).

- **The real collider.** 20 000 synthetic flux-weighted collisions per case, at N_c 4 (e 0.9) and 16 (e 0.9, 0.8), with reservoirs at their mean, using the map's own ρ_rel:
  - release = ρ·(E_i + E_j + loss) to 10⁻¹²;
  - total energy conserved to 10⁻¹²;
  - release/loss = 1 to the sampling error (2 %): the balance holds at T_kin = T_int.
- **The superseded value** releases more than the loss at T_kin = T_int.
- **The map.** releaseFraction = ρ\* for every N_c ∈ {2, 4, 16, 64, 256} and e ∈ {0.8, 0.9, 0.95}, and the mean balance gives T_kin/T_int = 1 to 10⁻¹³.

**What changes.**

- `CoarseGrainMap.ts`: one line, plus `releaseFractionFor`.
- The analytical predictions:
  - the map header;
  - §1b, which now gives the predictions under ρ\* and keeps the superseded values only as an erratum record (`erratumA2.*` keys);
  - the review check: `map.rhoRel.{4,16,64}` are classified **ERRATUM (A2)**, whatever their size.
- Both prediction outputs are regenerated. Every output now carries a `map` marker, and the A2 freeze refuses any prediction file without it, so pre- and post-D2 outputs cannot be mixed (§7).
- A-21 and the analytical-record notice.

**What does not change.**

- **The PQ4 criterion** ([0.97, 1.03] and |a₂| ≤ 0.03). Its prediction of 1 is now the exact mean-field value, and PQ4 still tests it, because T_kin = T_int holds only in the mean.
- **Universe A and Stage 0** (ρ = 0 at N_c = 1).
- **The sound bands and every other prediction** (none uses ρ).
- **The run lengths and the frozen inputs.**

---

## 3. D3 — the pre-registered power design

### 3.1 Why

Stage 0 measured the per-seed scatter of the Universe A estimators the Universe B primaries reuse. It is ≈ 3× the design's analytic estimate for ν, and ≈ 10× for c.

| quantity | per-seed SD (Stage 0) | design §11.3 assumption |
|---|---|---|
| ν, L 80, U₀ = c_th | 10.6 % (n 94; robust 11.5 %) | 3.5 % |
| ν, L 80, U₀ = c_th/2 | 20.5 % (n 96) | 7 % |
| ν, L 160 | 5.0 % (n 12) | 1.75 % |
| c, L 160, amplitude 0.02 c | 4.8 % (n 15) | < 0.5 % |
| S, shell 1 / shell 2 | 7.2 % / 3.7 % (n 8) | — |
| wall gate G-W2 (Universe A) | 4.1 % (n 4) | — |

The noise is intrinsic, not an estimator artifact:

- ν's scatter is insensitive to the fit window (10.3–12.5 % for every window from [0.1, 0.5] to [0.1, 1.5] τ_D);
- the robust and classical SDs agree;
- it scales as 1/√N across box sizes.

The cause of c's scatter is not understood, which is why Stage 0b includes an amplitude study.

At the design's seed counts:

- PQ6a can essentially never PASS;
- PQ3 at N_c 16 and 64, PQ5, PQ1.64 and the wall gates are under-powered;
- the experiment could detect large failures but could not confirm H1–H3.

The bulk PASS requires PQ3 = P-INC at every N_c, while design §11.2 itself expected PQ3 INCONCLUSIVE at N_c 16 and 64. That internal inconsistency is resolved by powering PQ3.

**Correction of my review.** I stated that PQ5's Universe A floor limits it. That is wrong. The Universe A term enters PQ5 scaled by S_RPA/S_A: ≈ 0.25 at N_c 4 and ≈ 0.064 at N_c 16. The binding constraint is the Universe B seed count.

### 3.2 The estimator

Every estimator is unchanged. These are the committed functions in `UB0Estimators.ts` that Stage 0 used on Universe A and the judged analysis will use on Universe B:

- ν: the thermal-time shear-wave fit;
- c: the standing-wave velocity-mode fit;
- S(k) at the two lowest shells;
- K: the φ central difference of the temperature-normalised pressure;
- the wall gates G-W1–G-W3.

### 3.3 The variance estimate (the noise basis)

**Source.** Universe A only: Stage 0's used runs, pooled with Stage 0b's.

**Pooling.** The SD is pooled **within Courant cells**: s² = Σ(n_i − 1)s_i² / Σ(n_i − 1), with df = Σ(n_i − 1).

- A dt shift of the mean between cells cannot inflate it.
- Relative SDs are taken against each cell's own mean.

The cells are listed in `UB0Stage0b.cellKeys`.

**Transfer to Universe B.** The planning assumption is that Universe B's per-seed relative scatter equals Universe A's for the same estimator, in the same box (in its own units), at the same relative amplitude.

| quantity | basis for the transfer | risk |
|---|---|---|
| ν | Mode fluctuations are fixed by equipartition: σ_v√(2/N) in both universes at the same N. N_c drops out under the map. The 1/√N scaling is confirmed in Universe A (10.6 → 5.0 → 2.7 %). | low |
| c | Same N and the same amplitude as a fraction of c. If thermal noise dominates, Universe B's scatter is smaller, because c_B/σ_v is 1.4–5.7× c_A/c_th. | B's damping is unknown, so the assumption could err either way |
| S | Same N and the same 4200 D/σ_v window | mode correlation times differ; either way |
| K (P/T) | Universe A's absolute SD | not binding (K's CI is ≈ 10× inside its target) |
| wall gates | Same wall length and window | contact-layer structure differs; either way |

**No Universe A analogue, not powered:**

- PQ4 (T_kin/T_int, a₂): there is no reservoir at N_c = 1;
- PQ8: the occupancy share is 0 in Universe A;
- the wall statistic R: there is no occupancy deficit in Universe A.

These take the seeds their groups get from other primaries. If imprecise, they are INCONCLUSIVE, as A1 §4.2 accepted.

**No Universe B pilot scatter is used, ever** (A1 M4).

### 3.4 The uncertainty on the variance estimate

The SD is itself an estimate.

- The plan uses its **one-sided 80 % upper confidence bound**: s_plan = s·√(df/χ²₀.₂₀(df)), with the Wilson–Hilferty quantile (accurate to < 1 % for df ≥ 3, tested).
- At Stage 0's df the factors are:
  - 1.03 (df 93);
  - 1.25 (df 11);
  - 1.35 (df 7);
  - 1.72 (df 3).
- Stage 0b's larger df bring them to 1.03–1.13.
- The 95 % interval of each SD is also reported.

### 3.5 Targets, margins and the required n

**Target.** The expected 95 % CI half-width, computed with s_plan, is ≤ f × the margin half-width. For ratios the CI is on the log scale, and the binding side ln(1 + m) is used.

| primary | margin (unchanged) | f | configurations sized |
|---|---|---|---|
| PQ1 (ν_B/ν_A) | [0.90, 1.10] | **⅓** (design §11.2) | T4a1, T16a1, T64a1 |
| PQ2 (K_B/K_T,A) | [0.90, 1.10] | ⅓ | SK*c2p18/22 (floor binds) |
| PQ3 (Γ_self) | the judged interval (A1 §5) | **½** of its half-width | L4, L16, L64, given the SK counts |
| PQ5 (S_B/S_RPA, both shells) | [0.90, 1.10] | **½** | SL4, SL16 |
| PQ6a | [0.95, 1.05] | **½** | T{4,16}a1 : T{4,16}a05 = 1 : 2 (the design's ratio, ≈ the optimum s₂/s₁) |
| PQ6b | [0.95, 1.05] | **½** | T16e08, T16e095 (equal) |
| PQ6c | ν [0.93, 1.07]; K [0.90, 1.10] | **½** | T4c4 given T4a1; SK4c4 |
| wall gates G-W1/2/3 | ±1 %, ±3 %, ±2 % | **½** | W4c2, W16c2 |
| PQ7d | [0.97, 1.03] | not powered | T4dt: the design's 48 |

**Why these targets.**

- ⅓ is the design's rule. Lowering it to ½ for the expensive arms, PQ3, PQ5 and the gates **lowers the chance of PASS. It never raises the chance of a false PASS** (§3.6).
- At f = ½ an exactly equivalent result passes with probability ≈ 95 %; at f = ⅓, ≈ 99.9 %.
- PQ7d keeps its design role. Its FAIL voids (F0); its INCONCLUSIVE is a numerical caveat (design §11.2).
- The c_h 4 wall arm W4c4 is reported only and keeps 4 seeds.

**The required n** (`UB0Power.ts`). It is the smallest integer meeting the target, with t iterated with its Welch–Satterthwaite df:

- one Universe B group against the frozen Universe A reference variance F:
  t·√(s_plan²/n + F) ≤ target, i.e. n ≈ s²/((target/t)² − F);
- two Universe B arms with n₂ = r·n₁:
  n₁ ≈ (s₁² + s₂²/r)(t/target)², then n₂ is sized against n₁;
- PQ3: var(ln Γ) = 4 s_c²/n_L + var(ln K_B(k)), with the target taken at the judged interval's upper end;
- **floors:** never below the design count (4–96 per group);
- **infeasibility** (the reference term alone exceeds the target) stops the plan for review. It is never silently accepted.

A group's count is the maximum over the primaries that use it. They are resolved in order: SK → T4a1/T16a1 → the a05 arms → the e arms → T4c4 → T64a1 → SL → L → W.

### 3.6 False-PASS control

**First look.** The CI-inside-margin rule (design §6.1) is a two one-sided test at **2.5 % per side, for any n**:

- t-intervals, exact for normal per-seed data;
- Welch-approximate for two samples;
- log-scale delta method for ratios.

More seeds raise both P(PASS | equivalent) and P(FAIL | not equivalent). They do not bias either.

**With the single extension.** The 97.5 % second look adds at most 1.25 % per side. The union bound is **≤ 3.75 % per side** for an extended primary. The design's "Bonferroni over two looks" is stated precisely here; the rule itself is unchanged.

**Checked by simulation.** `UB0Power.falsePassMC` puts the true ratio exactly at the margin edge, uses the planned n and the reference term, and applies first look plus extension. It is reported in the power plan file and tested in `tests/universeB.power.test.ts`.

### 3.7 The extension rule

Unchanged: design §11.7 with implementation-record clarification 4.

- **Eligibility:** a primary that is INCONCLUSIVE with its point estimate inside its margin.
- **Scope:** one round. Every configuration entering an eligible primary is doubled from its reserve; only the extended primaries use the doubled data, at 97.5 %.
- **Reserves:** each group's block is 2n (§6), so the reserve also covers exclusions.
- **Cost:** with the larger counts the extension costs more. Its upper bound is reported (§3.8, §9 of the report).

### 3.8 The provisional result, and what Stage 0b must resolve

`results/ub0/power_plan_provisional.json` is the plan computed from **Stage 0 alone**, with every finer-Courant reference stood in by its 0.025 value. It is **not a seed allocation**: `UB0Plans.ub0Plan` refuses it.

It shows the order of the counts. The design counts are in brackets.

| groups | provisional | set by |
|---|---|---|
| T4a1, T16a1 | 238 [48] | PQ6a |
| T4a05, T16a05 | 476 [96] | PQ6a |
| T16e08, T16e095 | 168 [48] | PQ6b |
| T4c4 | 55 [24] | PQ6c-ν |
| T4dt | 48 [48] | design (not powered) |
| T64a1 | 1325 [6] | PQ1.64: dominated by Stage 0's 12-seed L 160 reference (1.44 % SE, df 11), which alone nearly exhausts the ⅓-margin target |
| SL4, SL16 | 20, 19 [4] | PQ5 shell 1 (df 7 ⇒ planning factor 1.35) |
| L4, L16, L64 | 17, 41, 74 [4] | PQ3 at amplitude 0.02 |
| W4c2, W16c2 | 88 [4] | G-W2 (df 3 ⇒ planning factor 1.72) |
| SK*, W4c4 | 8, 4 | design floors |

**Every count is unresolved until Stage 0b.** Stage 0b changes:

- every noise basis (more df);
- every matched reference (the finer-Courant ones exist only after it);
- the PQ3 judged intervals (c_A's precision and matched value);
- the sound amplitude.

**Stage 0b's own counts are fixed now**, sized so that the Universe A side is not the bottleneck:

- **T160a1 to 100.** This is the cost-optimal split for PQ1.64: a Universe A seed costs 0.07 core-h against 3.2 for a T64a1 seed, so the optimum is n_A ≈ 92 against n_B ≈ 14. With 100 reference seeds, T64a1 needs ≈ 14 seeds instead of ≈ 1300.
- **T80a1 to 200** at each of 0.025 and 0.0125. The A term is then ≈ 20 % of PQ1's variance budget.
- **SL and W40 to 32** each.
- **c to 32 per amplitude and per matched Courant number.**

**The final plan** (`results/ub0/power_plan.json`, status final) is generated after Stage 0b and the freeze, by the same code. The seed plan is generated from it (§6).

---

## 4. The exclusion rule (replaces "> 10 % excluded ⇒ F0")

**The design's rule** (§11.6, implementation-record clarification 3): "> 10 % of a configuration's examined runs excluded ⇒ F0 for that configuration".

- With 4 seeds, one exclusion is 20 %; with 8 seeds, 12.5 %.
- So one random instrument event in a group of 4–8 runs voided the whole bulk verdict.

**A2:** F0 only when **the excluded runs exceed max(1, 10 % of the runs examined)** (`UB0Selection.excessExclusions`).

**Why this keeps the rule's intent.**

- The intent is to detect a systematic problem: exclusions frequent enough that the surviving runs may be a selected subset.
  - For groups ≥ 10 runs it is unchanged (10 %).
  - For small groups, a second exclusion still voids.
- **A single excluded run is replaced from its reserve** (the design's own mechanism). Its replacement is an ordinary run of the same configuration. The only information a single exclusion carries is that an event of that kind can occur, and that is reported.
- The rule is decided before any observable (the automatic reasons are listed in criteria §9).

**Other F0 conditions are not weakened.** These remain unchanged:

- PQ7(c) FAIL;
- PQ7(d) FAIL;
- any unexplained late contact in an included run;
- for the wall verdict, a wall gate FAIL ⇒ VOID, and the same exclusion rule at W4c2/W16c2 ⇒ VOID.

---

## 5. Stage 0b (Universe A only)

`docs/CRITERIA_UB0_STAGE0B.md` is committed before any Stage 0b run, together with its code:

- `UB0Plans.stage0bPlan`;
- `UB0Stage0b.ts`;
- `scripts/ub0-stage0b-analysis.ts`;
- the runner plans `stage0b-1` and `stage0b-2`, which refuse to start unless the protocol is committed and the tree is clean.

It **supplements** Stage 0. Stage 0's runs, its reference values as recorded, and its frozen mapping input K_T,A are not modified.

It contains:

1. **More reference seeds**, with specs identical to Stage 0's so they pool:
   - T80a1 +106 (→ 200);
   - T160a1 +88 (→ 100);
   - SL +24 (→ 32);
   - W40 +28 (→ 32);
   - L160 at 0.02 c +17 (→ 32).
2. **The amplitude study.** 32 runs at 0.04 c, against the 32 at 0.02 c, both at Courant 0.025.
   - **Select 0.04 iff all three hold:**
     1. s_plan(0.04) ≤ 0.75 · s_plan(0.02);
     2. the 95 % CI of c(0.04)/c(0.02) contains 1;
     3. |c(0.04)/c(0.02) − 1| ≤ 1 %.
   - Otherwise keep 0.02.
   - The selected amplitude, as a fraction of each universe's own c, applies to the Universe B sound runs.
3. **Timestep checks and matched references** at 0.0125 and 0.00625:
   - T80a1: 200 at 0.0125, 100 at 0.00625;
   - SK18/22: 8 each at each Courant number;
   - SL: 16 at 0.00625;
   - L160 at the selected amplitude: 16 at 0.0125 and 32 at 0.00625 (phase 2).
4. **ν, K and c (and S) measured** at each Courant number.
   - **K must lie within ±1/30** (⅓ of PQ2's margin) of the frozen K_T,A, else review.
   - **ν, c and S:** review if their ratio to the 0.025 value lies entirely outside [0.97, 1.03].

Estimated cost: ≈ 38 core-h (B0 model).

---

## 6. Seed blocks

The blocks are regenerated from the power plan.

| block | seeds | rule |
|---|---|---|
| unit/plumbing tests, integrator check, B0 | 9001–9999 (never judged) | — |
| stability pilots | 9501 + group index (round 2 reuses them) | `pilotPlan` |
| Stage 0 (historical) | 10001–10424 | unchanged |
| **Stage 0b** | **11001–12382** | `stage0bPlan`: groups in protocol order, 2n each, allocated over both phases at once, so no seed depends on the amplitude decision |
| **UB-0 judged** | **20001 – (20000 + 2 Σn)** | `ub0Plan`: groups in the canonical order of `ub0Groups`, a contiguous block of 2n per group (planned, then reserve), counts from the FINAL power plan only |

Properties:

- **Deterministic:** the same inputs give the identical plan (tested).
- **Non-overlapping:** `assertDisjoint` runs in `scripts/ub0-power.ts` before the seed plan is written (tested).
- **Tied to a configuration:** each id is `<block>-<group>-<seed>`, and its spec is regenerated from the frozen inputs. A stored result with a different spec is refused by the runner and the analysis.
- **Documented and reproducible:** `results/ub0/seed_plan.json` records each group's planned and reserve ranges and the power-plan file that produced them.

---

## 7. Predictions and frozen inputs: the order, without mixing

**After D2 (now):**

1. The predictions are regenerated with the corrected map:
   - `results/ub0/predictions_review-inputs.*` (the design check, with the ERRATUM (A2) class);
   - `results/ub0/predictions_stage0.*` (the Stage 0 inputs).
2. Every output carries `map: { releaseFraction: ρ*, amendment: 'A2 (D2)' }`.
3. The values of record are checked against the code output. The superseded 0.0317 / 0.00633 appear only in erratum records.

**After Stage 0b:**

1. `scripts/ub0-stage0b-analysis.ts --final`: the matched references, the timestep checks, the noise basis, and `stage0b_reference.json` (with `cAByNc`).
2. `scripts/ub0-predictions.ts --inputs results/ub0/stage0b/stage0b_reference.json --label stage0b`. This regenerates the sound band and the PQ3 judged intervals per N_c (from each N_c's matched c_A), S_RPA and the rest.
3. `scripts/ub0-freeze.ts`: `frozen_inputs.json` in the A2 structure.
   - K_T,A is unchanged from Stage 0.
   - The file refuses a prediction file without the A2 marker, and refuses to freeze while a Stage 0b review is open.
4. `scripts/ub0-power.ts`: the final power plan and the seed plan.

The present `frozen_inputs.json` (f8cb934, Stage 0 G3) does not depend on ρ_rel. It stays as the historical Stage 0 freeze until step 3 replaces it. The A2 code refuses it for any plan.

---

## 8. Sequence, and when the pilots may run

1. A2 committed.
2. Implementation of D1–D3, the exclusion rule, the seed plan and the tests. Full suite green.
3. Predictions regenerated with ρ\*.
4. **Stage 0b protocol committed.**
5. **Stage 0b run** (Universe A only), then analysed. A review trigger stops the sequence here.
6. Predictions with the Stage 0b inputs; frozen inputs; final power plan; seed plan. All committed.
7. **Blind pilots**, under §1.5. The runner refuses them before step 6. A review trigger stops the sequence here.
8. The criteria document is completed and the DRAFT banner removed. Committed and tagged `ub0-prereg`.
9. Stop. The first judged run needs explicit approval of that commit (runner interlock).

---

## 9. Rules superseded by A2

| rule | where | replaced by |
|---|---|---|
| PQ7(b) static/wall/Couette ≤ 10⁻⁴ of the total energy | design §6.2, A1 §4.3 | the rate gate, 2 × 10⁻⁷ per D/σ_v (§1.2) |
| PQ7(b) for sound waves: ≤ 1 % of the wave energy | A1 §4.3 | the rate gate (§1.2) |
| one Courant number for all runs; "0.0125 throughout" | A1 §4.3 rule 1 | per-comparability-group Courant numbers (§1.3) |
| rule 2 "still over at 0.0125 ⇒ review" | A1 §4.3 | the ½-gate pilot rule (§1.5) |
| Stage 0 repeated at 0.0125 | A1 §4.3, Stage 0 protocol §9 | not repeated; Stage 0b timestep check (§1.8) |
| dt arm T16dt at N_c 16 | design §4.3, §6.2 | T4dt at N_c 4 (§1.4) |
| Couette C4, C16 (secondary) | design §4.3 | deferred to UB-0W (§1.6) |
| T64a1 postponed if > 4 core-h per seed | design §12.4 | the feasibility rule (§1.7) |
| ρ_rel = (1 − e²)/(2(N_c − 1)) | design §2, §2.3 | ρ\* (§2) |
| seed counts of the design | design §11.2 | the power plan, design counts as floors (§3) |
| "> 10 % excluded ⇒ F0" | design §11.6 | > max(1, 10 %) (§4) |
| judged block 20001–21196 | implementation record §3.3 | generated from the final power plan (§6) |
| "Bonferroni over two looks" | design §11.7 | stated precisely: ≤ 2.5 % / ≤ 3.75 % per side (§3.6); rule unchanged |

## 10. Hindsight audit (done before writing §1–§9)

**Check 1. No change may be chosen because it makes a pass more likely.**

- **D1.** The gate's value is the design's own. Its form follows from the drift being secular. The bias bound shows a drift at the gate cannot move a judged statistic by more than ≈ 7 % of its CI. The timestep choices tighten the integration where it is worst.
- **D2.** The correction is forced by the law's own algebra. It removes a predicted failure that had nothing to do with the hypothesis. It does not touch PQ4's margin.
- **D3.** The margins are unchanged. More seeds narrow the CI in both directions. Lowering the target fraction to ½ for some primaries lowers P(PASS); it does not change the false-PASS rate.
- **Clean.**

**Check 2. No Universe B data may have shaped any change.**

- None exists.
- The integrator check read the energy ledger only, on design seeds.
- The noise basis is Universe A.
- The pilots come after the seed plan, and the seed plan is generated before them.
- **Clean.**

**Check 3. The relaxations must be named.**

- The rate gate relaxes the absolute 10⁻⁴ for windows above 500 D/σ_v, by up to 8.4×. It is named in §1.2, with its bias bound.
- The ½ target is below the design's ⅓ for PQ6a–c, PQ3, PQ5 and the gates. It is named in §3.5.
- The postponement threshold is replaced (§1.7).
- The exclusion rule is relaxed for small groups only (§4).
- None changes a margin.
- **Clean.**

**Check 4. The historical record must stay recoverable.**

- Every superseded rule is quoted, or listed with its location (§1.1, §1.7, §2, §9).
- Stage 0 and the integrator check are not modified.
- **Clean.**

**Check 5. The proxies in the Courant assignment must be conservative or checked.**

- The c_h 4 and e-arm proxies are conservative.
- The sound proxies and the T64a1 window extrapolation are checked by the full-length pilots under the ½ rule before any judged run.
- **Clean, with the pilot check as the safeguard.**

**Check 6. Any assumption I made in the review that is wrong must be corrected.**

- The PQ5 floor (§3.1).
- The omission of the sound runs from the drift check (§1.1 item 4).
- Stage 0b's T160a1 count is re-derived here as the cost-optimal split for PQ1.64. The result, 100 seeds, is the review's figure (§3.8).
- **Done.**

## 11. What is unchanged

- The hypotheses H1–H5.
- The map's defining rules: M, D, E_int, k_s from K_T,A, h = c_h√N_c D, e, and "ρ_rel = the A-16 equilibrium at T_kin = T_int".
- The A-16 release law.
- Every margin and decision rule: PQ1–PQ8, the PQ3 band construction (A1 §5), W-MF and the wall gates' tolerances.
- F1–F7 and T-FAIL; F0's other triggers; the bulk verdict; the overall category; the separate wall verdict.
- The configurations' physics: boxes, windows, amplitudes as fractions of c, the e and c_h arms, and N_c ∈ {4, 16, 64}.
- The single extension and its 97.5 % level.
- Blinding (A1 M4) and the approval interlock.
- Stage 0's data and its frozen mapping input.
