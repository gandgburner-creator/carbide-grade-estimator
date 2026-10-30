import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { airReference, similarityNumbers } from '../src/benchmarks/AirReference';
import { DEFAULT_SCENARIO, describeScenario, FIELDS, MODEL, parseScenario, particleCount, scenarioToModel, sci, simulatedRegime } from '../src/experiments/PhysicalScenario';

const text = (o: object) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'fluid').map(([k, v]) => [k, String(v)])) as Record<(typeof FIELDS)[number]['key'], string>;
const results = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', 'results', name), 'utf8'));

describe('reference air (comparison only)', () => {
  it('reproduces the standard values at 15 °C and sea level', () => {
    const a = airReference(15, 0);
    expect(a.pressure).toBeCloseTo(101325, 0);
    expect(a.density).toBeCloseTo(1.225, 2);
    expect(a.soundSpeed).toBeCloseTo(340.3, 0);
    expect(a.viscosity).toBeCloseTo(1.789e-5, 7);
    expect(a.meanFreePath).toBeGreaterThan(5.5e-8);
    expect(a.meanFreePath).toBeLessThan(7.5e-8);
  });
  it('thins with height and speeds up with temperature', () => {
    expect(airReference(15, 3000).density).toBeLessThan(airReference(15, 0).density * 0.8);
    expect(airReference(15, 3000).meanFreePath).toBeGreaterThan(airReference(15, 0).meanFreePath);
    expect(airReference(30, 0).soundSpeed).toBeGreaterThan(airReference(0, 0).soundSpeed);
  });
  it('gives the textbook regime of a 20 cm plate in a 10 m/s wind', () => {
    const r = similarityNumbers(airReference(15, 0), 10, 0.2);
    expect(r.mach).toBeCloseTo(0.0294, 3);
    expect(r.reynolds).toBeGreaterThan(1.2e5);
    expect(r.reynolds).toBeLessThan(1.5e5);
    expect(r.knudsen).toBeLessThan(5e-7);
  });
});

describe('the model constants are the measured ones', () => {
  it('the sound speed and viscosity match the repository records they cite', () => {
    const c = results('sound-speed_sweeps.json').results.cases.find((x: { label: string }) => x.label === 'A φ=0.1');
    expect(MODEL.soundSpeed).toBeCloseTo(c.speed.mean, 12);
    const mu = results('viscosity_reference.json').results.cases.find((x: { label: string }) => x.label.startsWith('base: φ=0.1'));
    expect(MODEL.viscosity).toBeCloseTo(mu.muEff.mean, 12);
  });
  it('reproduces the Mach and Reynolds numbers of the recorded Kutta reference at its chord', () => {
    const k = results('kutta_reference.json');
    const r = simulatedRegime(60, 1)!;
    expect(Math.abs(r.mach - k.mach.Mp) / k.mach.Mp).toBeLessThan(0.02);
    expect(Math.abs(r.reynolds - k.reynolds.simulation) / k.reynolds.simulation).toBeLessThan(0.08);
  });
  it('gives the documented regime of the 30-diameter plate', () => {
    const r = simulatedRegime(30, 1)!;
    expect(r.knudsen).toBeCloseTo(0.185, 2);
    expect(r.reynolds).toBeGreaterThan(10);
    expect(r.reynolds).toBeLessThan(13);
    expect(r.mach).toBeCloseTo(0.553, 2);
    expect(simulatedRegime(30, 1, 0.2)).toBeNull();
  });
});

describe('plain inputs are checked', () => {
  it('accepts the defaults', () => {
    expect(parseScenario(text({ ...DEFAULT_SCENARIO })).ok).toBe(true);
  });
  it('says what is wrong in plain words', () => {
    const bad = parseScenario({ ...text({ ...DEFAULT_SCENARIO }), thicknessCm: '15', speedKmh: 'fast' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join(' ')).toMatch(/wind speed: please enter a number/);
      expect(bad.errors.length).toBe(1);
    }
    const thick = parseScenario({ ...text({ ...DEFAULT_SCENARIO }), thicknessCm: '15' });
    expect(thick.ok).toBe(false);
    if (!thick.ok) expect(thick.errors[0]).toMatch(/at least 2 times longer/);
    expect(parseScenario({ ...text({ ...DEFAULT_SCENARIO }), tempC: '-100' }).ok).toBe(false);
    expect(parseScenario({ ...text({ ...DEFAULT_SCENARIO }), altitudeM: '20000' }).ok).toBe(false);
    expect(parseScenario({ ...text({ ...DEFAULT_SCENARIO }), alphaDeg: '95' }).ok).toBe(false);
  });
});

describe('mapping to the model', () => {
  it('keeps the length : thickness ratio and the angle', () => {
    const m = scenarioToModel(DEFAULT_SCENARIO);
    expect(m.chord / m.thickness).toBeCloseTo(10, 6);
    expect(m.chord).toBe(30);
    expect(m.thickness).toBe(3);
    expect(m.alphaDeg).toBe(65);
  });
  it('draws thin plates larger and thick plates smaller, within the drawable range', () => {
    const thin = scenarioToModel({ ...DEFAULT_SCENARIO, lengthCm: 40, thicknessCm: 1 });
    expect(thin.thickness).toBe(2);
    expect(thin.chord).toBe(80);
    expect(thin.ratioDrawn).toBe(40);
    const blunt = scenarioToModel({ ...DEFAULT_SCENARIO, lengthCm: 20, thicknessCm: 10 });
    expect(blunt.thickness).toBe(12);
    expect(blunt.chord).toBe(24);
    const tooThin = scenarioToModel({ ...DEFAULT_SCENARIO, lengthCm: 100, thicknessCm: 0.5 });
    expect(tooThin.ratioAsked).toBe(200);
    expect(tooThin.ratioDrawn).toBe(40);
    for (const m of [thin, blunt, tooThin]) {
      expect(m.thickness).toBeGreaterThanOrEqual(MODEL.minThickness);
      expect(m.thickness).toBeLessThanOrEqual(MODEL.maxThickness);
      expect(m.chord).toBeGreaterThanOrEqual(MODEL.minChord);
      expect(m.chord).toBeLessThanOrEqual(MODEL.maxChord);
    }
  });
  it('runs a slow wind at the model’s slowest usable speed, and says so', () => {
    const m = scenarioToModel({ ...DEFAULT_SCENARIO, speedKmh: 36 });
    expect(m.speed).toBe(MODEL.minSpeed);
    expect(m.speedBasis).toBe('too-slow');
    const rep = describeScenario({ ...DEFAULT_SCENARIO, speedKmh: 36 });
    expect(rep.lines.join(' ')).toMatch(/cannot show a wind that slow/);
    expect(rep.lines.join(' ')).toMatch(/times faster/);
  });
  it('matches the Mach number when the wind is fast enough, using the air the person described', () => {
    const cold = scenarioToModel({ ...DEFAULT_SCENARIO, speedKmh: 900, tempC: -40, altitudeM: 0 });
    const warm = scenarioToModel({ ...DEFAULT_SCENARIO, speedKmh: 900, tempC: 40, altitudeM: 0 });
    expect(cold.speedBasis).toBe('matched');
    expect(warm.speedBasis).toBe('matched');
    expect(cold.speed).toBeGreaterThan(warm.speed);
    const machAir = 900 / 3.6 / airReference(15, 0).soundSpeed;
    const m = scenarioToModel({ ...DEFAULT_SCENARIO, speedKmh: 900 });
    expect(m.speed / MODEL.soundSpeed).toBeCloseTo(machAir, 3);
  });
  it('clamps a very fast wind', () => {
    const m = scenarioToModel({ ...DEFAULT_SCENARIO, speedKmh: 2000, tempC: -60 });
    expect(m.speed).toBe(MODEL.maxSpeed);
    expect(m.speedBasis).toBe('too-fast');
  });
  it('temperature and altitude change nothing in the run when the speed is clamped', () => {
    const a = scenarioToModel({ ...DEFAULT_SCENARIO, tempC: -30, altitudeM: 5000 });
    const b = scenarioToModel({ ...DEFAULT_SCENARIO, tempC: 40, altitudeM: 0 });
    expect(a).toEqual(b);
  });
});

describe('what the screen says', () => {
  const rep = describeScenario(DEFAULT_SCENARIO);
  it('states plainly that the regime differs and that nothing about air performance follows', () => {
    const t = [...rep.lines, ...rep.cautions].join(' ');
    expect(t).toMatch(/very different flow regime/);
    expect(t).toMatch(/does not predict how air flows around your plate/);
    expect(t).toMatch(/lift, drag or performance/);
    expect(rep.real.knudsen).toBeLessThan(1e-5);
    expect(rep.simulated.knudsen).toBeGreaterThan(0.1);
    expect(rep.real.reynolds / rep.simulated.reynolds).toBeGreaterThan(100);
  });
  it('warns about small angles and big plates', () => {
    expect(describeScenario({ ...DEFAULT_SCENARIO, alphaDeg: 20 }).cautions.join(' ')).toMatch(/large angles/);
    expect(describeScenario({ ...DEFAULT_SCENARIO, alphaDeg: 65 }).cautions.join(' ')).not.toMatch(/large angles/);
    expect(describeScenario({ ...DEFAULT_SCENARIO, lengthCm: 40, thicknessCm: 1 }).cautions.join(' ')).toMatch(/large simulation/);
    expect(particleCount(30)).toBe(2292);
  });
  it('formats numbers readably', () => {
    expect(sci(131000)).toBe('1.3×10⁵');
    expect(sci(0.00000041)).toBe('4.1×10⁻⁷');
    expect(sci(0.5523)).toBe('0.552');
    expect(sci(11.5)).toBe('11.5');
  });
});
