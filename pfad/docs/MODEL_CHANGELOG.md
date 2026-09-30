# PFAD model changelog

Every change to a physical rule, its numerical treatment, or a reference
configuration is logged here with its reason (Master prompt §4). Model versions
are recorded in every experiment record (`modelVersion`).

## 0.2.0-p0.1 — Phase 0, first particle engine

Initial implementation: 2D hard disks (A-02), impulse collision law (A-05) with
rewind-to-contact timing (A-06), explicit energy ledger (A-07), planar Maxwell
accommodation walls (A-08).

### Configuration change: static-box reference timestep (no model change)

- **Was:** adaptive timestep, Courant number C = 0.05.
- **Now:** C = 0.025.
- **Why:** the static-box acceptance criterion *timestep-quality* (late-contact
  fraction < 10⁻³ of collisions), fixed before the first reference run, was not
  met at C = 0.05 (measured 1.14 × 10⁻³, N = 2000, seed 7). Diagnosis: all late
  contacts are explained by a particle's previous event in the same or the
  preceding step (`lateContactsUnexplained` = 0), and their rate scales
  linearly with dt (2.5 × 10⁻³, 1.2 × 10⁻³, 5.3 × 10⁻⁴, 1.7 × 10⁻⁴ at
  C = 0.1, 0.05, 0.025, 0.0125). This is the expected first-order error of
  processing pairs in grid order within a step, not a defect.
- **Evidence it does not matter for pressure:** the `static-box/timestep`
  convergence study (C = 0.1 / 0.05 / 0.025), recorded in
  `docs/EXPERIMENT_LOG.md`.

### Analysis-method revisions made after seeing results (no model change)

Each of these changed how a check is evaluated **after** a run had failed it.
They are listed so the change cannot be mistaken for tuning; in each case the
original statistic was invalid, not merely inconvenient, and the revised check
was then applied unchanged to fresh reference runs.

1. **Static box, `uncertainty-reliable`.** Originally required a block-averaging
   plateau in every elastic run even when the reported uncertainty came from
   an ensemble of ≥ 3 independent seeds (which does not rely on block
   averaging). Revised: passes if the reported uncertainty is ensemble-based
   with ≥ 3 seeds, or every run plateaus.
2. **Thermal, `no-hidden-energy-scale`.** Originally required bit-identical
   P/(nkT) for all temperatures of a seed. The first reference run showed kT =
   0.5 ≡ 2 and 1 ≡ 4 exactly but not 0.5 vs 1: time rescaling is exact in
   binary floating point only when velocities scale by a power of 2. Revised:
   identity is required within power-of-4 temperature classes; other
   temperatures are treated as independent realisations. Reference
   temperatures now include 0.25 so the class {0.25, 1, 4} is testable.
3. **Thermal, consistency across temperatures / initial distributions.**
   Originally a χ² test with 3-seed ensemble SEs (2 dof — themselves very
   uncertain; one came out ±0.0013 when single runs scatter by ±0.02), and
   duplicated (bit-identical) runs counted twice. Revised: one-way ANOVA over
   independent runs (one temperature per class), and seeds increased from 3
   to 5.
4. **Wall accommodation, Part A.** Originally a transient (gas at kT relaxing
   to walls at kT_w). The energy accommodation estimate is ill-conditioned
   once the gas has thermalised (denominator → 0; α_E = 1.67 ± 0.44 at
   Aw = 1). Redesigned as a steady two-temperature channel, and estimates with
   seed SE > 0.2 are reported INCONCLUSIVE (ill-conditioned), never as
   agreement.
5. **Wall accommodation, balance and α checks.** Balances (momentum, energy)
   now use per-run block averages of the window series (hundreds of windows,
   reliable SE) pooled by inverse variance, instead of 2–3-seed SEs; α checks
   use a Student-t-scaled threshold 2·t₀.₉₇₅(n−1)·SE. The "heat removed" figure
   was split into mechanical work (U·momentum) and wall-frame heat, which the
   first version conflated.

6. **Block-averaging SE (all time-series estimates).** Originally the largest
   SE over all blocking levels with ≥ 16 blocks. For anti-correlated series
   (wall impulse in a closed elastic box: the virial bounds the integrated
   impulse, so level SEs *fall* with block size) the maximum is the naive
   level-0 SE and overstates the uncertainty several-fold, which made
   reference ensembles look inconsistent with their own block estimates.
   Revised: the SE is read at the deepest level that still has ≥ 16 blocks
   (the Flyvbjerg–Petersen plateau value, whether approached from below or
   above); the maximum is kept in the output as `conservativeSe`, and the
   plateau test (`reliable`) is unchanged.

7. **A/B difference sign (bug fix, not a method change).** The A/B test
   labelled its difference B − A but computed A − B. Magnitudes, standard
   errors, |z| and verdicts were correct; the sign of `difference`, `z` and
   `relative` was inverted. Found while reading the contact-timing record,
   fixed with a test, and both A/B reference records regenerated.

## 0.2.0-p0.2 — collisions evaluated at the contact instant when forces act

- **Change:** with continuous forces present (occupancy hypothesis, soft
  contact is separate), the hard-collision law is evaluated with the velocity
  at the contact instant, v_c = v_½ + (F/m)(dt/2 − τ), instead of the stored
  half-step velocity v_½. The resulting impulse is applied to v_½. The law
  J = −(1+e)v_n/(1/m₁+1/m₂) itself is unchanged.
- **Why:** measured, not assumed. With the occupancy force on, the total
  energy error did not converge with dt (≈10⁻³ at dt = 0.04 … 0.005). For a
  single two-particle collision the error was O(dt) with a sign that depended
  on where in the step the contact fell (1.5 × 10⁻² at dt = 0.02). Algebra:
  kick–drift–kick leaves an error F·Δv·(τ₁ − τ₂)/2 per collision when the
  impulse uses v_½. After the change: per-collision error 1.8 × 10⁻⁶,
  3.7 × 10⁻⁷, 2.4 × 10⁻⁸, 2.4 × 10⁻⁹ (dt = 0.02 … 0.0025); many-body error
  converges at second order (6.1 × 10⁻⁴ → 5.8 × 10⁻⁶ from dt = 0.04 to 0.005).
- **Effect on earlier results:** none. Without forces the correction is
  exactly zero; `results/static-box_reference_seed7.json` (model p0.1)
  replays bit-for-bit under p0.2.
- Also new in p0.2 (all OFF by default): occupancy force F = −k_s∇φ (A-15),
  soft-contact deformation model F = Kδ (A-13 resolved as a model option),
  Universe B reservoir release (A-16).

## 0.2.0-p0.3 — open (reservoir) boundaries

- **New component (OFF unless an experiment declares it):** open boundaries
  (A-18, `walls/ReservoirBoundary`). Outflow removes particles whose centre
  crosses the plane; inflow injects from a stated reservoir (n, kT, U) at the
  kinetic crossing rate with the exact flux-weighted drifting-Maxwellian
  crossing velocity. Energy, momentum and particle number crossing the
  boundary are ledgered, so the conservation residuals stay at round-off with
  open boundaries. Segmented planar walls (a diffuse plate set in a specular
  floor) were added with it. These entered the code in the step-12 commit
  under the p0.2 label; no experiment record was produced with them before
  this version, and the label is corrected here.
- **Optional drift profile along a boundary** (piecewise-linear in position);
  entrant positions are then sampled in proportion to the local crossing flux.
  Used by the adverse-gradient experiment to impose a far-field deceleration.
- **Sampling order:** an entrant's crossing velocity is now drawn together
  with each placement attempt (previously once, before the attempts), so a
  re-drawn position also re-draws the velocity. Both are exact samples of the
  same distribution when the first attempt succeeds; the change matters only
  for re-draws and makes re-draws unbiased with a position-dependent drift.
  Trajectories of open-boundary runs differ from the step-12 code; runs
  without open boundaries are unaffected (verified:
  `results/static-box_reference_seed7.json`, model p0.1, replays bit-for-bit
  under p0.3).
- **Measured limitation:** a kinetic-only reservoir leaves a dense interior
  below the stated density (≈ 7 % at φ = 0.05, ≈ 21 % at φ = 0.2). Experiments
  measure and normalise with the realised state.

## 0.2.0-p0.4 — solid polygon bodies

- **New component (OFF unless an experiment declares a body):** fixed polygon
  bodies with Maxwell-accommodating faces (A-19, `walls/SolidBody`), exact
  earliest-contact timing against faces and vertices, per-edge surface bins
  (pressure, shear), per-vertex tallies, and whole-body impulse and moment.
  Needed for Step 14 (Kutta discovery). The gas initial condition can now
  exclude a region (the body) from random placement.
- **Effect on earlier results:** none; runs without bodies execute exactly the
  same operations in the same order (`INSIDE_BODY` is a new safety code that
  can only fire when a body exists).
- **Tests:** exact specular reflection from an inclined face at the contact
  instant, head-on and off-centre vertex contacts, no interaction for a disk
  already leaving, and a diffuse body in a closed gas at rest: ledgers close,
  no penetration, zero mean force, and face pressure equal to the planar-wall
  pressure within statistics.

