# Acceptance criteria: thermal equilibrium and effective viscosity

Written and committed **before** the reruns they judge (Phase 0 item 1). Once
the reruns start, the criteria here are not changed; if a criterion turns out
to be ill-posed, that is reported, not repaired. §6 (Revision 1) replaces E6
with E6′ for a new, fresh validation run only; it does not change how the
original reruns were judged.

## 1. Why the two experiments were INCONCLUSIVE

**Thermal** (`results/thermal_reference.json`, 5 seeds × 50 collisions/particle).
Every check passed except `eos-precision`: "95 % CI half-width < 2 % at every
φ". Worst case φ = 0.2: Z = 1.5833 ± 0.0170 → 2.10 %. That uncertainty was
the inverse-variance pool of each run's own block-averaging SE. The data
contradict those per-run SEs: the five independent seeds agree far better
than the SEs allow (χ² consistency p = 0.995, 0.990, 0.969, 0.997 at
φ = 0.02, 0.05, 0.1, 0.2), and the seed-ensemble SE is 4–6× smaller
(φ = 0.2: ± 0.0026 instead of ± 0.0170). The same holds for the static box
(φ = 0.05, 10 seeds): per-run block SE ≈ 8.5 × 10⁻⁴ with a flat blocking
plateau, while the run means scatter with SD 2.3 × 10⁻⁴. The window pressures
look uncorrelated up to the deepest blocking level (16 windows), but the run
means vary much less than that implies — consistent with pressure oscillations
(box acoustic modes, period ~ L/c ≈ 40 windows) longer than the deepest block,
which cancel over a whole run. **Diagnosis: the per-run blocking SE
overstates the uncertainty for closed-box wall pressure; the check failed
because of an over-conservative estimator, not imprecise data.** This is an
analysis defect, not a physics defect. The independent-seed ensemble is the
assumption-free estimator (Master prompt §21: ensemble averaging, multiple
seeds) and is what the static-box check already uses.

**Viscosity** (`results/viscosity_reference.json`, 5 seeds × 300
collisions/particle). Every check passed except `viscosity-precision`: "95 % CI
half-width (seed ensemble) < 10 %". Measured 23.3 %: μ_eff = 0.325 ± 0.027
(SE) with 4 degrees of freedom (Student t = 2.78). Here the per-run SEs are
consistent with the seed scatter (χ² p = 0.24): per-run μ_eff carries ~17 %
statistical noise, dominated by the wall shear stress (τ ≈ 0.0038 ± 0.0006 per
run). **Diagnosis: genuine statistical noise; more independent seeds and a
longer measurement are the remedy.** No defect found.

## 2. What the specification defines

Neither the Bible nor the Master prompt gives a numeric precision threshold
for these two experiments.

- Master prompt §11 (thermal): test equilibrium; temperature, density and
  initial-distribution dependence; document the temperature proxy.
- Master prompt §16 / Bible §15 (Couette): measure V(y), wall shear momentum
  flux, μ_eff from their measured relation; determine whether viscosity is
  emergent, stable, resolution-, wall-model- and temperature-dependent.
- Bible §20: "Pressure differences of less than 1 % require adequate
  averaging." (the only number)
- Bible §37: falsified if "viscosity cannot be measured consistently" or
  "results depend strongly on random seed".
- Bible §31: "If results change materially: NOT CONVERGED" (no number).

The earlier thresholds (2 % for Z, 10 % for μ_eff) were PFAD implementation
choices. Below, each criterion states its source.

## 3. Statistical conventions

- **Statistical uncertainty** = independent-seed ensemble: mean, sample
  variance, SD, SE = SD/√n, 95 % CI with Student t (n − 1 dof), between-seed
  coefficient of variation. Per-run SEs are reported but not used for
  aggregate CIs (thermal: shown to be unreliable; viscosity: used only in the
  seed-consistency χ²).
- **Systematic / numerical error** is reported separately and never folded
  into the statistical CI: timestep and grid (convergence studies / timestep
  A/B), finite-size wall effects, Knudsen layers, analysis-window choice.
- **Multiple tests**: where a criterion is a family of m tests, each passes at
  p > 0.05/m (Bonferroni; family-wise false-alarm ≤ 5 %).
- **Outcomes**: every test has a PASS region, a FAIL region (decisive
  evidence against the property: p < 10⁻⁶, |z| > 5, or the stated failure
  condition) and an INCONCLUSIVE region between. Precision criteria can only
  PASS or be INCONCLUSIVE (more data can fix them). The experiment is
  **PASS** if every criterion passes, **FAIL** if any criterion fails,
  otherwise **INCONCLUSIVE**.

## 4. Thermal equilibrium — criteria

Question: does the particle model reach a reproducible thermal/statistical
equilibrium? Configuration unchanged (2000 disks, closed specular box, φ = 0.05
unless varied; kT ∈ {0.25, 0.5, 1, 2, 4}; φ ∈ {0.02, 0.05, 0.1, 0.2}; four
initial velocity distributions); only seeds (10: 21–30) and duration
(200 collisions/particle of measurement, 80 for relaxation runs) change.

| ID | Criterion | PASS | FAIL | Source |
|---|---|---|---|---|
| E1 | Energy proxy (kT = KE/N) conserved | max relative ledger residual < 10⁻⁹ | ≥ 10⁻⁹ | numerical safety (§34) |
| E2 | Stationarity: late half = early half of the measurement for Z, a₂, kurtosis, anisotropy and the spatial dispersion index, in every configuration | seed-paired t-test p > 0.05/m for all m tests | any p < 10⁻⁶ | §11 "equilibrium" |
| E3 | Equilibrium independent of initial distribution (Z, late a₂) and of temperature class (Z) | one-way ANOVA p > 0.05/3 each | any p < 10⁻⁶ | §11 dependence tests; Bible §37 |
| E4 | Precision: seed-ensemble 95 % half-width of Z | < 0.71 % in every configuration | — (INCONCLUSIVE only) | Bible §20: resolving a 1 % difference between two measurements needs each half-width < 1 %/√2 |
| E5 | Spatial uniformity: no sustained near-zero-occupancy region | no flag | flag raised | Bible §19 / Master prompt §20 |
| E6 | Relaxation from every initial distribution completes within the run | last > 4σ excursion in the first half of every relaxation run | — (INCONCLUSIVE / NOT CONVERGED) | §11 initial-distribution test |

E6 judged the original reruns (seeds 21–30). It is retired for later runs
and replaced by E6′ (§6); it is still computed, as a diagnostic only.

Reported, not judged: the temperature proxy kT_x, kT_y and their ratio;
dispersion index against the hard-disk compressibility; kurtosis, a₂ and a
KS test against the 2D Maxwellian; Z against the Henderson equation of state;
relaxation times; per-seed tables; convergence curves; averaging-window
sensitivity (Z from the last 75 %, 50 %, 25 % of the measurement).

## 5. Effective viscosity — criteria

Question: is μ_eff reproducible? Configuration unchanged (φ = 0.1, H = 40,
U = 0.5, Aw = 1, 1000 disks, core fraction 0.6); only seeds (30: 71–100) and
duration (600 collisions/particle of measurement) change. The velocity
profile is additionally accumulated in 8 consecutive time blocks
(measurement only) for the convergence analysis.

| ID | Criterion | PASS | FAIL | Source |
|---|---|---|---|---|
| V1 | Steady state: wall stresses equal and opposite; no net heating | pooled \|z\| < 3 each | \|z\| > 5 | §16 (walls must not heat the gas indefinitely) |
| V2 | Fit quality: core profile linear | χ² p > 0.001 in every run | any p < 10⁻⁶ | §16 "regression diagnostics" |
| V3 | Emergent: μ_eff > 0 | seed-ensemble 95 % CI excludes 0 | CI entirely ≤ 0 | §16 / Bible §15 "emergent" |
| V4 | Reproducible across seeds | χ² of per-seed μ_eff about their mean, using per-run SEs: p > 0.001 | p < 10⁻⁶ | Bible §37 "depend strongly on random seed" |
| V5 | Stable in time: second half = first half of the measurement | seed-paired t-test p > 0.05/2 | p < 10⁻⁶ | Bible §15 "stable" |
| V6 | Averaging-window insensitive: core fraction 0.4 vs 0.6 | seed-paired t-test p > 0.05/2 | p < 10⁻⁶ | §31 "averaging convergence" |
| V7 | Timestep: Courant 0.05 (30 seeds, 101–130) vs 0.025 (the reference, seeds 71–100) | \|z\| < 3 | — (a significant difference is reported as a numerical systematic → INCONCLUSIVE) | §23 timestep convergence |
| V8 | Precision: seed-ensemble 95 % half-width of μ_eff | < 10 % | — (INCONCLUSIVE only) | PFAD-defined (no Bible number): equals the 10 % relative tolerance PFAD uses to call flow results converged, so μ-based Re is known at least as well as the changes it is used to detect |

Core fraction 0.8 reaches within 0.1 H = 4 ≈ 1.7 mean free paths of the walls,
inside the Knudsen layers; it is reported as a diagnostic of the wall layers,
not tested. Reported, not judged: Enskog benchmark ratio, slip at each wall,
Knudsen number, per-seed table, velocity profile, convergence curves.

## 6. Revision 1: E6 replaced by E6′ for the thermal validation run

Written and committed **before** the validation run it governs (fresh seeds
31–40). Nothing in this section was chosen with any knowledge of those data.
§4 (E1–E5) and §5 are unchanged.

### 6.1 The original result is preserved

- The thermal reference run (`results/thermal_reference.json`, seeds 21–30,
  judged at commit `dac9f52`) failed E6 on one extreme window: uniform-box
  start, seed 25, a₂, c = 56.8 collisions/particle, z = 4.68.
- Under the rules then in force, that outcome is NOT CONVERGED, so thermal
  equilibrium was **INCONCLUSIVE**. That classification was correct and is
  final for that record. It is not revised.
- A diagnosis made afterwards (`docs/REPORT_THERMAL_VISCOSITY.md` §3.8,
  `scripts/diagnose-thermal-e6.ts`) showed that E6's false-alarm rate was not
  calibrated:
  - the Maxwell-start runs, which begin in equilibrium, fire the same
    statistic (z up to 5.18);
  - the measured rate implies a ≈ 95 % chance of a flag at 10 seeds × 80
    collisions/particle with no relaxation defect at all.
- E6′ was proposed only **after** that diagnosis, on the same data. Seeds 21–30
  therefore cannot establish an E6′ PASS. The E6′ evaluation of them in the
  report is information only.
- **The validation dataset is a fresh seed set, 31–40.**

### 6.2 Why E6′ replaces E6

E6 tests every single window of every series against a fixed 4σ, with σ the
window-to-window SD. Its false-alarm probability is set by:

- the number of series;
- the run length;
- the autocorrelation of the windows (lag-1 ≈ 0.8–0.96);
- the tail shape of the window statistic (a₂ is right-skewed).

None of these is controlled. More data therefore make a NOT CONVERGED *more*
likely whatever the physics. A pass/fail criterion must have a known
false-alarm rate.

E6′ is built differently:

- It asks the physical question directly: by the late half of the relaxation
  run, is each non-equilibrium start indistinguishable from equilibrium?
- It answers it against an **empirical null**. The Maxwell-start runs begin
  in equilibrium and share N, φ, kT, run length and windows with the other
  starts.
- It uses independent seeds as the unit of replication.
- It averages over blocks of ~10 collisions/particle, so a single-window tail
  event cannot decide it.
- It fixes the family-wise false-alarm probability at ≤ 5 % by Bonferroni.

Its false-alarm rate does not grow with run length or seed count; more data
only increase its power.

### 6.3 Definition of E6′

Implemented as `relaxationVersusControl` in
`src/experiments/ThermalEquilibriumAnalysis.ts`, with unit tests in
`tests/experiments.thermal.test.ts`.

- **Data.** The relaxation runs of the `distribution` study: four starts
  (Maxwell, uniform-speed, uniform-box, two-beam) per seed, each 80
  collisions/particle from t = 0, in windows of 0.1 collisions/particle
  (n ≈ 790 windows). Observables per window are a₂ and the velocity
  anisotropy, the same two as E6. Halted runs are excluded.
- **Late half.** Window index ≥ ⌊n/2⌋ of each run.
- **Blocks.** B = 4 consecutive blocks of L = ⌊(n − ⌊n/2⌋)/4⌋ windows (≈ 98–99
  windows, ≈ 10 collisions/particle each). The final (n − ⌊n/2⌋) mod 4 ≤ 3
  windows are not used. Each seed contributes one block mean per observable
  and block.
- **Tests.** For each non-Maxwell start (3), observable (2) and block (4):
  - a Welch two-sample t-test of the per-seed block means of that start
    against the per-seed block means of the Maxwell start;
  - Welch–Satterthwaite degrees of freedom, two-sided p;
  - m = 3 × 2 × 4 = **24** tests.
- **PASS** if every p > 0.05/24 = **2.083 × 10⁻³**. **FAIL** if any
  p < 10⁻⁶. Otherwise **INCONCLUSIVE**. If the control or any start has fewer
  than 3 usable runs, E6′ is not evaluable and INCONCLUSIVE.
- **Reported, not judged:**
  - per test: block means, Δ, SE, t, dof, p, and the minimum detectable
    difference t_crit(0.05/24, dof) · SE;
  - windows tested, number of violations, smallest p, max |t|;
  - the relaxation times of the seed-ensemble mean;
  - the retired E6 statistic (no longer a criterion).

### 6.4 Multiple-testing logic

H0 is that every start has reached the same equilibrium as the control by the
late half. Under H0 each p-value is (approximately) uniform, so
P(p_i ≤ 0.05/24) = 0.05/24. By the union (Bonferroni) inequality,
P(any of the 24 ≤ 0.05/24) ≤ 24 × 0.05/24 = **5 %**.

This bound holds under **any** dependence between the tests. That matters
here, because the tests are not independent:

- all 24 share the same control runs;
- the 4 blocks of one run are correlated;
- a₂ and anisotropy come from the same velocities.

Positive dependence makes the true family-wise rate *lower* than 5 %, so the
bound is conservative. The expected number of false violations under H0 is
24 × 0.05/24 = 0.05.

The Welch test assumes approximately normal per-seed block means. Each is a
mean of ~99 correlated windows. The FAIL threshold, 10⁻⁶, is far beyond any
plausible error of that approximation.

**Whole-classification budget, stated in advance.** For a model in perfect
equilibrium, the probability of an INCONCLUSIVE by chance is at most
5 % (E2) + 1.7 % (E3, temperature) + 3.3 % (E3, distribution: two tests at
0.05/3) + 5 % (E6′) ≈ **15 %** (union bound). Add to that the chance of
missing the E4 precision limit. The original run's worst E4 half-width,
0.67 % against 0.71 %, shows that margin is thin; E4 is not changed. A chance
FAIL needs p < 10⁻⁶ in some test, so it is negligible. E1, E5, numerical
safety and the energy-scale symmetry are deterministic checks.

### 6.5 Validation plan

- **Code.** The commit that adds this section. The run is made from a git
  worktree pinned to it, and its hash is recorded in the run log and the
  report.
- **Configuration.** `THERMAL_REFERENCE`, unchanged except for the seeds:
  - N = 2000, φ = 0.05;
  - kT = 0.25, 0.5, 1, 2, 4;
  - φ = 0.02, 0.05, 0.1, 0.2;
  - 4 starts;
  - 10 collisions/particle of equilibration, then 200 of measurement in
    windows of 0.25;
  - relaxation runs of 80 collisions/particle in windows of 0.1;
  - Courant 0.025;
  - **seeds 31–40**.
- **Command.**
  `npx tsx scripts/run-experiment.ts thermal --parallel 4 --set 'seeds=[31,32,33,34,35,36,37,38,39,40]' --out results --name thermal_validation_s31-40`
- **Report.**
  `npx tsx scripts/report-thermal-validation.ts results/thermal_validation_s31-40.json results/plots/thermal_validation`.
  The script refuses to classify any record whose seeds overlap 21–30.
- **Decision.**
  - Criteria: E1–E5 as in §4, and E6′ in place of E6.
  - Thermal equilibrium is **PASS** if every check passes, **FAIL** if any
    check is FAILED, and **INCONCLUSIVE** otherwise.
  - Only the fresh record is used for the decision.
  - E6′ is not altered after the data are seen. If the result is
    INCONCLUSIVE or FAIL, it stands. Any further change would need a new
    pre-registration and another fresh seed set.
- **Reporting.**
  - The original record keeps its INCONCLUSIVE.
  - The validation is reported separately, as the validation.
  - If it passes, Phase 0 criterion 4 is reported as PASSED on the
    validation dataset, and the original INCONCLUSIVE is kept in the log.
