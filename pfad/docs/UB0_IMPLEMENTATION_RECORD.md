# UB-0 implementation record (before any Universe B pilot or judged run)

**Status.** Implementation and testing only. No Universe B pilot and no judged
Universe B run has been made. No Universe B physics observable has been
computed outside unit and plumbing tests on miniature boxes at design seeds
(9001–9999), and none of those values is printed, stored or used.

It records:

- what was built;
- the safeguards and how each is tested;
- implementation findings;
- the clarifications made in turning design rules into code;
- **two open items that need a decision before the pre-registration can be frozen** (§4: the energy-drift gate; §5: the release fraction ρ_rel).

Sources: the design review (`REVIEW_UB0_PREREGISTRATION_DESIGN.md`, d068755), amendment A1 (`UB0_DESIGN_AMENDMENT_1.md`, 7b8e548), the Stage 0 protocol (`CRITERIA_UB0_STAGE0.md`, f0bd9bc).

---

## 1. What was built

| commit | content |
|---|---|
| f0bd9bc | shared instrument (`UB0Run`, estimators, exact checkpoint state), Stage 0 plan and protocol |
| 2d4b3f7 | Universe B plan, decision rules, selection, analysis pipeline, blind pilot records, B0 and pilot scripts, approval interlock, ω·dt diagnostic, model p0.5 (walls under forces) |

**Universe B code (all in `src/universeB/` unless stated).**

| file | role |
|---|---|
| `UB0Plans.ts` | judged groups (design §4.3, §11.2; A1 §2.4, §4.2), seed blocks, the blind pilot plan |
| `UB0Analysis.ts` | PQ1–PQ8, equivalence rule, F0–F6, bulk verdict, overall category, wall gates and the wall verdict |
| `UB0Judged.ts` | per-run estimates → outcomes; `finalize()`; per-primary overrides |
| `UB0Selection.ts` | exclusions, reserves, > 10 % rule, the extension, run-halves stationarity |
| `UB0Pipeline.ts` | records → verdicts, the F7 forecast |
| `UB0Blind.ts` | the whitelisted pilot record, pilot drift gates, the timestep rule as a pure function |
| `scripts/ub0-analysis.ts` | the judged analysis (run only after approval) |
| `scripts/ub0-b0.ts`, `scripts/ub0-pilots-eval.ts`, `scripts/ub0-freeze.ts`, `scripts/ub0-drift-check.ts` | B0, pilot evaluation, frozen inputs, integrator check |

## 2. Safeguards and their tests

| safeguard | how | test |
|---|---|---|
| N_c = 1 is Universe A exactly | same run code; no force, no reservoir, e = 1 | `universeB.instrument.test.ts`: trajectories bit-identical to the Universe A engine |
| UB-0 occupancy force = A-15 | line-for-line copy plus a read-only diagnostic pass | `universeB.occupancy.test.ts`: forces and potential bit-identical; the diagnostic pass leaves forces untouched |
| byte-identical checkpoint/resume | exact state capture (typed arrays as raw bytes) | `universeB.instrument.test.ts`: all five run kinds and the runner |
| every estimator on synthetic data | known decay rates, frequencies, profiles | `universeB.estimators.test.ts`, `universeB.stage0.test.ts`, `universeB.wallstress.test.ts` |
| every F-rule and verdict on synthetic data | constructed outcome sets | `universeB.analysis.test.ts`, `universeB.judged.test.ts`, `universeB.selection.test.ts` |
| design G1 tests (2)–(7) | release-law mean balance on synthetic collisions; occupancy virial vs analytic two-body and lattice sums; Fourier projection on a constructed field; contact theorem in a wall box; ledger closure with occupancy, reservoir and walls; resume at N_c > 1 | `universeB.release.test.ts`, `universeB.g1.test.ts` |
| the whole judged chain runs | miniature versions of all 31 judged groups at design seeds 9601+ | `universeB.pipeline.test.ts` (asserts plumbing only, never a value) |
| pilots are blind | `observables: false` (no sampling, no tallies) **and** a whitelisted stored record | `universeB.blind.test.ts` |
| the timestep rule is fixed before any pilot | `timestepDecision()` encodes A1 §4.3 | `universeB.blind.test.ts` |
| no judged run without approval | `ub0-run.ts --plan ub0` refuses unless `--approved-commit` equals HEAD on a clean tree | — |
| timing is not data | wall-clock appears only in `timing`/`seconds` fields and `timings.log`; every comparison strips it | `universeB.instrument.test.ts` |

**The pilot record.** With `observables: false`, a run takes no samples. Its full record would still carry physics in passing:

- per-wall impulse and heat totals (wall pressure, temperature jump);
- the one-off rescale factors (T_kin and T_int, the PQ4 quantity);
- collision counts (contact density);
- step counts and E0 (the mean timestep reveals the speed tail, i.e. T_kin).

So a pilot stores only:

- residual ratios (energy over E0 or over the wave energy; momentum over N M σ_v);
- unexplained late contacts, maximum overlap and safety flags;
- seconds per phase.

B0 records the mean timestep at N_c = 1 only, for the same reason.

## 3. Implementation findings

### 3.1 Plane walls under forces (model p0.5) — fixed

Pair collisions have been evaluated at the contact instant since p0.2. Plane walls were not: they used the stored half-step velocity, which leaves a first-order energy error F·Δv·(dt/2 − τ) per wall event.

Measured on a particle under a uniform force bouncing on a wall for 200 time units:

| | dt = 0.02 | 0.01 | 0.005 | 0.0025 |
|---|---|---|---|---|
| before | 3.3 × 10⁻² | 9.1 × 10⁻³ | 2.7 × 10⁻³ | 3.2 × 10⁻³ |
| after | ≤ 2 × 10⁻¹³ | | | |

- The fix mirrors p0.2 exactly.
- Without forces the operations are unchanged, so every Universe A record (Items 1–3, Stage 0) replays bit for bit. The full suite passes.
- Details: `MODEL_CHANGELOG.md` (p0.5), `tests/walls.forces.test.ts`.

### 3.2 Occupancy stiffness ω·dt — implemented, within the design limit

- Design §11.6 requires max ω·dt ≤ 0.02 on sample steps. It was listed but not instrumented.
- It is now computed on every sample step at N_c > 1, from the analytic Hessian of the Lucy pair potential (checked against the finite-difference force Jacobian to 10⁻⁶).
- In the integrator check (§4), end-of-run values are 0.0039–0.0145 at Courant 0.025 and 0.0025–0.0080 at 0.0125. All are inside 0.02.

### 3.3 Seed blocks

The design's judged block 8201–8999 (799 seeds) cannot hold the judged plan: 598 planned + 598 reserve = **1196** seeds. The judged block is therefore **20001–21196**.

This is a numbering change made before any run, like the Stage 0 change (8001–8199 → 10001–10424). It changes no count and no configuration.

| block | seeds |
|---|---|
| Stage 0 | 10001–10424 |
| pilots | 9501–9531 |
| B0 | 9901+ |
| unit and plumbing tests, integrator check | 9001–9999, never judged |

### 3.4 Code audit against L1 (design §14), and the assumption register

**The audit.** No transport coefficient or transport operator enters the Universe B dynamics.

- **Code searched:** the map, the occupancy force, the run set-up, the integrator, the collider and the walls. The search covered viscosity, conductivity and diffusivity, ν, μ as an input, gradients and Laplacians of fields, and Navier–Stokes terms.
- **Matches:** only the reduced mass μ in the collision law, and a comment stating that Aw is not a viscosity.
- **Where ν_D does appear:** only in `UB0Plans` (run lengths, A1 §4.2) and in the estimators' fit windows. These are measurement design, not dynamics.

**The assumption register.** `MODEL_ASSUMPTIONS.md` now has:

| entry | content |
|---|---|
| A-21 | the map |
| A-22 | the shear-wave method |
| A-23 | the preparation rescale |
| A-08 | a p0.5 note |
| A-16 | its wording clarified to the coded behaviour: the release takes the reservoirs after this collision's own loss |

---

## 4. OPEN ITEM — the energy-drift gate cannot be met at N_c = 4 over the long windows

**This needs your decision before the pre-registration is frozen. Nothing has been changed.**

### 4.1 The gate as written

PQ7(b), which A1 §4.3 applies to the stability pilots, sets the limit on the energy-ledger residual over the measured window:

- waves: ≤ 1 % of the initial wave energy;
- static, wall and Couette boxes: ≤ 10⁻⁴ of the total energy.

The timestep rule (A1 §4.3, committed in 7b8e548) then applies:

1. a pilot over its gate at Courant 0.025 ⇒ Courant 0.0125 throughout, with Stage 0 repeated at 0.0125;
2. still over at 0.0125 ⇒ nothing changes automatically; reported for review.

### 4.2 What the integrator check shows

Source: `scripts/ub0-drift-check.ts` at commit 2d4b3f7, output `results/ub0/implementation/drift_check.json`.

Method:

- an implementation check, not a pilot;
- design seeds 9961–9973, one per case;
- small boxes with the judged geometry ratios;
- a 60 D/σ_v window;
- energy ledger only.

**Growth.** The residual grows **linearly in time**: the ratio of residuals at 60 and 30 D/σ_v is 1.9–2.5 for every case above round-off. It is a secular drift, not a random walk.

**Order.** The drift is **second order in dt**: the 0.025/0.0125 ratio is 2.8–4.8. PQ7(c)'s ≥ 2.5 is therefore attainable.

Linear extrapolation of the measured rate to each judged window (gate in brackets):

| configuration (judged window) | Courant 0.025 | Courant 0.0125 | Courant needed (2nd order) |
|---|---|---|---|
| S-K, N_c 4, c_h 2 (500) [10⁻⁴] | 2.9 × 10⁻⁴ **over** | 8.1 × 10⁻⁵ ok | — |
| **S-long, N_c 4, c_h 2 (4200)** [10⁻⁴] | 2.2 × 10⁻³ **over** | 5.1 × 10⁻⁴ **over** | ≈ 0.0055 |
| S-K, N_c 4, c_h 4 (500) | 9 × 10⁻⁶ ok | 3 × 10⁻⁶ ok | — |
| S-long/S-K, N_c 16 (4200) | 2.1 × 10⁻⁵ ok | 9 × 10⁻⁶ ok | — |
| S-K, N_c 64 (500) | 2 × 10⁻⁷ ok | 8 × 10⁻⁸ ok | — |
| **W, N_c 4, c_h 2 (2000)** [10⁻⁴] | 9.0 × 10⁻⁴ **over** | 2.4 × 10⁻⁴ **over** | ≈ 0.0081 |
| W, N_c 4, c_h 4 (2000) | 1.4 × 10⁻⁴ **over** | 3.6 × 10⁻⁵ ok | — |
| W, N_c 16 (2000) | 2.9 × 10⁻⁴ **over** | 7.3 × 10⁻⁵ ok | — |
| **C, N_c 4 (3000)** [10⁻⁴] | 1.0 × 10⁻³ **over** | 3.6 × 10⁻⁴ **over** | ≈ 0.0066 |
| **C, N_c 16 (3000)** [10⁻⁴] | 8.6 × 10⁻⁴ **over** | 2.2 × 10⁻⁴ **over** | ≈ 0.0084 |
| T, N_c 4, U₀ σ_v (1.5 τ_D) [1 %] | 0.29 % ok | 0.06 % ok | — |
| T, N_c 4, U₀ σ_v/2 (1.5 τ_D) [1 %] | 0.67 % ok | 0.18 % ok | — |
| T, N_c 16 (1.5 τ_D) [1 %] | 0.03 % ok | 0.002 % ok | — |

**Reading.**

- The drift is concentrated at the stiffest kernel (N_c = 4, c_h = 2, h = 4 D) and in boxes with walls.
- It is ≈ 30× smaller with c_h = 4, and negligible at N_c ≥ 16 in periodic boxes.
- The gate is a fixed fraction of the total energy, independent of window length, while the drift accumulates linearly. Long windows therefore fail even at a timestep that passes S-K.
- The design's own stiffness condition (ω·dt ≤ 0.02) holds throughout. The two numerical conditions of the design are not mutually consistent at N_c = 4 over 2000–4200 D/σ_v.
- These are single-seed estimates. The rates are probably good to ± 30 %, but the S-long, wall and Couette verdicts at 0.0125 are not marginal (2–5× over).

**Physical size, for scale only (no decision is drawn from it).** A relative energy change of 5 × 10⁻⁴ over S-long corresponds to a temperature change of order 5 × 10⁻⁴. That compares with the 3 % (PQ4) and 10 % (PQ2, PQ5) margins.

### 4.3 What the pre-committed rule would do

The stability pilots would almost certainly:

1. exceed the gate at 0.025 (S-K 4, S-long 4, W ×3, C ×2) ⇒ Courant 0.0125 throughout, with Stage 0 repeated at 0.0125 (about 2× the Stage 0 cost) and the pilots repeated;
2. exceed it again at 0.0125 (S-long 4, W 4 c_h 2, C 4, C 16) ⇒ **review**.

That route costs roughly 30–40 core-hours, about 8–10 h on this machine, and arrives at the review this record raises now. I have **not** run the pilots. Running them remains permitted; they are blind and would confirm the above formally.

### 4.4 Options (the decision is yours)

| option | what changes | consequence |
|---|---|---|
| **A. Run the rule as written** | nothing | pilots → 0.0125 → pilots again → review (§4.3). Formal confirmation; the decision comes later anyway |
| **B. Smaller timestep throughout** | Courant 0.0055 (meets S-long 4) | UB-0 cost × ≈ 4.5 (≈ 200 core-hours); Stage 0 repeated |
| **C. Smaller timestep only where needed** | 0.0125 throughout (S-K 4 requires it); 0.00625 for W, C; 0.0055 for S-long N_c 4 | configuration-specific dt (a design change). The dt arm (PQ7d) still tests sensitivity at N_c 16. Cost ≈ 2.5× |
| **D. A rate gate for static/wall/Couette** | the same 10⁻⁴ per 500 D/σ_v (the S-K window), i.e. 2 × 10⁻⁷ per D/σ_v, applied to every window | passes everywhere at 0.0125 (largest rate 1.6 × 10⁻⁷ per D/σ_v). This **relaxes the absolute limit for long windows** by up to 8×; it would need your explicit approval as a criterion amendment |
| **E. Reduce the integrator's secular drift** | further engine work (e.g. the collision–force splitting) | open-ended; a model change, with no guarantee |

**What I recommend for you to weigh, not a decision:**

1. **0.0125 for everything.** The S-K 4 failure at 0.025 makes the rule's first step unavoidable under every option except D.
2. **Option C for the long N_c = 4 static window and the wall/Couette boxes.** It keeps the absolute gate. The costs are a configuration-specific timestep, which you would have to accept as a design change, and about 2.5× the compute.

Option D is cheaper but is the kind of criterion relaxation you asked me not to make on my own.

### 4.5 What was not done

- No gate, margin, window, seed count or Courant number was changed.
- No pilot was run.
- The integrator check uses design seeds and small boxes, and reads the energy ledger only.

---

## 5. OPEN ITEM — the design's ρ_rel does not give T_kin = T_int under the implemented release law

**This needs your decision. Nothing has been changed.**

**Where it came from.** The design's G1 test (2), "release-law mean balance on synthetic collisions", had not been written. Writing it (`tests/universeB.release.test.ts`) exposed the item.

**The rule as coded (A-16, `CollisionModel`).** At each collision:

1. the inelastic loss (1 − e²)·½μv_n² is added to the pair's reservoirs;
2. the release takes the fraction ρ of E_i + E_j **including that loss**.

The test confirms the identity release = ρ·(E_i + E_j + loss) to 10⁻¹² on 20 000 synthetic collisions per case.

**The consequence.** With flux-weighted contacts (⟨½μv_n²⟩ = kT_kin) and reservoirs at (N_c − 1)kT_int, stationarity of the reservoir requires

  (1 − ρ)(1 − e²) kT_kin = ρ · 2(N_c − 1) kT_int, so T_kin/T_int = 2(N_c − 1)ρ / ((1 − e²)(1 − ρ)).

The design (§2) and A1 take ρ_rel = (1 − e²)/(2(N_c − 1)) as "the equilibrium of A-16 at T_kin = T_int". Under the coded law it gives **T_kin/T_int = 1/(1 − ρ_rel)**, a mean-field prediction (means only):

| configuration | ρ_rel | predicted T_kin/T_int | PQ4 margin [0.97, 1.03] |
|---|---|---|---|
| N_c 4, e 0.9 | 0.03167 | **1.0327** | **outside** |
| N_c 16, e 0.9 | 0.00633 | 1.0064 | inside |
| N_c 64, e 0.9 | 0.00151 | 1.0015 | inside |
| N_c 16, e 0.8 | 0.01200 | 1.0121 | inside |
| N_c 16, e 0.95 | 0.00325 | 1.0033 | inside |

The derivation behind ρ_rel assumed release from the pre-collision reservoir. As things stand, the design predicts its own PQ4 FAIL at N_c = 4, which is F1 and an overall FAIL. That would come from a slip in a derived constant, not from the coarse-graining hypothesis.

**Options (the decision is yours).**

| option | change | effect |
|---|---|---|
| **R1. Correct the derived constant** | ρ* = (1 − e²)/(2(N_c − 1) + 1 − e²), the exact mean balance of the coded law at T_kin = T_int (0.03069, 0.00629, 0.00151; e-arms 0.01186, 0.00324) | keeps A-16 unchanged; matches the design's stated intent ("equilibrium of A-16 at T_kin = T_int"); derived from the model's own rule, with no Universe B data; a map erratum like those in A1 |
| **R2. Change the coded law** | release from the pre-collision reservoir only | keeps the design's formula; changes a physical rule (A-16; a model version and changelog entry); Universe A untouched (no reservoir at N_c = 1) |
| **R3. Keep both** | — | PQ4 at N_c = 4 is predicted to FAIL by construction |

**For you to weigh, not a decision:** R1. It is the smallest change that makes the map do what the design says it does. It touches no physical rule, and it is checked exactly by the new test. PQ4 still tests it, since T_kin = T_int then holds only in the mean.

**Not affected.** Universe A and Stage 0 (no reservoir at N_c = 1). The drift item (§4) is independent of this one.

---

## 6. Clarifications made in turning design rules into code

These follow the design's wording where it is explicit. Where it is not, the more conservative reading was taken. Each is listed for acknowledgement.

1. **Exclusions (§11.6).** The automatic rules are:
   - a halt or safety failure;
   - a non-finite state;
   - PQ7(a): momentum residual / (N M σ_v) > 10⁻⁹ in any phase;
   - PQ7(b): the measured-window drift over its gate;
   - **lost collision events**: an instrument-integrity rule, as in the Stage 0 protocol. Not in the design's list, so it is **added and disclosed here**.

   PQ7(c) is a group statistic, not a per-run exclusion.
2. **Unexplained late contacts (PQ7e)** are not an exclusion. Any in an included run makes PQ7 violated ⇒ F0. This follows the PQ7 row of the design's table.
3. **> 10 %** is counted over the runs examined (used + excluded). With 4 seeds, one exclusion is 20 % ⇒ F0 for that configuration, which is the design's rule applied literally. Scope of the resulting F0:
   - a bulk configuration voids the bulk verdict;
   - a baseline wall configuration (W4c2, W16c2) makes the wall verdict VOID;
   - Couette (secondary) is reported only.
4. **The extension (§11.7).**
   - All eligible primaries are extended in the single extension round.
   - Every Universe B configuration entering an eligible primary is doubled from its reserve, after any replacements.
   - **Only the extended primaries use the doubled data, at 97.5 %.** Every other primary keeps its first-look verdict, so the extension never becomes a second look for them.
   - The extension request is validated against the completed first look and committed before its reserves run.
   - The wall statistic R is not a bulk primary and is **not** extended.
5. **Run halves (§11.5.1).** "⅓ of the margin" is translated per static quantity, with thresholds fixed from frozen numbers only:

   | quantity | threshold | basis |
   |---|---|---|
   | P at φ = 0.18 or 0.22 | K_T,A/150 | a shift δ in one group moves K by 5δ |
   | T_kin/T_int | 0.01 | ⅓ of 3 % |
   | S at a shell | S_RPA/30 | ⅓ of 10 % |

   A NON-STATIONARY group makes the primaries it feeds INCONCLUSIVE. Wave runs (decays) are not tested by halves.
6. **F6 at N_c = 64.** When PQ1, PQ2 and PQ8 PASS at N_c = 4 and 16, a FAIL at 64 in PQ1, PQ2 or PQ8 that is monotone in N_c is labelled F6. It does not also raise F1, F2 or F3 for N_c = 64. A PQ4 or PQ3 failure at 64 is still labelled. A non-monotone 64-only failure is a FAIL.
7. **Overall category.** It is reported alongside the F-labels and never replaces them. H1 is the viscosity-inheritance hypothesis.

   | category | condition |
   |---|---|
   | PASS | bulk PASS |
   | PARTIAL PASS | PASS-NARROW (valid for N_c ≤ 16 only); or the only failures are in the constitutive pressure closure (F2, T-FAIL, or a PQ2/PQ3/PQ5 FAIL), with H1 intact: PQ1, PQ4 and PQ8 PASS (at N_c ≤ 16, and at 64 unless F6) and PQ6a–c PASS |
   | FAIL | F1, F3 or F4, or any H1 primary (PQ1, PQ4, PQ6a–c, PQ8) FAIL |
   | VOID | F0 |
   | INCONCLUSIVE | otherwise, including a closure failure while H1 is unresolved |

   A pressure-closure failure is never by itself a FAIL of the coarse-graining; a viscosity-inheritance failure always is. The wall verdict never enters the category.

---

## 7. Status of the sequence

| step | status |
|---|---|
| A1 committed | 7b8e548 |
| mean-field wall function, pressure/melting table, corrected record | 27c88e6 |
| Stage 0 protocol + instrument | f0bd9bc |
| Universe B infrastructure, p0.5 | 2d4b3f7 |
| integrator check, implementation record | 2900d89 |
| G1 tests (2)–(7), release-law item | this update |
| Stage 0 (Universe A only) | running at f0bd9bc; results, freeze and G3 to follow |
| B0 | after Stage 0, on an idle machine |
| stability pilots | **not run**: see §4 and §5 |
| final pre-registration | **not frozen**: depends on §4 and §5 |
