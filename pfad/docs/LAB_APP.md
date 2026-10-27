# PFAD Laboratory application

The PFAD laboratory is a browser workstation for running the particle
simulations in this repository. You configure a run, watch the particles and the
coarse-grained fields, inspect what was measured, keep every run in a library,
compare runs, and export results with their provenance.

It is a front end to the existing engine and experiments. It adds no physics:
every number it shows is measured from particle data by existing code, or
derived from such measurements, or is a stated configuration value. Airfoil
design stays locked until the Phase 0 criteria pass.

## Launch

```bash
cd pfad
npm install        # once
npm start          # http://localhost:5173
```

For a production build, run `npm run build && npm run preview`, which serves
`dist/` on http://localhost:4173. To smoke-test the build in a headless browser,
run `npm run smoke -- http://localhost:4173/ smoke-out`. This needs Playwright
with Chromium, which is not a project dependency.

## The screen

| Area | What it holds |
|---|---|
| Top bar | Model version, code version (git commit), units, the **Universe A / Universe B** switch, and the "not externally validated" label |
| Left column | Experiment list, **Configuration** (preset, parameters, seeds, validation, effective configuration), **Run** controls and status, and the Phase 0 / airfoil-lock list |
| Centre | The particle view with field overlays (zoom, pan, pick), its legend, and the analysis strip: **Time series**, **Near-wall profile** and **Wall momentum transfer** |
| Right column | **Live** (live values, particle inspector), **Results** (the record), **Library**, **Compare** |

## Running an experiment

1. **Pick the universe and the experiment.** Universe A is hard-disk
   molecules. Every Phase 0 experiment is there, plus the UB-0 instrument at
   N_c = 1. Universe B is locked (see below).
2. **Pick a preset.** QUICK LOOK uses reduced sizes that finish interactively;
   these runs are never used for reported results. REFERENCE is the
   documented reference configuration and can take a long time in a browser.
3. **Edit the parameters.** The form shows exactly the experiment's parameter
   set, nothing that is not implemented. The configuration is validated
   against the preset's documented defaults:
   - unknown keys, wrong types and non-finite numbers are rejected;
   - counts and lengths must be positive, accommodation and restitution must
     lie in [0, 1], and area fractions in (0, 0.75);
   - seeds must be distinct integers.

   Errors block LOAD; warnings (for example a very large particle count) do
   not. **Effective configuration** shows the exact JSON that will run and
   which parameters differ from the preset.
4. **Use the controls:**
   - **LOAD** builds the initial state from the seeds.
   - **RUN**, **PAUSE** and **STEP** drive the simulation in a Web Worker, so
     the UI never blocks.
   - **STOP** ends the run without a record. The run is kept in the library
     as STOPPED.
   - **RESET** rebuilds the initial state from the same seeds, which replays
     the run identically.
   - **CHECKPOINT** stores a resumable state. Only the UB-0 instrument
     supports it.

   The status line shows the phase (LOADED, RUNNING, PAUSED, FINISHED,
   STOPPED, FAILED), the progress, the run within the experiment, the
   simulated time and the compute time.
5. **When every run has finished**, the experiment's own analysis builds the
   record. The record opens in **Results** and is stored in the library.

Every run that was started is recorded in the library, whatever its outcome:

| Outcome | Meaning |
|---|---|
| `completed` | Has a record |
| `stopped` | Stopped by you, reset, or abandoned by selecting another experiment |
| `failed` | Simulation or analysis error, with the message |
| `interrupted` | The page was closed while the run was in progress |
| `checkpoint` | Can be resumed |

## The view

- **Navigation.** Wheel to zoom about the pointer, drag to pan, and
  double-click (or **fit**) to fit the domain.
- **Inspection.** Click a particle to inspect it: position, velocity, energy,
  collisions, and local occupancy and its gradient. The pointer readout
  shows the coordinates and the field value of the cell under the pointer.
- **Drawing.** Walls are coloured by accommodation. Moving walls carry their
  speed. Open reservoir boundaries are dashed blue, periodic boundaries are
  dashed grey, and solid bodies are filled polygons.
- **Fields.** Fields are coarse-grained on a grid sized for the chosen
  particles per cell. **time-average** accumulates snapshots; when it is off,
  the field is instantaneous. **reset avg** restarts the field, profile and
  wall-transfer averages.

The legend always states:

- the quantity, symbol and units;
- whether it is **MEASURED** or **DERIVED**;
- whether it is instantaneous or time-averaged, over how many snapshots and
  which time window;
- the grid and particles per cell;
- a warning below 100 samples per cell.

Signed quantities whose values straddle zero use a blue–grey–red scale
centred on 0. Everything else uses a sequential scale.

| Field | Symbol | Units | Origin | Cell value |
|---|---|---|---|---|
| occupancy | φ | 1 | measured | Σ disk area / (snapshots · cell area) |
| mass density | ρ | m/d² | measured | Σ m / (snapshots · cell area) |
| mean velocity | u_x, u_y | √(kT₀/m) | measured | Σ m v / Σ m |
| velocity magnitude | \|u\| | √(kT₀/m) | derived | magnitude of the measured u |
| momentum density | ρu_x, ρu_y | √(m·kT₀)/d² | measured | Σ m v / (snapshots · cell area) |
| temperature | kT | kT₀ | measured | peculiar kinetic energy per particle (A-03) |
| local pressure | ½(P_xx+P_yy) | kT₀/d² | measured | kinetic momentum flux plus logged collisional impulses (particle stress) |
| local shear | τ_xy | kT₀/d² | measured | off-diagonal part of the same stress |
| occupancy gradient | \|∇φ\| | 1/d | derived | central difference of φ |

Units are the model units of `MODEL_ASSUMPTIONS.md` A-01: m = d = k_B = kT₀ = 1
and τ = d·√(m/kT₀). No physical (SI) scaling exists yet, and none is implied.

## Measurements over time and space (analysis strip)

- **Time series.** Every numeric live value of the current run (or run
  phase), plus the relative energy and momentum residuals and the running
  wall pressures. The series is thinned evenly when it grows long. These are
  window values as the run reports them; the record's estimates use block
  averaging and seed ensembles.
- **Near-wall profile.** Switch it on to accumulate u_x, u_y, kT and n
  against height, inside an x window you choose (for example above a plate).
  - The values are mass-weighted bin averages of particle data.
  - Error bars are ± 1 SE from batch means, and batch independence is not
    checked.
  - No profile shape is fitted or imposed.
  - Whether a near-wall deficit is a boundary layer, and whether a viscosity
    is emergent, is decided by the experiments' acceptance criteria, not by
    this plot.
- **Wall momentum transfer.** Per wall:
  - P_wall = Σ normal impulse / (Δt · L)
  - τ_wall = Σ tangential impulse / (Δt · L)

  Per body: F = Δ(impulse) / Δt.

  This is the same momentum-transfer definition the experiments use
  (`PressureEstimator`), with no equation of state. The window starts with
  the run or phase; **restart window** begins a new one.

## Results

A record is split into the categories the integrity rules require:

| Tab | Content |
|---|---|
| **Measured** | `record.results`: quantities measured from particle data and quantities the experiment's analysis derives from them, with the uncertainties the record states (± SE, 95 % CI). The experiment's headline table is on top; below it every value can be filtered by name |
| **Reference** | `record.benchmarks`: classical reference values, kept separate. They are not measurements and never feed back into a run |
| **Imposed** | The configuration (parameters, not results) and how to replay it (`npm run exp -- replay <record.json>`) |
| **Assumptions** | The record's own assumptions; model-wide ones are in `MODEL_ASSUMPTIONS.md` |
| **Validation** | The status, every acceptance check (criterion and measured value), the convergence status, Re/Mach notes, warnings and safety flags. PASSED means the stated criterion was met in these runs, nothing more |

## Library and comparison

- **Library.** Stored in the browser's IndexedDB; if storage is unavailable,
  in memory for the session.
  - Search by id, title, type, seed, status or code version, and filter by
    outcome and status.
  - **OPEN** shows a record, **RESUME** continues a checkpoint, and
    **LOAD CONFIG** puts a stopped or failed run's configuration back into the
    form.
  - **IMPORT…** takes record files, for example `pfad/results/*.json`, or a
    library bundle. **EXPORT AS BUNDLE** writes the filtered entries with
    their records and checkpoints.
  - Imported records say that their code version was not recorded.
- **Compare.** Two records side by side, path by path. It reports
  Δ = B − A and se_Δ = √(se_A² + se_B²) for independent runs, plus z = Δ/se_Δ
  as a scale. This is descriptive, not a hypothesis test. Shared seeds and
  different model versions are flagged. For formal comparisons, use the
  MODEL A/B TEST experiment (§40).

## Exports

| What | Format | Notes |
|---|---|---|
| Record | JSON | The unchanged `ExperimentRecord` format (replayable) plus a `labProvenance` field |
| Measured results | CSV | One row per value or estimate (path, value, se, 95 % CI, n); benchmarks excluded |
| Field | CSV | One row per cell (index, centre, value), with the quantity, units, origin, averaging and grid in the header |
| Time series, profile, wall transfer | CSV | Units in the column names |
| Particle view, charts | PNG | With a caption: what is shown and its provenance |
| Configuration | JSON | `{ experiment, params, provenance }` |
| Library | JSON bundle | `pfad-lab-library/1` |

Every CSV starts with `# key: value` lines. They give the app, code version
(git commit, `-dirty` if the tree had changes), model version, experiment
type, universe, preset (and which parameters were changed), seeds, creation
and export times, and units.

## Universe A and Universe B

- **Universe A** is fully available.
- **Experiments with model variants.** The SOUND SPEED, SOUND SPEED — SWEEPS
  and MODEL A/B TEST experiments include the Phase 0 model variants B–E
  (occupancy force, internal reservoir). The UI labels those variants as
  experimental: they are not the UB-0 coarse-grained Universe B.
- **The UB-0 instrument (Universe A).** This runs the UB-0 instrument
  (`UB0Run`) and its estimators (`UB0Estimators`) at N_c = 1, for five kinds
  of run:

  | Kind | What it measures |
  |---|---|
  | static box | pressure and its decomposition, g(r), S(k) |
  | shear wave | ν |
  | standing sound wave | c |
  | wall box | normal-stress profile, G-W ratios |
  | Couette | μ and slip |

  These runs are exploratory and outside the UB-0 protocol: they are never
  judged, pooled or frozen. Seeds in every UB-0 protocol range are refused
  (`src/app/seeds.ts`, checked against the plans by `tests/app.core.test.ts`).
  The instrument supports checkpoint and resume, and a resumed run is
  bit-identical to an uninterrupted one.
- **Universe B (N_c > 1) is locked.** UB-0 is preregistered and blind, and
  Universe B observables are first computed by the preregistered scripts
  after gate G5 (`REVIEW_UB0_PREREGISTRATION_DESIGN.md` §11.7). The blind
  pilots await approval, and the judged runs have not been made. The lock is
  enforced in three places:
  - the experiment constructor refuses N_c ≠ 1;
  - the session reports the refusal and loads nothing;
  - the UI shows the lock instead of controls.

  The app does not touch the approval interlock or the judged plan.

## Not available, or experimental

- **Airfoil design and optimisation** stays locked until every Phase 0
  criterion passes.
- **Universe B** is locked (see above).
- **Checkpoint and resume** work only with the UB-0 instrument. The Phase 0
  experiments do not serialise their state, so a closed page loses an
  unfinished run; it is listed as `interrupted`.
- **No physical-unit scaling.** All values are in model units.
- **The library is per browser.** Use bundles to move it, and record files
  for anything that matters.
- **Reference presets** can take minutes to hours in a browser. Use the CLI
  (`npm run exp -- <type> --parallel N`) for reported results.
- **Field grids** follow the particles-per-cell setting. A thin channel can
  therefore get a single row of cells; lower the particles per cell, or use
  the near-wall profile, which bins along y directly.

## Architecture

```
src/app/LabSession.ts    the session: owns a registry experiment, advances it in slices, emits frames,
                         records and outcomes (no DOM; the worker and the tests drive it)
src/workers/simulation.worker.ts   thin worker adapter around LabSession
src/workers/protocol.ts  messages between the UI and the worker
src/app/fields.ts        field metadata (symbol, units, measured/derived, definition)
src/app/transfer.ts      wall/body momentum-transfer monitor (wall impulses)
src/app/profiles.ts      streaming cross-stream profile with batch-mean SEs
src/app/series.ts        bounded, evenly thinned time series
src/app/validate.ts      configuration validation against the documented defaults
src/app/seeds.ts         UB-0 protocol seed ranges the app refuses
src/app/exporters.ts     CSV/JSON exports with provenance
src/app/flatten.ts       record → rows (estimates keep their SE and CI)
src/app/compare.ts       descriptive record comparison
src/app/library.ts, libraryIdb.ts   library model, search, import/bundle, IndexedDB store
src/app/provenance.ts    code version (git commit stamped at build), model version, seeds, units
src/experiments/UBInstrumentExperiment.ts   UB0Run + estimators as a registry experiment (N_c = 1 only)
src/ui/                  React components: Lab (workstation), ParticleView, Chart, panels
```

The engine (`src/core`, `src/walls`, `src/gas`, `src/measurements`,
`src/universeB`) is used as it is. The application required three changes
there:

- **Momentum-density fields.** `FieldAverager` gained `momentumX` and
  `momentumY`.
- **Checkpoint access.** `SequentialExperiment` exposes its run index to
  subclasses (`protected`), so an experiment can checkpoint itself.
- **Browser-safe checkpoint encoding.** `SimState` base64 now also works
  without Node's `Buffer`. Node still uses `Buffer`, so checkpoints are
  byte-identical.

**Tests:**

| File | What it covers |
|---|---|
| `tests/app.core.test.ts` | Field metadata, series, profiles, validation, seed ranges against every UB-0 plan, flattening, exports, comparison, library |
| `tests/app.session.test.ts` | The session against the real engine: a full static-box run, reproducibility, stop, the Universe B refusal, checkpoint and resume through JSON |
| `tests/experiments.ubinstrument.test.ts` | The instrument, its lock, checkpoint and resume, and the browser base64 path |
| `tests/architecture.test.ts` | The app layer imports no benchmarks and mentions no classical aerodynamic method |
| `scripts/smoke-app.mjs` | Drives the built app in Chromium |

## Performance

Measured in the smoke test (headless Chromium, one worker, this container):

| Run | Throughput |
|---|---|
| Quick static box, 400 particles | about 15 000 steps/s, finishing in about 1–2 s of compute |
| Quick Couette, 400 particles, 3 seeds | about 11 000 steps/s |
| UB-0 instrument quick static box, 229 particles | about 18 000 steps/s |

The view redraws at up to 30 frames per second, independently of the
simulation rate. Time per step grows roughly with the particle count, and
above 20 000 particles the configuration warns that the run will be slow.
Field accumulation costs well under 1 ms per frame at these sizes.
