/**
 * ============================================================================
 *  BENCHMARKS — COMPARISON AND SCALING ONLY
 * ============================================================================
 * Classical reference properties of the fluids the CFD workspace can be set up with: what a person chose (the fluid, its
 * temperature, its pressure or, for air, its height above sea level) turned into density, viscosity, speed of sound and
 * vapour pressure. They set the Reynolds and Mach numbers of the run and the dynamic pressure that scales its forces to
 * newtons; they are never inside the equations the solver advances (the solver sees only the Reynolds number).
 *
 * Every formula is a published correlation with its accuracy stated in `notes`:
 *   gases           ideal gas   ρ = p / (R_s T),      c = √(γ R_s T),      μ by Sutherland's law (S, T₀, μ₀ per gas)
 *   air pressure    International Standard Atmosphere (ISA) for the height: troposphere to 11 km, isothermal layer to 20 km,
 *                   then the +1 K/km layer to 32 km. The temperature is the one the person chose (the ISA also ties it to height).
 *   fresh water     density Kell (1975), viscosity Kestin–Sokolov–Wakeham/CRC, speed of sound Marczak (1997), vapour pressure Antoine
 *   sea water       35 g/kg: density = Kell + the EOS-80 salinity terms, viscosity Sharqawy et al. (2010), speed of sound Medwin (1975),
 *                   vapour pressure lowered by Raoult's law
 *   mineral oil     ISO VG 32: Walther (ASTM D341) viscosity–temperature line through the two catalogue anchors (32 cSt at 40 °C,
 *                   5.4 cSt at 100 °C), linear thermal expansion
 *   a custom fluid  the density, viscosity and (optionally) speed of sound and vapour pressure that the person types
 *
 * Nothing here is measured by this repository; nothing is fitted to a result of it.
 */

export const GAS_CONSTANT_UNIVERSAL = 8.314462618;
export const STANDARD_PRESSURE = 101325;
export const STANDARD_GRAVITY_MS2 = 9.80665;

import type { CustomFluid, FluidId, FluidSpec, PressureSpec } from '../experiments/FluidSpec';
export type { CustomFluid, FluidId, FluidSpec, PressureSpec };

export const DEFAULT_FLUID: FluidSpec = { id: 'air' };

export interface FluidState {
  id: FluidId;
  label: string;
  kind: 'gas' | 'liquid';
  /** temperature [K] and [°C] */
  T: number;
  tempC: number;
  /** ambient absolute pressure [Pa] */
  pressure: number;
  /** density [kg/m³] */
  density: number;
  /** dynamic viscosity [Pa s] and kinematic viscosity [m²/s] */
  viscosity: number;
  kinematic: number;
  /** speed of sound [m/s]; +Infinity for a custom fluid given without one (then taken as incompressible) */
  soundSpeed: number;
  /** ratio of specific heats and specific gas constant [J/(kg K)] of a gas */
  gamma: number | null;
  gasConstant: number | null;
  /** saturation (vapour) pressure [Pa] of a liquid at this temperature, or null where none is known */
  vaporPressure: number | null;
  /** molecular mean free path [m] of a gas */
  meanFreePath: number | null;
  /** how the pressure was obtained, in words */
  pressureNote: string;
  /** accuracy and validity of the correlations used */
  notes: string[];
}

export interface FluidInfo {
  id: FluidId;
  label: string;
  kind: 'gas' | 'liquid' | 'custom';
  /** temperature range the correlations are meant for [°C] */
  tempRangeC: [number, number];
  defaultTempC: number;
  /** a short account of the property correlations */
  basis: string;
}

const GASES = {
  air: { label: 'Air (dry)', M: 28.9647, gamma: 1.4, S: 110.4, T0: 273.15, mu0: 1.716e-5 },
  nitrogen: { label: 'Nitrogen', M: 28.0134, gamma: 1.4, S: 111, T0: 300.55, mu0: 1.781e-5 },
  oxygen: { label: 'Oxygen', M: 31.998, gamma: 1.395, S: 127, T0: 292.25, mu0: 2.018e-5 },
  'carbon-dioxide': { label: 'Carbon dioxide', M: 44.0095, gamma: 1.289, S: 240, T0: 293.15, mu0: 1.48e-5 },
  helium: { label: 'Helium', M: 4.0026, gamma: 1.667, S: 79.4, T0: 273, mu0: 1.87e-5 },
  hydrogen: { label: 'Hydrogen', M: 2.01588, gamma: 1.405, S: 72, T0: 293.85, mu0: 0.876e-5 },
} as const;
type GasId = keyof typeof GASES;
const isGas = (id: FluidId): id is GasId => id in GASES;

export const FLUIDS: FluidInfo[] = [
  { id: 'air', label: GASES.air.label, kind: 'gas', tempRangeC: [-100, 600], defaultTempC: 15, basis: 'ideal gas, Sutherland viscosity; pressure from the height (International Standard Atmosphere) or typed' },
  { id: 'nitrogen', label: GASES.nitrogen.label, kind: 'gas', tempRangeC: [-100, 600], defaultTempC: 20, basis: 'ideal gas, Sutherland viscosity' },
  { id: 'oxygen', label: GASES.oxygen.label, kind: 'gas', tempRangeC: [-100, 600], defaultTempC: 20, basis: 'ideal gas, Sutherland viscosity' },
  { id: 'carbon-dioxide', label: GASES['carbon-dioxide'].label, kind: 'gas', tempRangeC: [-50, 600], defaultTempC: 20, basis: 'ideal gas, Sutherland viscosity (real-gas effects grow above a few MPa)' },
  { id: 'helium', label: GASES.helium.label, kind: 'gas', tempRangeC: [-100, 600], defaultTempC: 20, basis: 'ideal gas, Sutherland viscosity' },
  { id: 'hydrogen', label: GASES.hydrogen.label, kind: 'gas', tempRangeC: [-100, 600], defaultTempC: 20, basis: 'ideal gas, Sutherland viscosity' },
  { id: 'water', label: 'Fresh water', kind: 'liquid', tempRangeC: [0, 100], defaultTempC: 20, basis: 'Kell density, CRC viscosity, Marczak speed of sound, Antoine vapour pressure' },
  { id: 'seawater', label: 'Sea water (35 g/kg)', kind: 'liquid', tempRangeC: [-2, 40], defaultTempC: 15, basis: 'EOS-80 density, Sharqawy viscosity, Medwin speed of sound, vapour pressure lowered by the salt' },
  { id: 'oil-vg32', label: 'Mineral oil, ISO VG 32', kind: 'liquid', tempRangeC: [-10, 120], defaultTempC: 40, basis: 'catalogue anchors (32 cSt at 40 °C, 5.4 cSt at 100 °C), Walther viscosity–temperature law' },
  { id: 'custom', label: 'Custom fluid', kind: 'custom', tempRangeC: [-273, 2000], defaultTempC: 20, basis: 'the density, viscosity and optional speed of sound and vapour pressure you type' },
];

export const fluidInfo = (id: FluidId): FluidInfo => FLUIDS.find((f) => f.id === id)!;

// ---- International Standard Atmosphere

const ISA_T0 = 288.15;
const ISA_LAPSE = 0.0065;
const R_AIR = (GAS_CONSTANT_UNIVERSAL * 1000) / GASES.air.M;

/** ISA temperature [K] at a geometric height [m] (−5 km … 32 km). */
export function isaTemperature(h: number): number {
  if (h <= 11000) return ISA_T0 - ISA_LAPSE * h;
  if (h <= 20000) return 216.65;
  return 216.65 + 0.001 * (h - 20000);
}

/** ISA pressure [Pa] at a geometric height [m] (−5 km … 32 km): the barometric formula layer by layer. */
export function isaPressure(h: number): number {
  const tropo = (x: number) => STANDARD_PRESSURE * Math.pow(1 - (ISA_LAPSE * x) / ISA_T0, STANDARD_GRAVITY_MS2 / (R_AIR * ISA_LAPSE));
  if (h <= 11000) return tropo(h);
  const p11 = tropo(11000);
  if (h <= 20000) return p11 * Math.exp((-STANDARD_GRAVITY_MS2 * (h - 11000)) / (R_AIR * 216.65));
  const p20 = p11 * Math.exp((-STANDARD_GRAVITY_MS2 * 9000) / (R_AIR * 216.65));
  return p20 * Math.pow(1 + (0.001 * (h - 20000)) / 216.65, -STANDARD_GRAVITY_MS2 / (R_AIR * 0.001));
}

// ---- liquids

/** Density of fresh water [kg/m³] at 1 atm (Kell 1975, 0–150 °C). */
export function waterDensity(tC: number): number {
  const t = tC;
  return (999.83952 + 16.945176 * t - 7.9870401e-3 * t ** 2 - 46.170461e-6 * t ** 3 + 105.56302e-9 * t ** 4 - 280.54253e-12 * t ** 5) / (1 + 16.87985e-3 * t);
}

/** Dynamic viscosity of fresh water [Pa s] (CRC Handbook form of Kestin, Sokolov and Wakeham 1978; 1.002 mPa s at 20 °C). */
export function waterViscosity(tC: number): number {
  const mu20 = 1.002e-3;
  const x =
    tC >= 20
      ? (1.3272 * (20 - tC) - 1.053e-3 * (tC - 20) ** 2) / (tC + 105)
      : ((20 - tC) / (tC + 96)) * (1.2364 - 1.37e-3 * (20 - tC) + 5.7e-6 * (20 - tC) ** 2);
  return mu20 * Math.pow(10, x);
}

/** Speed of sound in pure water [m/s] (Marczak 1997, 0–95 °C). */
export function waterSoundSpeed(tC: number): number {
  const t = tC;
  return 1402.385 + 5.038813 * t - 5.799136e-2 * t ** 2 + 3.287156e-4 * t ** 3 - 1.398845e-6 * t ** 4 + 2.78786e-9 * t ** 5;
}

/** Vapour pressure of water [Pa] (Antoine, 1–100 °C; extrapolated below 1 °C). */
export function waterVaporPressure(tC: number): number {
  return Math.pow(10, 8.07131 - 1730.63 / (233.426 + tC)) * (101325 / 760);
}

const SALINITY = 0.035; // kg/kg

/** Density of sea water [kg/m³] at S = 35 g/kg and 1 atm: fresh water plus the EOS-80 salinity terms (valid −2 … 40 °C). */
export function seawaterDensity(tC: number, s = SALINITY): number {
  const S = s * 1000; // practical salinity ≈ g/kg
  const t = tC;
  const A = 8.24493e-1 - 4.0899e-3 * t + 7.6438e-5 * t ** 2 - 8.2467e-7 * t ** 3 + 5.3875e-9 * t ** 4;
  const B = -5.72466e-3 + 1.0227e-4 * t - 1.6546e-6 * t ** 2;
  const C = 4.8314e-4;
  return waterDensity(t) + A * S + B * Math.pow(S, 1.5) + C * S * S;
}

/** Viscosity of sea water [Pa s] (Sharqawy, Lienhard and Zubair 2010: μ_w (1 + A S + B S²), S in kg/kg). */
export function seawaterViscosity(tC: number, s = SALINITY): number {
  const A = 1.541 + 1.998e-2 * tC - 9.52e-5 * tC ** 2;
  const B = 7.974 - 7.561e-2 * tC + 4.724e-4 * tC ** 2;
  return waterViscosity(tC) * (1 + A * s + B * s * s);
}

/** Speed of sound in sea water [m/s] at S = 35 g/kg, surface (Medwin 1975). */
export function seawaterSoundSpeed(tC: number): number {
  return 1449.2 + 4.6 * tC - 0.055 * tC ** 2 + 0.00029 * tC ** 3;
}

// Walther / ASTM D341 line through two catalogue points:  log₁₀ log₁₀ (ν + 0.7) = a − b log₁₀ T   (ν in mm²/s = cSt, T in K)
const OIL = (() => {
  const anchor = (nu: number, tC: number) => ({ x: Math.log10(tC + 273.15), y: Math.log10(Math.log10(nu + 0.7)) });
  const p1 = anchor(32, 40);
  const p2 = anchor(5.4, 100);
  const b = (p1.y - p2.y) / (p2.x - p1.x);
  return { a: p1.y + b * p1.x, b, density15: 865, expansion: 6.4e-4, soundSpeed20: 1320, soundSlope: -3.5 };
})();

/** Kinematic viscosity of ISO VG 32 oil [m²/s]. */
export function oilKinematic(tC: number): number {
  const lg = Math.pow(10, OIL.a - OIL.b * Math.log10(tC + 273.15));
  return (Math.pow(10, lg) - 0.7) * 1e-6;
}
export const oilDensity = (tC: number) => OIL.density15 * (1 - OIL.expansion * (tC - 15));

// ---- the state of a fluid

export interface FluidError {
  ok: false;
  errors: string[];
}

/** Valid pressure range [Pa] of the ideal-gas and liquid models. */
export const PRESSURE_RANGE = { gas: [10, 5e7], liquid: [1e3, 1e8] } as const;

/**
 * The fluid at a temperature [°C] and, for air only when no pressure was typed, the height [m]. Throws a plain-language Error
 * when the choice is outside what the correlations cover; use `checkFluid` first to get the messages without throwing.
 */
export function fluidState(spec: FluidSpec, tempC: number, altitudeM = 0): FluidState {
  const bad = checkFluid(spec, tempC, altitudeM);
  if (bad) throw new Error(bad.errors.join('; '));
  if (isGas(spec.id)) return gasState(spec, tempC, altitudeM);
  if (spec.id === 'custom') return customState(spec, tempC);
  return liquidState(spec, tempC, fluidInfo(spec.id));
}

function resolvePressure(spec: FluidSpec, altitudeM: number): PressureSpec {
  return spec.pressure ?? (spec.id === 'air' ? { kind: 'altitude', altitudeM } : { kind: 'absolute', pa: STANDARD_PRESSURE });
}

/** Everything that is wrong with a choice, or null when it is usable. */
export function checkFluid(spec: FluidSpec, tempC: number, altitudeM = 0): FluidError | null {
  const errors: string[] = [];
  const info = FLUIDS.find((f) => f.id === spec.id);
  if (!info) return { ok: false, errors: [`unknown fluid “${spec.id}”`] };
  if (!Number.isFinite(tempC)) errors.push('temperature: please enter a number');
  else if (tempC < info.tempRangeC[0] || tempC > info.tempRangeC[1]) errors.push(`${info.label}: the temperature must be between ${info.tempRangeC[0]} and ${info.tempRangeC[1]} °C (the range of its property correlations)`);
  const pr = resolvePressure(spec, altitudeM);
  if (pr.kind === 'altitude') {
    if (spec.id !== 'air') errors.push('the height above sea level gives a pressure for air only: give another fluid a pressure or a depth');
    else if (!Number.isFinite(pr.altitudeM) || pr.altitudeM < -5000 || pr.altitudeM > 32000) errors.push('height above sea level must be between −5000 and 32000 m (the range of the standard atmosphere used)');
  } else if (pr.kind === 'depth') {
    if (info.kind !== 'liquid' && spec.id !== 'custom') errors.push('a depth gives a pressure for a liquid only');
    else if (!Number.isFinite(pr.depthM) || pr.depthM < 0 || pr.depthM > 10000) errors.push('depth must be between 0 and 10000 m');
  } else {
    const [lo, hi] = info.kind === 'gas' ? PRESSURE_RANGE.gas : PRESSURE_RANGE.liquid;
    if (!Number.isFinite(pr.pa) || pr.pa < lo || pr.pa > hi) errors.push(`pressure must be between ${lo} and ${hi} Pa for ${info.label}`);
  }
  if (spec.id === 'custom') {
    const c = spec.custom;
    if (!c) errors.push('custom fluid: enter a density and a viscosity');
    else {
      if (!(c.density > 0) || !Number.isFinite(c.density)) errors.push('custom fluid: density must be a positive number (kg/m³)');
      if (!(c.viscosity > 0) || !Number.isFinite(c.viscosity)) errors.push('custom fluid: viscosity must be a positive number (Pa·s)');
      if (c.soundSpeed !== undefined && !(c.soundSpeed > 0)) errors.push('custom fluid: speed of sound must be positive (m/s), or left empty');
      if (c.vaporPressure !== undefined && !(c.vaporPressure >= 0)) errors.push('custom fluid: vapour pressure cannot be negative (Pa), or leave it empty');
    }
  }
  return errors.length ? { ok: false, errors } : null;
}

function gasState(spec: FluidSpec, tempC: number, altitudeM: number): FluidState {
  const id = spec.id as GasId;
  const g = GASES[id];
  const T = tempC + 273.15;
  const Rs = (GAS_CONSTANT_UNIVERSAL * 1000) / g.M;
  const pr = resolvePressure(spec, altitudeM);
  const pressure = pr.kind === 'altitude' ? isaPressure(pr.altitudeM) : pr.kind === 'absolute' ? pr.pa : STANDARD_PRESSURE;
  const viscosity = g.mu0 * Math.pow(T / g.T0, 1.5) * ((g.T0 + g.S) / (T + g.S));
  const density = pressure / (Rs * T);
  const soundSpeed = Math.sqrt(g.gamma * Rs * T);
  const meanFreePath = (viscosity / pressure) * Math.sqrt((Math.PI * Rs * T) / 2);
  const notes = [`Ideal gas: ρ = p / (R T) with R = ${Rs.toFixed(1)} J/(kg K); c = √(γ R T) with γ = ${g.gamma}; viscosity by Sutherland's law (within about 2–3 % between −50 and 300 °C, extrapolated outside), independent of pressure.`];
  if (pressure > 5e6) notes.push('Above a few MPa a real gas deviates from the ideal-gas law (several per cent in density): treat the numbers as approximate.');
  if (id === 'air') notes.push('Dry air; humid air is up to about 1 % lighter.');
  return {
    id, label: g.label, kind: 'gas', T, tempC, pressure, density, viscosity, kinematic: viscosity / density, soundSpeed, gamma: g.gamma, gasConstant: Rs, vaporPressure: null, meanFreePath,
    pressureNote: pr.kind === 'altitude' ? `${(pressure / 1000).toFixed(2)} kPa from ${pr.altitudeM} m above sea level (International Standard Atmosphere)` : `${pressure < 1000 ? pressure.toFixed(1) + ' Pa' : (pressure / 1000).toFixed(2) + ' kPa'} as given`,
    notes,
  };
}

function liquidState(spec: FluidSpec, tempC: number, info: FluidInfo): FluidState {
  const T = tempC + 273.15;
  let density0: number;
  let viscosity: number;
  let soundSpeed: number;
  let vaporPressure: number;
  const notes: string[] = [];
  if (spec.id === 'water') {
    density0 = waterDensity(tempC);
    viscosity = waterViscosity(tempC);
    soundSpeed = waterSoundSpeed(tempC);
    vaporPressure = waterVaporPressure(tempC);
    notes.push('Fresh water at 1 atm: density to about 0.01 %, viscosity to about 1 %, speed of sound to about 0.1 %, vapour pressure to about 0.5 %; above 100 °C it would boil at this pressure.');
  } else if (spec.id === 'seawater') {
    density0 = seawaterDensity(tempC);
    viscosity = seawaterViscosity(tempC);
    soundSpeed = seawaterSoundSpeed(tempC);
    vaporPressure = waterVaporPressure(tempC) * (1 - 0.538 * SALINITY);
    notes.push('Sea water of 35 g/kg salinity: density to about 0.01 %, viscosity to about 1.5 %, speed of sound to about 0.1 %, vapour pressure to about 1 %. Dissolved gas (which makes real water cavitate earlier than its vapour pressure suggests) is not modelled.');
  } else {
    density0 = oilDensity(tempC);
    viscosity = oilKinematic(tempC) * density0;
    soundSpeed = OIL.soundSpeed20 + OIL.soundSlope * (tempC - 20);
    vaporPressure = 0;
    notes.push('Typical mineral hydraulic oil: the viscosity follows the Walther line through the two ISO VG 32 anchors; density, expansion and speed of sound are typical values (real oils differ by brand by several per cent). Its vapour pressure is negligible.');
  }
  const pr = resolvePressure(spec, 0);
  // a liquid is nearly incompressible: its density rises by Δp / K, with the bulk modulus K = ρ c²
  const K = density0 * soundSpeed * soundSpeed;
  const at = (p: number) => density0 * (1 + (p - STANDARD_PRESSURE) / K);
  let pressure: number;
  let pressureNote: string;
  if (pr.kind === 'depth') {
    let p = STANDARD_PRESSURE;
    for (let i = 0; i < 4; i++) p = STANDARD_PRESSURE + at(p) * STANDARD_GRAVITY_MS2 * pr.depthM;
    pressure = p;
    pressureNote = `${(pressure / 1000).toFixed(1)} kPa at ${pr.depthM} m depth (p = p₀ + ρ g d)`;
  } else {
    pressure = pr.kind === 'absolute' ? pr.pa : STANDARD_PRESSURE;
    pressureNote = `${(pressure / 1000).toFixed(1)} kPa as given`;
  }
  const density = at(pressure);
  return { id: spec.id, label: info.label, kind: 'liquid', T, tempC, pressure, density, viscosity, kinematic: viscosity / density, soundSpeed, gamma: null, gasConstant: null, vaporPressure, meanFreePath: null, pressureNote, notes };
}

function customState(spec: FluidSpec, tempC: number): FluidState {
  const c = spec.custom!;
  const pr = spec.pressure;
  const pressure = pr?.kind === 'absolute' ? pr.pa : pr?.kind === 'depth' ? STANDARD_PRESSURE + c.density * STANDARD_GRAVITY_MS2 * pr.depthM : STANDARD_PRESSURE;
  return {
    id: 'custom', label: 'Custom fluid', kind: 'liquid', T: tempC + 273.15, tempC, pressure, density: c.density, viscosity: c.viscosity, kinematic: c.viscosity / c.density,
    soundSpeed: c.soundSpeed ?? Number.POSITIVE_INFINITY, gamma: null, gasConstant: null, vaporPressure: c.vaporPressure ?? null, meanFreePath: null,
    pressureNote: `${(pressure / 1000).toFixed(1)} kPa${pr ? ' as given' : ' (standard pressure; none given)'}`,
    notes: ['The properties are the ones you typed and are taken as constant: the temperature and pressure do not change them.' + (c.soundSpeed === undefined ? ' Without a speed of sound the fluid is treated as incompressible (no Mach number).' : '')],
  };
}

/** The fluid of a set of plain inputs: air at the height and temperature of the particle workspace unless a fluid was chosen. */
export function fluidOfInput(input: { tempC: number; altitudeM: number; fluid?: FluidSpec }): FluidState {
  return fluidState(input.fluid ?? DEFAULT_FLUID, input.tempC, input.altitudeM);
}

/** Reynolds number ρ U L / μ. */
export const reynoldsNumber = (f: Pick<FluidState, 'density' | 'viscosity'>, speedMs: number, lengthM: number): number => (f.density * speedMs * lengthM) / f.viscosity;
