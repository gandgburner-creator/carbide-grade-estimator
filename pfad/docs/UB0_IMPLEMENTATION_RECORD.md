# UB-0 implementation record (before any Universe B pilot or judged run)

> **Notice added 2026-10-08.** The three open items of this record have been decided:
> - §4, the drift gate, is D1;
> - §5, ρ_rel, is D2;
> - §6, power, is D3.
>
> Amendment [`UB0_DESIGN_AMENDMENT_2.md`](UB0_DESIGN_AMENDMENT_2.md) records them, and §9 below records the implementation. §4–§6 are unchanged as the record of what was found.

**Status.** Implementation and testing only. No Universe B pilot and no judged
Universe B run has been made. No Universe B physics observable has been
computed outside unit and plumbing tests on miniature boxes at design seeds
(9001–9999), and none of those values is printed, stored or used.

It records:

- what was built;
- the safeguards and how each is tested;
- implementation findings;
- the clarifications made in turning design rules into code;
- **three open items that need a decision before the pre-registration can be frozen**:
  - §4: the energy-drift gate;
  - §5: the release fraction ρ_rel;
  - §6: the power of the transverse-wave primaries.

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

### 3.5 Phase-boundary late contacts (Stage 0 exclusions) — instrument fixed for Universe B

**What Stage 0 found.** 6 of the 212 planned Stage 0 runs failed the "unexplained late contacts = 0" quality gate, with exactly one each, in the measured phase:

- T80a1 (2 runs), T160a1 (2), T320a1 (1);
- L160 (1).

All are wave runs. As the protocol pre-declares, they are replaced by the next reserve seeds (§7 of the Stage 0 protocol), at f0bd9bc.

**Cause.** An instrument artifact, not dynamics.

- `UB0Run` starts each phase in a new `Simulation`.
- That wipes the collider's per-particle event history, which is used **only** to classify a late contact as explained or not.
- An overlapping, separating pair left at the end of the settle phase can be turned into an approaching pair by the imposed wave. It is then counted as "unexplained" because its history was wiped.

**Fix (Universe B instrument).** `carryContactHistory()` carries the history across the phase boundary, re-based, and marks parcels already overlapping at the phase start as having an event at step −1.

**Verification.** The two failing T80a1 runs were re-run with the fix. Their results are **identical** to the stored ones (every sample, ledger and tally) apart from the counter, which falls from 1 to 0. The dynamics are untouched, so the Stage 0 data stand as recorded.

**Why this mattered.** In the judged analysis, an unexplained late contact in any included run is a PQ7(e) violation ⇒ F0 for the whole bulk verdict. At Stage 0's rate (about 1 in 20–50 wave runs at U₀ = σ_v), several of the ≈ 400 judged wave runs would have voided UB-0 on an instrument artifact.

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

## 6. OPEN ITEM — the transverse-wave primaries are under-powered by ≈ 3×

**This needs your decision. Nothing has been changed.** It is established from Universe A (Stage 0, frozen at 9c5d530), which is unrestricted. No Universe B data is involved.

**The measurement.** Stage 0's per-seed scatter of ν_A (thermal-time fit, A-22) is:

| box | per-seed relative SD |
|---|---|
| L 80 d, U₀ = c_th | 10.6 % (n = 94) |
| L 80 d, U₀ = c_th/2 | 20.5 % (n = 96) |
| L 160 d, U₀ = c_th | 5.0 % |
| L 320 d, U₀ = c_th | 2.7 % |

It scales as 1/√N, as the design assumed, but with **≈ 3× the prefactor** of the design's §11.3 estimate (3.5 % at N = 1630, U₀ = σ_v). Universe B at L = 80 D has the same N and the same relative mode noise. The Universe A scatter is therefore the legitimate estimate of the Universe B scatter; A1 forbids estimating it from Universe B pilots.

**Expected 95 % CI half-widths at the pre-registered seed counts.** This assumes the Universe B scatter equals Universe A's, and includes ν_A's frozen SE where it enters.

| primary | expected CI | margin | ⅓-margin rule (design §11.2) | design's expectation |
|---|---|---|---|---|
| PQ1, N_c 4/16 (48 seeds) | ± 3.7 % | ± 10 % | 3.3 % (meets ½) | ± 1.4 % |
| PQ1, N_c 64 (6 seeds, L 160) | ± 6.1 % | ± 10 % | 3.3 % | ± 1.9 % |
| PQ6a (48 vs 96) | **± 5.1 %** | ± 5 % | 1.7 % | ± 1.7 % |
| PQ6b (48 vs 48) | ± 4.3 % | ± 5 % | 1.7 % | ± 1.4 % |
| PQ6c-ν (24 vs 48) | ± 5.3 % | ± 7 % | 2.3 % | ± 1.8 % |
| PQ7d (48 vs 48) | **± 4.3 %** | ± 3 % | (½ accepted: 1.5 %) | ± 1.4 % |

**Consequence.**

- PQ6a can essentially never PASS. Its CI is as wide as its margin. Even after the extension (± 3.6 %) it passes only if the true ratio is within ± 1.4 % of 1.
- PQ6b passes only within ± 0.7 %, PQ6c-ν only within ± 1.7 %.
- PQ7d cannot PASS. That is only a caveat by design; it can FAIL (⇒ F0) only for a > 7 % dt effect.
- The bulk PASS, and the PARTIAL PASS category, both require PQ6a–c PASS. **As pre-registered, UB-0 would most likely end INCONCLUSIVE whatever the physics.**
- A1 §4.2 accepted the risk that "a Universe B precision proves insufficient". The size of the shortfall is new information from Universe A.

**Options (the decision is yours).** Costs are from the B0 projection at Courant 0.025; they double at 0.0125.

| option | change | extra cost |
|---|---|---|
| **P1. Accept** | none | 0. Expect INCONCLUSIVE on the robustness arms, hence overall |
| **P2. More seeds for the arms**, to reach ½ of each margin | PQ6a ×4.2 (T4/T16 a1 and a05), PQ6b ×3, PQ6c ×2.3, PQ7d ×8 | ≈ 150 core-hours (≈ 40 h on 4 cores); PQ7d alone ≈ 80 |
| **P2′.** P2 without PQ7d (it is a caveat by design) | as P2 minus the dt arm | ≈ 65 core-hours |
| **P3. Wider margins for the arms** | a criterion change | none. This relaxes criteria, so it is yours to make or reject |
| **P4. A more efficient ν estimator** | e.g. a shorter fit window | it would also have to be applied to Stage 0's ν_A, which is frozen with its estimator. Not recommended |

**For you to weigh, not a decision:** P2′. It keeps every margin, and spends compute where the design's own ⅓/½ rule says it is needed. PQ7d stays a reported caveat, as the design already accepted.

---

## 7. Clarifications made in turning design rules into code

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

## 8. Status of the sequence

| step | status |
|---|---|
| A1 committed | 7b8e548 |
| mean-field wall function, pressure/melting table, corrected record | 27c88e6 |
| Stage 0 protocol + instrument | f0bd9bc |
| Universe B infrastructure, p0.5 | 2d4b3f7 |
| integrator check, implementation record | 2900d89 |
| G1 tests (2)–(7), release-law item | b4edaad |
| assumption entries A-21–A-23, L1 audit | b63e16e |
| phase-boundary contact history (instrument) | 7b1f3b7 |
| power item (§6), draft pre-registration | this update |
| B0 | a84411a (timing), f8cb934 (projection) |
| Stage 0 | frozen at 9c5d530 (271 runs; 265 used) |
| G3 predictions, frozen inputs, B0 projection | f8cb934 |
| stability pilots | **not run**: they wait for Stage 0b and the final seed plan (A2 §8) |
| final pre-registration | `CRITERIA_UB0_COARSE_GRAINING.md` committed as a **DRAFT**: D1–D3 written in (A2); waits for Stage 0b, the final power and seed plans, and the pilots |
| A2 (D1–D3 decided) | 5df3375 |
| D2: ρ\* in the map; predictions regenerated | 5deceda (code), db6484a (outputs) |
| D1, D3, exclusion rule, seed plan, Stage 0b code | 60e585c |
| Stage 0b protocol | 32abff3 |
| provisional power plan (Stage 0 only), docs | §9 below |

---

## 9. The A2 implementation (2026-10-08)

Amendment A2 (`UB0_DESIGN_AMENDMENT_2.md`, 5df3375) records the decisions on §4–§6. This section records their implementation. **No Universe B pilot or judged run, and no Stage 0b run, has been made.**

### 9.1 What was built

| item | where | commit |
|---|---|---|
| ρ\* = (1 − e²)/(2(N_c − 1) + 1 − e²) in the map | `CoarseGrainMap.releaseFractionFor` | 5deceda |
| predictions under ρ\*; ERRATUM (A2) class; post-D2 marker | `scripts/ub0-predictions.ts`, `results/ub0/predictions_*` | 5deceda, db6484a |
| drift classes and the rate gate; comparability groups; evidence and proxies; `assignCourant`; `COURANT_ASSIGNMENT`; the pilot rule | `src/universeB/UB0Timestep.ts` | 60e585c |
| PQ7(b) by class in judged exclusions and pilot gates | `UB0Selection.checkRun`, `UB0Blind.pilotGate` | 60e585c |
| T4dt replaces T16dt; Couette removed; per-group Courant numbers; the A2 frozen structure; `ub0Plan` requires a FINAL power plan | `UB0Plans.ts`, `UB0Judged.ts`, `UB0Pipeline.ts` | 60e585c |
| matched Universe A references per N_c in the judged inputs | `UB0Judged.JudgedInputs.A`, `UB0Pipeline.FrozenJudged` | 60e585c |
| exclusion rule max(1, 10 %) | `UB0Selection.excessExclusions` | 60e585c |
| power plan, cost model, false-PASS simulation | `src/universeB/UB0Power.ts`, `scripts/ub0-power.ts` | 60e585c |
| seed blocks, disjointness check, seed plan | `UB0Plans.seedBlocks`, `assertDisjoint`; `results/ub0/seed_plan.json` after Stage 0b | 60e585c |
| Stage 0b plan, contingency, aggregation, analysis script, runner plans and interlocks | `UB0Plans.stage0bPlan`, `stage0bContingency`, `UB0Stage0b.ts`, `scripts/ub0-stage0b-analysis.ts`, `scripts/ub0-run.ts` | 60e585c |
| the A2 freeze (refuses pre-D2 predictions and open Stage 0b reviews) | `UB0Freeze.ts`, `scripts/ub0-freeze.ts` | 60e585c |
| pilot evaluation under the A2 rule, the T64a1 feasibility rule, the cost review | `scripts/ub0-pilots-eval.ts` | 60e585c |
| Stage 0b protocol | `docs/CRITERIA_UB0_STAGE0B.md` | 32abff3 |

### 9.2 Tests

46 files and 344 tests pass, including every Universe A test. These are new or changed:

| file | covers |
|---|---|
| `universeB.predictions.test.ts`, `universeB.release.test.ts` | ρ\* for N_c 2–256 and e 0.8–0.95; the energy-partition equilibrium T_kin = T_int in the mean balance; release = loss on the real collider with the map's ρ; the superseded value's 1/(1 − ρ) |
| `universeB.timestep.test.ts` (new) | the wave and rate gates; the rate statistic is window-independent for linear drift; the committed assignment equals the rule applied to `drift_check.json`; second-order extrapolation; review when no rung meets ¼; group-specific Courant numbers; the dt arm at N_c 4 and half Courant; halving; the pilot rule (proceed, halve, round 2, defects, dt-arm ratio) |
| `universeB.power.test.ts` (new) | χ² quantiles against exact values; planning factors; within-cell pooling; minimal n meets each target; infeasibility stops; margins and targets as pre-registered; design floors; monotonicity in the noise and the reference; PQ5's suppressed Universe A term; determinism; false-PASS ≈ 2.5 % and below the 3.75 % bound; the cost model |
| `universeB.plans.test.ts` (new) | the judged seed plan refuses a provisional power plan; determinism; contiguous 2n blocks; floors; seed–configuration ties; disjoint blocks; the Stage 0b plan (Universe A only, identical pooled specs, amplitude study, Courant checks, phase-2 seeds independent of the decision, the counts of record); the contingency block |
| `universeB.stage0b.test.ts` (new) | the amplitude rule (each branch); the K check and the ν/c/S diagnostics; matched references per N_c and the contingency stop; the noise basis; the estimators on tiny real runs; the A2 freeze refusing pre-D2 predictions; per-N_c c_A in the sound band |
| `universeB.resume.a2.test.ts` (new) | byte-identical checkpoint/resume at Courant 0.00625 and 0.003125 (Stage 0b, contingency) and for blind pilots at their assigned Courant; the runner job resumes from disk and stores only the blind record |
| `universeB.selection.test.ts`, `universeB.judged.test.ts`, `universeB.blind.test.ts`, `universeB.pipeline.test.ts` | the A2 exclusion rule (1 exclusion does not void; 2 do); the rate gate in `checkRun`; PQ7(c)/(d) at N_c 4; per-N_c ν_A; the A2 pilot gate; the 29-group miniature pipeline |
| `universeB.instrument.test.ts` (unchanged) | N_c = 1 ≡ the Universe A engine bit for bit; checkpoint/resume for all run kinds |

**Passing tests establish only that the code does what the rules say.** They do not establish that UB-0 is scientifically valid, and that the rules are the right ones is not something a test can show.

### 9.3 D2 status: done

- The map uses ρ\*.
- Both prediction outputs were regenerated at 5deceda, from a worktree pinned at that commit.
- Against the previous outputs, only ρ-related keys changed.
- Design check: 142 values; 130 agree, 6 rounding, 3 errata (A1), 3 errata (A2), 0 discrepancies.
- **Stale values.** A search for the superseded 0.0317 / 0.03167 / 0.00633 / 1.0327 finds them only:
  - in labelled erratum records;
  - in the review-check table (the design's printed values, which are the reference of the check);
  - in historical documents (the design, §5 of this record, A2's own table).
- The frozen inputs (f8cb934) do not depend on ρ_rel. They stay the historical Stage 0 freeze until Stage 0b replaces them; the A2 code refuses them for any plan.

### 9.4 D1 status: done, pending the pilots' confirmation

- The assignment of A2 Table 1.3 is generated by the rule and locked by a test.
- The N_c 4 near-equilibrium entries (0.00625) and the sound and T64a1 entries rest on extrapolation or proxies. The full-length pilots check them under the ½ rule before any judged run.

### 9.5 D3 status: implemented; the final counts wait for Stage 0b

**The provisional plan** (`results/ub0/power_plan_provisional.json`): Stage 0 alone, finer-Courant references stood in by their 0.025 values. It is refused as a seed allocation.

| groups | count |
|---|---|
| T4a1, T16a1 | 238 each |
| T4a05, T16a05 | 476 each |
| T16e08, T16e095 | 168 each |
| T4c4 | 55 |
| T4dt | 48 |
| T64a1 | 1325 (Stage 0's 12-seed L 160 reference) |
| SL4, SL16 | 20, 19 |
| L4, L16, L64 | 17, 41, 74 |
| W4c2, W16c2 | 88 each |
| SK, W4c4 | floors |

**A projection of the final plan.** This is NOT data. It assumes Stage 0b reproduces Stage 0's per-seed SDs, with its planned df and reference sizes; the PQ3 intervals are still Stage 0's.

| groups | count |
|---|---|
| T4a1, T16a1 | 232 each |
| T4a05, T16a05 | 463 each |
| T16e08, T16e095 | 155 each |
| T4c4 | 51 |
| T64a1 | 15 |
| SL4, SL16 | 14 each |
| W4c2, W16c2 | 40 each |
| L4, L16, L64 at amplitude 0.02 | 14, 33, 58 |
| L4, L16, L64 if 0.04 halves c's scatter | 6, 10, 17 |

**False-PASS simulation** at the margin edge, with the provisional counts, 20 000 replicates:

| | per side |
|---|---|
| first look | 2.49–2.80 % |
| with the single extension | ≤ 3.29 %, against the 3.75 % union bound |

PQ1.64's 2.80 % is the Welch approximation with a 12-seed reference dominating the variance. It is expected to approach 2.5 % with Stage 0b's 100-seed reference. The rule is unchanged; this is the measured accuracy of its approximation.

### 9.6 Compute budget (B0 model, ESTIMATE)

| block | core-hours |
|---|---|
| Stage 0b (Universe A) | ≈ 38 (phase 1 ≈ 24, phase 2 ≈ 14) |
| stability pilots | ≈ 14, plus a round 2 for any halved group |
| judged, planned seeds | ≈ 295 (amplitude 0.04 selected) to ≈ 353 (0.02) |
| the single extension | arms and sound only ≈ 150–205; every bulk group doubled ≈ 260–320 (upper bound) |
| **total** | **≈ 350–405 expected; ≤ ≈ 725 if every bulk primary were extended** |

Compared with the review's figures (≈ 280 judged, ≈ 345 total), the judged runs are larger. The causes are the wall gates at ½ of tolerance (40 seeds rather than 16), SL (14 rather than 13) and L64 (17–58 rather than 40). On this 4-core machine the expected total is ≈ 4 days.

### 9.7 What must happen next

Stage 0b must run next. It is the precondition of everything after it:

1. the predictions with its inputs;
2. the frozen inputs;
3. the final power plan and the seed plan;
4. the pilots.

The pilots cannot run before it: the runner refuses them without the A2 frozen inputs, the final power plan and the seed plan.

### 9.8 Remaining scientific ambiguities (none requires a change of hypothesis)

1. **The transfer of per-seed scatter from Universe A to Universe B** (A2 §3.3). It is well founded for ν (equipartition, confirmed 1/√N scaling). It is an assumption for c, S and the wall gates, which can err either way. A shortfall makes a primary INCONCLUSIVE; it never makes it PASS.
2. **The cause of c's 4.8 % per-seed scatter in Universe A** is not understood. The amplitude study tests one hypothesis (signal-to-noise). If 0.04 does not help, the PQ3 counts stay larger (L64 ≈ 58).
3. **PQ7(c) at N_c 4 between 0.0125 and 0.00625** is untested. The measured order at 0.025 → 0.0125 is 3.5–4.8. A drift floor at 0.00625 would make PQ7(c) fail and void UB-0 (F0). The pilot pair gives a single-seed check (review if below 2.5); it is not a guarantee.
4. **K_T,A at 0.025 is the PQ2 reference for the N_c 4 static runs at 0.00625.** Stage 0b's K check bounds the difference to ± 3.3 % at 95 %. Any real difference inside that bound enters PQ2 unmodelled.
5. **PQ3 at N_c 4.** The target is ½ of the judged interval's half-width (±0.08), which exceeds the ±0.05 tolerance outside the band. If the true Γ_self lies near a band edge, P-INC is not reachable at the planned counts, and PQ3.4 would be INCONCLUSIVE. This was accepted in A2 §3.5; the interval itself is unchanged.
6. **The wall statistic R and PQ4, PQ8** have no Universe A analogue, so their precision is not planned.
7. **The rate gate relaxes the design's absolute 10⁻⁴** for windows longer than 500 D/σ_v, by up to 8.4×. A2 §1.2 bounds the resulting bias at ≤ 7 % of each CI. It is a criterion amendment I made as the decision-maker, and it is named as such.

