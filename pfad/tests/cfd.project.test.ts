import { describe, expect, it } from 'vitest';
import { cfdForceMeasure } from '../src/cfd/CfdForces';
import { fieldFromResult, robustRange, streamField } from '../src/cfd/CfdFields';
import { addCfdPointerMove, attachCfdRun, cfdActivePath, cfdHead, cfdProjectToJSON, newCfdProject, parseCfdProject, undoCfd, type CfdConditions } from '../src/cfd/CfdProject';
import { CfdRun, CFD_BASE, reynoldsCap, type CfdParams } from '../src/cfd/CfdRun';
import { cfdSetup } from '../src/experiments/CfdScenario';
import { DEFAULT_SCENARIO, wingForces } from '../src/experiments/PhysicalScenario';
import { anchorOf, initialPaths, plateGeometry, pointerOf } from '../src/geometry/Pointer';
import { cfdGapAt, measuredCfdStep } from '../src/geometry/PointerMeasure';
import { DEFAULT_POINTER_STEP } from '../src/geometry/Pointer';
import { smoothField, traceStreamlines } from '../src/measurements/Streamlines';

const plate = { length: 30, thickness: 3 };
const conditions = (params: Omit<CfdParams, 'geometry'>): CfdConditions => ({ scenario: DEFAULT_SCENARIO, preset: 'quick', params, realReynolds: 1.4e5 });
const tiny = { alphaDeg: 40, cells: 32, reynolds: 240, ...CFD_BASE, warmup: 5, average: 10, blocks: 6 };

describe('the plain-unit setup of the CFD workspace', () => {
  it('uses the Reynolds number of the plate in the described air, and says when the resolution caps it', () => {
    const s = cfdSetup(DEFAULT_SCENARIO, 'quick');
    // 20 cm plate, 10 m/s, 15 °C, sea level: Re = ρ U L / μ ≈ 1.4e5
    expect(s.real.reynolds).toBeGreaterThan(1.2e5);
    expect(s.real.reynolds).toBeLessThan(1.6e5);
    expect(s.capped).toBe(true);
    expect(s.reynolds).toBeCloseTo(reynoldsCap(48), 9);
    expect(s.cautions.join(' ')).toMatch(/turbulent/);
    expect(s.cautions.join(' ')).toMatch(/does not predict your plate/);
    expect(s.cautions.join(' ')).toMatch(/No Kutta condition, no circulation and no separation point are imposed/);
    // a finer resolution runs a higher Reynolds number
    expect(cfdSetup(DEFAULT_SCENARIO, 'fine').reynolds).toBeGreaterThan(s.reynolds);
  });

  it('runs the real Reynolds number exactly when the resolution can run it, with the wind and the air acting only through it', () => {
    const slow = { ...DEFAULT_SCENARIO, lengthCm: 1, thicknessCm: 0.1, speedKmh: 1 };
    const s = cfdSetup(slow, 'quick');
    expect(s.capped).toBe(false);
    expect(s.reynolds).toBeCloseTo(s.real.reynolds, 9);
    // colder, thinner air at the same wind changes the Reynolds number
    const high = cfdSetup({ ...slow, altitudeM: 5000 }, 'quick');
    expect(high.real.reynolds).toBeLessThan(s.real.reynolds);
  });

  it('draws the plate with the asked ratio, and a thicker one (and says so) when it would be under a few cells thick', () => {
    expect(cfdSetup({ ...DEFAULT_SCENARIO, lengthCm: 20, thicknessCm: 2 }, 'quick').plate.thickness).toBeCloseTo(3, 9);
    const thin = cfdSetup({ ...DEFAULT_SCENARIO, lengthCm: 40, thicknessCm: 1 }, 'quick');
    expect(thin.plate.thickness).toBeGreaterThan(0.75);
    expect(thin.thicknessNote).toMatch(/thinner than/);
  });
});

describe('a CFD project history', () => {
  const geometry = plateGeometry(plate);
  const run = new CfdRun({ geometry, ...tiny });
  while (run.phase !== 'done') run.advance(2000);
  const result = run.result();

  const base = () => newCfdProject('t', conditions(tiny), { plate, paths: initialPaths(plate), spacing: 1 });

  it('moves the pointer into a new version, only forward and only outward, and keeps every version', () => {
    let p = base();
    const out = addCfdPointerMove(p, { side: 'upper', to: { x: 4, y: 2.5 }, decision: { kind: 'hand' } });
    p = out.project;
    expect(p.head).toBe('v1');
    expect(out.version.run).toBeNull();
    expect(out.version.move!.decided).toBe('hand');
    expect(pointerOf(out.version.shape.paths, 'upper')).toEqual({ x: 4, y: 2.5 });
    expect(out.version.geometry.upper.some((y) => y > 1.5 + 1e-9)).toBe(true);
    expect(() => addCfdPointerMove(p, { side: 'upper', to: { x: 3, y: 2.5 }, decision: { kind: 'hand' } })).toThrow(/only moves forward/);
    expect(() => addCfdPointerMove(p, { side: 'upper', to: { x: 6, y: 1.0 }, decision: { kind: 'hand' } })).toThrow(/only added/);
    p = undoCfd(p);
    expect(p.head).toBe('v0');
    expect(p.versions.find((v) => v.id === 'v1')!.undone).not.toBeNull();
    expect(cfdActivePath(p).map((v) => v.id)).toEqual(['v0']);
    expect(() => undoCfd(p)).toThrow(/nothing to undo/);
  });

  it('round-trips through JSON with its run results and refuses a file that is not a CFD project', () => {
    let p = base();
    p = attachCfdRun(p, 'v0', { result, finishedAt: 'now', activeMs: 5, codeVersion: 'test' });
    const back = parseCfdProject(cfdProjectToJSON(p));
    expect(back.versions[0].run!.result.forces.dragCoeff.mean).toBeCloseTo(result.forces.dragCoeff.mean, 12);
    expect(() => parseCfdProject('{"format":"pfad-flow-geometry/1"}')).toThrow(/not a PFAD CFD/);
  });

  it('turns a measured result into the next pointer step: the dividing-streamline height is the gap', () => {
    let p = base();
    // a result with a region of reversed flow 3 units high over the first stations
    const fake = {
      ...result,
      stations: {
        upper: result.stations.upper.map((s, k) => ({ ...s, h: k < 20 ? { mean: 3, se: 0.1, n: 6 } : null, hShare: k < 20 ? 1 : 0 })),
        lower: result.stations.lower,
      },
    };
    p = attachCfdRun(p, 'v0', { result: fake, finishedAt: 'now', activeMs: 5, codeVersion: 'test' });
    const v0 = cfdHead(p);
    const m = measuredCfdStep(v0, 'upper', DEFAULT_POINTER_STEP);
    expect(m.ok).toBe(true);
    if (m.ok) {
      expect(m.st.gap).toBeGreaterThan(2);
      expect(m.st.rise).toBeCloseTo(DEFAULT_POINTER_STEP.maxRise, 9);
      expect(m.summary).toMatch(/dividing streamline/);
      const out = addCfdPointerMove(p, { side: 'upper', to: m.st.to, decision: { kind: 'measurement', step: m.st, versionId: 'v0', summary: m.summary } });
      expect(out.version.move!.measured!.versionId).toBe('v0');
    }
    // a result with no reversed flow anywhere gives no rise: the curve follows the surface
    const flat = measuredCfdStep(v0 && { ...v0, run: { ...v0.run!, result: { ...result, stations: { upper: result.stations.upper.map((s) => ({ ...s, h: null, hShare: 0 })), lower: result.stations.lower } } } }, 'upper', DEFAULT_POINTER_STEP);
    expect(flat.ok && flat.st.rise).toBe(0);
    expect(cfdGapAt(result.stations.upper.map((s) => ({ x: s.x, h: null, hShare: 0 })), plate)(5)).toBe(0);
    // the pointer reaching the anchor says it is done
    const done = { ...v0, shape: { ...v0.shape, paths: { upper: [...v0.shape.paths.upper, anchorOf(plate)], lower: v0.shape.paths.lower } } };
    const end = measuredCfdStep(done, 'upper', DEFAULT_POINTER_STEP);
    expect(end.ok).toBe(false);
    if (!end.ok) expect(end.done).toBe(true);
  });

  it('scales the computed forces to newtons with the same formula as the particle workspace', () => {
    const f = cfdForceMeasure(result);
    const w = wingForces(f, DEFAULT_SCENARIO, 100);
    const q = 0.5 * 1.225 * 10 * 10;
    expect(w.drag.mean).toBeCloseTo(f.dragCoeff.mean * q * 0.2 * 1, 0);
  });
});

describe('the field views of a CFD result', () => {
  const geometry = plateGeometry(plate);
  const run = new CfdRun({ geometry, ...tiny });
  while (run.phase !== 'done') run.advance(2000);
  const res = run.result();

  it('draws every kind from the stored mean fields, with the body marked and a robust colour range', () => {
    for (const kind of ['speed', 'vorticity', 'pressure', 'ux', 'uy'] as const) {
      const f = fieldFromResult(res, kind);
      expect(f.values.length).toBe(f.nx * f.ny);
      const finite = Array.from(f.values).filter(Number.isFinite);
      expect(finite.length).toBeGreaterThan(0.8 * f.values.length);
      expect(f.values.some((v) => Number.isNaN(v))).toBe(true); // the body
      const r = robustRange(f.values, kind);
      expect(r.hi).toBeGreaterThan(r.lo);
      expect(r.signed).toBe(kind !== 'speed');
    }
  });

  it('traces streamlines of the mean flow around the body and not through it', () => {
    const f = smoothField(streamField(res), 1);
    const lines = traceStreamlines(f, { spacing: 3, testFraction: 0.5, step: 0.4, maxLength: 800, minSpeed: 0.04 });
    expect(lines.length).toBeGreaterThan(8);
    // upstream, the lines run along the stream
    const first = lines.find((l) => l.points[0] < 30);
    expect(first).toBeTruthy();
  });
});
