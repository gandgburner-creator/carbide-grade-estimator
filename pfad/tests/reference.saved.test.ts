import { describe, expect, it } from 'vitest';
import type { StudyRow } from '../src/reference/Study';
import { compareCsv, compareTable, conditionsDiffer, defaultStudyName, highestPoint, mergeStudies, newSavedStudy, parseStudies, seriesOf, serializeStudies, uniqueName, validStudy } from '../src/reference/SavedStudies';

const est = (mean: number, se = 0.01) => ({ mean, se, n: 8 });
function row(name: string, alphaDeg: number, lift: number, drag: number, extra: Partial<StudyRow> = {}): StudyRow {
  return { jobId: `${name}@${alphaDeg}`, name, alphaDeg, lift: est(lift), drag: est(drag, 0.002), ld: est(lift / drag, 0.05), reynolds: 380, cells: 48, integrity: 'PASSED', engine: 'CPU (64-bit)', separationX: null, thicknessCells: 5, noseCells: 0.5, ...extra };
}
const a = newSavedStudy('plain', [row('NACA 4412', 0, 0, 0.4), row('NACA 4412', 8, 0.4, 0.35), row('NACA 0012', 8, 0.42, 0.34)], 'air at 15 °C', '2026-11-08T10:00:00.000Z');
const b = newSavedStudy('dimpled', [row('NACA 4412 + dimples', 8, 0.43, 0.33, { baseName: 'NACA 4412' }), row('NACA 4412 + dimples', 12, 0.5, 0.4, { baseName: 'NACA 4412' })], 'air at 15 °C', '2026-11-08T11:00:00.000Z');

describe('saved studies', () => {
  it('keep the rows and the conditions they were computed at, and are valid after a round trip through text', () => {
    expect(a.conditions).toMatchObject({ reynolds: 380, cells: 48, engine: 'CPU (64-bit)', angles: [0, 8] });
    expect(validStudy(a)).toBe(true);
    const back = parseStudies(serializeStudies([a, b]));
    expect(back.error).toBeNull();
    expect(back.studies).toEqual([a, b]);
    expect(back.skipped).toBe(0);
    expect(() => newSavedStudy('x', [], '')).toThrow(/run a study first/);
  });

  it('are named from their content when no name is given, and names stay distinct', () => {
    expect(defaultStudyName(a.rows)).toBe('NACA 4412, NACA 0012 · 0–8° · Re 380 · 48 cells');
    expect(newSavedStudy('  ', a.rows, '').name).toMatch(/NACA 4412/);
    expect(uniqueName('plain', ['plain'])).toBe('plain (2)');
    expect(uniqueName('plain', ['plain', 'plain (2)'])).toBe('plain (3)');
  });

  it('refuse text that is not a list of studies, and skip invalid entries', () => {
    expect(parseStudies('not json').error).toMatch(/not JSON/);
    expect(parseStudies('{"x":1}').error).toMatch(/no “studies” list/);
    const r = parseStudies(JSON.stringify({ studies: [a, { format: 'other' }, { ...b, rows: [{ name: 1 }] }] }));
    expect(r.studies).toEqual([a]);
    expect(r.skipped).toBe(2);
  });

  it('merge an import without duplicating a study and without clashing names', () => {
    expect(mergeStudies([a], [a, b]).map((s) => s.id)).toEqual([a.id, b.id]);
    const clash = { ...b, id: 'other-id', name: 'plain' };
    expect(mergeStudies([a], [clash]).map((s) => s.name)).toEqual(['plain', 'plain (2)']);
  });
});

describe('comparing saved studies', () => {
  const series = seriesOf([a, b]);

  it('makes one series per section of each study, ordered by angle', () => {
    expect(series.map((s) => s.section)).toEqual(['NACA 4412', 'NACA 0012', 'NACA 4412 + dimples']);
    expect(series[0].points.map((p) => p.alphaDeg)).toEqual([0, 8]);
    expect(series[2].baseName).toBe('NACA 4412');
    expect(series[0].dimples).toBeNull();
  });

  it('tabulates every angle of any series, the differences from the reference with their uncertainty, and a gap where a series has no value', () => {
    const t = compareTable(series, 'ld', series[0].key);
    expect(t.angles).toEqual([0, 8, 12]);
    expect(t.reference).toBe(series[0].key);
    const r8 = t.rows.find((r) => r.alphaDeg === 8)!;
    expect(r8.cells[0]!.delta).toBeNull();
    // dimpled 4412 at 8°: L/D 0.43/0.33 against the plain 0.4/0.35
    const d = r8.cells[2]!.delta!;
    expect(d.mean).toBeCloseTo(0.43 / 0.33 - 0.4 / 0.35, 9);
    expect(d.se).toBeCloseTo(Math.hypot(0.05, 0.05), 9);
    expect(r8.cells[2]!.clear).toBe(Math.abs(d.mean) > 2 * d.se);
    const r12 = t.rows.find((r) => r.alphaDeg === 12)!;
    expect(r12.cells[0]).toBeNull();
    expect(r12.cells[2]!.delta).toBeNull();
    // the same table for the drag, with another series as the reference
    const td = compareTable(series, 'drag', series[1].key);
    expect(td.rows.find((r) => r.alphaDeg === 8)!.cells[0]!.delta!.mean).toBeCloseTo(0.35 - 0.34, 12);
  });

  it('calls a difference clear only when it is larger than twice its uncertainty', () => {
    const big = newSavedStudy('big', [row('X', 4, 1, 0.1, { ld: est(10, 0.1) })], '');
    const same = newSavedStudy('same', [row('Y', 4, 1, 0.1, { ld: est(10.1, 0.1) })], '');
    const far = newSavedStudy('far', [row('Z', 4, 1, 0.1, { ld: est(12, 0.1) })], '');
    const t = compareTable(seriesOf([big, same, far]), 'ld', null);
    expect(t.rows[0].cells[1]!.clear).toBe(false);
    expect(t.rows[0].cells[2]!.clear).toBe(true);
  });

  it('finds the highest point of a series, skipping failed runs', () => {
    const s = seriesOf([newSavedStudy('s', [row('S', 0, 0.1, 0.1), row('S', 4, 0.6, 0.2), row('S', 8, 2, 0.1, { integrity: 'FAILED' })], '')])[0];
    expect(highestPoint(s, 'ld')!.alphaDeg).toBe(4);
  });

  it('says when the studies were not run under the same conditions', () => {
    expect(conditionsDiffer([a, b])).toEqual([]);
    const c = newSavedStudy('finer', [row('NACA 4412', 8, 0.5, 0.3, { cells: 96, reynolds: 760, engine: 'GPU (32-bit)' })], '');
    const msgs = conditionsDiffer([a, c]).join(' | ');
    expect(msgs).toMatch(/Reynolds numbers differ/);
    expect(msgs).toMatch(/resolutions differ/);
    expect(msgs).toMatch(/engines differ/);
    expect(conditionsDiffer([a])).toEqual([]);
  });

  it('exports the comparison as CSV with the conditions of each study', () => {
    const csv = compareCsv(series, [a, b]).split('\n');
    expect(csv[0]).toMatch(/^study,section,dimples,alpha_deg/);
    expect(csv.length).toBe(1 + 5);
    expect(csv[1]).toContain('"plain","NACA 4412"');
    expect(csv[1]).toContain('380,48,"CPU (64-bit)"');
  });
});
