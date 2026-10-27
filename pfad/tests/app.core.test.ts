import { describe, expect, it } from 'vitest';
import { compareRecords } from '../src/app/compare';
import { csvCell, fieldCSV, profileCSV, recordCSV, recordJSON, seriesCSV } from '../src/app/exporters';
import { FIELD_INFO, temporalLabel } from '../src/app/fields';
import { filterRows, flatten } from '../src/app/flatten';
import { bundle, entryFromRecord, MemoryLibrary, parseImport, searchLibrary, type LibraryEntry } from '../src/app/library';
import { ProfileAccumulator } from '../src/app/profiles';
import { makeProvenance } from '../src/app/provenance';
import { freeSeeds, reservedOwner, UB0_RESERVED_SEEDS } from '../src/app/seeds';
import { SeriesRecorder } from '../src/app/series';
import { validateParams } from '../src/app/validate';
import { ParticleStore } from '../src/core/ParticleStore';
import type { ExperimentRecord } from '../src/experiments/Experiment';
import { EXPERIMENTS } from '../src/experiments/registry';
import { independentEstimate } from '../src/measurements/Statistics';
import { pilotPlan, stage0bContingency, stage0bPlan, stage0Plan, type FrozenInputs } from '../src/universeB/UB0Plans';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FieldKind } from '../src/workers/protocol';

const prov = makeProvenance({ experimentType: 'static-box', universe: 'A', preset: 'quick', seeds: [7] });

function fakeRecord(over: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    experimentId: 'static-box-x',
    experimentType: 'static-box',
    title: 'Static box',
    modelVersion: '0.2.0-p0.5',
    modelComponents: {},
    seed: 7,
    seeds: [7],
    timestamp: '2026-10-01T00:00:00.000Z',
    particleCount: 100,
    particleScale: { radius: 0.5, diameter: 1, mass: 1 },
    density: { numberDensity: 0.1, massDensity: 0.1, areaFraction: 0.05 },
    temperature: { kT: 1, definition: '' },
    speed: null,
    geometry: '',
    wallModel: '',
    accommodation: 0,
    restitution: 1,
    occupancyModel: '',
    ks: 0,
    timestep: { kind: 'fixed', dt: 0.1 },
    domain: { xmin: 0, xmax: 1, ymin: 0, ymax: 1, periodicX: false, periodicY: false },
    duration: { time: 1, steps: 1, collisionsPerParticle: 1 },
    reynolds: { simulation: null, effective: null, physical: null, note: '' },
    mach: { Mp: null, benchmark: null, note: '' },
    results: { pressure: independentEstimate([1, 1.1, 0.9, 1.05]), label: 'a,b', series: Array.from({ length: 100 }, (_, i) => i) },
    uncertainty: {},
    convergence: { status: 'NOT ASSESSED', note: '' },
    benchmarks: { idealGas: 1.0 },
    assumptions: [],
    acceptance: [],
    status: 'UNTESTED',
    warnings: [],
    safetyFlags: [],
    config: { count: 100 },
    ...over,
  };
}

describe('field metadata', () => {
  it('every field kind has a symbol, units, origin and definition', () => {
    const kinds: Exclude<FieldKind, 'none'>[] = ['occupancy', 'occupancyGradient', 'density', 'speed', 'ux', 'uy', 'momentumX', 'momentumY', 'kT', 'pressure', 'shear'];
    for (const k of kinds) {
      const f = FIELD_INFO[k];
      expect(f.symbol && f.units && f.definition).toBeTruthy();
      expect(['measured', 'derived']).toContain(f.origin);
    }
    // the gradient and the magnitude are computed from other fields
    expect(FIELD_INFO.occupancyGradient.origin).toBe('derived');
    expect(FIELD_INFO.speed.origin).toBe('derived');
  });
  it('labels instantaneous and time-averaged fields', () => {
    expect(temporalLabel(1, 0, 0)).toMatch(/instantaneous/);
    expect(temporalLabel(40, 1, 5)).toMatch(/time-averaged over 40 snapshots/);
  });
});

describe('series recorder', () => {
  it('keeps columns aligned, pads late keys with NaN and thins evenly at capacity', () => {
    const s = new SeriesRecorder(8);
    s.push(0, { a: 0 });
    s.push(1, { a: 1, b: 10 });
    s.push(1, { a: 99 }); // not later in time: ignored
    let snap = s.snapshot();
    expect(snap.t).toEqual([0, 1]);
    expect(snap.columns.b[0]).toBeNaN();
    expect(snap.columns.b[1]).toBe(10);
    for (let t = 2; t < 40; t++) s.push(t, { a: t });
    snap = s.snapshot();
    expect(snap.t.length).toBeLessThan(8);
    expect(snap.columns.a.length).toBe(snap.t.length);
    expect(snap.columns.b.length).toBe(snap.t.length);
    const gaps = snap.t.slice(1).map((t, i) => t - snap.t[i]);
    expect(Math.max(...gaps.slice(0, -1)) - Math.min(...gaps.slice(0, -1))).toBeLessThanOrEqual(gaps[0]);
  });
});

describe('profile accumulator', () => {
  it('recovers an imposed linear velocity profile and counts only particles in the window', () => {
    const store = new ParticleStore(2000);
    let k = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const y = (j + 0.5) * 0.5;
        store.add({ x: (i + 0.5) * 0.5, y, vx: 0.1 * y, vy: 0, radius: 0.1, mass: 1 });
        k++;
      }
    }
    const p = new ProfileAccumulator({ x0: 0, x1: 10, ymin: 0, ymax: 20 }, 10, 2, 4);
    for (let s = 0; s < 25; s++) p.sample(store);
    const r = p.result();
    expect(r.snapshots).toBe(25);
    expect(r.batches).toBeLessThanOrEqual(5);
    r.ux.forEach((u, b) => expect(u.mean).toBeCloseTo(0.1 * (r.y[b] + 0.25 - 0.25), 1));
    // 20 columns × 4 rows of particles per bin inside x < 10: n = 80 / (2 × 10)
    expect(r.numberDensity[0].mean).toBeCloseTo(80 / 20, 10);
    expect(r.numberDensity[0].se).toBeCloseTo(0, 10);
    expect(k).toBe(1600);
  });
});

describe('configuration validation', () => {
  const d = EXPERIMENTS['static-box']!.quick as Record<string, unknown>;
  it('accepts the documented defaults unchanged', () => {
    const v = validateParams({ ...d }, d);
    expect(v.errors).toEqual([]);
    expect(v.changed).toEqual([]);
  });
  it('rejects unknown parameters, wrong types and out-of-range values', () => {
    const v = validateParams({ ...d, count: -3, areaFraction: 0.9, bogus: 1, restitutions: [1.2], contact: 5 }, d);
    const paths = v.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['count', 'areaFraction', 'bogus', 'restitutions[0]', 'contact']));
    expect(v.changed).toEqual(expect.arrayContaining(['count', 'areaFraction']));
  });
  it('requires distinct integer seeds and, for the UB-0 instrument, refuses protocol seeds', () => {
    expect(validateParams({ ...d, seeds: [3, 3] }, d).errors.some((e) => /distinct/.test(e.message))).toBe(true);
    expect(validateParams({ ...d, seeds: [1.5] }, d).errors.length).toBeGreaterThan(0);
    const ub = EXPERIMENTS['ub-instrument']!.quick as Record<string, unknown>;
    expect(validateParams({ ...ub }, ub, { protocolSeeds: true }).errors).toEqual([]);
    const bad = validateParams({ ...ub, seeds: [9600, 20001] }, ub, { protocolSeeds: true });
    expect(bad.errors.map((e) => e.message).join(' ')).toMatch(/blind stability pilots.*judged/);
  });
});

describe('UB-0 reserved seeds cover every protocol plan', () => {
  const F: FrozenInputs = JSON.parse(readFileSync(join(__dirname, '..', 'results', 'ub0', 'frozen_inputs.json'), 'utf8'));
  const seedPlan = JSON.parse(readFileSync(join(__dirname, '..', 'results', 'ub0', 'seed_plan.json'), 'utf8')) as { blocks: { planned: [number, number]; reserve: [number, number] }[] };
  const covered = (s: number) => reservedOwner(s) !== null;
  it('Stage 0, Stage 0b (with contingency), pilots and the judged seed plan', () => {
    const all = [
      ...stage0Plan({ reserve: true }),
      ...stage0bPlan({ phase: 1, reserve: true }),
      ...stage0bPlan({ phase: 2, amplitude: 0.04, reserve: true }),
      ...stage0bContingency(['N4-static', 'N16-static', 'N64-shear'], 0.04).plan,
      ...pilotPlan(F),
    ].map((p) => p.seed);
    for (const b of seedPlan.blocks) all.push(b.planned[0], b.planned[1], b.reserve[0], b.reserve[1]);
    expect(all.filter((s) => !covered(s))).toEqual([]);
  });
  it('the app instrument defaults and freeSeeds avoid them', () => {
    expect((EXPERIMENTS['ub-instrument']!.quick.seeds as number[]).some(covered)).toBe(false);
    expect((EXPERIMENTS['ub-instrument']!.defaults.seeds as number[]).some(covered)).toBe(false);
    expect(freeSeeds(9499, 4)).toEqual([10000, 11000, 13000, 13001]);
    expect(freeSeeds(1, 3)).toEqual([1, 2, 3]);
    expect(UB0_RESERVED_SEEDS.every((r) => r.from <= r.to)).toBe(true);
  });
});

describe('flatten, exports and comparison', () => {
  it('flattens estimates to one row with their uncertainty and summarises long arrays', () => {
    const rows = flatten(fakeRecord().results);
    const p = rows.find((r) => r.path === 'pressure')!;
    expect(p.value).toBeCloseTo(1.0125, 10);
    expect(p.se).toBeGreaterThan(0);
    expect(p.ci95).toHaveLength(2);
    expect(rows.find((r) => r.path === 'series')).toMatchObject({ value: 100, summarised: true });
    expect(filterRows(rows, 'PRESS').map((r) => r.path)).toEqual(['pressure']);
  });
  it('CSV cells are quoted when needed', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell(Number.NaN)).toBe('NaN');
    expect(csvCell(null)).toBe('');
  });
  it('record CSV carries provenance and units and leaves benchmarks out', () => {
    const csv = recordCSV(fakeRecord(), prov);
    expect(csv).toMatch(/^# app: pfad-lab\/1/m);
    expect(csv).toMatch(/^# codeVersion: \S+/m);
    expect(csv).toMatch(/^# units: model units/m);
    expect(csv).toMatch(/^pressure,1\.0125,/m);
    expect(csv).toMatch(/"a,b"/);
    expect(csv).not.toMatch(/idealGas/);
  });
  it('record JSON stays an ExperimentRecord and adds provenance', () => {
    const j = JSON.parse(recordJSON(fakeRecord(), prov));
    expect(j.experimentType).toBe('static-box');
    expect(j.results.pressure.mean).toBeCloseTo(1.0125, 10);
    expect(j.labProvenance.codeVersion).toBe(prov.codeVersion);
  });
  it('field, profile and series CSV state quantity, units and averaging', () => {
    const f = fieldCSV({ kind: 'kT', nx: 2, ny: 1, values: [1, 2], snapshots: 5, particlesPerCell: 10, t0: 0, t1: 4, domain: { xmin: 0, xmax: 2, ymin: 0, ymax: 1 } }, prov);
    expect(f).toMatch(/# quantityUnits: kT₀/);
    expect(f).toMatch(/# origin: measured/);
    expect(f).toMatch(/time-averaged over 5 snapshots/);
    expect(f.trim().split('\n').filter((l) => !l.startsWith('#'))).toEqual(['cx,cy,x [d],y [d],kT [kT₀]', '0,0,0.5,0.5,1', '1,0,1.5,0.5,2']);
    const pr = profileCSV({ x0: 0, x1: 1, y: [0.5], binWidth: 1, snapshots: 3, batches: 2, numberDensity: [{ mean: 1, se: 0 }], ux: [{ mean: 0.1, se: 0.01 }], uy: [{ mean: 0, se: 0 }], kT: [{ mean: 1, se: 0.1 }] }, prov);
    expect(pr).toMatch(/batch independence not checked/);
    const se = seriesCSV({ t: [0, 1], columns: { pressure: [1, 2] } }, prov, { pressure: 'kT₀/d²' });
    expect(se).toMatch(/^t \[τ\],pressure \[kT₀\/d²\]$/m);
  });
  it('compares two records descriptively and warns about shared seeds and model changes', () => {
    const a = fakeRecord();
    const b = fakeRecord({ results: { pressure: independentEstimate([1.2, 1.3, 1.25, 1.22]) }, seeds: [7], modelVersion: 'other' });
    const c = compareRecords(a, b);
    const row = c.rows.find((r) => r.path === 'pressure')!;
    expect(row.diff).toBeCloseTo(1.2425 - 1.0125, 10);
    expect(row.seDiff).toBeCloseTo(Math.hypot(row.a!.se!, row.b!.se!), 12);
    expect(c.notes.join(' ')).toMatch(/not a hypothesis test/);
    expect(c.notes.join(' ')).toMatch(/Shared seeds/);
    expect(c.notes.join(' ')).toMatch(/model versions/);
  });
});

describe('library', () => {
  it('imports records and app bundles, searches and filters', async () => {
    const lib = new MemoryLibrary();
    const [imp] = parseImport(JSON.stringify(fakeRecord()), 'static.json');
    expect(imp.entry.outcome).toBe('imported');
    expect(imp.entry.provenance.codeVersion).toMatch(/not recorded/);
    await lib.put(imp.entry, imp.payload);
    const own: LibraryEntry = { ...entryFromRecord(fakeRecord({ experimentId: 'kutta-1', experimentType: 'kutta', title: 'Kutta', status: 'FAILED' }), 'x'), id: 'run-2', outcome: 'stopped', createdAt: '2026-10-02T00:00:00.000Z' };
    await lib.put(own);
    const all = await lib.list();
    expect(all.map((e) => e.id)).toEqual(['run-2', 'import:static-box-x']);
    expect(searchLibrary(all, { text: 'kutta' }).map((e) => e.id)).toEqual(['run-2']);
    expect(searchLibrary(all, { text: 'static 7' }).map((e) => e.id)).toEqual(['import:static-box-x']);
    expect(searchLibrary(all, { outcome: 'stopped' })).toHaveLength(1);
    expect(searchLibrary(all, { status: 'FAILED' })).toHaveLength(1);
    expect((await lib.payload('import:static-box-x'))?.record?.experimentId).toBe('static-box-x');
    const round = parseImport(bundle([{ entry: imp.entry, payload: imp.payload }]), 'lib.json');
    expect(round[0].entry.id).toBe(imp.entry.id);
    expect(round[0].payload.record?.title).toBe('Static box');
    expect(() => parseImport('{"x":1}', 'bad.json')).toThrow(/not a PFAD/);
    await lib.remove('run-2');
    expect(await lib.list()).toHaveLength(1);
  });
});
