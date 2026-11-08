import type { Est } from '../cfd/CfdRun';
import type { StudyRow } from './Study';

/**
 * SAVED STUDIES AND THEIR COMPARISON. A finished airfoil study (the table of lift, drag and L/D of some sections at some angles) can be
 * saved under a name, with the conditions it was computed at, and later compared with any other saved study: the same sections run under
 * other conditions (another resolution, Reynolds number, engine), different sections, dimpled and plain versions of the same section.
 * Everything here is plain data and arithmetic on rows that were computed by runs; nothing is computed or estimated anew, and
 * nothing is ranked: a comparison shows the numbers side by side, the differences with their uncertainty, and says when the studies were
 * not run under the same conditions (then the differences are not a like-for-like comparison).
 */
export interface SavedConditions {
  reynolds: number;
  cells: number;
  engine: string;
  /** a line of words about the fluid and the flow the lattice stands for (for the reader; the lattice runs at `reynolds`) */
  flow: string;
  angles: number[];
}

export interface SavedStudy {
  format: 'pfad-saved-study/1';
  id: string;
  name: string;
  savedAt: string;
  conditions: SavedConditions;
  rows: StudyRow[];
}

export function newSavedStudy(name: string, rows: StudyRow[], flow: string, at = new Date().toISOString()): SavedStudy {
  if (!rows.length) throw new Error('there is nothing to save: run a study first');
  const first = rows[0];
  const angles = [...new Set(rows.map((r) => r.alphaDeg))].sort((a, b) => a - b);
  return {
    format: 'pfad-saved-study/1',
    id: `study-${at.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || defaultStudyName(rows),
    savedAt: at,
    conditions: { reynolds: first.reynolds, cells: first.cells, engine: first.engine, flow, angles },
    rows: rows.map((r) => ({ ...r })),
  };
}

/** "NACA 4412, NACA 0012 · 0–8° · Re 380 · 48 cells" */
export function defaultStudyName(rows: StudyRow[]): string {
  const names = [...new Set(rows.map((r) => r.name))];
  const angles = rows.map((r) => r.alphaDeg);
  const lo = Math.min(...angles);
  const hi = Math.max(...angles);
  const head = names.length <= 2 ? names.join(', ') : `${names[0]} and ${names.length - 1} more`;
  return `${head} · ${lo === hi ? `${lo}°` : `${lo}–${hi}°`} · Re ${Math.round(rows[0].reynolds)} · ${rows[0].cells} cells`;
}

/** A name that no saved study has: the name, or the name with (2), (3) … */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; i < 1000; i++) if (!taken.includes(`${name} (${i})`)) return `${name} (${i})`;
  return `${name} (${Date.now()})`;
}

// ---- series: one section of one saved study, over its angles

export interface SeriesPoint {
  alphaDeg: number;
  lift: Est;
  drag: Est;
  ld: Est | null;
  integrity: StudyRow['integrity'];
}

export interface Series {
  /** study id + section name */
  key: string;
  studyId: string;
  studyName: string;
  section: string;
  /** the section without its dimples, and the dimples in words (null for a plain section) */
  baseName: string;
  dimples: string | null;
  points: SeriesPoint[];
}

export function seriesOf(studies: SavedStudy[]): Series[] {
  const out: Series[] = [];
  for (const st of studies) {
    const by = new Map<string, Series>();
    for (const r of st.rows) {
      let s = by.get(r.name);
      if (!s) {
        s = { key: `${st.id}::${r.name}`, studyId: st.id, studyName: st.name, section: r.name, baseName: r.baseName ?? r.name, dimples: r.dimples ? r.dimples.label : null, points: [] };
        by.set(r.name, s);
        out.push(s);
      }
      s.points.push({ alphaDeg: r.alphaDeg, lift: r.lift, drag: r.drag, ld: r.ld, integrity: r.integrity });
    }
    for (const s of by.values()) s.points.sort((a, b) => a.alphaDeg - b.alphaDeg);
  }
  return out;
}

export type Metric = 'ld' | 'lift' | 'drag';
export const METRICS: { id: Metric; label: string; digits: number }[] = [
  { id: 'ld', label: 'L/D', digits: 2 },
  { id: 'lift', label: 'C_l', digits: 3 },
  { id: 'drag', label: 'C_d', digits: 4 },
];

export function metricOf(p: SeriesPoint, m: Metric): Est | null {
  const e = m === 'ld' ? p.ld : m === 'lift' ? p.lift : p.drag;
  return e && Number.isFinite(e.mean) ? e : null;
}

export interface CompareCell {
  value: Est;
  /** the difference from the reference series at this angle (this − reference) with its standard error, null for the reference itself or where it has no value */
  delta: { mean: number; se: number } | null;
  /** true when the difference is larger than twice its standard error; null when it cannot be told */
  clear: boolean | null;
  integrity: StudyRow['integrity'];
}

export interface CompareRow {
  alphaDeg: number;
  cells: (CompareCell | null)[];
}

/** The table of the chosen series: one row per angle that any of them has, one column per series, the differences from the reference series. */
export function compareTable(series: Series[], metric: Metric, referenceKey: string | null): { angles: number[]; rows: CompareRow[]; reference: string | null } {
  const angles = [...new Set(series.flatMap((s) => s.points.map((p) => p.alphaDeg)))].sort((a, b) => a - b);
  const ref = series.find((s) => s.key === referenceKey) ?? series[0] ?? null;
  const at = (s: Series, a: number) => s.points.find((p) => p.alphaDeg === a);
  const rows = angles.map((a): CompareRow => {
    const rp = ref ? at(ref, a) : undefined;
    const rv = rp ? metricOf(rp, metric) : null;
    return {
      alphaDeg: a,
      cells: series.map((s) => {
        const p = at(s, a);
        const v = p ? metricOf(p, metric) : null;
        if (!p || !v) return null;
        if (s === ref || !rv) return { value: v, delta: null, clear: null, integrity: p.integrity };
        const mean = v.mean - rv.mean;
        const se = Math.hypot(Number.isFinite(v.se) ? v.se : Number.NaN, Number.isFinite(rv.se) ? rv.se : Number.NaN);
        return { value: v, delta: { mean, se }, clear: Number.isFinite(se) ? Math.abs(mean) > 2 * se : null, integrity: p.integrity };
      }),
    };
  });
  return { angles, rows, reference: ref ? ref.key : null };
}

/** The highest value of a series among its angles (a point at the end of the angles run may not be the true maximum). */
export function highestPoint(s: Series, m: Metric): SeriesPoint | null {
  let top: SeriesPoint | null = null;
  for (const p of s.points) {
    const v = metricOf(p, m);
    if (!v || p.integrity === 'FAILED') continue;
    if (!top || v.mean > metricOf(top, m)!.mean) top = p;
  }
  return top;
}

/** Where the studies were not run under the same conditions, in words (empty when they match). */
export function conditionsDiffer(studies: SavedStudy[]): string[] {
  const out: string[] = [];
  if (studies.length < 2) return out;
  const a = studies[0];
  const reDiff = studies.some((s) => Math.abs(s.conditions.reynolds - a.conditions.reynolds) > 0.01 * a.conditions.reynolds);
  const cellDiff = studies.some((s) => s.conditions.cells !== a.conditions.cells);
  const engDiff = studies.some((s) => s.conditions.engine !== a.conditions.engine);
  const list = (f: (s: SavedStudy) => string) => studies.map((s) => `“${s.name}” ${f(s)}`).join('; ');
  if (reDiff) out.push(`the Reynolds numbers differ (${list((s) => `Re ${Math.round(s.conditions.reynolds)}`)}): coefficients at different Reynolds numbers are not like for like`);
  if (cellDiff) out.push(`the resolutions differ (${list((s) => `${s.conditions.cells} cells`)}): a finer lattice resolves thinner noses and boundary layers, so a difference may be the resolution`);
  if (engDiff) out.push(`the engines differ (${list((s) => s.conditions.engine)}): the graphics card computes in 32-bit and the CPU in 64-bit numbers, a small difference`);
  return out;
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const f = (v: number | null | undefined, d: number) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d));

/** The comparison as CSV: one row per series and angle. */
export function compareCsv(series: Series[], studies: SavedStudy[]): string {
  const cond = new Map(studies.map((s) => [s.id, s.conditions]));
  const head = 'study,section,dimples,alpha_deg,lift_coeff,lift_se,drag_coeff,drag_se,lift_over_drag,ld_se,integrity,reynolds,cells,engine';
  const lines = [head];
  for (const s of series) {
    const c = cond.get(s.studyId);
    for (const p of s.points) lines.push([q(s.studyName), q(s.baseName), q(s.dimples ?? ''), p.alphaDeg, f(p.lift.mean, 5), f(p.lift.se, 5), f(p.drag.mean, 5), f(p.drag.se, 5), f(p.ld?.mean, 3), f(p.ld?.se, 3), p.integrity, c ? Math.round(c.reynolds) : '', c ? c.cells : '', q(c ? c.engine : '')].join(','));
  }
  return lines.join('\n');
}

// ---- saving to and from text (the browser's storage, a file)

export function serializeStudies(list: SavedStudy[]): string {
  return JSON.stringify({ format: 'pfad-saved-studies/1', studies: list }, null, 1);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isEst = (v: unknown): v is Est => !!v && typeof v === 'object' && isNum((v as Est).mean) && typeof (v as Est).se === 'number' && isNum((v as Est).n);

function validRow(r: unknown): r is StudyRow {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.name === 'string' && isNum(o.alphaDeg) && isEst(o.lift) && isEst(o.drag) && (o.ld === null || isEst(o.ld)) && isNum(o.reynolds) && isNum(o.cells) && ['PASSED', 'WARNING', 'FAILED'].includes(o.integrity as string) && typeof o.engine === 'string';
}

export function validStudy(s: unknown): s is SavedStudy {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  const c = o.conditions as Record<string, unknown> | undefined;
  return o.format === 'pfad-saved-study/1' && typeof o.id === 'string' && typeof o.name === 'string' && typeof o.savedAt === 'string' && !!c && isNum(c.reynolds) && isNum(c.cells) && typeof c.engine === 'string' && Array.isArray(o.rows) && o.rows.length > 0 && o.rows.length <= 2000 && o.rows.every(validRow);
}

/** Saved studies from text (a stored list or a file): the valid ones, and what was skipped. */
export function parseStudies(text: string): { studies: SavedStudy[]; skipped: number; error: string | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { studies: [], skipped: 0, error: 'the text is not a list of saved studies (it is not JSON)' };
  }
  const list = (data as { studies?: unknown })?.studies;
  if (!Array.isArray(list)) return { studies: [], skipped: 0, error: 'the text is not a list of saved studies (no “studies” list)' };
  const studies = list.filter(validStudy).slice(0, 200);
  return { studies, skipped: list.length - studies.length, error: null };
}

/** The studies of an import added to those already saved: a study with an id already present is not added twice; a name already present gets (2). */
export function mergeStudies(have: SavedStudy[], incoming: SavedStudy[]): SavedStudy[] {
  const out = have.slice();
  for (const s of incoming) {
    if (out.some((x) => x.id === s.id)) continue;
    out.push({ ...s, name: uniqueName(s.name, out.map((x) => x.name)) });
  }
  return out;
}
