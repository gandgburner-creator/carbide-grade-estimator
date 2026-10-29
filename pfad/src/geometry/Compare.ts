import type { Est, StationRow } from '../measurements/SeparationDetector';
import { WAKE_SPEC, type WakeAnalysis } from '../measurements/WakeVoid';
import type { GeometryVersion, RunSummary } from './History';
import type { Side } from './SurfaceGeometry';

/**
 * Comparison of two simulated geometry versions (A = earlier, B = later).
 *
 * Descriptive, not a hypothesis test in the preregistration sense: a difference is B − A with
 * se = √(se_A² + se_B²) for independent runs (runs that share seeds are positively correlated, so
 * this is conservative), and z = difference / se is a scale. Region means add station standard
 * errors LINEARLY (the fully correlated upper bound), because neighbouring stations are not
 * independent.
 *
 * There is NO composite score and no declared "better": each indicator is reported with its sign
 * convention, and the only judgement made is on the single prediction the construction step
 * stated in advance (its hypothesis). Where an increment improves one measured quantity and
 * worsens another, both are listed.
 */
export const Z_SCALE = 2;

export interface Delta {
  id: string;
  label: string;
  unit: string;
  /** what a larger value means (a convention for reading the sign, not a judgement) */
  convention: string;
  a: number;
  seA: number;
  b: number;
  seB: number;
  diff: number;
  se: number;
  z: number | null;
  change: 'increased' | 'decreased' | 'unresolved';
}

const delta = (id: string, label: string, unit: string, convention: string, a: { mean: number; se: number }, b: { mean: number; se: number }): Delta => {
  const diff = b.mean - a.mean;
  const se = Math.hypot(a.se, b.se);
  const z = Number.isFinite(se) && se > 0 ? diff / se : null;
  return { id, label, unit, convention, a: a.mean, seA: a.se, b: b.mean, seB: b.se, diff, se, z, change: z === null || Math.abs(z) < Z_SCALE ? 'unresolved' : diff > 0 ? 'increased' : 'decreased' };
};

/** Length-weighted mean of a station quantity over stations whose centre lies in [xLo, xHi]; SE added linearly. */
export function regionMean(stations: StationRow[], pick: (s: StationRow) => Est, xLo: number, xHi: number): { mean: number; se: number; stations: number } {
  const sel = stations.filter((s) => s.x >= xLo - 1e-9 && s.x <= xHi + 1e-9);
  const L = sel.reduce((a, s) => a + s.length, 0);
  if (!sel.length || !(L > 0)) return { mean: Number.NaN, se: Number.NaN, stations: 0 };
  const mean = sel.reduce((a, s) => a + pick(s).mean * s.length, 0) / L;
  const se = sel.reduce((a, s) => a + pick(s).se * s.length, 0) / L;
  return { mean, se, stations: sel.length };
}


/** Mean contact-layer density (relative to the free stream) of the stations of a wake analysis whose centre lies in [xLo, xHi]; SE added linearly. */
export function wakeContactMean(w: WakeAnalysis, xLo: number, xHi: number): { mean: number; se: number; stations: number } {
  const sel = w.stations.filter((s) => s.known && s.x >= xLo - 1e-9 && s.x <= xHi + 1e-9);
  if (!sel.length) return { mean: Number.NaN, se: Number.NaN, stations: 0 };
  return { mean: sel.reduce((a, s) => a + s.contact.mean, 0) / sel.length, se: sel.reduce((a, s) => a + s.contact.se, 0) / sel.length, stations: sel.length };
}

export interface StationDelta {
  x: number;
  u1: Delta;
  qw: Delta;
  tau: Delta;
  pressure: Delta;
}

export interface Comparison {
  a: string;
  b: string;
  /** differences in flow conditions between the two runs (must be empty for a clean comparison) */
  conditionChanges: string[];
  sharedSeeds: number[];
  integrity: { a: RunSummary['integrity']; b: RunSummary['integrity'] };
  sides: Record<Side, { levelA: string; levelB: string; regionA: [number, number] | null; regionB: [number, number] | null; stations: StationDelta[] }>;
  /** tracked scalar indicators with their sign conventions */
  indicators: Delta[];
  /** the one prediction the construction step stated, and what the measurement says about it */
  hypothesis: { stated: string; side: Side; xLo: number; xHi: number; outcome: 'supported' | 'contradicted' | 'unresolved' | 'not applicable'; detail: string; delta: Delta | null } | null;
  notes: string[];
}

function conditionDiffs(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'geometry' || k === 'seeds') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  }
  return out;
}

export function compareVersions(va: GeometryVersion, vb: GeometryVersion): Comparison {
  const ra = va.run;
  const rb = vb.run;
  if (!ra || !rb) throw new Error('both versions need a finished run to be compared');
  const notes: string[] = [];
  const conditionChanges = conditionDiffs(ra.conditions, rb.conditions);
  if (conditionChanges.length) notes.push('The flow conditions differ between the two runs: a difference below may come from them, not from the geometry.');
  const sharedSeeds = ra.seeds.filter((s) => rb.seeds.includes(s));
  if (sharedSeeds.length === 0) notes.push('The runs use different seeds: the comparison holds the flow conditions fixed but not the random initial states.');
  if (ra.codeVersion !== rb.codeVersion || ra.modelVersion !== rb.modelVersion) notes.push(`The runs come from different code or model versions (${ra.codeVersion.slice(0, 8)}/${ra.modelVersion} vs ${rb.codeVersion.slice(0, 8)}/${rb.modelVersion}).`);
  if (ra.integrity.status !== 'PASSED' || rb.integrity.status !== 'PASSED') notes.push('At least one run failed its numerical-integrity checks: its measurements are not reliable.');

  const sides = {} as Comparison['sides'];
  for (const side of ['upper', 'lower'] as const) {
    const A = ra.analysis[side];
    const B = rb.analysis[side];
    const stations: StationDelta[] = [];
    A.primary.stations.forEach((sa, i) => {
      const sb = B.primary.stations[i];
      if (!sb || Math.abs(sb.x - sa.x) > 1e-6) return;
      stations.push({
        x: sa.x,
        u1: delta('u1', 'near-wall velocity u1', 'd/τ', 'larger = faster forward flow at the wall', sa.u1, sb.u1),
        qw: delta('qw', 'net near-wall flux Q_w', 'm/(d·τ)', 'larger = less backflow', sa.qw, sb.qw),
        tau: delta('tau', 'downstream wall shear', 'kT₀/d²', 'larger = more forward drag on the wall', sa.tau, sb.tau),
        pressure: delta('pressure', 'wall pressure', 'kT₀/d²', 'larger = more normal impulse into the body', sa.pressure, sb.pressure),
      });
    });
    sides[side] = {
      levelA: A.level,
      levelB: B.level,
      regionA: A.region ? [A.region.xLo, A.region.xHi] : null,
      regionB: B.region ? [B.region.xLo, B.region.xHi] : null,
      stations,
    };
  }

  const indicators: Delta[] = [
    delta('fx', 'drag: force on the body along the stream (per unit depth)', 'm·d/τ²', 'larger = more force along the stream (downstream); the measured momentum-transfer rate', ra.forces.fx, rb.forces.fx),
    delta('fy', 'lift: force on the body across the stream (per unit depth)', 'm·d/τ²', 'larger = more force toward +y (upward, for a nose-up body); the measured momentum-transfer rate', ra.forces.fy, rb.forces.fy),
  ];
  for (const side of ['upper', 'lower'] as const) {
    const sa = ra.analysis[side].primary.stations;
    const sb = rb.analysis[side].primary.stations;
    const all = [sa[0]?.xLo ?? 0, sa[sa.length - 1]?.xHi ?? 0] as const;
    const qa = regionMean(sa, (s) => s.qw, all[0], all[1]);
    const qb = regionMean(sb, (s) => s.qw, all[0], all[1]);
    indicators.push(delta(`qw-${side}`, `mean near-wall flux Q_w over the whole ${side} side`, 'm/(d·τ)', 'larger = less backflow', qa, qb));
  }

  // do the particles touch the surface? (only when both runs measured it)
  if (ra.wake && rb.wake) {
    for (const side of ['upper', 'lower'] as const) {
      const all = [0, ra.wake[side].stations[ra.wake[side].stations.length - 1]?.x ?? 0] as const;
      indicators.push(delta(`contact-${side}`, `mean contact-layer density over the whole ${side} side (relative to the free stream)`, '× free stream', 'larger = the particles touch the surface more', wakeContactMean(ra.wake[side], all[0], all[1]), wakeContactMean(rb.wake[side], all[0], all[1])));
    }
  }

  // the one stated prediction: backflow over the treated stretch is reduced
  let hypothesis: Comparison['hypothesis'] = null;
  const c = vb.construction;
  if (c && (c.mode === 'live-fill' || c.mode === 'pointer')) {
    const { xLo, xHi } = c.basis.region;
    if (!ra.wake || !rb.wake) {
      hypothesis = { stated: c.hypothesis, side: c.side, xLo, xHi, outcome: 'not applicable', detail: 'One of the two runs has no wake-void measurement (it was made before that measure existed): simulate both again to test the prediction.', delta: null };
    } else {
      const ma = wakeContactMean(ra.wake[c.side], xLo, xHi);
      const mb = wakeContactMean(rb.wake[c.side], xLo, xHi);
      const d = delta('contact-treated', `mean contact-layer density over the treated stretch (${c.side}, x = ${xLo.toFixed(1)}–${xHi.toFixed(1)} d)`, '× free stream', 'larger = the particles touch the surface more', ma, mb);
      let outcome: NonNullable<Comparison['hypothesis']>['outcome'];
      let detail: string;
      if (!(ma.mean < WAKE_SPEC.wetThreshold)) {
        outcome = 'not applicable';
        detail = `The particles already touched the old surface over this stretch (contact-layer density ${ma.mean.toFixed(2)} of the free stream, not below ${WAKE_SPEC.wetThreshold}), so there was no void to close.`;
      } else if (d.z !== null && d.z >= Z_SCALE) {
        outcome = 'supported';
        detail = `The contact-layer density over the stretch rose from ${ma.mean.toFixed(2)} to ${mb.mean.toFixed(2)} of the free stream (z = ${d.z.toFixed(1)}): the particles touch the new surface more, as predicted. This does not show the shape is better, only that this prediction held in this run.`;
      } else if (d.z !== null && d.z <= -Z_SCALE) {
        outcome = 'contradicted';
        detail = `The contact-layer density over the stretch fell from ${ma.mean.toFixed(2)} to ${mb.mean.toFixed(2)} of the free stream (z = ${d.z.toFixed(1)}): the particles touch the new surface less, opposite to the prediction.`;
      } else {
        outcome = 'unresolved';
        detail = `The contact-layer density over the stretch went from ${ma.mean.toFixed(2)} to ${mb.mean.toFixed(2)} of the free stream (z = ${d.z === null ? 'n/a' : d.z.toFixed(1)}), within the noise at |z| < ${Z_SCALE}: neither supported nor contradicted at this statistical power.`;
      }
      hypothesis = { stated: c.hypothesis, side: c.side, xLo, xHi, outcome, detail, delta: d };
    }
  } else if (c) {
    const sa = ra.analysis[c.side].primary.stations;
    const sb = rb.analysis[c.side].primary.stations;
    const { xLo, xHi } = c.basis.region;
    const qa = regionMean(sa, (s) => s.qw, xLo, xHi);
    const qb = regionMean(sb, (s) => s.qw, xLo, xHi);
    const d = delta('qw-treated', `mean net near-wall flux Q_w over the treated stretch (${c.side}, x = ${xLo.toFixed(1)}–${xHi.toFixed(1)} d)`, 'm/(d·τ)', 'larger = less backflow', qa, qb);
    let outcome: NonNullable<Comparison['hypothesis']>['outcome'];
    let detail: string;
    if (!(qa.mean < 0)) {
      outcome = 'not applicable';
      detail = `There was no net backflow over this stretch in the earlier run (Q_w = ${qa.mean.toFixed(4)}), so there was nothing to reduce.`;
    } else if (d.z !== null && d.z >= Z_SCALE) {
      outcome = 'supported';
      detail = `Q_w over the stretch rose from ${qa.mean.toFixed(4)} to ${qb.mean.toFixed(4)} (z = ${d.z.toFixed(1)}): less backflow, as predicted. This does not show the geometry is better, only that this prediction held in this run.`;
    } else if (d.z !== null && d.z <= -Z_SCALE) {
      outcome = 'contradicted';
      detail = `Q_w over the stretch fell from ${qa.mean.toFixed(4)} to ${qb.mean.toFixed(4)} (z = ${d.z.toFixed(1)}): more backflow, opposite to the prediction.`;
    } else {
      outcome = 'unresolved';
      detail = `Q_w over the stretch went from ${qa.mean.toFixed(4)} to ${qb.mean.toFixed(4)} (z = ${d.z === null ? 'n/a' : d.z.toFixed(1)}), within the noise at |z| < ${Z_SCALE}: the prediction is neither supported nor contradicted at this statistical power.`;
    }
    hypothesis = { stated: c.hypothesis, side: c.side, xLo, xHi, outcome, detail, delta: d };
  }
  return { a: va.id, b: vb.id, conditionChanges, sharedSeeds, integrity: { a: ra.integrity, b: rb.integrity }, sides, indicators, hypothesis, notes };
}

export interface FieldGrid {
  nx: number;
  ny: number;
  cell: number;
  ux: number[];
  uy: number[];
  density: number[];
  kT: number[];
  occupancy: number[];
}

/** Cell-by-cell difference B − A of a field of two runs on the same grid. */
export function fieldDifference(a: FieldGrid, b: FieldGrid, name: 'ux' | 'uy' | 'density' | 'kT' | 'occupancy'): { nx: number; ny: number; values: number[]; rms: number; maxAbs: number } {
  if (a.nx !== b.nx || a.ny !== b.ny) throw new Error('the two runs use different field grids');
  const values = a[name].map((v, i) => b[name][i] - v);
  const rms = Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
  return { nx: a.nx, ny: a.ny, values, rms, maxAbs: values.reduce((m, v) => Math.max(m, Math.abs(v)), 0) };
}
