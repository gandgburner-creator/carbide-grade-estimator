# PFAD v0.2 — Particle-Field Airfoil Design: Experimental Laboratory

PFAD tries to derive wing-scale aerodynamic behaviour from a microscopic
particle universe, and to design airfoils only after that universe has been
shown to produce pressure, sound, viscosity, boundary layers, separation and
trailing-edge behaviour on its own.

This directory is **Phase 0: the experimental laboratory** (Master Build
Prompt Steps 1–15). Airfoil optimisation is deliberately not built: the lab
UI keeps it locked until every Phase 0 criterion has passed its checks and
convergence studies, and at present they have not (see
[`docs/EXPERIMENT_LOG.md`](docs/EXPERIMENT_LOG.md)).

**Run the laboratory application:** online at
https://gandgburner-creator.github.io/carbide-grade-estimator/pfad-lab/, or
locally with `cd pfad && npm install && npm start`, then
open http://localhost:5173. User guide, what each display measures, exports
and limits: [`docs/LAB_APP.md`](docs/LAB_APP.md).

- Canonical specification: [`docs/PFAD_v0.2_Experimental_Physics_Bible.md`](docs/PFAD_v0.2_Experimental_Physics_Bible.md)
- Build instructions it was built from: [`docs/PFAD_v0.2_Master_Build_Prompt.md`](docs/PFAD_v0.2_Master_Build_Prompt.md)
- Architecture and layering rules: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Every assumption and implementation choice, by ID: [`docs/MODEL_ASSUMPTIONS.md`](docs/MODEL_ASSUMPTIONS.md)
- Model versions and why they changed: [`docs/MODEL_CHANGELOG.md`](docs/MODEL_CHANGELOG.md)
- What was measured, against what, and what it means: [`docs/EXPERIMENT_LOG.md`](docs/EXPERIMENT_LOG.md)
- Thermal-equilibrium and viscosity precision reruns (criteria fixed in advance, full report): [`docs/CRITERIA_THERMAL_VISCOSITY.md`](docs/CRITERIA_THERMAL_VISCOSITY.md), [`docs/REPORT_THERMAL_VISCOSITY.md`](docs/REPORT_THERMAL_VISCOSITY.md)
- Small-amplitude sound speed (criteria pre-registered before the validation data, full report): [`docs/CRITERIA_SOUND_SPEED.md`](docs/CRITERIA_SOUND_SPEED.md), [`docs/REPORT_SOUND_SPEED.md`](docs/REPORT_SOUND_SPEED.md)
- Boundary layer + separation discovery, Item 3 (criteria pre-registered before the validation data, full report; classification INCONCLUSIVE): [`docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md`](docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md), [`docs/REPORT_BOUNDARY_LAYER_SEPARATION.md`](docs/REPORT_BOUNDARY_LAYER_SEPARATION.md)
- Design review after Item 3 (what to do next; not a pre-registration): [`docs/REVIEW_AFTER_ITEM3.md`](docs/REVIEW_AFTER_ITEM3.md)
- Design review of Universe B and scale bridging (theory and a minimal feasibility design; not a pre-registration): [`docs/REVIEW_UNIVERSE_B_SCALE_BRIDGING.md`](docs/REVIEW_UNIVERSE_B_SCALE_BRIDGING.md)
- UB-0 pre-registration design review (the Universe B coarse-graining test; design only, nothing implemented or run): [`docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md`](docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md)
- UB-0 Phase 1 analytical predictions (no Universe B data): [`docs/UB0_ANALYTICAL_PREDICTIONS.md`](docs/UB0_ANALYTICAL_PREDICTIONS.md)
- UB-0 design amendment 1 (errata, replacement wall rule, pilot and uncertainty rules; before any Universe B simulation): [`docs/UB0_DESIGN_AMENDMENT_1.md`](docs/UB0_DESIGN_AMENDMENT_1.md)
- UB-0 Stage 0 protocol (Universe A inputs and references; written before any Stage 0 run): [`docs/CRITERIA_UB0_STAGE0.md`](docs/CRITERIA_UB0_STAGE0.md)
- UB-0 implementation record (safeguards, findings, the D1–D3 items and their A2 implementation; before any Universe B pilot or judged run): [`docs/UB0_IMPLEMENTATION_RECORD.md`](docs/UB0_IMPLEMENTATION_RECORD.md)
- UB-0 design amendment 2 (D1 timestep strategy and rate gate, D2 release-fraction erratum, D3 power design, exclusion rule; before any Universe B pilot): [`docs/UB0_DESIGN_AMENDMENT_2.md`](docs/UB0_DESIGN_AMENDMENT_2.md)
- UB-0 Stage 0b protocol (Universe A supplement: references, sound amplitude, timestep checks; written before any Stage 0b run): [`docs/CRITERIA_UB0_STAGE0B.md`](docs/CRITERIA_UB0_STAGE0B.md)
- UB-0 pre-registration — **DRAFT, not frozen** (awaits Stage 0b, the final power and seed plans, and the blind pilots): [`docs/CRITERIA_UB0_COARSE_GRAINING.md`](docs/CRITERIA_UB0_COARSE_GRAINING.md)

## The rules the code keeps

- **No hidden classical aerodynamics.** The solver (`core/`, `gas/`,
  `occupancy/`, `walls/`) contains hard disks, an impulse collision law,
  Maxwell-accommodating walls and bodies, and open reservoir boundaries —
  nothing else. No Bernoulli, Navier–Stokes, potential flow, Kutta condition,
  NACA data or force coefficients. A test (`tests/architecture.test.ts`)
  enforces the layering.
- **Pressure, shear, lift and drag are sums of wall impulses.** Viscosity,
  sound speed and circulation are measured from particle data.
- **Benchmarks are kept apart.** Classical values (ideal gas, hard-disk
  equation of state, Enskog viscosity, Haff cooling, thin-airfoil theory)
  live in `benchmarks/` and in each record's `benchmarks` section; they never
  feed back into a run.
- **Statuses:** `UNTESTED`, `RUNNING`, `PASSED`, `FAILED`, `INCONCLUSIVE`,
  `NOT CONVERGED`. Nothing is ever called "validated"; `PASSED` means the
  pre-stated checks passed.
- **Reproducible:** every record carries its full configuration, seeds and
  model version; `npm run exp -- replay <record.json>` regenerates it, and with
  the same model version the replay is bit-for-bit.

## Commands

```
npm install
npm start              # laboratory application (Vite dev server, http://localhost:5173)
npm run build && npm run preview   # production build, served on http://localhost:4173
npm run smoke -- http://localhost:4173/ smoke-out   # browser smoke test (needs Playwright + Chromium)
npm test               # unit, physics and architecture tests (vitest)
npm run typecheck
npm run build          # type-check + production build of the UI

# headless experiments (records go to results/ unless --out is given)
npm run exp -- <type>                       # reference configuration
npm run exp -- <type> --quick               # small smoke-test configuration (never reported)
npm run exp -- <type> --parallel 4          # same record, runs spread over worker threads
npm run exp -- <type> --set key=<json> ...  # override parameters
npm run exp -- replay results/<record>.json # regenerate a record from its stored configuration
npm run exp -- show results/<record>.json   # print a saved record (checks, measured values, benchmarks)
npm run exp -- ab-test --preset "<name>"    # a registered model comparison (a wrong name lists them)
npm run exp -- convergence static-box/timestep   # also: particle-count, averaging, grid

# reference drivers that feed measured μ and c_p into Re and Mach
npx tsx scripts/run-couette-reference.ts 4
npx tsx scripts/run-flow-references.ts 4 [boundary-layer|separation|kutta|scaling]
```

## Experiments

| Step | Type key | What it asks | Reference record |
|---|---|---|---|
| 5–7 | `static-box` | Does a closed hard-disk gas produce a steady wall pressure from impacts alone? Energy ledger; inelastic cooling. | `results/static-box_reference_seed7.json`, `results/static-box_ensemble_10seeds.json` |
| 8 | `thermal` | Pressure versus temperature, density and initial velocity distribution; hidden energy scales. | `results/thermal_reference.json` |
| 9 | `wall-accommodation` | Momentum and energy exchange with Maxwell walls; shear in a moving-wall channel. | `results/wall-accommodation_reference.json` |
| 10 | `sound-speed`, `sound-speed-sweeps` | How fast does a pressure disturbance travel (models A–E)? | `results/sound-speed_reference.json`, `results/sound-speed_sweeps.json` |
| 11 | `viscosity`, `viscosity-sweeps` | Couette flow: effective viscosity, slip, Knudsen number. | `results/viscosity_reference.json`, `results/viscosity_sweeps.json` |
| 12 | `boundary-layer` | Does a near-wall layer emerge on a diffuse plate in a uniform stream? | `results/boundary-layer_reference.json` |
| 13 | `separation` | Does a decelerating outer flow separate the layer; can a threshold be generated from data and tested on held-out cases? | `results/separation_reference.json` |
| 14 | `kutta` | From a cold start, does gas leave a sharp trailing edge smoothly — with nothing imposed? | `results/kutta_reference.json` |
| 15 | `scaling` | Do results converge across particle universes of different size (fixed Mp; fixed Re)? | `results/scaling_fixed-mach.json`, `results/scaling_fixed-reynolds.json` |
| §40 | `ab-test` | Two configurations under equivalent conditions: difference and significance. | `results/ab-test_*.json` |
| §23 | `convergence …` | LOW / MEDIUM / HIGH studies of timestep, particle count, averaging and grid. | `results/convergence_static-box_*.json` |

Each record holds, separately: the measured `results`, their `uncertainty`,
`convergence`, the `acceptance` checks (criterion stated before the run,
measured value, status), `benchmarks`, the `assumptions` it relies on (IDs in
`MODEL_ASSUMPTIONS.md`), `warnings` and safety flags, Re and Mach with their
definitions, and the complete `config`.

## Laboratory application

`npm start`, then open http://localhost:5173. The full guide is
[`docs/LAB_APP.md`](docs/LAB_APP.md).

- **Choose and configure.** Pick Universe A, an experiment and a preset
  (QUICK LOOK for interactive sizes, never used for reported results;
  REFERENCE for the documented configuration). Edit the parameters: they are
  validated against the experiment's documented parameter set, and the
  effective configuration is shown.
- **Run.** LOAD / RUN / PAUSE / STEP / STOP / RESET drive the experiment in a
  Web Worker. RESET replays it from the same seeds. The UB-0 instrument also
  supports CHECKPOINT and resume.
- **Watch.** The view shows particles and coarse-grained fields: occupancy,
  density, velocity components, momentum, temperature and particle stress.
  Each field is labelled with its units, MEASURED or DERIVED, and
  instantaneous or time-averaged. Zoom with the wheel, pan by dragging, and
  click a particle to inspect it. The strip below holds:
  - live time series;
  - a near-wall profile over a chosen x window;
  - wall and body momentum transfer (P = Σ normal impulse / (Δt L)).
- **Inspect results.** A finished record opens in **Results**, split into
  Measured, Reference (benchmarks, not measured), Imposed (configuration),
  Assumptions and Validation.
- **Library, comparison and export.**
  - **Library:** every started run is kept in the browser library (completed,
    stopped, failed, interrupted or checkpointed). It is searchable, takes
    imported `results/*.json` records, and exports bundles.
  - **Compare:** puts two records side by side, descriptively.
  - **Exports:** CSV, JSON and PNG. Each carries its provenance: code commit,
    model version, seeds, preset and units.
- **Universe B is locked.** UB-0 is preregistered and blind, and Universe B
  observables are first computed by the preregistered scripts after gate G5.
  Airfoil design stays locked until the Phase 0 criteria pass.

## Flow-guided geometry (experimental)

A second workspace in the same application ("FLOW-GUIDED GEOMETRY" tab):
start from a flat plate, simulate it with the real particle engine, measure the
near-wall flow on both sides, detect a candidate region of reduced or reversed
flow, propose one small bounded increment of the surface over that region,
watch the construction point trace it, accept or reject it, simulate the new
surface and compare it with the old one, keeping the whole history. It is a
measurement and visualisation foundation, **not** an optimiser and **not
validated**: the detector is an experimental operational definition, the
construction rule is a hypothesis generator, and the comparison reports
trade-offs without a score. It is set up in plain units (plate length and
thickness in cm, air temperature in °C, height in m, wind in km/h, angle in
degrees) and says, next to the inputs, how far the simulated regime is from the
real plate's (Mach, Reynolds and Knudsen numbers): same shape and angle, very
different flow regime. A **live fill** grows the surface while one simulation runs, from where the particles
stop touching it toward the trailing edge, and an **auto-build** button repeats simulate,
propose and accept on its own and stops when nothing is measured. Details, definitions, thresholds, what is and is
not supported (including curved bodies) and the open scientific questions are in
[`docs/FLOW_GUIDED_GEOMETRY.md`](docs/FLOW_GUIDED_GEOMETRY.md). Universe B stays
locked.

## Layout

```
src/core/          vectors, RNG (sfc32, named streams), particle store, domain, grid,
                   collision law, integrator, energy/momentum ledger, safety monitor
src/gas/           initial conditions, reservoir inflow sampling
src/walls/         planar Maxwell walls, open reservoir boundaries, polygon bodies
src/occupancy/     occupancy field and the (optional, OFF by default) occupancy force
src/measurements/  statistics, wall pressure, conservation, profiles, fields, pulse tracking,
                   near-surface flow sampler, separation-region detector (experimental)
src/geometry/      surface representation, construction rule, version history, comparison, exports
src/benchmarks/    classical reference values (never used by a run)
src/experiments/   one module per experiment, the registry, A/B and scaling meta-experiments
src/validation/    statuses, convergence studies and verdicts
src/app/           laboratory session (drives the registry experiments), field metadata, momentum-
                   transfer monitor, profiles, validation, exports, library (no physics)
src/ui/, src/workers/  laboratory and flow-guided-geometry UI (React) and the simulation worker
scripts/           headless runner, parallel runner, reference drivers, SVG plots
tests/             unit, physics-property and architecture tests
results/           reference records (JSON) and logs
```
