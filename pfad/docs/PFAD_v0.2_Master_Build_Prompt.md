# CLAUDE CODE OPUS MASTER BUILD PROMPT
# PFAD v0.2
## Particle-Field Airfoil Design Experimental Laboratory

You are the lead computational physicist, numerical engineer, and software architect for PFAD: Particle-Field Airfoil Design.

Use the accompanying document:

**PFAD_v0.2_Experimental_Physics_Bible.md**

as the canonical project specification.

Your task is to build a real, reproducible scientific laboratory, not a mockup, animation, or conventional CFD wrapper.

---

# 1. CORE MISSION

PFAD is an experimental attempt to derive wing-scale aerodynamic behavior from a microscopic particle universe.

The intended chain is:

PARTICLE MECHANICS
→ STATISTICAL PARCEL BEHAVIOR
→ EMERGENT PRESSURE / MOMENTUM TRANSPORT
→ EMERGENT VISCOSITY
→ BOUNDARY LAYER
→ SEPARATION
→ TRAILING-EDGE BEHAVIOR
→ AIRFOIL DESIGN

Do not jump directly to airfoil optimization.

The first deliverable is a particle-physics experimental laboratory.

---

# 2. ABSOLUTE RULE: NO HIDDEN CLASSICAL AERODYNAMICS

Do not use the following as the PFAD governing solver:

- Bernoulli
- Navier-Stokes
- potential flow
- circulation theory
- thin-airfoil theory
- empirical CL/CD
- NACA formulas
- XFOIL
- airfoil lookup tables
- conventional CFD solvers

Classical theory may be implemented in a clearly separated:

/benchmarks

module for comparison only.

If any conventional relation is used for initialization, scaling, or validation, label exactly where and why.

Never let benchmark data enter the discovery loop.

---

# 3. FIRST: INSPECT THE REPOSITORY

Before writing major code:

- inspect repository structure
- identify language/framework
- identify package manager
- identify test framework
- identify renderer
- identify existing numerical infrastructure
- identify build commands
- preserve useful existing architecture

If empty, choose a practical browser-first architecture.

Preferred default:

TypeScript
React
Vite
Canvas/WebGL/WebGPU
Web Worker
typed arrays

But use the existing project stack if one exists.

---

# 4. CREATE THE CANONICAL DOCUMENTATION

If missing, create:

docs/PFAD_v0.2_Experimental_Physics_Bible.md

Do not alter the scientific content casually.

If an implementation requires changing a physical assumption:

1. document the reason
2. create an explicit model version
3. add an experiment
4. do not silently change behavior

---

# 5. BUILD PHASE 0 FIRST

The initial product must be:

**PFAD Experimental Laboratory**

Not:

**Airfoil Generator**

The lab must let us experimentally determine whether the microscopic model can produce:

1. pressure
2. stable thermal behavior
3. sound/disturbance propagation
4. viscosity
5. wall momentum transfer
6. boundary layers
7. separation
8. trailing-edge behavior

Only after this should airfoil optimization become active.

---

# 6. ARCHITECTURE

Use modular physical models.

Suggested structure:

src/
  core/
    Vector2
    ParticleState
    ParticleStore
    CollisionModel
    DeformationModel
    Integrator
    SpatialGrid

  gas/
    GasModel
    ThermalModel
    ParcelModel
    EquationOfStateMeasurement

  occupancy/
    OccupancyField
    OccupancyKernel
    OccupancyGradient
    OccupancyModel

  walls/
    WallModel
    SpecularWall
    DiffuseWall
    AccommodationModel

  measurements/
    PressureEstimator
    MomentumFlux
    EnergyMonitor
    ViscosityEstimator
    SoundSpeedEstimator
    BoundaryLayerAnalyzer
    SeparationAnalyzer
    WakeAnalyzer
    Statistics

  experiments/
    StaticBoxExperiment
    EnergyExperiment
    ThermalExperiment
    PressurePulseExperiment
    CouetteExperiment
    BoundaryLayerExperiment
    AdverseGradientExperiment
    KuttaExperiment
    ScalingExperiment

  geometry/
    Surface
    FlatPlate
    SplineGeometry
    GeometryConstraints

  optimization/
    Objective
    GeometryMutator
    Optimizer

  validation/
    Benchmarks
    Convergence
    RegressionTests

  workers/
    simulation.worker

  ui/
    Lab
    ParticleView
    FieldView
    ExperimentPanel
    MetricsPanel
    ParticleInspector
    Charts
    ExportPanel

Keep physics independent of UI.

---

# 7. PARTICLE ENGINE

Implement particle state using typed arrays where performance requires it.

At minimum:

x
y
vx
vy
mass
radius
energy
deformation

Avoid one heavyweight object per particle if particle counts make that inefficient.

Implement a uniform spatial grid/spatial hash.

Never use O(N²) collision detection for the main simulation.

---

# 8. COLLISION LAW

Implement:

vr = v1-v2

vn = dot(vr,n)

J = -(1+e)*vn/(1/m1 + 1/m2)

v1' = v1 + (J/m1)n

v2' = v2 - (J/m2)n

Record every collision's:

- impulse
- momentum change
- kinetic-energy change
- normal velocity
- collision position

Create tests for:

- momentum conservation
- e = 1 energy conservation
- e < 1 energy loss
- symmetry
- deterministic replay

---

# 9. UNIVERSE A

Implement a molecular-like mode:

e = 1
occupancy force = OFF

Pressure must arise from collision momentum transfer.

Create a static box.

Randomize initial velocities according to a documented distribution.

Measure wall pressure.

Do NOT calculate pressure from n*k*T.

You may calculate n*k*T separately as a benchmark.

The measured result must come from wall impulses.

---

# 10. STATIC BOX EXPERIMENT

Reproduce the reported reference experiment:

N = 2000 disks
initial occupancy ≈ 5%
seed = 7

Run sufficiently long for statistical averaging.

Report:

measured pressure
benchmark kinetic pressure
ratio
standard deviation
confidence interval
collision count per particle
energy drift
momentum drift

Then repeat with:

e = 0.99
e = 0.9

Plot pressure versus collision count per particle.

Do not hard-code the reported decay values.

The experiment must discover them.

---

# 11. THERMAL MODEL

Implement particle kinetic-energy statistics.

Calculate a model temperature proxy from the particle ensemble.

Keep the definition documented.

Test:

- equilibrium
- temperature dependence
- density dependence
- initial-distribution dependence

Do not assume the macroscopic equation of state is correct merely because the static box matches it.

---

# 12. UNIVERSE B

Implement coarse-parcel mode.

Particles represent statistical chunks.

Support:

e < 1

Add an optional internal-energy reservoir.

Energy bookkeeping must be explicit:

collision kinetic energy
→ dissipated parcel energy
→ internal thermal energy

Do not magically inject energy.

Expose the model in the UI.

---

# 13. OCCUPANCY MODEL

Implement as a switchable module.

Default:

OFF

Equation:

F = -ks grad(phi)

Support:

ks = 0

and user-defined ks.

Implement a calibration experiment for:

ks = m*cp²/phi0

Do not assume this relation is correct.

Compare:

A: collision pressure only
B: collision + occupancy
C: parcel + internal thermal reservoir
D: parcel + occupancy
E: parcel + both

All configurations must be independently measurable.

---

# 14. PRESSURE-PULSE EXPERIMENT

Create a localized density/particle compression.

Release it.

Measure propagation.

Use cross-correlation or another statistically robust estimator.

Return:

cp
uncertainty
front shape
attenuation
dispersion if present

Repeat across:

density
temperature
resolution
stiffness
particle scale

This experiment is essential.

---

# 15. WALL ACCOMMODATION

Implement:

Aw = 0:
specular

Aw = 1:
fully diffuse

Intermediate values:
partial accommodation

Make the model deterministic when a seed is fixed.

Measure:

normal momentum transfer
tangential momentum transfer
energy transfer

Do not call this "viscosity."

It is a microscopic wall interaction parameter.

---

# 16. COUETTE EXPERIMENT

Create two parallel walls.

One moves.

One is stationary.

Use fixed-temperature wall interactions.

Measure:

V(y)

wall shear momentum flux

effective viscosity.

Do not insert a viscosity coefficient into the solver.

Calculate:

mu_eff

from the measured relationship between shear stress and velocity gradient.

Repeat over:

Aw
density
temperature
speed
resolution

Output graphs and regression diagnostics.

---

# 17. BOUNDARY LAYER EXPERIMENT

Use a long flat wall.

Uniform incoming flow.

Measure:

Vt(y)
wall shear
momentum transfer
velocity-gradient scale

Do not impose a textbook boundary-layer profile.

Determine whether a boundary layer emerges.

---

# 18. ADVERSE-GRADIENT EXPERIMENT

Implement a controlled way of producing an adverse pressure/momentum gradient without inserting conventional airfoil equations.

Possible experimental approaches should be modular.

Measure:

outer-flow momentum
near-wall momentum
wall shear
reverse-flow fraction
separation onset

Develop a candidate separation threshold from measured slow-layer momentum.

Do not hard-code the threshold.

The threshold should be a hypothesis generated from data and tested against new runs.

---

# 19. KUTTA DISCOVERY

Build a sharp trailing-edge experiment.

Do not impose:

- Kutta condition
- circulation
- trailing-edge velocity equality

Start from uniform flow.

Allow startup transients.

Measure:

vortex shedding
circulation
tail velocity
surface attachment
wake structure

Determine whether smooth trailing-edge departure emerges.

Only after this experiment may a classical Kutta benchmark be displayed.

---

# 20. NO EMPTY SPACE TEST

Every run records:

phi_min
phi_max
phi_mean
density_min
density_max

Separate:

low pressure
low density
near-zero occupancy

If occupancy collapses toward zero unexpectedly:

flag:

POTENTIAL MODEL / NUMERICAL FAILURE

Do not "fix" it by hiding the result.

---

# 21. NOISE AND STATISTICS

Implement:

- temporal averaging
- spatial averaging
- ensemble averaging
- multiple random seeds
- standard deviation
- confidence intervals

Allow the user to choose:

1 seed
5 seeds
10 seeds
custom

Display the number of independent samples.

A result with high uncertainty must visibly say so.

---

# 22. REYNOLDS / MACH TRACKING

Every experiment must report:

Re_simulation where definable
Re_effective where measurable
Re_physical where physical properties are supplied

Also:

Mp = V/cp

and, where appropriate, a benchmark Mach number.

Never pretend the numerical particle regime is automatically equivalent to a physical wing.

Create a scaling experiment.

Determine whether geometry and flow results converge across scaled particle universes.

---

# 23. CONVERGENCE

Every experiment must support:

particle-count convergence
grid convergence
timestep convergence
domain convergence
averaging convergence

At minimum:

LOW
MEDIUM
HIGH

A result that does not converge is marked:

NOT CONVERGED

Do not feed unconverged results into the airfoil optimizer.

---

# 24. EXPERIMENT DATABASE

Every experiment must be serializable.

Example:

{
  experimentId,
  modelVersion,
  seed,
  timestamp,
  particleCount,
  particleScale,
  density,
  temperature,
  speed,
  geometry,
  wallModel,
  accommodation,
  restitution,
  occupancyModel,
  ks,
  timestep,
  domain,
  duration,
  reynolds,
  mach,
  results,
  uncertainty,
  convergence,
  warnings
}

Allow JSON export.

---

# 25. VISUALIZATION

The particle view should show:

particles
walls
geometry
velocity vectors
trails
collisions

Field overlays:

occupancy
occupancy gradient
density
velocity magnitude
pressure
shear

Clicking a particle should reveal:

ID
position
velocity
momentum
energy
local occupancy
gradient
collision history
trajectory

---

# 26. EXPERIMENT UI

Provide a clear experiment selector:

STATIC PRESSURE
ENERGY
THERMAL EQUILIBRIUM
SOUND SPEED
VISCOSITY
BOUNDARY LAYER
SEPARATION
KUTTA DISCOVERY
SCALING

Each experiment should expose only the parameters relevant to it.

Provide:

RUN
PAUSE
STEP
STOP
RESET
EXPORT

---

# 27. AIRFOIL PHASE

Do not enable optimization until Phase 0 has sufficient validation.

Then implement:

Flat plate
Simple spline
Geometry controls

Represent:

yu(x)
yl(x)

with spline/control points.

Constraints:

- no self-intersection
- positive thickness
- bounded curvature
- connected surface
- valid leading edge
- valid trailing edge

---

# 28. AIRFOIL OPTIMIZER

Start from a simple geometry.

Do not start from a NACA airfoil by default.

Use simulation feedback.

First optimizer:

coordinate perturbation / local search

Loop:

1. generate candidate
2. simulate
3. measure
4. score
5. accept/reject
6. reduce perturbation scale
7. repeat

Store every accepted geometry.

Allow pause/continue.

---

# 29. AIRFOIL OBJECTIVE

Use:

Score =
w_attach*AttachmentScore
+
w_pressure*PressureScore
-
w_drag*DragPenalty
-
w_wake*WakePenalty
-
w_void*VoidPenalty
-
w_geometry*GeometryPenalty
-
w_numerical*InstabilityPenalty

Make weights configurable.

Display score components separately.

Never hide the reason a geometry was selected.

---

# 30. ROUNDED-NOSE HYPOTHESIS

Do not hard-code a rounded nose.

But include an experiment:

compare sharp and progressively rounded noses.

Measure:

leading-edge separation pocket
minimum pressure
pressure recovery
surface attachment
wake
drag

The optimizer may discover a rounded nose.

If it does not, that is a result requiring investigation.

---

# 31. SURFACE FORCE

For each surface segment:

accumulate particle momentum transfer.

Calculate:

F_segment

Then:

pressure = normal_force / area

shear = tangential_force / area

Integrate.

Resolve force into:

lift
drag

relative to the freestream.

Do not use CL or CD formulas inside the solver.

CL/CD may be derived afterward for reporting:

CL = Lift/(qA)

CD = Drag/(qA)

where q is explicitly marked as a reporting normalization, not a solver input.

---

# 32. WAKE ANALYSIS

Measure:

velocity deficit
occupancy disturbance
recirculation
momentum deficit
wake width

Make the wake metric replaceable.

Do not assume wake = empty space.

---

# 33. FINAL AIRFOIL OUTPUT

Generate:

upper surface
lower surface
coordinate CSV
JSON
spline/control points
piecewise mathematical equations
SVG
simulation configuration
optimization history

The UI should display:

MODEL VERSION
REYNOLDS
MACH
CONVERGENCE
UNCERTAINTY
SEPARATION
LIFT
DRAG

and clearly label:

PFAD MODEL PREDICTION

until externally validated.

---

# 34. DEBUGGING / NUMERICAL SAFETY

Detect:

NaN
infinite values
particle explosion
excessive overlap
invalid geometry
negative mass
out-of-domain particles
energy blow-up
momentum drift
occupancy collapse

Stop safely.

Never silently repair catastrophic numerical errors.

---

# 35. PERFORMANCE

Use:

typed arrays
spatial hashing/grid
worker threads
Canvas/WebGL/WebGPU where appropriate

Separate:

simulation timestep
rendering rate

Do not create one DOM node per particle.

Provide a performance overlay:

FPS
simulation steps/sec
particle count
collision count
occupancy computation time
render time
memory
dt
max velocity
energy error
momentum error

---

# 36. TEST SUITE

At minimum:

collision momentum conservation
elastic energy conservation
restitution behavior
wall reflection
wall accommodation
occupancy gradient
uniform free stream
static pressure
thermal equilibrium
pressure pulse
Couette momentum transfer
deterministic seed
resolution convergence
timestep convergence

Tests should run from the command line.

---

# 37. VALIDATION STATUS SYSTEM

Use explicit statuses:

UNTESTED
RUNNING
PASSED
FAILED
INCONCLUSIVE
NOT CONVERGED

Never use "validated" when only a single run agrees with expectation.

---

# 38. DEVELOPMENT ORDER

Implement exactly in this broad order:

STEP 1
Repository inspection + architecture

STEP 2
Vector math + particle storage

STEP 3
Spatial grid

STEP 4
Collision engine

STEP 5
Static box

STEP 6
Pressure measurement

STEP 7
Energy/conservation diagnostics

STEP 8
Thermal statistics

STEP 9
Wall accommodation

STEP 10
Pressure pulse

STEP 11
Couette viscosity

STEP 12
Flat-wall boundary layer

STEP 13
Adverse-gradient experiment

STEP 14
Kutta discovery

STEP 15
Scaling experiments

STEP 16
Curved geometry

STEP 17
Airfoil diagnostics

STEP 18
Inverse optimizer

STEP 19
Export

STEP 20
Polish

Do not skip ahead because the UI looks incomplete.

---

# 39. DEVELOPMENT DISCIPLINE

After each subsystem:

1. run tests
2. run a minimal experiment
3. inspect output
4. record numerical diagnostics
5. fix failures
6. document assumptions

Never write the entire solver before testing it.

Prefer small, verifiable commits.

---

# 40. SCIENTIFIC ADVERSARIAL MODE

Build a feature called:

MODEL A/B TEST

It should allow two models to run under equivalent conditions.

Examples:

Collision only
vs
Collision + occupancy

Specular wall
vs
Diffuse wall

e = 1
vs
e < 1 + thermal reservoir

Different particle resolutions

Different seeds

The result should show:

difference
uncertainty
convergence

This is one of the most important PFAD features.

---

# 41. WHAT NOT TO DO

Do not:

- hard-code expected airfoil shapes
- tune parameters until the result "looks right"
- smooth away physically inconvenient results
- force attachment
- force Kutta behavior
- force a pressure distribution
- hide resolution dependence
- use conventional equations as an invisible correction
- report unconverged optimization as a final result
- confuse a visualization with evidence

---

# 42. ACCEPTANCE CRITERIA FOR PHASE 0

Phase 0 is complete only when the laboratory can:

1. produce stable particle gas
2. measure pressure from impacts
3. quantify energy conservation
4. measure thermal behavior
5. measure disturbance propagation
6. measure effective viscosity
7. demonstrate wall momentum transfer
8. show a boundary layer
9. investigate adverse-gradient separation
10. test Kutta emergence
11. report Re/Mach
12. perform resolution tests
13. reproduce experiments from saved configurations
14. export experiment data
15. clearly distinguish measured results from assumptions

Only then unlock airfoil optimization.

---

# 43. FINAL PRODUCT

The final PFAD system should eventually allow:

Speed = user input
Altitude OR density = user input
AoA = user input
Chord = user input

Then:

GENERATE / OPTIMIZE

The program runs the particle/parcel universe.

It measures:

pressure
momentum
surface velocity
viscosity
attachment
separation
wake

It changes geometry.

It repeats.

The final output is:

yu(x)
yl(x)

plus:

particle visualization
field visualization
pressure
lift
drag
separation
wake
convergence
uncertainty
optimization history

The airfoil is an emergent computational design result.

---

# 44. FINAL RULE

When you encounter an uncertainty, do not invent an answer.

Create:

- a parameter
- a competing model
- an experiment
- a diagnostic
- a test

Then let the data decide.

Begin by inspecting the repository and implementing the smallest scientifically testable piece of Phase 0.
