# PFAD v0.2
# PARTICLE-FIELD AIRFOIL DESIGN
## The Experimental Physics Bible
### Canonical specification for Claude Code Opus

Version: 0.2
Status: Experimental / pre-validation
Project principle:

> Do not assume the macroscopic aerodynamic laws we are trying to understand.
> Build a microscopic particle universe, measure what emerges, and only then use
> the resulting behavior to design geometry.

---

# 1. PURPOSE

PFAD (Particle-Field Airfoil Design) is an experimental computational-physics project.

The long-term objective is to create an inverse airfoil-design system in which the airfoil is not selected from conventional families or prescribed by classical aerodynamic equations.

Instead:

particle mechanics
→ statistical parcel behavior
→ emergent pressure / momentum transport / viscosity
→ boundary-layer behavior
→ separation behavior
→ wing-scale flow
→ optimized boundary geometry

The final user experience should eventually allow:

INPUT:
- speed
- altitude OR air density
- angle of attack
- chord
- temperature and other optional fluid properties
- simulation/model settings

OUTPUT:
- optimized upper and lower airfoil geometry
- mathematical curve representation
- coordinates
- particle/parcel visualization
- occupancy field
- velocity field
- particle-derived pressure
- lift
- drag
- separation
- wake diagnostics
- convergence
- model assumptions
- experiment provenance

But airfoil optimization is NOT the first task.

The first task is to determine whether the proposed microscopic universe can reproduce the necessary macroscopic behavior.

---

# 2. SCIENTIFIC CHARTER

PFAD must distinguish four things:

1. ASSUMPTION
2. MODEL IMPLEMENTATION
3. MEASURED RESULT
4. EXTERNAL VALIDATION

Never silently turn one into another.

A simulation result is not automatically a physical truth.

A conventional aerodynamic result may be used as a benchmark, but must not secretly become a governing equation.

Every important result must record:

- model version
- parameters
- random seed
- numerical resolution
- timestep
- Reynolds number
- Mach number
- convergence state
- relevant boundary conditions

---

# 3. WHAT PFAD IS NOT

PFAD v0.2 must not secretly use conventional aerodynamic equations to generate its solution.

Do not use these as the governing solver:

- Bernoulli equation
- Navier-Stokes equations
- potential-flow equations
- circulation theory
- thin-airfoil theory
- empirical lift coefficients
- empirical drag coefficients
- NACA formulas
- XFOIL
- precomputed airfoil databases
- CFD packages that directly solve conventional continuum equations

These may be used later for EXTERNAL VALIDATION.

Example:

PFAD predicts a pressure distribution.

A conventional aerodynamic model predicts another pressure distribution.

Compare them.

Do not feed the conventional answer into PFAD.

---

# 4. THREE LEVELS OF DESCRIPTION

PFAD v0.2 explicitly separates three scales.

## Level 1: Particle

A particle has:

- position x,y
- velocity vx,vy
- mass m
- radius/diameter d
- stiffness K where relevant
- restitution e
- deformation delta
- internal/deformation energy
- collision history

## Level 2: Statistical parcel

A parcel is not necessarily one physical molecule.

It represents a local statistical population.

A parcel may have:

- mean velocity
- density
- occupancy
- kinetic energy / temperature-like state
- momentum
- collision rate
- stress
- local pressure

This is essential because one literal molecule cannot carry a wing-scale flow trajectory.

## Level 3: Wing-scale field

Particle statistics may be coarse-grained into:

rho(x,y)
V(x,y)
P(x,y)
tau(x,y)
phi(x,y)
T(x,y)

The goal is to derive these fields from the lower levels rather than assume them.

---

# 5. TWO COMPETING PFAD UNIVERSES

PFAD must support two conceptual universes.

## Universe A: Jiggling / molecular-like particles

Particles have substantial random thermal motion.

Pressure emerges from collision momentum transfer.

Initial hypothesis:

- ks = 0
- e = 1

for an ideal elastic gas.

In this universe, pressure is not separately manufactured by an occupancy force.

## Universe B: Coarse parcels

Each computational particle represents a statistical parcel.

Particles may have effective inelastic interactions.

Then:

e < 1

may represent momentum redistribution.

However, energy lost from parcel-level collisions must not simply disappear if the resulting universe is intended to represent a stable gas.

An internal energy / thermal reservoir may be required.

The occupancy-restoration term may be retained as a coarse-grained hypothesis:

F_s = -ks grad(phi)

The coefficient must be calibrated rather than assumed.

The two universes must be experimentally comparable.

---

# 6. PARTICLE VARIABLES

Core variables:

Particle diameter:
d

Particle mass:
m

Particle number density:
n

Particle stiffness:
K

Restitution:
e

Interaction radius:
r

Velocity:
v

Momentum:
p = m v

Particle volume:

V_b = pi*d^3/6

Occupancy:

phi = n*pi*d^3/6

Macroscopic density:

rho = n*m

These quantities must be clearly distinguished from numerical resolution parameters.

---

# 7. PRESSURE

Pressure should emerge from momentum transfer.

For a wall segment:

F_wall = total momentum transferred / delta_t

Pressure estimate:

P = F_wall / A

The solver must calculate this from actual particle-wall interactions.

Do not insert Bernoulli pressure.

Do not calculate pressure from an assumed velocity-pressure formula.

The static-box experiment has already shown, in the tested implementation, that elastic particle collisions can generate pressure close to the expected kinetic-theory value.

That result must be treated as an experimental result of the tested configuration, not a universal proof for every PFAD implementation.

---

# 8. STATIC-BOX EXPERIMENT 1

Experiment:
2,000 disks
5% initial occupancy
closed box
fixed random seed = 7
collision model from v0.1
pressure measured from wall impacts

Observed result reported by the experimenter:

e = 1:
pressure approximately 0.997 ± 0.013 of the predicted n*k*T
over approximately 100 collisions per particle.

e < 1:
thermal motion decays and pressure decreases.

Reported approximate decay:
e = 0.99 → pressure halves after approximately 73 collisions/particle
e = 0.9 → pressure halves after approximately 10 collisions/particle

Interpretation:

Universe A strongly supports elastic collision behavior for stable thermal pressure.

Universe B requires an explicit mechanism for internal energy redistribution if e < 1 is used.

This experiment must be reproducible and independently audited.

---

# 9. COLLISION MODEL

For two particles:

relative velocity:

v_r = v1 - v2

collision normal:

n

normal relative velocity:

v_n = dot(v_r,n)

Impulse:

J = -(1+e)*v_n /(1/m1 + 1/m2)

Velocity update:

v1' = v1 + (J/m1)n

v2' = v2 - (J/m2)n

The implementation must test:

- momentum conservation
- restitution behavior
- energy behavior
- numerical stability

Do not silently modify the collision law.

---

# 10. DEFORMATION

Initial contact model:

F_deformation = K*delta

Stored deformation energy:

E_deformation = 0.5*K*delta^2

This is a model component, not a claim that real molecules are literal elastic spheres.

Keep the contact model replaceable.

---

# 11. OCCUPANCY-RESTORATION HYPOTHESIS

The original PFAD hypothesis was:

F_s = -ks*grad(phi)

and:

a_s = -(ks/m)*grad(phi)

v0.2 changes the status of this law.

It is now explicitly:

EXPERIMENTAL COARSE-GRAINING HYPOTHESIS.

Do not assume it is fundamental.

Test:

Universe A:
collision pressure only.

Universe B:
coarse parcels + occupancy law.

If occupancy is used, investigate whether:

ks = m*cp^2/phi0

is a useful calibration relation.

Here cp is the measured particle-model disturbance propagation speed.

Do not assume the relation is correct merely because it is dimensionally plausible.

---

# 12. SOUND / DISTURBANCE SPEED

Run a pressure-pulse experiment.

Create a local density/pressure disturbance.

Measure its propagation speed:

cp

Repeat over:

- density
- temperature
- particle resolution
- particle stiffness
- occupancy
- model universe

Record:

cp
and
Mach-like ratio:

Mp = V/cp

Do not automatically equate Mp to textbook Mach number until the mapping has been validated.

---

# 13. ENERGY

Universe A:

e = 1

should preserve kinetic energy apart from numerical integration error.

Universe B:

e < 1

may be used to model effective parcel interactions.

But lost collision energy must be investigated.

Possible model:

particle-scale collision energy
→ internal parcel energy
→ thermal/jiggling motion

The system must distinguish:

momentum loss
from
energy redistribution.

Never add energy merely to force the desired answer.

If an energy reservoir is introduced, document it and test conservation.

---

# 14. WALL MODEL

Introduce wall accommodation coefficient:

Aw

Range:

Aw = 0
purely specular / mirror-like

Aw = 1
fully diffuse / randomized

Intermediate values represent partial accommodation.

This is an experimental parameter.

Wall interactions should record:

- normal momentum transfer
- tangential momentum transfer
- collision rate
- energy transfer

Do not simply call Aw "friction."

Measure its macroscopic effect.

---

# 15. VISCOSITY EXPERIMENT

Run a controlled Couette-flow experiment.

Two parallel walls.

One wall moves tangentially.

The other remains stationary.

Wall thermal behavior must be controlled so that shearing does not simply heat the gas indefinitely.

For fixed-temperature diffuse wall interactions, measure:

V(y)

and wall momentum transfer.

Derive an emergent effective viscosity:

mu_eff

Do not insert viscosity into the solver.

Repeat over:

Aw
density
temperature
speed
particle resolution

Determine whether viscosity is:

- emergent
- stable
- resolution dependent
- wall-model dependent
- temperature dependent

---

# 16. BOUNDARY-LAYER EXPERIMENT

Use a flat wall with uniform freestream.

Measure:

V_t(y)

from the wall outward.

Investigate whether a near-wall velocity gradient emerges naturally.

Record:

- wall shear
- velocity profile
- momentum-transfer rate
- accommodation coefficient
- thickness metric

Do not impose a conventional boundary-layer profile.

---

# 17. ADVERSE-PRESSURE-GRADIENT EXPERIMENT

Before optimizing an airfoil, create a controlled adverse pressure gradient.

Measure:

- outer-flow velocity
- near-wall velocity
- wall shear
- particle residence time
- reverse flow
- separation onset

The goal is to investigate the hypothesis:

The fast outer flow can transport momentum into the slow layer only up to a certain adverse-gradient strength.

If the slow layer loses forward momentum:

V_t → 0

then:

V_t < 0

may appear downstream.

The threshold must be measured.

Do not hard-code a classical separation criterion.

---

# 18. KUTTA DISCOVERY EXPERIMENT

Do NOT impose the Kutta condition during discovery.

Use:

- sharp trailing edge
- appropriate wall accommodation
- initially uniform flow
- sudden start or controlled startup
- no prescribed circulation
- no prescribed trailing-edge velocity

Observe whether PFAD naturally produces:

- transient tail instability
- vortex shedding
- circulation
- eventual smooth trailing-edge departure

If it does, this is a major emergent result.

Only after discovery should classical Kutta behavior be used as a benchmark.

---

# 19. EMPTY-SPACE / OCCUPANCY TEST

Distinguish:

low pressure
from
low density
from
true empty space.

At subsonic conditions, density variations can remain relatively small even when pressure differences are significant.

Every simulation must log:

phi_min
phi_max
phi_mean
density range

The model must not equate "low pressure" with "empty space."

A persistent near-zero occupancy region should be treated as a potential numerical/model failure unless physically justified.

---

# 20. NOISE

In Universe A, thermal/jiggling velocity may be much larger than the mean aerodynamic drift.

Therefore:

signal:
mean flow velocity

noise:
thermal velocity

can have a poor signal-to-noise ratio.

PFAD must support:

- ensemble averaging
- temporal averaging
- spatial averaging
- multiple seeds
- confidence intervals

Pressure differences of less than 1% require adequate averaging.

Do not mistake stochastic noise for aerodynamic structure.

Testing at higher Mach-like flow ratios can improve observability, but the model must then record the corresponding regime.

---

# 21. REYNOLDS NUMBER PROBLEM

This is a first-class problem.

Physical Reynolds number:

Re_physical = rho*V*L/mu

A laptop particle simulation may operate at a very different effective Reynolds number.

Therefore always distinguish:

Re_physical
Re_simulation
Re_effective

Do not claim that a simulation represents a physical wing unless the relevant dimensionless regime has been demonstrated.

For the reference case:

V = 50 m/s
L = 1 m
ordinary sea-level air

Re is on the order of millions.

A low-resolution particle model may naturally produce only hundreds or thousands.

This is unacceptable for direct full-scale airfoil optimization unless a validated scale-bridging method is established.

---

# 22. PARTICLE SCALING

Separate:

PHYSICAL PARAMETERS

from:

NUMERICAL REPRESENTATION PARAMETERS.

Physical:

rho
T
mu
speed
length
pressure
etc.

Numerical:

particle diameter
particle count
grid resolution
timestep
interaction radius
coarse-graining factor

The project must investigate whether dimensionless behavior can be preserved under scaling.

Do not assume that increasing particle diameter while adjusting mass automatically preserves physics.

---

# 23. PHASE 0 EXPERIMENTAL LADDER

Before airfoil optimization:

### Experiment 1
Static pressure.

### Experiment 2
Elastic energy conservation.

### Experiment 3
Thermal equilibrium.

### Experiment 4
Pressure-pulse / sound speed.

### Experiment 5
Couette viscosity.

### Experiment 6
Flat-wall boundary layer.

### Experiment 7
Adverse-pressure-gradient separation.

### Experiment 8
Kutta discovery.

### Experiment 9
Resolution scaling.

### Experiment 10
Reynolds/Mach regime mapping.

Only after these pass their defined acceptance criteria should airfoil discovery begin.

---

# 24. AIRFOIL PHASE

Once Phase 0 is validated sufficiently:

Represent geometry as:

yu(x)
yl(x)

where:

x ∈ [0,1]

Prefer:

- cubic splines
- B-splines
- Bezier segments
- low-dimensional control points

Avoid high-degree global polynomial fits.

Export both:

- spline/control-point representation
- piecewise mathematical equations

If a single explicit polynomial is requested, provide it only if the approximation residual is acceptable.

---

# 25. INVERSE DESIGN

The intended logic is:

desired flow behavior
→ geometry perturbation
→ particle simulation
→ measured response
→ objective score
→ geometry update

Start with:

flat plate
or
simple smooth seed

Do not start from a NACA airfoil unless explicitly used as a benchmark seed.

---

# 26. AIRFOIL OBJECTIVE

Potential objective:

Score =
w_attach*AttachmentScore
+
w_pressure*PressureDifferenceScore
-
w_drag*DragPenalty
-
w_wake*WakePenalty
-
w_void*VoidPenalty
-
w_roughness*GeometryPenalty
-
w_instability*NumericalPenalty

Weights are user preferences.

They are not physical constants.

Display each contribution.

The optimizer must not be allowed to hide why a geometry won.

---

# 27. ATTACHMENT

Measure surface tangential velocity:

Vt(s)

Potential separation is a sustained transition:

Vt → 0
followed by
Vt < 0

Do not trigger separation from one noisy particle.

Use temporal and spatial averaging.

Record:

separation location
uncertainty
confidence / convergence

---

# 28. LEADING-EDGE HYPOTHESIS

The rounded/slightly drooped nose is an explicit hypothesis.

It is motivated by:

- sharp-edge particle/flow turning
- near-nose separated pocket behavior
- known experimental behavior of rounded versus sharp leading edges

But it must NOT be hard-coded.

A useful validation question is:

Does unconstrained PFAD optimization independently discover a geometry that reduces the leading-edge separated region while maintaining useful loading?

If yes, investigate why.

If no, investigate whether the model is missing a mechanism.

---

# 29. PRESSURE AND FORCE

Surface segments accumulate particle momentum transfer.

For each segment:

F_segment =
sum(momentum impulses) / delta_t

Pressure:

P_segment = F_normal / A_segment

Shear:

tau_segment = F_tangent / A_segment

Integrate surface forces.

Resolve total force into:

- freestream-parallel direction
- freestream-normal direction

Report:

particle-derived drag
particle-derived lift

No conventional lift or drag formula is permitted inside the solver.

---

# 30. WAKE

Measure the wake from the simulated particle field.

Possible metrics:

- velocity deficit
- occupancy disturbance
- recirculation
- downstream momentum deficit
- persistent low-occupancy regions

Do not assume the wake is an empty void.

The metric must be modular and labeled experimental.

---

# 31. CONVERGENCE

Every major result must have:

particle-resolution convergence
timestep convergence
domain-size convergence
averaging convergence

At minimum compare:

low
medium
high

resolution.

If results change materially:

status = NOT CONVERGED

Do not present the geometry as physically reliable.

---

# 32. DETERMINISM

Store:

random seed

Given identical:

- model version
- configuration
- seed

the simulation should reproduce within documented numerical tolerance.

---

# 33. EXPERIMENT RECORD

Every experiment produces a record containing:

experiment ID
model version
date
seed
geometry
fluid properties
particle properties
wall model
occupancy model
energy model
domain
timestep
duration
particle count
grid resolution
Re
Mach / Mp
results
uncertainties
convergence state
warnings

Export JSON.

---

# 34. VISUAL LABORATORY

The application should eventually contain:

## Particle view

- particles
- velocity vectors
- trails
- collisions
- walls
- geometry

## Field view

- occupancy
- occupancy gradient
- density
- velocity magnitude
- pressure
- shear

## Diagnostics

- pressure
- force
- lift
- drag
- viscosity
- sound speed
- Reynolds
- Mach
- energy conservation
- momentum conservation

## Experiment controls

- seed
- timestep
- resolution
- model toggles
- wall accommodation
- restitution
- occupancy coefficient

---

# 35. PARTICLE INSPECTOR

Click a particle.

Display:

ID
position
velocity
momentum
energy
occupancy
occupancy gradient
collision count
recent collision impulses
trajectory

This is essential for understanding the microscopic mechanism.

---

# 36. MODEL TOGGLES

The laboratory must support controlled ablation experiments:

[ ] collisions
[ ] deformation
[ ] occupancy restoration
[ ] internal thermal reservoir
[ ] wall accommodation
[ ] external forces

This allows competing hypotheses to be tested with the same setup.

---

# 37. SCIENTIFIC FALSIFICATION

PFAD should actively try to fail.

Examples:

- uniform free stream cannot remain stable
- pressure does not converge
- elastic system loses energy uncontrollably
- inelastic system cools without a documented energy model
- occupancy law causes runaway collapse
- viscosity cannot be measured consistently
- wall response is dominated by numerical artifacts
- results depend strongly on particle resolution
- results depend strongly on random seed
- Reynolds scaling cannot be established
- optimized geometry changes materially with resolution
- force measurements violate momentum accounting

A failure is not automatically a bad result.

It identifies a model deficiency.

---

# 38. EXTERNAL VALIDATION

After internal PFAD experiments:

Compare selected results with established physics and experiments.

Potential benchmarks:

- ideal gas pressure
- sound speed
- viscosity
- Couette flow
- flat plate
- cylinder flow
- boundary-layer behavior
- separation
- Kutta behavior
- known airfoil data

These comparisons are validation.

They must not leak back into the discovery solver.

---

# 39. REFERENCE CASE

The canonical future design test is:

Speed:
50 m/s

Angle:
5 degrees

Chord:
1 m

Altitude:
user selectable

Density:
user selectable

The system must calculate physical Re from the supplied fluid properties.

Do not assume sea-level density if the user supplies density.

---

# 40. AIRFOIL OUTPUT

Eventually output:

Upper:
yu(x)

Lower:
yl(x)

Coordinate CSV

Spline coefficients

Piecewise equations

SVG

JSON

Simulation configuration

Optimization history

Pressure distribution

Surface velocity

Lift

Drag

Separation

Wake metrics

Convergence results

The UI must explicitly state whether the geometry is:

CONVERGED
PARTIALLY CONVERGED
NOT CONVERGED

---

# 41. IMPLEMENTATION PHILOSOPHY

Build a scientific laboratory, not a polished fake.

Correctness first.

Observability second.

Performance third.

Visual polish fourth.

Every important physical rule should exist as a replaceable module.

Examples:

CollisionModel
DeformationModel
ThermalModel
OccupancyModel
WallModel
PressureEstimator
ViscosityEstimator
BoundaryLayerAnalyzer
SeparationAnalyzer
WakeAnalyzer
GeometryOptimizer

---

# 42. FINAL PRINCIPLE

PFAD is successful if it can answer:

"What microscopic rules are sufficient to produce the macroscopic behavior required for useful wing design?"

The airfoil is the final experiment.

It is not the starting assumption.

