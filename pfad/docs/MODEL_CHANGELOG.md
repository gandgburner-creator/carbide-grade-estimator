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
