import { describe, expect, it } from 'vitest';
import { addCfdFillVersion, addCfdPointerMove, cfdHead, newCfdProject, type CfdConditions } from '../src/cfd/CfdProject';
import { cfdSetup } from '../src/experiments/CfdScenario';
import { DEFAULT_SCENARIO, describeScenario, newtonsAndKgf, parseScenario, scenarioToModel, STANDARD_GRAVITY, toKgf } from '../src/experiments/PhysicalScenario';
import { anchorOf, DEFAULT_POINTER_LIMITS, initialPaths, plateGeometry, pointerOf, type PlateSpec } from '../src/geometry/Pointer';
import { defaultPointerTexts, EMPTY_POINTER_TEXTS, readPointerInput, type PointerTexts } from '../src/geometry/PointerInput';
import { addPointerVersion } from '../src/geometry/PointerVersion';
import { newProject } from '../src/geometry/History';
import { scenarioText } from '../src/ui/flow/ScenarioPanel';

const plate: PlateSpec = { length: 30, thickness: 3, trailingThickness: 1.5 };
const paths = initialPaths(plate);
const cmPerUnit = 0.5;
const read = (t: Partial<PointerTexts>, p = paths) => readPointerInput(plate, p, 1, 'upper', { ...defaultPointerTexts(plate, p, 'upper', cmPerUnit, 3), ...t }, cmPerUnit, DEFAULT_POINTER_LIMITS);

describe('reading what is typed about the red dot, the pointer and the green dot', () => {
  it('the boxes start out showing the current state, with the pointer a step ahead, and that is a valid placement', () => {
    const t = defaultPointerTexts(plate, paths, 'upper', cmPerUnit, 3);
    expect(t.redX).toBe((pointerOf(paths, 'upper').x * cmPerUnit).toFixed(2));
    expect(Number(t.x)).toBeGreaterThan(Number(t.redX));
    const r = read({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBeDefined();
      expect(r.edit).toBeUndefined();
      expect(r.changes.length).toBe(1);
      expect(r.pointerAt!.x).toBeCloseTo(Number(t.x) / cmPerUnit, 9);
    }
  });

  it('a box that still shows the current value changes nothing, however the centimetres were rounded', () => {
    const r = read({ x: '', rise: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/enter where the pointer goes/);
  });

  it('moving the green dot, setting a direction and placing the pointer are read together, and checked as one', () => {
    const r = read({ anchorX: '12', anchorRise: '0.8', angle: '15', x: '6', rise: '0.4' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.edit!.anchor).toBeDefined();
    expect(r.to!.angle).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(r.anchorAt.x).toBeCloseTo(12 / cmPerUnit, 9);
    expect(r.changes.join(' ')).toMatch(/green dot/);
    expect(r.geometry.stations).toBeGreaterThan(10);
  });

  it('says why a value is refused, and leaves the rest alone', () => {
    const lowAnchor = read({ anchorX: '12', anchorRise: '0', x: '6', rise: '0.2' });
    // an anchor on the plate's own surface is allowed (it is the surface), one below it is not
    expect(lowAnchor.ok).toBe(true);
    const bad = read({ x: '-1', rise: '0.3' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/forward/);
    const steep = read({ angle: '89' });
    expect(steep.ok).toBe(false);
    if (!steep.ok) expect(steep.reason).toMatch(/80°/);
    const nan = read({ redAngle: 'x' });
    expect(nan.ok).toBe(false);
  });

  it('the first red dot cannot be moved, but its direction can be set', () => {
    const moved = read({ redX: '2', redRise: '1' });
    expect(moved.ok).toBe(false);
    const turned = read({ redAngle: '20', x: '', rise: '' });
    expect(turned.ok).toBe(true);
    if (turned.ok) {
      expect(turned.to).toBeUndefined();
      expect(turned.edit!.red!.angle).toBeCloseTo((20 * Math.PI) / 180, 12);
      expect(turned.changes[0]).toMatch(/new direction/);
    }
  });
});

describe('versions made with the red dot, the green dot and the arc directions', () => {
  const cond: CfdConditions = { scenario: DEFAULT_SCENARIO, preset: 'quick', params: { alphaDeg: 30, cells: 32, reynolds: 240, widthL: 9, heightL: 6, spongeL: 2, spongeTau: 1.2, bodyAtX: 0.3, blocks: 4, sampleEvery: 8, seed: 7, uLattice: 0.06, warmup: 4, average: 6 }, realReynolds: 1e5 };
  const shape = { plate, paths, spacing: 1 };

  it('the CFD project keeps every edit in a new version, with its words and its record', () => {
    const p0 = newCfdProject('t', cond, shape);
    const r = read({ anchorX: '12', anchorRise: '0.8', angle: '15', x: '6', rise: '0.4' });
    if (!r.ok) throw new Error(r.reason);
    const out = addCfdPointerMove(p0, { side: 'upper', to: r.to, edit: r.edit, decision: { kind: 'hand' } });
    const v = out.version;
    expect(v.shape.paths.upper.length).toBe(2);
    expect(v.shape.paths.anchor?.upper).toBeDefined();
    expect(v.move!.edit?.anchor).toBeDefined();
    expect(v.label).toMatch(/pointer on the upper side/);
    expect(cfdHead(out.project).id).toBe(v.id);
    expect(anchorOf(plate, v.shape.paths, 'upper').x).toBeCloseTo(12 / cmPerUnit, 9);
    // the parent is untouched
    expect(p0.versions[0].shape.paths.anchor).toBeUndefined();
    expect(v.geometry).toEqual(plateGeometry(plate, v.shape.paths, 1));
  });

  it('an edit with no pointer (only a direction at the red dot) is a version too; nothing at all is refused', () => {
    const p0 = newCfdProject('t', cond, shape);
    const out = addCfdPointerMove(p0, { side: 'upper', edit: { red: { ...pointerOf(paths, 'upper'), angle: 0.2 } }, decision: { kind: 'hand' } });
    expect(out.version.shape.paths.upper[0].angle).toBe(0.2);
    expect(out.version.label).toMatch(/direction/);
    expect(() => addCfdPointerMove(p0, { side: 'upper', decision: { kind: 'hand' } })).toThrow(/nothing to change/);
  });

  it('the particle project does the same', () => {
    const pr = newProject('t', {}, plateGeometry(plate, paths, 1), undefined, shape);
    const r = read({ anchorX: '12', anchorRise: '0.8', x: '6', rise: '0.4' });
    if (!r.ok) throw new Error(r.reason);
    const out = addPointerVersion(pr, { side: 'upper', to: r.to, edit: r.edit, decision: { kind: 'hand' } });
    expect(out.version.shape!.paths.anchor?.upper).toBeDefined();
    expect(out.version.construction!.pointer!.edit?.anchor).toBeDefined();
    expect(() => addPointerVersion(pr, { side: 'upper', decision: { kind: 'hand' } })).toThrow(/nothing to change/);
  });

  it('keeps the auto-fill version function working with anchors', () => {
    expect(typeof addCfdFillVersion).toBe('function');
  });
});

describe('different diameters in the plain inputs', () => {
  const text = (over: Record<string, string>) => ({ ...scenarioText(DEFAULT_SCENARIO), ...over });

  it('an empty trailing box means the same as the plate thickness, and a value is checked', () => {
    const same = parseScenario(text({}));
    expect(same.ok && same.input.trailingThicknessCm).toBeUndefined();
    const t = parseScenario(text({ trailingThicknessCm: '0.8' }));
    expect(t.ok && t.input.trailingThicknessCm).toBe(0.8);
    expect(parseScenario(text({ trailingThicknessCm: '-1' })).ok).toBe(false);
    expect(parseScenario(text({ trailingThicknessCm: 'abc' })).ok).toBe(false);
    // a trailing end as thick as the leading one is the same plate
    const eq = parseScenario(text({ trailingThicknessCm: '2' }));
    expect(eq.ok && eq.input.trailingThicknessCm).toBeUndefined();
    // the plate must be long enough for the thicker end
    const short = parseScenario(text({ trailingThicknessCm: '12' }));
    expect(short.ok).toBe(false);
  });

  it('the particle model draws the trailing end at the same scale and says when it had to change it', () => {
    const m = scenarioToModel({ ...DEFAULT_SCENARIO, trailingThicknessCm: 1 });
    expect(m.trailingThickness).toBeCloseTo(m.thickness / 2, 1);
    expect(m.trailingNote).toBeNull();
    const thin = scenarioToModel({ ...DEFAULT_SCENARIO, trailingThicknessCm: 0.05 });
    expect(thin.trailingThickness).toBe(1);
    expect(thin.trailingNote).toMatch(/draws 1/);
    expect(scenarioToModel(DEFAULT_SCENARIO).trailingThickness).toBe(scenarioToModel(DEFAULT_SCENARIO).thickness);
    expect(describeScenario({ ...DEFAULT_SCENARIO, trailingThicknessCm: 1 }).lines.join(' ')).toMatch(/Round ends: the leading end is 2 cm across, the trailing end 1 cm/);
  });

  it('the CFD plate has the two diameters, each at least a few cells across', () => {
    const s = cfdSetup({ ...DEFAULT_SCENARIO, trailingThicknessCm: 1 }, 'fine');
    expect(s.plate.trailingThickness).toBeCloseTo(s.plate.thickness / 2, 9);
    const thin = cfdSetup({ ...DEFAULT_SCENARIO, trailingThicknessCm: 0.1 }, 'quick');
    expect(thin.plate.trailingThickness!).toBeGreaterThanOrEqual((3.2 * 30) / 48 - 1e-9);
    expect(thin.thicknessNote).toMatch(/trailing end would be thinner/);
    expect(cfdSetup(DEFAULT_SCENARIO, 'quick').plate.trailingThickness).toBeUndefined();
  });
});

describe('force in kilogram-force beside the newtons', () => {
  it('1 kgf is 9.80665 N, in the value and in its standard error', () => {
    expect(STANDARD_GRAVITY).toBe(9.80665);
    const e = toKgf({ mean: 19.6133, se: 0.98, n: 8 });
    expect(e.mean).toBeCloseTo(2, 9);
    expect(e.se).toBeCloseTo(0.98 / 9.80665, 12);
    expect(newtonsAndKgf(9.80665)).toBe('9.81 N (1.00 kgf)');
    expect(newtonsAndKgf(-1.2)).toBe('-1.20 N (-0.122 kgf)');
  });
});

void EMPTY_POINTER_TEXTS;
