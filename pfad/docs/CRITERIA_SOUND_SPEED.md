# Acceptance criteria: small-amplitude sound speed (Phase 0 item 2)

**Pre-registration.** This document, the experiment configuration
(`SOUND_VALIDATION` in `src/experiments/SoundSpeedExperiment.ts`), the
analysis code (`src/measurements/ArrivalAnalysis.ts`,
`src/experiments/SoundSpeedAnalysis.ts`) and the report script
(`scripts/report-sound-speed.ts`) were committed and pushed **before** the
validation dataset (seeds 6001–6064) was generated. The commit hash is
recorded in the run log and the report. After that commit:

- no threshold, rule, estimator or configuration value is changed;
- if a criterion turns out to be ill-posed, that is reported, not repaired.

## 1. Question

Does the PFAD particle medium carry a small pressure/density disturbance at
a finite, reproducible speed? The speed must be measured from the particle
simulation itself, as propagation distance divided by propagation time, in
the small-amplitude limit.

No sound-speed parameter, equation of state or wave model enters:

- the run, which is Universe A (rigid elastic disks, collisions only), with
  physics unchanged;
- the analysis, where the only speeds are inverse slopes of measured arrival
  time against measured distance;
- any criterion, none of which compares with an expected value.

Conventional gas-dynamics values appear only in the record's `benchmarks`,
computed after the measurement and labelled external (§11).

## 2. What the specification defines

- **Bible §12.** Run a pressure-pulse experiment and measure c_p; repeat over
  density, temperature, resolution, stiffness, occupancy and universe.
  Record c_p and Mp = V/c_p.
- **Master prompt §14.** Create a localized compression, release it, and
  measure propagation with "cross-correlation or another statistically
  robust estimator". Return c_p, its uncertainty, front shape, attenuation
  and dispersion.

Neither gives a numeric precision or acceptance threshold. Every number below
is a PFAD choice and states its reason.

The earlier pulse experiments (`results/sound-speed_*.json`) remain
INCONCLUSIVE and are not reinterpreted:

- the tracked speed depended on amplitude and width;
- the zero-amplitude limit was not established;
- one model case was ambiguous.

Item 2 is a new, dedicated experiment.

## 3. Medium and run (physics unchanged)

`SoundRun` subclasses the existing `PulseRun` and overrides only the
measurement. A test checks that the particle state of both is bit-identical
(`tests/experiments.soundspeed.test.ts`).

- **Medium:** Universe A, rigid elastic disks, φ = 0.2, kT = 1, m = 1,
  radius 0.5. At φ = 0.2 the mean free path is about one diameter, so a
  20-wide pulse is about 20 mean free paths: a hydrodynamic disturbance.
- **Domain:** periodic box, L × H = 600 × 120 (≈ 18 300 disks).
- **Phase 1:** the uniform gas relaxes for 15 time units (~ 50 collision
  times) from random sequential placement. Local structure relaxes within a
  few collision times. Peculiar velocities are then
  rescaled once to kT = 1 (A-04, unchanged).
- **Phase 2, the disturbance** (t = 0): extra particles, a fractional excess
  A of the local number, are added by random sequential addition among the
  existing ones in the central slab |x − L/2| < w/2, with w = 20. They are
  Maxwellian at the current kT, and the run continues for 120 time units.
- **Timestep:** adaptive, Courant 0.025, dt ≤ 0.05 (the reference value of
  the earlier pulse experiments). Rewind-to-contact collisions.

**Why this disturbance.** It is the Master prompt's "localized density
compression, released", and it is applied to an already equilibrated medium.
It imposes no velocity field, no forcing and no wave shape. It leaves:

- two outward pulses, whose speed is the measurement;
- a stationary entropy mode at the source: an excess density with no momentum.

A velocity kick (±U outward, U = 0.4) is run as an alternative disturbance
(§8, reported). An equilibrium-in-a-potential-well release was considered and
rejected: the far field of a long box needs ~ 10⁴ time units to equilibrate
around the well.

## 4. Measurement

Every 0.5 time units, on a fixed grid (each sample is taken within one step
of k·0.5), disks are binned in 2-wide bins across the box. The signals are
folded about the slab centre, so that d is the distance from it and outward
is positive on both sides:

- **j(d, t):** outward momentum density, the primary signal;
- **δn(d, t):** number-density excess;
- **δs(d, t):** kinetic x-stress excess, Σ m v_x² per area minus the box mean.

The two sides j_R and j_L are also kept separately.

**Probes.** 17 probes at d = 30, 40, …, 190, each 10 wide (contiguous,
non-overlapping). The first probe lies 20 beyond the slab edge. Widths 4
and 20 are re-analysis variants. The pulse leaves the source by d ≈ 20; the
wrapped wave from the periodic image cannot reach d = 190 within the window
(§9).

**Primary signal: outward momentum density.** The entropy mode carries no
momentum, so j sees only travelling disturbances. In the density signal δn,
the entropy mode is a stationary excess at the source.

## 5. Primary feature and estimator (fixed before the validation data)

**Primary feature:** the arrival of the outward momentum pulse at each probe.
It is measured by **stacked-template cross-correlation** (Master prompt §14).

**Inputs.** E_k(t) is the seed-mean j at probe k (probe distance d_k). The
analysis window is t ≤ 120.

**Steps.**

1. **Slant stack.** For trial slownesses s = 0.02 … 2 (step 0.0025),
   compute the cross power P(s) = Σ_t [(Σ_k x_k)² − Σ_k x_k²], with
   x_k = E_k(t + s·(d_k − d_1)).
   - The speeds 0.5 … 50 are a generic range, not a prior.
   - The incoherent (diagonal) energy is removed, so only probe-to-probe
     coherence counts.
   - The time axis covers every aligned sample: a fixed axis would truncate
     the broadened far-probe pulses and bias the stack. This was found on
     synthetic data, fixed, and covered by a unit test.
   - s* = argmax P(s), refined parabolically.
2. **Template.** T₋ₖ(t) = mean over p ≠ k of E_p(t + s*(d_p − d_1)). Each
   probe's own data are left out of its template, so its noise cannot pull
   its delay toward the stack moveout. Without this, the jackknife error was
   underestimated by 30× on synthetic data.
3. **Delays.** τ_k = argmax over τ of Σ_t T₋ₖ(t)·E_k(t + τ), searched within
   ±15 of s*(d_k − d_1) on a 0.125 grid, refined parabolically.
4. **Speed.** Fit τ_k = a + d_k/c by least squares; c = 1/slope.

**Uncertainty.** A delete-1 jackknife over seeds of the whole procedure.
Seed means are recomputed without each seed in turn; detection decisions are
taken from the full sample. The 95 % CI uses Student t with S − 1 dof.

**Seed-to-seed variation.** The SD of the jackknife pseudo-values,
reported per case.

**Why this estimator.** On the design pilots (§12), per-probe peak timing
needed several times more data for the same precision at small amplitude.
Stacking first gives a low-noise waveform; each probe is then timed against
it, which uses the whole pulse shape.

### Secondary features (reported, never judged)

Each secondary feature uses per-probe peak detection at ≥ 5σ, is fitted over
the probes where it is detected (≥ 5 probes), and has a jackknife SE:

- momentum-peak centroid (≥ ½ max);
- leading ½-max crossing (front);
- trailing ½-max crossing (tail);
- density-excess peak;
- kinetic-stress peak;
- significant momentum minimum after the peak (rarefaction or inward wave).

Also reported:

- the slant-stack speed 1/s*;
- per-probe competing peaks;
- right-side and left-side speeds;
- inner (d = 30–110) and outer (110–190) probe-subset speeds;
- pairwise probe speeds (adjacent pairs, 30→110, 110→190, 30→190);
- the template peak per unit amplitude (linear response);
- the full slant-stack power curve, including negative (inward) speeds.

None of these is chosen after the fact; the primary is fixed above.

## 6. Detection and ambiguity

**Detected propagation event** (per case). Both conditions hold:

- the aligned-stack peak is ≥ 5σ, where σ is the RMS over the axis of the
  seed-SE of the per-seed aligned stacks;
- at ≥ 75 % of the probes (13 of 17), the cross-correlation peak is ≥ 3σ_C,
  where σ_C is the seed-SE of the per-seed correlations, RMS over τ.

An amplitude that is not detected is **noise-dominated**. It is excluded
from the extrapolation and reported as such.

**Ambiguous primary feature** (per detected case). Any one of these:

- a competing local maximum of P(s), outside the main peak's ½-max interval,
  whose ratio to the main is ≥ 0.5 and whose aligned stack is ≥ 5σ (a
  second coherent wavefront);
- at any probe, a competing cross-correlation maximum ≥ 0.5 of the main one
  and ≥ 5σ_C;
- any leave-one-seed-out s* outside the full-sample main peak's ½-max
  interval;
- any leave-one-seed-out τ_k outside the full-sample main correlation peak's
  ½-max interval (a seed subset locks onto a different feature).

Competing candidates are always listed, whether or not they trigger
ambiguity.

## 7. Amplitude series and the zero-amplitude limit

**Amplitudes:** A = 0.4, 0.3, 0.2, 0.1, 0.05 (fractional density excess in
the slab), plus a control at A = 0. Rationale: §12.

**Linear model.** c(A) = c₀ + k·A, fitted by weighted least squares with
weights 1/SE(A)² from the full sample. For a weakly nonlinear pulse, the peak
speed exceeds the small-amplitude speed by an amount proportional to the
pulse amplitude. That amplitude is proportional to A in the linear response
regime, so the first-order model is linear in A. c₀ is the reported sound
speed.

**Uncertainty.** All cases use the same seeds, so c₀ is jackknifed jointly:
each seed is deleted from every amplitude, and the fit is redone with the
same weights.

**Set rule (top-down, mechanical).**

1. Start with the detected amplitudes.
2. Drop the largest amplitude if it meets any of these conditions:
   - it is ambiguous;
   - it fails distance linearity (§8, S4);
   - the curvature of c(A) over the current set is significant, meaning the
     quadratic coefficient of a weighted quadratic fit has |z| ≥ 3 by joint
     jackknife.
3. Repeat until no condition applies or fewer than 3 amplitudes remain.

Dropped amplitudes are reported as the finite-amplitude (nonlinear) regime.
Only the largest amplitude is ever dropped, never a smaller one, so the rule
cannot select a convenient subset.

**Sensitivity (reported):**

- c₀ from all detected amplitudes;
- c₀ from the three smallest amplitudes of the set;
- c at each amplitude.

## 8. Convergence, invariance and placement

All invariance tests are at the reference amplitude A_ref = 0.4, the
highest-SNR amplitude (§12). The amplitude dependence itself is tested by S5,
not here.

**Seeds.** The variants use subsets of the series seeds: judged variants the
first 32, reported variants the first 16. Each difference is jackknifed
jointly with the reference re-analysed on the same seeds.

**Equivalence rule.** Let Δ be the relative speed difference, variant minus
reference, with its 95 % CI (t, n − 1 dof).

- **PASS:** the CI lies inside ±5 %.
- **FAIL:** the CI lies entirely outside ±5 %, a material dependence on a
  setting that should not matter.
- **INCONCLUSIVE:** otherwise, or if the variant is not detected or is
  ambiguous.

The margin, 5 %, equals the precision required of c₀ (S6). A dependence
smaller than the stated precision is not material; one larger than it is.

**Numerical and analysis tests** (re-analyses of the reference runs, judged):

| ID | Test |
|---|---|
| S8-probe-width-4 | probe width 4 vs 10 |
| S8-probe-width-20 | probe width 20 vs 10 |
| S8-time-resolution | sampling interval 1.0 vs 0.5 |
| S8-measurement-window | window end 110 vs 120 |

**Runs** (judged unless marked reported):

| ID | Test | Judged |
|---|---|---|
| S8-timestep | Courant 0.05 vs 0.025 | yes |
| S9-domain-length | L = 900 vs 600 | yes |
| S9-strip-height | H = 240 vs 120 (twice the particles per probe, half the noise variance) | yes |
| S9-particle-radius | radius 0.35 at the same φ, H = 60 (2× particles per area, same number per probe) | yes |
| R-disturbance-type | velocity kick U = 0.4, 16 seeds | reported |
| R-slab-width | slab width 40, 16 seeds | reported |

The two variants are reported only, because at finite amplitude a different
pulse shape or strength changes the nonlinear speed increment. A difference
there does not separate disturbance dependence from nonlinearity.

**Probe placement** is judged through distance linearity (S4). A speed that
depended on where it is measured would make arrival time curve against
distance. Inner and outer subset speeds and pairwise speeds are reported.

## 9. Boundaries and reflections

The box is periodic in x and y. There are no walls.

- **Wrapped wave.** The two pulses meet at the antipode (d = L/2) and continue
  into the other half. In folded coordinates they return inward, so the
  earliest such arrival at probe d is at distance L − d.
- **S10 rule.** For every amplitude in the set and every variant, the
  earliest wrapped arrival at the outermost probe must come after the window
  end. That arrival is estimated as t₀ + (L − d_max)/(c + 3 SE) − rise time:
  - t₀ and the rise time come from the momentum-peak feature;
  - if that feature is unavailable, t₀ = 0 and the rise time is 10.
- **Inward waves.** No coherent inward-moving wave may be detected.
  - **Search band.** The candidate is the largest *interior* local maximum of
    the cross power at inward speeds between ½ and 2 × the measured outward
    speed. A reflected or wrapped pulse travels at the medium's speed.
  - **Detection.** The candidate counts as an inward wave if its aligned
    stack is ≥ 5σ and its cross power is ≥ 0.5 of the outward maximum. This
    is the same rule as for competing outward moveouts (§6).
  - **What it rejects.** A strong outward pulse leaks into near-zero inward
    moveouts, but as a monotonic tail with no interior maximum. Thermal sound
    noise is seed-incoherent and weak (§12).
- **Domain size and transverse size** are tested by S9 (L = 900, H = 240).
- **Wave interference** (the two outward pulses) cannot occur at the probes:
  the pulses move apart. Pulse–entropy-mode interaction is limited to the
  source region (d < 20).

## 10. Control

The control has no disturbance (A = 0); everything else is identical.

**S1** requires:

- outward and inward aligned-stack SNR < 5;
- at every probe, max |seed-mean j| < 5σ.

A signal without a disturbance would be an artefact: **FAIL**.

## 11. Criteria and classification

| ID | Criterion | PASS | FAIL | otherwise |
|---|---|---|---|---|
| — | numerical safety, energy ledger (< 10⁻⁹), no empty space | all met | any violated | — |
| S1 | control shows no signal | as §10 | a signal | — |
| S2 | detection | ≥ 3 amplitudes detected | — | INCONCLUSIVE |
| S3 | unambiguous primary feature at every amplitude in the set | none ambiguous | — | INCONCLUSIVE |
| S4 | distance linearity at every amplitude in the set | R² ≥ 0.99 and \|curvature z\| < 3 | any \|z\| > 5 | INCONCLUSIVE |
| S5 | zero-amplitude extrapolation valid | set of ≥ 3 amplitudes with \|c(A) curvature z\| < 3 | — | INCONCLUSIVE |
| S6 | precision of c₀ | 95 % CI half-width < 5 % | — | INCONCLUSIVE |
| S7 | seed reproducibility: split halves (odd/even seed index), each a full analysis | \|z\| < 3 for c₀(half 1) − c₀(half 2) | \|z\| > 5 | INCONCLUSIVE |
| S8 | probe width (4, 20), sampling, window, timestep | equivalence ±5 % | CI outside ±5 % | INCONCLUSIVE |
| S9 | domain length, strip height, particle radius | equivalence ±5 % | CI outside ±5 % | INCONCLUSIVE |
| S10 | reflection exclusion (§9), for the amplitudes in the set and the judged variants | met | — | INCONCLUSIVE |

**Classification.**

- **PASS** if every row passes.
- **FAIL** if any row fails.
- **INCONCLUSIVE** otherwise.

**Precision rationale (S6).** 5 % is the precision the earlier PFAD pulse
experiment required ("speed-precision"). It is also the scale at which
Mp = V/c_p is used to separate compressibility regimes in the flow
experiments.

**False-alarm budget, stated in advance.** For a medium that does have a
sound speed, the z-based rows (S4 over ≤ 5 amplitudes, S5 and S7) at
|z| < 3 have a chance INCONCLUSIVE rate of about 0.27 % each, ≈ 2 % in
total. The top-down rule uses the same |z| < 3, so a chance drop of the
largest amplitude has probability ≈ 0.3 % per step. The equivalence rows can be INCONCLUSIVE for lack of precision; their
power is set by the seed count (§12). A chance FAIL needs |z| > 5 or a CI
wholly outside ±5 %, and is negligible.

**External benchmarks** (record `benchmarks`, after the measurement, never a
criterion):

- 2D ideal gas, √(2kT/m);
- hard-disk isothermal, √((kT/m)(Z + φZ′));
- hard-disk adiabatic, √((kT/m)(Z + φZ′ + Z²));

where Z(φ) is the Henderson equation of state.

## 12. Design pilots and the choice of numbers

Three sets of design-only seeds were used. They are never reused for
validation, and no result from them enters a criterion.

- **Pilot 1 (5001–5008).** The existing `PulseRun` with L = 400,
  amplitudes 0.4, 0.2, 0.1 and 0.
- **Pilot 2 (5101–5108).** This experiment's configuration with the five
  amplitudes, the control, kick U = 0.2 and slab width 40.
- **Code-path smoke test (5201–5208).** A reduced domain, used to exercise
  every analysis branch.

What they showed, and what each finding fixed:

1. **Noise and signal.** With 8 seeds, the seed-mean momentum density at a
   4-wide probe (H = 120) has an SE of ≈ 5.8 × 10⁻³. The SE falls as
   1/√(seeds × H × probe width). The outward pulse's stacked-template peak
   is ≈ 0.07·A. That is a linear response: the peak per unit amplitude is
   0.073, 0.070 and 0.073 at A = 0.4, 0.3 and 0.2. Per-probe peak detection
   at 5σ would need A ≳ 0.4 at 8 seeds; stacking over 17 probes gains ≈ √17.
2. **Choice of estimator.** At A = 0.4 with 8 seeds, per-probe peak centroids
   had a 6–10 % SE, and cross-correlation and stacking 2–3 %. Hence the
   primary estimator. A longer range of probe distances (30–150 against
   30–110) roughly halved the SE, which led to L = 600 and probes to 190.
3. **Two estimator defects**, found on synthetic data and fixed before any
   validation data existed; unit tests cover both:
   - stack-axis truncation (bias of +1 to +3 % for broadening pulses);
   - correlating each probe with a template that contained it, which
     underestimated the jackknife SE by up to 30×.

   Pilot-1 speeds were made with the defective estimator and are not used.
4. **Pilot 2 with the corrected estimator (8 seeds).** This is design data
   only, shown for transparency.

   | A | c | stack SNR |
   |---|---|---|
   | 0.4 | 2.384 ± 0.051 | 24.5 |
   | 0.3 | 2.362 ± 0.033 | 15.2 |
   | 0.2 | 2.345 ± 0.120 | 11.6 |
   | 0.1 | 2.377 ± 0.085 | 7.8 |
   | 0.05 | not detected | 4.9 |
   | control | no signal | 2.5 |

   - Extrapolation over 0.1–0.4: c₀ = 2.352 ± 0.088, with no significant
     slope or curvature.
   - R² ≥ 0.996 at every amplitude; no ambiguity at the detected amplitudes.
5. **Seed count.** SE(c₀) = 0.088 at 8 seeds.
   - 32 seeds would give a 95 % half-width of ≈ 3.8 %, with little margin:
     an 8-seed SE is itself uncertain by ≈ 25 %.
   - 64 seeds give ≈ 2.7 %.
   - At 64 seeds, A = 0.05 should be detectable (stack SNR ≈ 4.9 · √8 ≈ 14).
     If it is not, it is reported as noise-dominated.
6. **Reference amplitude.** The per-case SE at 32 seeds is ≈ 1 % at A = 0.4
   but ≈ 2.5–3 % at A = 0.2. Equivalence at ±5 % is therefore feasible only
   at 0.4: A_ref = 0.4. At 0.4 the pulse's peak velocity is ≈ 0.12 against a
   speed ≈ 2.4 (≈ 5 %), weakly nonlinear. Pilot 2 showed no detectable
   amplitude dependence, and the invariance tests concern numerics and
   geometry, not the zero-amplitude limit.
7. **Inward stack.** Two effects appear in the inward stack:
   - strong outward pulses leak into near-zero inward moveouts, with a cross
     power of up to ≈ 0.3 of the outward maximum;
   - thermal sound noise in the 8-seed average shows weak, seed-incoherent
     inward coherence near the medium's speed (ratio ≈ 0.2, falling as more
     seeds are averaged).

   Synthetic outward-only pulses, with or without a trailing rarefaction,
   produce no interior inward maxima. Hence the rule in §9.
8. **Thermal fluctuations.** In the control, the fluctuations alone show
   their most coherent moveouts at speeds near 2.3 (outward and inward),
   close to the pulse speed. This is reported only: equilibrium noise is
   itself sound.
9. **Velocity kick.** U = 0.2 gives an N-wave (compression, then
   rarefaction) that was barely detected (SNR 4.4 at 8 seeds); hence U = 0.4.
10. **Cost and timing.**
    - A run (600 × 120, 135 time units) takes ≈ 150 s on one core.
    - Phase 1 was shortened from 30 to 15 time units.
    - With the window ending at 120, the outward pulse reaches the antipode
      (d = 300) only at t ≈ 125, so no wrapped wave exists inside the window
      at all.


## 13. Validation plan

- **Code.** The pre-registration commit, the one whose message says
  "Pre-register Item 2". The run is made from a git worktree pinned to it,
  and the hash is written to the run log. Earlier commits touching this file
  are design-stage drafts.
- **Seeds.** 6001–6064, fresh:
  - 64 for the five amplitudes and the control;
  - the first 32 for the four judged variants;
  - the first 16 for the two reported variants.

  No earlier PFAD run used them. The design pilots used 5001–5008,
  5101–5108 and 5201–5208.
- **Expected runtime.** ≈ 6.4 h on 4 threads (≈ 600 run-equivalents of
  ≈ 150 s each).
- **Command.**
  `npx tsx scripts/run-experiment.ts sound-speed-validation --parallel 4 --out results --name sound-speed_validation`
- **Report.**
  `npx tsx scripts/report-sound-speed.ts results/sound-speed_validation.json results/plots/sound_speed`
- **Decision.** By §11 only, from this record only. The design-pilot data
  play no part in it.
