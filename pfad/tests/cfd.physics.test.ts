import { describe, expect, it } from 'vitest';
import { fluidState } from '../src/benchmarks/Fluids';
import { fieldFromResult, robustRange } from '../src/cfd/CfdFields';
import type { CfdResult } from '../src/cfd/CfdRun';
import { cfdSetup } from '../src/experiments/CfdScenario';
import { fieldPhysics, isentropicPressureRatio, physicsSheet, resultPhysics, sheetOfInput } from '../src/experiments/CfdPhysics';
import { chooseFluid, DEFAULT_FLUID_TEXTS, fluidTextsOf, parseCfdInputs, pressureModes, readFluid } from '../src/experiments/FluidScenario';
import { DEFAULT_SCENARIO, scenarioToModel, wingForces } from '../src/experiments/PhysicalScenario';

const near = (x: number, ref: number, rel: number) => expect(Math.abs(x - ref) / Math.abs(ref)).toBeLessThan(rel);
const base = { lengthCm: 20, thicknessCm: 2, speedKmh: 36, alphaDeg: 10 };
const row = (s: ReturnType<typeof physicsSheet>, id: string) => s.rows.find((r) => r.id === id)!;

describe('the physics sheet of a set-up', () => {
  it('air at 10 m/s over a 20 cm plate: Re 1.4e5, Mach 0.029, q 61 Pa, p0 − p∞ = q (1 + Ma²/4)', () => {
    const a = fluidState({ id: 'air' }, 15, 0);
    const s = physicsSheet(a, base);
    near(s.reynoldsChord, (1.225 * 10 * 0.2) / 1.789e-5, 3e-3);
    near(s.reynoldsThickness, s.reynoldsChord / 10, 1e-12);
    near(s.mach, 10 / 340.29, 1e-3);
    near(s.dynamicPressure, 0.5 * a.density * 100, 1e-12);
    near(s.stagnationRise, s.dynamicPressure * (1 + (s.mach * s.mach) / 4), 2e-5);
    expect(s.compressibility).toBe('incompressible');
    expect(s.warnings.length).toBe(1); // only the standing statement of what is not solved
    near(s.stagnationHeating!, 100 / (2 * 1004.7), 5e-3);
    expect(s.cavitation).toBeNull();
    expect(s.froude).toBeNull();
  });
  it('the isentropic stagnation relation tends to q = ½ρU² at low Mach number and exceeds it at high Mach number', () => {
    const g = 1.4;
    const p = 101325;
    for (const m of [0.01, 0.05, 0.1]) near(p * (isentropicPressureRatio(m, g) - 1), 0.5 * g * p * m * m, m * m);
    near(isentropicPressureRatio(1, g), 1.8929, 1e-3);
    near(isentropicPressureRatio(0.5, g), 1.1862, 1e-3);
  });
  it('a fast wind in air is flagged compressible, and the sheet says no correction is applied', () => {
    const s = physicsSheet(fluidState({ id: 'air' }, 15, 0), { ...base, speedKmh: 540 });
    near(s.mach, 150 / 340.29, 1e-3);
    expect(s.compressibility).toBe('compressible-subsonic');
    expect(s.warnings.join(' ')).toMatch(/no compressibility correction is applied/);
    expect(row(s, 'mach').level).toBe('note');
    const t = physicsSheet(fluidState({ id: 'air' }, 15, 0), { ...base, speedKmh: 1200 });
    expect(t.compressibility).toBe('transonic');
    expect(row(t, 'mach').level).toBe('warn');
    expect(physicsSheet(fluidState({ id: 'air' }, 15, 0), { ...base, speedKmh: 2000 }).compressibility).toBe('supersonic');
  });
  it('the same wind in helium is a much lower Mach number than in carbon dioxide', () => {
    const he = physicsSheet(fluidState({ id: 'helium' }, 20), base);
    const co2 = physicsSheet(fluidState({ id: 'carbon-dioxide' }, 20), base);
    expect(he.mach).toBeLessThan(co2.mach / 3);
  });
  it('water: Re ≈ 1e6, cavitation number from the depth pressure and the vapour pressure', () => {
    const w = fluidState({ id: 'water', pressure: { kind: 'depth', depthM: 10 } }, 20);
    const s = physicsSheet(w, { ...base, speedKmh: 18 }, 10);
    near(s.reynoldsChord, (998.2 * 5 * 0.2) / 1.002e-3, 1e-2);
    near(s.dynamicPressure, 0.5 * w.density * 25, 1e-9);
    expect(s.cavitation).not.toBeNull();
    near(s.cavitation!.sigma, (w.pressure - w.vaporPressure!) / s.dynamicPressure, 1e-12);
    expect(s.cavitation!.sigma).toBeGreaterThan(10);
    expect(s.compressibility).toBe('incompressible');
    expect(s.stagnationHeating).toBeNull();
    near(s.stagnationRise, s.dynamicPressure, 1e-12);
  });
  it('a plate near the surface of a liquid gets a Froude number and a free-surface warning; a deep one does not', () => {
    const w = (d: number) => physicsSheet(fluidState({ id: 'water', pressure: { kind: 'depth', depthM: d } }, 20), { ...base, speedKmh: 18 }, d);
    near(w(0.3).froude!, 5 / Math.sqrt(9.80665 * 0.2), 1e-9);
    expect(w(0.3).warnings.join(' ')).toMatch(/Depth 0.3 m is less than three plate lengths/);
    expect(w(5).warnings.join(' ')).not.toMatch(/Depth/);
    expect(row(w(0.3), 'fr').level).toBe('warn');
    expect(row(w(5), 'fr').level).toBe('ok');
  });
  it('water that is too hot for its pressure is reported as boiling', () => {
    const w = fluidState({ id: 'water', pressure: { kind: 'absolute', pa: 20000 } }, 80);
    const s = physicsSheet(w, base);
    expect(s.cavitation!.sigma).toBeLessThan(0);
    expect(s.warnings.join(' ')).toMatch(/would boil/);
  });
  it('a thin gas gets a Knudsen number and is told when the continuum equations stop being right', () => {
    const dense = physicsSheet(fluidState({ id: 'air' }, 15, 0), base);
    const thin = physicsSheet(fluidState({ id: 'air', pressure: { kind: 'absolute', pa: 10 } }, 15), base);
    expect(dense.knudsen!).toBeLessThan(1e-6);
    expect(row(dense, 'kn').level).toBe('ok');
    near(thin.knudsen!, (6.6e-8 * 101325) / 10 / 0.2, 0.06);
    expect(thin.warnings.join(' ')).toMatch(/Knudsen number/);
    const tiny = physicsSheet(fluidState({ id: 'air', pressure: { kind: 'absolute', pa: 10 } }, 15), { ...base, lengthCm: 0.4, thicknessCm: 0.04 });
    expect(row(tiny, 'kn').meaning).toMatch(/particle model/);
  });
  it('a custom fluid without a speed of sound has no Mach number', () => {
    const c = physicsSheet(fluidState({ id: 'custom', custom: { density: 1260, viscosity: 1.4 } }, 20), base);
    expect(c.mach).toBe(0);
    expect(row(c, 'mach').value).toBe('—');
    expect(c.cavitation).toBeNull();
  });
  it('sheetOfInput reads the fluid of the plain inputs and falls back to air', () => {
    near(sheetOfInput({ ...DEFAULT_SCENARIO }).fluid.density, 1.225, 1e-3);
    expect(sheetOfInput({ ...DEFAULT_SCENARIO, tempC: 20, fluid: { id: 'water' } }).fluid.id).toBe('water');
  });
});

describe('the plain inputs carry the fluid', () => {
  it('forces are scaled with the density of the chosen fluid: water carries about 800 times the force of air', () => {
    const unit = { drag: { mean: 1, se: 0, n: 1 }, lift: { mean: 1, se: 0, n: 1 }, dragCoeff: { mean: 1, se: 0, n: 1 }, liftCoeff: { mean: 1, se: 0, n: 1 }, reference: 1 };
    const air = wingForces(unit as never, { ...DEFAULT_SCENARIO, tempC: 20 }, 100);
    const water = wingForces(unit as never, { ...DEFAULT_SCENARIO, tempC: 20, fluid: { id: 'water' } }, 100);
    near(water.drag.mean / air.drag.mean, 998.2 / 1.204, 3e-3);
    expect(water.fluid.id).toBe('water');
  });
  it('the particle workspace ignores the fluid: its model of the wind depends on air only', () => {
    const a = scenarioToModel({ ...DEFAULT_SCENARIO });
    const b = scenarioToModel({ ...DEFAULT_SCENARIO, fluid: { id: 'water' } });
    expect(b).toEqual(a);
  });
  it('the CFD set-up of a water plate runs at the Reynolds number of water', () => {
    const air = cfdSetup({ ...DEFAULT_SCENARIO, tempC: 20 }, 'quick');
    const water = cfdSetup({ ...DEFAULT_SCENARIO, tempC: 20, fluid: { id: 'water' } }, 'quick');
    near(water.real.reynolds / air.real.reynolds, (998.2 / 1.002e-3) / (1.204 / 1.81e-5), 1e-2);
    expect(water.fluid.id).toBe('water');
    expect(water.lines.join(' ')).toMatch(/Fresh water at 20 °C/);
    // water at this speed has a Reynolds number far above what 48 cells run; air at 10 m/s does too, so both are capped
    expect(water.capped).toBe(true);
    expect(water.reynolds).toBe(water.reynoldsCap);
  });
  it('a gentle flow of a thick oil is below the cap and runs at its own Reynolds number', () => {
    const s = cfdSetup({ ...DEFAULT_SCENARIO, lengthCm: 2, thicknessCm: 0.2, tempC: 40, speedKmh: 1.8, fluid: { id: 'oil-vg32' } }, 'quick');
    expect(s.capped).toBe(false);
    near(s.reynolds, (0.5 * 0.02) / 32e-6, 1e-6);
    expect(s.reynolds).toBeLessThan(s.reynoldsCap);
  });
  it('the lattice-Mach caution appears only above Mach 0.3', () => {
    const slow = cfdSetup({ ...DEFAULT_SCENARIO, speedKmh: 36 }, 'quick');
    const fast = cfdSetup({ ...DEFAULT_SCENARIO, speedKmh: 600 }, 'quick');
    expect(slow.cautions.join(' ')).not.toMatch(/no compressibility correction/);
    expect(fast.cautions.join(' ')).toMatch(/no compressibility correction/);
  });
});

describe('the fluid controls', () => {
  const sText = { lengthCm: '20', thicknessCm: '2', trailingThicknessCm: '', tempC: '15', altitudeM: '0', speedKmh: '36', alphaDeg: '10' };
  it('default controls give plain air with no fluid recorded (so old projects stay valid)', () => {
    const r = parseCfdInputs(sText, DEFAULT_FLUID_TEXTS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.fluid).toBeUndefined();
      expect(r.fluid.id).toBe('air');
    }
  });
  it('air at a height and air at a typed pressure', () => {
    const hi = parseCfdInputs({ ...sText, altitudeM: '5000', tempC: '-17.5' }, DEFAULT_FLUID_TEXTS);
    expect(hi.ok && hi.fluid.pressure).toBeCloseTo(54019, -2);
    const typed = parseCfdInputs(sText, { ...DEFAULT_FLUID_TEXTS, mode: 'absolute', pressureKPa: '50' });
    expect(typed.ok && typed.fluid.pressure).toBe(50000);
    expect(typed.ok && typed.input.fluid).toEqual({ id: 'air', pressure: { kind: 'absolute', pa: 50000 } });
  });
  it('water: the temperature is checked against its range and the height is not needed', () => {
    const water = chooseFluid(DEFAULT_FLUID_TEXTS, 'water');
    expect(water.mode).toBe('absolute');
    expect(pressureModes('water')).toEqual(['absolute', 'depth']);
    expect(pressureModes('air')).toEqual(['altitude', 'absolute']);
    expect(pressureModes('helium')).toEqual(['absolute']);
    const bad = parseCfdInputs({ ...sText, tempC: '120', altitudeM: 'abc' }, water);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.join(' ')).toMatch(/fluid temperature must be between 0 and 100/);
    expect(!bad.ok && bad.errors.join(' ')).not.toMatch(/height/);
    const ok = parseCfdInputs({ ...sText, tempC: '20', altitudeM: 'abc' }, { ...water, mode: 'depth', depthM: '3' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.fluid.id).toBe('water');
      expect(ok.input.fluid).toEqual({ id: 'water', pressure: { kind: 'depth', depthM: 3 } });
    }
  });
  it('a custom fluid is read from its boxes, in mPa·s and kPa', () => {
    const r = readFluid({ ...DEFAULT_FLUID_TEXTS, id: 'custom', mode: 'absolute', density: '1260', viscosityMPas: '1410', soundSpeed: '1900', vaporKPa: '' });
    expect(r.ok && r.spec).toEqual({ id: 'custom', pressure: { kind: 'absolute', pa: 101325 }, custom: { density: 1260, viscosity: 1.41, soundSpeed: 1900 } });
    expect(readFluid({ ...DEFAULT_FLUID_TEXTS, id: 'custom', density: 'x' }).ok).toBe(false);
  });
  it('a stored fluid fills the boxes again', () => {
    const spec = { id: 'seawater', pressure: { kind: 'depth', depthM: 30 } } as const;
    const t = fluidTextsOf(spec);
    expect(t.id).toBe('seawater');
    expect(t.mode).toBe('depth');
    expect(t.depthM).toBe('30');
    const r = readFluid(t);
    expect(r.ok && r.spec).toEqual(spec);
    expect(fluidTextsOf(undefined)).toEqual(DEFAULT_FLUID_TEXTS);
  });
});

// ---- the check of a finished run against Bernoulli's equation, on a synthetic result with known fields

function synthetic(patch?: (i: number, j: number, g: { ux: number[]; uy: number[]; rho: number[]; solid: number[] }) => void): CfdResult {
  const nx = 30;
  const ny = 20;
  const U = 0.06;
  const g = { nx, ny, stride: 2, ux: new Array(nx * ny).fill(U), uy: new Array(nx * ny).fill(0), rho: new Array(nx * ny).fill(1), solid: new Array(nx * ny).fill(0) };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) patch?.(i, j, g);
  return {
    params: { uLattice: U, cells: 20, widthL: 3, spongeL: 0.5 },
    lattice: { nx: nx * 2, ny: ny * 2, cellsPerUnit: 1 },
    rhoInf: 1,
    grid: g,
    stations: { upper: [{ x: 3, cp: { mean: -1.2, se: 0, n: 1 } }, { x: 1, cp: { mean: 0.9, se: 0, n: 1 } }], lower: [{ x: 2, cp: { mean: -0.4, se: 0, n: 1 } }] },
  } as unknown as CfdResult;
}

describe('the Bernoulli check of a finished run', () => {
  it('a uniform stream is Bernoulli flow everywhere: C_p0 = 0', () => {
    const f = fieldPhysics(synthetic());
    expect(f.bernoulliShare).toBe(1);
    expect(f.totalPressureMin).toBeCloseTo(0, 12);
    expect(f.totalPressureMax).toBeCloseTo(0, 12);
    expect(f.maxSpeed).toBeCloseTo(1, 12);
    expect(f.wallCpMin).toEqual({ value: -1.2, side: 'upper', x: 3 });
    expect(f.wallCpMax).toEqual({ value: 0.9, side: 'upper', x: 1 });
  });
  it('a speed-up with the matching pressure drop still obeys Bernoulli; a slow wake with no pressure change does not', () => {
    const U = 0.06;
    // a speed-up to 1.3 U with the pressure the equation gives: C_p = 1 − 1.69 → ρ = 1 + 3 · ½ U² · C_p
    const ok = fieldPhysics(
      synthetic((i, j, g) => {
        if (i >= 10 && i < 14 && j >= 8 && j < 12) {
          const k = j * 30 + i;
          g.ux[k] = 1.3 * U;
          g.rho[k] = 1 + 3 * 0.5 * U * U * (1 - 1.69);
        }
      }),
    );
    expect(ok.bernoulliShare).toBe(1);
    expect(ok.cpMin).toBeCloseTo(-0.69, 6);
    expect(ok.cpMin).toBeLessThan(0);
    const wake = fieldPhysics(
      synthetic((i, j, g) => {
        if (i >= 10 && i < 14 && j >= 8 && j < 12) g.ux[j * 30 + i] = 0.5 * U;
      }),
    );
    // 25 of the 30 columns lie in front of the absorbing layer: 500 fluid cells, 16 of them in the wake
    expect(wake.bernoulliShare).toBeCloseTo(1 - 16 / 500, 6);
    expect(wake.totalPressureMin).toBeCloseTo(0.25 - 1, 6);
  });
  it('cells inside the body and in the absorbing layer in front of the outflow are not counted', () => {
    const f = fieldPhysics(
      synthetic((i, j, g) => {
        const k = j * 30 + i;
        if (i < 3 && j < 3) g.solid[k] = 1;
        if (i >= 25) g.ux[k] = 0; // beyond (3 − 0.5) · 20 = 50 plate units → grid x ≥ 25 · 2 = 50
      }),
    );
    expect(f.bernoulliShare).toBe(1);
    expect(f.cells).toBe(25 * 20 - 9);
  });
  it('the total-pressure view of a field is the same quantity', () => {
    const res = synthetic((i, j, g) => {
      if (i === 5 && j === 5) g.ux[j * 30 + i] = 0;
    });
    const v = fieldFromResult(res, 'total');
    expect(v.values[5 * 30 + 5]).toBeCloseTo(-1, 6);
    expect(v.values[0]).toBeCloseTo(0, 12);
    expect(robustRange(v.values, 'total').signed).toBe(true);
  });
  it('absolute pressures, the cavitation margin and the local Mach number follow from the coefficients', () => {
    const res = synthetic();
    // the wall stations give C_p,min = −1.2
    const water = physicsSheet(fluidState({ id: 'water', pressure: { kind: 'depth', depthM: 2 } }, 20), { ...base, speedKmh: 36 }, 2);
    const rw = resultPhysics(water, res);
    near(rw.minPressure, water.fluid.pressure - 1.2 * water.dynamicPressure, 1e-12);
    near(rw.cavitationMargin!, rw.minPressure - water.cavitation!.vaporPressure, 1e-12);
    expect(rw.rows.find((r) => r.id === 'cavitation')!.level).not.toBe('warn');
    // a fast, cold, low-pressure water flow does cavitate
    const fast = physicsSheet(fluidState({ id: 'water', pressure: { kind: 'absolute', pa: 30000 } }, 60), { ...base, speedKmh: 90 }, null);
    const rf = resultPhysics(fast, res);
    expect(rf.cavitationMargin!).toBeLessThan(0);
    expect(rf.warnings.join(' ')).toMatch(/Cavitation/);
    // air: local Mach from the isentropic relation at the lowest pressure
    const air = physicsSheet(fluidState({ id: 'air' }, 15, 0), { ...base, speedKmh: 360 });
    const ra = resultPhysics(air, res);
    expect(ra.localMach!).toBeGreaterThan(air.mach);
    const g = 1.4;
    near(isentropicPressureRatio(ra.localMach!, g), air.stagnationPressure / ra.minPressure, 1e-9);
    // a suction that would need a negative absolute pressure (a supersonic wind) is reported
    const thin = physicsSheet(fluidState({ id: 'air' }, 15, 0), { ...base, speedKmh: 2000 });
    expect(resultPhysics(thin, res).warnings.join(' ')).toMatch(/not positive/);
  });
});
