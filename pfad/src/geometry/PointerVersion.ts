import { describeCamber, withCamber, type CamberSpec } from './Camber';
import type { ConstructionBasis, ConstructionConfig, PathPoint } from './Construction';
import { headVersion, type GeometryVersion, type PlateShape, type PointerMove, type Project } from './History';
import { applyPointerEdit, baseHeight, validatePlate, DEFAULT_POINTER_LIMITS, DEFAULT_POINTER_STEP, describePointerEdit, fromBodyX, pointerOf, plateGeometry, toBodyX, type PointerEdit, type PointerLimits, type PointerStep, type Pt } from './Pointer';
import { DEFAULT_LIMITS, sideY, stationX, type Side } from './SurfaceGeometry';

const now = () => new Date().toISOString();

/** What decided where the pointer went. */
export type PointerDecision =
  | { kind: 'hand' }
  | { kind: 'measurement'; step: PointerStep; recordId: string | null; versionId: string | null; seeds: number[]; /** what was measured, in one sentence */ summary: string; detector: string };

export interface PointerMoveRequest {
  side: Side;
  /** plate frame: x from the centre of the leading circle, y the outward height; absent: only the red dot, the green dot or the arc directions change */
  to?: Pt;
  /** the green dot (anchor) moved or put back (null), and the red dot (the last placed point) re-placed or given a direction */
  edit?: { anchor?: Pt | null; red?: Pt };
  /** the camber of the plate set (null: made straight again); the heights drawn with the pointer stay heights above the wall, which the camber carries along */
  camber?: CamberSpec | null;
  limits?: PointerLimits;
  decision: PointerDecision;
}

/** The plate and pointer paths of a version, or the reason there are none. */
export function shapeOf(v: GeometryVersion): PlateShape | null {
  return v.shape ?? null;
}

/**
 * Move the construction pointer of the head version: the result is a new version (a child of the head) whose surface is
 * the rounded plate plus the curve drawn through every pointer position so far, with the straight tether from the new
 * position to the trailing-edge anchor. It has no run until it is simulated. Nothing is deleted: undo returns to the parent.
 */
export function addPointerVersion(p: Project, req: PointerMoveRequest, at = now()): { project: Project; version: GeometryVersion } {
  const parent = headVersion(p);
  const shape = shapeOf(parent);
  if (!shape) throw new Error(`the head ${parent.id} was not drawn by the pointer (it is a flat plate or was changed by a proposal or a live fill): undo to a rounded-plate version, or start a new project`);
  const limits = req.limits ?? DEFAULT_POINTER_LIMITS;
  const from = pointerOf(shape.paths, req.side);
  const edit: PointerEdit = { ...(req.edit ?? {}), ...(req.to ? { to: req.to } : {}) };
  const camberChange = req.camber !== undefined;
  if (!edit.to && edit.anchor === undefined && !edit.red && !camberChange) throw new Error('nothing to change: place the pointer, or move the red or the green dot, set a direction, or change the camber');
  const plate = camberChange ? withCamber(shape.plate, req.camber) : shape.plate;
  if (camberChange) {
    const bad = validatePlate(plate);
    if (bad) throw new Error(bad);
  }
  const added = applyPointerEdit(plate, shape.paths, req.side, edit, limits);
  if (!added.ok) throw new Error(added.reason);
  const now0 = pointerOf(added.paths, req.side);
  const geometry = plateGeometry(plate, added.paths, shape.spacing);
  const camberText = camberChange ? describeCamber(req.camber, plate.length) : '';
  const y0 = sideY(parent.geometry, req.side);
  const y1 = sideY(geometry, req.side);
  const xs = stationX(geometry);
  const m = req.decision.kind === 'measurement' ? req.decision.step : null;
  const points: PathPoint[] = [];
  for (let i = 0; i < y0.length; i++) {
    const d = Math.abs(y1[i] - y0[i]);
    if (d <= 1e-9) continue;
    points.push({ index: i, x: xs[i], yOld: y0[i], yNew: y1[i], deltaNormal: d, measured: m ? m.gap : Number.NaN, measuredSE: Number.NaN, weight: Number.NaN });
  }
  const step = p.versions.filter((v) => v.origin === 'constructed').length + 1;
  const id = `v${p.versions.length}`;
  const bodyFrom = toBodyX(shape.plate, from.x);
  const bodyTo = toBodyX(shape.plate, now0.x);
  const where = [describePointerEdit(plate, edit), camberText].filter(Boolean).join('; ');
  const placed = req.to ? `pointer to x = ${toBodyX(plate, req.to.x).toFixed(1)} d from the leading tip, ${(req.to.y - baseHeight(plate, req.to.x)).toFixed(2)} d above the plate${camberText ? `; ${camberText}` : ''}` : where;
  const moveRecord: PointerMove = {
    side: req.side,
    from,
    to: { x: now0.x, y: now0.y, ...(now0.angle !== undefined ? { angle: now0.angle } : {}) },
    decided: req.decision.kind,
    ...(req.decision.kind === 'measurement'
      ? { measured: { surface: req.decision.step.surface, gap: req.decision.step.gap, rise: req.decision.step.rise, note: req.decision.step.note, recordId: req.decision.recordId, versionId: req.decision.versionId, seeds: req.decision.seeds } }
      : {}),
    limits,
    ...((req.edit && (req.edit.anchor !== undefined || req.edit.red)) || camberChange ? { edit: { ...(req.edit ?? {}), ...(camberChange ? { camber: req.camber } : {}) } } : {}),
  };
  const summary =
    req.decision.kind === 'measurement'
      ? `${req.decision.summary} ${req.decision.step.note}.`
      : `Placed by hand (no measurement decided this).`;
  const basis: ConstructionBasis = {
    side: req.side,
    mode: 'pointer',
    detector: req.decision.kind === 'measurement' ? req.decision.detector : 'by hand',
    level: 'POINTER (experimental)',
    region: { xLo: bodyFrom, xHi: bodyTo },
    stations: [],
    source: req.decision.kind === 'measurement' ? { recordId: req.decision.recordId, seeds: req.decision.seeds, versionId: req.decision.versionId } : { recordId: null, seeds: [], versionId: null },
    summary,
  };
  const cfg = DEFAULT_POINTER_STEP;
  const config: ConstructionConfig = { relaxation: cfg.relaxation, maxStep: cfg.maxRise, shrink: 0, ramp: 0, taper: 0, leReserve: 0, teReserve: 0, limits: DEFAULT_LIMITS };
  const side = req.side === 'upper' ? 'upper' : 'lower';
  const v: GeometryVersion = {
    id,
    parent: parent.id,
    origin: 'constructed',
    label: `step ${step}: ${side} side: ${req.to ? placed : where}`,
    createdAt: at,
    geometry,
    shape: { plate, paths: added.paths, spacing: shape.spacing },
    construction: {
      step,
      proposalId: `${parent.id}-pointer`,
      side: req.side,
      mode: 'pointer',
      acceptedPoints: points.length,
      totalPoints: points.length,
      partial: false,
      reason:
        `On the ${side} side: ${where}. The drawn curve passes through every pointer position so far, with one direction at each, and meets the tether (the straight rope from the pointer to the green dot, the anchor) without a corner. ` +
        `${summary} The anchor is a construction constraint, not a flow law.`,
      hypothesis:
        `Drawing the surface out to the pointer and closing the rest of the way to the trailing edge with the straight tether should leave less empty space beside the ${side} surface over x = ${bodyFrom.toFixed(1)}–${bodyTo.toFixed(1)} d: the contact-layer density ` +
        `(relative to the free stream) over that stretch should be higher than on the old surface. Untested: the next simulation decides, and the flow may simply leave the surface further on.`,
      basis,
      config,
      scale: 1,
      points,
      pointer: moveRecord,
    },
    run: null,
    undone: null,
  };
  return {
    version: v,
    project: {
      ...p,
      versions: [...p.versions, v],
      head: id,
      log: [...p.log, { t: at, type: 'accepted', version: id, detail: `${side} side: ${where} (${req.decision.kind === 'measurement' ? 'decided by the measurement' : 'by hand'})` }],
    },
  };
}

export { fromBodyX, toBodyX };
