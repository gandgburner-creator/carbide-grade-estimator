# Phase 0 item 3: boundary layer + separation discovery — validation report

**Classification: INCONCLUSIVE.**

- Part I (near-wall structure): INCONCLUSIVE.
- Part II (separation): INCONCLUSIVE.
- No check is FAIL.

Judged by the pre-registered rules of
`docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md` (commit `bb7f92e`). The
validation records are `results/bl-separation_{aw1,aw0,variants,aw05}.json`:
78 runs, seeds 7001–7404.

## Executive summary

**The question.** Does a flat wall made of PFAD particle physics, with no
flow equations, produce a near-wall momentum structure? Does that structure
separate when the outer flow is decelerated?

**The rig.** A closed periodic channel with a diffuse plate on its floor and
a widening ceiling. The bulk flow is set only by an upstream inflow-
conditioning zone. Everything was measured from particle sums and floor
impulses.

**Measured, with high confidence:**

1. **Near-wall structure.**
   - A diffuse wall (Aw = 1 and Aw = 0.5) produces a strong, reproducible
     near-wall layer of slow gas. The deficit U_e − u_wall is 0.74–1.21 with
     seed t of 80–241.
   - The mass-flux deficit thickness δ₁ grows from 9–11 to 15–16 diameters
     along the plate.
   - A specular wall (Aw = 0) produces no deficit (CIs within ±0.08).
   - Odd and even seed sets agree.
   - The layer survives a 1.56× increase in particle count (t 185).
2. **Wall momentum transfer.** It is directly measurable: the plate-mean wall
   shear from floor impulses is 0.0224 ± 0.0001 (t 187). A specular plate
   transfers exactly zero.
3. **Response to deceleration.**
   - Widening the ceiling produces a measured adverse wall-pressure rise:
     Δp_w = +0.031 and +0.036 at r = 2 and 2.5 (t ≈ 25), against −0.164 in
     the straight channel.
   - The near-wall flow over the rear plate slows by an order of magnitude,
     from 0.172 to 0.007 and −0.002 (Welch z −43 to −46).
   - The momentum-deficit layer thickens 2.6-fold.
   - This response is reproduced under halved timestep, finer particles and
     a taller domain.
4. **Sensitivity to the wall model.**
   - The specular plate under the same deceleration stays forward at
     u ≈ 0.60.
   - Aw = 0.5 is more forward than Aw = 1 at equal deceleration (z 5.5 at
     r = 2).
5. **Ledgers.** Energy and momentum ledgers close to 3 × 10⁻¹³ in every run.

**Not established:**

6. **Separation is not resolved.** Under the strongest deceleration the
   near-wall flow **stalls**:
   - the mean near-wall velocity over x = 280–480 is −0.002 ± 0.003, 95 % CI
     [−0.010, +0.006];
   - the registered detector (≥ 2 adjacent columns reversed at p ≤ 0.005)
     finds **no separated region**: one column reaches the threshold, its
     neighbours do not;
   - so the attached → separated transition is not observed at the
     registered sensitivity. That sensitivity is a mean reverse velocity of
     about 0.02.
7. **Post-hoc only:** the floor's tangential impulse turns negative over
   x ≈ 310–430, with t −5.9 over 400–440 and 8 of 8 seeds negative. The
   stream function is negative near the wall. This suggests a weak, thick
   (~30 d) recirculating layer of mean speed ~0.01 — under 1 % of the thermal
   speed. These observations were not pre-registered, involve a data-chosen
   band, and are not part of the classification.
8. **Positive control.** The rib positive control was meant to show the
   detector can see recirculation.
   - Behind the rib the near-wall flow is reversed in all 4 seeds.
   - But with 4 seeds the registered column test needs t ≤ −5.84, and the
     strongest column reached −5.81. The control is therefore INCONCLUSIVE.
     This is a design (power) defect of the criteria, reported here and not
     repaired.
9. **Thickness convergence is only partly decided.**
   - Every δ₁ comparison under timestep, length, height and bin width is
     within ±15 % in its point estimate. All but the height variant at
     x = 210 (CI [0.097, 0.16]) have their whole 95 % CI inside ±15 %.
   - The paired single-column wall-shear comparisons with 4 seeds, the
     sampling-duration halves, and one bin-width component have CIs too wide
     to decide at ±15 %.

**What is missing for Item 3 to PASS:**

- a resolved, persistent reversal under deceleration (or a demonstration
  that there is none);
- a positive control with enough seeds to pass its own detector;
- convergence checks with enough precision to decide at ±15 %.

§21 names the experiment that would supply them.

**Unchanged.** Items 1 and 2 are untouched. Airfoil optimisation, inverse
design and Kutta work stay locked.

## 1. Experimental question

Can a wall interacting with discrete PFAD particles produce, from particle
dynamics alone, a persistent near-wall momentum structure? And does that
structure evolve into measurable separation when the outer flow decelerates?

| | question | judged by | answer from this data |
|---|---|---|---|
| Q1 | Does a stationary wall change the near-wall momentum distribution relative to the bulk? | I1, I2 | **yes** (PASS) |
| Q2 | Is there a reproducible near-wall region of lower mean streamwise velocity? | I1, I4 | **yes** (PASS) |
| Q3 | Does its thickness converge with timestep, bin width, sampling duration, domain, particle resolution? | I5, I6, I-variants | partly: δ₁ agrees; several checks undecided at ±15 % |
| Q4 | Does the wall region respond to an imposed deceleration? | II1, II9 response | **yes** for r = 2, 2.5 (PASS); r = 1.5 makes no net adverse rise |
| Q5 | Does local reverse streamwise motion appear? | II2 | not resolved (one column; no region) |
| Q6 | Does it persist well enough to be recirculation, not noise? | II3, II5, II6, II8 | not evaluated (no region) |
| Q7 | Is the attached → separated transition reproduced in independent seed sets? | II10 | not evaluated |
| Q8 | Does the threshold move when wall accommodation changes? | reported | no threshold in range; the approach to stall shifts with Aw (§14) |

## 2. Registered hypotheses

- **H1.** A diffuse wall (Aw = 1 or 0.5) produces a near-wall velocity
  deficit. A specular wall does not. **Supported** (I1 and I2 PASS).
- **H2.** Under strong deceleration the near-wall mean velocity reverses
  over a contiguous region of the plate, and does not reverse over a
  specular wall. **Not supported at the registered sensitivity.**
  - The near-wall flow stalls without a resolved reversal.
  - The specular part holds: no stall and no reversal over a specular wall.
- **H3.** The attached control shows no reversal at the same sensitivity.
  **Supported** (II4 PASS).

**Pre-registration.** The criteria, the configuration
(`BLS_VALIDATION`), the rig, the analysis and the report script were
committed in `bb7f92ec02dd7717a086ebbe305fb813716504bc` and pushed before
any validation seed was run.

**After the pre-registration, three kinds of change were made. None changes
a rule, threshold, estimator, case, seed or configuration value:**

1. **Execution harness** (`ec00c06`, before the data).
   - Container restarts killed the first launches, which held finished runs
     in memory. Per-run checkpoint/resume was added (`scripts/parallel.ts`,
     `scripts/run-experiment.ts`, the run script).
   - The validation ran in a worktree pinned to `ec00c06`.
   - `git diff bb7f92e ec00c06 -- src docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md`
     is empty.
   - Runs are deterministic per seed. A resumed record equals an
     uninterrupted one; this was checked on a quick configuration (30 of 30
     runs identical).
2. **Analysis crash fix** (`1118cf5`, after aw1, aw0 and variants had been
   seen).
   - The registered analysis threw on the domain-height variant. Its length
     of 750 is not a multiple of the 20-unit analysis column.
   - `coarsen()` now drops a trailing strip narrower than one column:
     x ∈ [740, 750), inside the contraction, outside every window.
   - Grids that divide exactly are unchanged by construction. The report on
     aw1 + aw0 is byte-identical before and after.
3. **Plot fixes.** SVG text escaping, because titles containing "<" were
   invalid XML, and two more line colours. The text report is identical.

## 3. Configuration

The geometry, gas, fringe and schedule are those of the criteria §3:

- **Channel:** L = 560, H_in = 70, periodic.
- **Fringe:** x ∈ [0, 60), ν = 0.5, controllers frozen at t = 800.
- **Plate:** x ∈ [100, 500].
- **Diffuser:** a half-cosine ceiling ramp over x ∈ [180, 400] from H_in to
  r·H_in.
- **Contraction:** x ∈ [500, 560].
- **Gas:** φ = 0.2, d = 1, m = 1, kT = 1.
- **Schedule:** start-up 1000, then measurement 1000–2200 sampled every time
  unit in 10 blocks.
- **Time step:** adaptive Courant 0.025 (0.0125 in the timestep variant).

**Realised inflow per case** (lead-in mass flux, measured against the
target; frozen fringe velocities; mean kT over the measurement):

| case | role | r | Aw | seeds | N | inflow Q (target) | U_a / U_b | kT | s/run |
|---|---|---|---|---|---|---|---|---|---|
| A1-r1 | attached control | 1 | 1 | 7001–7008 | 9 982 | 18.45 (17.83) | 1.26 / 0.85 | 0.992 | 786 |
| A1-r1.5 | weak | 1.5 | 1 | 7001–7008 | 12 121 | 18.14 | 1.25 / 0.89 | 1.050 | 1 190 |
| A1-r2 | moderate | 2 | 1 | 7001–7008 | 14 260 | 17.91 | 1.34 / 0.88 | 1.100 | 1 550 |
| A1-r2.5 | strong | 2.5 | 1 | 7001–7008 | 16 399 | 17.44 | 1.36 / 0.87 | 1.129 | 2 360 |
| A05-r1 | attached, Aw = 0.5 | 1 | 0.5 | 7101–7106 | 9 982 | 18.30 | 1.22 / 0.87 | 0.988 | 844 |
| A05-r2 | moderate, Aw = 0.5 | 2 | 0.5 | 7101–7104 | 14 260 | 17.80 | 1.30 / 0.89 | 1.100 | 1 660 |
| A05-r2.5 | strong, Aw = 0.5 | 2.5 | 0.5 | 7101–7104 | 16 399 | 17.53 | 1.35 / 0.89 | 1.129 | 2 100 |
| A0-r1 | specular plate | 1 | 0 | 7201–7204 | 9 982 | 17.74 | 0.99 / 1.00 | 1.004 | 795 |
| A0-r2.5 | specular, strong | 2.5 | 0 | 7201–7204 | 16 399 | 17.42 | 1.15 / 0.97 | 1.142 | 2 010 |
| A1-rib | positive control (rib x ∈ [200, 220), h 20) | 1 | 1 | 7401–7404 | 9 880 | 18.95 | 1.31 / 0.76 | 1.018 | 830 |
| A1-r2.5-dt | Courant 0.0125 | 2.5 | 1 | 7301–7304 | 16 399 | 17.52 | 1.38 / 0.88 | 1.128 | 3 810 |
| A1-r2.5-len | L 660, plate and constant section +100 | 2.5 | 1 | 7301–7304 | 20 856 | 17.42 | 1.38 / 0.86 | 1.122 | 2 370 |
| A1-r2.5-res | radius 0.4, same φ (1.56× N) | 2.5 | 1 | 7301–7304 | 25 624 | 27.42 (27.85) | 1.33 / 0.89 | 1.131 | 3 860 |
| A1-r2.5-H | H_in 105, ramp/section ×1.5 | 2.5 | 1 | 7301–7304 | 34 492 | 26.48 (26.74) | 1.33 / 0.87 | 1.120 | 4 230 |
| A1-r1-H | H_in 105, straight | 1 | 1 | 7301–7304 | 14 973 | 27.00 (26.74) | 1.10 / 0.91 | 0.996 | 1 230 |

**Inflow.** The realised inflow mass flux is within ±3.5 % of the target in
every case, and within ±6 % in the rib case, where the obstacle adds drag.
The frozen-controller drift is reported per run in the records. The
mean-kT rise in the decelerated cases (up to +14 %) is the measured
compression and frictional heating of the closed loop; it is not imposed.

**Runtime and machine.**

- Group wall-clock times: aw1 9 069 s, aw0 3 668 s, variants 15 557 s,
  aw05 5 425 s. Total 33 719 s ≈ 9.4 h on 4 cores (node v22.22.2, Linux).
- That excludes about 1.6 h lost to container restarts, which are recorded
  in `results/logs/bl_validation_timings*.txt`.

## 4. Particle model

- **Gas.** Universe A rigid elastic disks (A-02, A-05, A-06). The disks only
  collide: restitution 1, no occupancy force, no internal energy.
- **Numerics.** Rewind-to-contact collisions with an adaptive timestep (A-14).
- **No model change.** The core physics is the same as in Items 1 and 2;
  there is no model change for Item 3 (MODEL_CHANGELOG).
- **Physics restrictions.** None of the restricted physics of the criteria
  §2 is used anywhere: no flow equations, no aerodynamic theory, no empirical
  correlations, no prescribed coefficients or separation locations.

## 5. Wall model

- **Plate.** Maxwell accommodation (A-08) with Aw ∈ {0, 0.5, 1}, at rest,
  kT_w = 1. The rest of the floor and the ceiling are specular.
- **Ceiling shape.** Fixed specular polygon bodies (A-19).
- **Rib.** A fixed polygon with diffuse faces (A-19).
- **No friction law.** Aw is a microscopic re-emission probability; no
  viscosity, slip length or friction law is set.

## 6. Forcing / deceleration model

- **Bulk flow (A-20).**
  - The fringe x ∈ [0, 60) resamples particles to a drifting Maxwellian and
    mixes them vertically.
  - Its controllers act only during start-up; they are frozen at t = 800.
  - Nothing acts on the gas in the test section (x ≥ 60).
  - The fringe's work and impulse enter the ledger.
- **Deceleration.** The ceiling widens by the ratio r.
  - The resulting wall-pressure rise is measured from floor impulses, not
    imposed.
  - No near-wall particle is forced.
- **Energy.** The fringe is the only energy source; the diffuse plate is the
  heat sink.

## 7. Measurement definitions

These are the criteria §4, all from particle sums or floor tallies. No
velocity derivative is used anywhere.

- **Velocities.**
  - U_e: core mass-weighted u over [0.5, 0.9]·H.
  - u_wall: mean u over y < 4.
  - ψ_wall: near-wall mass flux.
- **Wall quantities.** τ_w and p_w are the tangential and normal floor
  impulse per unit time and length.
- **Deficit integrals.** δ₁ and δ₂ are the mass- and momentum-flux deficit
  integrals over y < 0.5 H (conventionally δ*, θ). y½ is the half-deficit
  height.
- **Stream function.** ψ(x, y), with dividing height ψ = 0.
- **Time resolution.** Ten 120-unit blocks.
- **Statistics.** Seed ensembles, Welch z for comparisons, one-sided column
  tests at p ≤ 0.005, region tests at p ≤ 0.025, and equivalence CIs at ±15 %
  (relative) or ±0.02 / ±0.002 (absolute response).

## 8. Boundary-layer observations

### 8.1 The near-wall structure (Q1, Q2)

**Aw = 1** (attached control A1-r1, 8 seeds):

| x (from leading edge) | U_e | u_wall | deficit (t) | δ₁ | δ₂ | y½ | τ_w |
|---|---|---|---|---|---|---|---|
| 150 (50) | 1.07 | 0.169 ± 0.007 | 0.903 ± 0.008 (112) | 10.8 ± 0.1 | 4.06 ± 0.06 | 9.6 ± 0.1 | 0.0263 ± 0.0009 |
| 210 (110) | 1.18 | 0.148 ± 0.004 | 1.03 ± 0.009 (121) | 14.2 ± 0.1 | 5.29 ± 0.05 | 12.5 ± 0.1 | 0.0217 ± 0.0008 |
| 310 (210) | 1.28 | 0.146 ± 0.007 | 1.13 ± 0.005 (241) | 15.8 ± 0.1 | 5.75 ± 0.05 | 13.8 ± 0.2 | 0.0198 ± 0.0006 |
| 410 (310) | 1.39 | 0.181 ± 0.008 | 1.21 ± 0.010 (115) | 16.4 ± 0.1 | 5.76 ± 0.04 | 14.2 ± 0.3 | 0.0222 ± 0.0009 |

**Aw = 0.5** (A05-r1, 6 seeds):

| x | U_e | u_wall | deficit (t) | δ₁ | δ₂ | τ_w |
|---|---|---|---|---|---|---|
| 150 | 1.05 | 0.308 ± 0.005 | 0.738 ± 0.009 (81) | 8.76 ± 0.11 | 3.89 ± 0.11 | 0.0241 ± 0.0014 |
| 210 | 1.15 | 0.250 ± 0.008 | 0.895 ± 0.009 (98) | 12.3 ± 0.2 | 5.36 ± 0.02 | 0.0199 ± 0.0006 |
| 310 | 1.25 | 0.258 ± 0.009 | 0.987 ± 0.010 (101) | 14.3 ± 0.1 | 5.92 ± 0.05 | 0.0166 ± 0.0011 |
| 410 | 1.34 | 0.284 ± 0.005 | 1.05 ± 0.009 (112) | 14.9 ± 0.2 | 6.03 ± 0.05 | 0.0186 ± 0.0006 |

**Aw = 0** (A0-r1, 4 seeds): the deficit is 0.003, 0.013, 0.012 and 0.009,
each 95 % CI inside ±0.08 (I2). Over a specular wall the near-wall gas moves
with the core, at u_wall ≈ 0.99.

Plots: `profile_x{150,210,310,410}.svg`, `momentum_deficit_x*.svg`,
`velocity_*.svg`, `delta1_vs_x.svg`, `Ue_vs_x.svg`, `snapshot_A1-r1.svg`,
`animation_A1-r1.html`.

What the particle data show:

- **Slip.** The gas at the wall is not at rest.
  - The near-wall mean velocity is 0.15–0.18 (Aw = 1) and 0.25–0.31
    (Aw = 0.5). In the first two rows (y < 2) it is ≈ 0.1 for Aw = 1.
  - A Maxwell wall re-emits with zero mean tangential velocity, but the
    first layer mixes re-emitted and arriving particles.
  - The lower Aw re-emits fewer particles diffusely and keeps more of the
    arriving momentum, so it slips more. This is measured; it is not a slip
    model.
- **Growth.** δ₁ grows quickly over the first ~100 diameters and then levels
  off at ~16 (Aw = 1) or ~15 (Aw = 0.5).
- **Shape factor.** δ₁/δ₂ is 2.7–2.8 (Aw = 1) and 2.3–2.5 (Aw = 0.5).
- **Not a zero-pressure-gradient layer.** The straight channel is not a
  zero-pressure-gradient flow.
  - The core accelerates 1.07 → 1.39 along the plate and the wall pressure
    falls by 0.164 ± 0.002.
  - This is friction-driven compressible channel flow in a closed loop. The
    fringe recompresses the gas.
  - The leveling of δ₁ is therefore not comparable with a flat-plate layer
    in an unbounded stream.

### 8.2 Fluctuations (not turbulence)

From the seed-summed cell moments (`FLUCTUATION STATISTICS` in
`results/logs/bl_validation_report.txt`):

- **Velocity SDs.** σ_u and σ_v are 0.96–1.02 everywhere, i.e. ≈ √kT.
- **Temperature.** Local kT is 1–3 % above 1 within y < 16 over the diffuse
  plate. The plate is at kT_w = 1, so the heat comes from friction in the
  gas. The core cools slightly (0.94–0.98).
- **Kinetic momentum flux.** ρ⟨u′v′⟩ is −0.010 to −0.016 in the lowest 16
  units. Together with the collisional stress (+0.004 to +0.009), it carries
  streamwise momentum toward the wall that the wall then removes.
- **Stalled layer.** In the stalled layer of A1-r2.5 (x = 410) both stresses
  are ~0 (|ρ⟨u′v′⟩| < 0.0013), consistent with the vanishing wall shear.
- **No turbulence signature.** These are thermal fluctuations with a small
  anisotropy. Nothing here indicates turbulence, and the word is not used.

## 9. Wall momentum-transfer results

- **Plate-mean wall shear (I3 PASS).** τ_w over (120, 480) is
  0.02235 ± 0.00012 (t 187, n = 8) for Aw = 1 and 0.01948 ± 0.00008 (t 254,
  n = 6) for Aw = 0.5.
- **Along the plate.** τ_w is largest at the leading edge (about 0.058 in
  x = 100–120) and falls to ≈ 0.020 by x = 230 (`tauW_vs_x.svg`).
- **Specular plate.** It transfers exactly zero tangential impulse (to the
  last bit), as A-08 requires.
- **Ledger closure.** The measured plate drag closes the momentum ledger
  against the fringe's impulse (§13).
- **Under deceleration.** τ_w over the rear plate falls by more than an
  order of magnitude and changes sign (§10).

## 10. Separation observations

### 10.1 Deceleration and wall-pressure rise (Q4)

Δp_w = p̄_w(420–480) − p̄_w(140–180), from floor normal impulses. The u_wall
and τ_w columns are region means over (280, 480).

| Aw | r | Δp_w (t) | u_wall (t) | τ_w (t) | most negative column u_wall |
|---|---|---|---|---|---|
| 1 | 1 | −0.164 ± 0.002 (favourable) | 0.172 ± 0.002 (70) | 0.0217 ± 0.0002 (144) | +0.146 |
| 1 | 1.5 | +0.002 ± 0.001 (1.6) | 0.045 ± 0.003 (16) | 0.0058 ± 0.0001 (50) | +0.022 |
| 1 | 2 | +0.031 ± 0.001 (25) | 0.007 ± 0.003 (2.5) | 0.0010 ± 0.0002 (5.2) | −0.009 |
| 1 | 2.5 | +0.036 ± 0.001 (26) | −0.002 ± 0.003 (−0.7) | −0.0002 ± 0.0002 (−1.5) | −0.018 |
| 0.5 | 1 | −0.142 ± 0.001 | 0.275 ± 0.003 (92) | 0.0180 ± 0.0002 (118) | +0.242 |
| 0.5 | 2 | +0.034 ± 0.003 | 0.030 ± 0.003 (9.0) | 0.0015 ± 0.0003 (5.2) | +0.006 |
| 0.5 | 2.5 | +0.039 ± 0.002 | 0.009 ± 0.002 (3.6) | 0.0007 ± 0.0001 (5.8) | −0.016 |
| 0 | 1 | +0.003 ± 0.002 | 0.988 ± 0.006 | 0 | +0.978 |
| 0 | 2.5 | +0.085 ± 0.001 | 0.601 ± 0.009 | 0 | +0.561 |

(`threshold.svg`, `uWall_vs_x.svg`, `tauW_vs_x.svg`, `pW_vs_x.svg`,
`psiWall_vs_x.svg`)

- **r = 1.5** cancels the straight channel's favourable gradient but makes
  no significant net rise. II1 is INCONCLUSIVE for A1-r1.5 under the
  registered criterion.
- **r = 2 and 2.5** produce a significant adverse rise, and the near-wall
  flow over the rear plate is far slower than in the attached control: II1
  PASS, Welch z −46 and −43.
- **Monotonic and gradual.** The near-wall response is monotonic in r. It is
  gradual, not abrupt: 0.172 → 0.045 → 0.007 → −0.002.

### 10.2 Local reverse motion (Q5) — indicator A, the registered detector

**No case has a separated region**, i.e. ≥ 2 adjacent 20-unit columns in
(120, 480) with seed-mean u_wall < 0 at one-sided p ≤ 0.005
(`SEPARATED REGIONS`).

**A1-r2.5.** Over x ≈ 300–440 the near-wall velocity is indistinguishable
from zero:

- the column means are −0.018 to +0.002, with SE 0.005–0.009;
- one column, x = 370, crosses the column threshold: −0.0181 ± 0.0051,
  t −3.56 ≤ −3.50;
- its neighbours do not: x = 350 is +0.0016, x = 390 is −0.012 (t −2.0).

II2 is **INCONCLUSIVE**. It is not FAIL, because the columns are not
significantly forward.

**The detection limit.** At n = 8 the column test flags a mean reverse
velocity of about 0.02 or stronger (t_crit 3.50 × median column SE 0.006).
The data exclude a mean near-wall reversal stronger than about −0.010 over
(280, 480): the 95 % CI is [−0.0099, +0.0055]. The reverse_flow maps mark
individually significant cells (`reverse_flow_A1-r2.5.svg`); in A1-r2.5
they lie mostly at x ≈ 360–400, y < 8.

**A1-r2 and the Aw = 0.5 cases** stall in the same way, slightly more
forward.

### 10.3 Indicators B–E

- **B, C, D and the depletion check** (II3, II5, II6, II8), the II9
  persistence checks, II10 and II11 are **not evaluated**, because there is
  no primary region (criteria §8).
- **Indicator E (II7, PASS).** At x = 470 the momentum-flux deficit
  thickness is 14.5 in A1-r2.5 against 5.54 in A1-r1 (Welch z 35). The
  deceleration builds a slow layer 2.6 times thicker.

### 10.4 Post-hoc observations (NOT part of the classification)

These were looked for after the registered analysis had been seen
(`scripts/posthoc-bl-separation.ts`; output in `results/logs/bl_posthoc.txt`).
The bands below were chosen after seeing the data.

**Wall shear changes sign (A1-r2.5).**

- τ_w is negative in every column from x = 310 to 430.
  - Columns 370, 410 and 430 are individually negative at one-sided
    p ≤ 0.025.
  - The adjacent pair 400–440 has τ_w = −0.0019 ± 0.0003 (t −5.9), negative
    in 8 of 8 seeds.
  - The band (300, 440) has τ_w = −0.0013, 95 % CI [−0.0018, −0.0007].
- **What τ_w measures.** The plate re-emits with zero mean tangential
  velocity, so τ_w is the mean tangential momentum carried into the wall by
  the particles that hit it. A negative τ_w means the particles arriving at
  the wall there move upstream on average.
- **Not independent.** It measures the same first-layer motion as u_wall,
  more precisely. It is not an independent physical signal. The thinner band
  y < 2 agrees in sign: −0.0056 ± 0.0024 (t −2.4).
- **Multiple comparisons.** Scanning 18 columns at p ≤ 0.025 gives a
  spurious adjacent pair with probability ≈ 0.01.

**Stream function.**

- The seed-summed ψ in A1-r2.5 is negative above the wall over
  x ≈ 360–420, and the dividing streamline reaches y ≈ 33–38.
- Per seed, averaged over (300, 440):
  - ψ at y = 10 is −0.027 ± 0.010 (t −2.6);
  - ψ at y = 20 is −0.028 ± 0.025 (t −1.1).
- The strong-case variants show the same sign:
  - timestep: ψ(20) t −3.4;
  - length: ψ(10) t −6.8, ψ(20) t −5.2;
  - resolution: ψ(10) t −4.1, ψ(20) t −5.7.
- The height variant does not, but its diffuser is longer and the band was
  not position-mapped for it.
- **What the data are consistent with:** a thick (~30 d), very slow, weakly
  recirculating layer, with mean |u| ~ 0.01 against a thermal speed of 1.
- **What they do not show:** they do not resolve it at the registered
  significance.

**Other post-hoc observations.**

- **Time evolution.** The band's near-wall velocity is negative in 8 of 10
  blocks in A1-r2.5. No block is individually significant, and nothing shows
  a trend (`time_evolution_region.svg`).
- **Seeds.** The region (280, 480) u_wall is negative in 6 of 8 seeds:
  −0.005, −0.008, +0.015, −0.010, −0.012, +0.008, −0.003, −0.003.

**Positive control (rib).** Behind the rib, the near-wall flow is reversed
in every seed at x = 230 and 250.

| x | u_wall | t | seeds negative | negative blocks | τ_w (t) |
|---|---|---|---|---|---|
| 230 | −0.048 ± 0.008 | −5.81 | 4/4 | 0.80 | −0.0048 (−5.1) |
| 250 | −0.027 ± 0.007 | −3.77 | 4/4 | 0.57 | −0.0017 (−1.0) |

- The flow reattaches by x ≈ 270–290.
- The design pilot (design seeds 9201–9204) gave −0.046 ± 0.008 and
  −0.038 ± 0.005 at the same columns. That is the same recirculation; the
  pilot simply crossed t_crit = 5.84 and the validation seeds did not.
- `reverse_flow_A1-rib.svg` and `animation_A1-rib.html` show it.

## 11. Noise / null analysis

- **Attached control (II4 PASS).** No separated region.
  - Its most negative window column has t = +18, i.e. forward.
  - At most 1 of 80 block means in any window column is negative.
- **The stall is noise-dominated.** In the stalled cases the block-mean
  near-wall velocities are negative in 47–57 % of blocks. That is what
  thermal noise around a zero mean gives; it is not persistent reversal.
- **Noise scale.**
  - Single-particle thermal speed: 1.
  - Single-block, single-column near-wall velocity SD: ≈ 0.04–0.06.
  - Seed-mean column SE over 1200 time units: 0.005–0.009.
  - The stalled-layer signal is 1–2 % of the thermal speed. Every statement
    about its sign rests on 8-seed ensembles of 1200-unit means.
- **Detection limits of the registered column test** (t_crit × median column
  SE):

  | seeds | t_crit | cases | detection limit |
  |---|---|---|---|
  | 8 | 3.50 | aw1 cases | ≈ 0.02 |
  | 4 | 5.84 | rib | ≈ 0.047 |
  | 4 | 5.84 | specular, variants | ≈ 0.03–0.08 |

## 12. Convergence tests

| check | what | result | verdict |
|---|---|---|---|
| I4 seed halves | δ₁ odd vs even seeds, every station | \|z\| ≤ 1.4; deficit t ≥ 53 in each half | **PASS** |
| I5 sampling duration | u_wall, 2nd vs 1st half, paired relative change | point changes −3 % … +12 %; CIs [−0.15, 0.11], [−0.18, 0.12], [−0.05, 0.30], [−0.02, 0.25] | INCONCLUSIVE (CIs too wide for ±15 %) |
| I6 bin width | y½ at (40, 4) and Δy = 1; u_wall at (40, 4) | all 8 y½ components and 3 of 4 u_wall components inside ±15 %; u_wall at x = 150 (coarse column 120–160 at the leading edge) rel +0.097, CI [−0.01, 0.21] | INCONCLUSIVE |
| timestep (Courant 0.0125), x = 150 | δ₁, τ_w | δ₁ −0.5 %, CI [−6 %, +5 %]; τ_w −1.7 %, CI [−23 %, +20 %] | INCONCLUSIVE (τ_w CI) |
| length (L 660), x = 150 | δ₁, τ_w | δ₁ +0.7 %, CI [−3 %, +4 %]; τ_w −1.7 %, CI [−23 %, +20 %] | INCONCLUSIVE (τ_w CI) |
| resolution (r = 0.4, 1.56× N) | deficit persists | deficit t 185 (δ₁ −7.5 %, CI [−11 %, −3.5 %]; τ_w +36 %, CI [+14 %, +59 %]) | **PASS** |
| height (H_in 105), A1-r2.5, x = 150 | δ₁, τ_w | δ₁ +7 %, CI [+1 %, +13 %]; τ_w −14 %, CI [−36 %, +9 %] | INCONCLUSIVE (τ_w CI) |
| height, A1-r1, x = 150 | δ₁, τ_w | δ₁ −4.8 %, CI [−9.7 %, +0.1 %]; τ_w −6 %, CI [−18 %, +6 %] | INCONCLUSIVE (τ_w CI) |
| height, A1-r1, x = 210 | δ₁, τ_w | δ₁ +13 %, CI [+9.7 %, +16 %]; τ_w −14 %, CI [−37 %, +8 %] | INCONCLUSIVE |

**Deceleration response (II9 response)**, region (280, 480), absolute
margins ±0.02 (u_wall) and ±0.002 (τ_w):

| variant | Δu_wall (CI) | Δτ_w (CI) | verdict |
|---|---|---|---|
| timestep | +0.0016 [−0.012, +0.016] | +0.0006 [−0.0003, +0.0014] | **PASS** |
| length | −0.0079 [−0.023, +0.007] | −0.0009 [−0.0019, +0.0001] | INCONCLUSIVE (u_wall CI reaches −0.023) |
| resolution | still responds, z −57 | | **PASS** |
| height | still responds, z −38 | | **PASS** |

**Reading.**

- **δ₁.** In every point estimate the thickness δ₁ is within ±13 % of the
  reference under timestep, length, height and bin width.
- **τ_w.** The undecided verdicts come from the single-column wall shear at
  n = 4: its CI half-width is ≈ ±20 %. They also come from the half-sample
  velocity comparisons.
- **Resolution.** The resolution variant changes the medium. At fixed φ,
  smaller disks lower the mean free path and the viscosity in model units,
  and raise the wall collision rate. A 36 % higher τ_w is therefore a
  regime change, not a convergence failure. Its structure persists, which
  is what was judged.
- **The stall is robust.** Under every variant the strong-deceleration stall
  reproduces: u_wall within ±0.01 of zero.

Plots: `convergence_*.svg`, `seeds_uwall_*.svg`.

## 13. Energy accounting

**Ledger closure.** For every run, the energy ledger closes to |relative
residual| ≤ 3.2 × 10⁻¹³ and the momentum ledger to ≤ 7.5 × 10⁻¹⁴
(S-energy, S-momentum).

**Fluxes**, per unit time over the measurement:

| case | fringe work in | plate heat out | fringe x-impulse | plate drag | ceiling/body drag |
|---|---|---|---|---|---|
| A1-r1 | 2.121 | 2.162 | 9.64 | 9.72 | 0 |
| A1-r1.5 | 1.975 | 1.940 | 7.48 | 5.80 | 1.64 |
| A1-r2 | 2.003 | 1.921 | 8.31 | 4.40 | 3.80 |
| A1-r2.5 | 1.980 | 1.915 | 8.81 | 3.87 | 5.02 |
| A05-r1 | 2.013 | 2.145 | 8.21 | 8.32 | 0 |
| A05-r2.5 | 1.990 | 1.784 | 8.07 | 3.51 | 4.48 |
| A0-r1 | −0.162 | 0 | −0.11 | 0 | 0 |
| A0-r2.5 | 0.227 | 0 | 2.16 | 0 | 2.13 |
| A1-rib | 2.270 | 1.847 | 15.95 | 6.10 | 9.86 (rib) |

**Energy.**

- The fringe is the only energy source and the diffuse plate the only sink.
- Their difference is the rate of change of the stored kinetic energy. The
  ledger closes exactly, so that difference is real storage.
- **The loop is not perfectly thermally stationary.** Over the 1200-unit
  measurement the kinetic energy drifts by −0.3 % to +0.5 % in the aw1
  cases. It drifts by up to ±1.3 % in most others, −1.8 % in the tall-domain
  variant and +3.2 % in the rib case.
  - This is a slow thermal relaxation of the closed loop under frozen
    forcing. Mean kT is reported per case in §3.
  - No registered check covers it. It is listed as a limitation (§19).
- Internal energy, deformation energy and ceiling work are identically 0.

**Momentum.** The fringe's streamwise impulse is taken up by the plate (wall
shear) and by the ceiling bodies, i.e. the pressure on the diffuser faces.

**Specular plate.** It exchanges no energy and no tangential momentum.

**Safety (S-safety, S-empty-space).** No run halted. No empty-space flag was
raised (cell φ ranged 0.076–0.325). The particle count is constant.

## 14. Wall-accommodation sensitivity

The near-wall result depends on Aw, as a wall-made effect must:

- **Aw = 0 (specular).**
  - No near-wall deficit (I2).
  - Under the strongest deceleration the gas at the wall slows with the core
    (0.60) and never stalls.
  - The momentum deficit cannot form without wall momentum transfer.
- **Aw = 0.5.**
  - A slightly thinner layer, with more slip (u_wall 0.25–0.31 against
    0.15–0.18).
  - Under deceleration it is **more forward** than Aw = 1:
    - r = 2: 0.030 against 0.007 (z 5.5);
    - r = 2.5: 0.009 against −0.002 (z 2.7).
  - At r = 2.5 its rear-plate wall shear is still positive (+0.0007, t 5.8).
- **Q8 (reported, not judged).** No separated region exists for either
  accommodation in the tested range, so no threshold can be located. The
  approach to stall shifts toward stronger deceleration as Aw falls.
  - The direction is consistent across r = 2 and 2.5.
  - With two accommodations, this is a description, not a tested law.
- **The wall model dominates the near-wall slip.** That is a finding about
  this particle wall, and it is listed among the limitations.

## 15. Domain sensitivity

**Taller domain (H_in 105; ramp and constant section ×1.5).**

- The attached-layer thickness changes by −5 % (x = 150) and +13 %
  (x = 210).
- The strong-case response persists: z −38 against the attached control.
- Its stall is equally close to zero: −0.004 in the mapped window, a
  difference from the reference of −0.002, CI [−0.018, +0.014].
- **The structure is not created by the domain height.** The +13 % change in
  the attached δ₁ at x = 210 is undecided at ±15 % and is the largest domain
  effect seen.

**Longer domain (plate and constant section +100).**

- The attached-region δ₁ is unchanged (+0.7 %).
- The strong case is, if anything, slightly **more** reversed: u_wall −0.010
  CI [−0.021, +0.001], τ_w −0.0012 CI [−0.0020, −0.0003].
- Its difference from the reference is undecided at the ±0.02 margin.

**Finite-domain reflection** (the closed loop's downstream contraction and
fringe) is therefore not what creates the stall. A longer constant section
does not remove it.

## 16. Numerical sensitivity

- **Timestep.**
  - Halving the timestep (Courant 0.0125) leaves δ₁ within −0.5 % and the
    deceleration response equivalent: Δu_wall +0.002, Δτ_w +0.0006, both
    inside their margins.
  - Late contacts (A-06), i.e. a particle's second collision within one
    step, approximated in grid order, are fully explained by within-step
    event ordering in all 78 runs (`lateContactsUnexplained` = 0).
  - Their fraction is 2.2–2.7 × 10⁻³ of collisions at Courant 0.025. That is
    above the < 10⁻³ guideline stated in A-06. It halves with the timestep
    (1.2 × 10⁻³ at Courant 0.0125).
  - The timestep variant is the quantitative check A-06 calls for: halving
    the fraction leaves δ₁ and the deceleration response unchanged within
    their margins.
  - Earlier records do not store this fraction, so whether earlier
    φ = 0.2 runs were similar is not known.
- **Bin width.** y½ changes by −3 % to +8 % between (20, 2) and (40, 4) cells
  and by −2 to −3 % at Δy = 1.
- **Particle resolution.** See §12. The structure persists; the change in
  wall shear is a change of regime.
- **Ledgers.** They close to round-off in all 78 runs.

## 17. Falsification attempts

| alternative explanation | test | outcome |
|---|---|---|
| The boundary layer is an artefact of coarse particles | resolution variant (1.56× N) | layer persists, t 185; δ₁ −7.5 % |
| The structure is created by the inflow, not the wall | specular plate; upstream control at x = 70 | no deficit over a specular plate; inflow deficit 0.00–0.05, within 0.05 + 3 SE in every case (I-upstream PASS) |
| The structure depends on the domain height | H_in 105 variants | layer and response persist; δ₁ within −5 … +13 % |
| The structure depends on timestep | Courant 0.0125 | δ₁ −0.5 %, response equivalent |
| Reverse flow is thermal noise | 8-seed column test, block fractions, attached null | the attached control never reverses. The strong-case stall is **not** distinguishable from zero by the registered detector — this alternative **survives** for the velocity indicator. The post-hoc wall-shear sign argues against pure noise but is not registered evidence |
| The separation disappears with longer sampling | block series | no region to disappear. The stall is stationary over 10 blocks |
| The stall is caused by finite-domain reflection | longer domain | stall persists, slightly more negative |
| The apparent stall is a density depletion | near-wall density | 0.91 × core density over x = 310–430 in A1-r2.5 (the specular plate gives 0.82 in the first two rows, a hard-disk wall packing effect). Not a depletion |
| The effect is the wall model, not the gas | Aw = 0 / 0.5 / 1 | the effect scales with Aw. The wall model sets the slip and the layer strength; the gas carries the deficit away from the wall (§8.2) |
| The detector cannot see recirculation | rib positive control | recirculation behind the rib exists in every seed but did not pass the 4-seed column test. The detector's sensitivity is shown to be marginal, not adequate |
| The response does not survive independent seeds | odd/even seeds (I4); variant seed sets 7301–7304 | the near-wall structure and the stall reproduce in every independent seed set |

**Surviving alternatives.**

1. "The near-wall flow under strong deceleration stalls and does not
   reverse" is not excluded.
2. "A weak reversal exists but is below the registered detector's
   sensitivity" is equally not excluded.

The data cannot decide between them.

## 18. Criteria defects found (reported, not repaired)

The original judgements above stand. A repair needs a separately
pre-registered experiment.

1. **The positive control is underpowered.** With n = 4 the column test
   requires t ≤ −5.84. The design pilot passed with t −6.1 and −7.1; the
   validation seeds reached −5.81. The control needed ≥ 8 seeds, or a
   region-level test.
2. **Single-column wall-shear equivalence at n = 4 cannot reach ±15 %.** The
   CI half-width is ≈ 20 %. Four of the five Part I variant checks are
   undecided for this reason alone; the fifth, A1-r1-H at x = 210, is also
   undecided on δ₁. A region-mean τ_w, or 8+ seeds, was needed.
3. **The sampling-duration check (I5)** compares half-measurement u_wall at
   single columns. Its CIs, about ±0.13, exceed the ±0.15 margin wherever
   the point change is ≳ 5 %. Region-level or longer measurements were
   needed.
4. **The bin-width check (I6)** compares u_wall at the leading-edge station
   (x = 150) with a 40-wide coarse column centred at 140. That column
   straddles the steepest part of the developing layer. The comparison is
   partly a different location, not only a different bin.

All four are design (precision) defects. None reflects a disagreement
between measurements.

## 19. Limitations

- **Regime.**
  - Re_plate = ρ U_e L_plate/μ ≈ 357, using μ = 0.351 from the φ = 0.2
    Couette sweep, an INCONCLUSIVE record; Enskog gives 0.379. EXTERNAL
    COMPARISON.
  - Kn = λ/δ₁ ≈ 0.06–0.09, with λ ≈ 1.
  - The layers are 10–16 mean free paths thick. This is a strongly diffusive
    slip regime, far from the continuum boundary layers of aerodynamics.
- **Mach number.** Mp = U_e/c ≈ 0.49, with c = 2.170 (Item 2's registered
  c₀; 0.47 with the post-hoc 2.26). EXTERNAL COMPARISON. The flow is
  compressible; the decelerated cases heat by up to 14 %.
- **Blasius.** δ* = 1.72 √(νx/U) gives 12.9–28.2 at the stations, against
  measured δ₁ of 10.8–16.4. EXTERNAL COMPARISON. Blasius assumes a
  continuum, zero pressure gradient and no slip, none of which holds here,
  so the disagreement is expected and is not a test.
- **Geometry.** Two-dimensional hard disks (A-02).
- **Channel physics.** The closed loop has a friction-driven favourable
  gradient in the straight channel. The adverse rise saturates near the
  inflow dynamic pressure (pilots, criteria §11). The strongest deceleration
  available in this rig is therefore modest: Δp_w ≈ +0.036 over the rear
  plate.
- **Inflow.** The fringe (A-20) is an engineered inlet condition. It is
  documented, ledgered and outside the test section.
- **Thermal stationarity.** The closed loop is not perfectly thermally
  stationary during the measurement: kinetic energy drifts by up to 3 %
  (§13).
- **Timestep.** The late-contact fraction exceeds A-06's 10⁻³ guideline by a
  factor 2.2–2.7 at the registered timestep. Its measured effect on the
  judged quantities is nil within the margins (§16).
- **Statistics.** Statistical power is the binding limit for every undecided
  check (§18).

## 20. PASS / INCONCLUSIVE / FAIL classification

| part | PASS | INCONCLUSIVE | FAIL |
|---|---|---|---|
| safety | S-safety, S-energy, S-momentum, S-empty-space | — | — |
| Part I | I1 (A1-r1), I1 (A05-r1), I2, I-upstream, I3, I4, I-variant res | I5, I6, I-variant dt, len, H (A1-r2.5), H (A1-r1, x 150), H (A1-r1, x 210) | — |
| Part II | II1 (r 2), II1 (r 2.5), II4, II7, II9 response dt, res, H | II1 (r 1.5), II2, PC, II9 response len | — |
| not evaluated | II3, II5, II6, II8, II9 persistence, II9 bin width, II10, II11 (no primary region) | | |
| reported | Q8 | | |

- **Part I: INCONCLUSIVE.**
- **Part II: INCONCLUSIVE.** If the strongest case stalls without a
  significant reversal, the criteria §9 classify Part II as INCONCLUSIVE
  ("signal at the noise floor").
- **Item 3: INCONCLUSIVE.**

**In the words of the classification rules:** the near-wall effect appears
and is statistically overwhelming. Its convergence is incomplete at the
registered precision. The separation signal is at the noise floor of the
registered detector. Multiple interpretations of the stalled layer remain
viable.

## 21. What the result means for PFAD

PFAD's particle wall and particle gas, with no flow equation anywhere,
produce:

- a reproducible near-wall momentum-deficit layer whose existence is caused
  by wall momentum transfer;
- directly measurable wall shear and wall pressure from impulses;
- a strong, monotonic, numerically robust response of the near-wall layer to
  a measured adverse pressure rise: the layer slows to a stall and
  thickens.

These are the ingredients that separation requires. At this Reynolds and
Knudsen number, and with this deceleration, the medium does not produce a
recirculation zone strong enough to resolve. Whether it produces a weak one
remains open.

**Next experiment (to be pre-registered separately; not started).**

- **Detector.** The floor's tangential impulse as the primary separation
  indicator, judged as a region mean over a pre-declared window, with
  u_wall and ψ as corroborating indicators.
- **Seeds.** ≥ 16 for the strong case and ≥ 8 for the rib control and the
  variants.
- **Measurement.** A longer measurement, 2400+ time units.
- **Regime.** Either a larger universe, which lowers Kn and raises Re (e.g.
  H_in 140, which needs the checkpointed harness), or a stronger
  deceleration (a two-stage diffuser).
- **Pre-declared checks.** Convergence judged on region means.

The criteria defects of §18 are the design inputs.

## 22. What it does NOT establish

- **Not classical theory.** It does not show that PFAD reproduces classical
  boundary-layer theory: no Blasius profile, no momentum-integral closure,
  no similarity solution.
- **No separation, threshold or law.** Separation is not observed. No
  separation threshold is located, and no separation law is supported or
  refuted.
- **Not fully converged.** The layer thickness is not shown to converge to
  ±15 % in every numerical parameter.
- **No scaling.** Nothing here extends to three dimensions, to higher
  Reynolds numbers, or to curved walls.
- **The post-hoc wall-shear reversal is not evidence of separation.** It is
  a lead for the next pre-registered experiment.
- **Airfoil work stays locked.** Nothing here unlocks airfoil optimisation,
  inverse design or Kutta work. Item 3 is INCONCLUSIVE, and the curved-wall
  follow-up waits for a flat-wall PASS.

## 23. Reproducibility and files

**Commits.**

- Pre-registration: `bb7f92e`.
- Execution harness: `ec00c06`; the runs came from a worktree at this
  commit.
- Analysis crash fix, SVG escaping and post-hoc script: `1118cf5`.
- This report, the records and two more plot line colours: the commit that
  adds this file.

**Seeds and records.** Seeds 7001–7008, 7101–7106, 7201–7204, 7301–7304 and
7401–7404. Raw records, with every run's raw grid sums, floor tallies, block
grids and frames: `results/bl-separation_{aw1,aw0,variants,aw05}.json`.

**Logs** (all under `results/logs/`):

- `bl_validation_run.sh`;
- `bl_validation_timings.txt`;
- `bl_validation_timings_launch1_lost.txt` (the lost first launch);
- `bl_validation_{aw1,aw0,variants,aw05}.out`;
- `bl_validation_report.txt` (the registered report);
- `bl_posthoc.txt`.

**Determinism.** Validation run A1-r1, seed 7001, was rerun from the
committed repository after the validation (`1118cf5`). Its raw sums, floor
tallies, block grids and conservation record are bit-identical to the
record.

**Plots** (`results/plots/bl_separation/`, 74 files):

- particle snapshots, `snapshot_*.svg`;
- velocity heatmaps, `velocity_*.svg`;
- mean profiles, `profile_x*.svg`;
- momentum-deficit profiles, `momentum_deficit_x*.svg`;
- wall impulse and pressure, `tauW_vs_x.svg`, `pW_vs_x.svg`;
- occupancy, `occupancy_*.svg`;
- reverse-flow and stream-function maps, `reverse_flow_*.svg` (with
  significant cells and the dividing streamline);
- indicators vs x: `uWall_vs_x.svg`, `psiWall_vs_x.svg`, `delta1_vs_x.svg`,
  `Ue_vs_x.svg`;
- time evolution, `time_evolution_region.svg`;
- seed variation, `seeds_uwall_*.svg`;
- convergence, `convergence_*.svg`;
- threshold, `threshold.svg`;
- particle animations through the wall region, `animation_*.html`.

**Regenerate:**

```
npx tsx scripts/report-bl-separation.ts results/plots/bl_separation results/bl-separation_*.json
npx tsx scripts/posthoc-bl-separation.ts results/bl-separation_*.json
```
