# Design review after Item 3: what PFAD should do next

**Status.** This is a scientific design review. It is not a pre-registration
and not a judged result.

- Item 3 stays **INCONCLUSIVE**, exactly as classified in
  `REPORT_BOUNDARY_LAYER_SEPARATION.md`.
- No physics, criterion or record was changed for it.
- The new numbers below (R1–R7) come from read-only analysis of the existing
  Item 3 records: `scripts/review-item3-diagnostics.ts`, output in
  `results/logs/review_item3_diagnostics.txt`.
- They are post hoc. They are used only to choose the next experiment.

**Vocabulary.** "Near-wall momentum-deficit layer", "near-wall reversal" and
"closed mean-flow region" are used for what PFAD measured. "Boundary layer",
"separation" and "recirculation bubble" refer only to the conventional
concepts.

---

## Summary

1. **What Item 3 shows.**
   - PFAD's wall makes a robust slow layer.
   - A measured adverse pressure rise drives the near-wall gas to a
     standstill. In the strongest case it drives it into a **weak,
     pressure-driven, diffusion-dominated reversal**: about 1 % of the thermal
     speed, with Reynolds/Péclet number of the reversed region ≈ 2–4.
   - The near-wall momentum budget, computed from particle sums, is
     mechanically consistent with this reversal (R1).
   - The reversal replicates in three of four independent variant seed sets
     (R3). It is **absent in the one variant with a halved timestep**, which
     ties it to the open A-06 question.
2. **Why separation did not resolve.**
   - Mostly a detector and power problem: the detection limit is ≈ 0.02 and
     the signal ≈ 0.01. The rib control had ≈ 16 % power.
   - Layered on a regime problem: the flow is diffusion-dominated, with
     Re_δ ≈ 13–15, Kn_δ ≈ 0.07 and slip, and pressure recovery is
     self-limited to ≈ 30 % of the ideal (EXTERNAL COMPARISON).
   - No evidence points to a broken medium.
3. **A-06 is not a bookkeeping issue.**
   - It matters most for **wall-impulse observables**: Item 3's τ_w, and also
     Item 1's viscosity, which is computed from wall shear.
   - Its existing timestep evidence does not bound wall-impulse bias at the
     10⁻³ level needed here.
   - The cheapest decisive test is a Couette wall-shear timestep series,
     which takes minutes to hours of compute.
4. **Universe A cannot reach wing-relevant Reynolds numbers.**
   - At fixed Mach, Re·Kn is fixed (a property of kinetic gases), and the
     cost grows as (Re/Ma)³.
   - Re_plate ≈ 10³ costs ≈ 18 core-hours per seed; Re_plate ≈ 10⁴ costs
     ~1–2 core-years per seed.
   - The Bible's own route to bridging is the coarse-parcel hypothesis
     (Universe B + occupancy), which can decouple sound speed from momentum
     diffusivity. PFAD has already shown the sound-speed half of that
     (c² ∝ k_s at kT = 0.05). Its viscosity and phase behaviour are
     unmeasured.
5. **Recommendation.**
   1. Close the numerical question (the wall-impulse timestep audit, which
      also audits Item 1's viscosity).
   2. Run one compact, pre-registered confirmation at the current scale,
      with a redesigned, powered detector and a timestep arm.
   3. Then put the main effort into **scale-bridging feasibility**: a cheap
      Universe B parcel characterisation, plus a reduced Universe A scale
      series.
   4. Do **not** push separation harder at the current scale. More seeds,
      larger expansions or steeper ramps at this scale would re-measure the
      same stall slightly more precisely.

---

## 1. What did Item 3 actually establish?

### Established experimentally (registered checks that passed)

| finding | evidence |
|---|---|
| A diffuse wall creates a near-wall momentum-deficit layer: slow gas next to the wall relative to the core | I1 for Aw = 1 and Aw = 0.5: deficit t 80–241 at every station |
| The layer is caused by wall momentum transfer, not by the inflow or geometry | I2: a specular plate gives no deficit and exactly zero tangential impulse; I-upstream: no deficit at the inflow |
| The layer is reproducible across independent seeds and survives 1.56× more particles | I4; resolution variant (t 185) |
| Wall tangential momentum transfer is directly measurable | I3: 0.0224 ± 0.0001 per unit length per unit time |
| The ceiling expansion produces a **measured** adverse wall-pressure rise, and the near-wall gas responds strongly and monotonically | II1 (r = 2, 2.5; t ≈ 25); near-wall velocity 0.172 → 0.045 → 0.007 → −0.002 |
| The response is robust to timestep, particle resolution and domain height | II9 response (dt, res, H) |
| The attached flow never shows reversal at the registered sensitivity | II4 |
| A thicker momentum-deficit layer develops downstream of the deceleration | II7 (2.6×) |
| Energy and momentum ledgers close | 3 × 10⁻¹³ |

### Suggested but not established (post hoc, or not judged)

| suggestion | evidence | why it is not established |
|---|---|---|
| A weak near-wall reversal over x ≈ 300–440 at r = 2.5 | τ_w < 0 in the band (300, 440): −0.00127 ± 0.00023, 8/8 seeds. The first-layer gas moves upstream at ≈ 0.01 by two different samplings (R4) | the band was chosen after seeing the data; absent in the halved-timestep variant (R3) |
| The reversal is pressure-driven | budget (R1): adverse stress force ≈ wall shear, with no forward momentum arriving from above | post hoc; the estimator is approximate (residual ~ ±0.001) |
| The reversed region has a closed mean-flow shape | τ_w changes sign at x ≈ 300 and ≈ 440; seed-summed ψ < 0 up to y ≈ 33–38; the strongest reverse velocity sits **above** the wall (−0.037 at y ≈ 17) | only column 370 is coherent in all seeds (R5); not registered |
| The onset of reversal is graded and orders with expansion and accommodation | budget onset (R7): none at r ≤ 1.5; x ≈ 370 at r = 2; x ≈ 310 at r = 2.5; weaker for Aw = 0.5 | post hoc; per-column significance not computed |
| Wall accommodation shifts the approach to stall | Q8 reported: Aw = 0.5 is more forward (z 5.5 at r = 2) | two accommodations only; reported, not judged |
| A geometric obstacle produces near-wall reversal | rib: reversed in 4/4 seeds at x = 230 and 250 | the registered positive control is INCONCLUSIVE |

### Not tested adequately

| question | status |
|---|---|
| **Coherent** recirculation, as opposed to a weak mean-flow reversal: does gas actually circulate? | Not measured. No Lagrangian or residence-time measurement, although the Bible §17 asks for one. The reversed regions have Re_b ≈ Pe_b ≈ 2–4, so diffusion competes equally with any circulation |
| Timestep convergence of **wall-impulse** observables at the 10⁻³ level | Not established (§6) |
| Convergence of layer thickness at ±15 % | Undecided for single-column wall shear at n = 4, the sampling halves, one bin-width component, and the height variant at x = 210 |
| Any Reynolds/Knudsen dependence | Single scale. The height variant is only a partial (×1.5) scale change |
| Unsteadiness or instability | Not designed for. Block means are uncorrelated (R6) and fluctuations are thermal (σ_u ≈ σ_v ≈ √kT). Nothing indicates an instability |
| Thermal stationarity of the closed loop | Kinetic energy drifts by up to 3 % in the measurement window |

---

## 2. Diagnostics run for this review (post hoc, design information only)

### R1 — near-wall momentum budget from particle sums

Per 20-wide column, for the band y < h, three terms are computed per unit
length per unit time:

- **force**: the streamwise stress-difference force on the band,
  −d/dx ∫₀ʰ Π_xx dy, using the total kinetic Σ m v_x² plus the collisional
  virial;
- **supply**: forward momentum entering from above, −Π_xy(h);
- **τ_w**: the floor's tangential impulse.

In a steady state, force + supply = τ_w. Selected values for band y < 10:

| case, x | force | supply | τ_w | reading |
|---|---|---|---|---|
| A1-r1, 310 | +0.0052 | +0.014 | +0.020 | the wall drag is fed mainly by momentum arriving from above (a shear-driven layer) |
| A1-r2.5, 230 | +0.0005 | +0.0094 | +0.0090 | still shear-fed |
| A1-r2.5, 290 | −0.0021 | +0.0035 | +0.0009 | supply barely exceeds the adverse force |
| A1-r2.5, 370 | −0.0015 ± 0.0004 | −0.0006 | −0.0017 ± 0.0007 | **no supply; the adverse force pushes the band upstream; the wall resists** |
| A1-r2.5, 390 | −0.0018 ± 0.0003 | ≈ 0 | −0.0017 ± 0.0008 | same |
| A1-r2.5, 410 | −0.0011 ± 0.0003 | −0.0002 | −0.0021 ± 0.0008 | same |

- **Closure.** Residuals in the plate interior are ~ ±0.001, mostly within
  2 SE. They reach ±0.003 near the plate ends (x ≈ 110–170 and 450–490) and
  are invalid next to the rib, where a 20-unit central difference cannot
  follow the gradient.
- **Independent check of the force.** The band force agrees with
  h·dp_w/dx from the **floor normal impulses**: dp_w/dx ≈ 1.4 × 10⁻⁴ over
  x ≈ 350–430, so 10 × 1.4 × 10⁻⁴ ≈ 0.0014. The gas stress sums and the
  floor impulse tallies are separate measurements.
- **Reverse velocity above the wall.** In the y < 4 band the supply term
  turns negative at x ≈ 350–410: the gas above the first rows is moving
  upstream faster than the gas at the wall.

### R2 — the forcing along the plate (A1-r2.5)

| x | 190 | 270 | 350 | 430 | 470 |
|---|---|---|---|---|---|
| p_w | 0.3785 | 0.3942 | 0.4143 | 0.4258 | 0.4295 |
| U_e | 1.26 | 0.915 | 0.658 | 0.579 | 0.486 |

- **Where the gradient acts.** The adverse gradient continues well past the
  end of the ramp (x = 400), because the core keeps slowing.
- **Pressure recovery.** It is Δp ≈ 0.051, against a dynamic pressure of
  ≈ 0.20 at x = 190: C_pr ≈ 0.26. The inviscid incompressible ideal for
  area ratio 2.5 is 0.84 (EXTERNAL COMPARISON). About 70 % of the available
  pressure rise is lost to dissipation; kT rises by up to 13 %.
- **Thermal creep is ruled out.** The near-wall kT changes by only
  ≈ 1 × 10⁻⁴ per unit length, so the thermal-creep velocity scale is
  ~1 × 10⁻⁴ (EXTERNAL COMPARISON, kinetic theory). That is about 1 % of the
  observed reverse velocity and in the opposite (downstream) direction.

### R3 — the post-hoc τ_w band on independent seed sets

The band (300, 440) was fixed on A1-r2.5 seeds 7001–7008. For the
height variant it is mapped by the pre-registered `variantX` to (360, 570).

| set (seeds) | τ_w in band | seeds < 0 |
|---|---|---|
| A1-r2.5 (7001–7008) — where the band was chosen | −0.00127 ± 0.00023 (t −5.5) | 8/8 |
| length variant (7301–7304) | −0.00100 ± 0.00027 (t −3.7) | 4/4 |
| resolution variant (7301–7304) | −0.00150 ± 0.00041 (t −3.6) | 4/4 |
| height variant, mapped band (7301–7304) | −0.00116 ± 0.00005 (t −22) | 4/4 |
| **timestep variant, Courant 0.0125** (7301–7304) | **−0.00019 ± 0.00034 (t −0.6)** | 2/4 |
| Aw = 0.5, r = 2.5 | ≈ 0 | 2/4 |
| Aw = 1, r = 2 | +0.0004 ± 0.0003 | 3/8 |

- **Replication.** Across the four independent variant seed sets, 14 of 16
  seeds are negative (sign test p ≈ 0.002).
- **The exception is the timestep variant.** It differs from the reference
  by z ≈ 2.6. Its near-wall *velocity* in the same band (y < 4, sampled from
  positions) agrees with the others: −0.005 ± 0.003. Only the wall
  impulse, measured at the wall itself, is missing.

### R4 — what the wall impulse measures

- **The re-emission adds no bias.** For a diffuse wall at rest, the
  re-emitted tangential momentum per hit is zero within noise.
- **Two samplings agree.** In the reversed band the arriving particles carry
  −0.012 to −0.015 per hit (flux-weighted). The first row's snapshot mean is
  −0.009 to −0.015 (density-weighted). Two different sampling processes
  give the same sign and magnitude.
- **The incident flux alone is not a better estimator.** I expected that
  removing the wall's random re-emission would halve the variance. The data
  show the opposite:

  | estimator | seed SD |
  |---|---|
  | net τ_w | 6.5 × 10⁻⁴ |
  | incident flux | 7.6 × 10⁻⁴ |
  | emitted flux | 8.2 × 10⁻⁴ |

  Emitted momentum is re-absorbed by later arriving particles. The two
  fluctuations are therefore positively correlated, and the **net** impulse
  cancels them.

### R5 — coherence by seed

Seeds negative at each column of A1-r2.5 (8 seeds), as u_wall / τ_w / ψ(10):

| column | 290 | 310–350 | 370 | 390–430 | 450 | 470 |
|---|---|---|---|---|---|---|
| seeds negative | 3/3/2 | 3–6 | **8/5/8** | 4–6 | 2/1/2 | 0/2/0 |

The rib has 4/4/4 at x = 230.

The strong case is spatially coherent only in its centre. Elsewhere it is
near the noise.

### R6 — detector statistics

- **Blocks are independent.** The lag-1 autocorrelation of 120-unit block
  means is −0.06 to −0.13.
- **There is no seed-to-seed variance beyond thermal noise.** The within-run
  SE of a seed's column mean (0.016) equals the seed-to-seed SD
  (0.016–0.018).
- **Adjacent columns are only modestly correlated:** 0.13–0.27.
- **Power of the rib test.** By Monte Carlo from the observed effect and SD:

  | test | n = 4 | n = 8 |
  |---|---|---|
  | registered two-column test | **0.16** | 0.92 |
  | pre-declared region-mean test at p ≤ 0.025 | 0.99 | — |

### R7 — budget onset across the series (band y < 10)

| case | onset (supply + force ≤ 0) | τ_w sign changes |
|---|---|---|
| A1-r1, A1-r1.5, A05-r1 | none | none |
| A05-r2 | marginal (min ≈ 0) | noisy |
| A1-r2 | x ≈ 370 | 360, 400 |
| A1-r2.5 | x ≈ 310 | 300, 440 |
| A05-r2.5 | x ≈ 310 | noisy |
| variants (dt, len, res) | x ≈ 290–370 | — |

The minimum of supply + force is about −0.0015 for Aw = 0.5 at r = 2.5,
against −0.0021 for Aw = 1.

### Extra — Reynolds/Péclet number of the reversed regions

Re_b = |u_rev,max| L_b / ν, with ν = μ/ρ ≈ 1.37 (EXTERNAL COMPARISON for
μ). For a gas, the particle diffusivity is ~ν, so Pe_b ≈ Re_b.

| region | u_rev,max | L_b | Re_b |
|---|---|---|---|
| A1-r2.5 | −0.037 | 140 | ≈ 3.8 (upper estimate) |
| A1-r2.5, typical | −0.01 | 140 | ≈ 1 |
| rib | −0.057 | 50 | ≈ 2.0 |

---

## 3. Why did separation fail to resolve?

Each candidate with the evidence for and against it. A closing paragraph gives
my overall reading.

**Insufficient adverse forcing.**

- *For.*
  - The response is monotonic in r.
  - Reversal appears only where the momentum supply from above has fallen to
    zero while an adverse force remains (R1, R7).
  - The wall-pressure rise saturates: 0.031 → 0.036 from r = 2 to 2.5.
  - Pressure recovery is only ≈ 26 % of the dynamic pressure (R2).
- *Against.*
  - The steeper-gradient pilot (H_in 50, 1.4× steeper; design seeds only)
    stalled the same way.
  - In the reversed band the reverse flow is balanced by wall friction
    (R1), so more forcing buys proportionally more reverse velocity, not a
    qualitatively different flow.
- *Reading.* At this scale the forcing is self-limited by viscous loss. It
  is not an independent knob: a bigger expansion ratio does not raise the
  pressure rise.

**Insufficient Reynolds number / scale (a diffusion-dominated regime).**

- *For.*
  - The layer's own Reynolds number: Re_δ = U_e δ₁/ν ≈ 13–15.
  - Rarefaction: Kn_δ = λ/δ₁ ≈ 0.06–0.09.
  - Slip: the first-row gas moves at 5–8 % of U_e for Aw = 1 and more for
    Aw = 0.5. The more-slipping wall did not reverse at all (R3, R7).
  - Re_b ≈ 1–4 even for the geometric (rib) case.
  - ≈ 70 % of the available pressure rise is dissipated.
  - In every medium, reversal driven by a pressure gradient on a smooth wall
    weakens toward low Re; it is a fraction of U only when inertia
    dominates.
- *Against.*
  - This is inference. Item 3 has no direct scale test.
  - The partial height variant (×1.5 in height and ramp length) gave the
    same weak reversal. Its ramp was also gentler, so it is not a clean
    scale-up.
- *Reading.* The best-supported physical explanation for **why the signal
  is small**. It is untested, which is why §8 proposes a scale series.

**Insufficient domain length.**

- *For:* none.
- *Against:* plate and constant section +100 gave the same reversal
  (τ_w −0.0010, 4/4 seeds).
- *Reading:* not supported.

**Insufficient measurement duration.**

- *For.* Precision improves as √T.
- *Against.*
  - Block means are independent and stationary (R6).
  - There is no trend over 10 blocks.
  - A longer measurement changes precision, not physics.
- *Reading:* part of the power problem only.

**Insufficient particle count.**

- *For:* none.
- *Against:* 1.56× more particles gave the same stall and band τ_w −0.0015.
- *Reading:* not supported. The variant also changes the medium.

**Excessive thermal noise.**

- *For.* The signal is 1–4 % of the thermal speed, and the column-level
  detection limit is ≈ 0.02 at n = 8.
- *Against.* Noise limits *detection*, not *occurrence*.
- *Reading:* supported, as a detection limit.

**Wall accommodation.**

- *For.* Aw = 0.5 slips more and does not reverse.
- *Against.*
  - Aw = 1 is already the maximum momentum-absorbing Maxwell wall.
  - The model cannot be made "stickier" without a different wall law,
    which would be a model change that Item 3 does not justify.
- *Reading:* explains why reversal is weaker than in a no-slip medium. It is
  not an artefact.

**Numerical timestep (A-06).**

- *For.* The one timestep variant lacks the τ_w band signal (z ≈ 2.6)
  while its near-wall velocity agrees (R3).
- *Against.*
  - 4 seeds.
  - The other dt checks passed their margins.
  - No x-asymmetric mechanism is evident in the code (§6).
- *Reading:* an open caveat **specific to wall-impulse observables**. It
  must be tested.

**Detector design.**

- *For.*
  - The detection limit (≈ 0.02) is twice the observed reverse velocity.
  - Seed-level t with n − 1 degrees of freedom discards the within-run
    information, even though blocks are independent and seeds carry no
    excess variance (R6).
  - The two-column p ≤ 0.005 rule is very strict.
  - The rib test had 16 % power.
- *Against:* the same detector worked as designed on the attached null.
- *Reading:* strongly supported as the reason the observed effect was not
  **resolved**.

**Insufficient statistical power.**

- *For / against:* the same evidence as detector design and thermal noise.
- *Reading:* strongly supported.

**PFAD does not generate classical-looking separation under these
conditions.**

- *For.* Under *these* conditions, almost certainly not: Re_b ≈ 1–4
  describes a diffusion-dominated region, in any medium.
- *Against a defect in the medium.*
  - The budget is mechanically consistent (R1).
  - Geometric reversal exists (rib).
  - The pressure response is strong and robust.
- *Reading.* The phrase conflates two different claims.
  - "This regime cannot produce a distinct separated region" is well
    supported.
  - "The PFAD medium cannot separate" is not supported.

**My overall reading.** The signal was **not resolved** mainly because of
detector design and power. The signal is **small** because the regime is
diffusion-dominated: low Re_δ, slip, and dissipative loss of the forcing. The
only open caveat that could make the post-hoc wall-impulse reversal spurious is
the timestep, for that observable specifically. Domain length, duration and
particle count are not limiting. Nothing points to a defect in the particle
physics.

---

## 4. Is wall momentum transfer the right primary separation observable?

**What it measures.** For a diffuse wall at rest, the expected tangential
impulse equals the momentum flux carried **into** the wall by arriving
particles. It is a first-layer (≈ one mean free path) velocity measurement,
weighted by wall-collision rate.

**Strengths.**

- It is the most precise local signal available. It samples every wall hit,
  and its net form cancels the wall's own emission noise (R4).
- It is physically direct, with no derivative or profile fit.
- It agrees in sign and magnitude with the snapshot first-row velocity (R4).

**Interpretations of the negative signal.**

| interpretation | status | what would discriminate |
|---|---|---|
| **A. genuine separation** (a coherent recirculating region) | Topology is suggestive: two sign changes, a negative ψ, and reverse velocity largest above the wall. **But** Re_b ≈ Pe_b ≈ 1–4: any closed mean-flow region exchanges gas by diffusion as fast as it circulates it. It is not a classical inertial bubble | per-seed closed ψ = 0 contour at region-level significance; Lagrangian residence-time distribution against the attached control (trapping shows as a long-residence tail); Re_b and Pe_b as measured order parameters |
| **B. near-wall reversal without coherent recirculation** | Not excluded. If the "closed" topology were only noise above a stalled layer, ψ would not be coherent across seeds; it is coherent only at x = 370 (R5) | the same as A, plus seed-wise topology statistics |
| **C. wall-collision statistical artefact** | Largely excluded: two independent samplings agree (R4); the budget closes with an independently measured pressure force (R1); it replicates in independent seed sets (R3). **One open caveat:** the halved-timestep variant lacks it | a powered timestep arm on net τ_w at the region level; a Couette wall-impulse timestep series (§6) |
| **D. accommodation-model effect** | Largely excluded for the sign: the wall emits zero mean tangential momentum (R4) and thermal creep is negligible (R2). The wall model **does** set the slip and therefore the threshold (Aw = 0.5 does not reverse). That is physics of this wall, not an artefact | an Aw arm (e.g. 0.75) to map the threshold shift; a wall-temperature arm only if creep were suspected |
| **E. something else** | **My best reading:** a *pressure-driven, diffusion-dominated near-wall backflow*. The adverse stress force on the near-wall gas exceeds the forward momentum arriving from above; the gas moves slowly upstream until wall friction balances the force. It sits under a thick stalled layer that may close weakly in the mean | the budget terms (R1, R7) as measured mechanism variables, plus the A/B and C tests above |

**Answer.** Wall impulse should be the **primary measure of the sign of
near-wall motion**, judged as a **pre-declared region mean** of the **net**
impulse. It is not a separation observable by itself. Three things must go
with it:

1. the **momentum budget**: is the reversal pressure-driven?
2. a **region-level ψ or near-wall mass-flux** measure: does the reversal
   extend away from the wall?
3. a **Lagrangian residence or coherence** measure: is it a coherent
   structure?

It also needs its own **timestep validation**, because it is the observable
most exposed to the time-stepping approximation.

---

## 5. The positive-control problem

The data and the implementation point to **an inappropriate statistical test
for the sample size, i.e. insufficient power**. They do not point to an
unsuitable detector.

- **The detector sees the rib's reversal.** Every seed is negative at
  x = 230 and 250, the block-negative fraction is 0.80, and τ_w and ψ agree.
- **The test discards information.**
  - It treats each seed as one sample, giving 3 degrees of freedom; then
    t_crit(0.005) = 5.84.
  - Within-run blocks are independent (lag-1 ≈ −0.07) and seeds add no
    variance beyond thermal noise (R6).
  - So the same data contain ≈ 10× more independent information than the
    test used.
- **It stacks two strict requirements.** Two adjacent columns must each pass
  p ≤ 0.005. Power was ≈ 16 %; the pilot's pass was luck.
- **Spatial correlation is not the problem.** It is modest (0.13–0.27). It
  slightly weakens the multiple-testing rationale of the contiguity rule,
  but it is not why the test failed.

**Redesign** (for any future pre-registration):

1. **A primary region test.** Use a pre-declared window (e.g. the expected
   reversed band), with region-mean net τ_w and region-mean near-wall
   velocity, one-sided at α = 0.025.
2. **Inference that uses the data's structure.** Either seeds as clusters
   with ≥ 8 seeds, or a hierarchical seeds × blocks analysis with block
   independence verified in the same data. A seed-level t with 3 degrees of
   freedom should not be used for a control.
3. **Columns as a secondary map.** The column map describes extent, with
   false-discovery-rate control; it is not the existence test.
4. **Power by simulation before pre-registration.** Use pilot effect sizes,
   and require ≥ 0.9 power for every positive control. At the observed rib
   effect a region test has ≈ 0.99 power at n = 4. The registered test needs
   n ≈ 8 to reach 0.92.

The registered PC verdict (INCONCLUSIVE) stands. This is a lesson for the
next design, not a re-judgement.

---

## 6. The A-06 numerical issue

**What the code does** (`src/core/CollisionModel.ts`,
`src/walls/WallModel.ts`):

- **Late contact.** A pair found overlapping is rewound along its
  straight-line motion to contact. When that rewind would exceed the
  timestep, because a particle's velocity already changed earlier in the
  step, the rewind is clamped to dt. The impulse is then applied along the
  normal at the clamped (still slightly overlapped) configuration.
- **Conservation is unaffected.** Momentum and energy are conserved exactly.
  The error is in the **scattering geometry** of ≈ 0.23 % of collisions.
- **Ordering.** Walls and bodies are processed **after** all pair collisions
  in a step. A particle that collides with a neighbour and reaches the wall
  in the same step is always treated in that order, whatever the true order
  was, and is traced back along its post-collision velocity.
- **Instrumentation gap.** Wall late contacts are counted
  (`WallModel.lateContacts`) but are not saved in the Item 3 records.

**What this means.**

- **Bulk observables.** The error has no preferred streamwise direction. Its
  effect on bulk transport is plausibly O(10⁻³) relative. The Items 1 and 2
  timestep tests bound it at the few-per-cent level, consistent with that.
- **First-layer observables.** The ordering approximation is concentrated at
  the wall, where wall hits and pair collisions coincide.
  - Wall-impulse quantities (τ_w, p_w, and through them drag, lift and
    Item 1's viscosity) are exactly where a bias would show.
  - Item 3's halved-timestep variant is the only one without the τ_w band
    signal. Its near-wall velocity, sampled from positions, does not differ.
  - A bias of ~10⁻³ in τ_w (≈ 5 % of the attached wall shear) is **not
    excluded** by any existing evidence. The Item 3 dt check on attached τ_w
    has a CI of ±20 %.
- **Effect on separation.** If such a bias exists, it would directly affect
  the separation-relevant signal, whose size is ~10⁻³.

**Recommendation: investigate directly, then fix only if needed.** The
late-contact fraction is a *proxy*. The 10⁻³ guideline came from the static
box. What matters is the dt sensitivity of the *judged* quantity.

1. **Couette wall-shear timestep series** (cheap, precise, general).
   - Run the registered viscosity configuration and its φ = 0.2 counterpart
     at Courant 0.05, 0.025, 0.0125 and 0.00625, with ≥ 60 seeds each.
   - Record pair **and wall** late contacts.
   - This resolves the dt dependence of a wall-impulse observable to ≈ 1–2 %.
   - Cost: minutes to a few core-hours. The 30-seed Courant-0.05 set took
     158 s.
2. **Strong-case timestep arm** in the next Item 3 follow-up (§8, E1):
   region net τ_w at Courant 0.025 and 0.0125, ≥ 12 seeds each.
3. **If either shows a dependence.** Adopt a smaller Courant number for all
   wall-force work, at 2–4× cost, or develop a near-wall event-ordered
   treatment (an exact event-driven step for particles within one step's
   travel of a wall). Do this **before** any lift/drag work.

---

## 7. Are we asking the wrong question?

Partly, yes. The reformulation is better, with one correction.

- **Why "can PFAD reproduce separation?" is ill-posed here.**
  "Separation" presupposes an inertial near-wall layer that detaches. At
  Re_δ ≈ 13 and Re_b ≈ 1–4 the near-wall flow is diffusion-dominated, so
  even a continuum fluid would not show a distinct separated region. A
  PASS/FAIL on "separation" therefore mostly measures whether we picked a
  geometry beyond a regime-dependent threshold. It says little about
  whether the physics works.
- **"Loss of near-wall forward momentum under adverse gradients" is the
  right core.** It is also the Bible's own §17 hypothesis: "the fast outer
  flow can transport momentum into the slow layer only up to a certain
  adverse-gradient strength … the threshold must be measured."
  - The momentum budget (R1, R7) makes that hypothesis directly measurable
    from particle data.
  - The onset condition, supply ≤ |adverse force| on the near-wall gas, is a
    **PFAD-native threshold**, not a classical criterion.
- **"Instability" is not supported.** Block means are uncorrelated, the
  fluctuations are thermal, and nothing grows. Calling the stall an
  instability would assert something unmeasured. Unsteadiness belongs in a
  later, higher-Re question.

**Suggested formulation** (for a future pre-registration; not written yet):

> Under a measured adverse streamwise stress gradient:
>
> (1) where does the forward-momentum supply to the near-wall gas fall below
> the adverse force (onset)?
>
> (2) beyond onset, does the near-wall gas reverse, with the reversal
> balanced by wall impulse (sign and mechanism)?
>
> (3) as the particle universe grows at fixed Mach, does the reversed region
> become advectively coherent (Re_b, Pe_b, residence time), i.e. does a
> classical separated region emerge?

Parts (1)–(2) can be answered at the current scale. Part (3) is the
scale-bridging question.

---

## 8. Candidate experiments (concepts only; nothing implemented)

### E0 — Numerical audit of wall impulse (A-06)

- **Question.** Is the time-stepped engine's wall impulse converged at
  Courant 0.025 to ≈ 1–2 %? Does a dt bias explain the Item 3 dt-variant
  anomaly?
- **Setup.** Couette flow, the registered viscosity configuration (φ = 0.1)
  and φ = 0.2.
- **Independent variable.** Courant number: 0.05, 0.025, 0.0125, 0.00625.
- **Dependent variables.**
  - wall shear and μ_eff;
  - wall normal impulse;
  - pair and wall late-contact fractions;
  - first-row velocity.
- **Controls.** Seeds shared across Courant values (paired), plus the
  existing 0.05 and 0.025 records.
- **Expected if converged.** No trend beyond ±1–2 %; linear-in-dt fits
  consistent with zero slope.
- **Alternatives.** A dt bias that is additive near the wall but invisible
  in the bulk. A wall-temperature effect.
- **Seeds and cost.** ≥ 60 per Courant value; ≲ 3 core-hours in total.
- **Discriminates.** Converged vs biased wall impulse. It also audits Item 1
  (§9).

### E1 — Item 3b: near-wall reversal at the current scale

A confirmatory, mechanism-focused experiment.

- **Question.** Formulation parts (1)–(2) of §7. Is the post-hoc reversal
  real, pressure-driven and timestep-robust?
- **Setup.** The unchanged Item 3 rig at r = 2.5, Aw = 1, with **fresh
  seeds**. The reversal band (300, 440) is fixed from Item 3, which makes
  this an out-of-sample test.
- **Independent variables.**
  - timestep: Courant 0.025 vs 0.0125;
  - case: strong, attached, and rib positive control;
  - optionally Aw = 0.75, for the threshold shift.
- **Dependent variables.**
  - *Primary:* region-mean net τ_w in the band.
  - *Co-primary:* region-mean u (y < 4) and ψ(10).
  - *Mechanism:* budget terms (force, supply, wall impulse) and the onset
    position.
  - *Coherence:* per-seed ψ topology; Re_b and Pe_b; Lagrangian residence
    time in the band against the attached control. Residence time is a
    measurement addition, not physics.
- **Controls.** Attached (null); rib (positive, powered ≥ 0.9); timestep
  arm.
- **Expected signatures.**
  - Reversal real: band τ_w < 0 at both timesteps, equivalent within
    ±0.0006.
  - Budget: supply ≈ 0 and adverse force ≈ τ_w.
  - At this Pe_b, no residence-time trapping.
- **Alternatives.**
  - If dt-dependent: a numerical artefact (back to E0).
  - If ψ is incoherent: B rather than A/E.
- **Seeds.**
  - Strong arm: 12 per timestep. With per-seed SD ≈ 7 × 10⁻⁴ this gives an
    SE of 2 × 10⁻⁴ per arm, t ≈ −6 for the observed effect, and z ≈ 3.5 for
    a Δ of 0.001 between arms.
  - Rib: 8. Attached: 6.
- **Cost.** ≈ 27 core-hours, ≈ 7 hours on 4 cores.
  - Strong, Courant 0.025: 12 × 40 min.
  - Strong, Courant 0.0125: 12 × 80 min.
  - Rib: 8 × 14 min.
  - Attached: 6 × 13 min.
- **Discriminates.**
  - Pressure-driven diffusive backflow (E) vs a numerical artefact (C).
  - Coherent (A) vs incoherent (B) reversal.
  - A working, powered detector for every later flow experiment.

### E2 — Universe A geometric scale series at fixed Mach

- **Question.** Formulation part (3). As L/λ grows at fixed Mach, does the
  near-wall reversal strengthen toward an advective (Re_b ≫ 1) separated
  region? How do slip and thickness scale?
- **Setup.** The same rig with every length (and the start-up and
  measurement times) scaled by s ∈ {0.5, 1, 2}, at U = 1 (Mp ≈ 0.5) and
  φ = 0.2. The timestep is chosen from E0/E1.
- **Independent variables.** s; attached vs strong.
- **Dependent variables.**
  - slip ratio and δ₁/(sL);
  - the reversal's region-mean τ_w and u;
  - reversed length and dividing height;
  - Re_b and Pe_b;
  - budget onset;
  - residence time;
  - measured cost exponent.
- **Controls.** The attached case at each s, and seed-matched analysis.
- **Expected signatures.**
  - *Continuum-like approach:* reverse velocity grows as a fraction of U_e;
    Re_b grows ∝ s or faster; slip ∝ s^(−1/2).
  - *Kinetic floor:* reverse velocity stays ~0.01 as s grows.
- **Alternatives.**
  - Pressure recovery may change with s and confound the trend, so measure
    the forcing.
  - The closed loop's start-up time may need to grow with s.
- **Seeds.** s = 0.5: 8 each. s = 1: from E1. s = 2: strong 6, attached 4.
- **Cost.** Cost scales as s³. s = 2 strong ≈ 5.2 h per seed. Total
  ≈ 40 core-hours, ≈ 10 h on 4 cores.
- **Discriminates.** Whether pushing scale in Universe A helps, and how
  fast. That decides whether Universe A has any affordable route to a
  classical separated region.

### E3 — Universe B parcel feasibility

The scale-bridging probe.

- **Question.** Can a coarse-parcel PFAD fluid (the Bible §5 and §11
  hypotheses: occupancy force, inelastic parcels, internal reservoir) raise
  **Re per resolvable length at fixed Mach** well above Universe A, while
  remaining an isotropic, stable fluid?
- **Figure of merit.** Φ = c·ℓ/ν, where ℓ is the smallest resolvable length:
  λ, or the kernel width h if larger. Then Re ≈ Ma·Φ·(L/ℓ).
  - Universe A: Φ_A ≈ 2.17 × 1/1.37 ≈ 1.6.
  - Re ≈ 10⁴ at Ma 0.3 in an affordable L ≈ 500ℓ needs Φ ≈ 70, i.e.
    ~40× better.
- **Setup.** Small periodic boxes, reusing the static-box, pulse and
  Couette experiments.
- **Independent variables.**
  - k_s and kernel h;
  - parcel temperature kT, i.e. the random-velocity scale σ_v;
  - restitution e and reservoir release;
  - φ.
- **Dependent variables.**
  - equation of state;
  - sound speed c (Item 2 method);
  - viscosity ν (Item 1 method);
  - **phase**: pair correlation, bond order, self-diffusion — fluid or
    crystal;
  - isotropy;
  - energy drift and reservoir balance;
  - signal-to-noise per sample (∝ U/σ_v);
  - cost per particle-time.
- **Controls.** Universe A at the same φ; the limit k_s → 0.
- **What is already known.** The occupancy force alone gives
  c² = 1.39 k_s φ/m + 0.13 at kT = 0.05: sound speed decoupled from
  temperature (EXPERIMENT_LOG §5.2). The **viscosity and phase of that cold
  fluid have never been measured.**
- **Expected signatures.**
  - *Bridging possible:* Φ ≫ 1.6 while g(r) stays liquid-like and
    self-diffusion stays finite.
  - *Bridging blocked:* crystallisation or clumping (the known failure modes
    of cold, soft, repulsive particle fluids), anomalous (non-Newtonian)
    viscosity, or energy instability.
- **Seeds and cost.** 4 per parameter point with N ≈ 2–5 × 10³; a 20–40
  point scan costs a few core-hours.
- **Discriminates.** Whether PFAD has any route to wing-relevant Re at all.
- **Caveat.** Adopting Universe B for flow work would require re-running the
  validation ladder (thermal/EOS, viscosity, sound, near-wall layer) in that
  universe.

### E4 — Residence time as a standing observable

An add-on to E1 and E2, not standalone.

- **What.** Track particle identities through a pre-declared region. Measure
  the residence-time distribution and the conditional mean displacement by
  height.
- **Expected.**
  - Pe_b ≈ 1: residence ≈ the diffusive time and no trapping tail.
  - The emergence of a long-residence tail with s would be the first
    Lagrangian evidence of coherent recirculation.
- **Cost.** Negligible. It is also the Bible §17 "particle residence time",
  never yet measured.

**Not recommended at the current scale:**

- larger expansion ratios (the pressure rise saturates);
- steeper ramps (the pilot stalled the same way);
- longer measurements or more seeds with the registered column detector
  (precision on the same stall);
- a "stickier" wall law (a model change without evidence).

---

## 9. Do Items 1 and 2 need auditing first?

**Thermal: no.**

- φ = 0.05. The registered static-box late-contact fraction is
  6.2 × 10⁻⁴, below the guideline.
- The equilibrium statistics were judged against noise-level criteria and
  passed on fresh seeds.
- Nothing in A-06 points at them.

**Sound speed: no rerun.**

- It is a bulk, wall-free measurement at φ = 0.2, where the late-contact
  fraction is probably ≈ 2 × 10⁻³.
- Its direct timestep test (Courant 0.05 vs 0.025: +0.79 %, CI
  [−2.65, +4.23]) bounds the bias at about its stated precision (±3.5 %).
  With the bias linear in dt, the bias at Courant 0.025 is about the same
  size as that difference or smaller.
- *Minimum:* record its late-contact fraction in a short run (minutes) and
  note it.

**Viscosity: yes, a targeted audit (E0), because μ is a wall-impulse
measurement.**

- Item 1 computes μ_eff from the **wall shear impulse**, the same class of
  observable as Item 3's τ_w.
- Its timestep test (Courant 0.05 vs 0.025: −3.2 ± 3.2 %) excludes only
  effects larger than ≈ 9 % (95 %). Its point estimate hints that the dt → 0
  viscosity could be ≈ 3 % higher.
- μ enters every Reynolds number PFAD quotes, including the scale-bridging
  arithmetic below.
- E0 resolves this to ≈ 1–2 % for ≲ 3 core-hours and needs no rerun of the
  registered experiment.
- Item 1's registered PASS is closed and stays as judged. The audit would
  attach a measured timestep systematic to μ.

**Conclusion.** Run E0 first: cheap, and it answers A-06 for all wall-force
work. No rerun of Items 1 or 2.

---

## 10. Reynolds / scale bridging

**The constraint is physical, not numerical.**

- In a molecular-like gas (Universe A): ν ~ λ·c̄ and c ~ c̄, the thermal
  speed. So Re·Kn ∝ Ma (EXPERIMENT_LOG §12).
- At fixed φ and Mach, Re grows only with L/λ.
- In 2D at fixed geometry, the particle count grows ∝ L², and the run time
  (a fixed number of flow-throughs) ∝ L. Cost therefore grows ∝ L³, i.e.
  ∝ (Re/Ma)³.

**The current regime** (Item 3, φ = 0.2, Mp ≈ 0.5):

| quantity | value |
|---|---|
| Re_plate | ≈ 357 |
| Re_δ = U_e δ₁/ν | ≈ 13–15 |
| Kn_δ | ≈ 0.07 |
| first-row slip | ≈ 5–8 % of U_e |
| Re_b of reversed regions | ≈ 1–4 |
| pressure recovery | ≈ 30 % of ideal |

**The measured cost scale.**

- A1-r2.5 costs 6.5 × 10⁻⁵ core-seconds per particle per time unit, i.e.
  2360 s per seed.
- Scaling every length by s at fixed Mach (Re_δ ≈ 15√s and Kn_δ ≈ 0.07/√s,
  assuming δ grows as √(length)):

| s | Re_plate | Re_δ | Kn_δ | particles | core time per seed |
|---|---|---|---|---|---|
| 0.5 | ≈ 180 | ≈ 11 | 0.10 | 4 × 10³ | ≈ 5 min |
| 1 (Item 3) | ≈ 357 | ≈ 15 | 0.07 | 1.6 × 10⁴ | ≈ 40 min |
| 2 | ≈ 710 | ≈ 21 | 0.05 | 6.6 × 10⁴ | ≈ 5 h |
| 3 | ≈ 1 070 | ≈ 26 | 0.04 | 1.5 × 10⁵ | ≈ 18 h |
| 10 | ≈ 3 600 | ≈ 47 | 0.02 | 1.6 × 10⁶ | ≈ 1 month |
| 28 | ≈ 10⁴ | ≈ 80 | 0.013 | 1.3 × 10⁷ | ≈ 1.6 years |
| wing (Re ≈ 3 × 10⁶) | — | — | — | ~10¹² | not meaningful |

Lowering the Mach number toward incompressible-like flow (Ma 0.2) makes
everything worse: L doubles for the same Re (8× cost), and the
signal-to-noise per sample drops ∝ Ma (Bible §20).

**What the current scale can and cannot study.**

| phenomenon | can it be studied? |
|---|---|
| pressure gradients | yes; measured at t ≈ 25. Compressibility (Mp ≈ 0.5) and heating are significant |
| near-wall layers | yes, as slip-flow layers 10–60 mean free paths thick. The classical limit needs Kn_δ ≪ 0.01 |
| separation | only the diffusive, near-threshold form (Re_b ≈ 1–4). Geometric reversal behind sharp obstacles exists. Classical pressure-driven separated regions with Re_b ≫ 1 are not reachable at affordable s in Universe A |
| lift | exists at Re_c ≈ 20 (Kutta record) but is **not scale-converged**: at fixed Re, C_L changes 38 % between universes, a Kn and/or Ma effect |
| drag | viscous- and rarefaction-dominated (C_D ≈ 1–1.6 at Re_c ≈ 10–20). Not comparable with wing drag |

**Judgment.**

- Pushing harder on separation at the current scale is low-yield.
- Pushing scale in Universe A buys at most a factor ≈ 3 in Re for
  ≈ 30× cost.
- The Bible itself forbids full-scale airfoil claims without "a validated
  scale-bridging method" (§21).
- The only candidate route inside the Bible is the coarse-parcel universe.
  Its key promise is to decouple the sound speed, set by occupancy
  stiffness, from momentum diffusivity and noise, set by the parcel random
  velocity. Both Re per resolvable length and signal-to-noise would then
  improve by ~c/σ_v.
- PFAD should **investigate scale bridging now (E3)**, cheaply, before
  spending days on Universe A flow experiments.

---

## 11. Recommendation

### A. Interpretation of Item 3

PFAD's particle wall makes a reproducible, wall-caused near-wall
momentum-deficit layer. A measured adverse pressure rise drives the near-wall
gas to a stall. In the strongest case, post hoc and partly replicated, it
drives it into a weak reversal whose momentum budget is mechanically
consistent: the adverse force exceeds the forward supply, and wall friction
balances the rest.

All of this happens in a **diffusion-dominated slip regime**:
Re_δ ≈ 13–15, Kn_δ ≈ 0.07, Re_b ≈ 1–4. In that regime a distinct,
classical separated region is not expected in any medium.

The INCONCLUSIVE outcome reflects that regime plus an under-powered
detector. It does not indicate defective particle physics. **One numerical
caveat (wall-impulse timestep convergence) remains open.**

### B. Strongest competing explanations

1. The detector and statistical power. This is why the observed effect was
   not resolved.
2. The diffusion-dominated regime (low Re, slip, dissipative loss of the
   forcing). This is why the effect is small.
3. The wall-impulse timestep approximation. This is the only way the
   post-hoc reversal could be partly spurious.
4. Weakest: a defect in the medium. It is contradicted by the budget, the rib
   and the robust pressure response.

### C. Most information per unit compute

| experiment | cost | what it decides |
|---|---|---|
| **E0** (Couette wall-impulse timestep series) | ≲ 3 core-hours | A-06 for every wall-force observable, including Item 1's μ |
| **E3** (Universe B feasibility) | a few core-hours | whether PFAD can ever reach wing-relevant Re |
| **E1** (Item 3b) | ≈ 7 hours of wall time | the separation question at this scale, and the redesigned detector |
| **E2** (scale series) | ≈ 10 hours of wall time | how the reversal changes with L/λ |

E0 and E3 deliver the most decision-relevant information per core-hour.
E2 is the most expensive and its broad answer is partly predictable from the
cost law. It is valuable mainly for the measured trend, so I would run it
reduced and only after E1 has settled the numerics.

### D. Audit Items 1 and 2 first?

Only a targeted audit, E0, which also audits Item 1's viscosity. No reruns.
Thermal needs nothing; sound speed needs only a recorded late-contact
fraction.

### E. Refine separation at the current scale, or investigate scale bridging?

- **At the current scale:** do one compact, decisive confirmation (E1).
  It tests the reformulated question with a powered detector and a timestep
  arm, and closes Item 3's open loops honestly.
- **Then shift the main effort to scale bridging.** The cost law says
  Universe A cannot reach the regime where the macroscopic phenomena of
  interest are distinct. The decision that matters next is which universe
  PFAD does flow physics in, not which separation geometry to try.

### F. Proposed sequence

**Milestone 1 — numerical and detector closure** (≈ 1 day of wall time).

- **E0**: Couette wall-impulse timestep series, plus recording pair and wall
  late contacts in the Items 1/2 configurations, plus an A-06 wording update
  (the guideline becomes "the judged quantity's measured dt sensitivity").
- **E1**: pre-registered Item 3b at the current scale.
  - fresh seeds;
  - the band fixed from Item 3;
  - net τ_w as region primary, plus the budget, ψ and residence time;
  - a timestep arm;
  - a rib control with ≥ 0.9 power.
- **Gate.** If wall impulse is dt-biased, fix the near-wall numerics (a
  smaller Courant number or event-ordered wall treatment) before any further
  wall-force physics. Otherwise Item 3's Part II question is answered at
  this scale, in the reformulated form.

**Milestone 2 — scale-bridging feasibility** (≈ 1–2 days; E3 runs alongside
Milestone 1).

- **E3**: Universe B / occupancy parcel characterisation (Φ, phase,
  isotropy, signal-to-noise, energy).
- **E2 (reduced)**: s = 0.5 and 2 for the attached and strong cases, with
  s = 1 taken from E1, at the timestep validated in Milestone 1.

**Milestone 3 — choice of representation.**

- **If E3 finds a stable fluid with Φ ≫ 1.6:** pre-register a Universe B
  validation ladder (EOS and thermal, viscosity, sound, near-wall layer). Then
  return to near-wall reversal at a scale where Re_b ≫ 1 is reachable. Kutta
  and lift come after that.
- **If not:** PFAD continues in Universe A with an explicit low-Re scope
  (Re ≲ 10³). Every later flow result, and any airfoil phase, carries that
  label, as Bible §21 requires.

Airfoil optimisation, inverse design and Kutta work stay locked throughout.

---

## 12. Where I think current assumptions are wrong

1. **"Separation is the next rung toward airfoils."** At Universe A's
   reachable Re, airfoil behaviour is low-Re and rarefied. A pass on
   separation here would not carry over to wings. Scale bridging, not
   separation, is the critical path (Bible §21).
2. **"Negative wall momentum transfer means separation."** It means the
   first-layer gas moves upstream. Whether that is a separated region
   depends on topology and on advective dominance (Re_b, Pe_b). Neither is
   established, and the second is ~1 here.
3. **"Timestep halving passed, so A-06 is settled."** It is settled for
   the judged bulk quantities at their margins. It is **not** settled for
   wall-impulse observables at the 10⁻³ level. That includes Item 1's
   viscosity, and it will matter for lift and drag.
4. **"Wall accommodation is a lever to promote separation."** Aw = 1 is
   already the most momentum-absorbing Maxwell wall. Lower Aw only
   suppresses reversal.
5. **"This is an instability problem."** Nothing measured grows or
   oscillates. The phenomenon is a mean momentum balance.
6. **"Scale is a compute-budget question."** For a molecular-like gas it
   is a physics constraint (Re·Kn ∝ Ma). Brute force cannot reach wing
   regimes. Only a coarse-graining hypothesis can, and that hypothesis has
   to be tested, not assumed.
