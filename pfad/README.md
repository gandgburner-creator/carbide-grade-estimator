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
npm run dev            # laboratory UI (Vite dev server)
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

## Laboratory UI

`npm run dev`, then pick an experiment on the left. LOAD builds the initial
state from its seed; RUN / PAUSE / STEP / STOP / RESET drive it in a Web Worker;
EXPORT RECORD and EXPORT CONFIG download JSON; IMPORT RECORD shows a saved
record (for example a headless reference run from `results/`) and counts its
status toward the Phase 0 criteria. The view shows particles (or
time-averaged fields: density, occupancy, velocity, temperature, with the
particles-per-cell and snapshot count that set their noise), walls coloured by
accommodation, solid bodies, and open reservoir boundaries dashed in blue. The
right panel shows live measurements while running and, when every run has
finished, the record's status, checks and measured-versus-benchmark table.
The Phase 0 criteria list and the airfoil lock sit at the bottom left.

The UI starts on QUICK LOOK (reduced sizes that finish interactively, never
used for reported results); REFERENCE loads the documented reference
configuration. Reported results come from the headless reference runs.

## Layout

```
src/core/          vectors, RNG (sfc32, named streams), particle store, domain, grid,
                   collision law, integrator, energy/momentum ledger, safety monitor
src/gas/           initial conditions, reservoir inflow sampling
src/walls/         planar Maxwell walls, open reservoir boundaries, polygon bodies
src/occupancy/     occupancy field and the (optional, OFF by default) occupancy force
src/measurements/  statistics, wall pressure, conservation, profiles, fields, pulse tracking
src/benchmarks/    classical reference values (never used by a run)
src/experiments/   one module per experiment, the registry, A/B and scaling meta-experiments
src/validation/    statuses, convergence studies and verdicts
src/ui/, src/workers/  laboratory UI and its simulation worker
scripts/           headless runner, parallel runner, reference drivers, SVG plots
tests/             unit, physics-property and architecture tests
results/           reference records (JSON) and logs
```
