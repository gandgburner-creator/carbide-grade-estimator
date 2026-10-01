# Acceptance criteria: boundary layer + separation discovery (Phase 0 item 3)

**Pre-registration.** This document is committed and pushed **before** any
validation run (seeds 7001–7404). So are:

- the configuration `BLS_VALIDATION` in
  `src/experiments/BoundaryLayerSeparationExperiment.ts`;
- the rig `src/experiments/WallFlowRun.ts`;
- the analysis `src/experiments/WallFlowAnalysis.ts` and
  `src/experiments/BLSeparationReport.ts`;
- the report script `scripts/report-bl-separation.ts`.

The commit hash goes into the run log and the report. After that commit:

- no threshold, rule, estimator, case or configuration value changes;
- a criterion that turns out to be ill-posed is reported, not repaired. A
  repair would need a new, separately pre-registered run.

Item 1 (thermal + viscosity) and Item 2 (sound speed) are closed and are not
touched. Item 2's registered c₀ = 2.170 ± 0.038 is used only as an external
comparison (Mach number), together with its post-hoc caveat (§10).

## 1. Question and hypotheses

Can a wall interacting with discrete PFAD particles produce, from particle
dynamics alone, a persistent near-wall momentum structure? And does that
structure evolve into measurable separation when the outer flow decelerates?

| | question | tested by |
|---|---|---|
| Q1 | Does a stationary wall change the near-wall momentum distribution relative to the bulk? | I1, I2 |
| Q2 | Is there a reproducible near-wall region of lower mean streamwise velocity? | I1, I4 |
| Q3 | Does its thickness converge with time step, bin width, sampling duration, domain, particle resolution? | I5, I6, I-variants |
| Q4 | Does the wall region respond to an imposed deceleration (no boundary-layer equation anywhere)? | II1 |
| Q5 | Does local reverse streamwise motion appear? | II2 |
| Q6 | Does it persist in time, space and across seeds well enough to be a recirculation zone, not noise? | II3, II5, II6, II8 |
| Q7 | Is the attached → separated transition reproduced in independent seed sets? | II10 |
| Q8 | Does the threshold move when a physical condition (wall accommodation) changes? | Q8 (reported) |

Registered hypotheses (the experiment may refute any of them):

- **H1.** A diffuse wall (Aw = 1 or 0.5) produces a near-wall velocity
  deficit. A specular wall (Aw = 0) does not.
- **H2.** Under strong deceleration the near-wall mean velocity reverses
  over a contiguous region of the plate. It does not reverse over a
  specular wall.
- **H3.** The reversal is absent from the attached control at the same
  statistical sensitivity.

## 2. Physics restrictions (what is NOT used)

The following are absent from the run, the analysis and the criteria:

- the continuum and flow equations: Navier–Stokes, Euler, Bernoulli,
  potential flow, boundary-layer equations;
- the aerodynamic theories: thin-airfoil, lifting-line, circulation, Kutta;
- empirical or reference data: skin-friction or separation correlations,
  XFOIL, NACA data;
- prescribed pressure coefficients, drag or lift coefficients, and
  separation locations.

The run contains only the existing PFAD particle physics:

- Universe A: rigid elastic disks, collisions only;
- Maxwell-accommodation walls (A-08);
- fixed specular polygon bodies (A-19);
- the inflow conditioning zone (A-20, §3.3).

Every "thickness" or "separation" quantity is an integral or sign of measured
particle or wall-impulse data. Conventional names (δ*, θ, Reynolds number,
Mach number) are attached only to plain integrals, or to comparison numbers
labelled **EXTERNAL COMPARISON** (§10).

## 3. Apparatus

### 3.1 Geometry (model units, disk diameter d = 1)

| element | value |
|---|---|
| domain | x ∈ [0, 560) periodic, floor y = 0, ceiling y = H(x) |
| inlet height H_in | 70 |
| fringe (inflow conditioning) | x ∈ [0, 60) |
| lead-in (specular floor) | x ∈ [60, 100) |
| **plate** (Maxwell wall, Aw, kT_w = 1, at rest) | x ∈ [100, 500] |
| floor elsewhere | specular (Aw = 0) |
| ceiling | specular. H(x) = H_in, except: |
| diffuser ramp | x ∈ [180, 400], half-cosine from H_in to H_out = r·H_in (16 straight edges) |
| constant section | x ∈ [400, 500], H_out |
| contraction ramp | x ∈ [500, 560], half-cosine from H_out back to H_in |

- **How the ceiling is built.** It is the top plane wall at H_out, plus two
  fixed specular polygon bodies filling the space above H(x) (A-19).
- **Expansion ratio r.** This is the deceleration parameter, with
  r ∈ {1, 1.5, 2, 2.5}. Case r = 1 is a straight channel with no bodies.
- **Ramp slope.** At r = 2.5 the steepest ramp slope is 0.75. In pilots the
  core still followed this ceiling, with no slow region under the ceiling
  (§11).

### 3.2 Gas

- Universe A: φ = 0.2 (n₀ = 0.2546), mass 1, radius 0.5, kT = 1.
- Collisions are rewind-to-contact, restitution 1. There is no occupancy
  force and no internal energy.
- Initial condition: random sequential placement in the fluid region, a
  Maxwellian at kT = 1, plus a uniform drift of 1 (A-04).
- At φ = 0.2 the mean free path is about one diameter (EXPERIMENT_LOG §5),
  so the 70-high channel is about 70 mean free paths.

### 3.3 Inflow conditioning: the fringe (A-20)

The fringe is the controlled bulk-flow condition: an inlet spread over
x ∈ [0, 60), 100 units upstream of the plate.

**Each step**, every particle in the fringe is, with probability
1 − exp(−ν dt) and ν = 0.5:

1. **New velocity.** It is given a velocity from a drifting Maxwellian
   (U_f(x), kT = 1). U_f falls linearly from U_a at the fringe entrance to
   U_b at its exit.
2. **Vertical mixing.** It is moved to a uniformly random height at the same
   x, if no disk overlaps there. Hard disks have no potential energy, so the
   move changes no energy.

**Bookkeeping.**

- The velocity change is entered in the ledger as external work and
  impulse, so the energy and momentum identities stay closed.
- The resampled particle is marked as having had an event in that step, as
  for a wall re-emission.

**Inflow control (start-up only).** Two controllers act every 2 time units:

- **U_a (PI, gains 0.5 and 0.02):** holds the mass flux through the lead-in
  at Q = n₀ m U H_in, with U = 1 (Q = 17.825).
- **U_b (relaxation rate 0.02):** tracks the mean velocity in the lead-in, so
  that the pumping compression happens inside the fringe and not as a jump
  after it.

**Freeze and settle.** At t = 800 both are frozen at their means over the
preceding 300 time units. The flow then settles under constant forcing until
the measurement starts at t = 1000. Nothing acts on the gas in the
test section (x ≥ 60).

**Why a fringe, and not the existing reservoir rig.** The earlier
`boundary-layer` and `separation` records used open reservoir boundaries:

- the realised density was below the stated value (A-18);
- the upstream control showed a deficit;
- that rig's deceleration was made by far-field suction, and its measured
  wall pressure *fell* along the plate, so it imposed no adverse pressure
  gradient (EXPERIMENT_LOG §8).

The closed periodic rig conserves particles exactly, closes the ledger to
round-off, and has an explicit, measured inflow.

### 3.4 The deceleration mechanism

The deceleration is the ceiling expansion r: a diffuser above a flat plate,
as in wind-tunnel adverse-gradient experiments. Mass conservation in the
particle gas makes the core slow down where the channel widens.

- The wall-pressure rise this produces is **measured** from floor impulses;
  it is not imposed.
- No force acts in the test section, and nothing is applied to near-wall
  particles.
- The fringe is the only energy source; its work rate is reported.
- The plate (Maxwell wall at kT_w = 1) is the heat sink.

### 3.5 Numerics and schedule

| | value |
|---|---|
| time step | adaptive, Courant 0.025 (dt = 0.025 d / v_max), dt ≤ 1 |
| start-up | 1000 time units: controllers active until 800, constant forcing 800–1000 |
| measurement | 1200 time units, sampled every time unit, in 10 consecutive blocks |
| floor tallies | per 5-wide bin: hits, normal and tangential impulse, energy, incident and emitted tangential momentum, diffuse hits |
| near-wall grid | y < 40, cells 10 × 1: count, Σmv, Σmv², collisional virial |
| outer grid | whole channel, cells 10 × 5: the same |
| fine grid | y < 10, cells 5 × 0.5: count, Σmv |
| block grids | per block, y < 40, cells 10 × 2: count, Σmv |
| frames | seed 7001 of A1-r1 and A1-r2.5: 60 particle frames every 0.5 in x ∈ [280, 440), y < 24; seed 7401 of A1-rib: x ∈ [160, 320), y < 30 (animations) |

## 4. Measurement definitions (all from particle or wall-impulse data)

The analysis grid has columns Δx = 20 (two stored columns) and rows Δy = 2.
For a column at x:

- **Core velocity U_e(x).** The mass-weighted mean u over outer-grid cells
  lying entirely within [0.5, 0.9]·H(x). The core density n_e comes from the
  same cells.
- **Near-wall velocity u_wall(x).** The mass-weighted mean u of all
  particles with centres at y < 4.
- **Near-wall mass flux ψ_wall(x).** ∫₀⁴ ρu dy = Σ m v_x over y < 4 /
  (samples · Δx).
- **Wall shear τ_w(x).** The tangential impulse delivered to the floor per
  unit time and length (A-08 tallies). Positive means the gas drags the
  wall downstream. This is the primary wall observable. **No velocity
  derivative is used.**
- **Wall pressure p_w(x).** The normal impulse per unit time and length.
- **Deficit thicknesses** (integrals over y < 0.5·H(x), with the near-wall
  grid below 40):
  - mass-flux deficit δ₁ = ∫(1 − ρu/(ρ_e U_e))dy, the integral
    conventionally called δ*;
  - momentum-flux deficit δ₂ = ∫ρu(U_e − u)/(ρ_e U_e²)dy, conventionally θ.
- **Half-deficit height y½.** The lowest y at which U_e − u has fallen to
  half of its first-row value (linear interpolation between rows).
- **Velocity deficit D(x).** D = U_e − u_wall.
- **Stream function ψ(x, y).** ∫₀^y ρu dy′ at row tops (Δy = 1 rows). ψ < 0
  above the floor means net upstream mass flux. The dividing height is where
  ψ returns to 0, i.e. forward flow above.
- **Time-resolved near-wall velocity.** u_wall of every 120-unit block, per
  seed.
- **Fluctuations** (reported): σ_u² and σ_v² per cell, the kinetic momentum
  flux ρ⟨u′v′⟩, the collisional virial stress, occupancy φ and local kT.

## 5. Cases, seeds and execution

| key | role | r | Aw | seeds | group |
|---|---|---|---|---|---|
| A1-r1 | attached control (Control 1, the null) | 1 | 1 | 7001–7008 | aw1 |
| A1-r1.5 | weak deceleration (Control 2) | 1.5 | 1 | 7001–7008 | aw1 |
| A1-r2 | moderate deceleration (Test 1) | 2 | 1 | 7001–7008 | aw1 |
| A1-r2.5 | strong deceleration (Test 2) | 2.5 | 1 | 7001–7008 | aw1 |
| A05-r1 | attached, intermediate accommodation | 1 | 0.5 | 7101–7106 | aw05 |
| A05-r2 | moderate, Aw = 0.5 | 2 | 0.5 | 7101–7104 | aw05 |
| A05-r2.5 | strong, Aw = 0.5 | 2.5 | 0.5 | 7101–7104 | aw05 |
| A0-r1 | specular plate (falsification) | 1 | 0 | 7201–7204 | aw0 |
| A0-r2.5 | specular plate, strong deceleration (falsification) | 2.5 | 0 | 7201–7204 | aw0 |
| A1-r2.5-dt | timestep variant: Courant 0.0125 | 2.5 | 1 | 7301–7304 | variants |
| A1-r2.5-len | domain-length variant: constant section and plate +100 (L = 660) | 2.5 | 1 | 7301–7304 | variants |
| A1-r2.5-res | particle-resolution variant: radius 0.4 at the same φ (1.56× particles) | 2.5 | 1 | 7301–7304 | variants |
| A1-r2.5-H | domain-height variant: H_in 105, ramp and constant section scaled ×1.5 | 2.5 | 1 | 7301–7304 | variants |
| A1-r1-H | domain-height variant of the attached control: H_in 105 | 1 | 1 | 7301–7304 | variants |
| A1-rib | **positive control**: straight channel with a floor rib x ∈ [200, 220), height 20, diffuse faces (Aw = 1) — geometric separation behind an obstacle, analysed with the same detector | 1 | 1 | 7401–7404 | aw0 |

**Why these seed counts.** In the 4-seed ensemble pilot (§11), the
standard errors of 20-wide near-wall columns over 1200 time units were
0.004–0.015. Eight seeds give about 0.003–0.010.

- That resolves a reverse velocity of −0.02 at the column level
  (t ≈ 4 ≥ t₀.₀₀₅,₇ = 3.50).
- A05-r1 has six seeds, because it is judged in Part I.
- The Aw = 0.5 decelerations have four, because they feed only the reported
  Q8.
- The falsification cases, the positive control and the variants have four
  and are judged at the region level, where the noise is several times
  lower.
- The planned compute is about 1.4 × 10⁵ core-seconds (≈ 39 core-hours,
  ≈ 10 h on 4 cores).

Seed ranges are disjoint between groups, so no two compared ensembles share
initial conditions.

**Commands** (from a worktree pinned to the pre-registration commit):

```
results/logs/bl_validation_run.sh   # runs, in order:
npx tsx scripts/run-experiment.ts boundary-layer-separation --parallel 4 --set groups='["aw1"]'      --out results --name bl-separation_aw1
npx tsx scripts/run-experiment.ts boundary-layer-separation --parallel 4 --set groups='["aw0"]'      --out results --name bl-separation_aw0
npx tsx scripts/run-experiment.ts boundary-layer-separation --parallel 4 --set groups='["variants"]' --out results --name bl-separation_variants
npx tsx scripts/run-experiment.ts boundary-layer-separation --parallel 4 --set groups='["aw05"]'     --out results --name bl-separation_aw05
npx tsx scripts/report-bl-separation.ts results/plots/bl_separation results/bl-separation_*.json
```

## 6. Statistics

**Ensembles.** Every judged quantity is a seed ensemble:

- the per-seed value is computed from that seed's own sums;
- the ensemble gives the mean, the SE of the mean (seed-to-seed SD/√n) and
  the Student t with n − 1 degrees of freedom.

**Comparisons between cases** use the Welch z = Δ/√(SE₁² + SE₂²).

**Regions.** A region value is the per-seed mean over the region's columns,
then the ensemble of those means.

**Column reversal test.** One-sided:

- reversed if mean u_wall < 0 and t ≤ −t_{0.005, n−1};
- a *separated region* is ≥ 2 contiguous reversed columns (≥ 40 units)
  inside the search window x ∈ (120, 480).

**Multiple testing.** There are 18 columns in the window. With independent
columns, the chance of a false 2-column run in an attached case is about
18 × 0.005² ≈ 5 × 10⁻⁴. Requiring contiguity is the multiple-testing
control, and the attached control (A1-r1) checks it empirically (II4).

**Persistence thresholds** use one-sided α = 0.025.

## 7. Part I — near-wall structure

Stations (column centres) are x = 150, 210, 310, 410, i.e. 50–310 downstream
of the leading edge. The upstream control is x = 70 (lead-in, specular
floor).

| ID | criterion | outcome rule |
|---|---|---|
| I1 (A1-r1, A05-r1) | at every station, D = U_e − u_wall and δ₁ each have seed t ≥ 5 | PASS if met. FAIL if at every station the 95 % CI of D lies below 0.05 (demonstrably absent). Else INCONCLUSIVE |
| I2 (A0-r1) | at every station the 95 % CI of D lies within ±0.2 × D(A1-r1), and the floor's tangential impulse is exactly 0 | PASS. FAIL if a CI lies entirely outside or the impulse is non-zero. Else INCONCLUSIVE |
| I-upstream (all cases) | \|D(x = 70)\| ≤ 0.05 + 3 SE | PASS / INCONCLUSIVE |
| I3 (A1-r1, A05-r1) | plate-mean τ_w over (120, 480) has seed t ≥ 5 | PASS / INCONCLUSIVE |
| I4 (A1-r1) | odd/even seed halves: δ₁ agree (\|z\| < 3) and the deficit has t ≥ 3 in each half, at every station | PASS / INCONCLUSIVE |
| I5 (A1-r1) | sampling duration: near-wall velocity, second vs first half of the measurement — the 95 % CI of the paired relative change lies within ±0.15 at every station | PASS / FAIL (CI entirely outside) / INCONCLUSIVE |
| I6 (A1-r1) | bin width: y½ and u_wall at (Δx, Δy) = (20, 2) vs (40, 4), and y½ at Δy = 1 | see agreement rule |
| I-variant dt, len (A1-r2.5 variants, x = 150) | δ₁ and τ_w | see agreement rule |
| I-variant H (A1-r1-H at x = 150, 210; A1-r2.5-H at x = 150) | δ₁ and τ_w | see agreement rule |
| I-variant res (A1-r2.5-res, x = 150) | the deficit is still significant (t ≥ 5); the thickness ratio is reported | PASS if t ≥ 5. FAIL if the deficit's 95 % CI lies below 0.2 × the reference deficit. Else INCONCLUSIVE |

**Agreement rule** (numerical, domain and bin-width checks) — an
equivalence test, as in Item 2. Take the 95 % CI of the relative difference
rel = (variant − reference)/|reference|, with Welch SE and Student t on
min(n) − 1 degrees of freedom.

- **PASS** if the CI lies within ±0.15.
- **FAIL** if it lies entirely outside.
- **INCONCLUSIVE** otherwise.

**Why equivalence and not significance.** A significance test would penalise
precision: an 8-seed reference resolves differences of a few per cent, which
would then "fail" a convergence check. The equivalence form asks the
physical question: is the change smaller than 15 %?

The particle-resolution variant changes the regime as well as the
resolution. At fixed φ, smaller disks lower ν and λ in model units, so Re
rises and Kn falls. Only the persistence of the structure is therefore
judged there; its thickness ratio is reported and compared with diffusive
scaling as an EXTERNAL COMPARISON.

## 8. Part II — deceleration and separation

The primary region is the longest separated region of A1-r2.5 (ties: the
lower mean u_wall).

| ID | criterion | outcome rule |
|---|---|---|
| II1 (A1-r1.5, r2, r2.5) | Q4: the wall-pressure rise Δp_w = p̄_w(420–480) − p̄_w(140–180) has seed t ≥ 5, and u_wall over (280, 480) is below A1-r1 (Welch z ≤ −5) | PASS / INCONCLUSIVE |
| II2 (A1-r2.5) | Q5, indicator A: ≥ 1 separated region (§6) | PASS if found. FAIL if every window column is significantly *forward* (u_wall and τ_w both t ≥ t₀.₀₀₅). Else INCONCLUSIVE |
| II4 (A1-r1) | null: no separated region in the attached control | PASS / FAIL |
| II3 (primary region) | Q6, indicator B, all of: region-mean u_wall t ≤ −t₀.₀₂₅ in each half of the measurement and in each seed half; fraction of negative 120-unit block means ≥ 0.5 **and** above the attached control's maximum over its window columns; ≥ 75 % of seeds negative | PASS / INCONCLUSIVE |
| II5 (primary region) | indicator D: region-mean τ_w (floor impulses, independent of the field sampling) t ≤ −t₀.₀₂₅ | PASS / INCONCLUSIVE |
| II6 (primary region) | indicator C: region-mean ψ_wall t ≤ −t₀.₀₂₅, and in most region columns ψ returns to ≥ 0 below y = 40 (return flow under forward flow) | PASS / INCONCLUSIVE |
| II7 | indicator E: δ₂ at x = 470, A1-r2.5 > A1-r1 (Welch z ≥ 3) | PASS / INCONCLUSIVE |
| II8 (primary region) | the near-wall number density (y < 4) is ≥ 0.5 × the core density in every region column (not depletion), and no empty-space flag | PASS / FAIL |
| II9 dt, len | over the primary-region columns: variant region-mean u_wall t ≤ −t₀.₀₂₅, and the 95 % CI of its difference from the reference lies within ±0.02 | FAIL if the variant is significantly forward (t ≥ t₀.₀₂₅) or that CI lies entirely outside; PASS if both hold; else INCONCLUSIVE |
| II9 res, H | variant region-mean u_wall t ≤ −t₀.₀₂₅ | FAIL if significantly forward; else PASS / INCONCLUSIVE |
| II9 bin width | with Δx = 40, a reversed column (p ≤ 0.005) overlaps the primary region | PASS / INCONCLUSIVE |
| II10 | Q7: in each seed half, A1-r1 has no separated region and A1-r2.5's primary-region u_wall has t ≤ −t₀.₀₂₅ | PASS / INCONCLUSIVE |
| II9 response (all four A1-r2.5 variants; evaluated whether or not the flow reverses) | Q3/Q4 convergence of the deceleration response: the response-window (280–480; positions mapped by the diffuser scaling for the height variant) region-mean u_wall and τ_w. Timestep and length variants: equivalence with the reference, where the 95 % CI of the difference must lie within the **absolute** margins ±0.02 (u_wall) and ±0.002 (τ_w). FAIL if a CI lies entirely outside. Resolution and height variants: the variant still responds (u_wall below A1-r1's, Welch z ≤ −5). | PASS / INCONCLUSIVE / FAIL |
| PC (A1-rib) | detector sensitivity: a separated region in (220, 400) behind the rib, with region-mean τ_w and ψ_wall t ≤ −t₀.₀₂₅ and a bounded return-flow layer in most of its columns | PASS / INCONCLUSIVE |
| II11 (A0-r2.5) | falsification: over a specular wall, the same deceleration gives no separated region and the region-mean u_wall is not significantly negative | PASS / FAIL |
| Q8 (reported) | Smallest r with a separated region, for Aw = 1 and Aw = 0.5, and the Aw = 0.5 − Aw = 1 difference in region-mean u_wall at r = 2 and 2.5 (Welch z). **Not judged.** The design has only two accommodations and three to four expansions, so "moves consistently" can be described but not tested with power. | reported |

If A1-r2.5 has no separated region, II3, II5, II6, II8, the II9 persistence
checks, II10 and II11 are not evaluated, and Part II cannot PASS. The II9
response checks, II7 and PC are evaluated in either case.

**Why the absolute tolerances for the response.** In the design pilots the
strong-case near-wall velocity is close to zero, so a relative tolerance is
meaningless there. The tolerances are about 12 % of the attached control's
near-wall velocity (≈ 0.16) and 10 % of its wall shear (≈ 0.020).

**Why a positive control.** If the strong case stalls without a significant
reversal, that finding must be distinguishable from a detector that cannot
see recirculation in this medium at all. The rib produces geometric
separation, which needs no adverse-pressure-gradient mechanism. The same
detector, the same thresholds and the same seed statistics are applied to
it. The positive control is not a flat-wall case, and it does not count as
evidence for flat-wall separation.

The thermal-noise analysis is the same for every reported region and every
case:

- mean reverse velocity ± SE;
- fraction of negative block means against the attached control's
  distribution;
- the two measurement halves and the seed halves;
- the number of negative seeds;
- the length and the dividing height;
- the comparison with A1-r1 at the same columns.

## 9. Classification

Safety checks (all judged, PASS or FAIL):

- no run halted;
- energy and momentum ledgers close (|relative residual| < 10⁻⁹);
- no empty-space flag.

**Part I** and **Part II** are each:

- **FAIL** if any judged check in that part (or a safety check) is FAIL;
- **PASS** if all are PASS;
- **INCONCLUSIVE** otherwise.

**Item 3 overall:**

- **PASS** only if Part I and Part II both PASS;
- **FAIL** if either part FAILs;
- **INCONCLUSIVE** otherwise.

**FAIL cases, in words:**

- the near-wall structure demonstrably does not emerge (I1);
- the specular wall shows the same structure (I2);
- the strong case is demonstrably attached (II2);
- the attached control shows "separation" (II4);
- the specular wall "separates" (II11);
- a numerical variant makes the reversal decisively disappear (II9);
- the reversed region is a depletion (II8);
- a ledger or safety failure.

**INCONCLUSIVE, in words:** the effect appears but statistical confidence,
persistence or convergence is insufficient, or multiple interpretations
remain. If the near-wall flow under the strongest deceleration stalls at
u ≈ 0 without a significant reversal, Part II is INCONCLUSIVE ("signal at
the noise floor"), not PASS.

**A gradual transition is reported as gradual** (order parameters against
r, §8 Q8 and the threshold table). No binary threshold is forced.

## 10. External comparisons (labelled; never used for classification)

- **Re_plate** = ρ_e U_e L_plate / μ, with μ = 0.351 at φ = 0.2
  (`viscosity_sweeps.json`, 4 seeds, INCONCLUSIVE record). The Enskog
  benchmark 0.379 is also stated.
- **Mp** = U_e / c, with c = 2.170, Item 2's registered c₀. The post-hoc
  small-amplitude estimate of about 2.26 is stated alongside. 2.170 is
  **not** treated as a high-confidence constant.
- **Blasius δ\*** = 1.72 √(νx/U) at the attached-control stations. It
  assumes a continuum, zero pressure gradient and no slip, so it is not
  expected to hold here.
- **Knudsen number** λ/δ₁ (λ ≈ 1).

## 11. Design pilots (design seeds 9001–9304; not validation data)

The pilots below fixed the apparatus. None of their data enters the
validation. Every value above was chosen before any seed ≥ 7001 was run.

| finding | consequence |
|---|---|
| A fringe that resets velocities only passes a vertically stratified density through it, because ρu is conserved per streamline. The inflow then had a near-floor deficit over the specular lead-in. | Vertical position mixing in the fringe. |
| Pumping in the closed loop needs a pressure rise. A velocity-pinned fringe produced a compression jump right after it. | U_b tracks the lead-in velocity, so the compression happens inside the fringe. |
| Steep linear ramps (slope ≥ 1.2) made the core separate from the ceiling corner, so the plate saw little pressure rise. | Smooth half-cosine ramps, maximum slope 0.75 at r = 2.5 (core followed the ceiling). |
| φ = 0.1: under the strongest decelerations the near-wall layer stalled (u ≈ 0) without a clear reversal. φ = 0.2 doubles Re per unit length and lowers near-wall noise (block SD 0.056 vs 0.086). | φ = 0.2. |
| U = 1.4: the friction losses need more pumping than the loop can supply. The controller ran away and the core reached Mp ≈ 0.9. | U = 1. |
| Beyond r ≈ 2.5 the pressure rise saturates at the inflow dynamic pressure; slopes above ~0.8 risk ceiling separation. | r_max = 2.5. |
| Single-seed pilots at r = 2–2.5: the near-wall velocity hovers between about −0.04 and +0.04 over x ≈ 300–480, and τ_w is often slightly negative. | The strong case is expected to be near the separation threshold, hence the statistical design of §6. |
| The straight channel (r = 1) is not a zero-pressure-gradient flow. Blockage and friction accelerate the core about 40 % along the plate. | Reported as the attached control's measured favourable gradient. Nothing in the analysis assumes zero gradient. |

**Ensemble design pilot** (seeds 9101–9104, 4 seeds × 1200 time units after a
1000 start-up, the configuration of §3):

- **A1-r1.**
  - Near-wall velocity 0.13–0.18 against a core of 1.0–1.4; τ_w ≈ 0.020
    (t 11–85).
  - δ₁ grows from 5 to 16 and levels off.
  - No separated region; the fraction of negative block means is 0 in every
    window column.
  - The inflow mass flux is within 1 % of the target.
- **A1-r2.5.** The near-wall flow **stalls** over x ≈ 290–450:
  - region-mean u_wall over (280, 480) is +0.0006 ± 0.0029 (t 0.2);
  - over (360, 440) it is −0.006 ± 0.004;
  - τ_w is −0.0009 ± 0.0003 over (360, 440), against +0.020 attached;
  - no separated region; negative block fraction ≈ 0.5, consistent with a
    zero mean;
  - stationary over the 10 blocks.
- **Thinner band.** u_wall over y < 2 instead of y < 4 gives the same picture
  (~0 ± 0.005). The band stays y < 4, as planned.

**What this predicts.** With 8 seeds, a reversal of the stall magnitude
(≈ −0.005) would not be resolved at the column level. The pre-registered
outcome rules handle this case explicitly: Part II is INCONCLUSIVE, not
PASS. **The criteria were not loosened after this pilot.** The analysis plan
had been written before it. The pilot added the positive control and the
response-convergence checks, which make an INCONCLUSIVE or FAIL outcome
informative, not easier to pass.

**Positive-control design pilot** (A1-rib, seeds 9201–9204). The same
detector found a separated region x ∈ [220, 260] behind the rib:

- near-wall velocity −0.042 ± 0.005 (t −9.3), negative in all 4 seeds;
- τ_w −0.004 (t −3 to −5);
- 72–78 % of the block means negative, in both halves;
- reattachment by x ≈ 270, i.e. about 2.5 rib heights.

PFAD therefore produces recirculation that this detector resolves, when the
geometry forces separation.

**Steeper-gradient design pilot** (H_in = 50, r = 2.5, ramp [180, 337]: the
same maximum slope, a 1.4× steeper adverse gradient; seeds 9301–9304):

- the same stall: u_wall 0 ± 0.005 over x ≈ 270–450;
- τ_w ≈ 0;
- no separated region.

This case is not part of the validation.

## 12. Reporting

`docs/REPORT_BOUNDARY_LAYER_SEPARATION.md` reports:

- every check;
- every reported quantity;
- all plots: particle snapshots, velocity maps, profiles, momentum-deficit
  profiles, wall impulse and pressure, occupancy, reverse-flow and stream
  maps, indicators vs x, time evolution, seed variation, convergence,
  threshold, and an HTML particle animation.

Raw records (every run's raw sums and tallies) are kept in
`results/bl-separation_*.json`.
