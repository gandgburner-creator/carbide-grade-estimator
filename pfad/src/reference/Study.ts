import type { CfdResult, Est } from '../cfd/CfdRun';
import type { SurfaceGeometry } from '../geometry/SurfaceGeometry';
import type { DimpleRecord } from './Dimples';

/**
 * AN AIRFOIL STUDY: a table of what the CFD computes for several bodies at several angles of attack, each one an ordinary run of the
 * workspace (the same lattice, the same Reynolds number, the same measurements) one after the other. For every body and angle it reports
 * the lift and drag coefficients and their ratio L/D, with the uncertainty of the run. Nothing is ranked or chosen for the person: the
 * table shows what was computed, marks the highest L/D it contains, and says in words that this is the ordering of THESE runs (a
 * two-dimensional flow at the run's Reynolds number), not of the sections in general.
 */
export interface StudyJob {
  /** a stable id of the body and angle */
  id: string;
  name: string;
  alphaDeg: number;
  geometry: SurfaceGeometry;
  /** the body's maximum thickness and nose radius as fractions of the chord, for the resolution advisory */
  thickness: number;
  noseRadius: number;
  /** the section the body was made from (its id and name), and the dimples pressed into it, if any */
  baseId: string;
  baseName: string;
  dimples: DimpleRecord | null;
}

export interface StudyRow {
  jobId: string;
  name: string;
  alphaDeg: number;
  lift: Est;
  drag: Est;
  /** L/D, the ratio of the two coefficients' means, with its standard error by the delta method; null when the drag is not positive */
  ld: Est | null;
  reynolds: number;
  cells: number;
  integrity: 'PASSED' | 'WARNING' | 'FAILED';
  engine: string;
  /** where the mean flow beside the upper surface separates (body-frame x in plate units), when it does */
  separationX: number | null;
  /** thickness and nose radius in lattice cells at this resolution */
  thicknessCells: number;
  noseCells: number;
  /** the section without its dimples, and the dimples (absent in a study saved before dimples existed) */
  baseName?: string;
  dimples?: DimpleRecord | null;
}

/** The ratio of two estimates with the standard error of the ratio by the delta method (their errors taken as independent: the lift and the drag come from the same blocks, so this is a cautious rather than a tight figure). */
export function ratio(a: Est, b: Est): Est | null {
  if (!Number.isFinite(a.mean) || !Number.isFinite(b.mean) || !(b.mean > 0)) return null;
  const r = a.mean / b.mean;
  const se = Math.abs(r) * Math.hypot(a.se / (a.mean || 1e-12), b.se / b.mean);
  return { mean: r, se: Number.isFinite(se) ? se : Number.NaN, n: Math.min(a.n, b.n) };
}

export function rowOf(job: StudyJob, r: CfdResult): StudyRow {
  const lift = r.forces.liftCoeff;
  const drag = r.forces.dragCoeff;
  const cells = r.params.cells;
  return {
    jobId: job.id,
    name: job.name,
    alphaDeg: job.alphaDeg,
    lift,
    drag,
    ld: ratio(lift, drag),
    reynolds: r.params.reynolds,
    cells,
    integrity: r.integrity.status,
    engine: r.engine ? `${r.engine.kind === 'gpu' ? 'GPU' : 'CPU'} (${r.engine.precision === 'float32' ? '32' : '64'}-bit)` : 'CPU',
    separationX: r.separation.upper.x,
    thicknessCells: job.thickness * cells,
    noseCells: job.noseRadius * cells,
    baseName: job.baseName,
    dimples: job.dimples,
  };
}

/** The angles typed as a list ("0, 4, 8, 12" or "0 2 4"): between −20° and 40°, at most 14 of them. */
export function parseAngles(text: string): { ok: true; angles: number[] } | { ok: false; error: string } {
  const parts = text.split(/[\s,;]+/).filter((s) => s.length > 0);
  if (!parts.length) return { ok: false, error: 'enter at least one angle of attack in degrees, for example 0, 4, 8, 12' };
  const angles: number[] = [];
  for (const s of parts) {
    const v = Number(s);
    if (!Number.isFinite(v)) return { ok: false, error: `“${s}” is not a number` };
    if (v < -20 || v > 40) return { ok: false, error: `the angle ${v}° is outside −20° … 40°` };
    if (!angles.includes(v)) angles.push(v);
  }
  if (angles.length > 14) return { ok: false, error: 'at most 14 angles at a time' };
  return { ok: true, angles: angles.sort((a, b) => a - b) };
}

export interface StudyBody {
  id: string;
  name: string;
  geometry: SurfaceGeometry;
  thickness: number;
  noseRadius: number;
  /** the section this body was made from, when it is not the section itself (a dimpled version) */
  baseId?: string;
  baseName?: string;
  dimples?: DimpleRecord | null;
}

export function jobsFor(bodies: StudyBody[], angles: number[]): StudyJob[] {
  const out: StudyJob[] = [];
  for (const b of bodies) for (const a of angles) out.push({ id: `${b.id}@${a}`, name: b.name, alphaDeg: a, geometry: b.geometry, thickness: b.thickness, noseRadius: b.noseRadius, baseId: b.baseId ?? b.id, baseName: b.baseName ?? b.name, dimples: b.dimples ?? null });
  return out;
}

/** For every body, the row with the highest L/D among the angles that were run (rows whose run failed, or whose drag was not positive, do not count). */
export function highestLd(rows: StudyRow[]): StudyRow[] {
  const leader = new Map<string, StudyRow>();
  for (const r of rows) {
    if (!r.ld || r.integrity === 'FAILED') continue;
    const cur = leader.get(r.name);
    if (!cur || r.ld.mean > cur.ld!.mean) leader.set(r.name, r);
  }
  return [...leader.values()].sort((a, b) => b.ld!.mean - a.ld!.mean);
}

/** The table as CSV text (comma separated, one row per body and angle). */
export function studyCsv(rows: StudyRow[]): string {
  const head = 'body,alpha_deg,lift_coeff,lift_se,drag_coeff,drag_se,lift_over_drag,ld_se,reynolds,cells_along_chord,integrity,engine,separation_x_upper,thickness_cells,nose_radius_cells,section,dimples';
  const f = (v: number | null | undefined, d = 5) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d));
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [head, ...rows.map((r) => [q(r.name), r.alphaDeg, f(r.lift.mean), f(r.lift.se), f(r.drag.mean), f(r.drag.se), f(r.ld?.mean, 3), f(r.ld?.se, 3), Math.round(r.reynolds), r.cells, r.integrity, q(r.engine), f(r.separationX, 2), f(r.thicknessCells, 2), f(r.noseCells, 2), q(r.baseName ?? r.name), q(r.dimples ? r.dimples.label : '')].join(','))].join('\n');
}

/** What the lattice can and cannot resolve of a body at a resolution, in words (empty when nothing needs saying). */
export function resolutionAdvice(thickness: number, noseRadius: number, cells: number): string[] {
  const out: string[] = [];
  const t = thickness * cells;
  const r = noseRadius * cells;
  if (t < 3.2) out.push(`the section is only ${t.toFixed(1)} lattice cells thick at ${cells} cells along the chord: its thickness is not resolved`);
  if (r < 1.5) out.push(`the nose radius is ${r.toFixed(2)} cells: a nose this sharp is not resolved by the lattice, and the flow around it (where the stagnation point and the first suction lie) is only roughly right; ${Math.ceil(1.5 / Math.max(noseRadius, 1e-6) / 16) * 16} cells along the chord resolve it to 1.5 cells`);
  return out;
}
