import type { PlateShape, PointerMove } from '../geometry/History';
import { describeCamber, withCamber, type CamberSpec } from '../geometry/Camber';
import { applyPointerEdit, baseHeight, validatePlate, describePointerEdit, fromBodyX, pointerOf, plateGeometry, toBodyX, type PointerEdit, type PointerLimits, type PointerStep, type Pt, DEFAULT_POINTER_LIMITS } from '../geometry/Pointer';
import type { Side, SurfaceGeometry } from '../geometry/SurfaceGeometry';
import type { PhysicalInputs } from '../experiments/FlowGeometryExperiment';
import type { CfdFillConfig, CfdFillMove, CfdFillResult, CfdFillStop } from './CfdFill';
import type { CFD_PRESETS, CfdParams, CfdResult } from './CfdRun';

/**
 * The history of a CFD construction: an append-only record of versions of the rounded plate (each the plate plus the curve
 * the pointer has drawn so far), the CFD run of each, and what moved the pointer. Nothing is deleted: undo moves the head back
 * to the parent and marks the undone version. Pure functions: every change returns a new project.
 */
export type CfdPreset = keyof typeof CFD_PRESETS;

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

/** How a version was drawn by an auto fill: the pointer moved by itself during one CFD run. */
export interface CfdFillInfo {
  side: Side;
  moves: CfdFillMove[];
  stop: { kind: CfdFillStop; reason: string };
  config: CfdFillConfig;
  /** convective times the fill ran for, and the largest lattice Mach number it saw */
  convective: number;
  maxMach: number;
  totalRise: number;
  reason: string;
  hypothesis: string;
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
  /** the auto fill that made this version (absent for the starting plate and for hand or measured pointer moves) */
  fill?: CfdFillInfo;
  run: CfdRunSummary | null;
  undone: { at: string } | null;
}

export interface CfdLogEvent {
  t: string;
  type: 'created' | 'pointer-moved' | 'auto-fill' | 'run-finished' | 'run-stopped' | 'run-failed' | 'undone' | 'conditions-changed';
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
export function addCfdPointerMove(p: CfdProject, req: { side: Side; to?: Pt; edit?: { anchor?: Pt | null; red?: Pt }; camber?: CamberSpec | null; limits?: PointerLimits; decision: CfdDecision }, at = now()): { project: CfdProject; version: CfdVersion } {
  const parent = cfdHead(p);
  const limits = req.limits ?? DEFAULT_POINTER_LIMITS;
  const sh = parent.shape;
  const from = pointerOf(sh.paths, req.side);
  const edit: PointerEdit = { ...(req.edit ?? {}), ...(req.to ? { to: req.to } : {}) };
  const camberChange = req.camber !== undefined;
  if (!edit.to && edit.anchor === undefined && !edit.red && !camberChange) throw new Error('nothing to change: place the pointer, or move the red or the green dot, set a direction, or change the camber');
  const plate = camberChange ? withCamber(sh.plate, req.camber) : sh.plate;
  if (camberChange) {
    const bad = validatePlate(plate);
    if (bad) throw new Error(bad);
  }
  const added = applyPointerEdit(plate, sh.paths, req.side, edit, limits);
  if (!added.ok) throw new Error(added.reason);
  const now0 = pointerOf(added.paths, req.side);
  const geometry = plateGeometry(plate, added.paths, sh.spacing);
  const camberText = camberChange ? describeCamber(req.camber, plate.length) : '';
  const step = p.versions.filter((v) => v.origin === 'constructed').length + 1;
  const id = `v${p.versions.length}`;
  const side = req.side;
  const where = (req.to ? `x = ${toBodyX(plate, req.to.x).toFixed(1)} d from the leading tip, ${(req.to.y - baseHeight(plate, req.to.x)).toFixed(2)} d above the plate` : describePointerEdit(plate, edit)) + (camberText ? `${req.to || describePointerEdit(plate, edit) ? '; ' : ''}${camberText}` : '');
  const bodyFrom = toBodyX(sh.plate, from.x);
  const bodyTo = toBodyX(sh.plate, now0.x);
  const summary = req.decision.kind === 'measurement' ? `${req.decision.summary} ${req.decision.step.note}.` : 'Placed by hand (no measurement decided this).';
  const v: CfdVersion = {
    id,
    parent: parent.id,
    origin: 'constructed',
    label: `step ${step}: ${req.to ? `pointer on the ${side} side to ${where}` : `${side} side: ${where}`}`,
    createdAt: at,
    geometry,
    shape: { plate, paths: added.paths, spacing: sh.spacing },
    move: {
      side,
      from,
      to: { x: now0.x, y: now0.y, ...(now0.angle !== undefined ? { angle: now0.angle } : {}) },
      decided: req.decision.kind,
      ...(req.decision.kind === 'measurement' ? { measured: { surface: req.decision.step.surface, gap: req.decision.step.gap, rise: req.decision.step.rise, note: req.decision.step.note, recordId: null, versionId: req.decision.versionId, seeds: [] } } : {}),
      limits,
      ...((req.edit && (req.edit.anchor !== undefined || req.edit.red)) || camberChange ? { edit: { ...(req.edit ?? {}), ...(camberChange ? { camber: req.camber } : {}) } } : {}),
      step,
      reason: `On the ${side} side${req.to ? `, the pointer moved from x = ${toBodyX(sh.plate, from.x).toFixed(1)} d to ${where}` : `: ${where}`}${req.to && describePointerEdit(sh.plate, { ...edit, to: undefined }) ? `; also ${describePointerEdit(sh.plate, { ...edit, to: undefined })}` : ''}. The drawn curve passes through every pointer position so far, with one direction at each, and meets the tether (the straight rope from the pointer to the green dot, the anchor) without a corner. ${summary} The anchor is a construction constraint, not a flow law.`,
      hypothesis: `Drawing the surface out to the pointer and closing the rest of the way to the trailing edge with the straight tether should leave a thinner region of reversed flow beside the ${side} surface over x = ${bodyFrom.toFixed(1)}–${bodyTo.toFixed(1)} d. Untested: the next simulation decides, and the flow may simply separate further on.`,
    },
    run: null,
    undone: null,
  };
  return { version: v, project: { ...p, versions: [...p.versions, v], head: id, log: [...p.log, { t: at, type: 'pointer-moved', version: id, detail: `${side} side: ${where} (${req.decision.kind === 'measurement' ? 'decided by the measurement' : 'by hand'})` }] } };
}

/**
 * The auto fill finished: a new version, child of the head, drawn by the pointer moves of the fill (it has no run yet: the fill is not a
 * measurement of the shape, the next computation is). Throws if the fill started from another shape or added nothing.
 */
export function addCfdFillVersion(p: CfdProject, fill: CfdFillResult, at = now()): { project: CfdProject; version: CfdVersion } {
  const parent = cfdHead(p);
  if (JSON.stringify(fill.startPaths) !== JSON.stringify(parent.shape.paths) || JSON.stringify(fill.plate) !== JSON.stringify(parent.shape.plate)) throw new Error(`the fill started from a different shape than the head ${parent.id}`);
  if (fill.moves.length === 0 || fill.totalRise < 1e-9) throw new Error(fill.stop.kind === 'nothing-measured' ? fill.stop.reason : 'the fill added no material');
  const id = `v${p.versions.length}`;
  const first = fill.moves[0];
  const last = fill.moves[fill.moves.length - 1];
  const r = fill.plate.thickness / 2;
  const lo = Math.min(...fill.moves.map((m) => m.to.x));
  const hi = last.to.x;
  const tallest = Math.max(...fill.moves.map((m) => m.maxH));
  const v: CfdVersion = {
    id,
    parent: parent.id,
    origin: 'constructed',
    label: `auto fill: ${fill.moves.length} pointer moves on the ${fill.side} side (${fill.stop.kind === 'user' ? 'stopped by you' : 'to the anchor'})`,
    createdAt: at,
    geometry: fill.geometry,
    shape: { plate: fill.plate, paths: fill.paths, spacing: fill.spacing },
    fill: {
      side: fill.side,
      moves: fill.moves,
      stop: fill.stop,
      config: fill.config,
      convective: fill.convective,
      maxMach: fill.maxMach,
      totalRise: fill.totalRise,
      reason: `While one CFD run went on, the pointer moved ${fill.moves.length} times along the ${fill.side} side, from x = ${toBodyX(fill.plate, first.from.x).toFixed(1)} d to x = ${toBodyX(fill.plate, hi).toFixed(1)} d from the leading tip. Each move followed the dividing streamline of the reversed flow beside the surface, averaged over ${fill.config.window} convective times (the flow had ${fill.config.settle} convective times to adjust after each move): the pointer rose by ${fill.config.step.relaxation} of the gap above the surface, at most ${fill.config.step.maxRise} d, and passed each station once. In all it rose ${fill.totalRise.toFixed(2)} d (the plate's own surface is ${r.toFixed(2)} d from its middle line); the dividing streamline stood up to ${tallest.toFixed(1)} d above the surface. The anchor is a construction constraint, not a flow law. ${fill.stop.reason}.`,
      hypothesis: `Drawing the surface out to follow the reversed flow along x = ${lo.toFixed(1)}–${hi.toFixed(1)} d should leave a thinner region of reversed flow beside the ${fill.side} surface. Untested: the flow changed while the pointer moved, so only the next computation of this shape (with its own start-up) can say.`,
    },
    run: null,
    undone: null,
  };
  return { version: v, project: { ...p, versions: [...p.versions, v], head: id, log: [...p.log, { t: at, type: 'auto-fill', version: id, detail: `auto fill on the ${fill.side} side: ${fill.moves.length} moves, ${fill.totalRise.toFixed(2)} d of rise, stopped: ${fill.stop.kind}` }] } };
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
