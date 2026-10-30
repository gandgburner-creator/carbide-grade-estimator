import { checkFluid, DEFAULT_FLUID, fluidInfo, fluidOfInput, FLUIDS, isaTemperature, type FluidId, type FluidInfo, type FluidSpec, type FluidState, type PressureSpec } from '../benchmarks/Fluids';
import type { PhysicalInputs } from './FlowGeometryExperiment';
import { parseScenario } from './PhysicalScenario';

/**
 * THE FLUID CONTROLS OF THE CFD WORKSPACE: what a person types (as text) to choose a fluid, its temperature and its pressure, turned
 * into the plain inputs of a run with every problem named in words. The properties themselves are in benchmarks/Fluids.ts.
 *
 * Pressure has three sources: for air, the height above sea level (International Standard Atmosphere); for any fluid, a typed
 * absolute pressure; for a liquid, a depth below an open surface (p = p₀ + ρ g d).
 */
export { FLUIDS, fluidInfo, type FluidId, type FluidInfo, type FluidSpec, type FluidState };

export type PressureMode = 'altitude' | 'absolute' | 'depth';

export interface FluidTexts {
  id: FluidId;
  mode: PressureMode;
  /** typed absolute pressure in kPa */
  pressureKPa: string;
  /** typed depth in m */
  depthM: string;
  /** custom fluid: density [kg/m³], viscosity [mPa·s], speed of sound [m/s] and vapour pressure [kPa] (the last two may stay empty) */
  density: string;
  viscosityMPas: string;
  soundSpeed: string;
  vaporKPa: string;
}

export const DEFAULT_FLUID_TEXTS: FluidTexts = { id: 'air', mode: 'altitude', pressureKPa: '101.325', depthM: '1', density: '1000', viscosityMPas: '1', soundSpeed: '', vaporKPa: '' };

/** The pressure sources a fluid offers, the first being its default. */
export function pressureModes(id: FluidId): PressureMode[] {
  const info = fluidInfo(id);
  return id === 'air' ? ['altitude', 'absolute'] : info.kind === 'gas' ? ['absolute'] : ['absolute', 'depth'];
}

/** The controls for a freshly chosen fluid: its own default pressure source, the typed values kept. */
export function chooseFluid(t: FluidTexts, id: FluidId): FluidTexts {
  const modes = pressureModes(id);
  return { ...t, id, mode: modes.includes(t.mode) ? t.mode : modes[0] };
}

export function fluidTextsOf(spec: FluidSpec | undefined): FluidTexts {
  if (!spec) return { ...DEFAULT_FLUID_TEXTS };
  const t: FluidTexts = { ...DEFAULT_FLUID_TEXTS, id: spec.id, mode: spec.pressure?.kind ?? pressureModes(spec.id)[0] };
  if (spec.pressure?.kind === 'absolute') t.pressureKPa = String(spec.pressure.pa / 1000);
  if (spec.pressure?.kind === 'depth') t.depthM = String(spec.pressure.depthM);
  if (spec.custom) {
    t.density = String(spec.custom.density);
    t.viscosityMPas = String(spec.custom.viscosity * 1000);
    t.soundSpeed = spec.custom.soundSpeed === undefined ? '' : String(spec.custom.soundSpeed);
    t.vaporKPa = spec.custom.vaporPressure === undefined ? '' : String(spec.custom.vaporPressure / 1000);
  }
  return t;
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number.isFinite(Number(s)) ? Number(s) : Number.NaN);

/** The fluid choice as data, or what is wrong with the texts. `undefined` stands for the default: air at the height typed. */
export function readFluid(t: FluidTexts): { ok: true; spec: FluidSpec | undefined } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let pressure: PressureSpec | undefined;
  if (t.mode === 'absolute') {
    const k = num(t.pressureKPa);
    if (k === null || Number.isNaN(k)) errors.push('pressure: please enter a number (kPa)');
    else pressure = { kind: 'absolute', pa: k * 1000 };
  } else if (t.mode === 'depth') {
    const d = num(t.depthM);
    if (d === null || Number.isNaN(d)) errors.push('depth: please enter a number (m)');
    else pressure = { kind: 'depth', depthM: d };
  }
  let custom: FluidSpec['custom'];
  if (t.id === 'custom') {
    const rho = num(t.density);
    const mu = num(t.viscosityMPas);
    const c = num(t.soundSpeed);
    const pv = num(t.vaporKPa);
    if (rho === null || Number.isNaN(rho)) errors.push('custom fluid: please enter a density (kg/m³)');
    if (mu === null || Number.isNaN(mu)) errors.push('custom fluid: please enter a viscosity (mPa·s)');
    if (c !== null && Number.isNaN(c)) errors.push('custom fluid: the speed of sound must be a number (m/s) or empty');
    if (pv !== null && Number.isNaN(pv)) errors.push('custom fluid: the vapour pressure must be a number (kPa) or empty');
    if (!errors.length) custom = { density: rho!, viscosity: mu! / 1000, ...(c !== null ? { soundSpeed: c } : {}), ...(pv !== null ? { vaporPressure: pv * 1000 } : {}) };
  }
  if (errors.length) return { ok: false, errors };
  if (t.id === 'air' && t.mode === 'altitude' && !custom) return { ok: true, spec: undefined };
  return { ok: true, spec: { id: t.id, ...(pressure ? { pressure } : {}), ...(custom ? { custom } : {}) } };
}

export type CfdInputCheck = { ok: true; input: PhysicalInputs; fluid: FluidState } | { ok: false; errors: string[] };

/** The six plain inputs and the fluid controls, checked together: the temperature against the fluid's range, the height only where it gives the pressure. */
export function parseCfdInputs(text: Parameters<typeof parseScenario>[0], fluid: FluidTexts): CfdInputCheck {
  const read = readFluid(fluid);
  const info = fluidInfo(fluid.id);
  const usesHeight = fluid.id === 'air' && fluid.mode === 'altitude';
  const sc = parseScenario(text, { tempLabel: 'fluid temperature', tempRange: info.tempRangeC, altitudeUnused: !usesHeight });
  const errors: string[] = [...(read.ok ? [] : read.errors), ...(sc.ok ? [] : sc.errors)];
  if (errors.length || !read.ok || !sc.ok) return { ok: false, errors };
  const input: PhysicalInputs = { ...sc.input, ...(read.spec ? { fluid: read.spec } : {}) };
  const bad = checkFluid(read.spec ?? DEFAULT_FLUID, input.tempC, input.altitudeM);
  if (bad) return { ok: false, errors: bad.errors };
  return { ok: true, input, fluid: fluidOfInput(input) };
}

/** The standard-atmosphere temperature at a height [°C], to offer as the temperature of air at that height. */
export const isaTemperatureC = (altitudeM: number): number => Math.round((isaTemperature(altitudeM) - 273.15) * 10) / 10;

export const PRESSURE_MODE_LABEL: Record<PressureMode, string> = { altitude: 'from the height (standard atmosphere)', absolute: 'typed (absolute pressure)', depth: 'from the depth below the surface' };
