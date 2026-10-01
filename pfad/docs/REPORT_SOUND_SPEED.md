# Phase 0 item 2: small-amplitude sound speed — validation report

**Classification under the pre-registered criteria: PASS.**

The PFAD particle medium carries a small density disturbance at a finite,
reproducible speed. The speed does not depend on any numerical or geometric
setting tested. The pre-registered zero-amplitude speed is
**c₀ = 2.170 ± 0.038**, 95 % CI [2.094, 2.246] (± 3.5 %), in model units
(disk mass 1, diameter 1, kT = 1).

Two findings sit beside the classification and are reported, not repaired:

- **Extrapolation model (§6).** Post hoc, the linear extrapolation to zero
  amplitude turns out to be leveraged by the precise large-amplitude points.
  Three independent post-hoc estimates put the small-amplitude speed near
  2.26 rather than 2.17. That is a model systematic of ≈ 4 % that the
  pre-registered CI does not contain.
- **The control (§5).** The zero-amplitude control passes S1 as committed.
  Equilibrium thermal noise nevertheless carries a strong propagation
  signature at the same speed. S1 does not test for it: it tests the
  seed-averaged signal, in which random-phase thermal sound cancels.

## 1. Pre-registration and runs

| | |
|---|---|
| criteria | `docs/CRITERIA_SOUND_SPEED.md` |
| pre-registration commit | **`04e0826307f1aac8a4c2f125a6357dfce229d0c3`**, pushed before any validation run. An earlier design draft, `4a116b1`, is explicitly not the pre-registration. |
| run | worktree pinned to `04e0826`; hash in `results/logs/sound_validation_timings.txt` |
| command | `npx tsx scripts/run-experiment.ts sound-speed-validation --parallel 4 --out results --name sound-speed_validation` |
| runtime | 15 604 s (4 h 20 min; 07:29:51–11:49:55 UTC, 2026-10-01), 4 worker threads on a 4-core cloud container, 544 runs |
| seeds | fresh 6001–6064: 64 for the 5 amplitudes and the control, 6001–6032 for the judged variants, 6001–6016 for the reported variants |
| report | `npx tsx scripts/report-sound-speed.ts results/sound-speed_validation.json results/plots/sound_speed` → `results/report_sound_speed.txt` (pre-registered script, run at `04e0826`; regenerated identically from the main tree) |
| post-hoc diagnostics | `npx tsx scripts/posthoc-sound-speed.ts results/sound-speed_validation.json results/sound-speed_validation_posthoc.json results/plots/sound_speed`, written after the data were seen and never used for the classification |

Design pilots used only seeds 5001–5008, 5101–5108 and 5201–5208 (criteria
§12).

## 2. What was measured

**Medium.** Universe A: rigid elastic disks, no occupancy force, φ = 0.2,
kT = 1, radius 0.5. Periodic box 600 × 120, ≈ 18 400 disks.

**Physics.** `SoundRun` is `PulseRun` with a different measurement. A test
checks that the particle state is bit-identical. No sound-speed parameter,
equation of state or wave model is anywhere in the run or the analysis.

**Disturbance.**

1. The gas relaxes for 15 time units.
2. Velocities are rescaled once to kT = 1.
3. At t = 0, extra disks are added by random sequential addition in the
   central slab |x − 300| < 10. They make a fractional density excess A, are
   Maxwellian at the current kT, and are then released.

The realized amplitudes were 0.399, 0.299, 0.200, 0.0998 and 0.0507.

**Signal.** The outward momentum density j(d, t), folded about the slab. It
was recorded every 0.5 time units at 17 probes, d = 30, 40, …, 190, each
10 wide. The window ends at 120.

**Primary estimator** (fixed in advance): stacked-template
cross-correlation.

1. A cross-power slant stack gives the most coherent moveout.
2. Each probe's template is the aligned stack without that probe.
3. Each probe's delay is the cross-correlation maximum against its template.
4. The speed is 1/slope of delay against distance.
5. The uncertainty is a delete-1 jackknife over seeds; differences and the
   extrapolation are jackknifed jointly.

Plots, all in `results/plots/sound_speed/`:

- x–t diagrams: `xt_*.svg`;
- probe waveforms: `waveforms_*.svg`;
- arrival delay against distance: `arrival_*.svg`.

## 3. Results

### 3.1 Amplitude series (64 seeds each)

All 5 amplitudes are detected and unambiguous; none is noise-dominated and
none was dropped. All seed counts are 64.

| A | c ± SE | 95 % CI | seed-to-seed SD* | stack SNR | probes ≥ 3σ | R² (delay vs d) | curvature z |
|---|---|---|---|---|---|---|---|
| 0.4 | 2.3935 ± 0.0159 | [2.362, 2.425] | 0.127 | 56.0 | 17/17 | 0.99958 | 2.18 |
| 0.3 | 2.3276 ± 0.0219 | [2.284, 2.371] | 0.175 | 44.4 | 17/17 | 0.99967 | 1.38 |
| 0.2 | 2.2545 ± 0.0277 | [2.199, 2.310] | 0.221 | 29.6 | 17/17 | 0.99921 | 1.27 |
| 0.1 | 2.2637 ± 0.0487 | [2.166, 2.361] | 0.390 | 15.5 | 17/17 | 0.99869 | 0.08 |
| 0.05 | 2.3202 ± 0.123 | [2.074, 2.567] | 0.987 | 8.1 | 17/17 | 0.99851 | −0.07 |

\*SD of the jackknife pseudo-values: the spread a single seed's estimate
would have.

**Linear response.** The stacked pulse height per unit amplitude is 0.068,
0.070, 0.071, 0.073 and 0.076 for A = 0.4 … 0.05. That is linear to within
≈ 10 %, with a slight saturation at large A.

### 3.2 Zero-amplitude extrapolation (S5, S6)

- **Set.** All five amplitudes; the top-down rule dropped none.
- **Fit.** c(A) = c₀ + k·A, weighted by jackknife SEs:
  - **c₀ = 2.1701 ± 0.0380**, 95 % CI [2.0942, 2.2460], half-width 3.50 %
    (criterion < 5 %);
  - slope k = 0.546 ± 0.11. The speed rises with amplitude: finite-amplitude
    propagation, detected at ≈ 5σ;
  - c(A) curvature z = 1.17 (criterion < 3); χ² = 2.62 with 3 dof (diagonal
    SEs, reported).
- **Pre-registered sensitivity.** The three smallest amplitudes alone give
  c₀ = 2.292 ± 0.098.

### 3.3 Seed reproducibility (S7) and seed-to-seed variation

- **Split halves** (odd and even seed index, 32 seeds each, full analysis):
  c₀ = 2.177 ± 0.053 and 2.190 ± 0.092, z = −0.12.
- **Four independent groups** of 16 seeds: c₀ = 2.135, 2.173, 2.225, 2.156,
  SD 0.038.
- **Right side against left side** (reported):
  - A = 0.4: 2.386 ± 0.038 and 2.392 ± 0.032;
  - A = 0.1: 2.230 ± 0.062 and 2.374 ± 0.10.

### 3.4 Distance linearity and probe placement (S4)

Arrival time is linear in distance at every amplitude: R² = 0.9985–0.9997,
and every |curvature z| < 3.

At A = 0.4, the inner probes (30–110) give 2.43 ± 0.07 and the outer probes
(110–190) give 2.32 ± 0.05. The pulse decelerates as it weakens, as a
finite-amplitude pulse should; the curvature z of 2.18 is not significant.
At A = 0.1 the inner and outer probes give 2.36 ± 0.15 and 2.40 ± 0.09, and
at A = 0.05 they give 2.23 ± 0.16 and 2.25 ± 0.71: no placement dependence.

Pairwise probe speeds are in `results/report_sound_speed.txt`. Over the full
span (30 → 190), A = 0.4 gives 2.39 ± 0.01, A = 0.1 gives 2.33 ± 0.05 and
A = 0.05 gives 2.29 ± 0.13.

### 3.5 Convergence and invariance at A_ref = 0.4 (S8, S9)

Each row is the relative difference from the reference case, with its 95 %
CI from a joint jackknife.

| test | difference [95 % CI] | outcome |
|---|---|---|
| probe width 4 vs 10 | +0.65 % [−1.15, 2.45] | PASS |
| probe width 20 vs 10 | −0.64 % [−2.08, 0.79] | PASS |
| sampling 1.0 vs 0.5 | −0.28 % [−2.93, 2.38] | PASS |
| window end 110 vs 120 | −0.10 % [−0.80, 0.59] | PASS |
| timestep: Courant 0.05 vs 0.025 (32 seeds) | +0.79 % [−2.65, 4.23] | PASS |
| domain length L = 900 vs 600 (32 seeds) | +0.13 % [−3.46, 3.72] | PASS |
| strip height H = 240 vs 120, twice the particle count (32 seeds) | +0.20 % [−2.17, 2.56] | PASS |
| particle radius 0.35, H = 60, twice the particles per area (32 seeds) | +0.40 % [−3.09, 3.90] | PASS |
| *velocity kick U = 0.4 (16 seeds, reported)* | −0.82 % [−7.65, 6.02] | *imprecise* |
| *slab width 40 (16 seeds, reported)* | +4.18 % [0.69, 7.66] | *a real difference* |

**Doubling the strip height.** Twice the particles per probe means half the
noise variance. The wave does not disappear: the stacked pulse height is
2.80 × 10⁻², against 2.72 × 10⁻² at H = 120. The noise falls (seed-to-seed
SD 0.041 against 0.127) and the speed is unchanged.

**The wider slab is faster at A = 0.4.** Twice the mass in the pulse decays
more slowly, so the finite-amplitude speed increment lasts longer. This is a
shape-dependence of the *finite-amplitude* speed, and it is why that variant
was registered as reported only.

### 3.6 Boundaries and reflections (S10)

- **No wrapped wave in the window.** The pulses reach the antipode (d = 300)
  only after t ≈ 125. The earliest possible wrapped arrival at the outermost
  probe is t ≥ 149, against a window end of 120, using c + 3 SE and the
  measured rise time.
- **L = 900 gives the same speed** (+0.13 %).
- **No inward wave is detected.** Interior inward maxima appear only at
  A = 0.2 (inward speed 3.31, SNR 6.6, cross-power ratio 0.15), A = 0.1 (SNR
  4.3, ratio 0.14) and A = 0.05 (SNR 3.1, ratio 0.23). All are far below the
  ratio of 0.5 that a competing wave of comparable strength would need. The
  A = 0.2 candidate is seed-coherent but weak (15 % of the outward cross
  power); it is listed, not explained.
- **Wall interaction:** none (periodic box).
- **Interference** of the two outward pulses cannot occur at the probes.

### 3.7 Features reported separately (never judged)

| A | primary | momentum peak | front (½ max) | tail (½ max) | density peak | kinetic-stress peak |
|---|---|---|---|---|---|---|
| 0.4 | 2.394 | 2.296 ± 0.020 | 2.528 ± 0.019 | 2.080 ± 0.031 | 2.352 ± 0.020 | 2.341 ± 0.020 |
| 0.3 | 2.328 | 2.258 ± 0.028 | 2.479 ± 0.031 | 2.068 ± 0.037 | 2.297 ± 0.053 | 2.315 ± 0.033 |
| 0.2 | 2.255 | 2.214 ± 0.049 | 2.378 ± 0.048 | 2.076 ± 0.094 | 2.244 ± 0.070 (11 probes) | 2.233 ± 0.055 |
| 0.1 | 2.264 | 2.225 ± 0.20 (16) | 2.250 ± 0.19 (16) | 2.208 ± 0.23 (16) | — | 2.332 ± 0.19 (8) |
| 0.05 | 2.320 | — | — | — | — | — |

**Front and tail.** At large amplitude the front moves faster than the tail
(2.53 against 2.08 at A = 0.4): the pulse spreads, and its compression front
runs ahead. At A = 0.1 the front, peak and tail converge (2.25, 2.23,
2.21). This identifies the nonlinear (finite-amplitude) behaviour separately;
no shock or second wavefront appeared. The rarefaction feature was not
significant at any probe.

**Slant-stack moveout speed** (reported): 2.401, 2.345, 2.268, 2.278, 2.338.

## 4. Criteria outcome

| ID | outcome | measured |
|---|---|---|
| safety | PASS | no run halted (warnings: §7) |
| energy ledger | PASS | max 4.9 × 10⁻¹⁴ |
| empty space | PASS | no flag |
| S1 control | PASS | outward stack SNR 1.80, inward 3.57, max probe 3.43 (all < 5) |
| S2 detection | PASS | all five amplitudes |
| S3 unambiguous | PASS | all five |
| S4 distance linearity | PASS | R² ≥ 0.9985, \|z\| ≤ 2.18 |
| S5 extrapolation | PASS | five amplitudes, curvature z 1.17 |
| S6 precision | PASS | 3.50 % |
| S7 split halves | PASS | z = −0.12 |
| S8 probe width, sampling, window, timestep | PASS | all within ±1 %; CIs inside ±5 % |
| S9 domain length, strip height, particle radius | PASS | all within ±0.4 %; CIs inside ±5 % |
| S10 reflection exclusion | PASS | wrapped ≥ 149 > 120; no inward wave |

**PASS.** Every judged criterion is met: the medium has a stable,
reproducible, numerically converged propagation speed. Two qualifications
follow (§5, §6); they qualify the number and the meaning of S1, not the
classification under the committed rules.

## 5. The control (A = 0): what it does

**S1 as committed (seed-averaged signal).**

- No disturbance-locked signal: outward aligned-stack SNR 1.80, inward 3.57.
- Per-probe max |seed-mean j|/σ ranges from 1.96 to 3.43 over the 17 probes.
- The primary analysis applied to the control detects nothing (2/17 probes
  significant) and is unstable under leave-one-out.
- The x–t diagram (`xt_control_A_0.svg`) shows noise with faint diagonal
  streaks in both directions.
- **S1 PASS.**

**Does equilibrium noise produce a detectable propagation signature? Yes.**
This is post hoc and not part of S1. Computing the slant-stack cross power
seed by seed and then averaging (`posthoc_equilibrium_noise.svg`) gives:

| direction | hump speed | peak z (mean / SE across 64 seeds) |
|---|---|---|
| outward | **2.275 ± 0.016** | 22.7 |
| inward | **2.244 ± 0.015** | 18.7 |

The speed is the vertex of a quadratic over the hump, which is robust to the
interpolation ripple at exact sample alignments, with a jackknife over 64
seeds. There is no other coherent moveout. The two directions agree
(difference 0.031 ± 0.022) and match the direct small-amplitude pulse
speeds. Thermal fluctuations of the medium are themselves sound waves running
both ways.

**The conflict.**

- **What S1 tests.** Its committed statistic is the seed average of the
  control signal. That is the right test for what it was built to catch: a
  disturbance-locked artefact, such as a coherent pulse produced by the
  velocity rescale or the phase handover, which would repeat in every seed.
- **What its rationale says.** "No disturbance, no signal; a signal without a
  disturbance is an artefact" is too broad. Without any disturbance the
  medium carries propagating signals at the sound speed, with random phase.
  They cancel in the seed average, so S1 does not see them.
- **The classification stands.** By the committed rule, S1 is PASS, because
  its statistic is below threshold. The criterion's wording is not repaired;
  its scope is stated here. S1 shows that the control has no seed-reproducible
  signal. It does not show that the undisturbed medium is silent.
- **This corroborates the measurement.** The undisturbed medium propagates
  fluctuations at 2.24–2.28, the same speed the small disturbances travel at.
- **No contamination.** The disturbed runs share these noise backgrounds:
  same seeds, and phase 1 identical to the control's. The noise is
  zero-mean over seeds, inflates the jackknife errors rather than biasing
  the seed-averaged signals, and is handled by the joint jackknife.

## 6. Zero-amplitude value: extrapolation-model dependence (post hoc)

The pre-registered model, linear in A over all detected amplitudes, gives
2.170 ± 0.038. The fit is dominated by A = 0.3 and 0.4, the most precise
points. The curvature test had little power: the SE of the quadratic
coefficient is large. Post-hoc alternatives
(`posthoc_extrapolation_models.svg`):

| estimate (post hoc unless marked) | value |
|---|---|
| linear, all five (**pre-registered**) | 2.170 ± 0.038 |
| quadratic, all five | 2.282 ± 0.105 |
| linear without A = 0.4 | 2.204 ± 0.058 |
| linear, three smallest | 2.292 ± 0.098 |
| weighted mean of c at A ≤ 0.2 | 2.259 ± 0.023 |
| weighted mean of c at A ≤ 0.1 | 2.271 ± 0.049 |
| equilibrium-noise moveout (§5) | 2.275 ± 0.016 out, 2.244 ± 0.015 in |

The measured speeds at A = 0.05–0.2 show no amplitude dependence among
themselves, and the noise moveout is an infinitesimal-amplitude speed. Both
point to a zero-amplitude speed near 2.26. The pre-registered value is 4 %
lower, and its CI upper bound (2.246) sits just below 2.26.

The likely reason: c(A) is flat below A ≈ 0.2 and rises above it, so a
straight line through all five amplitudes undershoots at A → 0. With these
data the curvature test could not detect that (z = 1.17).

**Treatment.** c₀ = 2.170 [2.094, 2.246] is the pre-registered result and is
reported as such. A systematic uncertainty from the extrapolation model, of
order +0.05 to +0.12 (2–5 %), is **not** in that interval. Uses of c_p, for
example Mp = V/c_p, should carry it. A pre-registered small-amplitude-only
follow-up would narrow it. No such run was made.

## 7. Numerical warnings

**What was flagged.** The record has 211 safety warnings and no failures.
134 runs had 1–3 overlapping disk pairs at the start of phase 2; 77 of them
then logged a "late contact without a preceding event" at the first safety
check (step 10, t ≈ 0.04–0.1).

**Cause.** This was checked on design seeds. The rigid-contact scheme detects
a collision as an overlap after a move and rewinds it. A collision in flight
at the end of phase 1 is handed to the fresh phase-2 simulation, which sees
an "initial overlap" and resolves it within its first steps.

**Why it is benign.** It is identical in the control, which has no insertion,
and in the disturbed runs. It is pre-existing `PulseRun` behaviour: the
earlier records show the same warnings (`sound-speed_reference.json` 2 + 2,
`sound-speed_sweeps.json` 58 + 13). It affects at most a few collisions out
of millions, at t ≈ 0, ≥ 30 distance units from every probe. The energy
ledger closes to 5 × 10⁻¹⁴ throughout.

**Not fixed here.** Changing it would alter the physics code path after the
data were taken.

## 8. External benchmarks (comparison only, after the measurement)

All values use the Henderson hard-disk equation of state at φ = 0.2. None of
them was used anywhere in the run, analysis or criteria.

- 2D ideal gas √(2kT/m) = 1.414
- hard-disk isothermal √((kT/m)(Z + φZ′)) = 1.540
- hard-disk adiabatic √((kT/m)(Z + φZ′ + Z²)) = **2.199**

The measured c₀ = 2.170 [2.094, 2.246] includes the adiabatic value (−1.3 %).
The small-amplitude and noise estimates near 2.26 are 2.6–3.4 % above it. In
the static box this record's equation of state also sits slightly above
Henderson, the finite-size effect of `EXPERIMENT_LOG.md` §1. The particle
medium behaves like the adiabatic hard-disk fluid, not like an ideal or
isothermal gas.

## 9. Files

- **Record:** `results/sound-speed_validation.json` (17.6 MB). It contains
  the per-seed probe series of every amplitude case and the control,
  ensemble x–t fields, per-case analyses with leave-one-out values, and the
  checks.
- **Reports:**
  - `results/report_sound_speed.txt`;
  - `results/plots/sound_speed/report_sound_speed.json`;
  - post hoc: `results/sound-speed_validation_posthoc.json`.
- **Plots** (`results/plots/sound_speed/`):
  - x–t diagrams: `xt_A_0.4 … xt_A_0.05`, `xt_control_A_0`;
  - waveforms: `waveforms_*` for each amplitude and the control;
  - arrival delay against distance: `arrival_*` for each amplitude;
  - speed against amplitude: `speed_vs_amplitude`;
  - invariance tests: `invariance`;
  - stack power against trial speed: `stack_power`;
  - seed halves and groups: `seed_halves_groups`;
  - post hoc: `posthoc_equilibrium_noise`, `posthoc_extrapolation_models`.
- **Provenance:** `results/logs/sound_validation_run.sh`,
  `sound_validation_timings.txt`, `sound_validation_console.txt`.

## 10. Physics model

**No physics model was changed.**

- `SoundRun` subclasses `PulseRun`, and a test shows a bit-identical particle
  state. The only edit to `PulseRun` exported the class and made private
  members protected.
- The rigid-disk collision law, integrator, equilibration, rescale and
  insertion are those of the earlier pulse experiments.
- The additions are measurement and analysis code only.
