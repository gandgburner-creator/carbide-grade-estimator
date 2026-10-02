# Design review: can Universe B bridge scale without becoming CFD?

**Status.** This is a scientific design review. It is not a pre-registration
and not an implementation.

- No physics, criterion or record was changed for it, and nothing was
  simulated.
- Every number below is either derived from PFAD's own equations or taken
  from existing records. Each is cited.
- Conventional fluid-dynamics results appear only as labelled EXTERNAL
  COMPARISONS.

---

## Summary

1. **Universe A's limit is exact, and it is a property of the model.** For
   rigid elastic disks with Maxwell walls, every bulk property is fixed by
   m, d, kT and the occupancy φ. Dimensional analysis then gives exactly

   **Re · Kn = Ma · Γ(φ)**, with Γ = ρcλ/μ depending only on φ.

   - PFAD's records give Γ ≈ 1.61 at φ = 0.1 and ≈ 1.51 at φ = 0.2.
   - EXTERNAL COMPARISON: real air has Γ ≈ 1.55. Universe A's constraint is
     the real constraint of a kinetic gas.
   - Inelastic collisions with an internal reservoir do **not** break it,
     because they add no velocity scale. Only a force with its own velocity
     scale can break it. In PFAD that is the occupancy force.
2. **Coarse-graining a parcel of N_c particles has an exact 2D answer for
   viscosity.**
   - Take parcel mass M = N_c·m, diameter D = √N_c·d, the same φ and the true
     temperature. This is an exact symmetry of the hard-disk model.
   - Under it, **density, dynamic viscosity, kinematic viscosity and the
     wall slip length measured in mean free paths are all invariant**. No
     viscosity has to be prescribed.
   - The kinetic pressure falls by 1/N_c and the kinetic sound speed by
     1/√N_c. The missing (1 − 1/N_c) of the pressure belongs to the parcel's
     internal degrees of freedom and must come from a non-kinetic force.
3. **For pressure and sound, the existing PFAD equations are insufficient.**
   - The occupancy law is **athermal**: its strength k_s does not depend on
     temperature. It can reproduce the medium's isothermal stiffness or its
     adiabatic stiffness, but not both.
   - At φ = 0.2 these differ by γ ≈ 2.04 (c_T = 1.540 vs c_s = 2.199,
     EXPERIMENT_LOG benchmarks). One of {sound speed, static compressibility,
     density fluctuations} will be wrong by that factor.
   - Its functional form fits the equation of state's slope at one state,
     not the curve.
   - Walls do not take part in the occupancy sum.
   - A consistent law exists: pressure tied to the parcel's internal
     temperature, P = n kT_int Z(φ) inherited from Universe A. That is a
     **model change** and would have to be pre-registered as a new
     hypothesis.
4. **Universe B moves the constraint; it does not remove it.** Two physical
   conditions bound the gain:
   - **Local equilibrium.** Parcels must stay near equilibrium under shear:
     ε_p = Kn_δ,p · M_p ≪ 1, where M_p is the flow speed in units of the
     parcel random speed. The bridging factor is bounded by
     √N_c ≲ √(ε a Re_δ) / (2.2 Ma).
   - **Weak coupling.** For the viscosity inheritance in (2) to hold, the
     occupancy kernel must be wide: h ≳ 2√N_c · D. That costs ∝ N_c
     neighbours per parcel and smooths pressure over ≈ 2N_c molecular
     diameters.
5. **Net effect.** Universe B could make the regime Item 3 needs
   (Re_plate ~ 10⁴ at Ma ≈ 0.3) reachable in core-weeks (core-days with a
   particle-mesh pressure evaluation) rather than the core-millennia
   Universe A would need for equal precision. Most of the gain comes from the physically correct
   1/√N_c reduction of thermal noise and from removing Universe A's
   low-Mach penalty.
   - It does not reach wing Reynolds numbers.
   - Beyond the local-equilibrium window, or in strong coupling, momentum
     diffusion stops being emergent and has to be inserted. That is the
     honest boundary where Universe B would become CFD in particle clothing.
6. **Verdict on philosophy.** Universe B is **not** theoretically
   inconsistent with PFAD. Its legitimate form is a **derived
   coarse-graining**:
   - one pre-declared map from Universe A;
   - one inherited constitutive element: the equation-of-state stiffness,
     measured statically in Universe A;
   - everything else predicted and tested: sound speed, viscosity, wall
     slip, fluctuations, conservation.

   A minimal experiment, UB-0 (§7), can test that cheaply. The theory makes
   specific predictions, **including two predicted failures**: the γ
   mismatch, and the near-wall artefact. Their pattern would itself be
   evidence.

---

## 1. What Universe B must preserve, and what would be inserted

"Emergent" means the property follows from parcel dynamics under the
coarse-graining map with no parameter chosen to produce it. "Inherited" means
a parcel-level law whose coefficient is measured in Universe A and carried
over by a fixed rule. "Inserted" means a coefficient chosen to produce a
target.

| # | property | in a consistent Universe B | status |
|---|---|---|---|
| 1 | Mass conservation | Exact: parcel count and mass. | **preserved** (by construction) |
| 2 | Momentum conservation | Exact: pairwise impulses, pairwise antisymmetric occupancy forces, ledgered walls. | **preserved** |
| 3 | Energy accounting | Kinetic + internal reservoir (A-16, exact) + occupancy potential. The occupancy force is velocity-Verlet integrated, so the ledger closes to O(dt²), not round-off (A-15). | **preserved, weaker** — the residual must be bounded against physical heating rates |
| 4 | Pressure from momentum transfer | The *mechanism* stays pairwise momentum exchange. But only 1/N_c of the pressure comes from parcel random motion and collisions; (N_c − 1)/N_c comes from the occupancy force, whose stiffness must match Universe A's equation of state. | **mechanism emergent, magnitude inherited** |
| 5 | Sound propagation | It emerges from the parcel dynamics given the pressure law. Its speed is set by the inherited stiffness. With the current athermal law it **cannot** match Universe A's adiabatic speed and static compressibility at once (§4). | **emergent propagation, inherited stiffness; current law insufficient** |
| 6 | Momentum diffusion / viscosity | Emergent from parcel kinetics and **exactly invariant** under the map in 2D (§3). Holds only (a) inside the local-equilibrium window ε_p ≪ 1 and (b) when the occupancy force is weakly coupled. Outside either, viscosity is no longer derivable. | **emergent, conditionally** |
| 7 | Wall momentum transfer | The same Maxwell law applies to parcels: re-emission at kT_w gives parcel thermal speed √(kT_w/M), consistent with equipartition. Slip length / λ_p is invariant (§3). **But** walls do not enter the occupancy sum (`OccupancyModel.ts`), so parcels within h of a wall see a truncated density. | **emergent, plus a known artefact needing a wall treatment** (a modelling choice) |
| 8 | Thermal fluctuations | Parcel velocity variance kT/M ∝ 1/N_c: the correct fluctuating-hydrodynamics scaling, kept by equipartition with the reservoir. Density fluctuations S(0) come out right only if the pressure law is thermodynamically consistent. Pressure fluctuations at scales below h are smoothed away by construction. | **emergent at scales ≫ h** |
| 9 | Density / occupancy | Parcel occupancy φ_p = φ by the map. The occupancy field is defined at resolution h. Strong k_s risks clustering or crystallisation. | **emergent, must be monitored** |
| 10 | Parcel-scale independence | Bulk observables must be independent of N_c inside the validity window. Near-wall quantities depend on Kn_p = λ_p/L, which grows as √N_c at fixed geometry, so they are N_c-independent only along a series that holds Kn_p fixed (§9). | **testable, not automatic** |

**The critical distinction.** Momentum diffusion (6) and wall transfer (7)
can stay emergent. The equation of state behind (4) and (5) cannot: a parcel
that stands for N_c particles must be given the pressure of its N_c − 1
internal degrees of freedom by some law. The scientific question is whether
that one inherited law, fixed by a static measurement in Universe A, then
**predicts** everything else.

---

## 2. Re·Kn = Ma·Γ — verified from PFAD's own model

**The scaling argument.** The Universe A equations of motion are rigid disk
collisions (impulse law, e = 1), Maxwell walls (Aw, kT_w) and free flight.
They contain only:

- the particle mass m;
- the diameter d;
- the temperature kT;
- the occupancy φ (dimensionless);
- the wall parameters Aw and kT_w/kT (dimensionless).

Every bulk transport or thermodynamic quantity is therefore a power-law
prefactor times a function of φ:

| quantity | form |
|---|---|
| mass density ρ | (m/d²)(4φ/π) |
| sound speed c | √(kT/m) · F_c(φ) |
| 2D dynamic viscosity μ (units M/T) | √(m kT)/d · F_μ(φ) — the only combination with those units |
| mean free path λ | d · F_λ(φ) |
| 2D pressure P | (kT/d²) · F_P(φ) |

Then

  Γ ≡ ρ c λ / μ = (4φ/π) F_c F_λ / F_μ,

which depends on **φ only**. Since Re = ρUL/μ, Kn = λ/L and Ma = U/c:

  **Re · Kn = Ma · Γ(φ)** — exact for Universe A.

It needs no gas-dynamics assumption, only the absence of any other scale in
the model. Two consequences:

- Re per particle diameter at fixed Mach, Ψ = ρcd/μ = Γ/F_λ, is also a
  function of φ only.
- Changing m, d or kT cannot change Γ or Ψ. Only φ can.

**Checks against existing records.**

| claim | record | result |
|---|---|---|
| μ ∝ √kT | `viscosity_sweeps` | kT_w = 4 gives 0.640, vs 2 × 0.325 → ratio 1.97 |
| μ ∝ 1/d at fixed φ, m | `viscosity_sweeps` | radius 0.35 gives 0.446 ± 0.026, vs predicted 0.475 (−6 %, 1.1 SE) |
| c independent of d at fixed φ | pulse sweeps | radius 0.5 / 0.35 / 0.25 → 2.40 / 2.40 / 2.43 |
| Γ(0.1) | ρ 0.1273, c 1.81, λ 2.32, μ 0.3326 | **1.61** |
| Γ(0.2) | ρ 0.2546, c 2.170, λ 0.96, μ 0.351 | **1.51** (μ ± 9 %) |
| Ψ(0.2) | | 1.57; Enskog estimates give only ≈ 2 at φ = 0.6 (EXTERNAL COMPARISON) |
| air | c 343 m/s, λ 68 nm, ν 1.5 × 10⁻⁵ m²/s | **Γ ≈ 1.55** (EXTERNAL COMPARISON) |

The mean free paths come from the Couette Kn = λ/H at H = 40.

**Is it model-dependent?** Yes, in a precise way. It holds for **every PFAD
configuration that introduces no velocity scale of its own**:

| configuration | breaks the constraint? |
|---|---|
| Universe A (rigid elastic disks, Maxwell walls) | no |
| inelastic collisions + internal reservoir (A-07, A-16) | no — e and the release fraction are dimensionless, so the medium stays kinetic. Pulse model C (e = 0.9 + reservoir) gave c = 2.377 ± 0.056, indistinguishable from model A |
| soft contact with stiffness K (A-13) | in principle; in practice only in a jammed, solid-like state at the densities of interest |
| **occupancy force** F = −k_s∇φ (A-15) | **yes** — it adds the velocity scale √(k_s/M) |

The occupancy force's sound speed is measured as
c² = 1.393 k_s φ/m + 0.13 at kT = 0.05: sound speed decoupled from
temperature (EXPERIMENT_LOG §5.2). **This is the central theoretical
justification for Universe B, and the only one available inside PFAD.**

---

## 3. A parcel of N_c particles: derived scaling laws

The scaling argument of §2 implies an exact symmetry of the hard-disk model:

  m → N_c m,  d → √N_c d,  at fixed φ and fixed kT.

Applying it gives three possible coarse-grainings. Only one is consistent.

### 3.1 The consistent map: parcels at the true temperature and the same packing

| quantity | parcel / particle | derivation |
|---|---|---|
| mass M | N_c | conservation |
| diameter D (collision cross-section, 2D) | √N_c | keeps φ_p = φ (a declared choice) |
| number density | 1/N_c | |
| mass density ρ | **1** | (N_c m)·(n/N_c) |
| centre-of-mass random speed σ_v | 1/√N_c | equipartition: M σ_v² = kT |
| internal energy per parcel | (N_c − 1) kT | the internal translational degrees of freedom (2D) |
| collisions per parcel per unit time | 1/N_c | √(kT/M)/D · F_ν(φ) |
| mean free path λ_p | √N_c (λ_p/D unchanged) | D · F_λ(φ) |
| dynamic viscosity μ | **1** | √(M kT)/D = √(m kT)/d |
| kinematic viscosity ν | **1** | |
| slip length / λ_p | **1** | Maxwell wall at kT_w: parcels re-emit at √(kT_w/M) |
| kinetic + collisional pressure | **1/N_c** | (kT/D²) F_P(φ) |
| sound speed of parcel kinetics alone | **1/√N_c** | √(kT/M) F_c(φ) |
| pressure that must come from elsewhere | 1 − 1/N_c of P_A | the internal degrees of freedom |
| occupancy stiffness k_s needed | ∝ N_c(1 − 1/N_c) | from c² ≈ 1.39 k_s φ/M, or better from the static P(φ) slope |
| restitution e | not fixed by the map | sets the kinetic ↔ internal exchange rate |
| reservoir release fraction | **derived**: (1 − e²)/(2(N_c − 1)) | equilibrium of A-16 at T_kin = T_int (collision-weighted ⟨½μv_n²⟩ = kT) |
| contact stiffness | stays rigid | a finite K would add a scale |
| velocity fluctuations per parcel | 1/√N_c | correct fluctuating-hydrodynamics scaling |
| density fluctuations S(0) | 1/N_c | only if the pressure law matches the isothermal compressibility |
| timestep (sound-limited) | √N_c | dt ~ D/c |

In 3D the same map gives μ ∝ N_c^(−1/6): the viscosity invariance is
specific to 2D.

**What this says.**

- In 2D, a parcel gas at the correct temperature and packing has **exactly
  Universe A's viscosity, density and dimensionless wall slip**, with
  nothing prescribed. Viscosity is not an inserted parameter.
- What the map does **not** give is pressure: parcel random motion carries
  1/N_c of it, because most of the random kinetic energy is internal to
  parcels.
- So the answer to "can N_c change without prescribing viscosity and sound
  speed?" is **yes for viscosity and no for sound speed**. Sound speed needs
  an inherited pressure law.

### 3.2 "Hot" parcels (DSMC-like): rejected

Give parcels the full molecular random speed (kinetic temperature N_c kT):

- Pressure and sound speed come out right.
- But μ scales up by √N_c, and the thermal noise stays at the molecular
  level.
- It is Universe A at a coarser resolution: Γ is unchanged and the effective
  Re is lower.

DSMC proper keeps λ molecular by scaling collision probabilities. It is still
kinetic, Γ is still unchanged, and Universe A at φ = 0.2 already has ≈ 0.25
particles per λ², fewer than DSMC's ~10 per cell. **Kinetic coarse-graining
cannot reduce Universe A's cost.**

### 3.3 Dense or dissipative parcels: the non-kinetic end

Make parcels collision-dominated (high φ_p), or give them a friction law:

- Re per element is no longer tied to Kn, so Re can be arbitrary.
- But momentum diffusion is then set by a dissipative coefficient that must
  be matched to Universe A's viscosity. That coefficient is **inherited at
  best, inserted at worst**.
- This is the smoothed-dissipative-particle family: a Lagrangian
  discretisation of continuum constitutive laws.

It is the honest boundary of the "CFD in particle clothing" concern (§5).

---

## 4. Where the existing PFAD equations are insufficient

1. **The occupancy law is athermal.**
   - Universe A's sound is adiabatic: c₀ = 2.170 measured, 2.199 benchmark.
     Its static compressibility and density fluctuations are isothermal:
     c_T = 1.540. At φ = 0.2, γ = (2.199/1.540)² ≈ 2.04.
   - A temperature-independent k_s gives a barotropic parcel fluid. The
     reservoir's large heat capacity also makes the kinetic share
     effectively isothermal.
   - So one inherited k_s reproduces **either** the isothermal response
     (then c_B ≈ 0.71–0.79 c_A, a predicted failure of sound speed) **or**
     the adiabatic response (then static compressibility and S(0) are off by
     ≈ 2).
   - A consistent law would tie the occupancy pressure to the parcel's
     internal temperature, P_occ = (1 − 1/N_c) n kT_int Z(φ), with
     compression work going into internal energy. Hard-disk scaling makes
     the form P = n kT Z(φ) exact, so this law would be **fully inherited**
     from Universe A's measured Z(φ), with no free parameter.
   - It is a model change (a thermal occupancy law, with a new energy
     bookkeeping path) and would need its own pre-registration.
2. **The occupancy force has one fixed functional form.** It can match the
   equation of state's slope (bulk modulus) at one state, not its curve. That
   is adequate for small density variations (low Ma), not for strong
   compressions.
3. **Walls do not contribute to the occupancy sum.**
   - Parcels within h of a wall see a lower φ. The force then pushes them
     toward the wall until collisions balance it.
   - Momentum conservation still makes the wall impulse pressure equal the
     bulk pressure, but through a distorted near-wall density layer about h
     thick.
   - A wall treatment (image parcels or a wall density field) is a modelling
     choice that would itself have to be tested.
4. **Weak coupling has a cost.** The viscosity inheritance in §3.1 needs the
   occupancy force to act as a smooth background, not as stiff pair
   interactions.
   - The occupancy energy per parcel is ≈ M c²/1.39 ≈ 3.4 N_c kT. Its
     fluctuation over one parcel displacement is ≈ 3.8 N_c (D/h)² kT. Keeping
     that ≲ kT needs h/D ≳ 2√N_c: a kernel spanning ≈ 2N_c molecular
     diameters, with ≈ 3 N_c neighbours per parcel.
   - In the opposite, strongly coupled regime (h ≈ 3–4 D), parcels sit in a
     rugged energy landscape. Viscosity is then a soft-liquid property that
     is **not derivable**, and crystallisation is possible.
5. **The reservoir is derivable but has one free rate.** Equilibrium fixes
   the release fraction given e (§3.1). The value of e only sets how fast
   heat moves from parcel motion to the reservoir. It must be shown
   irrelevant within a range; otherwise it is a hidden viscosity knob.
   - Viscous heating per parcel collision is ≈ ε_p² kT (§5), so
     (1 − e²) ≫ ε_p² is needed: e ≲ 0.95 for ε_p ≤ 0.1.
   - Pulse model D (occupancy without the reservoir) cooled from 1 to 0.12.
     The reservoir is not optional.

---

## 5. The validity window: why the constraint moves rather than vanishes

**Local equilibrium (Newtonian parcel kinetics).** The parcel gas has a
Newtonian stress only if the velocity change across one parcel mean free path
is small against the parcel random speed:

  ε_p = λ_p γ̇ / σ_v ≈ Kn_δ,p · M_p,  with M_p = U/σ_v.

With ν = a λ_p σ_v and Re_δ = Uδ/ν. From §2's data, a = ν/(λσ_v) ≈ 1.379/0.96 ≈ 1.44 at
φ = 0.2 (collisional transfer makes it larger than the dilute-gas value):

  **Re_δ · Kn_δ,p = M_p / a** — von Kármán's relation with the **parcel
  thermal Mach number** in place of the acoustic one;

  **ε_p = M_p² / (a Re_δ)**.

- In Universe A, M_p = (c/σ) Ma ≈ 2.2 Ma. Item 3 had ε ≈ 0.05.
- In Universe B, M_p ≈ 2.2 Ma √N_c. The occupancy force keeps the acoustic
  Mach number low while the kinetic transport runs at M_p.
- Holding ε_p ≲ 0.1:

  **N_c ≲ ε a Re_δ / (2.2 Ma)²**.

| regime | allowed N_c |
|---|---|
| Item 3 (Re_δ ≈ 15, Ma 0.5) | ≲ 2 — **Universe B cannot help at Item 3's own scale** |
| Re_δ ≈ 170 (Re_plate ≈ 10⁴), Ma 0.3 | ≈ 60 |
| Re_δ ≈ 10³, Ma 0.3 | ≈ 340 |

Beyond the window, the parcel gas behaves like a rapidly sheared granular
medium: the stress grows as γ̇², which is a measurable failure.

**The gain grows only as Re_δ^(1/2).** Universe B is self-consistent only
where the target Re is already high. Its bridging factor √N_c is bounded by
the parcel-Mach condition. Together with the weak-coupling kernel of §4, that
is why it **moves** the constraint (from acoustic Mach to parcel thermal
Mach, plus a kernel-width cost) rather than eliminating it.

**The honest boundary.** To go beyond the window, momentum transport must
stop being kinetic, which means §3.3: an inherited or inserted dissipative
coefficient. From there on the parcel model is a particle discretisation of
continuum constitutive laws. If PFAD ever uses that regime, it should say so
plainly.

---

## 6. Computational economics

Costs are per seed at a fixed number of flow-throughs, calibrated on
Item 3's strong case (16 399 particles, 2360 core-s, 0.18–0.33 µs per
particle-step). The noise factor is the number of samples needed for a fixed
relative precision of a mean velocity: per-sample signal-to-noise ∝ U/σ.

**Universe A.**

- L/λ = Re/(Ma Γ).
- Steps per flow-through ∝ (L/d)/Ma, because the timestep is set by the
  thermal speed.
- Time-stepping cost ∝ Re³/(Γ³ Ma⁴). Including noise ∝ Re³/Ma⁶.

**Universe B — kinetic, weak coupling, ε_p held fixed.**

- L/λ_p = a Re/M_p, with M_p = √(ε a Re_δ) ∝ Re^(1/4).
- Parcels ∝ (L/λ_p)². Steps ∝ (L/D)/Ma.
- Neighbours per parcel ≈ 3 N_c, with N_c = (M_p/(2.2 Ma))².
- Per-sample noise ∝ 1/M_p.
- Effective cost (including noise) ∝ a³ Re³/(M_p³ Ma³) ∝ **Re^2.25 / Ma³**,
  against Universe A's Re³/Ma⁶.

**Worked example: Re_plate = 10⁴, Ma = 0.3, ε_p = 0.1, Item-3-like geometry.**

| | Universe A | Universe B |
|---|---|---|
| scale | geometry ×53 in diameters | M_p ≈ 4.9, N_c ≈ 58; L/λ_p ≈ 2900 (domain ×7 in parcel units) |
| elements | ≈ 4.6 × 10⁷ particles | ≈ 8 × 10⁵ parcels |
| per-step cost | 0.18–0.33 µs per particle | ≈ 4 µs per parcel (≈ 185 occupancy pairs + collisions); ≈ 0.3 µs with a particle-mesh pressure |
| run length | ≈ 1.7× more steps per flow-through | ≈ 1.3 × 10⁶ steps |
| time-stepping cost | ≈ 20 core-years per seed | ≈ 50 core-days per seed (≈ 4 with particle-mesh) |
| signal-to-noise for a reverse flow of 0.05 U | ≈ 0.03 per sample | ≈ 0.25 per sample (~55× fewer samples) |
| effective cost (equal precision) | ~10³ core-years | **~1–2 core-months** (≈ 1 week with particle-mesh) |

**Wing scale (Re ≈ 10⁶).** Universe B's Re^2.25 scaling gives ~10³–10⁴
core-years. It is unreachable with uniform resolution.

**Conclusion.**

- Kinetic Universe B could buy roughly four orders of magnitude in effective
  cost at Re ~ 10⁴. Most of that comes from the noise term and the Mach
  penalty, not the time-stepping.
- It extends the reachable Re by about one decade at practical cost (Re_plate
  10³ → 10⁴), at Ma ≈ 0.3 rather than 0.5.
- A particle-mesh evaluation of the occupancy force would remove the
  N_c-neighbour factor, but that is a numerical choice to validate
  separately.
- Re 10⁵–10⁶ needs adaptive resolution (Path C), non-kinetic transport, or
  both.

All numbers here are scaling estimates. UB-0 measures the real ones.

---

## 7. The smallest Universe B experiment: UB-0, the coarse-graining consistency test

**Purpose.** Not to make Universe B agree with Universe A, but to test
whether **one pre-declared coarse-graining map** predicts several
observables at once, and whether it fails exactly where the theory says it
must.

### 7.1 The map, fixed before any Universe B run

- **Mass, size, temperature.** M = N_c m; D = √N_c d; φ_p = 0.2; parcel
  kinetic temperature = internal temperature = kT = 1.
- **Internal energy.** (N_c − 1) kT per parcel in the reservoir.
- **Collisions.** Rigid parcel cores, e = 0.9. Release fraction
  (1 − e²)/(2(N_c − 1)), derived (§3.1), not tuned.
- **Occupancy force.** The **existing** athermal law (A-15) with kernel
  width h = 2√N_c · D, the weak-coupling rule (§4).
- **k_s.** Chosen so that the parcel fluid's own **static isothermal bulk
  modulus** at φ = 0.2 equals Universe A's, which is measured from static
  boxes at φ = 0.18, 0.20 and 0.22.
  - This is the single inherited constant. It is fixed from a **static**
    measurement, never from a sound or viscosity measurement.
  - The occupancy force's own pressure–φ relation is measured once in a
    static box.
- **Coarse-graining ratios.** N_c ∈ {4, 16, 64}. Universe A at N_c = 1 is
  the anchor.

### 7.2 Configurations

All use existing experiment types: static box, small-amplitude pulse,
Couette.

| part | configuration | Universe A anchor |
|---|---|---|
| A. pressure | Static boxes with walls. Measure wall-impulse pressure, bulk virial pressure (kinetic + collisional + occupancy) and the near-wall density profile | static boxes at φ = 0.18 / 0.20 / 0.22, a new short run (needed anyway for k_s) |
| B. sound | Periodic small-amplitude pulse (Item 2 method, one small amplitude) | Item 2: c₀ = 2.170 |
| C. viscosity | Couette at **two shear rates**, spanning ε_p ≈ 0.03–0.3, so the Newtonian range and its breakdown are both measured | φ = 0.2 Couette: the existing 4-seed value 0.351 ± 0.033 is too imprecise; a ~30-seed anchor run is needed |
| D. wall transfer | Couette wall shear, slip length, and the near-wall density and occupancy profile | the same Couette run |
| E. conservation | Momentum residual; energy ledger (kinetic + internal + occupancy potential + wall heat) at two timesteps, to show O(dt²) drift | — |
| F. fluctuations | Parcel velocity variance; low-wavenumber structure factor S(k → 0) | static-box S(0) |
| G. structure | Pair correlation g(r), bond-orientational order ψ₆, parcel self-diffusion | — |
| H. cost | Core-seconds per parcel-step against neighbour count; timestep | — |

### 7.3 Robustness arms

These are falsification arms, not tuning arms.

- At N_c = 16: e ∈ {0.8, 0.95}, with the release fraction re-derived each
  time. Viscosity, sound speed and slip must not move.
- At N_c = 16: **strong coupling**, h = 3D. Predicted: viscosity deviates
  and structure may order.
- At N_c = 64: a timestep arm for the energy drift.

### 7.4 Pre-stated predictions

Every outcome is a test of the theory, including the predicted failures.

| # | prediction (from §3–§5) | if it fails |
|---|---|---|
| P1 | M⟨v′²⟩/2 per degree of freedom = kT_int within a few %, at every N_c | the release law does not hold equipartition |
| P2 | ν_B / ν_A = 1 within ±10 % at ε_p ≤ 0.1, for every N_c (weak coupling) | viscosity is not inherited; it is a parcel-model property |
| P3 | Couette stress ∝ γ̇ up to ε_p ~ 0.1, rising faster than γ̇ by ε_p ~ 0.3 | the validity window is not where the theory puts it |
| P4 | **Predicted failure.** c_B ≈ √((1 − 1/N_c) c_T² + c_kin²/N_c) ≈ 0.71–0.79 c_A, i.e. ≈ c_T (the kinetic share is adiabatic or isothermal depending on the exchange rate). But c_B² should equal ∂P/∂ρ from **the same parcel fluid's** static equation of state | if c_B ≈ c_A, something unaccounted for supplies the adiabatic response; if c_B disagrees with its own static stiffness, sound is not emerging consistently from the pressure law |
| P5 | N_c · S_B(0) = S_A(0) (isothermal calibration) | the inherited stiffness is not acting as a compressibility |
| P6 | **Predicted failure, for the current code.** Slip / λ_p = Universe A's slip / λ only outside a near-wall layer ≈ h thick, where the occupancy truncation distorts the density | its size and sign measure what a wall treatment must fix |
| P7 | Momentum residual at round-off; energy drift ∝ dt², small against Couette heating | conservation is not adequate for flow work |
| P8 | Liquid-like g(r), no ψ₆ order, finite self-diffusion under weak coupling | parcels cluster or crystallise |
| P9 | Measured cost per physical area and time, against Universe A, follows §6 within a factor of ~3 | the economics are wrong |
| P10 | Strong-coupling arm: P2 fails (viscosity ≠ ν_A) | if it passes, the weak-coupling requirement was over-cautious and cheaper kernels are allowed |

**Cost.**

- Static boxes and pulses: minutes each.
- Couette at N_c = 64 with h = 16D (≈ 200 neighbours) dominates. Use a narrow
  channel (H ≈ 20 D): ≈ 10³–10⁴ core-s per seed.
- The Universe A φ = 0.2 Couette anchor (~30 seeds) and static runs: a few
  core-hours.
- **Total ≈ 2–3 core-days**, i.e. ≈ 1 day on 4 cores. No flow-scale run.

**What a positive outcome looks like.**

- P1, P2, P3, P5, P7, P8 and P9 hold.
- P4 fails by the predicted γ factor, and P6 fails as a near-wall layer
  ≈ h thick.

That pattern confirms the coarse-graining theory. It also identifies exactly
**two** required model extensions — a thermal occupancy law and a wall
occupancy treatment — and nothing else.

**What a negative outcome looks like.** P2 fails under weak coupling, or
results need a different parameter per observable. Then Universe B in its
bottom-up form does not exist in PFAD, and Path A or an explicitly
continuum Path C are the only options.

---

## 8. Comparison matrix, Universe A vs Universe B

All entries are dimensionless, in molecular units (m, d, kT) unless stated.
"A" is measured. "B prediction" is §3–§5. "B measured" is filled by UB-0.

| observable | dimensionless form | A (measured) | B prediction |
|---|---|---|---|
| pressure | Z = P/(n_mol kT); K_T/(n_mol kT) | static box at φ = 0.2 (to run) | K_T equal by construction. Z offset predicted from the occupancy form |
| sound speed | c/√(kT/m) | 2.170 ± 0.038 (Item 2) | ≈ 1.6 (athermal law); equal to √(∂P/∂ρ) of B itself |
| viscosity | ν/(d√(kT/m)); μd/√(mkT) | 0.351 ± 0.033 → 1.38 (needs a precise anchor) | equal, at ε_p ≤ 0.1 |
| Newtonian range | τ/γ̇ vs ε | flat (A sweeps: independent of shear rate within errors) | flat to ε_p ~ 0.1 |
| wall transfer | slip/λ; τ_w/(ρ c_th u_slip) | Couette anchor | equal outside a ≈ h layer |
| energy | relative ledger residual; drift per time / heating | ~10⁻¹³ | O(dt²), bounded |
| momentum | relative residual | ~10⁻¹³ | round-off |
| velocity fluctuations | M⟨v′²⟩/(2 kT) | 1 | 1 |
| density fluctuations | N_c · S(0) | static box | equal to A |
| structure | g(contact), ψ₆, D_self/(λ c_th) | hard-disk fluid | fluid (weak coupling) |
| bridging figure | Re·Kn/Ma | Γ = 1.51 | Γ · √N_c · (c_B/c_A) |
| noise | per-sample signal-to-noise at fixed Ma | ∝ Ma | ∝ Ma √N_c |
| cost | core-s per molecular area per molecular time; per useful precision | measured | §6, within ×3 |

The question the matrix answers is whether the **relationships** survive:
viscosity independent of N_c, sound consistent with the same fluid's
compressibility, slip proportional to λ_p, fluctuations at equipartition.
Equal numbers alone would not settle it.

---

## 9. The scale series, if UB-0 succeeds

**Dimensionless groups.**

| group | definition | role |
|---|---|---|
| Ma | U/c | acoustic Mach |
| Re | UL/ν | Reynolds number |
| Kn_p | λ_p/L, or Kn_δ,p near walls | Knudsen number of the parcel gas |
| M_p | U/σ_v | parcel thermal Mach |
| ε_p | Kn_δ,p · M_p | local equilibrium |
| φ_p | | parcel occupancy |
| h/D | | kernel width in parcel diameters |
| Aw, kT_w/kT | | wall parameters |
| N_c | | coarse-graining ratio |

**The identities that tie them.**

- Re · Kn_p = M_p/a.
- M_p = Ma · (c/c_th) · √N_c.
- ε_p = M_p²/(a Re_δ).
- Universe A is the case N_c = 1.

**What can be held simultaneously.**

- At fixed φ_p, h/D and Aw, a run has exactly **two free knobs beyond the
  geometry: N_c and the element count (L/D)**.
- So any **two** of {Ma, Re, Kn_p, ε_p} can be held, plus the geometry.
  Universe A has only one knob (L/d) and can hold only one of them besides
  Ma.
- Kn_p and M_p cannot be held independently of Re and ε_p.

**Proposed series** (ratios not chosen yet):

| series | holds | varies | tests |
|---|---|---|---|
| **A-series** (Universe A, ½× / 1× / 2×) | Ma, φ, Aw, geometry | Re ∝ s, Kn ∝ 1/s, ε ∝ s^(−1/2) | the anchor and the overlap; the reduced E2 of the previous review |
| **S1, "same physical problem"** (B, several N_c including N_c = 1) | Ma, Re, geometry | Kn_p ∝ √N_c, ε_p ∝ N_c | N_c-independence inside the window and the predicted breakdown beyond it. Only small N_c is valid at affordable Re |
| **S2, "bridging"** (B) | Ma, ε_p, φ_p, h/D | Re (geometric steps); N_c and parcel count follow | spends exactly the kinetic resolution local equilibrium requires; leads to Re_plate 10³–10⁴ |

**The overlap problem.** A flow-level comparison between the universes is
possible only where Universe A is affordable and ε_p ≤ 0.1. That confines it
to N_c ≈ 4 at Re_δ ≈ 50 and Ma ≈ 0.3. For example, a developing channel
flow or flat-plate layer, with Universe A at a few core-days.

Beyond that, Universe B results rest on three things:

1. bulk-property inheritance (UB-0);
2. internal N_c-independence (S1 between N_c values that are both valid);
3. continuity of the S2 series.

That is a weaker chain of evidence than Universe A's, and it should be
stated as such.

---

## 10. How Universe B could fail

1. **Viscosity becomes an inserted parameter.** ν_B depends on e, on h/D, or
   on N_c under weak coupling (P2, P10, robustness arms).
2. **Sound no longer emerges.** c_B disagrees with its own static stiffness
   (P4, internal consistency).
3. **Pressure fluctuations are destroyed.** S(k) is wrong at kh ≪ 1, beyond
   the predicted smoothing at kh ≳ 1 (P5).
4. **Wall interaction becomes arbitrary.** Slip/λ_p deviates outside the
   near-wall layer, or the layer's distortion depends on choices with no
   derivation (P6).
5. **Energy conservation breaks.** Occupancy-integration drift is
   comparable to physical heating, or the reservoir fails to hold
   equipartition under shear (P1, P7).
6. **Parcel collisions give non-physical transport.** The stress is
   non-Newtonian inside the predicted window, or parcel self-diffusion is
   inconsistent with Universe A's (Schmidt number) (P3, G).
7. **Results depend strongly on parcel size.** S1 shows N_c-dependence
   inside the window.
8. **Different properties need independent tuning.** Any second inherited
   constant beyond the static stiffness means the coarse-graining has no
   predictive content.
9. **Clustering or crystallisation** (P8).
10. **The economics fail.** Neighbour sums or timestep limits erase the gain
    (P9).
11. **The theory itself is wrong.** The predicted failures (P4, P6) do not
    occur, or occur with different magnitudes. Then the scaling analysis
    above is wrong and must be revisited before anything is built on it.

---

## 11. Relationship to Item 3

**What Universe B would make testable.** The stall → reverse flow → coherent
recirculation question needs the reversed region's Reynolds/Péclet number to
be well above 1, say ≥ 30. With u_rev ~ 0.05 U and L_b ~ 0.35 L, that means
Re_plate ≈ 2 × 10³–10⁴, i.e. Re_δ ≈ 80–170.

| | Universe A | Universe B (kinetic) |
|---|---|---|
| cost at that Re | ≈ 5 core-days (Re 2 × 10³, Ma 0.5) to ≈ 20 core-years (Re 10⁴, Ma 0.3) per seed, plus ~50× noise penalties | core-weeks (core-days with particle-mesh), per §6 |
| Knudsen number in the layer | — | Kn_δ,p = M_p/(a Re_δ) ≈ 0.02 (slip ≈ 2–3 % of U, less than Item 3's 5–8 %) |
| per-sample signal-to-noise for reverse flow | — | ~15× better |
| Lagrangian residence (Bible §17) | — | meaningful: parcel self-diffusion is gas-like (Schmidt ~ 1), so Pe_b ≈ Re_b |

**What remains missing.**

1. **The near-wall occupancy artefact.** With h ≈ 2√N_c D ≈ 0.3–0.4 δ at
   N_c ≈ 25, the truncation layer occupies the inner third of the boundary
   layer, exactly where reversal happens. A validated wall treatment is a
   prerequisite.
2. **The pressure law.** The athermal law misses compressive heating
   (Item 3's +13 % kT) and has the γ inconsistency. At Ma ≈ 0.3 that may be
   tolerable, but it must be shown.
3. **Separated shear layers.** In separated flow the local γ̇ in the shear
   layer can exceed boundary-layer values, so ε_p must be checked locally,
   not just globally.
4. **The overlap ceiling.** A high-Re separation result would not be
   directly cross-checked by Universe A (§9).

---

## 12. Decision framework

### Path A — continue the Universe A scale-up

- **Physics advantages.**
  - Everything is emergent.
  - No inherited laws.
  - Items 1–3 apply directly.
  - The only numerical caveat is A-06 (previous review, E0).
- **Scientific risks.**
  - The cost law Re³/Ma⁴ (Re³/Ma⁶ with noise) caps it near
    Re_plate ≈ 10³ (s ≈ 3, ~1 core-day per seed).
  - Ma stays ≈ 0.5 (compressibility, heating).
  - The regime where coherent recirculation can be decided is out of reach.
- **Cost.** s = 2: ~5 core-h per seed. s = 3: ~18 core-h per seed.
  Re 10⁴: core-years.
- **What it would establish.** Low-Re slip-flow trends; whether near-wall
  reversal strengthens with scale; the anchor for any coarse-grained model.
- **Assumptions introduced.** None new.

### Path B — develop the derived Universe B

- **Physics advantages.**
  - Viscosity and wall transfer stay emergent: exactly invariant under the
    2D map, inside the window.
  - Thermal noise drops physically as 1/√N_c.
  - Re_plate ~ 10⁴ at Ma ≈ 0.3 in core-days.
  - It uses the Bible's own coarse-graining hypotheses (§5, §11, §13).
- **Scientific risks.**
  - The athermal pressure law is inconsistent (needs a thermal law — a model
    change).
  - The wall occupancy artefact.
  - Weak coupling requires wide kernels: cost ∝ N_c, pressure resolution
    ≈ 2N_c d.
  - Clustering.
  - The validity window caps N_c at ≈ ε a Re_δ/(2.2 Ma)².
  - Flow-level cross-validation only at small N_c.
- **Cost.** UB-0 ≈ 1 day; thermal-law and wall-treatment follow-ups ≈ days;
  the S2 series to Re 10⁴ ≈ months of core time (weeks with a particle-mesh
  pressure evaluation).
- **What it would establish.** Whether PFAD's medium admits a consistent
  coarse-grained description. If yes, whether near-wall reversal becomes
  coherent recirculation at Re_δ ~ 100–170.
- **Assumptions introduced.**
  - The coarse-graining map (φ_p = φ, h/D rule, e).
  - An inherited equation of state (one static constant, or the thermal law).
  - A wall-occupancy treatment.
  - Each is a hypothesis to pre-register.

### Path C — hybrid / multiscale

- **Physics advantages.**
  - Spend resolution only where it is needed: small N_c near walls, large
    N_c in the outer flow.
  - The 2D invariance of ρ and ν under the map means **viscosity is
    continuous across regions of different N_c**, a real theoretical asset.
  - The only particle route toward Re 10⁵–10⁶.
- **Scientific risks.**
  - Interface artefacts: fluctuation amplitude jumps by √N_c, kernel width
    jumps, spurious reflections.
  - Split/merge rules must conserve mass, momentum and energy and preserve
    fluctuation statistics (new modelling).
  - Double the validation burden.
  - It presupposes Path B's map is valid.
  - At the far end it shades into §3.3 (inserted transport).
- **Cost.** Near-wall-dominated. Potentially orders of magnitude cheaper
  than uniform B at high Re, but unknown until B is validated.
- **What it would establish.** Possibly a bottom-up bridge to
  Re ≈ 10⁵–10⁶ with molecular-scale near-wall physics.
- **Assumptions introduced.** Everything in B, plus interface and
  split/merge rules.

### How I would choose

The paths are not alternatives at the same stage. They form a dependency
chain:

- C presupposes B's map.
- B's flow-level credibility rests on A's anchor.

A's cost law shows that A alone cannot answer the Item 3 question in the
coherent-recirculation regime. So the decisive information per core-hour is
in **UB-0**, which tests the derived map in about a day with predictions
fixed in advance.

- **If UB-0 shows the predicted pattern** (P2 and P5 hold, P4 fails by γ,
  P6 shows the wall layer): the next steps are two pre-registered model
  hypotheses (the thermal occupancy law, a wall treatment), then the overlap
  test against Universe A at N_c ≈ 4, then the S2 series toward
  Re_plate ~ 10⁴, culminating in the Item 3 question.
- **If P2 fails under weak coupling:** viscosity is not inheritable in PFAD.
  Path B's bottom-up form is closed. PFAD should either accept Path A's
  low-Re scope or adopt Path C/B with explicitly inserted transport, labelled
  as continuum modelling.

The previous review's E0 (Couette wall-impulse timestep audit) remains a
cheap prerequisite for all of these. It applies to parcels too, although
their much lower collision rate per step reduces late contacts.

---

## 13. Bottom line

- **Universe A's scale limit is exact and physical** (Re·Kn = Ma·Γ, with
  Γ ≈ 1.5, the same as air).
- **Only the occupancy force can break it inside PFAD.**
- **A derived coarse-graining exists** that keeps viscosity and wall
  transfer emergent (exactly, in 2D) and inherits a single static stiffness.
- **The current occupancy law is not thermodynamically sufficient** (γ), and
  walls need a treatment.
- **The gain is real but bounded** by local equilibrium and weak coupling:
  about a decade in Re and orders of magnitude in noise. Wing Re is not
  reachable this way.
- **Universe B is not inconsistent with PFAD's philosophy.** It is
  consistent only as a *derived* model, and only inside a window that can be
  computed in advance.
- **The experiment that would show Universe B is the most promising route**
  is UB-0 producing its pre-stated pattern of passes and predicted failures
  with no parameter chosen per observable.
