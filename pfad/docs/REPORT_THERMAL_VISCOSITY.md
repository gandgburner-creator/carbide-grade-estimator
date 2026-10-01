# Phase 0 item 1: thermal equilibrium and effective viscosity

Precision reruns for the two Phase 0 experiments that were INCONCLUSIVE on
precision alone. The criteria were fixed and committed **before** the runs
(`docs/CRITERIA_THERMAL_VISCOSITY.md`, commit `dac9f52`) and are applied here
unchanged.

| experiment | classification | why |
|---|---|---|
| Effective viscosity (Couette) | **PASS** | all eight criteria V1–V8 pass; μ_eff = 0.3326, 95 % CI [0.3165, 0.3487] (± 4.85 %) |
| Thermal equilibrium | **INCONCLUSIVE** | E1–E5 pass, including the precision criterion that caused the earlier INCONCLUSIVE; the pre-registered relaxation criterion E6 is not met for one of the four initial distributions (one window of one seed). §3.8 shows the flag is almost certainly a statistical false alarm of an ill-posed criterion, but the rule was fixed in advance, so the result stays INCONCLUSIVE |

**Physics model: unchanged.** No physical rule, numerical scheme or reference
configuration parameter was changed. The only code changes before the runs
were measurement and analysis additions (time-blocked profiles, a dispersion
time series, seed-ensemble statistics). Two existing records were replayed
under `dac9f52` to check this: `static-box_reference_seed7.json` (model
0.2.0-p0.2) and the old 5-seed `viscosity_reference.json` (model 0.2.0-p0.2).
Both reproduce **bit-for-bit**. Model version 0.2.0-p0.4. The only
configuration changes are those the criteria document names: more seeds,
longer measurements, eight profile time blocks, and one extra Courant-0.05
viscosity run.

## 1. What was run

Worktree pinned at `dac9f52`, 4 worker threads on a 4-core cloud container.
Script `results/logs/item1_run.sh`; timings `results/logs/item1_timings.txt`.

| record | command | seeds | measurement | wall time |
|---|---|---|---|---|
| `results/viscosity_reference.json` | `npx tsx scripts/run-couette-reference.ts 4 viscosity` | 71–100 (30) | 600 collisions/particle, 8 profile blocks | 321 s |
| `results/viscosity_courant-0.05.json` | `npx tsx scripts/run-experiment.ts viscosity --parallel 4 --set 'timestep={"kind":"adaptive","courant":0.05,"dtMax":1,"dtMin":1e-7}' --set 'seeds=[101,…,130]' --out results --name viscosity_courant-0.05` | 101–130 (30) | as reference; Courant 0.05 instead of 0.025 | 158 s |
| `results/thermal_reference.json` | `npx tsx scripts/run-experiment.ts thermal --parallel 4 --out results --name thermal_reference` | 21–30 (10) | 200 collisions/particle (temperature and density studies); 80 for the relaxation runs | 967 s |

**Replay check.** `npm run exp -- replay results/viscosity_courant-0.05.json`
(single-threaded, 561 s) reproduces the committed record bit-for-bit in
every field except one diagnostic: the mean free path λ, and Kn = λ/H derived
from it, differ by up to 5 × 10⁻⁴ relative (29 of 30 seeds). The cause is
measurement bookkeeping, not the trajectory. The Couette wrapper starts the
collision-rate interval used for λ at the first step-batch boundary after the
measurement phase begins. Parallel runs advance in batches of 5000 steps,
serial replays in batches of 2000. μ_eff, the profiles, the stresses, the
ledgers and every check are identical. λ and Kn are reported, not judged. A
fix would be to take the interval start from the run's own measurement-start
marker. It was not made here, because it changes no result of this task and
the analysis code stays as it was when the runs were made.

Report and diagnosis (read records only, run nothing):

```
npx tsx scripts/report-thermal-viscosity.ts results/thermal_reference.json \
  results/viscosity_reference.json results/viscosity_courant-0.05.json results/plots \
  > results/report_thermal_viscosity.txt
npx tsx scripts/diagnose-thermal-e6.ts results/thermal_reference.json \
  results/thermal_e6_diagnosis.json results/plots/thermal_e6_diagnosis.svg \
  > results/thermal_e6_diagnosis.txt
```

Every aggregate uncertainty below comes from the independent-seed ensemble:
mean, sample variance, SD, SE = SD/√n, and a 95 % CI from Student t with
n − 1 degrees of freedom. **Statistical** error is the seed-ensemble CI.
**Systematic / numerical** effects are reported separately and never folded
into it (§3.9, §4.7).

## 2. Why the two were INCONCLUSIVE before

See `docs/CRITERIA_THERMAL_VISCOSITY.md` §1. Thermal: the old 2 % check used
pooled per-run block-averaging SEs, which overstate the closed-box pressure
uncertainty 4–6× (the seeds agreed with χ² p ≥ 0.97). Viscosity: genuine
statistical noise, 23 % half-width with 5 seeds. Neither the Bible nor the
Master prompt gives a numeric threshold. E4 (0.71 %) is derived from Bible
§20; V8 (10 %) is PFAD-defined; both are stated there with their sources.

## 3. Thermal equilibrium

2000 hard disks in a closed specular box, elastic. There are five
temperatures (kT 0.25–4) at φ = 0.05 and four densities (φ 0.02–0.2) at kT = 1.
Four initial velocity distributions are used, each relaxed over 80
collisions/particle. Rigid disks have no energy scale, so the kT = 0.25, 1 and 4
runs (and 0.5 and 2) are the *same trajectory* in rescaled time, bit for bit.
The analysis therefore counts **eight distinct configurations**, each judged
over its equilibrium part. For the relaxation runs that part is the late half.

### 3.1 Per-seed results: Z = P/(nkT)

| seed | kT 0.5, φ 0.05 | φ 0.02 | φ 0.05 | φ 0.1 | φ 0.2 | uniform-speed | uniform-box | two-beam |
|---|---|---|---|---|---|---|---|---|
| 21 | 1.11458 | 1.04336 | 1.11430 | 1.24645 | 1.59359 | 1.10153 | 1.11835 | 1.11584 |
| 22 | 1.11430 | 1.04536 | 1.11667 | 1.24910 | 1.59299 | 1.10344 | 1.10859 | 1.08659 |
| 23 | 1.11507 | 1.04340 | 1.11415 | 1.24810 | 1.58992 | 1.12047 | 1.11727 | 1.11140 |
| 24 | 1.11545 | 1.04385 | 1.11241 | 1.25061 | 1.58489 | 1.11720 | 1.11527 | 1.11068 |
| 25 | 1.11416 | 1.04541 | 1.11440 | 1.24921 | 1.59601 | 1.11284 | 1.11397 | 1.11563 |
| 26 | 1.11385 | 1.04536 | 1.11320 | 1.25171 | 1.59577 | 1.10846 | 1.11138 | 1.10980 |
| 27 | 1.11624 | 1.04459 | 1.11819 | 1.24305 | 1.59148 | 1.12288 | 1.11236 | 1.12328 |
| 28 | 1.11721 | 1.04528 | 1.11609 | 1.24841 | 1.58988 | 1.12555 | 1.10742 | 1.11362 |
| 29 | 1.11468 | 1.04472 | 1.11497 | 1.24544 | 1.58831 | 1.11416 | 1.11927 | 1.12496 |
| 30 | 1.11524 | 1.04634 | 1.11575 | 1.25170 | 1.59790 | 1.12067 | 1.11645 | 1.11175 |

Per-seed kT_x/kT_y, a₂, kurtosis and dispersion for every configuration are in
`results/report_thermal_viscosity.txt`.

### 3.2 Aggregate, CI and between-seed variation

| configuration | Z mean | variance | SD | SE | 95 % CI | half-width | between-seed CV | Henderson (diag.) |
|---|---|---|---|---|---|---|---|---|
| kT 0.5, φ 0.05 | 1.11508 | 1.05e-6 | 1.02e-3 | 3.24e-4 | [1.1143, 1.1158] | 0.066 % | 0.092 % | 1.1084 |
| φ 0.02 | 1.04477 | 9.53e-7 | 9.76e-4 | 3.09e-4 | [1.0441, 1.0455] | 0.067 % | 0.093 % | 1.0413 |
| φ 0.05 | 1.11501 | 2.91e-6 | 1.71e-3 | 5.39e-4 | [1.1138, 1.1162] | 0.109 % | 0.153 % | 1.1084 |
| φ 0.1 | 1.24838 | 7.68e-6 | 2.77e-3 | 8.76e-4 | [1.2464, 1.2504] | 0.159 % | 0.222 % | 1.2361 |
| φ 0.2 | 1.59207 | 1.58e-5 | 3.97e-3 | 1.26e-3 | [1.5892, 1.5949] | 0.178 % | 0.249 % | 1.5703 |
| uniform-speed | 1.11472 | 6.70e-5 | 8.19e-3 | 2.59e-3 | [1.1089, 1.1206] | 0.525 % | 0.734 % | 1.1084 |
| uniform-box | 1.11403 | 1.63e-5 | 4.04e-3 | 1.28e-3 | [1.1111, 1.1169] | 0.259 % | 0.363 % | 1.1084 |
| two-beam | 1.11236 | 1.09e-4 | 1.04e-2 | 3.30e-3 | [1.1049, 1.1198] | 0.670 % | 0.937 % | 1.1084 |

The Henderson equation of state is an external comparison only (§3.9).
The worst half-width is 0.670 % (two-beam), which passes E4 (< 0.71 %) with
little margin. The 200-collision configurations reach 0.07–0.18 %.

### 3.3 Temperature proxy, velocity distribution, spatial uniformity

| configuration | kT | kT_x/kT_y | a₂ | kurtosis | anisotropy | dispersion index | hard-disk S(0) (diag.) |
|---|---|---|---|---|---|---|---|
| kT 0.5, φ 0.05 | 0.500000 | 1.0013 ± 1.4e-3 | -7.64e-4 ± 7.5e-4 | 2.996 ± 2.5e-3 | 6.28e-4 ± 7.0e-4 | 0.816 ± 8.9e-3 | 0.816 |
| φ 0.02 | 1.000000 | 0.9992 ± 1.2e-3 | -9.74e-4 ± 1.6e-3 | 2.995 ± 4.8e-3 | -4.27e-4 ± 6.2e-4 | 0.934 ± 1.1e-2 | 0.923 |
| φ 0.05 | 1.000000 | 0.9996 ± 8.2e-4 | 5.11e-4 ± 1.2e-3 | 3.002 ± 3.9e-3 | -1.78e-4 ± 4.1e-4 | 0.837 ± 1.3e-2 | 0.816 |
| φ 0.1 | 1.000000 | 0.9998 ± 8.5e-4 | 8.14e-4 ± 1.4e-3 | 3.001 ± 4.0e-3 | -1.11e-4 ± 4.2e-4 | 0.676 ± 6.0e-3 | 0.661 |
| φ 0.2 | 1.000000 | 0.9998 ± 1.9e-3 | -2.34e-3 ± 1.0e-3 | 2.992 ± 3.2e-3 | -1.13e-4 ± 9.3e-4 | 0.462 ± 6.4e-3 | 0.422 |
| uniform-speed | 1.000000 | 0.9970 ± 3.3e-3 | -7.70e-4 ± 2.3e-3 | 3.000 ± 8.4e-3 | -1.55e-3 ± 1.7e-3 | 0.866 ± 3.3e-2 | 0.816 |
| uniform-box | 1.000000 | 1.0030 ± 3.5e-3 | -1.54e-3 ± 2.8e-3 | 2.994 ± 8.1e-3 | 1.47e-3 ± 1.7e-3 | 0.852 ± 1.5e-2 | 0.816 |
| two-beam | 1.000000 | 1.0014 ± 2.6e-3 | -8.82e-4 ± 3.1e-3 | 2.997 ± 9.4e-3 | 7.07e-4 ± 1.3e-3 | 0.824 ± 1.0e-2 | 0.816 |

- **Temperature proxy** kT = peculiar KE/N. In a closed elastic box energy
  conservation fixes it. Its maximum relative ledger residual is
  3.4 × 10⁻¹⁴ (E1), so the column is exact. Equipartition kT_x/kT_y is 1
  within 0.3 % everywhere.
- **Velocity distribution** (external diagnostic; nothing is imposed). For a
  2D Maxwellian, component kurtosis is 3 and a₂ is 0. Measured kurtosis is
  2.992–3.002 and a₂ is 0 within 2.3 SE in every configuration. KS of the final
  speeds against the Rayleigh CDF (20 000 speeds per start): D = 0.0046 /
  0.0042 / 0.0069 / 0.0047, p = 0.79 / 0.88 / 0.30 / 0.78 (Maxwell /
  uniform-speed / uniform-box / two-beam starts).
- **Spatial uniformity.** No empty-space flag in any of the 130 runs (E5).
  Local φ stays between 0.008 and 0.30, on 49 cells of ~41 particles. The
  dispersion index (variance/mean of cell counts) is compared with the
  hard-disk S(0) only as an external diagnostic. It is within 2.5 SE of
  S(0) at φ ≤ 0.1; at φ = 0.2 it is 0.462 ± 0.006 vs 0.422. Finite cells
  (~41 particles) sample S(k) at k ≠ 0 and include the wall layers, so no
  agreement is required.

### 3.4 Stationarity (E2)

Late half minus early half of each seed's equilibrium part; the table gives
seed-paired t-test p-values for 8 configurations × 5 observables (m = 40).
PASS needs every p > 0.05/40 = 1.25 × 10⁻³.

| configuration | Z | a₂ | kurtosis | anisotropy | dispersion |
|---|---|---|---|---|---|
| kT 0.5, φ 0.05 | 0.297 | 0.309 | 0.416 | 0.676 | 0.209 |
| φ 0.02 | 0.118 | 0.809 | 0.885 | 0.851 | 0.331 |
| φ 0.05 | 0.016 | 0.296 | 0.321 | 0.537 | 0.478 |
| φ 0.1 | 0.381 | 0.855 | 0.958 | 0.902 | 0.169 |
| φ 0.2 | 0.270 | 0.299 | 0.517 | 0.216 | 0.521 |
| uniform-speed | 0.461 | 0.691 | 0.749 | 0.726 | 0.514 |
| uniform-box | 0.119 | 0.537 | 0.643 | 0.707 | 0.592 |
| two-beam | 0.679 | 0.539 | 0.300 | 0.437 | 0.492 |

**All 40 pass.** The smallest p is 0.016 (φ = 0.05, Z; late half higher by
0.0037 ± 0.0013). The expected smallest of 40 uniform p-values is ≈ 0.024,
so this is unremarkable.

### 3.5 Averaging-window sensitivity

Z from the last 100 / 75 / 50 / 25 % of each seed's equilibrium part (seed
mean ± seed SE):

| configuration | last 100 % | last 75 % | last 50 % | last 25 % |
|---|---|---|---|---|
| kT 0.5, φ 0.05 | 1.1151 ± 0.0003 | 1.1144 ± 0.0004 | 1.1142 ± 0.0007 | 1.1155 ± 0.0014 |
| φ 0.02 | 1.0448 ± 0.0003 | 1.0445 ± 0.0004 | 1.0440 ± 0.0006 | 1.0446 ± 0.0009 |
| φ 0.05 | 1.1150 ± 0.0005 | 1.1164 ± 0.0008 | 1.1169 ± 0.0007 | 1.1148 ± 0.0019 |
| φ 0.1 | 1.2484 ± 0.0009 | 1.2481 ± 0.0010 | 1.2500 ± 0.0017 | 1.2521 ± 0.0034 |
| φ 0.2 | 1.5921 ± 0.0013 | 1.5926 ± 0.0020 | 1.5896 ± 0.0027 | 1.5931 ± 0.0044 |
| uniform-speed | 1.1147 ± 0.0026 | 1.1157 ± 0.0030 | 1.1178 ± 0.0049 | 1.1165 ± 0.0093 |
| uniform-box | 1.1140 ± 0.0013 | 1.1106 ± 0.0023 | 1.1099 ± 0.0021 | 1.1095 ± 0.0122 |
| two-beam | 1.1124 ± 0.0033 | 1.1132 ± 0.0035 | 1.1145 ± 0.0064 | 1.0979 ± 0.0107 |

The windows are nested and therefore strongly correlated, so their CIs
cannot be compared as if they were independent. The formal time-window test is
E2, the seed-paired late-half vs early-half comparison above; it passes. As a
description: for the 200-collision configurations, no window moves Z by more
than 0.30 % (φ = 0.1, last 25 %: 1.2521 ± 0.0034 vs 1.2484 ± 0.0009). For
the 40-collision relaxation halves the largest move is two-beam, last 25 %
(1.0979 ± 0.0107 vs 1.1124 ± 0.0033, −1.3 %).
Plot: `results/plots/thermal_window_sensitivity.svg`.

### 3.6 Convergence with simulation time

The running mean of Z against collisions/particle is plotted per seed (thin)
with the seed mean ± 95 % CI, one plot per configuration:
`results/plots/thermal_Z_convergence_1…8.svg`. The numbering follows the
tables above: 1 kT 0.5; 2–5 φ 0.02, 0.05, 0.1, 0.2; 6–8 uniform-speed,
uniform-box, two-beam. Across all eight plots, the seed-mean running value
lies outside its own running 95 % CI around the final value at 12 of 502
plotted points (2.4 %, below the nominal 5 %). No configuration drifts. The
running 95 % half-width falls from 0.3–0.6 % at ~50 collisions/particle to
0.07–0.18 % at 200. (Running means are cumulative and so correlated; the
formal test is E2.)

### 3.7 Equilibration time

The seed-ensemble mean curve (10 seeds) of each observable is characterised
in two ways. The 1/e time is when its deviation from the late value falls below 1/e
of the initial deviation. The last column is the first time it comes within
3 σ_ens of the late value (σ_ens = window-to-window SD of the ensemble mean in
the late half).

| start | observable | initial | 1/e time | within 3 σ_ens | run length |
|---|---|---|---|---|---|
| uniform-speed | a₂ | −0.486 (79 σ_ens) | 3.1 | 8.9 | 80 |
| uniform-box | a₂ | −0.288 (37 σ_ens) | 2.6 | 6.5 | 80 |
| two-beam | a₂ | −0.498 (90 σ_ens) | 3.5 | 9.3 | 80 |
| two-beam | anisotropy | +0.902 (141 σ_ens) | 1.2 | 5.0 | 80 |
| Maxwell (control) | a₂, anisotropy | within 0.8 σ_ens of equilibrium at t = 0 | — | — | 80 |
| uniform-speed, uniform-box | anisotropy | within 1.6 σ_ens of equilibrium at t = 0 | — | — | 80 |

(All times in collisions per particle.) **Every start relaxes within ~10
collisions/particle, i.e. within the first 12 % of the run.** Plots:
`results/plots/thermal_relaxation_a2.svg`, `…_anisotropy.svg`.

### 3.8 The E6 flag

Pre-registered E6 rule: in every relaxation run, the last window deviating
more than 4σ from that run's late-half mean (σ = the late-half window SD) must
lie in the first half of the run.

- **What was flagged:** exactly one window, 1 of 31 608 late-half windows in
  80 series (4 starts × 10 seeds × {a₂, anisotropy}). It is the uniform-box
  start, seed 25, a₂, window 560 (c = 56.8 collisions/particle), z = +4.68.
  The windows on either side are at z = 2.7 and 3.5. The same window's
  kurtosis also spikes (3.39 against a late mean of 3.03 ± 0.07). That is a
  transient excess of fast particles, a tail fluctuation of a fourth-moment
  statistic. It is not a drift: this seed's late-half a₂ mean (0.012) is the
  highest of the ten, 1.5 SD above the seed mean. The lowest seed (−0.016)
  is 1.6 SD below it. Late-half a₂ is the same for all four starts (ANOVA
  p = 0.935), and the uniform-box a₂ stationarity test passes (p = 0.54).
- **The same statistic fires in runs that start in equilibrium.** The
  Maxwell-start runs begin from the equilibrium distribution, so they are the
  empirical null. Seed 28 goes above 4σ twice: a₂ at c = 20.5–21.1 (up to
  z = 5.18) and anisotropy at c = 30.4–31.4. Both happened to fall in the
  first half, so E6 counted them as "relaxation". Two more such episodes occur
  well after relaxation (uniform-speed s22 at c = 27, uniform-box s29 at
  c = 35).
- **Rate.** There are 5 episodes in the equilibrium parts (c ≥ 20, plus the
  whole Maxwell-start runs), 9.6 × 10⁻⁴ per series per collision/particle.
  Chance episodes expected in the late halves of one start (20 series × 40
  collisions/particle): 0.77. So the probability that E6 flags at least one of
  the four starts **with no relaxation defect at all is ≈ 95 %**. With
  only 5 events the rate is uncertain by about a factor of 2; at the lower
  95 % Poisson limit the probability is still ≈ 63 %. The
  window series are strongly autocorrelated (lag-1 0.81–0.96) and a₂ is
  right-skewed (late-half skewness up to 0.84). Both make > 4σ single
  windows far more common than the i.i.d. Gaussian 6 × 10⁻⁵.
- **Conclusion.** The rule's false-alarm rate grows with seeds × run length.
  For the earlier record (5 seeds, 40-collision relaxation runs) the same rate
  gives ≈ 54 % (it passed then); for 10 seeds × 80 collisions it is ≈ 95 %.
  The criterion is ill-posed, not the relaxation. Per the criteria document
  ("if a criterion turns out to be ill-posed, that is reported, not
  repaired"), E6 stays **NOT CONVERGED**, and the thermal experiment stays
  **INCONCLUSIVE**. The record's own status field reads NOT CONVERGED for the
  same reason. Plot: `results/plots/thermal_e6_diagnosis.svg` (the flagged
  series next to the Maxwell-start control).

**Proposed replacement E6′ (for future runs only, not applied here).**
Divide the late half of each relaxation run into 4 equal blocks. In each
block, compare the 10 per-seed block means of each non-Maxwell start with the
10 per-seed block means of the Maxwell-start control over the same times
(Welch t), for a₂ and anisotropy: m = 3 × 2 × 4 = 24 tests. PASS if every
p > 0.05/24; FAIL if any p < 10⁻⁶; otherwise INCONCLUSIVE. The relaxation
times of §3.7 are reported, not judged. Why this is well posed:

- It uses the equilibrium-start control as the null, rather than a Gaussian
  assumption.
- Block means remove single-window tail events.
- The family-wise false-alarm rate is ≤ 5 % whatever the seed count or run
  length.

`scripts/diagnose-thermal-e6.ts` evaluates E6′ on this record for
information only: smallest p = 0.016 (uniform-box, a₂, block 4), all 24 above
2.1 × 10⁻³. **This does not reclassify this record**, because a criterion
chosen after seeing the data cannot close it. Closing E6 requires committing
E6′ (or another rule) first and judging a fresh, independent seed set with it.

### 3.9 Statistical vs systematic error (thermal)

| source | size | treatment |
|---|---|---|
| statistical (seed ensemble) | Z half-width 0.07–0.18 % (200-collision configurations), 0.26–0.67 % (40-collision relaxation halves) | the 95 % CI; E4 |
| energy ledger (numerical) | 3.4 × 10⁻¹⁴ relative | E1 |
| timestep, particle count, averaging, contact grid (numerical) | < 1 % each for Z at φ = 0.05 | static-box convergence studies (`EXPERIMENT_LOG.md` §1); not repeated here |
| finite-size wall effect (systematic, physical) | measured Z exceeds Henderson by +0.33, +0.60, +0.99, +1.39 % at φ = 0.02, 0.05, 0.1, 0.2. This is 5–8 × the 95 % half-width, so it is real, not noise. At φ = 0.05 it equals the static box's N → ∞ extrapolation shift (1.1154 → 1.1087, +0.6 %) | reported, not corrected, not judged: n = N/A counts the whole box area, and the wall layers matter at N = 2000. It also biases the fitted virial coefficient: B = 2.12 ± 0.01 vs the exact 2 |
| per-run block SE (analysis) | overstates the seed scatter 4–6× | not used for CIs (criteria §1) |

### 3.10 Criteria outcome (thermal)

| ID | outcome | measured |
|---|---|---|
| E1 energy proxy conserved | PASS | 3.40 × 10⁻¹⁴ |
| (existing) no hidden energy scale | PASS | spread 0 over 30 same-class pairs |
| E2 stationarity | PASS | 40/40 tests p > 1.25 × 10⁻³ (smallest 0.016) |
| E3 temperature classes | PASS | ANOVA p = 0.921 |
| E3 initial distribution | PASS | ANOVA p(Z) = 0.904, p(late a₂) = 0.935 |
| E4 precision | PASS | worst half-width 0.670 % < 0.71 % (two-beam) |
| E5 no empty space | PASS | no flag in 130 runs |
| E6 relaxation settled | **NOT CONVERGED** | uniform-box, seed 25, one window at c = 56.8 (§3.8) |

**Thermal equilibrium: INCONCLUSIVE.** Every criterion passes except E6. The
evidence says E6 is a statistical false alarm of an ill-posed rule, not slow
relaxation. The pre-registration forbids repairing a criterion after the
data are in, so the experiment is not called PASS.

## 4. Effective viscosity

Couette channel, φ = 0.1, H = 40, bottom wall at rest, top wall moving at
U = 0.5, full accommodation (Aw = 1), 1000 disks, core fraction 0.6 (the middle 60 % of
the channel), 600 collisions/particle of measurement.
μ_eff = τ / γ: τ is the measured wall shear stress (mean of the two walls'
tangential momentum flux) and γ is the measured core velocity gradient. No
viscosity enters the solver.

### 4.1 Per-seed results

| seed | μ_eff ± per-run SE | τ (wall shear) | γ = du/dy | core fit χ² p | μ first half | μ second half | μ core 0.4 | μ core 0.8 (diag.) |
|---|---|---|---|---|---|---|---|---|
| 71 | 0.2674 ± 0.0374 | 0.00334 | 0.01249 | 0.73 | 0.2684 | 0.2682 | 0.2594 | 0.2787 |
| 72 | 0.3438 ± 0.0293 | 0.00375 | 0.01092 | 0.97 | 0.3774 | 0.3090 | 0.3377 | 0.3573 |
| 73 | 0.3197 ± 0.0329 | 0.00358 | 0.01121 | 0.94 | 0.2760 | 0.3734 | 0.3011 | 0.3131 |
| 74 | 0.3867 ± 0.0322 | 0.00427 | 0.01103 | 0.99 | 0.3881 | 0.3898 | 0.3793 | 0.3769 |
| 75 | 0.3026 ± 0.0286 | 0.00346 | 0.01142 | 0.99 | 0.3243 | 0.2793 | 0.2932 | 0.3093 |
| 76 | 0.4137 ± 0.0539 | 0.00377 | 0.00911 | 0.87 | 0.4322 | 0.3779 | 0.3769 | 0.4068 |
| 77 | 0.3513 ± 0.0414 | 0.00358 | 0.01018 | 0.99 | 0.3466 | 0.3670 | 0.3902 | 0.3297 |
| 78 | 0.2518 ± 0.0368 | 0.00320 | 0.01269 | 0.92 | 0.2631 | 0.2471 | 0.2730 | 0.2541 |
| 79 | 0.4182 ± 0.0466 | 0.00436 | 0.01042 | 0.98 | 0.3781 | 0.4764 | 0.4447 | 0.3997 |
| 80 | 0.3166 ± 0.0417 | 0.00390 | 0.01231 | 0.96 | 0.2803 | 0.3549 | 0.2996 | 0.3539 |
| 81 | 0.3391 ± 0.0399 | 0.00357 | 0.01053 | 0.51 | 0.3051 | 0.3689 | 0.3649 | 0.3359 |
| 82 | 0.3620 ± 0.0388 | 0.00372 | 0.01028 | 0.79 | 0.3910 | 0.3353 | 0.3822 | 0.3603 |
| 83 | 0.3506 ± 0.0406 | 0.00359 | 0.01024 | 0.92 | 0.2996 | 0.3837 | 0.3198 | 0.3460 |
| 84 | 0.3293 ± 0.0342 | 0.00363 | 0.01103 | 0.98 | 0.2771 | 0.3871 | 0.2976 | 0.3263 |
| 85 | 0.3734 ± 0.0370 | 0.00374 | 0.01002 | 0.57 | 0.3624 | 0.3569 | 0.3015 | 0.3728 |
| 86 | 0.3236 ± 0.0354 | 0.00334 | 0.01033 | 0.99 | 0.2810 | 0.3624 | 0.3416 | 0.3157 |
| 87 | 0.3849 ± 0.0481 | 0.00343 | 0.00890 | 0.37 | 0.4613 | 0.3012 | 0.4463 | 0.3471 |
| 88 | 0.3679 ± 0.0338 | 0.00402 | 0.01093 | 0.89 | 0.3951 | 0.3415 | 0.3841 | 0.3656 |
| 89 | 0.2990 ± 0.0377 | 0.00348 | 0.01163 | 0.65 | 0.3265 | 0.2651 | 0.3543 | 0.2994 |
| 90 | 0.3566 ± 0.0296 | 0.00383 | 0.01074 | 0.67 | 0.3275 | 0.3992 | 0.3961 | 0.3572 |
| 91 | 0.2500 ± 0.0294 | 0.00299 | 0.01194 | 0.78 | 0.2486 | 0.2523 | 0.2257 | 0.2590 |
| 92 | 0.3537 ± 0.0418 | 0.00360 | 0.01018 | 1.00 | 0.4003 | 0.3189 | 0.3650 | 0.3341 |
| 93 | 0.3327 ± 0.0301 | 0.00367 | 0.01102 | 0.99 | 0.3313 | 0.3305 | 0.3320 | 0.3317 |
| 94 | 0.2835 ± 0.0268 | 0.00326 | 0.01150 | 0.96 | 0.2759 | 0.2793 | 0.3082 | 0.2817 |
| 95 | 0.2973 ± 0.0322 | 0.00349 | 0.01174 | 1.00 | 0.3170 | 0.2913 | 0.3027 | 0.3029 |
| 96 | 0.3025 ± 0.0310 | 0.00355 | 0.01172 | 0.65 | 0.3085 | 0.3175 | 0.3000 | 0.2977 |
| 97 | 0.3115 ± 0.0389 | 0.00329 | 0.01056 | 0.74 | 0.3093 | 0.3121 | 0.3717 | 0.3028 |
| 98 | 0.3791 ± 0.0463 | 0.00358 | 0.00945 | 0.68 | 0.3265 | 0.4247 | 0.4101 | 0.3522 |
| 99 | 0.3070 ± 0.0373 | 0.00336 | 0.01093 | 0.54 | 0.3145 | 0.3061 | 0.2766 | 0.3016 |
| 100 | 0.3027 ± 0.0286 | 0.00408 | 0.01347 | 1.00 | 0.3164 | 0.2874 | 0.3013 | 0.3149 |

### 4.2 Aggregate, CI and between-seed variation

| quantity | value |
|---|---|
| μ_eff (seed mean) | **0.3326** |
| variance / SD | 1.86 × 10⁻³ / 0.0432 |
| SE | 0.00788 |
| 95 % CI (t, 29 dof) | [0.3165, 0.3487], **± 4.85 %** |
| between-seed CV | 13.0 % |
| seed consistency (χ² with per-run SEs, V4) | p = 0.098 — per-run SEs describe the scatter |
| τ | 0.003613 ± 0.000055 (± 3.1 % 95 %) |
| γ | 0.010964 ± 0.000188 (± 3.5 % 95 %) |
| slip at walls | 0.029 ± 0.004 (bottom), 0.033 ± 0.005 (top), of U = 0.5 |
| core kT (viscous heating steady state) | 1.011 |
| mean free path / Knudsen number | 2.32 / 0.058 |
| Re_sim / Re_eff | 7.66 / 6.72 |
| Chapman–Enskog + Enskog hard-disk viscosity (external comparison) | 0.3156 → measured / benchmark 1.054 |

### 4.3 Velocity profile and fit quality

`results/plots/viscosity_profile.svg` shows the 20-bin profile, seed mean
± 95 % CI, with the core fit. Every one of the 30 runs has a linear core
profile: weighted linear fit χ² p ≥ 0.37 (V2 needs > 0.001). Outside the core
the profile bends into the Knudsen layers, with slip ≈ 6 % of U at each wall.

### 4.4 Dependence on the averaging window

- **Time window (V5).** First half 0.3303 ± 0.0097, second half
  0.3355 ± 0.0099. Seed-paired difference +0.0052 ± 0.012, p = 0.666.
- **Spatial window (V6).** Core fraction 0.4 / 0.6 / 0.8 gives
  0.3379 ± 0.0099 / 0.3317 ± 0.0077 / 0.3295 ± 0.0069. Paired 0.4 − 0.6:
  p = 0.266. Paired 0.8 − 0.6: p = 0.377, a diagnostic only, because 0.8 reaches
  into the Knudsen layers.
- Plot: `results/plots/viscosity_window_sensitivity.svg`.

### 4.5 Convergence with simulation time

Cumulative μ_eff over blocks 1…k, seed mean ± SE (95 % half-width):

| collisions/particle | 75 | 150 | 225 | 300 | 375 | 450 | 525 | 600 |
|---|---|---|---|---|---|---|---|---|
| μ_eff | 0.3198 ± 0.0202 | 0.3259 ± 0.0127 | 0.3280 ± 0.0102 | 0.3303 ± 0.0097 | 0.3366 ± 0.0092 | 0.3343 ± 0.0083 | 0.3382 ± 0.0086 | 0.3317 ± 0.0077 |
| 95 % half-width | 12.9 % | 8.0 % | 6.4 % | 6.0 % | 5.6 % | 5.1 % | 5.2 % | 4.7 % |

Every value lies inside the final 95 % CI. The half-width falls roughly as
1/√t. Plots: `results/plots/viscosity_mu_convergence.svg` (per seed +
ensemble), `…_mu_per_block.svg` (each block on its own),
`…_per_seed.svg`.

(The 600-collision cumulative value, 0.3317, uses equal-weight block
profiles. The headline 0.3326 fits the whole-run profile with per-bin
weights. The two estimators differ by 0.3 %.)

### 4.6 Numerical uncertainty

- **Timestep (V7).** Courant 0.05 with 30 independent seeds (101–130) gives
  0.3220 ± 0.0070, against 0.3326 ± 0.0079 at Courant 0.025. The difference is
  −0.0106 ± 0.0105, z = −1.01. There is no detectable timestep effect; at 95 % a
  timestep effect larger than ~9 % is excluded. The Courant-0.05 run passes
  every other criterion too (fit p ≥ 0.047, halves p = 0.27, core p = 0.41).
- **Conservation.** Energy ledger 1.2 × 10⁻¹³, momentum ledger 5.9 × 10⁻¹⁵
  (relative). Steady state: wall stresses equal and opposite
  (z = −0.06); input work equals wall heat removal (z = 0.30) (V1).
- **Ratio-estimator bias.** μ = τ/γ has a noisy denominator, so a per-run
  ratio is biased high by ≈ var(γ)/γ². With the per-run γ scatter of 9.4 %
  this is +0.9 %. It matches the measured difference between the mean of
  per-seed ratios (0.3326) and the ratio of means τ̄/γ̄ (0.3296). It is a
  systematic of the estimator, 5× smaller than the statistical half-width. It
  grows for short windows: single 75-collision blocks average 0.346. That is
  why V5 compares halves of equal length, and why μ is not quoted from single
  blocks.

### 4.7 Statistical vs systematic error (viscosity)

| source | size | treatment |
|---|---|---|
| statistical (seed ensemble) | ± 4.85 % (95 %) | the CI; V8 |
| timestep | −3.2 % ± 3.2 % (not significant) | V7 |
| averaging window (time / space) | +1.6 % ± 3.6 % / +1.9 % ± 1.7 % (paired, not significant) | V5 / V6 |
| ratio-estimator bias | +0.9 % | reported, not corrected |
| Knudsen layers / finite channel (Kn = 0.058) | core 0.8 vs 0.6: −0.7 % (not significant); slip ≈ 6 % of U per wall | μ_eff is a channel property at this Kn; the H- and φ-sweeps (`viscosity_sweeps.json`, not rerun) cover the dependence |
| resolution / particle scale | not rerun here | `viscosity_sweeps.json` (radius 0.35 case), `EXPERIMENT_LOG.md` §6 |

### 4.8 Criteria outcome (viscosity)

| ID | outcome | measured |
|---|---|---|
| V1 steady state | PASS | momentum \|z\| 0.06, energy \|z\| 0.30 |
| V2 core profile linear | PASS | min χ² p = 0.373 over 30 runs |
| V3 emergent (μ > 0) | PASS | CI [0.3165, 0.3487] |
| V4 seed-reproducible | PASS | χ² p = 0.098 |
| V5 time-stable | PASS | paired p = 0.666 |
| V6 window-insensitive | PASS | paired p = 0.266 |
| V7 timestep | PASS | z = −1.01 |
| V8 precision | PASS | ± 4.85 % < 10 % |

**Effective viscosity: PASS.** μ_eff = 0.3326, 95 % CI [0.3165, 0.3487], at
φ = 0.1, H = 40, U = 0.5, Aw = 1, kT ≈ 1.01. It is reproducible across 30
seeds, stable in time and window, and timestep-independent within ± 9 %. It is
5 % above the Enskog hard-disk benchmark; that comparison is external and
not judged. The result does not revisit the earlier sweep findings (H = 80
non-linear profile, Kn > 0.1 cases), which were not rerun.

## 5. Files

- Records: `results/thermal_reference.json`, `results/viscosity_reference.json`,
  `results/viscosity_courant-0.05.json` (replace the earlier 5-seed records,
  which remain in git history).
- Report: `results/report_thermal_viscosity.txt` (all per-seed tables),
  `results/plots/report_thermal_viscosity.json` (classification).
- E6 diagnosis: `results/thermal_e6_diagnosis.txt`, `…json`,
  `results/plots/thermal_e6_diagnosis.svg`.
- Plots (`results/plots/`): `thermal_Z_convergence_1…8.svg`,
  `thermal_relaxation_a2.svg`, `thermal_relaxation_anisotropy.svg`,
  `thermal_window_sensitivity.svg`, `thermal_e6_diagnosis.svg`,
  `viscosity_profile.svg`, `viscosity_mu_convergence.svg`,
  `viscosity_mu_per_block.svg`, `viscosity_per_seed.svg`,
  `viscosity_window_sensitivity.svg`.
- Provenance: `results/logs/item1_run.sh`, `results/logs/item1_timings.txt`.

## 6. Open

- **E6.** E6′ is now pre-registered (`CRITERIA_THERMAL_VISCOSITY.md` §6),
  together with the validation plan: fresh seeds 31–40, same configuration.
  Until that validation has been run and reported, thermal equilibrium stays
  INCONCLUSIVE.
- **Observation, not tested.** In the 40-collision relaxation halves, the
  between-seed SD of Z is 0.0082 (uniform-speed) and 0.0104 (two-beam). That
  is 2–3× the 0.0040 of uniform-box, which is itself what the φ = 0.05
  200-collision SD predicts for a 40-collision window (0.0017·√5 ≈ 0.0038).
  One possibility is slow box-scale pressure oscillations excited by the
  strongly non-Maxwellian starts. It does not affect any criterion (E3 ANOVA
  p = 0.90, E4 passes), but it is why E4's margin is thin for two-beam.
