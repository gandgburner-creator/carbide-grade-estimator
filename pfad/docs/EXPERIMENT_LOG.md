# PFAD Phase 0 — experiment log

What was measured, against what, with which status, and what it means. Every
number here comes from a record in `results/` (print one with
`npm run exp -- show results/<file>.json`; regenerate it with
`npm run exp -- replay results/<file>.json`). Records carry their model
version. Later model versions only added components that are off unless an
experiment declares them, so earlier records replay bit-for-bit under the
current 0.2.0-p0.4 (checked by replaying a 0.2.0-p0.1 static-box reference
record under p0.3 and p0.4).

Conventions: model units (particle mass m = 1, diameter d = 1, k_B = 1,
reference kT = 1; 2D pressure is force per unit length). φ is the area
fraction (A-02: PFAD Phase 0 is two-dimensional). Uncertainties are one
standard error unless marked "95 %". Benchmarks are classical reference values
shown for comparison only; none enters a run or a verdict except where a check
says so explicitly.

Statuses: `PASSED` means every pre-stated acceptance check passed; it does not
mean "validated". `INCONCLUSIVE` means a check could not be decided at the
achieved precision or its premise was not met. `NOT CONVERGED` means a result
changed with resolution beyond its tolerance.

## Phase 0 acceptance (Master prompt §42)

| # | the laboratory can … | record(s) | status | in one line |
|---|---|---|---|---|
| 1 | produce stable particle gas | static box, thermal | **PASSED** | stationary, isotropic, Maxwellian from any start (§1, §3) |
| 2 | measure pressure from impacts | static box | **PASSED** | 1.116 nkT at φ = 0.05 = hard-disk EOS; v0.1's 0.997 not reproduced (§1) |
| 3 | quantify energy conservation | every record | **PASSED** | ledgers close to ~10⁻¹³ (§2) |
| 4 | measure thermal behaviour | thermal validation (seeds 31–40); reference (21–30) | **PASSED** (validation) | fresh seeds pass E1–E5 and the pre-registered E6′ (0/24 violations). The original reference stays INCONCLUSIVE on the retired E6 (§3) |
| 5 | measure disturbance propagation | sound-speed validation (seeds 6001–6064); pulse reference, sweeps | **PASSED** (validation) | pre-registered amplitude series → c₀ = 2.170 ± 0.038 (± 3.5 %), invariant to timestep, probes, domain, radius; post-hoc caveats: extrapolation-model systematic ≈ 4 %, equilibrium noise carries a moveout signature (§5) |
| 6 | measure effective viscosity | Couette reference, sweeps | **PASSED** (reference) | μ_eff = 0.3326, 95 % CI ± 4.85 % over 30 seeds (Enskog 0.316), stable, timestep-independent; sweeps not rerun (§6) |
| 7 | demonstrate wall momentum transfer | wall accommodation | **PASSED** | α_E and α_t equal Aw (§4) |
| 8 | show a boundary layer | boundary layer | INCONCLUSIVE | layer emerged; upstream control not clean, momentum integral not closed (§7) |
| 9 | investigate adverse-gradient separation | separation | INCONCLUSIVE | investigated; no separation up to 87 % deceleration at Re ~ 10² (§8) |
| 10 | test Kutta emergence | Kutta | **PASSED** | smooth departure with lift emerged unimposed; sharpness not decisive at Re 22 (§9) |
| 11 | report Re/Mach | every flow record | **PASSED** | Re from measured μ, Mp from measured c_p (§12) |
| 12 | perform resolution tests | convergence studies, scaling | static box PASSED; flow **NOT CONVERGED** | timestep/count/averaging/grid converge; the fixed-Re scaling family does not (§1, §10) |
| 13 | reproduce experiments from saved configurations | replay | **PASSED** | records replay bit-for-bit, also across model versions p0.1 → p0.4 |
| 14 | export experiment data | every record | **PASSED** | JSON records; lab EXPORT / IMPORT |
| 15 | distinguish measured results from assumptions | every record | **PASSED** | results, benchmarks and assumption IDs kept apart (`MODEL_ASSUMPTIONS.md`) |

**Airfoil optimisation stays locked.** Criteria 8 and 9 are
INCONCLUSIVE and the flow scaling study is NOT CONVERGED. That is the honest
state of Phase 0, not a failure to hide. §14 lists what would change it.

## 1. Static box — pressure from impacts (Steps 5–7)

2000 disks, φ = 0.05, closed box with specular walls, elastic, 100 collisions
per particle of measurement; the Bible's Experiment 1 configuration.
Record: `static-box_ensemble_10seeds.json` (status **PASSED**), single-seed
`static-box_reference_seed7.json` (INCONCLUSIVE only because one seed gives a
2.35 % half-width against the 2 % criterion).

| quantity | measured (10 seeds) | benchmark |
|---|---|---|
| P·A/(N·kT) | **1.1161**, 95 % CI [1.1135, 1.1186] | ideal gas 1; Henderson hard-disk EOS 1.1084 |
| ratio to Henderson | 1.0070, 95 % CI [1.0046, 1.0093] | — |
| infinite-system extrapolation (particle-count study) | Z∞ = 1.1087 ± 0.0023 | Henderson 1.1084 |
| collision frequency / Enskog | 1.0067 | — |
| e = 0.99: collisions/particle to halve P | 68.9 ± 1.2 | Haff 69.7 |
| e = 0.9: collisions/particle to halve P | 7.68 ± 0.29 | Haff 7.30 |

Energy and momentum ledgers close to 6 × 10⁻¹⁴ and 3 × 10⁻¹⁶ (relative);
walls agree with each other (isotropy p ≥ 0.80), pressure is stationary
(|z| ≤ 0.9), seeds are mutually consistent (χ² p = 0.998), and no
empty-space flag was raised.

**Comparison with the v0.1 result in the Bible (§8).** The Bible reports
P ≈ 0.997 ± 0.013 of nkT for this configuration. PFAD v0.2 measures 1.116 —
12 % higher, far outside both uncertainties — and the excess is exactly what
excluded area requires: the measured value matches the hard-disk equation of
state (within 0.7 % at N = 2000, and within 0.03 % after extrapolating the
wall-boundary finite-size effect away). A gas of disks with diameter 1 at
φ = 0.05 cannot show P = nkT unless the collisional (virial) momentum transfer
is missing, the density or temperature is defined differently, or the wall
area is taken net of an exclusion margin; using the area accessible to disk
centres gives 1.104, still far from 0.997. The v0.1 code is not available here,
so the cause is not established; the v0.2 measurement is internally consistent
(four convergence studies below) and agrees with the independent benchmark.
The v0.1 inelastic figures are partly reproduced: e = 0.99 gives 68.9 ± 1.2
(v0.1 ≈ 73; Haff 69.7) and e = 0.9 gives 7.68 ± 0.29 (v0.1 ≈ 10; Haff 7.30).

**Convergence studies** (`convergence_static-box_*.json`, 5 seeds per level,
tolerance 1 %): timestep (Courant 0.1/0.05/0.025), particle count
(500/1000/2000 at fixed φ), averaging (25/50/100 collisions per particle) and
contact-grid cell size — all **PASSED**. The particle-count study shows the
expected wall finite-size trend (1.1223 → 1.1178 → 1.1154), extrapolated
linearly in N^(−1/2) to 1.1087 ± 0.0023.

## 2. Energy conservation (Step 7)

Every elastic, rigid-contact run closes its energy ledger to ≤ 2 × 10⁻¹³ and
its momentum ledger to ≤ 3 × 10⁻¹³ (relative), including runs with open
boundaries and solid bodies. With the (optional) occupancy force the error is set by velocity-Verlet
and converges at second order (4.4 × 10⁻⁵ in the pulse reference, below the
stated 10⁻³); model p0.2 fixed an O(dt) error in combining forces with impulsive
collisions (see `MODEL_CHANGELOG.md`). Energy lost in inelastic collisions
goes to one explicit ledger destination (external or internal reservoir).

## 3. Thermal behaviour (Step 8)

Record `thermal_reference.json` (10 seeds, 21–30; 200 collisions/particle,
80 for relaxation runs), status **INCONCLUSIVE**. It is judged under the
criteria fixed before the run (`CRITERIA_THERMAL_VISCOSITY.md`). The full
report, with per-seed tables, plots and the error budget, is
`REPORT_THERMAL_VISCOSITY.md`.

- **Precision (E4) now met.** Seed-ensemble 95 % half-width of Z is
  0.07–0.18 % in the 200-collision configurations and ≤ 0.67 % in the
  40-collision relaxation halves (criterion < 0.71 %). The earlier failure
  came from pooled per-run SEs that overstate the closed-box uncertainty
  4–6× (`MODEL_CHANGELOG.md`, revision 8).
- **Equation of state.** Z(φ) = 1.0448, 1.1150, 1.2484, 1.5921 at φ = 0.02,
  0.05, 0.1, 0.2 (95 % half-widths 0.07–0.18 %). Henderson gives 1.0413,
  1.1084, 1.2361, 1.5703. The measured values are +0.3 … +1.4 % higher, a
  wall finite-size effect: at φ = 0.05 it equals the static box's N → ∞
  shift. This is reported, not corrected. Fitted B = 2.12 ± 0.01 (exact 2),
  biased by the same effect.
- **No hidden energy scale.** Same-class temperatures give bit-identical Z
  (30 pairs). Across classes Z agrees (ANOVA p = 0.92) and P = a + b·kT
  with intercept a = (0.2 ± 4.3) × 10⁻⁵, i.e. zero.
- **Equilibrium, stationarity, uniformity.** All 40 seed-paired late/early
  stationarity tests pass (smallest p = 0.016 against 1.25 × 10⁻³).
  kT_x/kT_y = 1 within 0.3 %. Kurtosis is 2.99–3.00 and a₂ ≈ 0. There is no
  empty-space flag in 130 runs.
- **Independent of the initial velocity distribution** (Maxwell,
  uniform-speed, uniform-box, two-beam): ANOVA p = 0.90 for Z and 0.94 for
  late a₂. KS of the final speeds against the 2D Maxwellian gives p ≥ 0.30.
  Every start relaxes within ~10 collisions/particle (1/e times 1.2–3.5).
- **Why INCONCLUSIVE.** The pre-registered relaxation rule E6 ("last > 4σ
  window in the first half of every run") is not met. The uniform-box start,
  seed 25, has one a₂ window at z = 4.68 at c = 56.8. The Maxwell-start runs
  begin in equilibrium and show the same statistic firing (z up to 5.18). The
  measured false-alarm rate makes a flag ≈ 95 % likely at 10 seeds × 80
  collisions with no relaxation defect at all. So the rule is ill-posed. As
  pre-registered, that is reported, not repaired. A well-posed replacement
  (E6′) is proposed for a fresh seed set.

**Validation, `thermal_validation_s31-40.json`: PASSED.** E6′ replaced E6
(`CRITERIA_THERMAL_VISCOSITY.md` §6). It was committed in `2bf9968`, before
any run with the fresh seeds 31–40. The validation used the same
configuration and the same E1–E5. Full report: `REPORT_THERMAL_VISCOSITY.md`
§7.

- Every check passes:
  - E2: 0 of 40 tests below 1.25 × 10⁻³.
  - E3: p = 0.62 (temperature), 0.41 / 0.90 (distribution: Z / a₂).
  - E4: worst half-width 0.63 % < 0.71 %.
  - E1, E5: pass.
  - E6′: 0 of 24 tests below 0.05/24 (smallest p 0.086, max |t| 1.83;
    31 392 windows).
- Z(φ) = 1.0455, 1.1140, 1.2468, 1.5937 at φ = 0.02, 0.05, 0.1, 0.2. It
  agrees with the reference run within |z| < 2 in all eight configurations.
- The retired E6 statistic flags nothing in this dataset (0 of 31 608
  windows), against one flag in the reference run with relaxation equally
  complete in both.
- Phase 0 criterion 4 is therefore PASSED on the validation dataset. The
  reference record's INCONCLUSIVE stands under the rules it was judged by.
  E6′ was formulated after looking at seeds 21–30, so those seeds play no
  part in the E6′ decision.

## 4. Wall momentum and energy transfer (Step 9)

Record `wall-accommodation_reference.json`, status **PASSED**. In a steady
two-temperature channel the measured energy accommodation α_E and, in a
sheared channel, the tangential accommodation α_t equal the microscopic
parameter Aw for Aw = 0.25, 0.5, 0.75, 1 (every estimate within 2·t·SE).
Specular walls exchange no energy (1.4 × 10⁻¹⁴) and transmit no shear (exactly
0). Heat, shear-momentum and shear-energy balances close within 1.7 SE. Wall
shear grows with Aw (τ = 0.0027 → 0.0059 at U = 1) with slip falling from 0.32
to 0.12 — the macroscopic effect of Aw, reported as such, not as a viscosity.

## 5. Disturbance propagation (Step 10)

### 5.1 Item 2 validation: small-amplitude sound speed — **PASSED**

Record `sound-speed_validation.json`. Fresh seeds 6001–6064, criteria
pre-registered at `04e0826` (`CRITERIA_SOUND_SPEED.md`), full report in
`REPORT_SOUND_SPEED.md`. Universe A, φ = 0.2, kT = 1, periodic 600 × 120. A
central slab of width 20 gets a density excess A by random sequential
addition and is released. Arrival delays come from a leave-own-probe-out
stacked-template cross-correlation of the folded outward momentum density at
17 probes (d = 30–190). No expected speed enters the run, the tracker or the
criteria.

| A | 0.4 | 0.3 | 0.2 | 0.1 | 0.05 |
|---|---|---|---|---|---|
| c ± SE (64 seeds) | 2.394 ± 0.016 | 2.328 ± 0.022 | 2.255 ± 0.028 | 2.264 ± 0.049 | 2.320 ± 0.123 |

- **Zero-amplitude speed** (linear in A, pre-registered):
  c₀ = **2.170 ± 0.038**, 95 % CI [2.094, 2.246] (± 3.5 %). Split halves
  agree (z = −0.12); the speed is invariant to probe width, sampling, window,
  timestep, domain length, strip height and particle radius (all within
  ±0.8 %, CIs inside ±5 %). No wrapped or inward wave is in the window.
- **Control (A = 0)** passes S1: no seed-reproducible signal (outward stack
  SNR 1.80, inward 3.57, max probe 3.43, all < 5). Post hoc, per-seed
  equilibrium noise carries a moveout in both directions at
  2.275 ± 0.016 / 2.244 ± 0.015 (z ≈ 20): thermal fluctuations are
  random-phase sound. S1, which tests the seed average, does not see them.
  Its rationale ("a signal without a disturbance is an artefact") is
  therefore too broad; its committed statistic and its PASS stand.
- **Extrapolation-model systematic** (post hoc): c(A) is flat for
  A ≤ 0.2 (≈ 2.26) and rises above it, so the linear fit undershoots.
  The quadratic and small-amplitude-only alternatives give 2.20–2.29. This is
  a systematic of +0.05 to +0.12 that is not in the registered CI.
- **Benchmark (comparison only):** hard-disk adiabatic 2.199 lies inside the
  CI; isothermal 1.540 and ideal-gas 1.414 lie far outside.

### 5.2 Earlier pulse records

Records `sound-speed_reference.json` (16 seeds, φ = 0.2, status
**INCONCLUSIVE**) and `sound-speed_sweeps.json` (8 seeds per case,
**INCONCLUSIVE**). A central slab gets a density excess and is released; the
speed is the slope of the tracked outward momentum-density pulse (template
cross-correlation, no expected speed anywhere in the tracker). A synthetic
test with the same geometry (released top-hat, diffusion, noise) shows the
tracker unbiased to < 1 % for slab widths 10–40
(`tests/measurements.pulse.test.ts`).

| model (reference, φ = 0.2, amplitude 0.5, width 20) | c_p | Δ vs A |
|---|---|---|
| A: collisions only | **2.369 ± 0.037** | — |
| B: collisions + occupancy force (hypothesis) | 3.322 ± 0.018 | +0.95 ± 0.04 (z 23) |
| C: e = 0.9 parcels + internal reservoir (Universe B) | 2.377 ± 0.056 | +0.01 ± 0.07 (z 0.1) |
| D: e = 0.9 parcels + occupancy, no reservoir | 2.474 ± 0.010 (gas cools 1 → 0.12) | +0.10 ± 0.04 |
| E: parcels + reservoir + occupancy | 2.67 ± 2.2 — not resolved | — |

Benchmark: hard-disk adiabatic sound speed at φ = 0.2 is 2.199; ideal gas
√(2kT/m) = 1.414.

What the sweeps show:
- **Disturbances propagate at a finite, density-dependent speed**, and the
  collisional excluded-area stiffness is visible: c_p = 1.83 ± 0.18 (φ = 0.05,
  poor track), 1.81 ± 0.10 (0.1), 2.40 ± 0.09 (0.2), 3.15 ± 0.11 (0.3), always
  above the ideal-gas 1.41.
- **The tracked speed depends on the pulse**: slab width 10 / 20 / 40 gives
  2.18 ± 0.14 / 2.37–2.40 / 2.51 ± 0.04, amplitude 0.25 gives 2.35 ± 0.05 and
  amplitude 1.0 cannot be tracked (r² = 0.56). Since the tracker is unbiased on
  linear pulses, this is finite-amplitude (nonlinear) propagation: stronger and
  longer-lived compressions travel faster. The small-amplitude limit — the
  quantity comparable with the adiabatic sound speed 2.199 — is therefore
  **not established**; the widths-10 value 2.18 ± 0.14 is consistent with it,
  the reference configuration is 8 % above it.
- **Particle-scale converged**: radius 0.5 / 0.35 / 0.25 at equal φ gives
  2.40 / 2.40 / 2.43 (± 0.09 / 0.03 / 0.01).
- **Soft contact tends to the rigid result** as stiffness grows:
  K = 100 / 1000 / 10000 give 2.07 / 2.28 / 2.33.
- **Occupancy-force calibration** (collisions off, the force alone):
  c_p² = (1.393 ± 0.006)·k_s φ/m + (0.13 ± 0.06): c_p² is about 1.39 times the
  simple mean-field value k_s φ/m, with the same factor over k_s = 5–80; the
  intercept is consistent with the kinetic part at kT = 0.05. This calibrates the
  hypothesis; it does not validate it.
- Case E's interval is ±160 %. A diagnostic rerun with the same seeds
  (`sound-speed_caseE_diagnostic.json`, identical trajectories) stored the
  leave-one-seed-out speeds: 11 of 16 subsets give 3.29–3.31, close to model B
  (3.32); the other five give 1.05–3.06. The tracker locks onto different
  features depending on which seeds are averaged, so the full-ensemble 2.67 is
  a mixture, not a noisy estimate. Case E remains INCONCLUSIVE; a tracker that
  reports competing features instead of choosing one would be needed.

## 6. Effective viscosity (Step 11)

μ_eff = measured wall shear / measured core velocity gradient; no viscosity
enters the solver.

**Reference: `viscosity_reference.json`, status PASSED** (30 seeds, 71–100,
600 collisions/particle, judged under the pre-registered criteria V1–V8; full
report in `REPORT_THERMAL_VISCOSITY.md`). μ_eff = **0.3326**, 95 % CI
[0.3165, 0.3487] (± 4.85 %), between-seed CV 13 %. The results:

- Every run's core profile is linear (χ² p ≥ 0.37).
- The halves agree (paired p = 0.67), and so do core fractions 0.4 and 0.6
  (p = 0.27).
- Courant 0.05 with 30 independent seeds (`viscosity_courant-0.05.json`)
  gives 0.3220 ± 0.0070 (z = −1.01).
- Wall stresses balance (z = −0.06) and input work balances wall heat
  (z = 0.30).
- The value is 5 % above the Enskog benchmark 0.316 (comparison only).

The earlier 5-seed value was 0.325 ± 0.027. Flow records made before this
rerun keep that μ in their configuration; `run-flow-references.ts` reads the
new one.

**Sweeps: `viscosity_sweeps.json`** (4 seeds per case, not rerun),
**INCONCLUSIVE** on the 10 % precision criterion. Most cases achieve 20–35 %:
the core velocity gradient is small against thermal noise.

| case | μ_eff | Kn = λ/H (λ measured) | Enskog benchmark |
|---|---|---|---|
| reference φ = 0.1, H = 40, U = 0.5, Aw = 1 (30 seeds) | **0.3326 ± 0.0079** | 0.058 | 0.316 |
| U = 0.25 / 0.5 / 1.0 | 0.41 ± 0.11 / 0.320 ± 0.021 / 0.319 ± 0.020 | 0.059 | 0.314–0.321 |
| φ = 0.05 / 0.2 | 0.282 ± 0.009 / 0.351 ± 0.033 | 0.127 / 0.024 | 0.300 / 0.379 |
| H = 20 / 80 | 0.312 ± 0.021 / 0.267 ± 0.021 | 0.116 / 0.029 | 0.317 / 0.315 |
| kT_w = 4, U = 1 | 0.640 ± 0.041 | 0.058 | 0.632 |
| particle radius 0.35 (same φ, H) | 0.446 ± 0.026 | 0.041 | 0.452 |
| Aw = 0.5 / 0.25 | 0.284 ± 0.019 / 0.285 ± 0.032 | 0.058 | 0.316 |

The gas has a shear viscosity with the scalings of a hard-disk fluid:
independent of shear rate within errors, ∝ √kT (0.640 vs 2 × 0.325), ∝ 1/d at
fixed φ, rising with density; the reference value is within 3 % of the
dilute-plus-Enskog benchmark. At H = 80 the core profile is not linear
(χ² p = 3 × 10⁻⁵) and μ_eff is 15 % low. The cause is not established — a
candidate is that the thicker channel, whose momentum-diffusion time grows as
H², had not reached a linear steady state within the fixed collision budget —
so that point is not used. Kn > 0.1
cases are flagged as channel properties, not bulk ones.

## 7. Boundary layer (Step 12)

Record `boundary-layer_reference.json` (8 seeds, 10 188 particles, φ = 0.1,
U = 1), status **INCONCLUSIVE**; determination **EMERGED**. A uniform stream
from an open reservoir passes a diffuse plate (x = 100–400) set in a specular
floor, open top and outlet; no profile is imposed.

- Near-wall velocity deficit 0.80–0.89 over the plate against 0.07 over the
  specular floor upstream; displacement thickness δ* grows from 10.6 at 10 %
  of the plate to 21.8 at 75 % (18.8 at 95 %; fitted growth exponent
  0.31 ± 0.03), δ₉₀ from 25 to 51; wall shear falls from 0.0168 to
  0.008–0.011 along the plate.
- Re = ρ_e U_e L_plate / μ ≈ 115 (μ from the Couette record), Re based on the
  measured δ* ≈ 8, Mp ≈ 0.60.
- Why INCONCLUSIVE: the upstream control station (specular floor, x = 25)
  shows a deficit of 0.074 ± 0.014, not zero within 3 SE — some upstream
  influence of the plate or the inlet is present.
- Limits: the outer flow accelerates 1.01 → 1.14 along the plate (displacement
  with a far-field reservoir that holds U = 1 at y = 200); the momentum
  integral built from measured quantities closes only to 17–52 %, so the
  layer is not yet a clean, self-similar boundary layer. The realised
  free-stream density is 9.7 % below the reservoir's stated value (A-18).

## 8. Adverse-gradient separation (Step 13)

Record `separation_reference.json` (4 seeds × 8 gradient strengths, 4074
particles, φ = 0.1, U = 1), status **INCONCLUSIVE**. The boundary-layer rig is
decelerated only through its far-field boundary: the open top reservoir's
stream slows linearly from U to (1 − s)U over the middle of the plate, with
the outward drift that continuity requires, and the outlet stream is
(1 − s)U. No pressure-gradient or separation law is used. A near-wall reversal
counts as separation only where the outer flow still moves forward. (In
development probes — not a stored record — a back-pressure generator with a
lid reversed the whole channel before any local separation appeared; that
generator remains selectable, and such cases are classified as bulk reversal,
not separation.) At s = 0 the outer flow accelerates 17 % along the plate: the
same displacement effect seen in the boundary-layer reference.

| strength s | role | outer-flow change along plate | max shape factor δ*/θ | outcome |
|---|---|---|---|---|
| 0 | training | +17 % | 2.46 | attached |
| 0.2 | test | −3 % | 2.47 | attached |
| 0.4 | training | −24 % | 2.57 | attached |
| 0.6 | test | −47 % | 2.94 | attached |
| 0.7 | training | −57 % | 2.85 | attached |
| 0.8 | test | −70 % | 2.98 | attached |
| 0.9 | training | −82 % | 4.79 | attached |
| 0.95 | test | −87 % | 3.89 | attached |

As the deceleration grows the wall shear over the rear of the plate falls
from ~0.008 toward zero, a few stations turn slightly negative at s ≥ 0.8, and
the shape factor rises — the approach to separation — but no configuration
shows the sustained, significant (τ̄ + 2 SE < 0 at two consecutive stations)
reversal that the pre-stated onset criterion requires. With no separated
training configuration, **no threshold hypothesis could be generated**, so
none was tested. Re_sim ≈ 117 (plate length), Mp ≈ 0.50.

What this means: at Re ~ 10², with a layer only 10–20 mean free paths thick,
the flow near the wall is strongly diffusive, and it stays attached even under an 87 % outer deceleration over
0.6 plate lengths. Observing separation here needs a stronger or more abrupt
gradient, a longer decelerating region, or a higher Re (a larger universe);
each is a documented parameter of the experiment, not a change of physics.

## 9. Kutta discovery (Step 14)

Record `kutta_reference.json` (4 seeds × 3 cases, chord 60 d, domain
360 × 200, 9 167 particles at φ = 0.1), status **PASSED** (safety, no
penetration, ledgers, no empty space, symmetry control, late-window
steadiness). A uniform stream U = 1 starts impulsively past a fixed polygon
body with Maxwell-diffuse faces; all four domain sides are open reservoirs.
Nothing about circulation, the Kutta condition or trailing-edge velocities is
imposed. Lift and drag are the measured impulse delivered to the body;
circulation is ∮u·dl of the time-averaged particle velocity on a rectangle
around the body (counter-clockwise positive, so upward lift in +x flow goes
with negative Γ). Re_c = ρ_e U_e c / μ ≈ 22, Mp ≈ 0.55.

| case (late window t = 300–500) | lift | drag | Γ_body | departure angle to TE bisector | TE loading Δp (mean loading) | determination |
|---|---|---|---|---|---|---|
| sharp rhombus, α = 0° | 0.14 ± 0.26 | 2.98 ± 0.12 | −7.3 ± 4.1 | −0.3° ± 9.2° | 0.009 ± 0.009 (0.002) | smooth departure, no significant lift |
| **sharp rhombus, α = 8°** | **1.59 ± 0.20** | 3.18 ± 0.07 | **−10.4 ± 3.5** | **3.1° ± 7.3°** (band ±19.8°) | **0.002 ± 0.012** (0.026) | **smooth departure with lift** |
| blunt rectangle, α = 8° | 1.48 ± 0.18 | 3.69 ± 0.10 | −10.6 ± 2.8 | 16.4° ± 3.5° | 0.030 ± 0.017 (0.025) | (see note) |

What emerged, with nothing imposed:
- **A lifting flow with bound circulation.** At 8° the sharp-edged body
  carries lift 8 SE from zero, with clockwise circulation of the sign that goes
  with it; at 0° it carries none (the rig's symmetry control).
- **Smooth trailing-edge departure.** The gas in a half-disk behind the sharp
  edge leaves along the edge's bisector (3° ± 7°); no near-wall reversal on
  either surface; the pressure difference across the plate in the bins next to
  the edge is zero within its error while the average loading is 0.026 — the
  pressure-equality form of the Kutta condition, measured rather than imposed.
  In the first 20 time units the departure angle is 12° ± 7°, i.e. not
  resolved as different from the late state.
- **But the sharp edge is not what decides it here.** The blunt-edged body
  gives nearly the same lift (1.48 ± 0.18) and circulation. At Re ≈ 22 the
  flow is viscosity-dominated: the layers on both faces are thick and the
  flow leaves any trailing edge "smoothly". For the blunt body the bisector
  band (±105°) makes the smooth-departure label uninformative; it is reported,
  not interpreted.
- **Not resolved:** the starting vortex (wake-slab circulation peaks did not
  rise above the late-window noise, so no convection speed is reported); no
  periodic shedding (Fisher g test, 0 of 4 seeds per case).

Benchmark, shown only after the measurement (§19): thin-airfoil theory with
the Kutta condition imposed, inviscid and unbounded, gives Γ = −25.9 and lift
3.03 at 8°. The measured values are 0.40 and 0.52 of those; the
Kutta–Joukowski lift computed from the measured circulation (1.22) is 77 % of
the measured lift. Low Re, a thick viscous layer, compressibility (Mp 0.55)
and far-field reservoirs at ~1.7 chords all plausibly contribute; none is
separated out yet.

## 10. Scaling across particle universes (Step 15)

Records `scaling_fixed-mach.json` and `scaling_fixed-reynolds.json`. The Kutta
8° sharp-edged case is rerun at geometrically similar sizes measured in
particle diameters (every length and the convective time scaled together;
φ = 0.1). Coefficients are normalised with the measured, realised free stream:
C_L = L / (½ ρ_e U_e² c) is a reporting normalisation, not a solver input.
Kn below uses the mean free path measured in the Couette reference (2.34).

**Fixed Mach** (U = 1, Mp ≈ 0.55; Re ∝ size, Kn ∝ 1/size; 6 seeds): status
**INCONCLUSIVE**.

| chord | particles | Re_c | Kn_c | C_L | C_D | Γ/(U_e c) |
|---|---|---|---|---|---|---|
| 30 | 2 292 | 10.7 | 0.078 | 0.64 ± 0.15 | 1.21 ± 0.04 | −0.08 ± 0.06 |
| 42 | 4 492 | 15.0 | 0.056 | 0.54 ± 0.09 | 1.05 ± 0.05 | −0.19 ± 0.07 |
| 60 | 9 167 | 20.8 | 0.039 | 0.55 ± 0.08 | 0.96 ± 0.04 | −0.19 ± 0.04 |

Drag falls with size as Re grows and is **converged** between the two largest
universes within the 10 % tolerance (−9 %, z = −1.6). Lift and circulation
are not resolved at that tolerance (the study's resolution is 43 % and 83 %).

**Fixed Reynolds** (Re ≈ 10.4 held by U ∝ 1/size; Kn and Mp halve;
8 seeds): status **NOT CONVERGED**.

| chord | U | Mp | Kn_c | C_L | C_D | Γ/(U_e c) |
|---|---|---|---|---|---|---|
| 30 | 1.0 | ≈ 0.55 | 0.078 | 0.47 ± 0.09 | 1.28 ± 0.05 | −0.11 ± 0.08 |
| 60 | 0.5 | ≈ 0.28 | 0.039 | 0.76 ± 0.07 | 1.60 ± 0.05 | −0.17 ± 0.07 |

At equal Re, the larger universe gives 38 % more lift (z = 2.6) and 20 % more
drag (z = 4.4). **Re alone does not fix the dimensionless result at these
sizes**: Knudsen-number and/or Mach-number effects are still present, so the
particle universe is not yet in a regime where it behaves like a continuum
characterised by Re. Which of the two (Kn or Mp) is responsible is not
separated by this design; a third family at fixed Re and fixed Mp needs a
different density or temperature per level and was not run.

(The committed records show Mp as n/a — the scaled runs were not given the
measured c_p; it is U_e / 1.81. The fixed-Re record names its levels LOW and
HIGH while its verdict text says MEDIUM for the smaller size; both are fixed
for future runs.)

## 11. Model A/B tests (§40)

The A/B test runs two configurations of one experiment with the same seeds
and reports B − A, its uncertainty, its significance and each side's own
status and convergence. Records (static box, 5 seeds per side, N = 1000):

- `ab-test_null-seeds.json` — seeds 7–11 vs 12–16, same model: B − A =
  −0.0013 ± 0.0024 in P·A/(N·kT) (z = −0.55), **no significant difference**,
  as a null test must show. Status PASSED.
- `ab-test_contact-timing.json` — rewind-to-contact vs impulse-at-detection at
  a coarse timestep (Courant 0.1): B − A = −0.0145 ± 0.0031 (−1.3 %, z = −4.7),
  **different**. Contact timing is a numerical choice that changes the
  measured pressure when steps are coarse, which is why references use
  rewind-to-contact at Courant 0.025 (where the timestep study shows no
  change). The rewind side is INCONCLUSIVE on its own timestep-quality check at
  Courant 0.1 (late-contact fraction 2.5 × 10⁻³), so the record is
  INCONCLUSIVE.

The model comparisons named in the Master prompt (collision vs collision +
occupancy, e = 1 vs e < 1 with reservoir, specular vs diffuse plate, particle
resolution) are selectable presets (`npm run exp -- ab-test --preset "…"`, or
the lab's A/B entry). Their answers are also already in §5 (pulse models A–E,
same seeds) and §6 (Couette particle radius); dedicated A/B records were not
run. A sign error in the reported difference (A − B labelled B − A;
magnitudes and verdicts unaffected) was found while reading these records,
fixed with a test, and both records regenerated.

## 12. Reynolds and Mach numbers

Every flow record states Re and Mp with their definitions. Re uses the
viscosity measured in the 5-seed Couette reference in force when they were run
(0.325 ± 0.027). The 30-seed rerun gives 0.3326 ± 0.0079: +2.3 %, within that
uncertainty, and these Re would be 2.3 % lower with it. Mp = V/c_p uses
the disturbance speed measured at the matching density (c_p = 1.81 ± 0.10 at
φ = 0.1). None of these is a physical-wing Reynolds number:

| experiment | definition | Re | Mp | Kn |
|---|---|---|---|---|
| Couette reference | ρ U H / μ | 7.8 | 0.28 | λ/H = 0.059 |
| boundary layer | ρ_e U_e L_plate / μ (and on δ*) | 115 (7.6) | 0.60 | λ/L_plate ≈ 0.008 |
| separation | ρ_e U_e L_plate / μ | 117 | 0.50 | ≈ 0.007 |
| Kutta | ρ_e U_e c / μ | 22 | 0.55 | λ/c ≈ 0.04 |
| scaling, fixed Mp | ρ_e U_e c / μ | 11 / 15 / 21 | ≈ 0.55 | 0.078 / 0.056 / 0.039 |
| scaling, fixed Re | ρ_e U_e c / μ | 10.4 / 10.4 | ≈ 0.55 / 0.28 | 0.078 / 0.039 |

The particle universes reach Re ~ 10² at Mp ~ 0.3–0.6 and Kn ~ 0.02–0.1.
A real wing section operates at Re ~ 10⁶ and Mp < 0.3 with Kn ~ 10⁻⁸. In a
dilute-to-moderately-dense gas μ scales as ρ·λ·(thermal speed), so Re·Kn ∝ Mp
at a fixed thermodynamic state: a higher Re at the same Mp needs a
proportionally larger universe in particle diameters (particle count ∝ Re² in
2D).

## 13. Limitations and open questions

- **v0.1 discrepancy** (§1): unresolved; the v0.2 value agrees with hard-disk
  theory and passes its convergence studies.
- **Sound speed** passed the pre-registered small-amplitude validation
  (c₀ = 2.170 ± 0.038). Two post-hoc caveats stand beside it: the linear
  zero-amplitude extrapolation is leveraged by the large-amplitude points
  (model systematic ≈ 4 %, small-amplitude estimates ≈ 2.26), and S1 tests
  only the seed-averaged control, in which random-phase thermal sound cancels;
  per-seed equilibrium noise carries a clear moveout at ≈ 2.26–2.28 (§5).
  The earlier pulse records stay INCONCLUSIVE; case E (model E) was not rerun.
- **Viscosity precision** is met at the reference settings (± 4.85 %, 30
  seeds); the sweep cases are still at 4 seeds (20–35 %).
- **Thermal relaxation criterion E6** turned out ill-posed: its false-alarm
  rate grows with seeds × run length (§3). It was replaced by the
  pre-registered E6′, which passed on fresh seeds 31–40. The reference record
  stays INCONCLUSIVE.
- **Open boundaries** supply only kinetic pressure (A-18), leaving dense
  interiors below their stated density; all flow results use the realised
  state.
- **Boundary layer** outer flow is not uniform and the momentum integral does
  not close (§7).
- **Separation** was not observed, so the data-generated threshold could not
  be built or tested (§8).
- **Kutta**: at Re ≈ 22 a blunt edge behaves like a sharp one, so the
  experiment shows smooth departure but cannot yet show that the *sharp edge*
  enforces it; the starting vortex was not resolved (§9).
- **Scale dependence**: at fixed Re the lift and drag coefficients change by
  20–40 % between chord 30 and 60 (§10). Any flow result from these universes
  is specific to its Kn and Mp as well as its Re.
- **Occupancy force and Universe B** are hypotheses with calibrated
  parameters; nothing here validates them.
- **λ/Kn in Couette records** depend at the 5 × 10⁻⁴ level on the step-batch
  size (parallel vs serial replay): the collision-rate interval starts at a
  batch boundary. All other fields replay bit-for-bit
  (`REPORT_THERMAL_VISCOSITY.md` §1).
- The analysis-method revisions made after seeing data are listed, with
  reasons, in `MODEL_CHANGELOG.md`; a sign error in the A/B difference
  (magnitudes and verdicts unaffected) was fixed and those records regenerated.

## 14. What would unlock airfoil work

The lock opens only when every §42 criterion has PASSED and the flow results
are scale-converged. From the data above, the shortest path is:

1. **Thermal behaviour and viscosity** (criteria 4, 6): done. Criterion 4
   passed on the fresh validation seeds under the pre-registered E6′.
   Criterion 6 passed with 30 seeds × 600 collisions/particle.
2. **Sound speed in the linear limit** (criterion 5): done. Passed on fresh
   seeds 6001–6064 under the criteria pre-registered at `04e0826`
   (`CRITERIA_SOUND_SPEED.md`, `REPORT_SOUND_SPEED.md`). The tracker now
   reports competing features; case E itself was not rerun.
3. **Clean boundary layer** (criterion 8): a far-field boundary that follows
   the displacement of the layer (or a taller domain) so the outer flow stays
   uniform, and an upstream control that is clean within its error.
4. **Separation** (criterion 9): stronger or more abrupt deceleration, a longer
   decelerating region, or a larger universe (higher Re), until at least one
   training and one test configuration separate.
5. **Scale convergence of flow results** (criterion 12): a scaling family at
   fixed Re *and* fixed Mp (different density or temperature per level) to
   separate Knudsen from Mach effects, then sizes large enough that C_L and C_D
   stop changing. At fixed Mp the particle count grows as Re², so this is
   the expensive step; it decides whether this particle universe can speak for
   a continuum wing at all.

Until then, airfoil geometry (Master prompt Steps 16–20) is not started.

