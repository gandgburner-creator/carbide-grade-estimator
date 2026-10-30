import { camberFunction, CAMBER_LIMITS, validateCamber, type CamberSpec } from './Camber';
import { initialPaths, plateGeometry, validatePlate, type PlateSpec, type PointerPaths } from './Pointer';
import type { SurfaceGeometry } from './SurfaceGeometry';

/**
 * What a person types about the camber spline, in centimetres of the plate they described: for every control point where along the
 * plate it is (0 at the leftmost point of the leading edge, the plate's length at the trailing tip) and how far above the chord line
 * (the straight line from tip to tip; negative: below it). The tips themselves cannot be moved: the spline starts and ends on them.
 */
export interface CamberTexts {
  points: { x: string; y: string }[];
}

const num = (t: string): number => (t.trim() === '' ? Number.NaN : Number(t));
const cmStr = (u: number, cmPerUnit: number) => {
  const v = u * cmPerUnit;
  return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
};

/** The boxes for the camber a plate has now (none when it is straight). */
export function camberTextsOf(plate: PlateSpec, cmPerUnit: number): CamberTexts {
  return { points: (plate.camber?.points ?? []).map((p) => ({ x: cmStr(p.x, cmPerUnit), y: cmStr(p.y, cmPerUnit) })) };
}

export type CamberInput =
  | {
      ok: true;
      /** the camber the boxes give (null: straight) */
      camber: CamberSpec | null;
      /** the boxes read the same as the plate's camber now */
      unchanged: boolean;
      /** the plate with this camber, and what it would look like with the pointer paths as they are */
      plate: PlateSpec;
      geometry: SurfaceGeometry;
      /** the mid-line, for drawing (body frame) */
      line: { x: number; y: number }[];
      controls: { x: number; y: number }[];
    }
  | { ok: false; reason: string };

/** Read the typed camber. Pure: nothing is changed; the result is the request and a preview. */
export function readCamberInput(plate: PlateSpec, paths: PointerPaths, spacing: number, t: CamberTexts, cmPerUnit: number): CamberInput {
  const pts: { x: number; y: number }[] = [];
  for (const [k, p] of t.points.entries()) {
    const x = num(p.x);
    const y = num(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: `camber point ${k + 1}: enter where along the plate it is and how far above the chord line [cm]` };
    pts.push({ x: x / cmPerUnit, y: y / cmPerUnit });
  }
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const camber: CamberSpec | null = sorted.length ? { points: sorted } : null;
  const why = camber ? validateCamber(camber, plate.length) : null;
  if (why) return { ok: false, reason: why };
  const next: PlateSpec = { ...plate };
  if (camber) next.camber = camber;
  else delete next.camber;
  const bad = validatePlate(next);
  if (bad) return { ok: false, reason: bad };
  const f = camberFunction(camber, plate.length);
  const line: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = (plate.length * i) / 60;
    line.push({ x, y: f(x) });
  }
  const unchanged = JSON.stringify(camber?.points ?? []) === JSON.stringify(plate.camber?.points ?? []) || camberTextsEqual(t, camberTextsOf(plate, cmPerUnit));
  return { ok: true, camber, unchanged, plate: next, geometry: plateGeometry(next, paths ?? initialPaths(next), spacing), line, controls: sorted.map((p) => ({ x: p.x, y: p.y })) };
}

function camberTextsEqual(a: CamberTexts, b: CamberTexts): boolean {
  return a.points.length === b.points.length && a.points.every((p, k) => p.x === b.points[k].x && p.y === b.points[k].y);
}

/** A new control point at the middle of the longest stretch between tips and points, on the chord line (the person then drags it). */
export function addCamberPoint(plate: PlateSpec, t: CamberTexts, cmPerUnit: number): CamberTexts {
  if (t.points.length >= CAMBER_LIMITS.maxPoints) return t;
  const xs = [0, ...t.points.map((p) => num(p.x) / cmPerUnit).filter(Number.isFinite).sort((a, b) => a - b), plate.length];
  let at = 0.5 * plate.length;
  let width = -1;
  for (let i = 1; i < xs.length; i++)
    if (xs[i] - xs[i - 1] > width) {
      width = xs[i] - xs[i - 1];
      at = 0.5 * (xs[i] + xs[i - 1]);
    }
  return { points: [...t.points, { x: cmStr(at, cmPerUnit), y: '0.00' }] };
}

/**
 * The texts after control point k was dragged to body-frame (x, y) [d]: it keeps its order along the plate (it cannot pass its
 * neighbours or get closer to a tip than the spline allows) and is otherwise free.
 */
export function dragCamberPoint(plate: PlateSpec, t: CamberTexts, k: number, x: number, y: number, cmPerUnit: number): CamberTexts {
  const gap = CAMBER_LIMITS.minGap * plate.length;
  const unit = (txt: string) => num(txt) / cmPerUnit;
  const lo = k > 0 && Number.isFinite(unit(t.points[k - 1].x)) ? unit(t.points[k - 1].x) + gap : gap;
  const hi = k + 1 < t.points.length && Number.isFinite(unit(t.points[k + 1].x)) ? unit(t.points[k + 1].x) - gap : plate.length - gap;
  const xc = Math.min(Math.max(lo, x), Math.max(lo, hi));
  const yc = Math.max(-CAMBER_LIMITS.maxHeight * plate.length, Math.min(CAMBER_LIMITS.maxHeight * plate.length, y));
  return { points: t.points.map((p, i) => (i === k ? { x: cmStr(xc, cmPerUnit), y: cmStr(yc, cmPerUnit) } : p)) };
}

/** The control points as typed, in the body frame [d] (a point whose boxes cannot be read is left out): for drawing and picking them up while a value is being typed. */
export function camberControlsOf(t: CamberTexts, cmPerUnit: number): { x: number; y: number }[] {
  return t.points
    .map((p) => ({ x: num(p.x) / cmPerUnit, y: num(p.y) / cmPerUnit }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
