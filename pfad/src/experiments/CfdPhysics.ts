import { fluidOfInput, STANDARD_GRAVITY_MS2, type FluidState } from '../benchmarks/Fluids';
import type { CfdResult } from '../cfd/CfdRun';
import type { Side } from '../geometry/SurfaceGeometry';
import type { PhysicalInputs } from './FlowGeometryExperiment';
import { sci } from './PhysicalScenario';

/**
 * THE PHYSICS SHEET OF A CFD SET-UP: every dimensionless number and pressure relation of the fluid, the wind and the plate that a
 * person might ask about — Reynolds, Mach, Knudsen, Froude, the dynamic, stagnation and total pressures, the cavitation number,
 * the heating and the density change at the stagnation point — each with its formula and what it means for THIS run.
 *
 * What the solver does and does not contain, stated once so no row can be misread:
 *   solved            the Navier–Stokes equations for a viscous, unsteady, incompressible flow (lattice Boltzmann at low Mach number),
 *                     in two dimensions. The fluid enters through ONE number, the Reynolds number ρ U L / μ.
 *   not solved        compressibility (shocks, density changes), the energy equation (heating, thermal conductivity), a free surface
 *                     and waves, cavitation and vapour, turbulence in the third dimension, rarefied-gas slip, chemistry.
 *   shown here        those effects as ESTIMATES from the classical relations, so a person can see when the incompressible 2-D flow they
 *                     are looking at stops being a fair description of their situation. They change nothing in the run.
 *
 * The relations on this sheet (Bernoulli's equation among them) are used to describe and to check the computed flow; none of them
 * is an input to the solver.
 */
export interface PhysicsRow {
  id: string;
  name: string;
  symbol: string;
  value: string;
  formula: string;
  /** what it means for this run, in words */
  meaning: string;
  /** 'ok' needs no attention, 'note' is worth reading, 'warn' means the run is outside what the solver can represent here */
  level: 'ok' | 'note' | 'warn';
}

export type Compressibility = 'incompressible' | 'weakly-compressible' | 'compressible-subsonic' | 'transonic' | 'supersonic';

export interface PhysicsSheet {
  fluid: FluidState;
  windMs: number;
  chordM: number;
  thicknessM: number;
  reynoldsChord: number;
  reynoldsThickness: number;
  /** wind speed ÷ speed of sound; 0 for a fluid without one */
  mach: number;
  /** mean free path ÷ chord, gases only */
  knudsen: number | null;
  /** U / √(g L) for a liquid at a depth, otherwise null */
  froude: number | null;
  /** ½ ρ U² */
  dynamicPressure: number;
  /** p∞ + ½ρU² (incompressible); isentropic for a compressible gas */
  stagnationPressure: number;
  /** isentropic stagnation pressure rise of a gas, p0 − p∞, and the incompressible one (= q) for comparison */
  stagnationRise: number;
  /** adiabatic temperature rise at the stagnation point [K], gases only */
  stagnationHeating: number | null;
  /** relative density change at the stagnation point (≈ Ma²/2 for a gas), the error of treating the flow as incompressible */
  densityChange: number;
  compressibility: Compressibility;
  cavitation: { vaporPressure: number; sigma: number } | null;
  rows: PhysicsRow[];
  warnings: string[];
}

const kPa = (p: number) => (Math.abs(p) >= 1e4 ? `${(p / 1000).toFixed(p >= 1e5 ? 1 : 2)} kPa` : `${sci(p)} Pa`);

export function compressibilityOf(mach: number): Compressibility {
  return mach < 0.1 ? 'incompressible' : mach < 0.3 ? 'weakly-compressible' : mach < 0.8 ? 'compressible-subsonic' : mach < 1.2 ? 'transonic' : 'supersonic';
}

/** Stagnation-to-static pressure ratio of an isentropic flow of a gas at Mach `m`. */
export const isentropicPressureRatio = (m: number, gamma: number): number => Math.pow(1 + ((gamma - 1) / 2) * m * m, gamma / (gamma - 1));

export function physicsSheet(fluid: FluidState, input: Pick<PhysicalInputs, 'lengthCm' | 'thicknessCm' | 'speedKmh' | 'alphaDeg'>, depthM: number | null = null): PhysicsSheet {
  const U = input.speedKmh / 3.6;
  const L = input.lengthCm / 100;
  const t = input.thicknessCm / 100;
  const rho = fluid.density;
  const mu = fluid.viscosity;
  const finiteC = Number.isFinite(fluid.soundSpeed);
  const mach = finiteC ? U / fluid.soundSpeed : 0;
  const q = 0.5 * rho * U * U;
  const gas = fluid.kind === 'gas' && fluid.gamma !== null;
  const stagnationPressure = gas ? fluid.pressure * isentropicPressureRatio(mach, fluid.gamma!) : fluid.pressure + q;
  const stagnationRise = stagnationPressure - fluid.pressure;
  const cp = gas ? (fluid.gamma! * fluid.gasConstant!) / (fluid.gamma! - 1) : null;
  const stagnationHeating = cp ? (U * U) / (2 * cp) : null;
  const densityChange = gas ? Math.pow(isentropicPressureRatio(mach, fluid.gamma!), 1 / fluid.gamma!) - 1 : finiteC ? (0.5 * U * U) / (fluid.soundSpeed * fluid.soundSpeed) : 0;
  const reL = (rho * U * L) / mu;
  const reT = (rho * U * t) / mu;
  const knudsen = fluid.meanFreePath !== null ? fluid.meanFreePath / L : null;
  const froude = depthM !== null && fluid.kind === 'liquid' ? U / Math.sqrt(STANDARD_GRAVITY_MS2 * L) : null;
  const cav = fluid.vaporPressure !== null && fluid.kind === 'liquid' && q > 0 ? { vaporPressure: fluid.vaporPressure, sigma: (fluid.pressure - fluid.vaporPressure) / q } : null;
  const compressibility = compressibilityOf(mach);
  const warnings: string[] = [];
  const rows: PhysicsRow[] = [];

  // ---- Reynolds
  const reRegime =
    reL < 1 ? 'creeping flow: viscosity dominates everything'
      : reL < 1e3 ? 'laminar flow'
        : reL < 5e5 ? 'laminar boundary layers that are unstable: vortex shedding and a growing wake, transition to turbulence in the shear layers'
          : 'turbulent boundary layers (the plate boundary layer turns turbulent near Re ≈ 5×10⁵)';
  rows.push({ id: 're-chord', name: 'Reynolds number (plate length)', symbol: 'Re_L', value: sci(reL), formula: 'ρ U L / μ', meaning: `inertia ÷ viscosity for the whole plate: ${reRegime}. This is the number the solver is run at (up to what its resolution allows).`, level: 'ok' });
  rows.push({ id: 're-thick', name: 'Reynolds number (leading edge diameter)', symbol: 'Re_t', value: sci(reT), formula: 'ρ U t / μ', meaning: `the Reynolds number of the round leading edge alone (${(t * 100).toFixed(2)} cm across): ${reT < 40 ? 'the flow around it is steady and attached' : reT < 200 ? 'the flow around it sheds vortices' : 'a turbulent wake behind a blunt leading edge is to be expected'}.`, level: 'ok' });
  rows.push({ id: 'nu', name: 'Kinematic viscosity', symbol: 'ν', value: `${sci(fluid.kinematic)} m²/s`, formula: 'μ / ρ', meaning: 'how fast vorticity diffuses; the Reynolds number is U L / ν.', level: 'ok' });

  // ---- Mach and compressibility
  if (finiteC) {
    const lvl: PhysicsRow['level'] = mach < 0.3 ? 'ok' : mach < 0.8 ? 'note' : 'warn';
    const word: Record<Compressibility, string> = {
      incompressible: 'the density changes by less than 0.5 %: incompressible flow is an excellent description',
      'weakly-compressible': `the density changes by up to ${(100 * densityChange).toFixed(1)} % at the stagnation point: incompressible flow is still a good description`,
      'compressible-subsonic': `the density changes by ${(100 * densityChange).toFixed(0)} % at the stagnation point: compressibility matters (forces change, the pressure field changes) and this incompressible solver does not include it`,
      transonic: 'the flow is near the speed of sound: shock waves and a sharp rise of drag. This solver cannot represent it',
      supersonic: 'the flow is faster than sound: shock waves. This solver cannot represent it',
    };
    rows.push({ id: 'mach', name: 'Mach number', symbol: 'Ma', value: sci(mach), formula: 'U / c', meaning: word[compressibility], level: lvl });
    if (mach >= 0.3) warnings.push(`Mach ${sci(mach)}: ${word[compressibility]}. The run is the incompressible flow at the same Reynolds number; no compressibility correction is applied.`);
    rows.push({ id: 'c', name: 'Speed of sound', symbol: 'c', value: `${fluid.soundSpeed.toFixed(fluid.soundSpeed < 1000 ? 1 : 0)} m/s`, formula: gas ? '√(γ R T)' : '√(K / ρ), K the bulk modulus', meaning: 'the speed of small pressure disturbances in the fluid.', level: 'ok' });
  } else {
    rows.push({ id: 'mach', name: 'Mach number', symbol: 'Ma', value: '—', formula: 'U / c', meaning: 'the fluid has no speed of sound (a custom fluid without one): it is taken as incompressible.', level: 'note' });
  }

  // ---- pressures (Bernoulli)
  rows.push({ id: 'p', name: 'Ambient pressure', symbol: 'p∞', value: kPa(fluid.pressure), formula: fluid.pressureNote, meaning: 'the static pressure far from the plate.', level: 'ok' });
  rows.push({ id: 'q', name: 'Dynamic pressure', symbol: 'q', value: kPa(q), formula: '½ ρ U²', meaning: 'the pressure scale of the flow: every pressure coefficient C_p = (p − p∞) / q, and every force coefficient, is divided by it. Forces on your wing are the coefficients × q × area.', level: 'ok' });
  rows.push({
    id: 'p0',
    name: 'Stagnation (total) pressure',
    symbol: 'p₀',
    value: kPa(stagnationPressure),
    formula: gas ? 'p∞ (1 + (γ−1)/2 Ma²)^(γ/(γ−1))' : 'p∞ + ½ ρ U²',
    meaning: `the pressure where the stream is brought to rest, ${kPa(stagnationRise)} above ambient. Bernoulli's equation, p + ½ρu² = constant along a streamline, holds in the part of the computed flow where viscosity is negligible; the total pressure view and the check below show where it does and does not.`,
    level: 'ok',
  });
  if (gas && stagnationHeating !== null) rows.push({ id: 'heat', name: 'Stagnation temperature rise', symbol: 'ΔT₀', value: `${stagnationHeating < 1 ? stagnationHeating.toFixed(3) : stagnationHeating.toFixed(2)} K`, formula: 'U² / (2 c_p)', meaning: `the adiabatic heating of the gas brought to rest. The solver is isothermal (it has no energy equation), so this heating is not in the run${stagnationHeating > 5 ? ' and it is large enough to change the gas properties' : ''}.`, level: stagnationHeating > 5 ? 'note' : 'ok' });
  if (stagnationHeating !== null && stagnationHeating > 5) warnings.push(`The gas would heat by ${stagnationHeating.toFixed(0)} K at the stagnation point; the isothermal solver does not include that.`);

  // ---- Knudsen
  if (knudsen !== null) {
    const kn = knudsen;
    const lvl: PhysicsRow['level'] = kn < 0.001 ? 'ok' : kn < 0.1 ? 'note' : 'warn';
    const word = kn < 0.001 ? 'continuum: the Navier–Stokes equations with no-slip walls are valid' : kn < 0.1 ? 'slip flow: the gas slips along the wall; the no-slip condition of this solver is no longer accurate' : kn < 10 ? 'transitional rarefied gas: the Navier–Stokes equations do not hold. The particle model of this laboratory is the better description' : 'free molecular flow: the particle model of this laboratory is the right kind of description, not a continuum solver';
    rows.push({ id: 'kn', name: 'Knudsen number', symbol: 'Kn', value: sci(kn), formula: 'λ / L, λ = (μ / p) √(π R T / 2)', meaning: `mean free path ${sci(fluid.meanFreePath!)} m ÷ plate length: ${word}.`, level: lvl });
    if (kn >= 0.001) warnings.push(`Knudsen number ${sci(kn)}: ${word}.`);
  }

  // ---- cavitation
  if (cav) {
    const lvl: PhysicsRow['level'] = cav.sigma > 3 ? 'ok' : cav.sigma > 0 ? 'note' : 'warn';
    rows.push({
      id: 'sigma',
      name: 'Cavitation number',
      symbol: 'σ',
      value: sci(cav.sigma),
      formula: '(p∞ − p_v) / q',
      meaning: cav.sigma <= 0 ? `the ambient pressure is at or below the vapour pressure ${kPa(cav.vaporPressure)}: the liquid would be boiling or already vapour` : `the liquid forms vapour where the local pressure falls to p_v = ${kPa(cav.vaporPressure)}, i.e. where C_p reaches −σ = ${sci(-cav.sigma)}. The pressure map of the result is checked against this.`,
      level: lvl,
    });
    if (cav.sigma <= 0) warnings.push(`The ambient pressure (${kPa(fluid.pressure)}) is not above the vapour pressure of the liquid (${kPa(cav.vaporPressure)}): at this temperature it would boil.`);
  }

  // ---- Froude and the free surface
  if (froude !== null) {
    const near = depthM! < 3 * L;
    rows.push({ id: 'fr', name: 'Froude number', symbol: 'Fr', value: sci(froude), formula: 'U / √(g L)', meaning: near ? `the plate is within about three plate lengths of the surface (depth ${depthM} m): it would make surface waves, which this solver (a fully submerged body in unbounded liquid, no free surface, no gravity) does not model` : 'the plate is deep enough that surface waves are negligible; gravity then only adds the hydrostatic pressure, which does not change the flow.', level: near ? 'warn' : 'ok' });
    if (near) warnings.push(`Depth ${depthM} m is less than three plate lengths: the free surface and its waves would change the flow and are not modelled.`);
  }

  // ---- resolution of the boundary layer (comparison)
  const delta = 5 / Math.sqrt(Math.max(1, reL));
  rows.push({ id: 'bl', name: 'Laminar boundary-layer thickness at the trailing edge', symbol: 'δ/L', value: sci(delta), formula: '5 / √Re_L (flat-plate reference)', meaning: `for comparison only: a laminar boundary layer on a flat plate of this Reynolds number is ${(delta * 100).toFixed(2)} % of the plate length thick (${(delta * input.lengthCm).toFixed(2)} cm). A lattice resolves it only if it has several cells across ${(delta * 100).toFixed(2)} % of the plate length.`, level: 'ok' });
  warnings.push('Two-dimensional, incompressible, isothermal flow: no compressibility, no heating, no third dimension, no free surface, no cavitation. The rows above estimate how far your situation is from that.');
  return { fluid, windMs: U, chordM: L, thicknessM: t, reynoldsChord: reL, reynoldsThickness: reT, mach, knudsen, froude, dynamicPressure: q, stagnationPressure, stagnationRise, stagnationHeating, densityChange, compressibility, cavitation: cav, rows, warnings };
}

/** The sheet of a set of plain inputs (the fluid, temperature and pressure they describe). */
export function sheetOfInput(input: PhysicalInputs): PhysicsSheet {
  return physicsSheet(fluidOfInput(input), input, input.fluid?.pressure?.kind === 'depth' ? input.fluid.pressure.depthM : null);
}

// ---------------------------------------------------------------------------------------------------------------------------------

/** What the computed flow says about the pressure extremes and about Bernoulli's equation. */
export interface FieldPhysics {
  /** |C_p0| below this counts as "Bernoulli's equation holds" */
  tolerance: number;
  /** share of the fluid cells (outside the absorbing layer in front of the outflow) where |C_p0| < tolerance */
  bernoulliShare: number;
  /** the lowest and highest total-pressure coefficient C_p0 = C_p + |u|²/U² − 1 in the fluid */
  totalPressureMin: number;
  totalPressureMax: number;
  /** the lowest and highest static pressure coefficient C_p of the mean field, and where the lowest is (plate units from the lattice origin) */
  cpMin: number;
  cpMinAt: { x: number; y: number };
  cpMax: number;
  /** the largest mean speed |u| / U in the fluid */
  maxSpeed: number;
  /** the extremes of C_p beside the wall, from the wall stations */
  wallCpMin: { value: number; side: Side; x: number } | null;
  wallCpMax: { value: number; side: Side; x: number } | null;
  /** the number of fluid cells counted */
  cells: number;
}

/**
 * Bernoulli's equation as a CHECK of a finished run. The solver advances the Navier–Stokes equations and never uses it; but
 * p + ½ρ|u|² = constant along a streamline is a consequence of them where viscosity and unsteadiness do not matter. In units of
 * q = ½ρU² the total pressure coefficient C_p0 = C_p + |u|²/U² − 1 is zero where it holds with the free-stream value, and negative
 * where viscosity has taken total pressure out of the flow (boundary layers and wake). The mean fields are block averages, so
 * a narrow peak is smoothed a little.
 */
export function fieldPhysics(res: CfdResult, tolerance = 0.02): FieldPhysics {
  const g = res.grid;
  const U = res.params.uLattice;
  const cell = g.stride / res.lattice.cellsPerUnit;
  const plate = res.params.cells / res.lattice.cellsPerUnit;
  const xEnd = (res.params.widthL - res.params.spongeL) * plate;
  let n = 0;
  let ok = 0;
  let c0Min = Infinity;
  let c0Max = -Infinity;
  let cpMin = Infinity;
  let cpMax = -Infinity;
  let maxSpeed = 0;
  let at = { x: 0, y: 0 };
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const x = (i + 0.5) * cell;
      if (g.solid[k] || x > xEnd) continue;
      const cp = (g.rho[k] - res.rhoInf) / 3 / (0.5 * res.rhoInf * U * U);
      const s = Math.hypot(g.ux[k], g.uy[k]) / U;
      const c0 = cp + s * s - 1;
      n++;
      if (Math.abs(c0) < tolerance) ok++;
      if (c0 < c0Min) c0Min = c0;
      if (c0 > c0Max) c0Max = c0;
      if (cp < cpMin) {
        cpMin = cp;
        at = { x, y: (j + 0.5) * cell };
      }
      if (cp > cpMax) cpMax = cp;
      if (s > maxSpeed) maxSpeed = s;
    }
  let wallCpMin: FieldPhysics['wallCpMin'] = null;
  let wallCpMax: FieldPhysics['wallCpMax'] = null;
  for (const side of ['upper', 'lower'] as const)
    for (const s of res.stations[side]) {
      const v = s.cp.mean;
      if (!Number.isFinite(v)) continue;
      if (!wallCpMin || v < wallCpMin.value) wallCpMin = { value: v, side, x: s.x };
      if (!wallCpMax || v > wallCpMax.value) wallCpMax = { value: v, side, x: s.x };
    }
  return { tolerance, bernoulliShare: n ? ok / n : Number.NaN, totalPressureMin: n ? c0Min : Number.NaN, totalPressureMax: n ? c0Max : Number.NaN, cpMin: n ? cpMin : Number.NaN, cpMinAt: at, cpMax: n ? cpMax : Number.NaN, maxSpeed, wallCpMin, wallCpMax, cells: n };
}

export interface ResultPhysics {
  field: FieldPhysics;
  /** the lowest absolute pressure in the mean field [Pa], p∞ + C_p,min · q */
  minPressure: number;
  /** the highest local Mach number implied by that pressure, isentropically, for a gas (null for a liquid or when the pressure is not positive) */
  localMach: number | null;
  /** cavitation margin: lowest pressure minus vapour pressure [Pa] (null where the fluid has no vapour pressure) */
  cavitationMargin: number | null;
  rows: PhysicsRow[];
  warnings: string[];
}

/** The sheet's pressures put on the finished run: absolute pressure extremes, local Mach number, cavitation, and the Bernoulli check. */
export function resultPhysics(sheet: PhysicsSheet, res: CfdResult): ResultPhysics {
  const f = fieldPhysics(res);
  const q = sheet.dynamicPressure;
  const p = sheet.fluid.pressure;
  const rows: PhysicsRow[] = [];
  const warnings: string[] = [];
  const cpLowest = Math.min(f.cpMin, f.wallCpMin?.value ?? Infinity);
  const minPressure = p + cpLowest * q;
  const maxPressure = p + Math.max(f.cpMax, f.wallCpMax?.value ?? -Infinity) * q;
  rows.push({ id: 'cp-max', name: 'Highest pressure', symbol: 'C_p,max', value: f.cpMax.toFixed(2), formula: '(p − p∞) / q', meaning: `${kPa(maxPressure)} absolute at the stagnation region. Bernoulli's equation predicts exactly C_p = 1 at a stagnation point of a steady flow${Math.abs(f.cpMax - 1) < 0.05 ? ': the computed flow agrees' : f.cpMax > 1.05 ? ': the computed value is higher because the flow is unsteady there (a time-mean of a moving stagnation point and pressure waves)' : ': the computed value is lower because the stagnation point is smeared by the block averaging and the limited resolution'}.`, level: 'ok' });
  rows.push({ id: 'cp-min', name: 'Lowest pressure', symbol: 'C_p,min', value: cpLowest.toFixed(2), formula: '(p − p∞) / q', meaning: `${kPa(minPressure)} absolute, the lowest point of the mean flow${f.wallCpMin && f.wallCpMin.value <= f.cpMin ? ` (at the ${f.wallCpMin.side} wall, ${f.wallCpMin.x.toFixed(1)} plate units from the leading tip)` : ''}. The largest mean speed is ${f.maxSpeed.toFixed(2)} U, for which Bernoulli's equation says C_p = ${(1 - f.maxSpeed * f.maxSpeed).toFixed(2)}.`, level: 'ok' });
  rows.push({ id: 'cp0', name: 'Where Bernoulli’s equation holds', symbol: '|C_p0| < 0.02', value: `${(100 * f.bernoulliShare).toFixed(0)} % of the fluid`, formula: 'C_p0 = C_p + |u|²/U² − 1', meaning: `in this share of the flow p + ½ρ|u|² equals its free-stream value to within 2 % of q; in the rest (boundary layers, the wake, the plate’s own disturbance) viscosity has taken total pressure out of the flow, as low as C_p0 = ${f.totalPressureMin.toFixed(2)}. Choose the “total pressure” view to see where. The solver does not use Bernoulli’s equation: this is a check of its result against it.`, level: 'ok' });
  if (f.totalPressureMax > 0.1) warnings.push(`The total pressure rises to C_p0 = ${f.totalPressureMax.toFixed(2)} somewhere in the flow, which a viscous steady flow cannot do: this is the unsteady, block-averaged field or a sign that the run is not converged.`);

  // vortex shedding: the frequency of the lift oscillation of this run, and what the same Strouhal number would mean in the fluid and for the plate described
  const sh = res.shedding;
  if (sh) {
    if (sh.strouhal !== null) {
      const hz = (sh.strouhal * sheet.windMs) / sheet.chordM;
      rows.push({
        id: 'strouhal',
        name: 'Vortex shedding (Strouhal number)',
        symbol: 'St',
        value: sh.strouhal.toFixed(3),
        formula: 'f L / U from the period of the lift (based on the height across the stream: ' + (sh.strouhalHeight ?? 0).toFixed(3) + ')',
        meaning: `${sh.note}. With the same Strouhal number your plate (${(sheet.chordM * 100).toFixed(0)} cm, ${sheet.windMs.toFixed(1)} m/s, ${sheet.fluid.label.toLowerCase()}) would shed vortices at about ${sci(hz)} Hz — a carry-over that holds only if the Strouhal number does not change between this run's Reynolds number (${Math.round(res.params.reynolds)}) and yours (${sci(sheet.reynoldsChord)}), which it generally does.`,
        level: 'ok',
      });
    } else {
      rows.push({ id: 'strouhal', name: 'Vortex shedding (Strouhal number)', symbol: 'St', value: '—', formula: 'f L / U from the period of the lift', meaning: `${sh.note}.`, level: 'ok' });
    }
  }

  let localMach: number | null = null;
  const gas = sheet.fluid.kind === 'gas' && sheet.fluid.gamma !== null;
  if (gas) {
    if (minPressure <= 0) {
      warnings.push(`The lowest pressure of the computed incompressible flow (${kPa(minPressure)}) is not positive: a real gas at this wind speed would be compressible there, and the solution is not physical. Lower the wind speed or raise the pressure.`);
    } else {
      const g = sheet.fluid.gamma!;
      const ratio = sheet.stagnationPressure / minPressure;
      localMach = Math.sqrt((2 / (g - 1)) * (Math.pow(Math.max(1, ratio), (g - 1) / g) - 1));
      const lvl: PhysicsRow['level'] = localMach < 0.3 ? 'ok' : localMach < 0.8 ? 'note' : 'warn';
      rows.push({ id: 'ma-local', name: 'Local Mach number at the lowest pressure', symbol: 'Ma_max', value: sci(localMach), formula: 'from p₀ / p_min, isentropic', meaning: localMach < 0.3 ? 'the speed-up over the plate stays well below the speed of sound: compressibility stays negligible everywhere.' : localMach < 0.8 ? 'the flow over the plate reaches speeds where the density changes by more than 5 %: the incompressible result is only approximate there.' : 'the flow over the plate would reach the speed of sound: shock waves, which this solver cannot represent.', level: lvl });
      if (localMach >= 0.3 && sheet.mach < 0.3) warnings.push(`The free stream is subsonic but the speed-up over the plate reaches about Mach ${sci(localMach)}: compressibility matters near the suction peak.`);
    }
  }

  let margin: number | null = null;
  if (sheet.cavitation) {
    margin = minPressure - sheet.cavitation.vaporPressure;
    const cav = margin <= 0;
    rows.push({
      id: 'cavitation',
      name: 'Cavitation check',
      symbol: 'p_min − p_v',
      value: kPa(margin),
      formula: 'p∞ + C_p,min q − p_v',
      meaning: cav ? `the lowest pressure of the flow (${kPa(minPressure)}) is at or below the vapour pressure (${kPa(sheet.cavitation.vaporPressure)}): the liquid would cavitate there — vapour pockets form and the computed single-phase flow is not what happens. Unsteady vortex cores are lower still than this time-mean.` : `the lowest pressure of the time-mean flow (${kPa(minPressure)}) stays above the vapour pressure (${kPa(sheet.cavitation.vaporPressure)}); the margin is ${(100 * margin / (p - sheet.cavitation.vaporPressure || 1)).toFixed(0)} % of the ambient margin. Instantaneous vortex cores are lower than the mean, so the margin should not be small.`,
      level: cav ? 'warn' : margin < 0.2 * q ? 'note' : 'ok',
    });
    if (cav) warnings.push(`Cavitation: the lowest pressure of the flow (${kPa(minPressure)}) is not above the vapour pressure of the liquid (${kPa(sheet.cavitation.vaporPressure)}).`);
  } else if (minPressure <= 0) {
    warnings.push(`The lowest pressure of the computed flow (${kPa(minPressure)}) is not positive: this wind speed is too high for the pressure level, and the incompressible solution is not physical.`);
  }
  return { field: f, minPressure, localMach, cavitationMargin: margin, rows, warnings };
}
