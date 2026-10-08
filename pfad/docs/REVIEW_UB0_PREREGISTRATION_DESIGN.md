# UB-0 pre-registration design review: the Universe B coarse-graining consistency test

> **Notice added 2026-10-08. The text below is unchanged.** It is further amended by [`UB0_DESIGN_AMENDMENT_2.md`](UB0_DESIGN_AMENDMENT_2.md) (A2):
> - the PQ7(b) drift gate restated as a rate, with per-group Courant numbers;
> - the dt arm moved to N_c = 4;
> - Couette deferred to UB-0W;
> - the N_c = 64 postponement rule replaced by a feasibility rule;
> - the release fraction ρ_rel corrected (§2.3 here; a derivation erratum);
> - seed counts set by a pre-registered power plan on Universe A noise;
> - the "> 10 % excluded" rule replaced by "> max(1, 10 %)".
>
> A2's §9 lists every superseded rule with its location here.


> **Notice added 2026-10-07. The text below is unchanged from commit d068755.**
> This design is amended by [`UB0_DESIGN_AMENDMENT_1.md`](UB0_DESIGN_AMENDMENT_1.md) (A1):
> - errata for three numbers and for the word "fundamental-measure";
> - a replacement wall rule (§9.3 here, whose INCONCLUSIVE-THEORY condition was triggered by the Phase 1 calculation, a7a1889);
> - SE-only Universe B pilots withdrawn;
> - Universe A uncertainties propagated;
> - a separate Stage 0 protocol;
> - disclosures.
>
> Where they differ, the amendment governs the pre-registration. The committed analytical output (`results/ub0/predictions_*`) is authoritative for every predicted number.

**Status.** This is a design review. It is not a pre-registration and not an
implementation.

- Nothing was implemented or simulated for it. No physics, criterion or
  record was changed.
- The Item 1 and Item 2 classifications and Item 3's **INCONCLUSIVE** are
  untouched.
- Two analytic calculations were evaluated numerically to size predictions
  (Appendix B): a one-dimensional mean-field wall profile and RPA coupling
  integrals.
  - They evaluate theory, not Universe B dynamics.
  - Their numbers are labelled **ESTIMATE**. They must be recomputed and
    committed as pre-registration deliverables (§15).
- This review builds on
  [`REVIEW_UNIVERSE_B_SCALE_BRIDGING.md`](REVIEW_UNIVERSE_B_SCALE_BRIDGING.md)
  (commit 85f0ec5), called "the previous review" below. Where this review
  corrects it, it says so (§0.2).
- Every other number is derived here (with the section given) or taken from
  PFAD records (cited).
- Conventional results appear only as labelled EXTERNAL COMPARISONS.

Notation, in parcel units unless stated:

| symbol | meaning |
|---|---|
| N_c | molecules per parcel |
| M = N_c m | parcel mass |
| D = √N_c d | parcel core diameter |
| σ_v = √(kT/M) | parcel thermal speed |
| h = c_h √N_c D | occupancy kernel width |
| k_s | occupancy stiffness |
| e | restitution |
| ρ_rel | reservoir release fraction (A-16) |
| ν, μ | kinematic and dynamic viscosity |
| K | isothermal bulk modulus n(∂P/∂n)_T |
| S(k) | structure factor |
| Γ_self = ρc²/K | the fluid's sound speed relative to its own static modulus |

Universe A is the φ = 0.2 rigid-disk gas with m = d = kT = 1, so c_th = 1.

---

## 0. Summary

### 0.1 Decision

**Recommendation B: modify the design, then proceed to a pre-registration.**

The previous review's UB-0 sketch (§7 there) has three defects that would
make its outcome hard to interpret:

1. It calibrated k_s on Universe B's own static modulus. That makes the
   pressure test a tautology.
2. It used Couette flow as the viscosity primary. In baseline Universe B,
   Couette is contaminated by a wall defect far larger than the previous
   review assumed (§9).
3. It called the h = 2√N_c D kernel "weak coupling". It is moderate
   coupling (§2.4).

With these repaired, a falsifiable design exists.

- The design has **one** inherited constant: Universe A's measured
  isothermal modulus, entering through a stated mean-field closure.
- It has **three** pre-registered non-physical choices (e, c_h, kernel
  shape). e and c_h each have a robustness arm. The kernel shape is not
  varied in UB-0, a stated limitation (§3).
- **No** parameter is set from any Universe B observable.
- It makes **two** quantitatively predicted failures:
  - sound, through an athermal pressure law;
  - the near-wall layer, through the missing wall term.

**The modified UB-0** has these parts.

| part | content |
|---|---|
| S | Static periodic boxes: modulus, structure factor, equipartition |
| T | Wall-free transverse shear-wave decay: viscosity and the stress mechanism |
| L | Small-amplitude longitudinal standing wave: the sound prediction |
| W | Static wall box: the near-wall diagnostic |
| E | Conservation and timestep gates |
| C | Couette, as a secondary diagnostic only |
| B0 | An empirical cost benchmark |

The coarse-graining ratios are N_c = 4, 16 and 64. N_c = 64 is bulk only.

**Estimated cost:** ≈ 45 core-hours, about 11 hours on 4 cores. This is an
ESTIMATE with a factor-3 uncertainty until B0 is run.

### 0.2 Corrections to the previous review

These are errors or overstatements in 85f0ec5, found while turning it into a
design.

1. **Late contacts.** The previous review implied parcels would have fewer
   late contacts. They do not.
   - The timestep is set by the collision Courant number in parcel units,
     dt ≈ 0.025 D/v_max ≈ 0.005 D/σ_v.
   - So the late-contact fraction is identical in parcel units: ≈ 2.3 × 10⁻³
     at φ = 0.2, as in Item 3 (EXPERIMENT_LOG §6).
2. **What limits dt.** dt is collision-Courant limited, not sound limited.
   - The occupancy force's fastest frequency gives ω·dt ≈ 0.004.
   - The previous review's table row "timestep (sound-limited) ∝ √N_c" is
     wrong in both respects. In molecular units dt ∝ N_c, because
     D/σ_v = N_c d/c_th.
   - Its cost estimate (§6 there) already used dt ∝ N_c, so its gain figures
     stand. Only the table row was wrong.
3. **Couette is not a clean viscosity test** in baseline Universe B.
   - The occupancy sum has no wall term.
   - Mechanical equilibrium then forces a dense near-wall parcel layer (§9.1).
   - At N_c = 16 its contact density is ≈ 19× the bulk density, not "a
     distorted layer about h thick" of modest amplitude.
4. **The h = 2√N_c D kernel is moderate coupling, not weak.**
   - The fluctuating occupancy force changes a parcel's energy by ≈ 0.3–0.8
     kT over one diameter (§2.4).
   - The previous review's estimate was ≈ 0.95 kT. Either way it is O(kT).
   - Viscosity inheritance at c_h = 2 is therefore a genuine risk, not a
     formality. A robustness arm at c_h = 4 is required.
5. **The k_s rule.** Calibrating k_s on Universe B's own static modulus
   (previous §7.1) fits a Universe B observable. It would make the pressure
   test pass by construction.
   - Replaced by a mean-field closure from Universe A's measured modulus
     (§2.3, §3).
   - The pressure test becomes a real test of that closure.
6. **The strong-coupling arm** (h = 3D at N_c = 16) is replaced by a c_h = 4
   arm at N_c = 4.
   - The c_h = 2 and c_h = 4 arms at N_c = 4 bracket the coupling strength of
     every baseline configuration (§2.4, §5).
   - That is more informative than probing a regime already expected to
     fail.
7. **The sound prediction** P4 there (c_B ≈ 0.71–0.79 c_A) is sharpened to a
   band for Γ_self (§8.1).
   - Γ_self is measured against Universe B's own modulus, which removes the
     closure error from the sound test.
8. **Cost.** The previous estimate of 2–3 core-days fell to ≈ 45 core-hours.
   - Couette at N_c = 64 was dropped.
   - Cheap wall-free bulk tests replaced the expensive wall-bounded ones.

---

## 1. The hypothesis

### 1.1 Statement

**H_UB (coarse-graining hypothesis).**

- Let Universe A be the φ = 0.2 rigid-disk gas with Maxwell walls.
- Let E_A = {K_T,A, S_A(k), Γ_A, ν_A} be its measured equilibrium and
  transport properties. They are measured in a Stage 0 anchor (§15) before
  any Universe B run.
- Let 𝓜_{N_c} be the parcel map of §2. It is fixed before any Universe B run.
  - Every parameter comes from E_A's **equilibrium** members (K_T,A only).
  - Or it is pre-registered with a stated reason, plus a robustness arm for
    e and c_h (§3).
- Then for N_c ∈ {4, 16, 64}, at matched dimensionless conditions, five
  statements hold.

**H1 — kinetic inheritance of transport.**

- ν_B = ν_A within ±10 %.
- At least 80 % of the shear stress is carried by the parcels' kinetic and
  collisional fluxes, not by the occupancy force.
- ν_B is Newtonian at ε_p ≤ 0.075.
- ν_B is independent of e ∈ [0.8, 0.95] (±5 %) and of c_h ∈ [2, 4] (±7 %).

**H2 — pressure closure.**

- K_B = K_T,A within ±10 %.
- The parcel structure factor matches the RPA prediction built from S_A(k)
  within ±10 %. At k → 0 that is N_c·S_B(0) = S_A(0).

**H3 — predicted acoustic incompleteness.**

- Γ_self,B = ρc_B²/K_B lies in [1 + (Γ_A − 1)/N_c², 1 + (Γ_A − 1)/N_c],
  ± 0.05.
- So the parcel fluid propagates sound from its own static modulus plus
  only the kinetic share's thermal response. It does **not** reproduce
  Universe A's adiabatic sound (§8).

**H4 — equilibrium and conservation.**

- Parcel kinetic and reservoir temperatures agree within ±3 %.
- The velocity distribution is Maxwellian, |a₂| ≤ 0.03.
- Momentum is conserved to round-off.
- The energy drift is O(dt²) and negligible against the viscous dissipation.

**H5 — predicted wall defect.** With no wall term, the near-wall parcel
profile follows the mean-field kernel-truncation prediction:

- the contact density fixed by the contact theorem;
- the integrated excess within ±30 %;
- the excess proportional to h (§9).

H1, H2 and H4 are positive predictions. H3 and H5 are **predicted failures
with predicted magnitudes**.

The verdict on H_UB is split:

- a **bulk verdict** on H1–H4;
- a **wall verdict** on H5;
- a **bridging forecast** (F7) that does not judge H_UB.

### 1.2 What each element of Universe B is

| category | elements |
|---|---|
| **Inherited exactly from Universe A** | Rigid cores and the collision rule (A-05, A-06). Momentum and energy conservation. Maxwell walls acting on the centre of mass (A-08). The state point φ = 0.2, ρ = 0.2546, kT = 1. Universe A's measured isothermal modulus K_T,A, as data. |
| **Derived by coarse-graining** (exact in equilibrium for a group of N_c molecules) | M = N_c m. D = √N_c d, so φ_p = φ. Parcel CoM kinetic temperature = kT, so σ_v = c_th/√N_c. Internal energy (N_c − 1) kT and heat capacity (N_c − 1) k per parcel. Hydrodynamic-mode fluctuation amplitude kT/(ρA) per mode. The scaling of λ_p, collision rate and kinetic pressure. The invariance of ν, μ and slip/λ_p **for the hard-core parcel gas alone** (§2.2). The release fraction ρ_rel = (1 − e²)/(2(N_c − 1)) given e. |
| **Approximation** (stated, with its error) | The mean-field closure for k_s (error O(1/N_nb), ≈ 8 % at N_c = 4). The athermal occupancy law, which reproduces K_T but not the adiabatic response. Single-constant occupancy, which matches K at φ = 0.2 but not P (Z_B/Z_A ≈ 0.76–0.82). The O(1 − e) inelastic perturbation of collision dynamics. Walls acting on the CoM only, so the reservoir does not exchange heat with walls. No pressure structure below h. The Lucy kernel's finite-k response W̃(kh). |
| **New model assumption** (hypothesis, tested) | Parcels have rigid cores of diameter D (N1). The occupancy force carries the internal-degrees-of-freedom share of the pressure (N2, A-15). A scalar internal reservoir with the A-16 exchange law represents the internal degrees of freedom (N3). The parcel wall accommodation equals the molecular one (N4). The kernel rule h = c_h√N_c D (N5). |
| **Must remain emergent** (never an input) | μ and ν. Shear-stress mechanism. Sound propagation and its speed (only K is inherited). Attenuation. Self-diffusion. Thermal fluctuations. Wall momentum and heat transfer. Slip. Any flow structure. |

### 1.3 What Universe B is explicitly not allowed to become

- **No transport coefficient enters as an input.** That excludes viscosity,
  bulk viscosity, conductivity, slip length, friction, a DPD dissipative
  coefficient, a Langevin damping rate, and an SPH artificial viscosity.
- **No transport operator.** That excludes velocity smoothing, an SPH
  viscous term, a Laplacian of velocity, and a projection or pressure-
  correction step.
- **No thermostat** of any kind during measurement (Langevin, Andersen,
  rescaling, Nosé–Hoover, DPD).
  - Walls are the only heat exchangers.
  - A one-time temperature set during state preparation is not a
    thermostat (§11.6).
- **No parameter set from a Universe B observable.** In particular, k_s is
  not set from Universe B's sound or modulus, and e and c_h are not set from
  Universe B's viscosity.
- **No per-observable parameters.** The same map serves every test.
- **No prescribed boundary physics.** That excludes slip laws, wall
  functions, boundary-layer profiles, and a wall correction introduced in
  UB-0 (§9).

### 1.4 Why this is not a weakened hypothesis

- All three N_c values are judged. No subset is chosen after the fact.
- The margins (±10 % on transport and modulus) equal the precision PFAD
  applied to Items 1–2 references. They are not widened to accommodate
  expected errors.
  - The one exception is pre-declared and argued (PQ6c, ±7 %).
- The predicted failures are stated as numbers with tolerances.
  - A sound speed that "fails differently" refutes the theory (T-FAIL).
  - A wall layer that does not match the mean-field prediction is an
    unexplained defect (F5-phys).
  - Neither can be absorbed.
- The robustness arms can only falsify. A passing arm adds no freedom,
  because no parameter is ever re-chosen from it.

---

## 2. The parameter map

### 2.1 The map

"Exact" means it follows from the definition of the parcel or from Universe
A's exact scale symmetry. "Hypothesis" means it holds only if H_UB holds.

All entries are ratios to Universe A in molecular units unless stated.

| quantity | Universe B (parcel) | N_c = 4 / 16 / 64 | status |
|---|---|---|---|
| mass M | N_c m | 4 / 16 / 64 | exact (definition) |
| diameter D | √N_c d | 2 / 4 / 8 d | derived: the unique choice keeping φ_p = φ |
| number density n_p | n/N_c | 0.0637 / 0.0159 / 0.0040 d⁻² | exact |
| occupancy φ_p | φ = 0.2 | same | exact by construction |
| mass density ρ | 0.2546 | same | exact |
| kinetic temperature | kT = 1 | same | exact in equilibrium (CoM equipartition). Its maintenance under the dynamics is a hypothesis: PQ4 |
| velocity scale σ_v | c_th/√N_c | 0.5 / 0.25 / 0.125 | exact consequence |
| parcel thermal Mach number of a flow at speed U | U/σ_v = √N_c U/c_th | ×2 / ×4 / ×8 | exact. This is what limits local equilibrium (§5) |
| kinetic + collisional pressure of the cores | n_p kT Z(φ) = P_A/N_c | 0.25 / 0.0625 / 0.0156 P_A | derived (hard-core parcel gas is a scaled copy of A). The occupancy changes the contact value g(D) at O(1/N_nb): approximation |
| collision rate per parcel | ≈ 1.29 σ_v/D = 1.29/N_c per (d/c_th) | 0.32 / 0.081 / 0.020 | derived scaling. The value 1.29 is an Enskog estimate with the Henderson contact value g(d) = 1.43; Stage 0 measures it |
| mean free path λ_p | 0.96 D = 0.96√N_c d | 1.9 / 3.8 / 7.7 d | derived (λ_p/D = λ_A/d) |
| momentum transfer | per collision ∝ M σ_v ∝ √N_c. Collisions per area per time ∝ N_c⁻². Stress at a given gradient ∝ ρσ_vλ_p ∝ N_c⁰ | — | derived for the hard-core part |
| dynamic viscosity μ | μ_A = 0.351 | same | derived for the hard-core gas. **Hypothesis H1 for the composite** |
| kinematic viscosity ν | ν_A = 1.379 (units D σ_v = d c_th) | same | as μ. Never an input |
| thermal fluctuations | Parcel velocity variance kT/M. Hydrodynamic modes at scales ≫ h: kT/(ρA) per mode. Below h: not represented | ×1/N_c per parcel; per mode same | exact in equilibrium at scales ≫ h. Approximation below h |
| internal reservoir | E_int = (N_c − 1) kT; heat capacity (N_c − 1) k | 3 / 15 / 63 kT | exact (internal translational dof; hard disks have no potential energy). Its representation as one scalar is N3 |
| restitution e | 0.9 | same | **not derivable**: option C (§3) |
| release fraction ρ_rel | (1 − e²)/(2(N_c − 1)) | 0.0317 / 0.00633 / 0.00151 | derived from equilibrium of A-16 given e (§2.3) |
| collision stiffness | rigid (rewind-to-contact) | — | inherited (option A) |
| kernel width h | c_h √N_c D = c_h N_c d, c_h = 2 | 4 / 8 / 16 D (8 / 32 / 128 d) | the scaling √N_c D is derived (§2.4); c_h is option C |
| neighbours in h, N_nb | 0.8 c_h² N_c | 12.8 / 51 / 205 | consequence |
| occupancy stiffness k_s | (N_c − 1)·K_T,A/(n φ) ≈ 11.86 (N_c − 1) kT | 35.6 / 178 / 747 kT (Henderson value; Stage 0 replaces it) | option B: Universe A measurement through a stated closure (§2.3) |
| isothermal modulus K_B | K_kin + K_occ = K_T,A | 1 | derived under the mean-field approximation. Tested: PQ2 |
| absolute pressure P_B | Z_B/Z_A = 1/N_c + 0.755 (1 − 1/N_c) | 0.816 / 0.770 / 0.759 | mean-field consequence of single-constant occupancy. **Not matched; deliberately not repaired** (option D) |
| occupancy share of pressure | — | 0.69 / 0.92 / 0.98 | mean-field consequence |
| adiabatic response Γ_self | [1 + Δ_A/N_c², 1 + Δ_A/N_c], Δ_A = Γ_A − 1 ≈ 0.986 | [1.062, 1.247] / [1.004, 1.062] / [1.000, 1.015] | predicted failure (H3, §8) |
| sound speed c_B/c_A | √(Γ_self K_B/(Γ_A K_T,A)) | [0.731, 0.792] / [0.711, 0.731] / [0.710, 0.715] | consequence. Secondary |
| S_p(0) | S_A(0)/N_c | 0.105 / 0.026 / 0.0066 | derived (fluctuation–compressibility). Tested: PQ5 |
| wall pressure transmission | parcel CoM contacts only | — | approximation. Predicted defect (§9) |

### 2.2 The scale symmetry behind the kinetic rows

For rigid disks at fixed φ, the only scales are m, d and kT. Therefore

  m → N_c m,  d → √N_c d,  at fixed φ and kT

maps the hard-disk gas onto itself with lengths × √N_c and times × N_c.

- Velocities scale as 1/√N_c.
- Every length × velocity, including ν and D σ_v = d c_th, is invariant.
- In 2D, μ = ρν is invariant too (previous review §3.1).

This is exact for the hard-core sub-system. It is the reason viscosity is a
**derived** prediction rather than an input.

H1 is the hypothesis that adding the occupancy background and the reservoir
does not disturb it beyond the margins.

### 2.3 The two closures

**Occupancy stiffness: the mean-field closure.**

- The pair potential is u = k_s a W(r; h), with a = πD²/4 the parcel area
  and ∫W = 1 (A-15).
- In mean field the occupancy free energy density is ½ k_s a n_p². This
  gives:
  - P_occ = ½ k_s φ n_p;
  - K_occ = n_p ∂P_occ/∂n_p = k_s φ n_p.
- The internal degrees of freedom of N_c molecules carry the fraction
  (1 − 1/N_c) of Universe A's isothermal modulus. So

  k_s φ n_p = (1 − 1/N_c) K_T,A  ⇒  **k_s = (N_c − 1) K_T,A/(n φ)**.

- With the Henderson benchmark K_T,A = n kT (Z + φZ′) = 2.371 n kT,
  k_s = 11.86 (N_c − 1) kT. The judged value uses Stage 0's measured K_T,A.
- **What it gets right:** the isothermal modulus (by construction, at mean
  field).
- **What it cannot get right with one constant:** the absolute pressure.
  P_occ/[(1 − 1/N_c) P_A] = (Z + φZ′)/(2Z) = 0.755.
- **Its error** comes from correlations among the N_nb kernel neighbours,
  O(1/N_nb). That is ≈ 8 % at N_c = 4, c_h = 2, and ≲ 2 % for N_nb ≥ 51.
  The sign is not derived here. This is the largest known risk to PQ2. It
  is identified, not tuned away. The c_h = 4 arm diagnoses it (§7, F2
  versus F4).

**Reservoir release: the equilibrium closure (A-16).**

- In a collision with normal relative speed v_n and reduced mass M/2, the
  inelastic loss is (1 − e²)·½(M/2)v_n².
- Collision-weighting at temperature T gives ⟨½(M/2)v_n²⟩ = kT. So the mean
  loss per collision is (1 − e²) kT_kin.
- The release takes ρ_rel·(E_int,i + E_int,j) from the pair's reservoirs
  (`CollisionModel`, release step). The mean is ρ_rel·2(N_c − 1) kT_int.
- Equating gives T_kin = T_int iff ρ_rel = (1 − e²)/(2(N_c − 1)).
- The balance uses means only. Collision-weighted averages depend on the
  distribution's shape, so T_int/T_kin = 1 + O(a₂). That is why PQ4 tests
  both, within ±3 %, rather than assuming them.
- EXTERNAL COMPARISON: the closest literature model is the "Δ-model" of
  driven inelastic disks, with small a₂ ≈ 10⁻².

### 2.4 The kernel rule and the coupling strength

**Why h ∝ √N_c D.** The pair energy scale is k_s a W(0) ∝ (N_c − 1) D²/h².
Keeping it independent of N_c requires h ∝ √N_c D. The constant c_h is not
derivable (§3).

The consequence is structural, and important for bridging: in molecular
units **h = c_h N_c d** grows like N_c, faster than the parcel diameter.

Coupling measures (ESTIMATE: RPA with the hard-core structure factor taken
as S_A(0), Appendix B):

| configuration | N_c 4, c_h 2 | 16, c_h 2 | 64, c_h 2 | 4, c_h 4 (arm) |
|---|---|---|---|---|
| h/D | 4 | 8 | 16 | 8 |
| N_nb | 12.8 | 51 | 205 | 51 |
| Γ_c = u(0)/kT | 2.8 | 3.5 | 3.7 | 0.69 |
| u(D)/kT, the pair energy at contact distance | 2.0 | 3.2 | 3.6 | 0.64 |
| rms single-parcel occupancy energy / kT | 1.2 | 1.7 | 1.8 | 0.62 |
| **rms occupancy force × D / kT** | **0.78** | **0.58** | **0.33** | **0.19** |
| 1/N_nb (mean-field error scale) | 0.078 | 0.020 | 0.005 | 0.020 |

The decisive measure is the fourth row: the energy the fluctuating occupancy
force does over one parcel diameter, about one mean free path.

- At c_h = 2 it is a large fraction of kT. Collision dynamics are perturbed
  at O(1). This is **moderate coupling**.
- Strong coupling (Item 2's calibration, c² = 1.393 k_s φ/m at kT = 0.05)
  showed a solid-like stiffening. Moderate coupling may or may not.
- The c_h = 4 arm at N_c = 4 has a force measure of 0.19. The two N_c = 4
  arms therefore bracket the force measure of all baseline configurations
  (0.78 → 0.19 spans 0.78, 0.58, 0.33).
- N_c = 4 is the hardest case on both counts: the largest force measure and
  the largest mean-field error.

---

## 3. No independent fitting: the non-derivable parameters

**Rule.** No parameter of the map is chosen, adjusted or selected using any
Universe B observable, including pilot observables.

Each non-derivable parameter is classed:

- **A** — fixed from Universe A's rules;
- **B** — measured from Universe A;
- **C** — a pre-registered model parameter with a stated reason and a
  robustness arm;
- **D** — deliberately unfitted and allowed to fail.

| parameter | class | value | reason for the class | alternative rejected, and why |
|---|---|---|---|---|
| contact law, rigidity | A | rigid, rewind-to-contact (A-05, A-06), Courant 0.025 | Universe A's own rule. A finite stiffness would add a velocity scale (previous review §2) | soft cores: add a tunable scale |
| K_T,A, S_A(k), Γ_A, ν_A, the Universe A wall profile | B | Stage 0 measurements | the references, and (K_T,A only) the single inherited constant | Henderson benchmark values as inputs: not Universe A's own measurement. Kept as a cross-check |
| k_s | B (through a closure) | (N_c − 1) K_T,A/(nφ) | uses only an equilibrium property of A; the closure is stated and its error is tested | (i) calibrate on Universe B's static modulus: fits a B observable and makes PQ2 a tautology. (ii) calibrate on c_A: fits a judged observable and would double K_B (Γ_A ≈ 2). (iii) choose between them after seeing data. **All three rejected** |
| e | C | 0.9; arms 0.8 and 0.95 | **Upper bound:** the reservoir must absorb viscous heating faster than it accumulates. Per collision that needs (1 − e²) ≫ ε_p², i.e. e ≲ 0.95 at ε_p ≤ 0.1. **Lower bound:** collisions must stay near-elastic so the core gas remains a scaled copy of A; e = 0.8 already dissipates 36 % of the normal energy. 0.9 is the midpoint, chosen before any data | e chosen by matching ν: a fit, and it would hide a viscosity knob. e = 1: decouples the reservoir; the heat capacity is wrong by N_c |
| c_h | C | 2; arm 4 (at N_c = 4) | Cost: candidate pairs ∝ c_h². Also, h/δ at the bridging target grows with c_h (F7). c_h = 2 is the **harder** test (stronger coupling), not the easier one | c_h = 4 as baseline: more accurate mean field, so it would raise the chance of passing PQ2. But it costs 3.5× and, at N_c = 64, needs L ≥ 320 D (×16 cost). Testing the cheaper, harsher setting and bracketing it is the honest choice. c_h chosen from a ν pilot: a fit |
| kernel shape | C | Lucy (existing A-15 code) | existing, documented, compact. Not optimised | trying shapes until one passes: a fit. Shape is **not** varied in UB-0. This is a stated limitation |
| parcel wall accommodation | C | Aw = 1, as in the Universe A references | N4. Irrelevant to the static wall box (equilibrium); used only in the secondary Couette | Aw tuned to slip: a fit to wall transport |
| initial reservoir | derived | E_int,i = (N_c − 1) kT | equilibrium value | — |
| absolute pressure, adiabatic response, near-wall profile, wall heat transfer, thermal conductivity, structure below h | **D** | whatever the map produces | consequences the map does not control. Repairing any of them needs a new term (a second occupancy constant, a thermal occupancy law, a wall term). Adding one in UB-0 would turn a predicted failure into a fitted pass | a second occupancy constant to match P; a thermal factor to match c; a wall term. **All deferred to separately pre-registered steps (UB-1, UB-0W)** |

**Test for honesty.** For every C-class choice, ask whether the value was
the one that maximises the chance of passing. In each case the choice is
either neutral or the harsher option:

- e = 0.9 is a midpoint;
- c_h = 2 is the stronger coupling;
- Lucy is the inherited shape;
- the k_s route is the one that makes PQ2 non-trivial.

---

## 4. The minimum experiment

### 4.1 What distinguishes coarse-graining from a tuned model

A tuned model with one or two adjusted constants can match any one or two
observables at one N_c. Genuine coarse-graining is distinguished by five
features, and UB-0 is built so that each can be checked.

1. **Over-determination.** Several independent observables are predicted
   with zero parameters fitted to Universe B: ν, K, S(k), equipartition, the
   sound band, the wall profile.
2. **Invariance.** The predictions must not depend on the non-physical
   choices (e, c_h, N_c). A tuned model's agreement depends on its knobs.
3. **Predicted failure.** The coarse-graining predicts **where and by how
   much** the athermal closure fails: Γ_self at each N_c, and the wall layer.
   A model tuned to sound would place c at c_A, not inside the predicted
   deficit band.
4. **Mechanism.** The shear stress must be carried kinetically (PQ8). A
   model can match ν with the wrong mechanism: an occupancy-borne stress is
   a constitutive law.
5. **The N_c series.** Deviations must not grow systematically with N_c
   (F6).

### 4.2 The candidate experiments assessed

| candidate | needed? | why |
|---|---|---|
| static equilibrium | **necessary** | It is where the one inherited constant is tested through its closure (K_B). It supplies the modulus against which sound and fluctuations are judged. It tests the reservoir law (equipartition). Without it, PQ3 and PQ5 have no reference |
| small-amplitude sound | **necessary**, as a predicted-failure test | The deficit band is the sharpest test of which degrees of freedom carry which pressure. Most discriminating at N_c = 4, where the band [1.06, 1.25] is far from both 1 and Γ_A ≈ 2. **Changed** from Item 2's pulse to a standing wave: a cleaner frequency, and linear |
| Couette | **not necessary**; secondary only | In baseline Universe B the near-wall layer (§9) contaminates both the wall shear and the near-wall gradient. Couette's viscosity also depends on wall impulses (the open A-06/E0 question). Kept as a diagnostic for UB-0W planning |
| wall interaction | **necessary as a diagnostic** (H5) | It is the dominant predicted defect. Its classification decides whether a wall term can be derived (UB-0W). Excluded from the bulk verdict |
| conservation | **necessary as a gate** (F0) | It is not evidence for coarse-graining, since any conservative scheme passes. But a failure voids everything |
| **transverse shear-wave decay** (new) | **necessary**: the core transport test | Wall-free and incompressible, so the occupancy force has no mean-field response. ν comes from the decay rate, with no wall impulse. The stress mechanism can be decomposed. k_s cannot influence it at mean field, so a tuned k_s cannot rescue it |

### 4.3 The UB-0 components

Box sizes are in parcel diameters. Universe A anchors use the same numbers
in molecular diameters (matched dimensionless conditions, §5).

| id | configuration | N_c | measures | role |
|---|---|---|---|---|
| **S-K** | periodic box L = 80 D, φ = 0.18 / 0.20 / 0.22, static | 4, 16, 64; arm N_c 4 with c_h 4 | virial pressure (kinetic + collisional + occupancy); K by central difference; Z_B | PQ2, PQ6c |
| **S-long** | periodic box L = 80 D, φ = 0.20, long | 4, 16 | S(k) at the lowest shells; T_kin/T_int; a₂; g(r); ψ₆; self-diffusion; equilibrium transverse-current correlation | PQ4, PQ5; secondaries |
| **T** | periodic L = 80 D (L = 160 D at N_c = 64); u_x = U₀ sin(2πy/L) imposed on an equilibrated state; free decay | 4, 16 (U₀ = σ_v and σ_v/2); 64 (U₀ = σ_v) | ν from the decay; Fourier-projected σ_xy decomposed into kinetic, collisional and occupancy parts | PQ1, PQ6a, PQ8 |
| **T-e** | as T, N_c = 16, U₀ = σ_v, e = 0.8 and 0.95 (ρ_rel re-derived) | 16 | ν, T_kin/T_int | PQ6b |
| **T-h** | as T, N_c = 4, c_h = 4 (h = 8 D, L/h = 10), U₀ = σ_v | 4 | ν, stress share | PQ6c |
| **T-dt** | as T, N_c = 16, Courant 0.0125 | 16 | ν; energy drift; late contacts | PQ7 |
| **L** | periodic L = 160 D; u_x = U₀ sin(2πx/L) with δρ/ρ ≈ 0.02 | 4, 16, 64 | frequency → c_B; damping (secondary) | PQ3 |
| **W** | channel: two Maxwell walls (Aw = 1, kT_w = 1), H = 10 h, periodic width 40 D, static | 4, 16; arm N_c 4 with c_h 4 | density profile; contact density; normal-stress profile by component; ψ₆ of the first layer | H5 / F5 |
| **C** (secondary) | Couette H = 40 D, wall speeds ±σ_v/2, Aw = 1 | 4, 16 (and A at H = 40 d and 80 d) | slip, temperature jump, two-route μ, near-wall profile | UB-0W planning only |
| **E** | ledgers in every run; the dt arm | all | conservation, drift, late contacts | PQ7 / F0 |
| **B0** | timing only, design seeds | 1, 4, 16, 64 × c_h 2, 4 | µs per parcel-step by phase | cost, F7 |

**Universe A anchors (Stage 0).** The same S-K, S-long, T (L = 80 and 160),
L (L = 160), W and C configurations at N_c = 1. Two additions:

- T at L = 320 d, the same physical size as the N_c = 16 runs (§10);
- W at H = 40 d.

### 4.4 Instrumentation required (to be built at gate G1; nothing exists yet)

- **Stress decomposition.**
  - Kinetic Σ M v_x v_y.
  - Collisional, from the impulse × separation at each contact (already
    implicit in the collision step; it needs to be recorded).
  - Occupancy pair virial Σ F_ij ⊗ r_ij.
  - Each both as box totals and as the Fourier projection σ_xy(k) at the
    wave's wavenumber, using the exact pair form for Fourier stresses.
- **Normal-stress profile across a wall box,** per slab, by component.
  Needed to verify the mechanical identity of §9.1.
- **Mode amplitudes.** Transverse and longitudinal current and density
  modes at the lowest shells, sampled densely.
- **Reservoir statistics.** T_int = ⟨E_int⟩/((N_c − 1)k) and its spread.
- **Per-phase wall-clock timers** for B0.

---

## 5. Assessment of N_c = 4, 16, 64

The comparison is at **matched dimensionless conditions**. Universe B at
(N_c, L/D, U₀/σ_v) is compared with Universe A at (L/d, U₀/c_th) with the
same numbers.

- By the exact symmetry of §2.2, Kn, Re and ε_p then match exactly.
- Only quantities involving the occupancy force differ: Ma, coupling, and
  the kernel scale.

Transverse-wave conditions at U₀ = σ_v:

| | A (N_c = 1) | N_c = 4 | 16 | 64 |
|---|---|---|---|---|
| box L/D | 80 and 160 | 80 | 80 | 160 |
| parcels | 1630 / 6520 | 1630 | 1630 | 6520 |
| L/h | — | 20 | 10 | 10 |
| Kn = kλ_p | 0.075 / 0.038 | 0.075 | 0.075 | 0.038 |
| Re_k = U₀/(νk) | 9.2 / 18.5 | 9.2 | 9.2 | 18.5 |
| ε_p = γ̇λ_p/σ_v (U₀ = σ_v; at σ_v/2 it halves) | 0.075 / 0.038 | 0.075 | 0.075 | 0.038 |
| local-equilibrium margin 0.1/ε_p | 1.3 / 2.6 | 1.3 | 1.3 | 2.6 |
| Ma = U₀/c (c from §2.1) | 0.46 | 0.29–0.32 | 0.16 | 0.08 |
| collisions per parcel per D/σ_v | 1.29 | 1.29 | 1.29 | 1.29 |
| collisions per parcel per physical d/c_th | 1.29 | 0.32 | 0.081 | 0.020 |
| collisions per parcel per decay time | 152 / 607 | 152 | 152 | 607 |
| coupling: rms force × D / kT | 0 | 0.78 | 0.58 | 0.33 |
| mean-field error scale 1/N_nb | — | 0.078 | 0.020 | 0.005 |
| neighbours N_nb | — | 12.8 | 51 | 205 |
| per-seed ν uncertainty (ESTIMATE, §11.3) | 3.5 % / 1.75 % | 3.5 % | 3.5 % | 1.75 % |
| expected 95 % CI half-width on ν_B/ν_A (planned seeds) | — | ±1.4 % | ±1.4 % | ±1.9 % |
| viscous heating ΔT/T over the decay (U₀ = σ_v) | 25 % (heat capacity k) | 6 % | 1.6 % | 0.4 % |

**Sound** (L at L = 160 D). The local-equilibrium parameter of the wave is
ωτ_c = c_B k/(1.29 σ_v/D).

| N_c | 1 (A) | 4 | 16 | 64 |
|---|---|---|---|---|
| ωτ_c | 0.07 | 0.10 | 0.19 | 0.38 |

- In parcel units sound is fast against σ_v, because c_B/σ_v ≈ 1.55 √N_c.
- At N_c = 64 the kinetic share is therefore not in local equilibrium during
  a sound period.
- That share is only 1/64 of the modulus. Its possible extra stiffness, at
  most n_p kT/K_B = 0.0066, is far inside the ±0.05 tolerance.
- At L = 80 D the N_c = 4 value would be 0.2 and the allowance 0.105 · O(ωτ)².
  That is why L uses 160 D throughout.

**Viscous heating.** ΔT/T over the decay is corrected exactly in Universe A
and approximately in Universe B, by thermal-time rescaling (§11.4). The
residual is ≲ 0.6 % (ESTIMATE). It is identified, not tuned.

**Decisions.**

- **N_c = 4: kept.**
  - It is inside the ε window.
  - It is the hardest mean-field case: its 1/N_nb ≈ 0.08 is near PQ2's ±10 %
    margin, a stated risk.
  - It is also the hardest coupling case.
  - It is the only point where the same physical experiment is affordable
    for wall-bounded flow (§10).
  - It carries the c_h = 4 arm.
- **N_c = 16: kept.** The central point. It carries the e and dt arms.
- **N_c = 64: kept for bulk only** (S-K, T, L).
  - Removed from the wall tests. The reason is physical, not only cost: the
    mean-field wall prediction gives φ ≈ 0.77 at contact, above the
    hard-disk melting density ≈ 0.72 (§9.2). The near-wall layer there is
    expected to order, outside the fluid window the mean-field prediction
    assumes.
  - Removed from S-long: its cost is ≈ 6 core-hours for a secondary-level
    gain. PQ5 is therefore judged at N_c = 4 and 16 only, a stated gap.
  - Removed from the kernel arm: c_h = 4 needs L ≥ 320 D.
- **Rejected values.**
  - N_c = 2: N_nb = 6.4 and 1/N_nb ≈ 0.16 exceeds the ±10 % margin. That is
    an unfair test of the closure.
  - N_c = 256: h = 32 D, so L ≥ 320 D, ≈ 26 000 parcels at ≈ 17 µs per
    parcel-step (ESTIMATE). Unaffordable for UB-0.

---

## 6. Primary and secondary quantities

### 6.1 Decision rule (all primaries)

- **Unit of replication.** The seed. Each seed gives one estimate.
- **Interval.** A 95 % two-sided t-interval across seeds.
  - For ratios: on the log ratio, with Welch degrees of freedom, then
    back-transformed.
- **Outcome.**
  - **PASS** iff the CI lies entirely inside the margin. This is TOST
    equivalence at 2.5 % per side.
  - **FAIL** iff the CI lies entirely outside it.
  - **INCONCLUSIVE** otherwise.
- PQ3 has its own three outcomes, defined below.
- **No threshold, margin, window, seed list or analysis choice changes
  after the pre-registration commit.**

### 6.2 Primaries

| id | quantity | A reference | B prediction | margin | uncertainty criterion (expected CI) | failure threshold | where |
|---|---|---|---|---|---|---|---|
| **PQ1** | ν_B/ν_A, transverse decay, U₀ = σ_v | ν_A from Stage 0 (≈ 1.38; Item 1's μ = 0.351 ± 0.033 is a cross-check only) | 1 | [0.90, 1.10] | ±1.4 % (N_c 4, 16); ±1.9 % (64) | CI entirely outside [0.90, 1.10] | N_c 4, 16 (L 80); 64 (L 160) |
| **PQ2** | K_B/K_T,A, virial, central difference over φ 0.18 / 0.22 | K_T,A Stage 0 (Henderson 2.371 n kT as a check) | 1 (mean field). Known risk ≈ 8 % at N_c 4 | [0.90, 1.10] | ±2–3 % (confirmed by blind SE-only pilots) | as PQ1 | 4, 16, 64 |
| **PQ3** | Γ_self = ρc_B(k)²/K_B(k), with K_B(k) = K_kin + W̃(kh) K_occ | Γ_A = ρc_A²/K_T,A ≈ 1.99 | band [1 + Δ_A/N_c², 1 + Δ_A/N_c] with Δ_A = Γ_A − 1 from Stage 0 | band ± 0.05 | ≈ ±0.03 (ESTIMATE; dominated by K_B; see §11.2 on power) | **P-INC:** CI ⊂ band ± 0.05. **T-FAIL:** CI entirely outside it (T-FAIL-high above, T-FAIL-low below). **INCONCLUSIVE:** otherwise | 4, 16, 64 (L 160) |
| **PQ4** | T_kin/T_int, and a₂ = ⟨v⁴⟩/(2⟨v²⟩²) − 1 (2D) | 1 and 0 | 1 and \|a₂\| ≲ 0.02 | [0.97, 1.03]; \|a₂\| ≤ 0.03 | ±0.5 %; ±0.005 | either CI entirely outside | 4, 16, 64 (S-K at φ 0.2, S-long) |
| **PQ5** | S_B(k)/S_RPA(k) at the two lowest shells, with S_RPA built from Stage 0's S_A(k) and W̃ (→ N_c S_B(0)/S_A(0) as k → 0) | S_A(k) Stage 0 (S_A(0) ≈ 0.422) | 1 | [0.90, 1.10] | ±3–5 % | as PQ1 | 4, 16 |
| **PQ6a** | ν(U₀ = σ_v)/ν(U₀ = σ_v/2) (ε_p 0.075 versus 0.038) | the same ratio in A (reported) | 1 (Burnett corrections O(ε²) < 1 %) | [0.95, 1.05] | ±1.7 % | as PQ1 | 4, 16 |
| **PQ6b** | ν(e = 0.8)/ν(e = 0.95) | — | 1 | [0.95, 1.05] | ±1.4 % | as PQ1 | 16 |
| **PQ6c** | ν(c_h = 4)/ν(c_h = 2), and K(c_h = 4)/K(c_h = 2) | — | 1 | ν [0.93, 1.07]; K [0.90, 1.10] | ±1.8 %; ±3 % | as PQ1 | 4 |
| **PQ7** | numerical gate. (a) momentum residual / (N M σ_v) ≤ 10⁻⁹. (b) energy drift over the measured window ≤ 1 % of the initial wave energy (T runs) and ≤ 10⁻⁴ of total energy (static runs). (c) drift(dt)/drift(dt/2) ≥ 2.5 (O(dt²) gives 4). (d) ν(dt/2)/ν(dt) ∈ [0.97, 1.03]. (e) unexplained late contacts = 0 | — | — | as listed | (d) ±1.4 % | any of (a)–(c) or (e) violated, or (d) FAIL ⇒ **F0** (VOID) | all; (c, d) at N_c 16 |
| **PQ8** | occupancy share of the projected shear stress, s_occ = \|σ_occ(k)\|/\|σ_total(k)\| | 0 (no occupancy in A) | no derived value; expected ≲ 0.1 (not a criterion) | s_occ < 0.20 | ±0.03 | CI entirely ≥ 0.20 | 4, 16, 64 baseline |

**The margins and their reasons.**

- **±10 %** (PQ1, PQ2, PQ5) is the precision at which PFAD's Items 1 and 2
  stated their references. It is also below the smallest effect that would
  change a bridging decision.
- **±5 %** (PQ6a, PQ6b) is half of that. A non-physical parameter must not
  move the primary by more than half its tolerance.
- **±7 %** (PQ6c, ν) admits the predicted mean-field error difference
  between the arms (1/N_nb = 0.078 versus 0.020, i.e. ≈ 6 %, rounded up). It
  still rejects a coupling-controlled viscosity.
- **±0.05** (PQ3) covers the finite-k correction uncertainty and the
  kinetic non-equilibrium allowance (§5). It is narrower than the gap
  between the band and Γ_A at every N_c.
- **0.20** (PQ8) is the line L3 of §14.

### 6.3 Secondaries (reported, never used to classify)

| id | quantity | prediction, if any |
|---|---|---|
| SQ1 | Z_B/Z_A at φ = 0.2 | 0.816 / 0.770 / 0.759 (mean field) |
| SQ2 | c_B/c_A | [0.731, 0.792] / [0.711, 0.731] / [0.710, 0.715] if K_B = K_A |
| SQ3 | sound dispersion (W̃) and attenuation | dispersion by W̃(kh); attenuation not predicted (reservoir relaxation adds to it) |
| SQ4 | wall profile details beyond F5; ψ₆ of the first wall layer | §9.2 |
| SQ5 | Couette: slip/λ_p, temperature jump, two-route μ | none (UB-0W input) |
| SQ6 | self-diffusion; g(r); global ψ₆ (> 0.3 flags ordering, feeding F4) | liquid-like; ψ₆ ≈ 0 |
| SQ7 | equilibrium transverse-current amplitude at k_min | kT/(ρA) per mode, as in A (exact) |
| SQ8 | Green–Kubo ν from the equilibrium transverse-current decay | = ν from T |
| SQ9 | two-route ν: projected stress/gradient versus decay rate | agree within 5 % |
| SQ10 | ν at e ∈ {0.8, 0.9, 0.95} extrapolated to e → 1 | no trend |
| SQ11 | T_kin/T_int and a₂ in the e arms | — |
| SQ12 | same-physical-size comparisons: N_c 4 (L 80 D = 160 d) and N_c 16 (L 80 D = 320 d) | §10 |
| SQ13 | transverse decay shape: monotone versus oscillatory (elastic response) | monotone |
| SQ14 | cost: µs per parcel-step by phase; effective gain G | §12 |

### 6.4 Overall classification

**Bulk verdict (H1–H4).**

- **PASS:**
  - PQ1, PQ2, PQ4, PQ5, PQ6a–c and PQ8 PASS everywhere they are run;
  - PQ3 = P-INC at every N_c;
  - PQ7 holds.
- **PASS-NARROW** (F6): as PASS at N_c ∈ {4, 16}, but PQ1, PQ2 or PQ8 FAIL
  at N_c = 64, with point estimates moving monotonically away from the
  prediction across 4 → 16 → 64. The report states N* = 16.
- **FAIL:** any decisive failure of a primary at N_c ≤ 16, a non-monotone
  failure at 64, or a T-FAIL. It carries the F-labels of §7.
- **INCONCLUSIVE:** no FAIL, and at least one primary INCONCLUSIVE after the
  single pre-registered extension (§11.7).
- **VOID:** F0.

**Wall verdict (H5).** One of F5-impl (the predicted defect), F5-phys,
INCONCLUSIVE, or INCONCLUSIVE-THEORY (§9.3).

**Bridging forecast.** F7 flagged or not, with sub-labels. This is not a
verdict on H_UB.

**Philosophy checks.** L1–L4 (§14), each reported as held or crossed.

---

## 7. Failure modes, fixed in advance

Every trigger refers to §6 outcomes, so none needs judgement after the data.
When several labels trigger, all are reported. The headline label follows
the precedence F0 > F3 > F1 > F2 > F4 > F6.

- Mechanism (F3) outranks a mismatch (F1): if the stress is constitutive, a
  numerical mismatch is secondary.

| label | name | trigger | what it would mean | what follows |
|---|---|---|---|---|
| **F0** | numerical / void | PQ7 violated; a halt or non-finite state; the mechanical identities of §9.1 fail (instrumentation); > 10 % of a configuration's runs excluded by the automatic rules of §11.6 | The measurement, not Universe B, failed | Fix it, log an amendment, re-run on fresh reserved seeds. No physics conclusion |
| **F1** | coarse-graining fails at the kinetic level | PQ4 FAIL at baseline; **or** PQ1 FAIL at some N_c while PQ8 PASS, PQ6b not FAIL and PQ6c PASS | Transport is kinetic, insensitive to e and coupling, yet not A's. The scaling argument (§2.2) does not survive the composite model: the reservoir law or occupancy-modified contact correlations change kinetic transport systematically | H1 refuted. Universe B in this form does not inherit viscosity. Path A (Universe A scale-up) or an explicitly continuum Path C |
| **F2** | pressure closure fails | PQ2 FAIL at N_c = 4 in **both** c_h arms; **or** PQ2 FAIL at N_c ≥ 16 (mean-field error ≤ 2 % there); **or** PQ5 FAIL with PQ2 PASS (fluctuations inconsistent with the modulus); **or** PQ3 T-FAIL-low (sound softer than the static modulus) | One occupancy constant through the mean-field closure does not carry the internal-dof modulus. Or the parcel fluid's mechanics is internally inconsistent | H2 refuted. A closure beyond mean field would be needed. That is not a parameter change: it is a new pre-registration |
| **F3** | viscosity not emergent | PQ8 FAIL (s_occ ≥ 0.20); **or** PQ6b FAIL (ν depends on e); **or** PQ1 FAIL with s_occ ≥ 0.20 | Shear transport is controlled by an inserted law (occupancy) or by a dissipation rate (e): a constitutive knob. Even a PQ1 pass would not count | Line L2 or L3 crossed. Universe B would be "CFD wearing particle clothing" for momentum transport. Report plainly |
| **F4** | weak coupling fails at the baseline kernel | PQ6c FAIL; **or** a baseline primary FAILs at N_c = 4 while the c_h = 4 arm PASSes the same quantity; **or** SQ6 ψ₆ > 0.3 or SQ13 oscillatory decay at baseline (ordering, elastic response) | c_h = 2 lies outside the coupling window. Coarse-graining may hold only at weaker coupling | H1/H2 hold at most for c_h ≥ 4. Triggers F7a (cost × 3.5; h/δ larger) |
| **F5** | wall not preserved | §9.3 | F5-impl: the predicted implementation defect. F5-phys: unexplained wall physics | F5-impl: UB-0W may derive a wall term. F5-phys: no wall term can be designed from UB-0; wall-bounded Universe B is blocked |
| **F6** | narrower N_c range | PASS at 4 and 16; FAIL at 64 with a monotone trend | Coarse-graining degrades with N_c, e.g. growing occupancy share, or kernel scale against flow scale | Valid range N_c ≤ N* = 16. Feeds F7c |
| **F7** | passes UB-0 but cannot bridge | any of: (a) F4, i.e. c_h = 4 required, **and** h/δ ≥ 0.5 at the target (N_c ≈ 60, Re_δ ≈ 170: h = 4·√60 D ≈ 31 D); (b) B0's measured effective gain G(N*) < 10; (c) N* < 50 (PASS-NARROW): with an estimated G ≈ 30 at N_c = 16, the Re reach at equal cost is only ≈ 3× Universe A's (2D cost ∝ Re³); (d) the Newtonian window is narrower than designed (PQ6a FAIL or INCONCLUSIVE with ν rising with ε) | Universe B is internally consistent but does not buy enough scale | A forecast only. Universe B would need a particle-mesh occupancy evaluation (previous review §6) before any flow work, or Path A/C |
| **T-FAIL** | sound theory refuted | PQ3 CI entirely outside band ± 0.05 | High: hidden adiabatic or elastic response (for example an ordered, solid-like structure adding a shear modulus to the longitudinal response; cross-check SQ6, SQ13). Low: F2 | Our account of where the parcel fluid's sound comes from is wrong. No thermal-occupancy extension (UB-1) is designed until it is understood |

---

## 8. Sound: a pre-registered failure, not a repair

### 8.1 The prediction

The parcel fluid's modulus has two parts.

- **K_occ = (1 − 1/N_c) K_T,A** is athermal. In mean field its isothermal and
  adiabatic values coincide.
- **K_kin = K_T,A/N_c** belongs to the hard-core parcel gas. Its adiabatic
  excess over isothermal is the Universe A excess scaled by the parcel share
  and by the heat capacity it can draw on:
  - **No exchange** with the reservoir during a period (heat capacity k per
    parcel): ΔK = ΔK_A/N_c.
  - **Full exchange** (heat capacity N_c k per parcel): ΔK = ΔK_A/N_c².
  - Here ΔK_A = ρc_A² − K_T,A ≈ 0.986 K_T,A (Item 2's c₀ = 2.170 with the
    Henderson K_T; Stage 0 replaces both).
- The exchange rate per collision is ≈ (1 − e²)/2 ≈ 0.1 of the normal
  energy. The sound periods in L span a few to tens of collisions, so the
  truth lies between the two limits:

  **Γ_self ∈ [1 + Δ_A/N_c², 1 + Δ_A/N_c]**:
  - [1.062, 1.247] at N_c = 4;
  - [1.004, 1.062] at 16;
  - [1.000, 1.015] at 64.

- **Finite-k correction.** It uses K_B(k) = K_kin + W̃(kh)K_occ, with
  W̃(kh) = 0.9989, 0.9956 and 0.9824 at L = 160 D for N_c = 4, 16, 64.
  These are computed exactly for the Lucy kernel before the
  pre-registration.
- **Collisionless allowance** (§5): at most 0.105, 0.026 and 0.0066 times
  O(ωτ_c)². Negligible at L = 160 D.

The deficit is **not repaired** before UB-0. A thermal occupancy law is not
added. k_s is not raised to match c_A.

### 8.2 After UB-0

- **P-INC at every N_c:** the predicted incompleteness is confirmed.
  - Only then is the extension designed: UB-1, a thermal occupancy law.
    P_occ = (1 − 1/N_c) n kT_int Z(φ), with the compression work
    exchanged with the reservoir, and Z(φ) from Universe A's measured
    equation of state.
  - Its own pre-registration would predict Γ_self → Γ_A, with no new
    constant.
- **T-FAIL-high:** first find the source (ordering? reservoir coupling?)
  with secondary data. No extension is designed on a misunderstood
  baseline.
- **T-FAIL-low:** handled as F2.
- **INCONCLUSIVE:** one pre-registered extension (§11.7). Otherwise the
  result is reported as is.

### 8.3 Is a matched failure evidence for or against the coarse-graining?

**For the coarse-graining structure; against the completeness of its
constitutive closure. Not evidence of acoustic fidelity.**

- A match means:
  - the parcel fluid's sound arises mechanically from its own static modulus
    (Γ_self ≈ 1 at large N_c);
  - the kinetic share contributes exactly its 1/N_c thermal part;
  - the missing part is exactly the thermal-pressure response of the
    internal degrees of freedom, the part the map deliberately assigned to
    an athermal law.
- That confirms **which degrees of freedom carry which pressure**, the core
  claim of the coarse-graining. It also identifies the single missing
  ingredient precisely.
- A tuned model would have no reason to land in the band. It would either
  match c_A, if tuned to sound, or be off K, if tuned to statics.
- **Caveat.** The evidential weight is uneven.
  - At N_c = 16 and 64 the band hugs Γ = 1, i.e. "sound equals the static
    modulus". Many mechanically consistent models satisfy that.
  - **The discriminating point is N_c = 4.** There the band [1.06, 1.25] is
    distinct from both 1 and 1.99.
  - A P-INC at 16 and 64 with an INCONCLUSIVE at 4 is therefore weak
    evidence. The report must say so.

---

## 9. The near-wall occupancy deficit as a deliberate diagnostic

### 9.1 Exact mechanics: what the missing wall term implies

In a static wall box, three facts follow from momentum balance alone.

1. **The normal stress is uniform across planes parallel to the wall.**
   - Occupancy forces act only between parcels.
   - At the wall plane no pair straddles, so the occupancy normal stress is
     zero there.
   - So **the wall receives the whole bulk pressure P_B through parcel
     core contacts.**
2. **Contact theorem.** For a hard wall in equilibrium, the wall pressure is
   kT times the parcel centre density at contact. This holds for specular
   walls and for diffuse walls at T_w = T alike. Hence

   **n_contact/n_bulk = P_B/(n_p kT)**:

   | | ratio | source |
   |---|---|---|
   | Universe A | Z = 1.57 | — |
   | Universe B, N_c = 4 | 5.13 | mean-field P_B (§2.1) |
   | N_c = 16 | 19.4 | — |
   | N_c = 64 | 76.3 | — |

3. **The hard-core sub-system must be compressed near the wall** until its
   own pressure equals P_B, about N_c × its bulk value. The occupancy share
   of the pressure (0.69 / 0.92 / 0.98) has no other route to the wall.

This is not small, and it is not a kernel-edge nuance.

- It is a mechanically mandated **dense parcel layer**.
- Its origin is precise: in Universe A the molecules that make up the
  internal degrees of freedom hit the wall themselves. In Universe B their
  pressure lives in a pair force that the wall does not feel.

### 9.2 The mean-field profile (ESTIMATE, Appendix B)

Method:

- a one-dimensional density functional;
- hard cores by local density with the Henderson equation of state;
- occupancy in mean field with the projected Lucy kernel;
- the bulk held at φ = 0.2.

| | N_c 4, c_h 2 | 16, c_h 2 | 64, c_h 2 | 4, c_h 4 |
|---|---|---|---|---|
| h/D | 4 | 8 | 16 | 8 |
| local-density φ at contact | 0.38 | 0.60 | **0.77** (above hard-disk melting ≈ 0.72) | 0.38 |
| φ at y ≈ h/2 (a depleted zone) | 0.19 | 0.15 | 0.13 (≈ 0.08 at h/4) | 0.19 |
| net excess ∫(n − n_b)dy, in units n_b h | 0.13 | 0.20 | 0.24 | 0.13 |
| excess(c_h = 4)/excess(c_h = 2) at N_c = 4 | — | — | — | **2.0** (excess ∝ h) |

The predicted signature has three parts:

- a dense contact layer whose height is fixed by item 2 of §9.1;
- a depleted zone around h/2;
- recovery by y ≈ h, with the profile self-similar in y/h at fixed N_c.

**Limitations of the estimate.**

- The local-density hard-core treatment smooths the true contact layering.
  The exact contact value is set by the contact theorem, not by this
  estimate.
- At N_c = 64 the estimate is outside its validity, since the contact layer
  would be solid-like.
- These limitations are why W runs at N_c = 4 and 16 only, and why the
  tolerance below is ±30 %.

### 9.3 Classification rules (pre-registered)

**Instrumentation identities.** These must hold, or the outcome is F0:

- wall impulse pressure = core bulk virial pressure, within 1 %;
- n_contact·kT = wall pressure, within 3 % after the pre-registered
  extrapolation of the binned profile to contact.

**Classes.**

- **Boundary-condition implementation problem (F5-impl): the predicted
  outcome.** All of:
  - (a) the integrated excess over [0, 1.5h] lies within ±30 % of the
    canonical mean-field prediction at both N_c = 4 and 16;
  - (b) the excess ratio between the c_h arms at N_c = 4 lies in
    [1.6, 2.4] (prediction 2.0);
  - (c) the component normal-stress profiles show the occupancy part going
    to zero at the wall and the core part rising to P_B, as predicted.

  Meaning: the defect is entirely the missing wall contribution to the
  occupancy sum.

  - It is derivable from the same equilibrium closure: the wall acts as a
    continuation of the bulk occupancy field.
  - That would be a candidate wall term for UB-0W, pre-registered and tested
    separately.
  - It is not introduced in UB-0.
- **Unavoidable consequence of coarse-graining: benign, inherited.** Any
  residual structure confined within ≈ 2 D of the wall, after subtracting the
  mean-field prediction, that matches Universe A's own hard-wall layering
  rescaled by D/d.

  Meaning: sub-parcel structure (molecular layering, the Knudsen layer below
  λ_p) cannot be resolved at parcel scale. Every coarse-graining has this.
- **Inability (F5-phys).** Either:
  - (a) or (b) FAILs decisively (the CI is outside); or
  - the first layer orders (ψ₆ > 0.5) where the mean field predicts a fluid
    (N_c = 4, contact φ ≈ 0.38).

  Meaning: the wall behaviour of parcels is not explained by kernel
  truncation. No derived wall term can be designed from UB-0. Wall-bounded
  Universe B is blocked until it is understood.
- **INCONCLUSIVE:** otherwise.
- **INCONCLUSIVE-THEORY:** pre-declared before any data. It applies if,
  when the predictions are computed at gate G3, the local-density and a
  weighted-density (fundamental-measure) hard-core functional differ by more
  than 20 % in the integrated excess at either N_c. Then the prediction
  itself is not sharp enough to classify against.

### 9.4 What UB-0 therefore cannot test

- **Wall momentum transfer, slip/λ_p and wall heat transfer.** They are not
  testable in baseline Universe B. Any of them measured through the dense
  layer would test the defect, not the coarse-graining.
- **Wall heat transfer is also limited by design (N4).** Walls exchange
  energy only with parcel CoM motion. The reservoir (N_c − 1 of the heat
  capacity) reaches the wall only through collisions with wall-adjacent
  parcels.

This is why Couette is secondary, and why wall transfer moves to UB-0W.

---

## 10. Universe A cross-validation

### 10.1 The smallest N_c for the same physical experiment

"The same physical experiment" means identical physical L, U, T, ρ and
boundary conditions, with **both** universes inside their validity windows:

- Universe B: L ≥ 10h, ε_p ≤ 0.1, the coupling of §2.4;
- Universe A: affordable.

Since h = c_h N_c d (§2.4):

**Bulk** (T, L), which needs L ≥ 10h = 20 N_c d:

| N_c | needs | B box | Universe A cost at that size (ESTIMATE, ∝ L⁴) |
|---|---|---|---|
| 4 | L ≥ 80 d | L = 80 D = 160 d | the Stage 0 L = 160 d anchor, already planned |
| 16 | L ≥ 320 d | L = 80 D = 320 d | ≈ 0.6 core-hour per seed. Affordable, added as SQ12 |
| 64 | L ≥ 1280 d | — | ≈ 100 core-hours per seed. **Not affordable** in UB-0 |

**Wall-bounded flow.** This needs:

- h/H ≤ 0.1, i.e. H ≥ 20 N_c d;
- Kn_p = 0.96√N_c d/H ≤ 0.05, i.e. H ≥ 19√N_c d.

The kernel bound dominates. N_c = 4 needs H ≥ 80 d (cheap in A); N_c = 16
needs H ≥ 320 d (≈ 74 000 time units to develop, expensive).

**Smallest N_c: 4.**

- It is the smallest N_c at which the mean-field closure is predicted to
  hold within the margins. At N_c = 2, 1/N_nb ≈ 0.16.
- It is the only N_c with an affordable same-physical overlap for both bulk
  and wall-bounded flow.
- The wall-bounded overlap is deferred to UB-0W, because the baseline wall
  is defective (§9).
- N_c = 16 is the largest with an affordable same-physical **bulk** overlap.

### 10.2 What must converge and what is expected to differ

| must converge (within the margins) | expected to differ (and by how much) |
|---|---|
| mass density ρ | parcel thermal speed: σ_v = c_th/√N_c |
| ν and μ (bulk) | collision rate per physical time: ×1/N_c per parcel |
| isothermal modulus K_T (mean-field closure) | mean free path: ×√N_c; Kn at fixed physical L: ×√N_c |
| molecular-number structure factor N_c S_p(k ≪ 1/h) | absolute pressure: Z_B/Z_A ≈ 0.82 / 0.77 / 0.76 |
| hydrodynamic-mode fluctuation amplitude kT/(ρA) per mode | sound speed: ×0.71–0.79 (athermal); Γ_self ≈ 1–1.25 versus 1.99 |
| shear stress for a given velocity gradient, at scales ≫ h | pressure fluctuations and g(r) below h |
| momentum (conserved in both) | near-wall density: dense layer, contact density ×5–19 versus ×1.57 (§9) |
| equipartition (T_kin = T_int = T) | wall heat transfer: CoM-only (N4) |
| core velocity profiles in a same-physical Couette at N_c = 4 (**only after UB-0W**) | slip length and Knudsen layer in physical units: ∝ λ_p, i.e. ×√N_c even after a wall term |
| — | thermal conductivity: reservoir heat moves by parcel diffusion and exchange, not by molecular collisional transfer. **Not tested in UB-0**; a required future test, since flows with heating depend on it |
| — | timestep per physical time: ×N_c (dt ≈ 0.005 N_c d/c_th) |

---

## 11. Statistical design

### 11.1 Seeds and independence

- Every run has its own seed. PFAD's deterministic RNG streams fix the
  initial positions, velocities, reservoir draws and wall re-emission per
  seed.
- Seeds are never reused across configurations being compared.
- The comparisons are unpaired. Pairing gives no benefit: trajectories
  decorrelate within a few collision times.

| block | seeds |
|---|---|
| Stage 0 (Universe A anchors) | 8001–8199 |
| UB-0 judged runs | 8201–8999. Each configuration gets a contiguous block of 2 × its planned count; the second half is a reserve for exclusions and the single extension |
| design pilots and B0 | 9501–9999. Never judged |

### 11.2 Minimum seed counts and why

**Rule.** The expected 95 % CI half-width on each primary must be ≤ ⅓ of its
margin.

- Then a true deviation up to ⅔ of the margin still passes.
- The rule is checked against the per-seed uncertainty estimates of §11.3.
- **4 seeds is the floor everywhere.** It is the smallest number that gives
  a usable variance estimate (t₃ = 3.18).

**Two primaries cannot meet the rule at affordable cost.** This is stated
here, not discovered afterwards.

- **PQ7d (the dt arm).** It meets ½ of its ±3 % margin (CI ≈ ±1.4 %), not ⅓.
  An INCONCLUSIVE dt arm is reported as a numerical caveat. Only a FAIL
  voids.
- **PQ3 (Γ_self).** Its CI (≈ ±0.03, from K_B) is ≈ 0.6 of its ±0.05
  tolerance.
  - At N_c = 16 and 64, where the band is narrow, INCONCLUSIVE is a likely
    outcome.
  - At the discriminating point N_c = 4 (§8.3) the band is 0.185 wide, so
    the test is adequately powered.
  - Meeting ⅓ everywhere would need ≈ 25 static seeds per density.

| configuration | seeds | reason |
|---|---|---|
| A: T at L 80, U₀ = c_th / c_th/2 | 48 / 96 | cheap (≈ 15 s per run). Keeps A's error equal to B's in the ratios |
| A: T at L 160 | 12 | — |
| A: T at L 320 | 4 | secondary (SQ12) |
| A: S-K, 3 φ | 8 each | — |
| A: S-long | 8 | — |
| A: L | 8 | — |
| A: W | 4 | — |
| A: C (H 40 d and 80 d) | 4 each | — |
| B: T at N_c 4 and 16, U₀ = σ_v | 48 each | PQ1: ±1.4 % against ⅓ × 10 % = 3.3 %. Also the reference arm for PQ6a, PQ6b and PQ7d |
| B: T at N_c 4 and 16, U₀ = σ_v/2 | 96 each | twice the per-seed noise. PQ6a: ±1.7 % against ⅓ × 5 % = 1.67 % |
| B: T at N_c 64, L 160 | 6 | per-seed 1.75 %. CI ±1.9 % against 3.3 %, still inside if the per-seed noise is 1.5× the estimate |
| B: T-e, e = 0.8 and 0.95 | 48 each | PQ6b: ±1.4 % against 1.67 % |
| B: T-h (c_h 4, N_c 4) | 24 | PQ6c: ±1.8 % against ⅓ × 7 % = 2.3 % |
| B: T-dt (Courant 0.0125, N_c 16) | 48 | PQ7d: see above |
| B: S-K, 3 φ, at N_c 4, 16, 64 and the c_h 4 arm | 8 each | K by central difference amplifies the pressure error ≈ 3.5×. PQ2 needs ≈ 1 % on the seed-averaged pressure at each φ. Run lengths are fixed from blind SE-only pilots |
| B: S-long, N_c 4 and 16 | 4 each | 4200 D/σ_v per seed gives ≈ 140 independent low-k density samples. PQ5: ±3–5 % |
| B: L at N_c 4, 16, 64 | 4 each | the frequency is precise to < 0.5 % per seed; Γ's CI is dominated by K_B (from S-K) |
| B: W at N_c 4, 16, and the c_h 4 arm | 4 each | profiles are averaged over long static runs. The ±30 % tolerance is theory-limited, not noise-limited |
| B: C, N_c 4 and 16 | 4 each | secondary |

### 11.3 Primary statistics and their estimated uncertainty

**ν (T).**

- The transverse mode amplitude is A(t) = (2/N)Σ v_x,i sin(k y_i).
- Thermal noise per snapshot: σ_A = √(2/N) σ_v, i.e. 0.035 σ_v at N = 1630.
- Its correlation time is the decay time itself, since a hydrodynamic mode's
  fluctuations decay at the same rate.
- So the per-seed relative error on the rate is ≈ σ_A/U₀:
  - 3.5 % at U₀ = σ_v, N = 1630;
  - 7 % at σ_v/2;
  - 1.75 % at N = 6520.
- **Fit:**
  - nonlinear least squares in linear amplitude, A(t) = A₀ exp(−νk²s(t));
  - over the window s ∈ [0.1τ, 1.5τ], with τ = 1/(ν_A k²) from Stage 0;
  - in thermal time s (§11.4);
  - the noise ledger is used only for diagnostics.

**K (S-K).**

- K = φ·[P(0.22) − P(0.18)]/0.04.
- The bias from P(φ) curvature is ≈ 0.3 % for the Henderson equation of
  state. It is identical in A and B by construction, and cancels in the
  ratio.

**S(k) (S-long).** Shell averages at the two lowest shells. The
correlation time comes from block averaging.

**Γ_self (L).**

- c_B is fitted from the standing-wave frequency of the density and current
  modes over ≥ 10 periods, after 2 periods of settling.
- K_B and its finite-k correction come from S-K.

**PQ8.** The ratio of the Fourier-projected stress amplitudes, fitted
jointly with the decay over the same window.

**Equipartition and a₂.** Time and parcel averages, per seed.

### 11.4 Corrections that are part of the method, not tuning

**Thermal-time rescaling.** Viscous heating raises T during the decay.

- s(t) = ∫√(T_kin(t′)/T₀) dt′.
- This is exact for Universe A (hard-disk scale invariance).
- It is approximate for Universe B, because the occupancy part is athermal.
  The residual is ≲ 0.6 % (§5).
- The uncorrected estimate is reported as a secondary.

**Finite-k correction of K_B in PQ3.**

- It uses W̃(kh), computed exactly before the pre-registration.
- K_kin and K_occ are separated using the measured virial components.

**Temperature normalisation of the static pressures.**

- P → P_kin/T_meas + P_occ.
- The kinetic part is exactly ∝ T at fixed φ; the occupancy part is
  athermal.

### 11.5 Convergence checks (reported; each with a pre-stated consequence)

1. **Run halves.** The first and second halves of each measurement window
   are compared, seed-averaged. If the difference CI excludes zero by more
   than ⅓ of the margin, the configuration is flagged NON-STATIONARY and its
   primary is reported INCONCLUSIVE.
2. **Block-averaging plateau** for every static observable. No plateau ⇒
   the CI is computed from seed means only. This is the default anyway.
3. **The dt arm (PQ7d).**
4. **Fit-window sensitivity** for T: [0.1τ, 1.0τ] versus the pre-registered
   [0.1τ, 1.5τ]. Reported only.
5. **Universe A at L 80 versus L 160.** The Kn dependence of ν_A is
   reported. It is expected below 2 %, and cancels at matched L/D anyway.

### 11.6 Ledgers, timestep diagnostics, preparation, exclusions

**Ledgers (every run).**

- The momentum vector.
- Energy: kinetic, reservoir, occupancy potential and wall heat.
- Reservoir inflow (inelastic) and outflow (release).
- Late contacts, pair and wall, with unexplained late contacts required to
  be 0.
- Halts and flags.
- The preparation rescale.

**Timestep diagnostics.**

- The achieved Courant number and the dt distribution.
- The maximum displacement per step, in units of D.
- An occupancy stiffness check: the maximum ω·dt estimated on sample steps
  must be ≤ 0.02.
- The energy-drift rate at two dt values.
- The late-contact fraction. It is ≈ 2.3 × 10⁻³ at Courant 0.025, above
  A-06's 10⁻³ guideline exactly as in Item 3. The exceedance is documented,
  and the dt arm quantifies its effect.

**Preparation.**

1. Random non-overlapping placement.
2. A relaxation phase of 100 D/σ_v under the full dynamics.
3. **One** global rescale of CoM peculiar velocities and reservoir energies
   to T = 1.
4. A further 20 D/σ_v.
5. Then the measurement (or, for T and L, the imposed wave).

The rescale happens once, before measurement, and is logged. It is a state
preparation, not a thermostat.

**Exclusions.** Runs are excluded only by automatic rules decided before any
observable is computed:

- a halt;
- a non-finite state;
- a PQ7 (a)–(c) violation.

Each excluded run is replaced by the next reserve seed and reported. If more
than 10 % of a configuration's runs are excluded, the outcome is F0 for that
configuration.

**Checkpointing.** Per-run checkpoint and resume, as in the Item 3 harness.
Resumed runs must be byte-identical to uninterrupted ones (a test).

### 11.7 Extension, blinding, multiplicity

**Extension.** One extension only. It applies when a primary is
INCONCLUSIVE **and** its point estimate lies inside the margin.

- The seed count doubles, using that configuration's reserve.
- The final interval is 97.5 %, Bonferroni over two looks.
- No other additional data are permitted.

**Blinding.**

- Universe B pilots on design seeds may record:
  - timing;
  - ledgers;
  - stability flags;
  - **seed-to-seed standard errors with central values suppressed** by the
    pilot script, which never prints or stores them.
- Universe A pilots are unrestricted: A is the reference, not under test.
- Universe B observables are first computed by the pre-registered scripts,
  after gate G5.

**Multiplicity.** Each primary is its own gate. The verdict requires all of
them.

- The chance of a false PASS on any one gate is ≤ 2.5 % per side, and a
  conjunction only lowers it.
- A false FAIL needs the whole CI beyond the margin, so it is negligible at
  the planned precision.
- The realistic cost of multiplicity is a spurious INCONCLUSIVE. The
  extension rule and the ⅓-margin seed rule bound it.
- No further correction is applied. This is stated, not hidden.

---

## 12. Cost, from the actual architecture

### 12.1 What one step costs in the existing code

`Simulation.step` executes, in order:

1. half kick (forces from the previous step);
2. drift;
3. `CollisionModel.resolveAll`: collision grid rebuild, pair search at
   contact cutoff, rewind-to-contact, release;
4. walls;
5. `computeForces`, then a half kick.

`OccupancyForce.computeForces` rebuilds its own `SpatialGrid` with cell
size ≥ h, then calls `forEachPairWithin(h)`.

- The visit covers each cell's internal pairs plus a half stencil of 4
  neighbouring cells.
- Candidate pairs per parcel: 4.5 n_p h² = **1.15 c_h² N_c**.
- Pairs within h: ½N_nb = **0.4 c_h² N_c**. Each costs a square root, the
  Lucy kernel and its derivative, and 4 force updates.

There is **no separate pressure solve.** The pressure enters only through
this pair force. "Pressure evaluation" for diagnostics is the virial
accumulated in the same loop, on sample steps.

Cost components per parcel-step (ESTIMATE unless stated):

| component | scaling | estimate |
|---|---|---|
| collisions (grid, search, resolve, release) | ≈ N_c⁰ | ≈ 0.15–0.3 µs. **Measured** for Universe A in Item 3: 0.18–0.33 µs per particle-step, including walls and flow diagnostics |
| occupancy grid rebuild | O(1) | ≈ 0.02–0.05 µs |
| occupancy candidates | 1.15 c_h² N_c × ≈ 6.5 ns | assumed per-candidate cost |
| occupancy pairs | 0.4 c_h² N_c × ≈ 20 ns | assumed per-pair cost |
| diagnostics | — | Stress decomposition needs one extra pair pass per sample step: about +5 % at one sample per 20 steps. Mode projections are O(N) per sample: negligible |

**N_c scaling.** For N_c ≳ 4, the cost per parcel-step grows ∝ c_h² N_c
(about 62 ns × N_c at c_h = 2). Cost per physical area per physical time
compared with Universe A is:

  cost ∝ (parcels per area ∝ 1/N_c) × (steps per time ∝ 1/N_c) × (cost per step)
  ⇒ effective gain G ≈ N_c²·c_A/c_B(N_c).

Asymptotically G ≈ 2.4 N_c at c_h = 2. With a particle-mesh occupancy
evaluation it would be ∝ N_c², but that is not part of UB-0.

At a flow speed with U ≳ σ_v, the Courant limit tightens (v_max ≈ 5σ_v + U).
G falls by up to 2× at bridging conditions.

### 12.2 Per-step estimates

| configuration | candidates | pairs in h | estimated µs per parcel-step | effective gain G (ESTIMATE) |
|---|---|---|---|---|
| Universe A | — | — | 0.15–0.3 (measured range) | 1 |
| N_c 4, c_h 2 | 18 | 6.4 | ≈ 0.45 | ≈ 5 |
| N_c 4, c_h 4 | 73 | 26 | ≈ 1.2 | ≈ 2 |
| N_c 16, c_h 2 | 73 | 26 | ≈ 1.2 | ≈ 30 |
| N_c 16, c_h 4 | 293 | 102 | ≈ 4.2 | ≈ 9 |
| N_c 64, c_h 2 | 293 | 102 | ≈ 4.3 | ≈ 140 |

### 12.3 Cost of the plan (ESTIMATE)

dt = 0.005 D/σ_v throughout. The timings are those of §12.2.

| part | runs | core-hours |
|---|---|---|
| Stage 0 (A): S-K, S-long, T (L 80 / 160 / 320), L, W, C | ≈ 210 | ≈ 7 |
| S-K (N_c 4, 16, 64; c_h 4 arm) | 4 × 24 | ≈ 7.8 (64: 4.7) |
| S-long (N_c 4, 16) | 8 | ≈ 2.5 |
| T (N_c 4, 16: 144 each; N_c 64: 6) | 294 | ≈ 12.7 (64: 7.7) |
| T-e, T-h, T-dt | 168 | ≈ 5.4 |
| L (N_c 4, 16, 64) | 12 | ≈ 2.4 (64: 1.4) |
| W (N_c 4, 16; c_h 4 arm) | 12 | ≈ 1.2 |
| C (N_c 4, 16) | 8 | ≈ 1.0 |
| B0 and blind pilots | — | ≈ 3.5 |
| **total** | | **≈ 45 core-hours** (≈ 11 h on 4 cores). N_c = 64 is ≈ 14 of them |

The uncertainty is a factor of 3 either way, until B0. The N_c = 64
transverse runs (≈ 1.3 core-hours each) need checkpointing. The large seed
counts at N_c = 4 and 16 are cheap (34–90 s per run); they are set by the
power rule of §11.2, not by convenience.

### 12.4 B0: the empirical cost benchmark

- **Design:**
  - instrumented per-phase wall-clock timers (drift, collision grid and
    resolve, walls, occupancy grid, occupancy pair loop, diagnostics);
  - static periodic boxes at N_c ∈ {1, 4, 16, 64} × c_h ∈ {2, 4}, wherever
    L ≥ 3h, at N ∈ {1630, 6520};
  - 2000 steps after a 500-step warm-up, 3 repeats, median;
  - on the machine used for the judged runs, recording the CPU model, core
    count and Node version.
- **Output:**
  - µs per parcel-step per phase;
  - a fit of cost = a + b·c_h²N_c;
  - G(N_c);
  - a comparison with §12.2, reporting whether it is within ×3. This
    replaces the previous review's P9.
- **Blind-safe:** no physics observable is computed.
- **Consequence:**
  - B0 re-budgets the run lengths only. It never changes configurations,
    seeds or thresholds.
  - Pre-declared rule: if B0 puts the N_c = 64 T runs above 4 core-hours
    per seed, those runs are **postponed, not shrunk**. The bulk verdict
    then covers N_c ≤ 16, labelled "64 not run (cost)", distinct from F6.

### 12.5 What is and is not established

**Established (measured):**

- Universe A's cost per particle-step (Item 3);
- the code paths and loop structure above.

**Not established (theory or assumption):**

- every Universe B cost;
- the per-candidate and per-pair constants;
- G(N_c);
- the plan total.

None of these may be quoted as a result until B0 has run.

---

## 13. Relation to Item 3

- **Item 3's INCONCLUSIVE stands.** UB-0 does not revisit it.
- UB-0 contains no flow with a pressure gradient, no boundary layer, no
  separation, and no wall-bounded judged quantity. **No separation discovery
  happens in UB-0.**
- The locks on airfoil optimisation, inverse design and Kutta enforcement
  remain.

Before Item 3's question could be revisited at higher Re in Universe B,
five steps must be completed in order, each separately pre-registered.

1. **UB-0 bulk PASS up to N* ≥ ≈ 60**, the N_c needed at Re_δ ≈ 170, Ma 0.3
   (previous review §5).
   - PASS-NARROW at N* = 16 still permits Re_δ ≥ ≈ 48 at Ma 0.3 within
     ε_p ≤ 0.1. But the gain is only ≈ 30 (F7c).
   - A wall verdict of F5-impl, not F5-phys.
2. **UB-1, thermal occupancy closure.** Needed unless the revisit is run at
   Ma_B ≤ 0.2, where the sound deficit's compressibility effect (∝ Ma²) is
   below the measurement tolerance. That judgement belongs to UB-2's
   pre-registration, not here.
3. **UB-0W, a derived wall term.** It must give:
   - a flat wall profile, within the residual predicted for it;
   - wall shear, slip/λ_p and temperature jump matching Universe A in a
     same-physical Couette at N_c = 4 (H ≥ 80 d).

   Separation is a wall phenomenon. Nothing wall-bounded is meaningful
   before this.
4. **UB-2, flow overlap.** A zero-pressure-gradient flat-plate boundary layer
   at N_c = 4 (and 16), compared with Universe A at the same physical
   parameters, at a Re_δ where both are valid:
   - Re_δ ≳ 12 at Ma 0.3 for N_c = 4;
   - Re_δ ≳ 48 for N_c = 16.

   Pre-registered margins on the velocity profiles and τ_w.
5. **The Newtonian window and F7 clear**, at the target conditions.

Only then could a new, separately pre-registered separation experiment be
designed in Universe B. Its result would not change Item 3's record.

---

## 14. The philosophy boundary, made checkable

The question is where "particle → parcel → wing-scale field" turns into
"continuum CFD equations implemented using particles". The pre-registration
fixes it as four lines. Each is checked and reported.

- **L1, the input line.** No transport coefficient or transport operator
  enters the model (§1.3).
  - Checked by: a code audit at gate G1, and the MODEL_ASSUMPTIONS entries.
- **L2, the calibration line.** Parameters come only from:
  - (a) Universe A equilibrium measurements (K_T,A); or
  - (b) non-controlling dimensionless choices: e and c_h, shown by robustness
    arms not to move judged observables beyond tolerance; and the inherited
    kernel shape, which is not varied and is reported as untested.

  Checked by: PQ6b and PQ6c, and the rule that no arm result ever
  re-selects a parameter. If an arm fails, the parameter is **controlling**,
  and fixing it at the "right" value would be a fit.
- **L3, the mechanism line.** Shear momentum transport is carried by parcel
  kinetic and collisional fluxes. The occupancy share must be < 20 %.
  - Checked by: PQ8.
  - Above the line, shear stress comes from an inserted pressure law. That
    is a constitutive model.
- **L4, the window line.** Judged runs stay inside ε_p ≤ 0.1 and the
  coupling window (rms force × D ≤ 0.8 kT, N_nb ≥ 12). Outside it, parcel
  kinetics is not a scaled copy of molecular kinetics. Agreement there would
  be a property of the model.
  - Checked by: configuration (§5), PQ6a and PQ6c.

**Where UB-0 sits.** UB-0 makes exactly **one declared constitutive
inheritance**: the equilibrium equation of state, through the occupancy
force. Its stage is "particle → parcel with an inherited equation of
state". It is not CFD, for three reasons:

1. the inherited quantity is an **equilibrium** property, **measured** from
   Universe A, not assumed;
2. it enters as a **force between parcels**, not as a field equation;
3. **no transport law** is inherited: ν, the stress mechanism, sound
   propagation and wall exchange must emerge.

The later steps keep this status as long as they stay equilibrium-derived.

- **UB-1:** a thermal occupancy law with Z(φ) from Universe A.
- **UB-0W:** a wall term derived as a continuation of the bulk mean field.
- **A particle-mesh evaluation** of the same occupancy force:
  - allowed if it reproduces the pair-sum mean field;
  - not allowed to introduce any velocity-field operator.

**The exact crossing point.** The crossing into "CFD wearing particle
clothing" is the **first** of these events:

- a transport input (L1);
- a controlling parameter fixed by matching (L2);
- constitutive shear transport (L3);
- operation outside the kinetic window (L4).

**For the "→ wing-scale field" step.** That crossing is forced where the
target Re requires N_c beyond the local-equilibrium bound (L4). From there
on, momentum transport can no longer be kinetic. Any further coarse-graining
is necessarily a continuum closure (previous review §3.3, §5).

The pre-registration requires every future UB experiment to state its
position against L1–L4 in a "crossing ledger". If a line is crossed, the
report must say so plainly, whatever the numbers.

---

## 15. Recommendation and pre-registration structure

### 15.1 Recommendation: **B — modify the design, then proceed**

- **Not A (proceed as sketched).** The previous design had three defects:
  - a tautological k_s calibration;
  - a wall-contaminated viscosity primary;
  - a coupling regime mislabelled as weak (§0.2).

  Run as sketched, its PASS would have been partly built in, and its FAIL
  uninterpretable.
- **Not C (reject).** No inconsistency with PFAD's philosophy was found.
  - The hypothesis is falsifiable at every primary.
  - The predicted failures are specific.
  - The one constitutive input is declared and equilibrium-derived.
- **Not D (another audit).** The remaining uncertainties cannot be settled
  by further desk analysis. They are tested by the design's own arms:
  - the mean-field error at N_c = 4 (PQ2 with the c_h arm);
  - the coupling (PQ6c);
  - the wall profile's theoretical sharpness (INCONCLUSIVE-THEORY,
    computed at G3, before data).
- **E0** (the A-06 wall-impulse audit from the after-Item-3 review) may run
  in parallel. It does not block UB-0, for two reasons:
  - UB-0's primary transport test uses no wall impulses;
  - the matched-dimensionless ratios share the same late-contact fraction
    in natural units, so the first-order A-06 bias cancels.

**The modifications**, all in this document:

1. The transverse shear-wave decay replaces Couette as the viscosity
   primary. Couette becomes secondary.
2. A standing longitudinal wave replaces the pulse, with Γ_self as the sound
   primary.
3. k_s comes from the mean-field closure and Stage 0's K_T,A.
4. The kernel rule is h = c_h√N_c D, with c_h = 2 and a c_h = 4 arm at
   N_c = 4.
5. N_c = 64 is bulk only, at L = 160 D.
6. Stress-decomposition, wall-profile and timing instrumentation are added.
7. The wall verdict is split out, with the contact-theorem identities and
   the mean-field classification.
8. B0 is added, and pilots are blind (SE-only).
9. The Stage 0 Universe A anchors are committed before the criteria.

### 15.2 The pre-registration structure

Each gate is a commit that is pushed before the next gate starts. The
proposed file names are proposals only; nothing exists yet.

| gate | content | condition to pass |
|---|---|---|
| **G0** | Acceptance of this design (a user decision) | — |
| **G1: implementation, no Universe B data** | **Map module:** N_c → M, D, k_s, h, e, ρ_rel. N_c = 1 is the identity: no occupancy, no reservoir, e = 1. **Experiments:** shear wave, longitudinal wave, static box with stress decomposition and S(k), wall box with component normal-stress profiles, Couette diagnostic. **Analysis code.** **Instrumentation** (§4.4). **Tests:** (1) N_c = 1 reduction: trajectories bit-identical to the Universe A engine for the same seed; (2) release-law mean balance on synthetic collisions; (3) stress decomposition against analytic two-body and lattice virials; (4) Fourier stress projection on a constructed field; (5) contact-theorem check in an ideal-gas wall box; (6) ledger closure with occupancy, reservoir and walls; (7) checkpoint byte-identity. **Code audit** against L1 | All tests pass. MODEL_ASSUMPTIONS entries added: the map (A-2x), the shear-wave method, the preparation rescale. MODEL_CHANGELOG updated |
| **G2: Stage 0 anchors** | Universe A runs on seeds 8001–8199, with analysis committed with the data: K_T,A, S_A(k), ν_A (L 80 / 160 / 320), c_A and Γ_A (L 160), the A wall profile, A Couette | Stage 0 report committed. These are the only reference values UB-0 uses |
| **G3: predictions** | Computed and committed: k_s per N_c; ρ_rel; Γ bands; c bands; Z_B/Z_A; exact W̃(kh); RPA S_B(k) at the run's shells; canonical mean-field wall profiles at the run geometry (local density **and** weighted density, with the INCONCLUSIVE-THEORY check); all margins | The prediction file is frozen. Any later change voids the pre-registration |
| **G4: blind pilots and B0** | Design seeds 9501–9999. Universe B: timing, ledgers, stability, SE-only. Universe A: unrestricted. B0 cost table | Run lengths, sampling intervals and the Courant number confirmed. The PQ7 drift thresholds are achievable. The 64-postponement rule is applied if triggered |
| **G5: the pre-registration** | `docs/CRITERIA_UB0_COARSE_GRAINING.md` (outline below). The checkpointed run script with explicit seed blocks. Commit and push. **No Universe B judged run before this commit** | — |
| **G6: judged runs** | At the G5 commit. Code changes are allowed only for crash or resume fixes proven byte-identical | Any other change is logged as a deviation and voids the affected configuration |
| **G7: report** | Classification by §6.4 and §7. Every primary reported, whatever the outcome. Deviations listed. The crossing ledger L1–L4 | No threshold changes. Item 1/2/3 records untouched |

**Outline of `CRITERIA_UB0_COARSE_GRAINING.md`:**

1. H_UB, H1–H5, as in §1.1.
2. The map with frozen numerical values, from G2 and G3.
3. Configurations (§4.3) and seeds (§11.1–11.2).
4. Primaries with margins and decision rules (§6.1–6.2).
5. Secondaries (§6.3).
6. Overall classification (§6.4).
7. F0–F7 and T-FAIL triggers and precedence (§7).
8. Wall classification rules (§9.3).
9. Statistics, corrections, convergence checks, exclusions, extension and
   blinding (§11).
10. Cost rules (§12.4).
11. Philosophy checks L1–L4 (§14).
12. What will be reported regardless of outcome.

### 15.3 Decisions that are the user's

1. Accept recommendation B and the ≈ 45 core-hour budget (ESTIMATE ×3).
2. Accept c_h = 2 as the baseline with a c_h = 4 arm. The alternative,
   c_h = 4 as baseline, costs ≈ 3.5× and forces N_c = 64 to L = 320 D.
3. Accept N_c = 64 as bulk only, and PQ5 at N_c ≤ 16.
4. Accept that wall transport is not tested in UB-0 and moves to UB-0W.

---

## Appendix A. Derivations used above

**A.1 Γ_self band.**

- K_B = K_kin + K_occ, with K_occ athermal.
- ΔK = K_S − K_T = T(∂P/∂T)²_ρ/(ρc_v) per unit mass, applied to the kinetic
  share.
- (∂P_kin/∂T)_ρ = n_p k Z_hc, the same Z as Universe A by §2.2.
- With heat capacity k per parcel (no exchange): ΔK = n_p kT Z² = ΔK_A/N_c.
- With N_c k per parcel (full exchange): ΔK = ΔK_A/N_c².
- Dividing by K_B = K_T,A gives the band.
- ΔK_A/K_T,A = Γ_A − 1 is measured: 0.986 from c₀ = 2.170 and the Henderson
  K_T. The Henderson benchmark alone gives Z²/(Z + φZ′) = 1.040.

**A.2 Contact theorem with a missing wall term.**

- Take the Irving–Kirkwood normal stress across a plane at height y. The
  occupancy part counts the pairs straddling y.
- For y below every parcel centre, that count is zero.
- Mechanical equilibrium makes the total normal stress y-independent. So
  the core-contact part at the wall equals the bulk total, P_B.
- The hard-wall contact theorem gives the core-contact part as n(contact)·kT.
- With P_B/(n_p kT) = Z_hc + (N_c − 1)(Z + φZ′)/2:
  - 1.57 + 3 × 1.186 = 5.13;
  - 1.57 + 15 × 1.186 = 19.4;
  - 1.57 + 63 × 1.186 = 76.3.

**A.3 Coupling measures (RPA).**

- 1/S_p(k) = 1/S_hc + β n_p k_s a W̃(k), with S_hc taken as S_A(0) = 0.422.
  This is valid for kD ≪ 1, where W̃ is non-negligible since h ≫ D.
- Fluctuation of the single-parcel occupancy energy:
  ⟨δψ²⟩ = ∫d²k/(2π)² n_p ũ² S_p.
- Force fluctuation: ⟨δF_x²⟩ = ∫d²k/(2π)² (k²/2) n_p ũ² S_p.
- In the strongly screened regime, ⟨δψ²⟩ → kT·u(0). So the rms energy is
  ≈ √Γ_c kT, independent of N_c.
- These are mean-field estimates of mean-field-violating quantities. They
  size the risk; they do not predict outcomes.

**A.4 Mean-field wall profile.**

- βμ_hc(n(y)) + β k_s a ∫W₁(y − y′) n(y′) dy′ = βμ_bulk on y ∈ [D/2, H − D/2],
  where W₁ is the Lucy kernel projected on one axis.
- βμ_hc(φ) = ln(φ/a) + ∫₀^φ (Z − 1)/φ′ dφ′ + Z − 1, with the Henderson Z.
- Solved by damped Picard iteration to a residual of 10⁻¹⁰.

## Appendix B. The preliminary numerical estimates

Two throwaway scripts evaluated the integrals of A.3 and A.4. They lived in
the session scratchpad and were not committed. The method is fully
specified above.

- The **RPA** estimate used:
  - the exact 2D Fourier transform of the Lucy kernel (numerical Hankel
    transform);
  - k integration to 30/h.
- The **wall** estimate used:
  - the grand-canonical form (bulk fixed at φ = 0.2);
  - a grid of 0.05 D;
  - a box of 8h.

  Gate G3 must recompute it in **canonical** form at the run geometry, with
  a weighted-density hard-core functional alongside the local-density one.

Both are ESTIMATES that size the predictions and the risks. They are not
predictions of record. The predictions of record are the G3 commit.
