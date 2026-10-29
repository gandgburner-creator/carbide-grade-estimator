import { airReference, similarityNumbers, type AirState } from '../benchmarks/AirReference';
import type { ForceMeasure } from '../geometry/Forces';
import type { Est } from '../measurements/SeparationDetector';
import type { PhysicalInputs } from './FlowGeometryExperiment';

/**
 * PLAIN-UNIT SETUP: plate length and thickness in cm, ambient temperature in °C, height above
 * sea level in m, wind speed in km/h, angle of attack in degrees — turned into the particle
 * model's own parameters, with an honest account of what that does and does not represent.
 *
 * What maps, and how:
 *   shape, angle  exactly (geometric similarity): the model draws the same length:thickness ratio at the
 *                 same angle, in particle diameters. Only ratios from 2:1 to 40:1 can be drawn.
 *   wind speed    through the Mach number, when the model can run it. Mach = wind / speed of sound of the
 *                 air the person described. The particle model needs a flow of at least its standard speed
 *                 (Mach ≈ 0.55, the speed every reference run and probe of this model used) to give a
 *                 measurable signal above the thermal motion, and it is calibrated up to 3 d/τ. Outside
 *                 that range the speed is clamped and the clamp is stated in plain words.
 *   temperature,  they set the real air (density, speed of sound, viscosity, mean free path). They change the
 *   altitude      simulated flow ONLY through the Mach number above. Otherwise they are used to show how far
 *                 the simulation is from the real situation.
 *
 * What does NOT map: the simulated gas is a thin 2-D gas of hard disks (Knudsen ≈ 0.19 on a 30 d plate,
 * Reynolds ≈ 10–20). A real plate in air has Knudsen ~10⁻⁶ and Reynolds ~10⁴–10⁶. Mach, Reynolds and
 * Knudsen cannot all be matched by this model, so a result describes how THIS gas flows around a plate of
 * that shape — never how air flows around the person's plate. The summary lines say so.
 *
 * The model's own Mach, Reynolds and Knudsen numbers use values MEASURED by this repository's references
 * (sound speed: results/sound-speed_sweeps.json; viscosity: results/viscosity_reference.json), checked
 * against those files by tests/scenario.test.ts. The air values are classical references
 * (benchmarks/AirReference.ts) and are used for comparison and for the one disclosed Mach conversion.
 */
export const MODEL = {
  areaFraction: 0.1,
  radius: 0.5,
  /** n = φ / (π r²), per d² */
  numberDensity: 0.1 / (Math.PI * 0.25),
  /** measured sound speed at φ = 0.1, d/τ (8 seeds, SE 0.098) */
  soundSpeed: 1.8075549666762243,
  /** measured effective (Couette) viscosity at φ = 0.1, m/(d τ) (30 seeds, SE 0.0079) */
  viscosity: 0.33260355714781753,
  /** kinetic-theory estimate for 2-D hard disks, λ = 1/(√2 n d), in d */
  meanFreePath: 1 / (Math.SQRT2 * (0.1 / (Math.PI * 0.25))),
  /** the standard stream speed of the reference runs, and the largest the form allows, in d/τ */
  minSpeed: 1,
  maxSpeed: 3,
  /** drawable plate: chord 12–80 d, thickness 2–12 d, ratio 2–40 */
  minChord: 12,
  maxChord: 80,
  defaultChord: 30,
  minThickness: 2,
  maxThickness: 12,
  minRatio: 2,
  maxRatio: 40,
} as const;

export const DEFAULT_SCENARIO: PhysicalInputs = { lengthCm: 20, thicknessCm: 2, tempC: 15, altitudeM: 0, speedKmh: 36, alphaDeg: 65 };

export interface FieldSpec {
  key: keyof PhysicalInputs;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** what the simulation does with it (shown under the field) */
  role: string;
}

export const FIELDS: FieldSpec[] = [
  { key: 'lengthCm', label: 'plate length', unit: 'cm', min: 1, max: 1000, step: 1, role: 'sets the shape (length : thickness)' },
  { key: 'thicknessCm', label: 'plate thickness', unit: 'cm', min: 0.01, max: 500, step: 0.1, role: 'sets the shape (length : thickness)' },
  { key: 'tempC', label: 'air temperature', unit: '°C', min: -60, max: 50, step: 1, role: 'describes the real air (compared below)' },
  { key: 'altitudeM', label: 'height above sea level', unit: 'm', min: 0, max: 11000, step: 100, role: 'describes the real air (compared below)' },
  { key: 'speedKmh', label: 'wind speed', unit: 'km/h', min: 1, max: 2000, step: 1, role: 'sets the simulated speed only if fast enough (see below)' },
  { key: 'alphaDeg', label: 'angle of attack', unit: '°', min: 0, max: 89, step: 1, role: 'sets the angle exactly' },
];

export type ScenarioCheck = { ok: true; input: PhysicalInputs } | { ok: false; errors: string[] };

/** Read the six numbers a person typed (as text) and check them. */
export function parseScenario(text: Record<keyof PhysicalInputs, string>): ScenarioCheck {
  const errors: string[] = [];
  const input = {} as PhysicalInputs;
  for (const f of FIELDS) {
    const raw = text[f.key];
    const x = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(x)) errors.push(`${f.label}: please enter a number`);
    else if (x < f.min || x > f.max) errors.push(`${f.label} must be between ${f.min} and ${f.max} ${f.unit}`);
    else input[f.key] = x;
  }
  if (!errors.length && input.thicknessCm * MODEL.minRatio > input.lengthCm) errors.push(`the plate must be at least ${MODEL.minRatio} times longer than it is thick (this is ${(input.lengthCm / input.thicknessCm).toFixed(1)} : 1)`);
  return errors.length ? { ok: false, errors } : { ok: true, input };
}

export interface ScenarioModel {
  /** the plate as drawn, in particle diameters */
  chord: number;
  thickness: number;
  /** the length : thickness ratio asked for, and the one drawn */
  ratioAsked: number;
  ratioDrawn: number;
  /** stream speed of the simulation, d/τ, and why it has this value */
  speed: number;
  speedBasis: 'matched' | 'too-slow' | 'too-fast';
  alphaDeg: number;
}

/** The simulation setup that follows from the plain inputs. */
export function scenarioToModel(input: PhysicalInputs): ScenarioModel {
  const ratioAsked = input.lengthCm / input.thicknessCm;
  const ratioDrawn = Math.min(MODEL.maxRatio, Math.max(MODEL.minRatio, ratioAsked));
  let chord: number = MODEL.defaultChord;
  let thickness = chord / ratioDrawn;
  if (thickness > MODEL.maxThickness) {
    thickness = MODEL.maxThickness;
    chord = thickness * ratioDrawn;
  } else if (thickness < MODEL.minThickness) {
    thickness = MODEL.minThickness;
    chord = thickness * ratioDrawn;
  }
  chord = Math.round(chord * 2) / 2;
  thickness = Math.round(thickness * 10) / 10;
  const air = airReference(input.tempC, input.altitudeM);
  const machAir = input.speedKmh / 3.6 / air.soundSpeed;
  const wanted = machAir * MODEL.soundSpeed;
  const speedBasis = wanted < MODEL.minSpeed ? 'too-slow' : wanted > MODEL.maxSpeed ? 'too-fast' : 'matched';
  const speed = Math.round(Math.min(MODEL.maxSpeed, Math.max(MODEL.minSpeed, wanted)) * 1000) / 1000;
  return { chord, thickness, ratioAsked, ratioDrawn, speed, speedBasis, alphaDeg: input.alphaDeg };
}

export interface Regime {
  mach: number;
  reynolds: number;
  knudsen: number;
}

/** The three similarity numbers of the simulation, from the model's own measured sound speed and viscosity. */
export function simulatedRegime(chord: number, speed: number, areaFraction: number = MODEL.areaFraction): Regime | null {
  if (Math.abs(areaFraction - MODEL.areaFraction) > 1e-9) return null;
  return { mach: speed / MODEL.soundSpeed, reynolds: (MODEL.numberDensity * speed * chord) / MODEL.viscosity, knudsen: MODEL.meanFreePath / chord };
}

/** Number of particles of the simulation box for a plate of this chord (domain 6 chords × 3.33 chords). */
export function particleCount(chord: number, areaFraction: number = MODEL.areaFraction): number {
  const L = Math.round(6 * chord);
  const H = Math.round((10 * chord) / 3);
  return Math.round((areaFraction * L * H) / (Math.PI * MODEL.radius * MODEL.radius));
}

/** 3 significant figures, with powers of ten for very large and very small numbers. */
export function sci(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && (a >= 10000 || a < 0.01)) {
    const e = Math.floor(Math.log10(a));
    const m = x / Math.pow(10, e);
    const sup = String(e)
      .split('')
      .map((c) => ({ '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' })[c as '-'] ?? c)
      .join('');
    return `${m.toPrecision(2)}×10${sup}`;
  }
  return a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3);
}

export interface ScenarioReport {
  air: AirState;
  windMs: number;
  real: Regime;
  model: ScenarioModel;
  simulated: Regime;
  particles: number;
  /** plain-language account, one sentence per line */
  lines: string[];
  /** things to be careful about, also plain language */
  cautions: string[];
}

/** Everything the screen says about a set of plain inputs. */
export function describeScenario(input: PhysicalInputs): ScenarioReport {
  const air = airReference(input.tempC, input.altitudeM);
  const windMs = input.speedKmh / 3.6;
  const real = similarityNumbers(air, windMs, input.lengthCm / 100);
  const model = scenarioToModel(input);
  const simulated = simulatedRegime(model.chord, model.speed)!;
  const particles = particleCount(model.chord);
  const cautions: string[] = [];
  const lines: string[] = [];

  lines.push(`Shape: your plate ${input.lengthCm} × ${input.thicknessCm} cm (${model.ratioAsked.toFixed(1)} : 1) is drawn as ${model.chord} × ${model.thickness} particle-diameters, at ${input.alphaDeg}°.`);
  if (model.ratioDrawn !== model.ratioAsked) cautions.push(`The model can only draw plates from ${MODEL.minRatio} : 1 to ${MODEL.maxRatio} : 1, so it draws ${model.ratioDrawn} : 1 instead of ${model.ratioAsked.toFixed(1)} : 1.`);

  if (model.speedBasis === 'matched') lines.push(`Wind: ${input.speedKmh} km/h (${windMs.toFixed(1)} m/s) is Mach ${sci(real.mach)} in this air. The simulation runs at the same Mach number.`);
  else if (model.speedBasis === 'too-slow') lines.push(`Wind: ${input.speedKmh} km/h (${windMs.toFixed(1)} m/s) is only Mach ${sci(real.mach)} in this air. The particle model cannot show a wind that slow (the motion would be lost in the random thermal motion), so it runs at its slowest usable setting, Mach ${sci(simulated.mach)}. The simulated wind is about ${Math.round(simulated.mach / real.mach)} times faster, relative to the speed of sound, than yours.`);
  else lines.push(`Wind: ${input.speedKmh} km/h is Mach ${sci(real.mach)} in this air, faster than this model is calibrated for. It runs at its fastest setting, Mach ${sci(simulated.mach)}.`);

  lines.push(`Temperature and altitude change the real air (here: density ${air.density.toFixed(3)} kg/m³, speed of sound ${air.soundSpeed.toFixed(0)} m/s) but not the simulated gas. They affect the simulation only through the Mach number above${model.speedBasis === 'matched' ? '' : ', and since the speed is set by the model’s limit, they change nothing in the run itself'}.`);

  lines.push(
    `Regime: your plate is in dense air (Knudsen ${sci(real.knudsen)}, Reynolds ${sci(real.reynolds)}). The simulation is a thin gas of hard disks (Knudsen ${sci(simulated.knudsen)}, Reynolds ${sci(simulated.reynolds)}). Same shape and angle, very different flow regime.`,
  );
  cautions.push('A result therefore shows how this particle gas flows around a plate of that shape. It does not predict how air flows around your plate. The lift and drag it reports are those of the particle gas; they are scaled to your air only to give them units, and they say nothing reliable about the lift, drag or performance of the real plate.');
  if (input.alphaDeg < 55) cautions.push('In this model, reversed flow near the surface has only been seen at large angles (roughly 55° and above). At small angles expect the detector to report nothing.');
  if (particles > 8000) cautions.push(`This plate needs a large simulation (about ${particles.toLocaleString('en')} particles); each version will take many minutes.`);
  return { air, windMs, real, model, simulated, particles, lines, cautions };
}

// ---- lift and drag on a wing of a given depth, in the air that was described

/** The simulation is two-dimensional (a wing of unit depth); this is the depth asked for by default [cm]. */
export const DEFAULT_DEPTH_CM = 100;

export function parseDepth(text: string): { ok: true; depthCm: number } | { ok: false; error: string } {
  const x = Number(text);
  if (text.trim() === '' || !Number.isFinite(x)) return { ok: false, error: 'wing depth: please enter a number' };
  if (x < 1 || x > 5000) return { ok: false, error: 'wing depth must be between 1 and 5000 cm' };
  return { ok: true, depthCm: x };
}

export interface WingForces {
  /** the simulation's drag and lift coefficients applied to the wing in the described air [N] */
  drag: Est;
  lift: Est;
  /** ½ ρ U² of the described air and wind [Pa], the wing area chord × depth [m²], and the depth : chord ratio */
  dynamicPressure: number;
  area: number;
  aspectRatio: number;
  chordM: number;
  depthM: number;
  /** N per unit of the simulation's force: multiply a difference of simulated forces by this to scale it too */
  newtonsPerUnit: number;
  air: AirState;
}

/**
 * The SIMULATION'S coefficients applied to the wing and the air that were described:
 *
 *     F = C · ½ ρ_air U_wind² · (chord × depth)
 *
 * with ρ_air the reference density at the given temperature and height (benchmarks/AirReference.ts), U_wind the wind
 * speed, chord the plate length and depth the wing depth. This is a SCALING, not a prediction: the coefficients were
 * measured in a thin 2-D gas at its own Reynolds, Mach and Knudsen numbers (see describeScenario), and a real wing of
 * finite depth has end effects the 2-D simulation does not have. It exists to put the measured numbers in units a
 * person can picture; the screen says so wherever it is shown.
 */
export function wingForces(m: ForceMeasure, input: PhysicalInputs, depthCm: number): WingForces {
  const air = airReference(input.tempC, input.altitudeM);
  const windMs = input.speedKmh / 3.6;
  const chordM = input.lengthCm / 100;
  const depthM = depthCm / 100;
  const q = 0.5 * air.density * windMs * windMs;
  const area = chordM * depthM;
  const k = q * area;
  const sc = (e: Est): Est => ({ mean: e.mean * k, se: Math.abs(k) * e.se, n: e.n });
  return { drag: sc(m.dragCoeff), lift: sc(m.liftCoeff), dynamicPressure: q, area, aspectRatio: depthM / chordM, chordM, depthM, newtonsPerUnit: k / m.reference, air };
}
