# PFAD architecture (Step 1 record)

## Repository inspection

| Question | Finding |
|---|---|
| Existing project | `carbide-grade-estimator`: a single self-contained `index.html` technical report on carbide milling picks, served by GitHub Pages from `main` / root. Unrelated to PFAD. |
| Language / framework | Inline HTML/CSS/JS, no build step |
| Package manager | none |
| Test framework | none |
| Renderer | DOM + inline SVG/canvas inside the report |
| Numerical infrastructure | none reusable (carbide material model only) |
| Build commands | none (static file) |

Decision: nothing in the existing site is reusable for a particle laboratory, and
it must keep working as a static page. PFAD therefore lives in its own
self-contained sub-project, `pfad/`, with its own toolchain. Nothing outside
`pfad/` is modified.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Master prompt default; types document units and records |
| Numerics | Structure-of-arrays `Float64Array`s | No per-particle objects; conservation diagnostics need double precision |
| UI | React + Vite | Master prompt default |
| Rendering | Canvas 2D (one canvas, no DOM node per particle) | Adequate for ≤ 10⁴ disks; WebGL can replace it behind the same view interface |
| Concurrency | Web Worker owns the simulation; UI receives snapshots | Simulation rate independent of render rate |
| Tests | Vitest, `npm test` | Command-line runnable |
| Experiments from CLI | `tsx scripts/run-experiment.ts` | Same experiment code as the UI, headless, writes JSON records |

Commands (run inside `pfad/`):

```
npm install
npm test            # unit + physics tests
npm run typecheck
npm run exp -- <experiment> [--options]   # headless experiment → results/*.json
npm run dev         # laboratory UI
npm run build
```

## Layering rules

```
core/          vectors, RNG, particle store, spatial grid, collision law, integrator
gas/           initial conditions, thermal statistics, parcel/reservoir models
occupancy/     occupancy field + the F = -ks ∇φ hypothesis (switchable, default OFF)
walls/         wall interaction models (specular / diffuse / Maxwell accommodation):
               planar walls, open reservoir boundaries, solid polygon bodies
measurements/  estimators that only READ simulation state (pressure, energy, ...)
experiments/   experiment definitions: setup + measurement + acceptance criteria
benchmarks/    classical / kinetic-theory reference values — COMPARISON ONLY
validation/    status system, convergence studies, regression checks
workers/       simulation worker
ui/            laboratory UI
```

Hard rule (Master prompt §2, Bible §3): `core/`, `gas/`, `occupancy/`, `walls/`
and `measurements/` must never import from `benchmarks/`. Only experiment
*reporting* code may import benchmarks, and every benchmark value is written into
the experiment record under a `benchmarks` key, separate from `results`. This is
enforced by `tests/architecture.test.ts`.

## Dimension

PFAD Phase 0 is implemented in **two dimensions** (disks). This is a documented
deviation from the Bible's 3D formulas — see `MODEL_ASSUMPTIONS.md`, A-02.
