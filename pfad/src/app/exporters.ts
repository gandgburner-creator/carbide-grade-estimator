import type { ExperimentRecord } from '../experiments/Experiment';
import type { ProfileData, TransferData } from '../workers/protocol';
import { FIELD_INFO, temporalLabel, UNITS_NOTE } from './fields';
import { flatten } from './flatten';
import type { Provenance } from './provenance';
import type { SeriesSnapshot } from './series';

/**
 * Export formats. Every CSV starts with "# key: value" provenance lines
 * (code and model version, seeds, units), then a header row. JSON exports of
 * records keep the ExperimentRecord format (so `npm run exp -- replay` still
 * reads them) and add a `labProvenance` field.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : Number.isNaN(v) ? 'NaN' : String(v);
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function header(p: Provenance, extra: Record<string, string | number> = {}): string {
  const lines: [string, string | number][] = [
    ['app', p.app],
    ['codeVersion', p.codeVersion],
    ['modelVersion', p.modelVersion],
    ['experimentType', p.experimentType],
    ['universe', p.universe],
    ['preset', p.preset],
    ['seeds', p.seeds.join(' ')],
    ['createdAt', p.createdAt],
    ['exportedAt', new Date().toISOString()],
    ['units', UNITS_NOTE],
    ...Object.entries(extra),
  ];
  return lines.map(([k, v]) => `# ${k}: ${String(v).replace(/\n/g, ' ')}`).join('\n');
}

function table(head: string[], rows: unknown[][]): string {
  return [head.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

export interface FieldExport {
  kind: keyof typeof FIELD_INFO;
  nx: number;
  ny: number;
  values: ArrayLike<number>;
  snapshots: number;
  particlesPerCell: number;
  t0: number;
  t1: number;
  note?: string;
  domain: { xmin: number; xmax: number; ymin: number; ymax: number };
}

/** One row per cell: cell centre and value. */
export function fieldCSV(f: FieldExport, p: Provenance): string {
  const info = FIELD_INFO[f.kind];
  const cw = (f.domain.xmax - f.domain.xmin) / f.nx;
  const ch = (f.domain.ymax - f.domain.ymin) / f.ny;
  const rows: unknown[][] = [];
  for (let cy = 0; cy < f.ny; cy++) {
    for (let cx = 0; cx < f.nx; cx++) {
      rows.push([cx, cy, f.domain.xmin + (cx + 0.5) * cw, f.domain.ymin + (cy + 0.5) * ch, f.values[cy * f.nx + cx]]);
    }
  }
  return `${header(p, {
    quantity: `${info.label} ${info.symbol}`,
    quantityUnits: info.units,
    origin: info.origin,
    definition: info.definition,
    averaging: temporalLabel(f.snapshots, f.t0, f.t1),
    grid: `${f.nx} x ${f.ny} cells of ${cw.toPrecision(4)} x ${ch.toPrecision(4)} d`,
    particlesPerCellPerSnapshot: f.particlesPerCell.toPrecision(4),
    ...(f.note ? { note: f.note } : {}),
  })}\n${table(['cx', 'cy', 'x [d]', 'y [d]', `${info.symbol} [${info.units}]`], rows)}\n`;
}

/** Live time series; units are given per column where known. */
export function seriesCSV(s: SeriesSnapshot, p: Provenance, units: Record<string, string> = {}): string {
  const keys = Object.keys(s.columns);
  const rows = s.t.map((t, i) => [t, ...keys.map((k) => s.columns[k][i])]);
  return `${header(p, { content: 'live values as displayed during the run (window values; the recorded estimates use block averaging and seed ensembles)' })}\n${table(
    ['t [τ]', ...keys.map((k) => (units[k] ? `${k} [${units[k]}]` : k))],
    rows,
  )}\n`;
}

export function profileCSV(pr: ProfileData, p: Provenance): string {
  const rows = pr.y.map((y, i) => [y, pr.numberDensity[i].mean, pr.numberDensity[i].se, pr.ux[i].mean, pr.ux[i].se, pr.uy[i].mean, pr.uy[i].se, pr.kT[i].mean, pr.kT[i].se]);
  return `${header(p, {
    content: 'cross-stream profile from particle data (measured, time-averaged)',
    window: `x in [${pr.x0}, ${pr.x1}) d; bins of ${pr.binWidth.toPrecision(4)} d`,
    snapshots: pr.snapshots,
    uncertainty: `SE from ${pr.batches} batch means (batch independence not checked)`,
  })}\n${table(['y - ymin [d]', 'n [1/d²]', 'n SE', 'u_x [√(kT₀/m)]', 'u_x SE', 'u_y [√(kT₀/m)]', 'u_y SE', 'kT [kT₀]', 'kT SE'], rows)}\n`;
}

export function transferCSV(tr: TransferData, p: Provenance): string {
  const rows: unknown[][] = [
    ...tr.walls.map((w) => ['wall', w.side, w.length, w.accommodation, w.hits, w.pressure, w.shear, '', '']),
    ...tr.bodies.map((b, i) => ['body', String(i), '', '', b.hits, '', '', b.fx, b.fy]),
  ];
  return `${header(p, {
    content: 'momentum transfer at walls and bodies (measured): P = Σ normal impulse / (Δt L), τ = Σ tangential impulse / (Δt L), F = Δ impulse / Δt',
    window: `t = ${tr.t0} … ${tr.t1} τ`,
  })}\n${table(['element', 'id', 'length [d]', 'accommodation', 'hits', 'P_wall [kT₀/d²]', 'τ_wall [kT₀/d²]', 'F_x [kT₀/d]', 'F_y [kT₀/d]'], rows)}\n`;
}

/**
 * The record's measured results, one row per scalar or estimate. Benchmarks are
 * NOT included (they are reference values, not measurements; they stay in the
 * JSON record).
 */
export function recordCSV(r: ExperimentRecord, p: Provenance): string {
  const rows = flatten(r.results).map((x) => [x.path, x.summarised ? `array(${x.value}) — see JSON` : x.value, x.se ?? '', x.ci95?.[0] ?? '', x.ci95?.[1] ?? '', x.n ?? '']);
  return `${header(p, {
    experimentId: r.experimentId,
    status: r.status,
    content: 'record.results: MEASURED quantities and quantities derived from them; benchmarks excluded',
  })}\n${table(['path', 'value', 'se', 'ci95 low', 'ci95 high', 'n'], rows)}\n`;
}

export function recordJSON(r: ExperimentRecord, p: Provenance): string {
  return JSON.stringify({ ...r, labProvenance: p }, null, 1);
}

export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}
