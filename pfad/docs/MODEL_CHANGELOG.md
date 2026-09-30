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
