# Flow-guided geometry (experimental)

A second workspace of the laboratory application. It lets a surface develop one
small, reversible step at a time, each step guided by what the particle
simulation measured near the previous surface. **It is a measurement and
visualisation foundation for a research question, not a design tool.** Nothing in
it is validated, no geometry it produces is optimised, and it says nothing about
airfoil performance.

Open it from the application with the **FLOW-GUIDED GEOMETRY** tab (`npm start`,
then http://localhost:5173). Universe A only; Universe B stays locked and no
judged Universe B experiment can be started from here.

## What the question is

> If a surface is built by adding material only where the measured near-wall
> particle flow runs backwards, and each addition is then tested by simulating
> the new surface, what does the flow do?

The workflow, one cycle:

1. **Simulate** the current geometry (first: a flat plate) with the real
   particle engine, the same seeds and the same flow conditions every time.
2. **Measure** the near-surface flow on both sides (below).
3. **Detect** whether a region of reduced or reversed near-wall flow exists,
   with the evidence the detector has for it. No location is assumed.
4. **Propose** a small bounded increment of the surface over the measured
   region. The proposal states what it expects to happen (its *hypothesis*).
5. Watch the **construction point** move along the new surface (ADVANCE, DRAW,
   TO END, BACK), then **accept** (all, or up to the construction point) or
   **reject**.
6. **Simulate** the new version, then **compare** with its parent. The
   hypothesis is checked against the measurement; the other measured changes
   are listed next to it.
7. Repeat, **undo**, or **replay** the history.

## Setting up in plain units

The first panel takes six numbers: **plate length [cm]**, **plate thickness [cm]**,
**air temperature [°C]**, **height above sea level [m]**, **wind speed [km/h]** and
**angle of attack [°]**. The model-unit controls (density, run length, seeds) are under
"Advanced". Right under the inputs the screen says, in plain words, what the simulation
will actually run and how far that is from the real plate.

What each input does:

| Input | What the simulation does with it |
|---|---|
| length, thickness | Only their **ratio** matters: the plate is drawn with the same length : thickness ratio, in particle diameters (30 d long by default). Ratios from 2 : 1 to 40 : 1 can be drawn; a thinner plate is drawn as 40 : 1 and the screen says so. Thin plates need a bigger model (a 40 : 1 plate is 80 × 2 d, about 16,000 particles, and a version takes many minutes). |
| angle of attack | exactly |
| wind speed | through the **Mach number**: wind ÷ speed of sound in the air you described, times this model's measured sound speed. The particle model needs its standard speed (Mach ≈ 0.55, the speed of every reference run) or more to show a signal above the random thermal motion, and it is only calibrated up to 3 d/τ. A slower wind is run at the slowest usable setting, and the screen says how much faster than yours that is. At sea level and 15 °C the model can follow a wind of about 680 km/h and up. |
| temperature, height | They set the real air (density, speed of sound, viscosity, mean free path) and so the real plate's Mach, Reynolds and Knudsen numbers. They change the simulation **only** through the Mach number above; whenever the wind is below what the model can show, they change nothing in the run itself. |

The comparison table shows Mach, Reynolds and Knudsen for your real plate and for the
simulation:

- Real air values are standard reference formulas (International Standard Atmosphere pressure,
  ideal-gas density, Sutherland viscosity, kinetic-theory mean free path) in
  `src/benchmarks/AirReference.ts`. They are comparison values: nothing inside the particle
  dynamics uses them. The single place a reference value reaches the setup is the Mach
  conversion of the wind speed in `src/experiments/PhysicalScenario.ts`, which is disclosed on
  screen.
- The simulation's values come from this repository's own measurements: sound speed
  1.8076 d/τ (`results/sound-speed_sweeps.json`, case A φ = 0.1, 8 seeds) and effective viscosity
  0.3326 m/(d·τ) (`results/viscosity_reference.json`, base case, 30 seeds). `tests/scenario.test.ts`
  checks the constants against those files and reproduces the Mach and Reynolds numbers
  recorded for the Kutta reference.

**The honest limit.** A real plate of 10–100 cm in air has Knudsen number about 10⁻⁷ and
Reynolds number 10⁴–10⁶. The simulation is a thin 2-D gas of hard disks with Knudsen ≈ 0.19 and
Reynolds ≈ 10–40. The model cannot match all three similarity numbers, so the plain inputs give the
**same shape and angle in a very different flow regime**. A result shows how this particle gas flows
around a plate of that shape. It does not predict how air flows around the plate that was
described, and it says nothing about lift, drag or performance. The screen states this next to
every set of inputs, and the inputs are recorded with every run (`scenario` in the run
configuration) for provenance only: the simulation reads none of them.

Length and thickness are fixed when a project starts (they define the flat plate); changes to
the wind, the air or the angle are applied to the open project and recorded in its history
(`APPLY CHANGES TO THIS PROJECT`), and a comparison across such a change carries a warning.

## What is implemented

| Part | Where | Status |
|---|---|---|
| Surface representation, limits, flat plate | `src/geometry/SurfaceGeometry.ts` | implemented, tested |
| Near-surface flow sampler | `src/measurements/SurfaceFlowSampler.ts` | implemented, tested |
| Separation-region detector `wall-flux-detector/0` | `src/measurements/SeparationDetector.ts` | **experimental, not validated** |
| Construction rule and proposals | `src/geometry/Construction.ts`, `Basis.ts` | **experimental** |
| Version history, undo, replay | `src/geometry/History.ts` | implemented, tested |
| Comparison of two versions | `src/geometry/Compare.ts` | implemented (descriptive) |
| Real-engine experiment `flow-geometry` | `src/experiments/FlowGeometryExperiment.ts` | implemented; a registry experiment like the others |
| Exports (project JSON, SVG, CSV, run record) | `src/geometry/Export.ts`, `src/app/projectStore.ts` | implemented |
| Plain-unit inputs and the comparison with the real situation | `src/experiments/PhysicalScenario.ts`, `src/benchmarks/AirReference.ts`, `src/ui/flow/ScenarioPanel.tsx` | implemented, tested |
| Workspace | `src/ui/FlowGeometry.tsx`, `src/ui/flow/` | implemented |

The existing particle engine is used unchanged except for one new input: the
surface is a polygon built from the geometry, and the experiment rebuilds it for
every run. There is no second engine, no continuum solver, no panel method and
no airfoil theory anywhere in the feature (an architecture test scans
`src/geometry/` and `src/measurements/` for classical-aerodynamics terms and
benchmark imports).

## Does the engine support curved bodies?

Verified, with tests (`tests/geometry.engine.test.ts`), not assumed:

- The only solid in the engine is a straight-edge convex-or-concave polygon
  (`PolygonBody`). A curved surface is a **polyline**; how smooth it is, is
  limited by the number of stations (default: one station per particle
  diameter of chord).
- A smooth lens and a bump with concave junctions were run in equilibrium: no
  particle ends inside the body, the momentum and energy ledgers close
  (< 1e-9), the pressure measured on the surface equals the pressure of the
  gas, and the mean force and mean shear on the body are zero within
  uncertainty. The shear sign convention was checked on both sides.
- Contacts at polygon vertices are point contacts. With a station length of one
  particle diameter the surface is rough on the scale of a mean free path
  (λ ≈ 5.6 d here), which is a property of the model, not of the polyline.

So: curved geometry **is** supported, as a polyline with a bounded vertex
spacing. It is not a smooth analytic curve, and the geometry limits (below)
bound how sharply it may bend.

## What is measured, and how

All near-surface quantities come from particle sums, never from a model.

**Surface-normal strips.** Each side of the body is a polyline from the leading
to the trailing edge. A *station* is one polyline segment. A particle belongs to
a station when its foot point lies on the segment and its distance `n` from it
(along the outward normal) is in the sampled window. Bin `j` covers
`n ∈ [r + jΔn, r + (j+1)Δn)` (`r` the particle radius, `Δn` = 1 d, 12 bins). Per
station, bin and time block the sampler accumulates count, mass, tangential
momentum, normal momentum and energy; every reported quantity is a ratio of
those sums. `u_t` is along the downstream tangent.

**Derived per station** (and their uncertainties):

- `u₁` — mean `u_t` in the first 2 d from the wall;
- `u_o` — mean `u_t` in the outer reference layer (top 3 d of the window);
- `Q_w` — net mass flux along the surface within 4 d of the wall (negative =
  backflow);
- `τ` — downstream wall shear, from the body's own tangential impulse tally
  (negative = the wall is dragged upstream); wall pressure from the normal
  impulse tally;
- `Q(n)` — the cumulative mass flux between the wall and height `n`, and
  `h_ds`, the height at which it returns to zero after a negative excursion:
  the **dividing streamline** of the time-mean flow (a stream-function
  increment). It presumes a statistically stationary flow.

**Uncertainty.** Batch means: the window is split into time blocks (16 by
default), the standard error comes from the block-to-block spread, pooled over
seeds. Block independence is assumed, not tested. A "significant" value is one
whose mean exceeds the two-sided t-critical value times its SE at α = 0.0027
(about 3σ for a normal).

## The detector `wall-flux-detector/0` — EXPERIMENTAL

An **operational** definition: the level names say what was measured, not a
validated physical finding. PFAD's earlier separation study (Item 3) was
**INCONCLUSIVE** and this work does not revise it; this detector has never been
compared with an independent separation criterion.

Levels (each needs the ones below it):

| Level | Criterion |
|---|---|
| `NONE` | no station departs from forward attached flow |
| `REDUCED_FORWARD_VELOCITY` | ≥ 2 adjacent stations where `u₁` is at least 50 % below `u_o`, significantly |
| `LOCAL_REVERSAL` | at least one station with significant backflow (`u₁ < 0` or `Q_w < 0`) that does not make a persistent region |
| `CANDIDATE_SEPARATION` | ≥ 2 adjacent backflow stations whose region-mean `Q_w` is negative in ≥ 75 % of the time blocks |
| `CONFIRMED_OPERATIONAL` | a candidate that also has reversed `u₁` at ≥ half its stations, reversed wall shear at ≥ 50 % of them (an independent measurement), the same sign in ≥ 75 % of blocks in at least 3 seeds, ≥ 400 near-wall samples per station, and the same region (onset within 3 d) in ≥ 3 of 5 analysis variants (station widths 1/2/3 d, 2 normal bins, doubled blocks) |

A single negative velocity is never enough. With fewer than 8 time blocks
standard errors are not estimated and nothing is flagged. Every result carries
its criteria with the measured value and threshold of each, the supporting
measurements, the time window (blocks, snapshots per block, seeds), the
sensitivity to the analysis variants, and the label *EXPERIMENTAL — an
operational definition, not validated against any independent separation
criterion*. The particle model's own resolution (particle size, count) cannot be
varied inside a run; it is tested only by comparing runs, and is not part of the
criteria.

**What was fixed before data and what was not.** The thresholds above were
written down before any flow data from this feature were examined and are
recorded with every result. One *definition* was extended after a first look at
runs at 25–70°: a stalled leeward side has no attached outer layer, so a
reference velocity cannot be measured there. On a **leeward** station (the
imposed stream moves away from the surface) the reference direction is
therefore the component of the **imposed** stream along the surface, `U·t`; on a
**windward** station it is the measured outer flow, which must itself be
significantly forward (so the stagnation flow toward the leading edge below an
inclined body is not flagged). No threshold was changed, and the null-data test
(0 candidates in 120 simulated no-effect data sets, repeated with this
reference) was re-run. This change was made after seeing data and should be
reviewed before the detector is relied on.

### What the detector finds in this regime

Honest status, from real-engine runs of the flat plate at 65° (seeds 301–306 and
301–303): backflow in this model is **weak**, a few hundredths of the thermal
speed, and appears only at large angles of attack (roughly 55° and above). With
the QUICK preset (3 seeds, 240 τ window) the leeward stations have 230–400
near-wall samples, below the 400 a station needs, so **no level above NONE can
be reached by design**; the detector then reports "insufficient evidence", not
"no separation". With the EXTENDED preset (6 seeds, 480 τ, about 3.5 minutes per
version) the upper side reaches `REDUCED_FORWARD_VELOCITY` over x ≈ 2–30 d, with
pooled flux `Q_w` ≈ −0.008 over x ≈ 8–20 d that is *not* significant. No
`CANDIDATE_SEPARATION` has been obtained at the sizes a browser can run. The
regime is slip/transitional (Kn ≈ 0.19 on a 30 d chord, Re ≈ 10–22), not a
continuum boundary layer, so a detached "dead-air" region in the continuum sense
is not expected here at all.

## From a measurement to a surface: the construction rule

A separation point is a place where the flow leaves the wall; it is not a point
on the final surface, and joining it to the trailing edge would simply impose a
shape. The measured quantity with a geometric meaning is the **dividing
streamline** of the time-mean flow: the surface of zero net flux that bounds
the recirculating region. The rule tests one specific hypothesis with it: *that
the flow around a surface with that material added no longer carries the
backflow it carried around the old one.*

For one side, over the stretch where the measured flux is reversed:

```
δ(x) = min(maxStep, η · max(0, h(x) − shrink · se(x))) · w_on(x) · w_off(x)
```

- `h(x)`, `se(x)` — measured dividing-streamline height and its standard error;
- `η` (0.5) — fraction of the measured height applied per increment;
- `maxStep` (1 d) — the most added at any station in one increment;
- `shrink` (1) — standard errors subtracted in detector mode (0 in exploratory);
- `w_on`, `w_off` — smoothstep ramps from the onset of the measured region and
  back to zero after its end, so the new surface leaves and rejoins the old one
  tangentially;
- the leading `leReserve` and trailing `teReserve` stretches are never
  modified: **the trailing edge is held fixed and nothing is imposed there**.

The material is added along the surface normal on the chosen side. The
**construction point** you watch is that increment traced from the onset of the
measured region toward the trailing edge, with, at each point, the old and new
surface height, the added height, and the measured `h_ds` that motivated it.

Bounds: local thickness (1.5–12 d), slope (|dy/dx| ≤ 0.5) and curvature (|second
difference|/dx ≤ 0.35). If an increment would exceed them it is scaled down
uniformly; if no scale fits there is no proposal. The rule is a pure function,
so the same measurement gives the same proposal.

Two evidence modes:

- **Follow the detector** — available only when the detector reports
  `CANDIDATE_SEPARATION` or better on that side; uses the significance-gated
  heights.
- **Exploratory** — labelled *below evidence* everywhere it appears. It uses
  the stretch where the forward outer flow coexists with a negative but not
  significant pooled flux, and the point estimates of `h_ds`, which noise alone
  can produce. It exists so the loop can be exercised at the statistics a
  browser run affords. A proposal made this way is a hypothesis test, not a
  response to a detection.

## Comparing versions

For parent → child: station-by-station changes of `u₁`, `Q_w`, wall shear and
wall pressure (difference, SE, z); the tracked force on the body (the measured
impulse rate, **not** lift or drag coefficients); the mean `Q_w` of each side;
the detector level and region of each; the integrity status and momentum/energy
residuals of both runs; the mean density, velocity and temperature fields of
both runs and their difference; and notes for anything that weakens the
comparison (different seeds, different conditions or code version, a failed
integrity check). The difference of two independent runs has SE √(se_A² + se_B²)
(conservative where seeds are shared); `z = Δ/SE` is a scale, with `|z| < 2`
reported as *unresolved*.

There is **no composite score** and no "better". The only judgement made is on
the single prediction the construction step stated in advance: **supported**,
**contradicted**, **unresolved** or **not applicable**. Lift, drag and L/D are
not computed and nothing is optimised; no geometry is called optimised.

## History and reproducibility

A project is an append-only record; nothing is deleted. It keeps, per version:
the geometry points, the surface parameters, the parent, the step number, the
reason, the accepted/rejected/undone status, the proposal and the measurements
that motivated it, the detector output, the simulation configuration and seeds,
the run id and the code and model version, the measured changes against the
parent, uncertainties and the validation status. **Undo** moves the head back to
the parent and marks the undone version, which stays in the record. A change of
flow conditions is itself logged (with its reason) and a comparison across it
carries a warning. Every simulation uses fixed seeds; re-running a version with
the same seeds and code reproduces its record exactly (the engine is
deterministic given its seeds).

Exports: the project **JSON** (optionally embedding the full run records, and
re-importable), the geometry **SVG** (old and new outline, the construction
point), a **CSV** of the sampled surface coordinates with a provenance header,
and the run record JSON. Imported reference outlines (CSV `x,upper,lower`) are
drawn dashed in violet, tagged *IMPORTED — not constructed by PFAD*, and are
never part of the construction path.

Projects are kept in the browser (IndexedDB, version 2 of the library
database) and survive a reload.

## Performance and limits

- QUICK preset (3 seeds, 240 τ window, ~2,300 particles): about 1 min per version
  in a modern machine's worker, with the UI responsive (frames stream while it
  runs; PAUSE/RESUME/STOP work).
- EXTENDED preset (6 seeds, 480 τ): about 3.5 minutes per version.
- A chord of 30 d in a 180 × 100 d box. Larger chords cost more than linearly.
- Each version needs a fresh simulation before the next increment.
- Statistical power is the limiting factor, not rendering (see above).

## What remains unvalidated, and open scientific questions

1. **The detector is not validated** against any independent separation
   criterion, and its positive control is the open item inherited from Item 3.
2. **Weak backflow in this regime.** Whether the Kn ≈ 0.19, Re ≈ 10–22 regime
   of this model has a separation phenomenon that a near-wall-flux definition
   should capture is a physics question this feature does not answer.
3. **Reference direction on the leeward side** was defined after a first look at
   data (above) and needs review.
4. **Sufficiency of the QUICK preset.** It cannot reach `CANDIDATE_SEPARATION`;
   exploratory mode is the labelled workaround.
5. **Stationarity and block independence** are assumed in `h_ds` and in the
   standard errors.
6. **The construction rule** is one choice among many; it tests a hypothesis, it
   does not converge to anything, and "does adding material at the dividing
   streamline reduce backflow?" is exactly what the comparison step measures.
7. **Resolution.** The polyline surface is rough on the mean-free-path scale; the
   effect of station length and particle count on the measurements has not been
   studied.

None of this validates airfoil performance, and none of it unlocks Universe B
or alters the UB-0 plan or its approval interlock.
