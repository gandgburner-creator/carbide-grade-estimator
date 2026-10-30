import { airReference, similarityNumbers, type AirState } from '../benchmarks/AirReference';
import { CFD_BASE, CFD_PRESETS, reynoldsCap } from '../cfd/CfdRun';
import type { PlateSpec } from '../geometry/Pointer';
import type { PhysicalInputs } from './FlowGeometryExperiment';
import { sci } from './PhysicalScenario';

/**
 * PLAIN-UNIT SETUP OF THE CFD WORKSPACE: plate length and thickness in cm, air temperature in °C, height in m, wind in km/h,
 * angle in degrees, turned into the parameters of one CFD run — with an honest account of what is and is not matched.
 *
 *   shape, angle   exactly: the same length : thickness ratio (2 : 1 … 40 : 1) at the same angle, with round ends
 *   Reynolds       the Reynolds number of your plate in your air, Re = ρ U L / μ, from the standard-atmosphere air at your
 *                  temperature and height (benchmarks/AirReference.ts: a comparison and scaling aid; nothing of it enters the
 *                  equations). The run uses it EXACTLY when the resolution can run it, and otherwise the largest one it can
 *                  run (a Reynolds number of 10⁵ would need a lattice far finer than a browser can hold): then the result is
 *                  the flow at a lower Reynolds number than yours, and it says so.
 *   Mach           the lattice runs at Mach ≈ 0.14, the real wind at Mach ≈ 0.03: both are incompressible flows
 *   2-D            the simulation is two-dimensional (a plate of infinite depth); real wings have ends and a third dimension
 *
 * The temperature and height act only through the Reynolds number (and, when forces are scaled to newtons, through the density).
 */
export interface CfdSetup {
  plate: PlateSpec;
  ratioAsked: number;
  ratioDrawn: number;
  /** the plate was made thicker than asked so that it is at least a few cells thick (either end) */
  thicknessNote: string | null;
  air: AirState;
  windMs: number;
  real: { reynolds: number; mach: number };
  preset: keyof typeof CFD_PRESETS;
  cells: number;
  reynolds: number;
  reynoldsCap: number;
  capped: boolean;
  latticeMach: number;
  lines: string[];
  cautions: string[];
}

/** plate length in plate units (as in the particle workspace) */
export const CFD_PLATE_LENGTH = 30;
const MIN_CELLS_THICK = 3.2;

export function cfdSetup(input: PhysicalInputs, preset: keyof typeof CFD_PRESETS): CfdSetup {
  const cells = CFD_PRESETS[preset].cells;
  const air = airReference(input.tempC, input.altitudeM);
  const windMs = input.speedKmh / 3.6;
  const sim = similarityNumbers(air, windMs, input.lengthCm / 100);
  const ratioAsked = input.lengthCm / input.thicknessCm;
  const ratioDrawn = Math.min(40, Math.max(2, ratioAsked));
  let thickness = CFD_PLATE_LENGTH / ratioDrawn;
  let thicknessNote: string | null = null;
  const minThick = (MIN_CELLS_THICK * CFD_PLATE_LENGTH) / cells;
  if (thickness < minThick) {
    thickness = minThick;
    thicknessNote = `The plate would be thinner than ${MIN_CELLS_THICK} lattice cells at this resolution, so it is drawn ${(CFD_PLATE_LENGTH / thickness).toFixed(1)} : 1 instead of ${ratioDrawn.toFixed(1)} : 1 (a finer resolution draws a thinner plate).`;
  }
  // the trailing round end, at the same scale (plate units per cm of the plate) and at least a few cells across
  let trailingThickness: number | undefined;
  if (input.trailingThicknessCm !== undefined && input.trailingThicknessCm !== input.thicknessCm) {
    const wanted = thickness * (input.trailingThicknessCm / input.thicknessCm);
    let t = Math.max(minThick, wanted);
    if (t > wanted + 1e-9) thicknessNote = `${thicknessNote ? thicknessNote + ' ' : ''}The trailing end would be thinner than ${MIN_CELLS_THICK} lattice cells at this resolution, so it is drawn ${t.toFixed(2)} thick instead of ${wanted.toFixed(2)}.`;
    // the straight stretch between the circles must stay as long as the thicker end is wide
    const fat = Math.max(thickness, t);
    if (CFD_PLATE_LENGTH < thickness / 2 + t / 2 + fat) {
      t = Math.max(minThick, 2 * (CFD_PLATE_LENGTH - thickness / 2 - fat));
      thicknessNote = `${thicknessNote ? thicknessNote + ' ' : ''}The plate is too short for a trailing end that thick: it is drawn ${t.toFixed(2)} across.`;
    }
    trailingThickness = t;
  }
  const cap = reynoldsCap(cells);
  const reynolds = Math.min(sim.reynolds, cap);
  const capped = sim.reynolds > cap;
  const latticeMach = CFD_BASE.uLattice * Math.sqrt(3);
  const lines: string[] = [];
  const cautions: string[] = [];
  lines.push(`Shape: your plate ${input.lengthCm} × ${input.thicknessCm} cm (${ratioAsked.toFixed(1)} : 1) is drawn with round ends, ${CFD_PLATE_LENGTH} units long and ${thickness.toFixed(2)} thick (${ratioDrawn.toFixed(1)} : 1), at ${input.alphaDeg}°.`);
  if (trailingThickness !== undefined) lines.push(`Round ends: the leading end is ${input.thicknessCm} cm across, the trailing end ${input.trailingThicknessCm} cm, drawn ${thickness.toFixed(2)} and ${trailingThickness.toFixed(2)} across and joined by the straight edges that touch both.`);
  lines.push(`Air: ${input.tempC} °C at ${input.altitudeM} m: density ${air.density.toFixed(3)} kg/m³, viscosity ${sci(air.viscosity)} Pa·s. Wind ${windMs.toFixed(1)} m/s (Mach ${sci(sim.mach)}).`);
  lines.push(`Reynolds number: your plate in your air has Re = ${sci(sim.reynolds)}. This run uses Re = ${sci(reynolds)}${capped ? ` (the most that ${cells} cells along the plate can run)` : ' (the same)'}. The lattice flow is at Mach ${latticeMach.toFixed(2)}: both are incompressible.`);
  if (capped) {
    cautions.push(`At Re = ${sci(sim.reynolds)} the flow around a real plate is turbulent; this simulation runs at Re = ${sci(reynolds)}, ${(sim.reynolds / reynolds).toFixed(0)} times lower, and is two-dimensional. Where the flow separates, how big the wake is and the force coefficients can all differ. It shows how a fluid of that Reynolds number flows around this shape; it does not predict your plate.`);
  } else {
    cautions.push(`The Reynolds number of your plate in your air is within what this resolution can run, so the lattice flow is at your Reynolds number. It is still two-dimensional (a plate of infinite depth): a real plate has ends, and the numbers are those of a section of it.`);
  }
  cautions.push('The fluid is solved from the Navier–Stokes equations on a lattice (lattice Boltzmann). No Kutta condition, no circulation and no separation point are imposed: what the flow does follows from the equations and the shape. Its accuracy is limited by the resolution.');
  return { plate: { length: CFD_PLATE_LENGTH, thickness, ...(trailingThickness !== undefined ? { trailingThickness } : {}) }, ratioAsked, ratioDrawn, thicknessNote, air, windMs, real: { reynolds: sim.reynolds, mach: sim.mach }, preset, cells, reynolds, reynoldsCap: cap, capped, latticeMach, lines, cautions };
}
