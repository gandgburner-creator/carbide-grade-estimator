/**
 * The data that describes a fluid choice (no formulas, no properties): which fluid, how its pressure was given, and the numbers of a
 * custom one. Kept apart from benchmarks/Fluids.ts, which turns it into density, viscosity and the rest, so that experiment and
 * project records can carry a fluid choice without importing any classical relation.
 */
export type FluidId = 'air' | 'nitrogen' | 'oxygen' | 'carbon-dioxide' | 'helium' | 'hydrogen' | 'water' | 'seawater' | 'oil-vg32' | 'custom';

/** How the ambient pressure of the fluid was given. */
export type PressureSpec =
  | { kind: 'altitude'; altitudeM: number }
  | { kind: 'absolute'; pa: number }
  /** a liquid at this depth below an open surface at standard pressure: p = p₀ + ρ g d */
  | { kind: 'depth'; depthM: number };

export interface CustomFluid {
  /** kg/m³ */
  density: number;
  /** Pa·s */
  viscosity: number;
  /** m/s; absent: treated as incompressible (no Mach number) */
  soundSpeed?: number;
  /** Pa; absent: none (no cavitation check) */
  vaporPressure?: number;
}

/** What a person picked besides the temperature (which, with the height above sea level, stays in the plain inputs). */
export interface FluidSpec {
  id: FluidId;
  pressure?: PressureSpec;
  custom?: CustomFluid;
}
