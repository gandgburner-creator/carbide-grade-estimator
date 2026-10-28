/**
 * ============================================================================
 *  BENCHMARKS — COMPARISON ONLY
 * ============================================================================
 * Classical reference properties of ordinary air, used ONLY to tell a person how far
 * the particle simulation is from the real situation they described (Mach, Reynolds and
 * Knudsen numbers) and, in one disclosed place, to express a real wind speed as a Mach
 * number (see experiments/PhysicalScenario.ts). Nothing here enters the particle dynamics;
 * solver modules may not import this directory (tests/architecture.test.ts).
 *
 * Standard formulas, SI units, dry air, valid for the troposphere (0–11 000 m) and
 * −60 … +50 °C:
 *   pressure          International Standard Atmosphere barometric formula
 *   density           ideal gas, ρ = p / (R T)
 *   speed of sound    c = √(γ R T)
 *   viscosity         Sutherland's law
 *   mean free path    kinetic theory, λ = (μ / p) √(π R T / 2)
 * The pressure follows the altitude of the ISA, with the temperature the person gave
 * applied at that altitude; this is a simplification (the ISA also ties T to altitude).
 */
export const AIR = {
  /** specific gas constant of dry air [J/(kg K)] */
  R: 287.05,
  /** ratio of specific heats */
  gamma: 1.4,
  /** sea-level ISA pressure [Pa] */
  p0: 101325,
  /** Sutherland constants: μ = μ_ref (T/T_ref)^1.5 (T_ref + S)/(T + S) */
  muRef: 1.716e-5,
  tRef: 273.15,
  S: 110.4,
} as const;

export interface AirState {
  /** ambient temperature [K] */
  T: number;
  /** pressure [Pa] */
  pressure: number;
  /** density [kg/m³] */
  density: number;
  /** speed of sound [m/s] */
  soundSpeed: number;
  /** dynamic viscosity [Pa s] */
  viscosity: number;
  /** molecular mean free path [m] */
  meanFreePath: number;
}

/** Reference air at a temperature [°C] and a height above sea level [m]. */
export function airReference(tempC: number, altitudeM: number): AirState {
  const T = tempC + 273.15;
  const pressure = AIR.p0 * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
  const density = pressure / (AIR.R * T);
  const soundSpeed = Math.sqrt(AIR.gamma * AIR.R * T);
  const viscosity = (AIR.muRef * Math.pow(T / AIR.tRef, 1.5) * (AIR.tRef + AIR.S)) / (T + AIR.S);
  const meanFreePath = (viscosity / pressure) * Math.sqrt((Math.PI * AIR.R * T) / 2);
  return { T, pressure, density, soundSpeed, viscosity, meanFreePath };
}

/** The three similarity numbers of a flat plate of length L [m] in a wind U [m/s]. */
export function similarityNumbers(air: AirState, windMs: number, lengthM: number): { mach: number; reynolds: number; knudsen: number } {
  return {
    mach: windMs / air.soundSpeed,
    reynolds: (air.density * windMs * lengthM) / air.viscosity,
    knudsen: air.meanFreePath / lengthM,
  };
}
