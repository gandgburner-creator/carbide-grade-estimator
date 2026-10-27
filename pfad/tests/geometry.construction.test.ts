import { describe, expect, it } from 'vitest';
import { basisFromAnalysis } from '../src/geometry/Basis';
import { compareVersions } from '../src/geometry/Compare';
import { applyProposal, DEFAULT_CONSTRUCTION, partialSurface, proposeIncrement, type ConstructionBasis, type ConstructionConfig, type Proposal } from '../src/geometry/Construction';
import { geometrySVG, parseReferenceOutline, projectSVG, surfaceCSV } from '../src/geometry/Export';
import { acceptProposal, activePath, addReference, attachRun, headVersion, newProject, parseProject, projectToJSON, recordProposal, rejectProposal, replayFrames, undo, version, type RunSummary } from '../src/geometry/History';
import { bodyPolygon, DEFAULT_LIMITS, flatPlate, sampleSurface, validateGeometry } from '../src/geometry/SurfaceGeometry';
import { polygonArea } from '../src/walls/SolidBody';
import { analyseSurfaceFlow } from '../src/measurements/SeparationDetector';
import { attached, synth } from './helpers/synthFlow';

const g0 = flatPlate(30, 3);

/** a basis with a closed dividing streamline of height h (SE se) over [xLo, xHi] */
function basis(h: number, se: number, xLo = 8, xHi = 22, side: 'upper' | 'lower' = 'upper', mode: 'detector' | 'exploratory' = 'detector'): ConstructionBasis {
  const stations = Array.from({ length: 15 }, (_, i) => ({ x: 1 + 2 * i, h: 1 + 2 * i >= xLo && 1 + 2 * i <= xHi ? h : 0, se, state: (1 + 2 * i >= xLo && 1 + 2 * i <= xHi ? 'closed' : 'attached') as 'closed' | 'attached', qw: -0.03, u1: -0.1 }));
  return { side, mode, detector: 'wall-flux-detector/0', level: 'CANDIDATE_SEPARATION', region: { xLo, xHi }, stations, source: { recordId: 'r', seeds: [1, 2, 3], versionId: 'v0' }, summary: 'test basis' };
}

function ok(r: ReturnType<typeof proposeIncrement>): Proposal {
  if (!r.ok) throw new Error(r.reason);
  return r.proposal;
}

describe('the starting geometry and its polygon', () => {
  it('a flat plate is a counter-clockwise rectangle with one vertex per station', () => {
    const v = bodyPolygon(g0);
    expect(v.length / 2).toBe(2 * (g0.stations + 1));
    expect(polygonArea(v)).toBeCloseTo(30 * 3, 9);
    expect(validateGeometry(g0, DEFAULT_LIMITS)).toEqual([]);
  });
  it('limits flag thickness, slope and curvature violations', () => {
    const g = flatPlate(30, 3);
    g.upper[10] += 3;
    const codes = validateGeometry(g, DEFAULT_LIMITS).map((i) => i.code);
    expect(codes).toContain('slope');
    expect(codes).toContain('curvature');
    const thin = flatPlate(30, 1);
    expect(validateGeometry(thin, DEFAULT_LIMITS).map((i) => i.code)).toContain('min-thickness');
  });
});

describe('the construction rule', () => {
  it('adds a bounded, smooth increment from the onset toward the trailing edge', () => {
    const p = ok(proposeIncrement(g0, basis(4, 0.5), DEFAULT_CONSTRUCTION, 'p1'));
    const cfg = DEFAULT_CONSTRUCTION;
    // plateau = min(maxStep, η (h − SE)) = min(1, 0.5 · 3.5) = 1
    const maxDelta = Math.max(...p.points.map((q) => q.deltaNormal));
    expect(maxDelta).toBeLessThanOrEqual(cfg.maxStep + 1e-9);
    expect(maxDelta).toBeGreaterThan(0.99);
    // points run upstream → downstream, only on the requested side, and leave the reserves alone
    expect(p.points.map((q) => q.x)).toEqual([...p.points.map((q) => q.x)].sort((a, b) => a - b));
    expect(p.points[0].x).toBeGreaterThanOrEqual(8 - 1e-9);
    expect(p.points[p.points.length - 1].x).toBeLessThanOrEqual(g0.chord - cfg.teReserve + 1e-9);
    expect(p.after[0]).toBe(p.before[0]);
    expect(p.after[g0.stations]).toBe(p.before[g0.stations]);
    expect(p.points.every((q) => q.yNew > q.yOld)).toBe(true);
    // the lower side is untouched
    const applied = applyProposal(g0, p, p.points.length - 1).geometry;
    expect(applied.lower).toEqual(g0.lower);
    expect(applied.upper).toEqual(p.after);
    // the result respects the limits and the added area equals the sum of increments
    expect(validateGeometry(applied, cfg.limits)).toEqual([]);
    expect(p.area).toBeCloseTo(p.after.reduce((a, y, i) => a + (y - p.before[i]), 0), 9);
  });

  it('eases in and out: the surface leaves and rejoins the old one with zero first difference (G1)', () => {
    const p = ok(proposeIncrement(g0, basis(6, 0.2), DEFAULT_CONSTRUCTION, 'p'));
    const d = p.after.map((y, i) => y - p.before[i]);
    const first = d.findIndex((v) => v > 1e-9);
    const last = d.length - 1 - [...d].reverse().findIndex((v) => v > 1e-9);
    // smoothstep over 5 d: the first station gets about 10 % and the slope never exceeds 1.5 · max / ramp
    const max = Math.max(...d);
    expect(d[first]).toBeLessThan(0.12 * max);
    expect(d[last]).toBeLessThan(0.12 * max);
    for (let i = 1; i < d.length; i++) expect(Math.abs(d[i] - d[i - 1])).toBeLessThanOrEqual((1.5 * max) / DEFAULT_CONSTRUCTION.ramp + 1e-9);
  });

  it('uses a lower confidence bound: heights within their uncertainty give no proposal', () => {
    const r = proposeIncrement(g0, basis(1, 1.2), DEFAULT_CONSTRUCTION, 'p');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/below their uncertainty/);
    // exploratory mode applies no margin and does propose from the same numbers
    const e = proposeIncrement(g0, basis(1, 1.2, 8, 22, 'upper', 'exploratory'), { ...DEFAULT_CONSTRUCTION, shrink: 0 }, 'p');
    expect(e.ok).toBe(true);
  });

  it('builds on the lower side by adding material downward', () => {
    const p = ok(proposeIncrement(g0, basis(4, 0.5, 8, 22, 'lower'), DEFAULT_CONSTRUCTION, 'p'));
    expect(p.side).toBe('lower');
    expect(p.points.every((q) => q.yNew < q.yOld)).toBe(true);
    expect(applyProposal(g0, p, p.points.length - 1).geometry.upper).toEqual(g0.upper);
  });

  it('measures the added height along the normal of a sloped surface', () => {
    const g = flatPlate(30, 3);
    g.upper = g.upper.map((_, i) => 1.5 + 0.25 * i * 0.4); // slope 0.1 everywhere
    const p = ok(proposeIncrement(g, basis(4, 0.1, 6, 24), { ...DEFAULT_CONSTRUCTION, limits: { ...DEFAULT_LIMITS, maxCurvature: 1, maxThickness: 40 } }, 'p'));
    const mid = p.points.reduce((a, q) => (q.deltaNormal > a.deltaNormal ? q : a));
    expect((mid.yNew - mid.yOld) / mid.deltaNormal).toBeCloseTo(Math.sqrt(1 + 0.1 * 0.1), 3);
  });

  it('scales an increment down to respect tight limits, and refuses when none fits', () => {
    const tight: ConstructionConfig = { ...DEFAULT_CONSTRUCTION, maxStep: 3, relaxation: 1, ramp: 2, taper: 2, limits: { ...DEFAULT_LIMITS, maxSlope: 0.2, maxCurvature: 0.25 } };
    const p = ok(proposeIncrement(g0, basis(9, 0.1), tight, 'p'));
    expect(p.scale).toBeLessThan(1);
    expect(validateGeometry(applyProposal(g0, p, p.points.length - 1).geometry, tight.limits)).toEqual([]);
    const impossible = proposeIncrement(g0, basis(9, 0.1), { ...tight, limits: { ...tight.limits, maxThickness: 3.01 } }, 'p');
    expect(impossible.ok).toBe(false);
  });

  it('keeps the leading and trailing zones and refuses regions inside them', () => {
    const r = proposeIncrement(g0, basis(4, 0.5, 26, 30), DEFAULT_CONSTRUCTION, 'p');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/reserved/);
  });

  it('is a pure function of its inputs', () => {
    const a = proposeIncrement(g0, basis(4, 0.5), DEFAULT_CONSTRUCTION, 'p');
    const b = proposeIncrement(g0, basis(4, 0.5), DEFAULT_CONSTRUCTION, 'p');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('partial acceptance stops at the construction point and eases the rest away', () => {
    const p = ok(proposeIncrement(g0, basis(5, 0.2), DEFAULT_CONSTRUCTION, 'p'));
    const k = Math.floor(p.points.length / 2);
    const part = applyProposal(g0, p, k);
    expect(part.accepted).toBe(k + 1);
    expect(applyProposal(g0, p, -1).geometry).toEqual(g0);
    expect(applyProposal(g0, p, p.points.length - 1).geometry.upper).toEqual(p.after);
    // everything up to the cut is as proposed; downstream of it the surface is below the full proposal
    const xCut = p.points[k].x;
    p.points.forEach((q) => {
      if (q.x <= xCut) expect(part.geometry.upper[q.index]).toBeCloseTo(q.yNew, 6);
      else expect(part.geometry.upper[q.index]).toBeLessThanOrEqual(q.yNew + 1e-9);
    });
    expect(validateGeometry(part.geometry, DEFAULT_CONSTRUCTION.limits)).toEqual([]);
    // replay surfaces: the first k + 1 points applied, nothing after
    const s = partialSurface(g0, 'upper', p.points, k);
    expect(s.upper[p.points[k].index]).toBe(p.points[k].yNew);
    expect(s.upper[p.points[k + 1].index]).toBe(g0.upper[p.points[k + 1].index]);
  });
});

describe('construction basis from the detector', () => {
  const strong = synth({ seeds: 3, u: (_r, _b, k, j) => (k >= 10 && k <= 19 ? (j < 4 ? -0.6 : 0.9) : attached(j)), tau: (_r, _b, k) => (k >= 10 && k <= 19 ? -0.04 : 0.02) }, 21);
  it('detector mode needs a candidate region; the basis carries the measured heights', () => {
    const a = analyseSurfaceFlow(strong, 'upper');
    const b = basisFromAnalysis(a, 'detector', { recordId: 'r1', versionId: 'v0' });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.basis.level).toBe(a.level);
    expect(b.basis.region.xLo).toBeCloseTo(a.region!.xLo, 9);
    expect(b.basis.summary).toMatch(/wall-flux-detector\/0/);
    const none = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, _k, j) => attached(j) }, 22), 'upper');
    const r = basisFromAnalysis(none, 'detector', { recordId: null, versionId: null });
    expect(r.ok).toBe(false);
  });
  it('exploratory mode is labelled as such and still names the detector level', () => {
    // weak backflow: pooled flux negative but not significant
    const weak = analyseSurfaceFlow(synth({ seeds: 2, u: (_r, _b, k, j) => (k >= 8 && k <= 21 ? (j < 4 ? -0.05 : 0.9) : attached(j)) }, 23), 'upper');
    const e = basisFromAnalysis(weak, 'exploratory', { recordId: null, versionId: null });
    if (e.ok) {
      expect(e.basis.mode).toBe('exploratory');
      expect(e.basis.summary).toMatch(/EXPLORATORY/);
      expect(e.basis.summary).toMatch(/may be produced by noise/);
      expect(e.basis.level).toBe(weak.level);
    } else expect(e.reason).toMatch(/nothing to respond to/);
  });
});

describe('history: versions, undo, replay, export', () => {
  const conditions = { alphaDeg: 65, areaFraction: 0.1 };
  const prop = (g: typeof g0, id: string, h = 5) => ok(proposeIncrement(g, basis(h, 0.2), DEFAULT_CONSTRUCTION, id));

  it('accepting creates an identifiable child version with its reason, basis and points; the parent is kept', () => {
    let p = newProject('t', conditions, g0, '2026-01-01T00:00:00.000Z');
    const pr = prop(g0, 'p1');
    p = recordProposal(p, pr, '2026-01-01T00:01:00.000Z');
    const { project, version: v } = acceptProposal(p, 'p1', undefined, 'looks right', '2026-01-01T00:02:00.000Z');
    expect(v.id).toBe('v1');
    expect(v.parent).toBe('v0');
    expect(v.origin).toBe('constructed');
    expect(v.construction!.reason).toBe(pr.rationale);
    expect(v.construction!.hypothesis).toBe(pr.hypothesis);
    expect(v.construction!.basis.detector).toBe('wall-flux-detector/0');
    expect(v.construction!.points.length).toBe(pr.points.length);
    expect(v.construction!.partial).toBe(false);
    expect(project.head).toBe('v1');
    expect(version(project, 'v0').geometry.upper).toEqual(g0.upper); // the parent is untouched
    expect(project.proposals[0].status).toBe('accepted');
    expect(project.proposals[0].acceptedVersion).toBe('v1');
    expect(project.log.map((e) => e.type)).toEqual(['created', 'proposed', 'accepted']);
    expect(p.versions.length).toBe(1); // immutable: the earlier project value is unchanged
  });

  it('undo returns to the parent but keeps the undone version in the record; a new increment branches from the parent', () => {
    let p = newProject('t', conditions, g0);
    p = recordProposal(p, prop(g0, 'p1'));
    p = acceptProposal(p, 'p1').project;
    expect(() => undo(newProject('t', conditions, g0))).toThrow(/nothing to undo/);
    p = undo(p);
    expect(p.head).toBe('v0');
    expect(version(p, 'v1').undone).not.toBeNull();
    expect(p.versions.length).toBe(2);
    p = recordProposal(p, prop(g0, 'p2', 4));
    p = acceptProposal(p, 'p2').project;
    expect(p.head).toBe('v2');
    expect(version(p, 'v2').parent).toBe('v0');
    expect(activePath(p).map((v) => v.id)).toEqual(['v0', 'v2']);
    expect(p.log.map((e) => e.type)).toEqual(['created', 'proposed', 'accepted', 'undone', 'proposed', 'accepted']);
  });

  it('rejecting keeps the proposal and changes nothing; stale or closed proposals cannot be accepted', () => {
    let p = newProject('t', conditions, g0);
    p = recordProposal(p, prop(g0, 'p1'));
    p = rejectProposal(p, 'p1', 'not convincing');
    expect(p.head).toBe('v0');
    expect(p.proposals[0]).toMatchObject({ status: 'rejected', note: 'not convincing' });
    expect(() => acceptProposal(p, 'p1')).toThrow(/not open/);
    // a new proposal supersedes an open one
    p = recordProposal(p, prop(g0, 'p2'));
    p = recordProposal(p, prop(g0, 'p3', 4));
    expect(p.proposals.find((e) => e.id === 'p2')!.status).toBe('superseded');
    expect(() => acceptProposal(p, 'p2')).toThrow(/not open/);
    // a proposal made against v0 cannot be accepted once the head has moved
    const moved = acceptProposal(p, 'p3').project;
    const stale = { ...p.proposals.find((e) => e.id === 'p3')!, id: 'late', status: 'proposed' as const };
    expect(() => acceptProposal({ ...moved, proposals: [...moved.proposals, stale] }, 'late')).toThrow(/different version/);
  });

  it('partial acceptance records how far the construction point had got', () => {
    let p = newProject('t', conditions, g0);
    const pr = prop(g0, 'p1');
    p = recordProposal(p, pr);
    const k = Math.floor(pr.points.length / 2);
    const { version: v } = acceptProposal(p, 'p1', k);
    expect(v.construction!.partial).toBe(true);
    expect(v.construction!.totalPoints).toBe(pr.points.length);
    expect(v.construction!.acceptedPoints).toBe(k + 1);
    expect(validateGeometry(v.geometry, DEFAULT_CONSTRUCTION.limits)).toEqual([]);
    expect(() => acceptProposal(p, 'p1', -1)).toThrow(/nothing to accept/);
  });

  it('replays the active path point by point, ending exactly at the head geometry', () => {
    let p = newProject('t', conditions, g0);
    p = recordProposal(p, prop(g0, 'p1', 4));
    p = acceptProposal(p, 'p1').project;
    p = recordProposal(p, prop(headVersion(p).geometry, 'p2', 3));
    p = acceptProposal(p, 'p2').project;
    const frames = replayFrames(p);
    const n1 = version(p, 'v1').construction!.points.length;
    const n2 = version(p, 'v2').construction!.points.length;
    expect(frames.length).toBe(1 + (1 + n1) + (1 + n2));
    expect(frames[0].marker).toBeNull();
    expect(frames[frames.length - 1].geometry.upper).toEqual(headVersion(p).geometry.upper);
    // the marker advances monotonically along a step and the surface grows with it
    const step1 = frames.filter((f) => f.step === 1 && f.marker);
    expect(step1.map((f) => f.marker!.x)).toEqual([...step1.map((f) => f.marker!.x)].sort((a, b) => a - b));
    const area = (f: (typeof frames)[number]) => f.geometry.upper.reduce((a, y) => a + y, 0);
    for (let i = 1; i < step1.length; i++) expect(area(step1[i])).toBeGreaterThanOrEqual(area(step1[i - 1]) - 1e-9);
  });

  it('round-trips through JSON and rejects malformed projects', () => {
    let p = newProject('t', conditions, g0);
    p = recordProposal(p, prop(g0, 'p1'));
    p = acceptProposal(p, 'p1').project;
    const back = parseProject(projectToJSON(p, { r1: { x: 1 } }));
    expect(back.project).toEqual(JSON.parse(JSON.stringify(p)));
    expect(back.records).toEqual({ r1: { x: 1 } });
    expect(() => parseProject('{"format":"nope"}')).toThrow(/not a PFAD/);
    expect(() => parseProject(JSON.stringify({ ...p, head: 'zzz' }))).toThrow(/head version is missing/);
    expect(() => parseProject(JSON.stringify({ ...p, versions: p.versions.map((v) => ({ ...v, parent: v.id === 'v1' ? 'v9' : v.parent })) }))).toThrow(/missing parent/);
  });

  it('exports SVG and sampled coordinates with provenance, and keeps imported references apart', () => {
    let p = newProject('t', conditions, g0);
    p = recordProposal(p, prop(g0, 'p1'));
    p = acceptProposal(p, 'p1').project;
    const ref = parseReferenceOutline('x,upper,lower\n0,0.5,-0.5\n10,2,-2\n20,1.5,-1.5\n30,0.4,-0.4', 'my outline.csv', 30, 30);
    p = addReference(p, ref);
    expect(p.references[0].imported).toBe(true);
    expect(activePath(p).map((v) => v.id)).toEqual(['v0', 'v1']); // never part of the construction path
    expect(p.log[p.log.length - 1].detail).toMatch(/not constructed by PFAD/);
    const svg = projectSVG(p);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/imported reference, not constructed by PFAD/);
    expect(svg).toMatch(/v1 step 1/);
    expect(svg).toMatch(/construction|particle diameters/);
    const csv = surfaceCSV(headVersion(p), { project: 't', codeVersion: 'abc', modelVersion: '0.2' }, { x: 10, y: 20, alphaDeg: 30 });
    expect(csv).toMatch(/^# PFAD flow-guided geometry/);
    expect(csv).toMatch(/# version: v1  parent: v0  origin: constructed/);
    expect(csv).toMatch(/# codeVersion: abc/);
    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(rows[0]).toBe('side,station,x,y,arc_length,slope_deg,x_sim,y_sim');
    expect(rows.length).toBe(1 + 2 * (g0.stations + 1));
    const up = sampleSurface(headVersion(p).geometry, 'upper');
    expect(rows.some((r) => r.startsWith(`upper,10,${up[10].x},`))).toBe(true);
    expect(() => geometrySVG([], { title: 'x' })).toThrow(/no outline/);
  });

  it('a reference outline is rescaled and resampled onto the stations', () => {
    const r = parseReferenceOutline('0 0 0\n1 1 -1\n2 0 0\n3 -1 1', 'tiny', 30, 6);
    expect(r.geometry.upper.length).toBe(7);
    expect(r.geometry.chord).toBe(30);
    expect(r.geometry.upper[0]).toBeCloseTo(0, 9);
    expect(r.geometry.upper[2]).toBeCloseTo(10, 9); // x = 10 d ↔ original x = 1: y = 1 · 10
    expect(() => parseReferenceOutline('1 2', 'bad', 30, 6)).toThrow(/at least 4 rows/);
  });
});

describe('comparison of two simulated versions', () => {
  const run = (u: (k: number, j: number) => number, seeds = [1, 2, 3], conditions: Record<string, unknown> = { alphaDeg: 65 }, fx = 5): RunSummary => {
    const d = synth({ seeds: seeds.length, u: (_r, _b, k, j) => u(k, j), tau: (_r, _b, k) => (k >= 10 && k <= 19 ? -0.03 : 0.02) }, 40 + fx);
    return {
      recordId: 'r', experimentId: 'r', seeds, finishedAt: 't', activeMs: 1, codeVersion: 'abc', modelVersion: '0.2', conditions,
      integrity: { status: 'PASSED', maxEnergyResidual: 1e-14, maxMomentumResidual: 1e-15, halted: 0, insideDetections: 0 },
      analysis: { upper: analyseSurfaceFlow(d, 'upper'), lower: analyseSurfaceFlow(d, 'lower') },
      forces: { fx: { mean: fx, se: 0.1, n: 48 }, fy: { mean: 2, se: 0.1, n: 48 }, moment: { mean: 0, se: 1, n: 48 } },
    };
  };
  const bubble = (amp: number) => (k: number, j: number) => (k >= 10 && k <= 19 ? (j < 4 ? -amp : 0.9) : attached(j));

  function pair(after: (k: number, j: number) => number, condB: Record<string, unknown> = { alphaDeg: 65 }) {
    let p = newProject('t', { alphaDeg: 65 }, g0);
    const a = analyseSurfaceFlow(synth({ seeds: 3, u: (_r, _b, k, j) => bubble(0.5)(k, j), tau: (_r, _b, k) => (k >= 10 && k <= 19 ? -0.03 : 0.02) }, 45), 'upper');
    const bs = basisFromAnalysis(a, 'detector', { recordId: 'r', versionId: 'v0' });
    if (!bs.ok) throw new Error(bs.reason);
    const pr = ok(proposeIncrement(g0, bs.basis, DEFAULT_CONSTRUCTION, 'p1'));
    p = attachRun(p, 'v0', run(bubble(0.5)));
    p = recordProposal(p, pr);
    p = acceptProposal(p, 'p1').project;
    p = attachRun(p, 'v1', run(after, [1, 2, 3], condB, 6));
    return compareVersions(version(p, 'v0'), version(p, 'v1'));
  }

  it('the stated prediction is supported when the backflow over the treated stretch shrinks', () => {
    const c = pair(bubble(0.0));
    expect(c.hypothesis!.outcome).toBe('supported');
    expect(c.hypothesis!.delta!.diff).toBeGreaterThan(0);
    expect(c.hypothesis!.detail).toMatch(/does not show the geometry is better/);
  });
  it('contradicted when the backflow grows, unresolved when nothing changes', () => {
    expect(pair(bubble(1.1)).hypothesis!.outcome).toBe('contradicted');
    expect(pair(bubble(0.5)).hypothesis!.outcome).toBe('unresolved');
  });
  it('lists every indicator with its sign convention and never a composite score', () => {
    const c = pair(bubble(0.0));
    expect(c.indicators.map((i) => i.id)).toEqual(['fx', 'fy', 'qw-upper', 'qw-lower']);
    expect(c.indicators.every((i) => i.convention.length > 10)).toBe(true);
    expect(Object.keys(c)).not.toContain('score');
    // a quantity can improve while another worsens: force x rose (5 → 6) in this pair
    expect(c.indicators.find((i) => i.id === 'fx')!.change).toBe('increased');
    expect(c.hypothesis!.outcome).toBe('supported');
  });
  it('warns when the flow conditions or seeds differ', () => {
    const c = pair(bubble(0.0), { alphaDeg: 40 });
    expect(c.conditionChanges.join(' ')).toMatch(/alphaDeg/);
    expect(c.notes.join(' ')).toMatch(/flow conditions differ/);
    expect(c.sharedSeeds).toEqual([1, 2, 3]);
  });
  it('needs both runs', () => {
    const p = newProject('t', {}, g0);
    expect(() => compareVersions(version(p, 'v0'), version(p, 'v0'))).toThrow(/finished run/);
  });
});
