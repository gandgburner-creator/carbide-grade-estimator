import { describe, expect, it } from 'vitest';
import { airReference } from '../src/benchmarks/AirReference';
import { checkFluid, fluidOfInput, fluidState, isaPressure, isaTemperature, oilKinematic, reynoldsNumber, seawaterDensity, waterDensity, waterSoundSpeed, waterVaporPressure, waterViscosity } from '../src/benchmarks/Fluids';

const near = (x: number, ref: number, rel: number) => expect(Math.abs(x - ref) / Math.abs(ref)).toBeLessThan(rel);

describe('International Standard Atmosphere', () => {
  it('reproduces the tabulated pressures and temperatures', () => {
    near(isaPressure(0), 101325, 1e-9);
    near(isaPressure(1000), 89874.6, 2e-4);
    near(isaPressure(5000), 54019.9, 2e-4);
    near(isaPressure(11000), 22632.1, 2e-4);
    near(isaPressure(15000), 12044.6, 3e-4);
    near(isaPressure(20000), 5474.9, 3e-4);
    near(isaPressure(30000), 1171.8, 1e-3);
    expect(isaTemperature(0)).toBeCloseTo(288.15, 6);
    expect(isaTemperature(11000)).toBeCloseTo(216.65, 6);
    expect(isaTemperature(15000)).toBeCloseTo(216.65, 6);
    expect(isaTemperature(30000)).toBeCloseTo(226.65, 6);
  });
  it('is continuous across the layers and decreasing', () => {
    let last = Infinity;
    for (let h = -500; h <= 32000; h += 250) {
      const p = isaPressure(h);
      expect(p).toBeLessThan(last);
      last = p;
    }
    near(isaPressure(11000 - 1e-6), isaPressure(11000 + 1e-6), 1e-8);
    near(isaPressure(20000 - 1e-6), isaPressure(20000 + 1e-6), 1e-8);
  });
  it('agrees with the troposphere formula of the particle workspace', () => {
    for (const h of [0, 500, 3000, 8000, 11000]) near(isaPressure(h), airReference(15, h).pressure, 3e-5);
  });
});

describe('gases', () => {
  it('air at 15 °C and sea level: ρ 1.225 kg/m³, μ 1.789e-5 Pa s, c 340.3 m/s', () => {
    const a = fluidState({ id: 'air' }, 15, 0);
    near(a.density, 1.225, 1e-3);
    near(a.viscosity, 1.789e-5, 2e-3);
    near(a.soundSpeed, 340.29, 1e-3);
    near(a.kinematic, 1.46e-5, 5e-3);
  });
  it('air at 20 °C and 1 atm: ρ 1.204, μ 1.81–1.82e-5 (Sutherland is within 1 % of the tables)', () => {
    const a = fluidState({ id: 'air', pressure: { kind: 'absolute', pa: 101325 } }, 20);
    near(a.density, 1.204, 1e-3);
    near(a.viscosity, 1.82e-5, 0.01);
  });
  it('air matches the particle workspace reference at the same temperature and height', () => {
    const ref = airReference(0, 3000);
    const a = fluidState({ id: 'air' }, 0, 3000);
    near(a.density, ref.density, 3e-5);
    near(a.viscosity, ref.viscosity, 1e-9);
    near(a.soundSpeed, ref.soundSpeed, 1e-4);
  });
  it('other gases at 20 °C and 1 atm match handbook values', () => {
    const at = (id: 'nitrogen' | 'oxygen' | 'carbon-dioxide' | 'helium' | 'hydrogen') => fluidState({ id }, 20);
    near(at('nitrogen').density, 1.165, 3e-3);
    near(at('nitrogen').viscosity, 1.76e-5, 0.02);
    near(at('oxygen').density, 1.331, 3e-3);
    near(at('oxygen').soundSpeed, 326, 0.01);
    // carbon dioxide is a real gas with Z = 0.995 at 20 °C and 1 atm: the ideal-gas density is 0.6 % lower than the table
    near(at('carbon-dioxide').density, 1.842, 0.01);
    near(at('carbon-dioxide').soundSpeed, 267, 0.01);
    near(at('helium').density, 0.1664, 3e-3);
    near(at('helium').soundSpeed, 1007, 0.01);
    near(at('helium').viscosity, 1.96e-5, 0.02);
    near(at('hydrogen').density, 0.0838, 3e-3);
    near(at('hydrogen').soundSpeed, 1306, 0.01);
    near(at('hydrogen').viscosity, 8.8e-6, 0.03);
  });
  it('density is proportional to pressure and inversely to temperature; viscosity does not depend on pressure', () => {
    const a = fluidState({ id: 'nitrogen', pressure: { kind: 'absolute', pa: 101325 } }, 20);
    const b = fluidState({ id: 'nitrogen', pressure: { kind: 'absolute', pa: 202650 } }, 20);
    near(b.density / a.density, 2, 1e-12);
    near(b.viscosity, a.viscosity, 1e-12);
    const c = fluidState({ id: 'nitrogen', pressure: { kind: 'absolute', pa: 101325 } }, 100);
    near(c.density / a.density, 293.15 / 373.15, 1e-12);
    expect(c.viscosity).toBeGreaterThan(a.viscosity);
  });
  it('a typed pressure overrides the height of air', () => {
    const a = fluidState({ id: 'air', pressure: { kind: 'absolute', pa: 50000 } }, 15, 8000);
    near(a.pressure, 50000, 1e-12);
    expect(a.pressureNote).toContain('as given');
    near(fluidState({ id: 'air' }, 15, 8000).pressure, isaPressure(8000), 1e-12);
  });
  it('the mean free path grows as the pressure falls', () => {
    const lo = fluidState({ id: 'air', pressure: { kind: 'absolute', pa: 1000 } }, 15);
    const sea = fluidState({ id: 'air' }, 15, 0);
    near(sea.meanFreePath!, 6.6e-8, 0.05);
    near(lo.meanFreePath! / sea.meanFreePath!, 101325 / 1000, 1e-9);
  });
});

describe('liquids', () => {
  it('fresh water at 20 °C: ρ 998.2, μ 1.002 mPa s, c 1482 m/s, pv 2.34 kPa', () => {
    near(waterDensity(20), 998.2071, 1e-5);
    near(waterViscosity(20), 1.002e-3, 1e-9);
    near(waterSoundSpeed(20), 1482.35, 5e-5);
    near(waterVaporPressure(20), 2339, 6e-3);
  });
  it('fresh water over its liquid range follows the tables', () => {
    const table: [number, number, number, number][] = [
      // temperature, density, viscosity [Pa s], vapour pressure [Pa]
      [0, 999.84, 1.792e-3, 611.2],
      [10, 999.70, 1.306e-3, 1228],
      [40, 992.22, 0.653e-3, 7384],
      [60, 983.2, 0.466e-3, 19947],
      [100, 958.4, 0.2818e-3, 101325],
    ];
    for (const [t, rho, mu, pv] of table) {
      near(waterDensity(t), rho, 2e-4);
      near(waterViscosity(t), mu, 5e-3);
      near(waterVaporPressure(t), pv, 0.05);
    }
  });
  it('sea water of 35 g/kg: ρ 1025.97 at 15 °C, 1028.1 at 0 °C, μ 1.08 mPa s at 20 °C, c 1507 m/s at 15 °C', () => {
    near(seawaterDensity(15), 1025.97, 2e-5);
    near(seawaterDensity(0), 1028.1, 1e-4);
    near(seawaterDensity(25), 1023.34, 1e-4);
    const s = fluidState({ id: 'seawater' }, 20);
    near(s.viscosity, 1.08e-3, 0.01);
    near(fluidState({ id: 'seawater' }, 15).soundSpeed, 1507, 1e-3);
    expect(s.vaporPressure!).toBeLessThan(waterVaporPressure(20));
  });
  it('mineral oil follows its two catalogue anchors', () => {
    near(oilKinematic(40), 32e-6, 1e-9);
    near(oilKinematic(100), 5.4e-6, 1e-9);
    const o = fluidState({ id: 'oil-vg32' }, 40);
    near(o.density, 865 * (1 - 6.4e-4 * 25), 1e-12);
    near(o.viscosity, 32e-6 * o.density, 1e-9);
    // colder oil is much thicker, hotter oil thinner
    expect(oilKinematic(0)).toBeGreaterThan(5 * oilKinematic(40));
    expect(oilKinematic(120)).toBeLessThan(oilKinematic(100));
    // typical VG 32 value at 20 °C
    near(oilKinematic(20), 86e-6, 0.06);
  });
  it('a liquid is slightly compressed by pressure: the density rises by Δp / (ρ c²)', () => {
    const a = fluidState({ id: 'water', pressure: { kind: 'absolute', pa: 101325 } }, 20);
    const b = fluidState({ id: 'water', pressure: { kind: 'absolute', pa: 101325 + 1e7 } }, 20);
    const K = a.density * a.soundSpeed ** 2;
    near(b.density / a.density - 1, 1e7 / K, 1e-9);
    expect(b.density / a.density - 1).toBeGreaterThan(0.004);
    expect(b.density / a.density - 1).toBeLessThan(0.006);
  });
  it('the pressure at a depth is p0 + ρ g d (10 m of water ≈ 1 atm more)', () => {
    const w = fluidState({ id: 'water', pressure: { kind: 'depth', depthM: 10 } }, 15);
    near(w.pressure, 101325 + 999.1 * 9.80665 * 10, 3e-3);
    expect(w.pressureNote).toContain('10 m');
  });
});

describe('custom fluid and input checks', () => {
  it('uses exactly the numbers typed', () => {
    const c = fluidState({ id: 'custom', custom: { density: 1260, viscosity: 1.41, soundSpeed: 1900, vaporPressure: 0.1 } }, 20);
    expect(c.density).toBe(1260);
    expect(c.viscosity).toBe(1.41);
    near(c.kinematic, 1.41 / 1260, 1e-12);
    expect(c.soundSpeed).toBe(1900);
    expect(c.vaporPressure).toBe(0.1);
  });
  it('without a speed of sound the fluid is incompressible', () => {
    const c = fluidState({ id: 'custom', custom: { density: 900, viscosity: 0.1 } }, 20);
    expect(c.soundSpeed).toBe(Number.POSITIVE_INFINITY);
    expect(c.vaporPressure).toBeNull();
  });
  it('refuses a choice outside what the correlations cover, in words', () => {
    expect(checkFluid({ id: 'water' }, 150)!.errors[0]).toMatch(/between 0 and 100/);
    expect(checkFluid({ id: 'water', pressure: { kind: 'altitude', altitudeM: 100 } }, 20)!.errors[0]).toMatch(/air only/);
    expect(checkFluid({ id: 'air', pressure: { kind: 'absolute', pa: 1 } }, 20)!.errors[0]).toMatch(/pressure must be/);
    expect(checkFluid({ id: 'air' }, 20, 40000)!.errors[0]).toMatch(/32000/);
    expect(checkFluid({ id: 'air', pressure: { kind: 'depth', depthM: 3 } }, 20)!.errors[0]).toMatch(/liquid only/);
    expect(checkFluid({ id: 'custom', custom: { density: -1, viscosity: 1 } }, 20)!.errors[0]).toMatch(/density/);
    expect(() => fluidState({ id: 'water' }, 150)).toThrow(/between 0 and 100/);
    expect(checkFluid({ id: 'air' }, 15, 0)).toBeNull();
  });
  it('the default fluid of the plain inputs is the air of the particle workspace', () => {
    const a = fluidOfInput({ tempC: 15, altitudeM: 0 });
    expect(a.id).toBe('air');
    near(a.density, 1.225, 1e-3);
    near(reynoldsNumber(a, 10, 0.2), (1.225 * 10 * 0.2) / 1.789e-5, 3e-3);
  });
});
