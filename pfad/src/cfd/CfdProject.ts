import type { PlateShape, PointerMove } from '../geometry/History';
import { addPointerPoint, fromBodyX, pointerOf, plateGeometry, radiusOf, toBodyX, type PointerLimits, type PointerStep, type Pt, DEFAULT_POINTER_LIMITS } from '../geometry/Pointer';
import type { Side, SurfaceGeometry } from '../geometry/SurfaceGeometry';
import type { PhysicalInputs } from '../experiments/FlowGeometryExperiment';
import type { CfdParams, CfdResult } from './CfdRun';

/**
 * The history of a CFD construction: an append-only record of versions of the rounded plate (each the plate plus the curve
 * the pointer has drawn so far), the CFD run of each, and what moved the pointer. Nothing is deleted: undo moves the head back
 * to the parent and marks the undone version. Pure functions: every change returns a new project.
 */
export type CfdPreset = 'quick' | 'standard' | 'fine';

export interface CfdConditions {
  /** the plain inputs this project was set up from */
  scenario: PhysicalInputs;
  preset: CfdPreset;
  /** the parameters of every run except the geometry (resolution, Reynolds number, domain, windows) */
  params: Omit<CfdParams, 'geometry'>;
  /** the Reynolds number of the plate in the described air, before the resolution's limit (provenance) */
  realReynolds: number;
}

export interface CfdRunSummary {
  result: CfdResult;
  finishedAt: string;
  activeMs: number;
  codeVersion: string;
}

export interface CfdVersion {
  id: string;
  parent: string | null;
  origin: 'initial' | 'constructed';
  label: string;
  createdAt: string;
  geometry: SurfaceGeometry;
  shape: PlateShape;
  /** the pointer move that made this version (absent for the starting plate) */
  move?: PointerMove & { step: number; reason: string; hypothesis: string };
  run: CfdRunSummary | null;
  undone: { at: string } | null;
}

export interface CfdLogEvent {
  t: string;
  type: 'created' | 'pointer-moved' | 'run-finished' | 'run-stopped' | 'run-failed' | 'undone' | 'conditions-changed';
  version?: string;
  detail: string;
}

export interface CfdProject {
  format: 'pfad-cfd-geometry/1';
  id: string;
  name: string;
  createdAt: string;
  conditions: CfdConditions;
  versions: CfdVersion[];
  head: string;
  log: CfdLogEvent[];
  wingDepthCm?: number;
}

const now = () => new Date().toISOString();

export function newCfdProject(name: string, conditions: CfdConditions, shape: PlateShape, at = now()): CfdProject {
  return {
    format: 'pfad-cfd-geometry/1',
    id: `cfd-${at.replace(/[:.]/g, '-')}`,
    name,
    createdAt: at,
    conditions,
    versions: [{ id: 'v0', parent: null, origin: 'initial', label: 'rounded plate (round leading and trailing ends)', createdAt: at, geometry: plateGeometry(shape.plate, shape.paths, shape.spacing), shape, run: null, undone: null }],
    head: 'v0',
    log: [{ t: at, type: 'created', version: 'v0', detail: 'project created with the rounded plate' }],
  };
}

export const cfdVersion = (p: CfdProject, id: string): CfdVersion => {
  const v = p.versions.find((x) => x.id === id);
  if (!v) throw new Error(`no version ${id}`);
  return v;
};
export const cfdHead = (p: CfdProject) => cfdVersion(p, p.head);

export function cfdActivePath(p: CfdProject): CfdVersion[] {
  const out: CfdVersion[] = [];
  let v: CfdVersion | null = cfdHead(p);
  while (v) {
    out.unshift(v);
    v = v.parent ? cfdVersion(p, v.parent) : null;
  }
  return out;
}

export type CfdDecision = { kind: 'hand' } | { kind: 'measurement'; step: PointerStep; versionId: string; summary: string };

/** Move the pointer of the head version: a new version, with no run yet. Throws with the reason if the move is not allowed. */
export function addCfdPointerMove(p: CfdProject, req: { side: Side; to: Pt; limits?: PointerLimits; decision: CfdDecision }, at = now()): { project: CfdProject; version: CfdVersion } {
  const parent = cfdHead(p);
  const limits = req.limits ?? DEFAULT_POINTER_LIMITS;
  const sh = parent.shape;
  const r = radiusOf(sh.plate);
  const from = pointerOf(sh.paths, req.side);
  const added = addPointerPoint(sh.plate, sh.paths, req.side, req.to, limits);
  if (!added.ok) throw new Error(added.reason);
  const geometry = plateGeometry(sh.plate, added.paths, sh.spacing);
  const step = p.versions.filter((v) => v.origin === 'constructed').length + 1;
  const id = `v${p.versions.length}`;
  const side = req.side;
  const where = `x = ${req.to.x.toFixed(1)} d, ${(req.to.y - r).toFixed(2)} d above the plate`;
  const bodyFrom = toBodyX(sh.plate, from.x);
  const bodyTo = toBodyX(sh.plate, req.to.x);
  const summary = req.decision.kind === 'measurement' ? `${req.decision.summary} ${req.decision.step.note}.` : 'Placed by hand (no measurement decided this).';
  const v: CfdVersion = {
    id,
    parent: parent.id,
    origin: 'constructed',
    label: `step ${step}: pointer on the ${side} side to ${where}`,
    createdAt: at,
    geometry,
    shape: { plate: sh.plate, paths: added.paths, spacing: sh.spacing },
    move: {
      side,
      from,
      to: { x: req.to.x, y: Math.max(r, req.to.y) },
      decided: req.decision.kind,
      ...(req.decision.kind === 'measurement' ? { measured: { surface: req.decision.step.surface, gap: req.decision.step.gap, rise: req.decision.step.rise, note: req.decision.step.note, recordId: null, versionId: req.decision.versionId, seeds: [] } } : {}),
      limits,
      step,
      reason: `The pointer moved from x = ${from.x.toFixed(1)} d to ${where} on the ${side} side. The drawn curve passes through every pointer position so far and meets the tether (the straight line from the pointer to the top of the trailing-edge circle) without a corner. ${summary} The anchor is a construction constraint, not a flow law.`,
      hypothesis: `Drawing the surface out to the pointer and closing the rest of the way to the trailing edge with the straight tether should leave a thinner region of reversed flow beside the ${side} surface over x = ${bodyFrom.toFixed(1)}–${bodyTo.toFixed(1)} d. Untested: the next simulation decides, and the flow may simply separate further on.`,
    },
    run: null,
    undone: null,
  };
  return { version: v, project: { ...p, versions: [...p.versions, v], head: id, log: [...p.log, { t: at, type: 'pointer-moved', version: id, detail: `pointer on the ${side} side moved to ${where} (${req.decision.kind === 'measurement' ? 'decided by the measurement' : 'by hand'})` }] } };
}

export function attachCfdRun(p: CfdProject, versionId: string, run: CfdRunSummary, at = now()): CfdProject {
  cfdVersion(p, versionId);
  return { ...p, versions: p.versions.map((v) => (v.id === versionId ? { ...v, run } : v)), log: [...p.log, { t: at, type: 'run-finished', version: versionId, detail: `CFD run finished: ${run.result.integrity.status}` }] };
}

export function logCfdEnd(p: CfdProject, versionId: string, kind: 'stopped' | 'failed', detail: string, at = now()): CfdProject {
  return { ...p, log: [...p.log, { t: at, type: kind === 'stopped' ? 'run-stopped' : 'run-failed', version: versionId, detail }] };
}

export function undoCfd(p: CfdProject, at = now()): CfdProject {
  const h = cfdHead(p);
  if (h.origin !== 'constructed' || !h.parent) throw new Error('nothing to undo: the head is the starting plate');
  return { ...p, head: h.parent, versions: p.versions.map((v) => (v.id === h.id ? { ...v, undone: { at } } : v)), log: [...p.log, { t: at, type: 'undone', version: h.id, detail: `${h.label} undone; the head is ${h.parent}` }] };
}

export function setCfdWingDepth(p: CfdProject, cm: number): CfdProject {
  return { ...p, wingDepthCm: cm };
}

export function cfdProjectToJSON(p: CfdProject): string {
  return JSON.stringify(p);
}

export function parseCfdProject(text: string): CfdProject {
  const raw = JSON.parse(text) as CfdProject;
  if (!raw || raw.format !== 'pfad-cfd-geometry/1' || !Array.isArray(raw.versions) || !raw.head) throw new Error('not a PFAD CFD geometry project');
  const ids = new Set(raw.versions.map((v) => v.id));
  if (!ids.has(raw.head)) throw new Error('the head version is missing from the project');
  for (const v of raw.versions) if (v.parent && !ids.has(v.parent)) throw new Error(`version ${v.id} has a missing parent`);
  return raw;
}

export { fromBodyX };
