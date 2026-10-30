import type { SurfaceFlowAnalysis } from '../measurements/SeparationDetector';
import type { Est } from '../measurements/SeparationDetector';
import type { WakeAnalysis } from '../measurements/WakeVoid';
import type { LiveFillConfig, LiveStep, LiveStop } from './LiveFill';
import type { ValidationStatus } from '../validation/Status';
import { applyProposal, partialSurface, type PathPoint, type Proposal } from './Construction';
import type { PlateSpec, PointerLimits, PointerPaths, Pt } from './Pointer';
import { cloneGeometry, stationX, type Side, type SurfaceGeometry } from './SurfaceGeometry';

/**
 * The construction history: a project is an append-only record of geometry versions, the
 * proposals made against them, and what happened to each. Nothing is ever deleted: undoing an
 * increment moves the head back to the parent and marks the undone version, which stays in the
 * record. Every function here is pure (it returns a new project) so a history can be replayed,
 * exported and checked.
 */
export type Origin = 'initial' | 'constructed';

/** What a finished simulation of a version produced (compact; the full record is kept in the library). */
export interface RunSummary {
  recordId: string;
  experimentId: string;
  seeds: number[];
  finishedAt: string;
  activeMs: number | null;
  codeVersion: string;
  modelVersion: string;
  /** the flow conditions of the run (everything except the geometry) */
  conditions: Record<string, unknown>;
  integrity: { status: ValidationStatus; maxEnergyResidual: number; maxMomentumResidual: number; halted: number; insideDetections: number };
  analysis: Record<Side, SurfaceFlowAnalysis>;
  /** do the particles touch the surface? (WakeVoid.ts); absent in summaries made before it existed */
  wake?: Record<Side, WakeAnalysis>;
  forces: { fx: Est; fy: Est; moment: Est };
}

export interface ConstructionInfo {
  step: number;
  proposalId: string;
  side: Side;
  mode: Proposal['mode'];
  /** accepted points / all points of the proposal */
  acceptedPoints: number;
  totalPoints: number;
  partial: boolean;
  reason: string;
  hypothesis: string;
  basis: Proposal['basis'];
  config: Proposal['config'];
  scale: number;
  /** the accepted points, in construction order */
  points: PathPoint[];
  /** present when the increment is a move of the construction pointer (PointerVersion.ts) instead of a proposal */
  pointer?: PointerMove;
  /** present when the increment was grown live during a simulation (LiveFill.ts) instead of proposed and accepted */
  live?: { recordId: string; seed: number; stop: { kind: LiveStop; reason: string }; updates: number; config: LiveFillConfig; trajectory: LiveStep[] };
}

/** One placement of the construction pointer: where it was, where it went, and who or what decided. */
export interface PointerMove {
  side: Side;
  /** plate frame (origin at the centre of the leading circle), outward height */
  from: Pt;
  to: Pt;
  decided: 'hand' | 'measurement';
  /** for a measurement-guided move: the gap it responded to and the rise that followed (see planPointerStep) */
  measured?: { surface: number; gap: number; rise: number; note: string; recordId: string | null; versionId: string | null; seeds: number[] };
  limits: PointerLimits;
  /** the other things changed with this move: the green dot (null: put back) and the red dot (the last placed point re-placed, or its direction set) */
  edit?: { anchor?: Pt | null; red?: Pt };
}

/** The rounded plate and pointer paths a version's geometry was drawn from (present while the geometry is exactly that shape). */
export interface PlateShape {
  plate: PlateSpec;
  paths: PointerPaths;
  /** station spacing of the polygon [d] */
  spacing: number;
}

export interface GeometryVersion {
  id: string;
  parent: string | null;
  origin: Origin;
  label: string;
  createdAt: string;
  geometry: SurfaceGeometry;
  /** the rounded plate and pointer paths that produce `geometry`; absent for flat-plate projects and after a proposal/live-fill increment */
  shape?: PlateShape;
  construction?: ConstructionInfo;
  run: RunSummary | null;
  undone: { at: string } | null;
}

export interface ProposalEntry {
  id: string;
  parent: string;
  createdAt: string;
  status: 'proposed' | 'accepted' | 'rejected' | 'superseded';
  decidedAt?: string;
  note?: string;
  acceptedVersion?: string;
  proposal: Proposal;
}

/** An outline imported for comparison. It is never part of the construction path. */
export interface ReferenceGeometry {
  id: string;
  name: string;
  source: string;
  importedAt: string;
  geometry: SurfaceGeometry;
  /** always true: a reference was not constructed by PFAD */
  imported: true;
}

export interface HistoryEvent {
  t: string;
  type: 'created' | 'proposed' | 'rejected' | 'accepted' | 'undone' | 'run-finished' | 'run-stopped' | 'run-failed' | 'reference-added' | 'conditions-changed';
  version?: string;
  proposal?: string;
  detail: string;
}

export interface Project {
  format: 'pfad-flow-geometry/1';
  id: string;
  name: string;
  createdAt: string;
  /** flow conditions shared by every version (FlowGeometryParams without the geometry) */
  conditions: Record<string, unknown>;
  versions: GeometryVersion[];
  head: string;
  proposals: ProposalEntry[];
  references: ReferenceGeometry[];
  log: HistoryEvent[];
  /** wing depth [cm] used only to scale the 2-D forces to a wing of that depth (not part of the simulation) */
  wingDepthCm?: number;
}

const now = () => new Date().toISOString();

export function newProject(name: string, conditions: Record<string, unknown>, geometry: SurfaceGeometry, at = now(), shape?: PlateShape): Project {
  const what = shape ? 'rounded plate (round leading and trailing ends)' : 'flat starting geometry';
  return {
    format: 'pfad-flow-geometry/1',
    id: `fg-${at.replace(/[:.]/g, '-')}`,
    name,
    createdAt: at,
    conditions,
    versions: [{ id: 'v0', parent: null, origin: 'initial', label: what, createdAt: at, geometry: cloneGeometry(geometry), ...(shape ? { shape } : {}), run: null, undone: null }],
    head: 'v0',
    proposals: [],
    references: [],
    log: [{ t: at, type: 'created', version: 'v0', detail: `project created with the ${what}` }],
  };
}

export function version(p: Project, id: string): GeometryVersion {
  const v = p.versions.find((x) => x.id === id);
  if (!v) throw new Error(`no version ${id}`);
  return v;
}

export const headVersion = (p: Project) => version(p, p.head);

/** Versions from the root to the head, following parents (undone versions are not on it). */
export function activePath(p: Project): GeometryVersion[] {
  const out: GeometryVersion[] = [];
  let v: GeometryVersion | null = headVersion(p);
  while (v) {
    out.unshift(v);
    v = v.parent ? version(p, v.parent) : null;
  }
  return out;
}

/** Record a proposal against the head. Any earlier open proposal is superseded. */
export function recordProposal(p: Project, proposal: Proposal, at = now()): Project {
  const entry: ProposalEntry = { id: proposal.id, parent: p.head, createdAt: at, status: 'proposed', proposal };
  const proposals = p.proposals.map((e) => (e.status === 'proposed' ? { ...e, status: 'superseded' as const, decidedAt: at } : e));
  return {
    ...p,
    proposals: [...proposals, entry],
    log: [...p.log, { t: at, type: 'proposed', version: p.head, proposal: proposal.id, detail: `${proposal.mode} proposal on the ${proposal.side} side: ${proposal.points.length} points` }],
  };
}

export function rejectProposal(p: Project, id: string, note = '', at = now()): Project {
  const e = p.proposals.find((x) => x.id === id);
  if (!e || e.status !== 'proposed') throw new Error(`proposal ${id} is not open`);
  return {
    ...p,
    proposals: p.proposals.map((x) => (x.id === id ? { ...x, status: 'rejected', decidedAt: at, note } : x)),
    log: [...p.log, { t: at, type: 'rejected', version: p.head, proposal: id, detail: note || 'rejected' }],
  };
}

/** Accept an open proposal up to path point `upTo` (default: all). Creates a new version and moves the head. */
export function acceptProposal(p: Project, id: string, upTo?: number, note = '', at = now()): { project: Project; version: GeometryVersion } {
  const e = p.proposals.find((x) => x.id === id);
  if (!e || e.status !== 'proposed') throw new Error(`proposal ${id} is not open`);
  if (e.parent !== p.head) throw new Error('the proposal was made against a different version than the current head');
  const parent = headVersion(p);
  const prop = e.proposal;
  const k = upTo === undefined ? prop.points.length - 1 : upTo;
  const applied = applyProposal(parent.geometry, prop, k);
  if (applied.accepted === 0) throw new Error('nothing to accept: the increment is empty at this cut');
  const id2 = `v${p.versions.length}`;
  const step = p.versions.filter((v) => v.origin === 'constructed').length + 1;
  // accepted points: those of the proposal up to the cut, plus the eased tail if the cut is partial
  const accepted = acceptedPoints(parent.geometry, applied.geometry, prop);
  const v: GeometryVersion = {
    id: id2,
    parent: parent.id,
    origin: 'constructed',
    label: `step ${step}: ${prop.side} side, x = ${accepted[0]?.x.toFixed(1)}–${accepted[accepted.length - 1]?.x.toFixed(1)} d${prop.mode === 'exploratory' ? ' (exploratory)' : ''}`,
    createdAt: at,
    geometry: applied.geometry,
    construction: {
      step,
      proposalId: prop.id,
      side: prop.side,
      mode: prop.mode,
      acceptedPoints: applied.accepted,
      totalPoints: prop.points.length,
      partial: applied.accepted < prop.points.length,
      reason: prop.rationale,
      hypothesis: prop.hypothesis,
      basis: prop.basis,
      config: prop.config,
      scale: applied.scale,
      points: accepted,
    },
    run: null,
    undone: null,
  };
  return {
    version: v,
    project: {
      ...p,
      versions: [...p.versions, v],
      head: id2,
      proposals: p.proposals.map((x) => (x.id === id ? { ...x, status: 'accepted', decidedAt: at, acceptedVersion: id2, note } : x)),
      log: [...p.log, { t: at, type: 'accepted', version: id2, proposal: id, detail: `${applied.accepted} of ${prop.points.length} points accepted${note ? `: ${note}` : ''}` }],
    },
  };
}

/** The points that actually changed between two geometries, as path points (the accepted state of a possibly partial increment). */
function acceptedPoints(before: SurfaceGeometry, after: SurfaceGeometry, prop: Proposal): PathPoint[] {
  const y0 = prop.side === 'upper' ? before.upper : before.lower;
  const y1 = prop.side === 'upper' ? after.upper : after.lower;
  const xs = stationX(before);
  const byIndex = new Map(prop.points.map((q) => [q.index, q]));
  const out: PathPoint[] = [];
  for (let i = 0; i < y0.length; i++) {
    if (Math.abs(y1[i] - y0[i]) <= 1e-9) continue;
    const q = byIndex.get(i);
    const m = (y0[Math.min(y0.length - 1, i + 1)] - y0[Math.max(0, i - 1)]) / (xs[Math.min(y0.length - 1, i + 1)] - xs[Math.max(0, i - 1)]);
    out.push({
      index: i,
      x: xs[i],
      yOld: y0[i],
      yNew: y1[i],
      // the vertical shift is δ·√(1 + m²), so the normal height is the shift divided by that
      deltaNormal: Math.abs(y1[i] - y0[i]) / Math.sqrt(1 + m * m),
      measured: q?.measured ?? Number.NaN,
      measuredSE: q?.measuredSE ?? Number.NaN,
      weight: q?.weight ?? Number.NaN,
    });
  }
  return out;
}

/** Undo the last accepted increment: the head returns to its parent; the undone version stays in the record. */
export function undo(p: Project, at = now()): Project {
  const h = headVersion(p);
  if (h.origin !== 'constructed' || !h.parent) throw new Error('nothing to undo: the head is the starting geometry');
  return {
    ...p,
    head: h.parent,
    versions: p.versions.map((v) => (v.id === h.id ? { ...v, undone: { at } } : v)),
    // a proposal made against the undone version no longer has a parent to apply to
    proposals: p.proposals.map((e) => (e.status === 'proposed' ? { ...e, status: 'superseded' as const, decidedAt: at } : e)),
    log: [...p.log, { t: at, type: 'undone', version: h.id, detail: `${h.label} undone; the head is ${h.parent}` }],
  };
}

export function attachRun(p: Project, versionId: string, run: RunSummary, at = now()): Project {
  version(p, versionId);
  return {
    ...p,
    versions: p.versions.map((v) => (v.id === versionId ? { ...v, run } : v)),
    log: [...p.log, { t: at, type: 'run-finished', version: versionId, detail: `run of seeds ${run.seeds.join(', ')} recorded as ${run.recordId}` }],
  };
}

/** A simulation of a version that ended without a record (stopped or failed): kept in the log, with no result attached. */
export function logRunEnd(p: Project, versionId: string, kind: 'stopped' | 'failed', detail: string, at = now()): Project {
  return { ...p, log: [...p.log, { t: at, type: kind === 'stopped' ? 'run-stopped' : 'run-failed', version: versionId, detail }] };
}

/** A deliberate change of the flow conditions: recorded, because comparisons across it are not like for like. */
export function changeConditions(p: Project, conditions: Record<string, unknown>, reason: string, at = now()): Project {
  const keys = new Set([...Object.keys(p.conditions), ...Object.keys(conditions)]);
  const changed = [...keys].filter((k) => JSON.stringify(p.conditions[k]) !== JSON.stringify(conditions[k]));
  if (!changed.length) return p;
  return {
    ...p,
    conditions,
    log: [...p.log, { t: at, type: 'conditions-changed', version: p.head, detail: `${changed.map((k) => `${k}: ${JSON.stringify(p.conditions[k])} → ${JSON.stringify(conditions[k])}`).join('; ')}${reason ? ` — ${reason}` : ''}` }],
  };
}

export function addReference(p: Project, ref: Omit<ReferenceGeometry, 'imported' | 'id'>, at = now()): Project {
  const id = `ref${p.references.length + 1}`;
  return {
    ...p,
    references: [...p.references, { ...ref, id, imported: true }],
    log: [...p.log, { t: at, type: 'reference-added', detail: `imported reference outline "${ref.name}" from ${ref.source} (not constructed by PFAD)` }],
  };
}

/**
 * Replay frames of the active path: for every accepted increment, one frame per accepted point
 * with the surface as it stood when the construction point had reached it.
 */
export interface ReplayFrame {
  version: string;
  step: number;
  /** index of the construction point in the accepted points, or −1 for the state before the step */
  point: number;
  total: number;
  geometry: SurfaceGeometry;
  marker: { x: number; y: number; side: Side } | null;
  label: string;
}

export function replayFrames(p: Project): ReplayFrame[] {
  const path = activePath(p);
  const frames: ReplayFrame[] = [];
  const root = path[0];
  frames.push({ version: root.id, step: 0, point: -1, total: 0, geometry: cloneGeometry(root.geometry), marker: null, label: root.label });
  for (let i = 1; i < path.length; i++) {
    const v = path[i];
    const c = v.construction!;
    const parent = path[i - 1];
    frames.push({ version: v.id, step: c.step, point: -1, total: c.points.length, geometry: cloneGeometry(parent.geometry), marker: null, label: `step ${c.step}: before` });
    c.points.forEach((pt, k) => {
      frames.push({
        version: v.id,
        step: c.step,
        point: k,
        total: c.points.length,
        geometry: partialSurface(parent.geometry, c.side, c.points, k),
        marker: { x: pt.x, y: pt.yNew, side: c.side },
        label: `step ${c.step}: point ${k + 1} of ${c.points.length} at x = ${pt.x.toFixed(1)} d`,
      });
    });
  }
  return frames;
}

/** Plain-JSON export of a project (optionally with the full run records embedded). */
export function projectToJSON(p: Project, records: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...p, records }, null, 1);
}

/** The wing depth the forces are scaled to. It does not change any simulation, so it is not a flow condition and is not logged as one. */
export function setWingDepth(p: Project, cm: number): Project {
  return { ...p, wingDepthCm: cm };
}

export function parseProject(text: string): { project: Project; records: Record<string, unknown> } {
  const raw = JSON.parse(text) as Project & { records?: Record<string, unknown> };
  if (!raw || raw.format !== 'pfad-flow-geometry/1' || !Array.isArray(raw.versions) || !raw.head) throw new Error('not a PFAD flow-guided geometry project');
  const { records, ...project } = raw;
  const ids = new Set(project.versions.map((v) => v.id));
  if (!ids.has(project.head)) throw new Error('the head version is missing from the project');
  for (const v of project.versions) if (v.parent && !ids.has(v.parent)) throw new Error(`version ${v.id} has a missing parent`);
  return { project: project as Project, records: records ?? {} };
}
