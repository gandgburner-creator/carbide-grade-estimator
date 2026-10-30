import { anchorOf, applyPointerEdit, baseHeight, defaultAnchor, plateGeometry, pointerOf, startOf, type PlateSpec, type PointerEdit, type PointerLimits, type PointerPaths, type Pt } from './Pointer';
import type { Side, SurfaceGeometry } from './SurfaceGeometry';

/**
 * What a person types about the three points and the two arcs, in centimetres of the plate they described and degrees:
 *   red dot   x, rise, angle    where the arc starts (the last place the pointer was put; it starts on the leading circle), and
 *                               the direction the curve has there
 *   pointer   x, rise, angle    where the arc ends and the rope begins, and the direction the curve arrives with
 *   green dot anchorX, anchorRise   where the rope is tied (starts at the top of the trailing circle)
 * A blank angle means "along the rope" (the default); a position that is the current one means "unchanged".
 */
export interface PointerTexts {
  x: string;
  rise: string;
  angle: string;
  redX: string;
  redRise: string;
  redAngle: string;
  anchorX: string;
  anchorRise: string;
}

export const EMPTY_POINTER_TEXTS: PointerTexts = { x: '', rise: '0.5', angle: '', redX: '', redRise: '', redAngle: '', anchorX: '', anchorRise: '' };

const DEG = Math.PI / 180;
const cmStr = (u: number, cmPerUnit: number) => {
  const v = u * cmPerUnit;
  return (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
};
const degStr = (rad: number | undefined) => (rad === undefined ? '' : ((rad / DEG)).toFixed(0));

/** The texts that show the current state: the red dot where it is, the anchor where it is, and the pointer one step ahead of the red dot. */
export function defaultPointerTexts(plate: PlateSpec, paths: PointerPaths, side: Side, cmPerUnit: number, step: number): PointerTexts {
  const red = pointerOf(paths, side);
  const anchor = anchorOf(plate, paths, side);
  const x = Math.min(anchor.x, red.x + step);
  const surface = ((): number => {
    // the height of the surface the pointer would sit on: the rope from the red dot to the anchor
    if (anchor.x - red.x < 1e-12) return anchor.y;
    return red.y + ((x - red.x) / (anchor.x - red.x)) * (anchor.y - red.y);
  })();
  return {
    x: cmStr(x, cmPerUnit),
    rise: cmStr(Math.max(0, surface - baseHeight(plate, x)) + 0.5, cmPerUnit),
    angle: '',
    redX: cmStr(red.x, cmPerUnit),
    redRise: cmStr(red.y - baseHeight(plate, red.x), cmPerUnit),
    redAngle: degStr(red.angle),
    anchorX: cmStr(anchor.x, cmPerUnit),
    anchorRise: cmStr(anchor.y - baseHeight(plate, anchor.x), cmPerUnit),
  };
}

export type PointerInput =
  | {
      ok: true;
      /** what to hand to addPointerVersion / addCfdPointerMove */
      to?: Pt;
      edit?: { anchor?: Pt | null; red?: Pt };
      /** the whole thing as the library applies it (for the preview) */
      full: PointerEdit;
      paths: PointerPaths;
      geometry: SurfaceGeometry;
      /** where the red dot would be, where the new pointer would be (if one is placed) and where the anchor would be */
      redAt: Pt;
      pointerAt: Pt | null;
      anchorAt: Pt;
      /** the changes, in words, for the screen */
      changes: string[];
    }
  | { ok: false; reason: string };

const num = (t: string): number => (t.trim() === '' ? Number.NaN : Number(t));

/** Read the typed texts against the current shape. Pure: nothing is changed, the result is a preview and the request. */
export function readPointerInput(plate: PlateSpec, paths: PointerPaths, spacing: number, side: Side, t: PointerTexts, cmPerUnit: number, limits: PointerLimits): PointerInput {
  const red0 = pointerOf(paths, side);
  const anchor0 = anchorOf(plate, paths, side);
  // what the boxes show for the current state: a box still showing it means "unchanged" (the typed centimetres are rounded)
  const cur = {
    redX: cmStr(red0.x, cmPerUnit),
    redRise: cmStr(red0.y - baseHeight(plate, red0.x), cmPerUnit),
    redAngle: degStr(red0.angle),
    anchorX: cmStr(anchor0.x, cmPerUnit),
    anchorRise: cmStr(anchor0.y - baseHeight(plate, anchor0.x), cmPerUnit),
  };
  const changes: string[] = [];
  const edit: { anchor?: Pt | null; red?: Pt } = {};
  let to: Pt | undefined;

  // the green dot
  const ax = num(t.anchorX);
  const ar = num(t.anchorRise);
  if (t.anchorX.trim() !== '' || t.anchorRise.trim() !== '') {
    if (!Number.isFinite(ax) || !Number.isFinite(ar)) return { ok: false, reason: 'the green dot: enter where along the plate it is tied and how high above the plate [cm]' };
    const a = { x: ax / cmPerUnit, y: baseHeight(plate, ax / cmPerUnit) + ar / cmPerUnit };
    if (t.anchorX !== cur.anchorX || t.anchorRise !== cur.anchorRise) {
      const d = defaultAnchor(plate);
      if (Math.abs(a.x - d.x) < 1e-6 && Math.abs(a.y - d.y) < 1e-6) edit.anchor = null;
      else edit.anchor = a;
      changes.push('the green dot (anchor) moves');
    }
  }

  // the red dot
  const rx = num(t.redX);
  const rr = num(t.redRise);
  if (t.redX.trim() !== '' || t.redRise.trim() !== '') {
    if (!Number.isFinite(rx) || !Number.isFinite(rr)) return { ok: false, reason: 'the red dot: enter where along the plate it is and how high above the plate [cm]' };
    const ang = t.redAngle.trim() === '' ? undefined : num(t.redAngle) * DEG;
    if (ang !== undefined && !Number.isFinite(ang)) return { ok: false, reason: 'the red dot: the direction of the curve must be a number of degrees (or empty: along the rope)' };
    const red = { x: rx / cmPerUnit, y: baseHeight(plate, rx / cmPerUnit) + rr / cmPerUnit, ...(ang !== undefined ? { angle: ang } : {}) };
    const moved = t.redX !== cur.redX || t.redRise !== cur.redRise;
    const turned = t.redAngle.trim() !== cur.redAngle;
    if (moved || turned) {
      // an unmoved red dot keeps its exact place (the typed centimetres are rounded)
      edit.red = moved ? red : { x: red0.x, y: red0.y, ...(ang !== undefined ? { angle: ang } : {}) };
      changes.push(moved ? 'the red dot moves' : 'the curve leaves the red dot in a new direction');
    }
  }

  // the pointer
  const px = num(t.x);
  const pr = num(t.rise);
  const anyPointer = t.x.trim() !== '' || t.rise.trim() !== '';
  if (anyPointer) {
    if (!Number.isFinite(px)) return { ok: false, reason: 'enter how far along the plate the pointer goes [cm]' };
    if (!Number.isFinite(pr)) return { ok: false, reason: 'enter how high above the plate the pointer goes [cm]' };
    const ang = t.angle.trim() === '' ? undefined : num(t.angle) * DEG;
    if (ang !== undefined && !Number.isFinite(ang)) return { ok: false, reason: 'the pointer: the direction of the curve must be a number of degrees (or empty: along the rope)' };
    to = { x: px / cmPerUnit, y: baseHeight(plate, px / cmPerUnit) + pr / cmPerUnit, ...(ang !== undefined ? { angle: ang } : {}) };
    changes.push('the pointer is placed, with an arc from the red dot to it');
  } else if (!changes.length) return { ok: false, reason: 'enter where the pointer goes, or change the red dot, the green dot or a direction' };

  const full: PointerEdit = { ...edit, ...(to ? { to } : {}) };
  const before = applyPointerEdit(plate, paths, side, edit, limits);
  if (!before.ok) return { ok: false, reason: before.reason };
  const redAt = pointerOf(before.paths, side);
  const applied = applyPointerEdit(plate, paths, side, full, limits);
  if (!applied.ok) return { ok: false, reason: applied.reason };
  if (!to && !changes.length) return { ok: false, reason: 'nothing differs from the shape that is there' };
  return {
    ok: true,
    ...(to ? { to } : {}),
    ...(edit.anchor !== undefined || edit.red ? { edit } : {}),
    full,
    paths: applied.paths,
    geometry: plateGeometry(plate, applied.paths, spacing),
    redAt,
    pointerAt: to ? pointerOf(applied.paths, side) : null,
    anchorAt: anchorOf(plate, applied.paths, side),
    changes,
  };
}

/** Where the three dots are according to what is typed (so they can be drawn and picked up even while a value is refused); the current state where a box cannot be read. */
export function dotsFromTexts(plate: PlateSpec, paths: PointerPaths, side: Side, t: PointerTexts, cmPerUnit: number): { red: Pt; pointer: Pt | null; green: Pt } {
  const read = (xs: string, rs: string, fallback: Pt | null): Pt | null => {
    const x = num(xs);
    const r = num(rs);
    if (!Number.isFinite(x) || !Number.isFinite(r)) return fallback;
    return { x: x / cmPerUnit, y: baseHeight(plate, x / cmPerUnit) + r / cmPerUnit };
  };
  return {
    red: read(t.redX, t.redRise, pointerOf(paths, side))!,
    pointer: read(t.x, t.rise, null),
    green: read(t.anchorX, t.anchorRise, anchorOf(plate, paths, side))!,
  };
}

/** The texts after one of the dots was dragged to plate-frame x and outward height (never below the plate's own surface). */
export function dragToTexts(plate: PlateSpec, id: string, x: number, height: number, cmPerUnit: number, t: PointerTexts): PointerTexts {
  const rise = Math.max(0, height - baseHeight(plate, x));
  const xs = cmStr(x, cmPerUnit);
  const rs = cmStr(rise, cmPerUnit);
  if (id === 'red') return { ...t, redX: xs, redRise: rs };
  if (id === 'green') return { ...t, anchorX: xs, anchorRise: rs };
  return { ...t, x: xs, rise: rs };
}

export { startOf };
