# Flow-guided geometry (experimental)

A second workspace of the laboratory application. It lets a surface develop one
small, reversible step at a time, each step guided by what the particle
simulation measured near the previous surface. **It is a measurement and
visualisation foundation for a research question, not a design tool.** Nothing in
it is validated, no geometry it produces is optimised, and it says nothing about
airfoil performance.

Open it from the application with the **FLOW-GUIDED GEOMETRY A · PARTICLES** tab (`npm start`,
then http://localhost:5173). Universe A only; Universe B stays locked and no
judged Universe B experiment can be started from here. A second tab, **FLOW-GUIDED
GEOMETRY B · CFD**, runs the same construction with a conventional CFD solver instead of the
particle engine; it is described at the end of this document and shares nothing with the
particle research.

## What the question is

> If a surface is built by adding material only where the measured near-wall
> particle flow runs backwards, and each addition is then tested by simulating
> the new surface, what does the flow do?

The workflow, one cycle:

1. **Simulate** the current geometry (first: the rounded plate) with the real
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
described; the lift and drag it reports (below) are those of the particle gas and say nothing
reliable about the lift, drag or performance of the real plate. The screen states this next to
every set of inputs, and the inputs are recorded with every run (`scenario` in the run
configuration) for provenance only: the simulation reads none of them.

Length and thickness are fixed when a project starts (they define the plate); changes to
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
| Wake void (do the particles touch the surface?) | `src/measurements/WakeVoid.ts` | **experimental**, tested on synthetic data |
| Live fill (the surface grows during one simulation) | `src/geometry/LiveFill.ts`, `src/experiments/FlowLiveBuildExperiment.ts`, `src/walls/SolidBody.ts` (`reshape`) | **experimental**, tested on the real engine |
| Auto-build (repeat simulate / propose / accept; stops when nothing is measured) | `src/geometry/AutoBuild.ts`, `src/ui/flow/AutoBuildPanel.tsx` | **experimental**, decision logic tested |
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

## Live fill: grow the surface while the simulation runs (experimental)

The backflow detector answers "is there a reversed-flow region?". That is too narrow for separation: classically backflow
starts *downstream* of the separation point, and at a sharp edge the flow leaves the surface with no backflow at all. A
second, simpler question is asked here: **do the particles still touch the surface?**

**The measure `wake-void/0`** (`src/measurements/WakeVoid.ts`, experimental, not validated). From the strip counts the
sampler already collects, for each station: the number density of the layer right at the wall (the first 1 d bin)
relative to the free stream's, the *contact density* θ₀, and the density profile θ(n) with distance from the wall. A
station is **unwetted** when θ₀ is under 0.5 (half the free stream), there is enough exposure to tell (at least 24 counts
expected at free-stream density, pooled over 3 neighbouring stations) and the void is at least 0.5 d. The **gap** is the
distance from the wall to where the density first reaches 0.5 of the free stream: how far the particle cloud stands off
the surface. The **separation point** of this definition is the first station of a run of at least 2 adjacent unwetted
stations, counted from the leading edge. It needs no backflow. The free-stream density is the one the experiment
imposes at its open boundaries (a configuration value, not a classical result). The threshold 0.5 was chosen as the
midpoint after a probe of a flat plate at 30° and 65° (lee density 0.15–0.4 of the free stream against 1–3 on the
windward side); that is recorded here, not hidden. It is an occupancy definition: a fast stream past an inclined plate
leaves a rarefied lee that it calls unwetted, whether or not a classical analysis would call it separated.

**The rule** (`src/geometry/LiveFill.ts`). The fill makes **one pass**. It starts at the separation point found at the first
update (`onset`, kept for the whole run) and a *front* then advances 1.5 d per update to the trailing edge. At every update
(`interval` 40 τ of simulation time) material is added only in a band around the front, from `behind` (3 d) behind it to
`taper` ahead of it:

```
δ(x) = min(maxStep, η · max(0, gap_smooth(x) − margin)) · w_on(x) · w_behind(x) · (1 − w_ahead(x))   then smoothed
```

with η = 0.4, maxStep = 0.5 d, margin = 0.3 d, smoothstep ramps so the new surface leaves and rejoins the old one
tangentially, `gap_smooth` the measured gap smoothed over several stations (three passes of ¼-½-¼), δ smoothed again, and the
last 2 d before the trailing edge never touched (it stays where it is: the fill *converges to* it). Nothing here knows an
airfoil, a Kutta condition or a target shape; the result is a bounded, smooth envelope of the particle cloud.

*What was wrong with the first version, and what changed* (reported by the user as "the live fill is not doing it correctly").
(1) The fill took as its start the *first unwetted station of the latest measurement*. Material makes the particles touch the
new surface, so that station moved downstream ahead of the fill, the fill restarted there, and the surface came out as a
row of separate humps; the start is now fixed at the first update. (2) A station kept getting material for as long as a gap
was measured above it; a thermal gas leaves a *rarefied lee* behind a surface that a fairing need not close (this is the
likely reading, not a separate measurement: the cloud stood off by up to 12 d, the edge of the sampled window, whatever the
fill did), so chasing it outward never ended (in a reproduction with only the start fixed, the surface grew 4–5.5 d thick at
15° and at 30°). A station now receives material only while the front is passing it, so the fill ends when the front reaches
the trailing edge: stop `converged` when the gap there is under 1 d, `swept` when the cloud still stands off the surface (it
says by how much: that is the measurement, not something the fill hides). (3) A single station's gap is a few hundred samples,
so ripples of 0.3–0.5 d in it printed themselves into the surface; the gap and the increment are now smoothed. (4) STOP threw
the shape away; **STOP AND KEEP WHAT IS BUILT** ends the run at once and keeps what has grown (stop `user`), and the old stop is
now called CANCEL.

**Safety, so the engine stays honest** (`PolygonBody.reshape`, `capByParticles`, `fitToLimits`):

- The running polygon is reshaped *in place* (same vertex count, so every measurement tally continues). Particles are
  never moved or removed: material is only added where no particle centre lies within its radius (+ 0.1 d) of the new
  surface. Each particle caps the increment above it, and the real new polygon is checked against every particle before it
  is applied (halving the increment if needed, skipping the update if particles are in the way).
- The thickness, slope and curvature limits are applied **locally** (slope projected exactly, curvature and thickness by
  local reduction), so one tight spot does not stop the rest of the update.
- Integrity checks are part of the record: no particle ever inside the body, the energy and momentum ledgers closed
  (about 1e-14 in tests), the trailing edge unmoved, the other side untouched, the final geometry within its limits.

**The run** (`flow-live-build`, `src/experiments/FlowLiveBuildExperiment.ts`): one builder seed (the first seed + 100), a
start-up on the starting geometry until the wake has developed, then the live updates. It stops when the front has swept
to the trailing edge (`converged` / `swept`), when the void has closed, when nothing was ever unwetted, when it **stalls**
(the front is at the trailing edge and almost nothing more fits: the limits or the particles allow no more while a void is
still left), when particles block it for several updates, when the limits leave no room, at the update limit (30), or when
you press STOP AND KEEP (`user`). The output is a **geometry and the story of how it grew**, not a flow
measurement of it. One seed builds the shape, so another seed can give a slightly different one.

**In the workspace**: the *Live fill* card starts it; you watch the body grow in the particle view, with the separation
point (red) and the front (amber) marked, and a status table (updates, separation point, front, gap). On completion the
shape becomes a new version tagged `live-fill`, with every update kept in the history. It has **no run yet**: simulate it
(three seeds, as for any version) to measure what the new surface does. The comparison with its parent then reports the
prediction the fill stated — *the particles touch the new surface more over the treated stretch* — as supported,
contradicted, unresolved or not applicable, and lists the contact-layer density of both sides. The measurement panel shows
the contact density and the void along the surface for every simulated version. **STOP AND KEEP WHAT IS BUILT** ends the
run and keeps the shape grown so far as a new version; **CANCEL** discards the run.

**What it did in the first real runs, with the first version of the rule** (superseded by the one-pass rule above; kept as the
record of what was observed) (flat plate 30 × 3 d at 30°, stream 2.95 d/τ = Mach 1.6, builder seed 401; one
seed, not judged): the lee side was unwetted from the leading edge on, with the cloud standing 7–12 d off the surface
(12 d is the edge of the sampled window); the fill grew a convex fairing on the upper side, up to about +4 d at 10 d from
the leading edge, flat to about 21 d and back to the trailing edge, in about 20 updates (75 s on a server core). It
**stalls at the curvature limit** with a large void still behind it: the limits (thickness ≤ 12 d, slope ≤ 0.5) do not let the
surface reach the particle cloud there. All integrity checks passed. Whether the resulting shape reduces the void in a fresh
simulation is exactly what the next simulation and the comparison decide.

## Auto-build (experimental)

The **Auto-build** card repeats *simulate → propose → accept* without clicking, and stops by itself when nothing is
measured. It automates the clicking and nothing else: every step uses the construction rule above on the
measurements of the last simulation.

Each cycle:

1. If the current version has not been simulated, simulate it (same seeds and conditions as always).
2. If the run did not pass its numerical-integrity checks, stop (its measurements cannot be trusted).
3. If the requested number of increments (1–10) has been added, stop: finished.
4. Otherwise choose the next stretch (`src/geometry/AutoBuild.ts`, a pure function with tests): a **detector** region
   (candidate separation or better) if either side has one, otherwise — only if "also build from weak measurements" is on —
   an **exploratory** stretch. If several sides qualify, the one with the **strongest measured backflow** (most negative
   region-mean `Q_w`) is chosen. If nothing qualifies, stop: nothing is measured.
5. Propose the increment, trace the construction point along it on screen, accept all of it as a new version, and go back to 1.

It also stops when an increment would break the geometry limits (thickness, slope, curvature) and when you press STOP
(which also ends a running simulation). Repeating increments over the same stretch soon reaches the curvature limit, which
is reported as a stop in plain words, with everything built so far kept.

What it does **not** do: it has no objective, never compares versions to decide what to build, and calls nothing
optimised. After each re-simulation the log reports the comparison's verdict on the prediction the increment stated in
advance (supported / contradicted / unresolved), but the verdict does not steer. Weak-measurement increments are tagged
EXPLORATORY in the history (as for hand-made ones): they respond to flux that is negative but not significantly so,
which noise alone can produce, and the log says so each time. The decisions use the same experimental detector and the same
unvalidated construction rule as the manual workflow.

With the quick preset at 65° the detector does not reach a candidate region, so "detector evidence only" stops after the first
simulation and builds nothing; with weak measurements allowed it builds small increments (about one particle diameter each).
A cycle takes about as long as one simulation (a few minutes at the default size).

## The rounded plate and the construction pointer

**The starting body is a slot shape, not a rectangle.** Both ends are half-circles: the
*thickness* is the diameter of the two end circles and the *length* is the distance between their
centres plus one diameter (a 20 × 2 cm plate has 2 cm end circles with centres 18 cm apart). In
the particle simulation (30 × 3 particle diameters by default) the round ends are made of several
short straight edges, so a shoulder drawn in centimetres is resolved only to about one particle
diameter (`src/geometry/Pointer.ts`, `plateGeometry`). Projects made before this change keep their
flat plates and open as before.

**The pointer.** Construction always starts at the leading edge. A pointer starts on top of the
leading circle (plate frame: origin at the centre of the leading circle, `x` along the plate, `y`
the height above the plate's own surface) and moves along the plate and outward. Material is only
added: the pointer never goes below the plate, and it only moves forward. Every position it has
been placed at is kept. The drawn curve passes through them, joined by cubic curves with equal
tangents, so the surface has no corner at the pointer.

**The tether.** From the pointer a straight line (the tether) runs to the *anchor*, the top of the
trailing circle, where its flat edge meets the circle. At every pointer position the curve arrives
and leaves tangent to the tether. Where the pointer has not been, the surface is the tether itself,
so the body is always a complete closed shape and the trailing end never moves. With the pointer
on the plate (the start) nothing has been added. The anchor is a construction constraint chosen by
the user (the plate's own trailing-edge geometry), not a flow law: no Kutta condition, circulation
or airfoil family is built in, and nothing about the flow decides it.

**Who moves the pointer.** By hand (position along the plate and height, with a preview), by one
**automatic step**, or by a **sweep** that repeats simulate → step → simulate until the pointer
reaches the anchor. The rule (`planPointerStep`) is stated, not tuned: the pointer advances a fixed
step along the plate, and rises above the *current* surface there by a fraction of the measured
gap between that surface and the flow (at most a fixed rise per step), and not at all where
nothing is measured, in which case the curve follows the surface already there. In the particle
workspace the gap is the wake void (`wake-void/0`, experimental); in the CFD workspace it is the
height of the dividing streamline of the time-mean flow. The rule has no goal, never compares
shapes, and is a hypothesis generator like the older construction rules: each pointer version states
a prediction (the particles touch the surface more, or the reversed-flow region is thinner, over the
stretch just drawn) and the next simulation decides.

**Geometry representation.** The body is still two graph curves over the chord, now with non-uniform
stations (closer around the round ends), the two sides meeting in a single point at each tip (no end
faces), and a *free range* of stations (the straight stretch between the circles) that the older
increment rules (proposals, live fill, auto-build) may change; those rules leave the round ends alone.
A version drawn by the pointer remembers its plate and pointer paths; after an older-rule increment the
geometry is no longer plate-plus-paths and the pointer panel says so.

**Two diameters.** The leading and the trailing round end can have **different diameters** (the optional
"trailing edge thickness" box beside the plate thickness; empty = the same). The length is the distance between the two
centres plus the two radii, and the body is the hull of the two circles: they are joined by the straight edges that touch
both (a plate that tapers when the trailing end is thinner). The pointer starts, and the anchor sits, where those straight
edges leave and meet the circles (the tops of the circles when the diameters are equal, so equal-diameter plates and all
saved projects are unchanged). The plate's own surface, below which material is never added, is the circles and that edge
(`baseHeight`). The plate must be at least as long as the two radii plus the thicker diameter. In the particle model the
trailing end is drawn from one particle diameter across (a note says when it had to be changed); in the CFD it is at least
a few lattice cells across.

**Three dots and two arcs.** On each side there are three points: the **red dot** is where the drawn curve now ends (the last
place the pointer was put), the **pointer** is where it goes next, and the **green dot** is the anchor the tether (a rope) is
tied to. All three can be changed, by typing (in centimetres) or by **dragging them on the picture** (a drag fills in the same
boxes, with the same preview and checks):
- the **pointer**: where the arc from the red dot ends and the rope begins;
- the **red dot**: re-places the last placed point (the first red dot sits where the straight edge leaves the leading circle and
  cannot be moved, but its direction can be set);
- the **green dot**: anywhere above the plate from the red dot to the top of the trailing circle; the surface runs to it along the
  rope and then along a straight line that touches the trailing circle (a small corner at the green dot is possible: it is a pin);
  one button puts it back;
- the **arc**: between consecutive points it is a cubic whose direction at each end is set by the person (degrees from the plate
  axis, positive outward, at most 80° so the surface stays a graph over the plate) or, when left empty, along the rope. A point
  has one direction, shared by the arc arriving at it and the arc leaving it, so there is no corner at a placed point.
Every change is a new version with its own words in the history (undo goes back; nothing is deleted). The anchor and the
directions are construction choices, not flow laws; nothing about the flow decides them.

**What is not claimed.** The pointer path is not an optimum, no shape it makes is optimised, and
nothing about it has been validated.

## Streamlines of the mean flow

Both workspaces can draw streamlines of the time-mean flow of the viewed version
(`src/measurements/Streamlines.ts`): lines everywhere tangent to the seed- and time-averaged cell
velocity, integrated with a fourth-order Runge–Kutta step through the bilinearly interpolated field and
laid out evenly (a seed too close to an existing line is dropped; a line ends at the body, at stagnation,
where it meets another line, or where it closes on itself). In the particle workspace this is the
"average particle path traced": the path of the *mean* motion. A single particle does not follow it (it
moves thermally and collides), and where a cell holds few samples a line wanders; the screen says so. The
CFD workspace uses the same tracer on its time-mean velocity.

**During a run.** The streamlines box also works while a simulation is going (it is greyed out only when nothing has been
computed and nothing is running, and the screen says why). In the particle workspace the lines are those of the *running
average* of the cell velocity since the run began (start-up included, so rough at first; redrawn about every 1.5 s) and are
replaced by the measured mean of the measurement window and the seeds when the run ends. In the CFD workspace they are
streamlines of the velocity *at this instant* (redrawn about every 2 s; behind a plate the instantaneous flow sheds vortices, so they
move) and are replaced by the streamlines of the time-mean velocity when the run ends.

## Lift and drag (measured in the simulation, scaled for orientation only)

**In newtons and in kilogram-force.** Wherever the scaled lift and drag are given in newtons (the forces table, the comparison
tables, the history lines) the same force is given in kilogram-force (kgf = N / 9.80665): the weight in kg that would press on a
scale with that force. It is a unit of force, not a mass of the wing or of the air, and it is as much a scaled estimate as the newtons.

**What is measured.** The body is fixed in a stream along +x and every particle that hits it hands
it momentum. The force on the body is the measured momentum-transfer rate (the body's own impulse
tallies per unit time, already conserved against the particles' momentum; see `walls/SolidBody`),
averaged over the measurement window and the seeds:

- **drag**: the force along the stream (+x, downstream);
- **lift**: the force across the stream (+y; for a body at a positive angle of attack this is
  upward).

The simulation is **two-dimensional**, so both are forces **per unit depth** (`src/geometry/Forces.ts`).
No pressure distribution is integrated and no classical formula is used. A force is made
dimensionless only with the simulation's own reference force, the dynamic pressure of the stream the
experiment imposes times the chord,

    F_ref = ½ · ρ∞ · U∞² · c,   ρ∞ = n∞ m = (φ / π r²) m,   U∞ = the imposed stream speed,

giving a *drag coefficient* and a *lift coefficient of this simulated gas* (± 1 standard error).
They are measurements of this particle gas at its own Reynolds, Mach and Knudsen numbers, and need
not carry over to any other regime.

**Wing depth.** The inputs ask for the depth (span) of the wing in cm. It does not enter the
simulation (the engine is 2-D); it only multiplies the per-unit-depth numbers. It is stored in the
project (`wingDepthCm`, default 100 cm) and changing it is not a change of conditions.

**Atmospheric air.** The air state comes from the entered temperature and height through the
International Standard Atmosphere (`src/benchmarks/AirReference.ts`, a comparison and scaling aid; it
is never used by the dynamics). The scaled values are

    F = C · ½ · ρ_air · U_wind² · (plate length × wing depth),

for each of lift and drag, with the plate length and wind from the plain inputs. They are labelled
**SCALED ESTIMATE · NOT A PREDICTION**: they put the simulation's coefficients into units one can
picture (newtons), no more.

**Why it is not a prediction.** The coefficients come from a gas with Reynolds number about 11,
Knudsen number about 0.19 and Mach number about 0.55, while the real wing is at Reynolds number
10⁴–10⁶ and Knudsen number about 10⁻⁷. A 2-D simulation also has no end effects, which a real wing of
finite depth does. A force coefficient measured in one regime is not a force coefficient in another.
No composite score and no lift-to-drag ranking is made; nothing is optimised.

Where it is shown: the *Measurements* tab (table: measured, coefficient, your wing in your air), one
line per simulated version in the *History* tab, and *Lift and drag of A and B* in the comparison
(each with B − A ± se and z; |z| < 2 is unresolved). The force numbers are part of the stored run
(`forces` and `conditions`), so they are reproducible from the same configuration and seeds.
`tests/forces.test.ts` checks the definitions, the scaling (a 36 km/h wind in 15 °C air on a 20 × 100
cm wing at C = 1 gives 12.25 N), the linearity in depth and wind speed squared, and that thin air
gives less.

## Comparing versions

For parent → child: station-by-station changes of `u₁`, `Q_w`, wall shear and
wall pressure (difference, SE, z); the force on the body along and across the stream (the measured
impulse rate, plus its coefficients; see *Lift and drag*); the mean `Q_w` of each side;
the detector level and region of each; the integrity status and momentum/energy
residuals of both runs; the mean density, velocity and temperature fields of
both runs and their difference; and notes for anything that weakens the
comparison (different seeds, different conditions or code version, a failed
integrity check). The difference of two independent runs has SE √(se_A² + se_B²)
(conservative where seeds are shared); `z = Δ/SE` is a scale, with `|z| < 2`
reported as *unresolved*.

There is **no composite score** and no "better". The only judgement made is on
the single prediction the construction step stated in advance: **supported**,
**contradicted**, **unresolved** or **not applicable**. Lift and drag are reported
separately, with no lift-to-drag ratio or ranking; nothing is optimised and no geometry is called
optimised.

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

## Flow-guided geometry B: conventional CFD (separate from the particle research)

The second construction workspace computes the flow with a **conventional CFD solver** instead of the
particle engine. It was added at the user's explicit request ("forget our universes and use actual fluid
mechanics"); it does **not** replace the particle engine, which is unchanged, and it shares no code with
it (`src/cfd/` imports nothing from `core`, `gas`, `walls`, `occupancy` or `benchmarks`;
`tests/cfd.guards.test.ts`). It has no particles, no model units and no Universe A or B, and its results
are not evidence about the particle model or the UB-0 plan. Universe B stays locked.

**What it solves.** The incompressible Navier–Stokes equations on a square lattice by the lattice
Boltzmann method (D2Q9, two-relaxation-time collision with the "magic" parameter 3/16, kinematic viscosity
ν = (τ − ½)/3; `src/cfd/Lbm.ts`). Walls are no-slip with the linear-interpolation bounce-back of Bouzidi,
Firdaouss and Lallemand, so a tilted or curved wall sits where the polygon puts it (the fraction of every
wall link is computed from the geometry, `Raster.ts`). The force on the body is the momentum exchanged with
its surface. Boundaries: Zou–He velocity inflow at the free-stream speed, zero-gradient outflow behind an absorbing layer (the
relaxation time rises over the last two plate lengths, so a vortex leaving the domain is smeared out by viscosity
and sends nothing back; without it the shedding of a cylinder at Re = 100 showed slow amplitude modulations from
reflections, and with it the lift oscillates steadily), slip walls at top and bottom (a channel: the blockage
of the body is reported with every run).
Nothing that decides the flow is imposed: no Kutta condition, no circulation, no separation point.

**Measurements** (`CfdRun.ts`, `Walls.ts`). After a start-up of 10–14 flow-throughs of the plate, a window
of 20–26 more is split into 8 time blocks. Per block: the mean force (momentum exchange), the mean fields,
and, for each station of both sides, the velocity profile along the surface normal. From the profiles:
the wall shear C_f = τ / (½ρU²) along the downstream tangent (one-sided second-order difference through
u(0) = 0), the pressure coefficient beside the wall, and the *dividing streamline*: the height where the
flux along the surface returns to zero after a reversed stretch (a lower bound where it does not return
within the sampled height). **Separation** is read from the sign of C_f: a stagnation point where it turns
positive after a reversed stretch at the leading edge, separation where it turns significantly negative
(|z| ≥ 2 on the block spread) after forward flow, reattachment where it turns positive again. Uncertainties
are standard errors of the block means; the solver is deterministic, so there is no seed.

**Reynolds number.** The plain inputs give the Reynolds number of your plate in your air,
Re = ρUL/μ, from the standard-atmosphere air at your temperature and height (comparison and scaling only).
The run uses it exactly if the resolution can run it (ν ≥ 0.0075 in lattice units, below which the scheme was
found unstable here; 384 / 512 / 768 for 48 / 64 / 96 cells along the plate at the lattice speed 0.06) and
otherwise the largest it can. A 20 cm plate in 36 km/h air has Re ≈ 1.4 × 10⁵, so the run is at Re = 384 …
768 and the screen says how much lower that is. At the real Reynolds number the boundary layer is turbulent
and the flow can separate elsewhere; **a result is the flow of a fluid at the run's Reynolds number, in
two dimensions, not the flow around your plate.** Lift and drag are scaled to newtons for your wing depth and
your air exactly as in the particle workspace, and are labelled a scaled estimate, not a prediction.

**What was checked** (`tests/cfd.lbm.test.ts`, `tests/cfd.run.test.ts`).
- Poiseuille flow between two walls follows the parabola to four digits with the walls halfway between nodes,
  and to 3 % with walls cut at a fifth of a link.
- Mass is conserved in a periodic box; a fluid at rest stays at rest.
- The circular cylinder at Re = 20 is steady with C_d = 2.28 (published, unconfined: about 2.05; the box has 7 %
  blockage). At Re = 100 it sheds vortices at Strouhal number 0.174–0.176 and has C_d = 1.50–1.53 in the same box,
  1.46 at 3.6 % blockage (published, unconfined: 0.165 and 1.34). The values do not change with resolution
  (10, 16, 24 cells across the cylinder give C_d = 1.51, 1.53, 1.50): the differences from the published
  values are the confinement of the slip walls and the outflow condition, not the resolution.
- With the absorbing layer in front of the outflow the lift of the cylinder oscillates steadily (amplitude 0.43 against the published
  0.33 for unconfined flow; confinement raises it) and C_d = 1.48, St = 0.175; without it the amplitude modulated slowly between
  0.3 and 0.64 (reflections from the outflow).
- A plate parallel to the stream (0°, Re = 384) has C_d = 0.24 and no lift (to three digits): the friction drag of two sides of a
  laminar plate is 2 × 1.328 / √Re = 0.14 (based on the plate length), and the round ends and the thickness add the rest.
- **Confinement.** The channel is 6 plate lengths high (the blockage of the body is shown with every run). For the default plate at
  65° the computed force coefficients fall as the channel is raised: resultant coefficient 3.80 at 6 plate lengths (blockage 15 %),
  3.34 at 10 (9 %); a stream confined by slip walls is accelerated past a bluff body. Quantitative comparison of two shapes needs the
  same channel for both, which the project guarantees; absolute values are inflated by the confinement, and a run above 10 % blockage
  is marked with a warning.
- **Not validated:** the fluctuating lift of the cylinder beyond the numbers above; any flat-plate or inclined-plate result against measurements; any Reynolds number
  above the cap; turbulence (none is modelled). The cylinder checks say the solver solves the equations it
  claims to; they do not say that the plate results are right.

**Auto fill (CFD).** The pointer can also move by itself *during one CFD run* (`src/cfd/CfdFill.ts`, `LbmSolver.reshape`). The flow
first develops around the starting body (the run's own warm-up). Then, again and again: the velocity is averaged over a short window
(1.5 convective times), the dividing streamline of the reversed flow beside the surface gives the gap along the side, the same pointer
rule as the measured step (`planPointerStep`) moves the pointer one step toward the anchor and up by a fraction of the gap above the
surface, the body is redrawn through the new position, rasterised again and given to the running solver (nodes that become solid are
masked, the fluid in them is removed), and the flow gets 1 convective time to adjust before the next window. It stops at the anchor:
**one pass**, a station is passed once and never filled again, so it cannot keep growing after a vortex that a surface does not close.
STOP AND KEEP ends it at once and keeps the shape drawn so far; CANCEL discards the run. The result is a **shape** (a new version made
of all the pointer moves, with the story of each) and not a measurement of it: the flow around a body that changed during the run is a
transient, so the shape is **computed afresh** (an ordinary run with its own start-up, started automatically unless switched off) and
only that run's numbers say what the shape does. At 25° on a small, coarse run the dividing streamline stood about 10 d (the reach of the
sampled profile, so a lower bound) above the surface along the whole side and the pointer rose by its limit of 1 d per move: the fill
does not close such a region, and says so.

**Status.** Experimental. The forces and the wall measurements of a plate are computed numbers with
the stated limits, no more.

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
