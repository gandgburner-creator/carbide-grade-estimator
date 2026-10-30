import { unplace, type Placement } from '../../geometry/SurfaceGeometry';

/**
 * THE DRAWING PAD: a sheet of engineering paper with a grid in centimetres, laid over the picture of the flow and faded in and out, so
 * that the construction (the plate, the red dot, the pointer, the green dot, the camber points) can be read and drawn on a quiet
 * background, and the flow below it can still be seen at the amount of paper chosen. The grid is a ruler: its lines are 1 cm, 5 cm … apart
 * on the real plate, from the leading tip, and by default it turns with the plate (so the heights typed for the pointer can be read off it).
 * It is a picture only: it computes nothing and changes nothing in the run or in the geometry.
 */
export type PadStyle = 'pad' | 'blueprint';
export type PadFrame = 'plate' | 'wind';

export interface PadSettings {
  /** 0 = no paper, 1 = opaque paper */
  opacity: number;
  /** a light engineering pad (the construction is drawn in dark ink) or a dark blueprint */
  style: PadStyle;
  /** the grid turns with the plate, or stays with the wind (the screen) */
  frame: PadFrame;
}

export const PAD_OFF: PadSettings = { opacity: 0, style: 'pad', frame: 'plate' };

/** [minor, major] grid spacings in cm, each major a whole number of minors */
export const GRID_STEPS: [number, number][] = [
  [0.1, 1],
  [0.2, 1],
  [0.5, 2],
  [1, 5],
  [2, 10],
  [5, 20],
  [10, 50],
  [20, 100],
  [50, 200],
  [100, 500],
];

/** The finest grid whose minor lines are at least `minPx` apart on the screen. */
export function gridSteps(pxPerCm: number, minPx = 10): { minor: number; major: number } {
  for (const [minor, major] of GRID_STEPS) if (minor * pxPerCm >= minPx) return { minor, major };
  const last = GRID_STEPS[GRID_STEPS.length - 1];
  return { minor: last[0], major: last[1] };
}

/** Where the paper's origin (the leading tip) is, and how long a plate unit is in cm. */
export interface PadGeometry {
  origin: Placement;
  cmPerUnit: number;
}

/** paper (cm) → simulation frame (plate units) */
export function paperToDomain(u: number, v: number, g: PadGeometry, frame: PadFrame): [number, number] {
  const x = u / g.cmPerUnit;
  const y = v / g.cmPerUnit;
  if (frame === 'wind') return [g.origin.x + x, g.origin.y + y];
  const a = (-g.origin.alphaDeg * Math.PI) / 180;
  return [g.origin.x + x * Math.cos(a) - y * Math.sin(a), g.origin.y + x * Math.sin(a) + y * Math.cos(a)];
}

/** simulation frame (plate units) → paper (cm) */
export function domainToPaper(x: number, y: number, g: PadGeometry, frame: PadFrame): [number, number] {
  if (frame === 'wind') return [(x - g.origin.x) * g.cmPerUnit, (y - g.origin.y) * g.cmPerUnit];
  const [bx, by] = unplace([x, y], g.origin);
  return [bx * g.cmPerUnit, by * g.cmPerUnit];
}

/** The multiples of `step` in [lo, hi], and which of them are multiples of `major` too. */
export function gridLines(lo: number, hi: number, step: number, major: number): { value: number; major: boolean }[] {
  const out: { value: number; major: boolean }[] = [];
  const k0 = Math.ceil(lo / step - 1e-9);
  const k1 = Math.floor(hi / step + 1e-9);
  if (k1 - k0 > 4000) return out;
  for (let k = k0; k <= k1; k++) {
    const value = Math.round(k * step * 1e6) / 1e6;
    const r = value / major;
    out.push({ value, major: Math.abs(r - Math.round(r)) < 1e-6 });
  }
  return out;
}

/** How much of the construction is drawn in dark ink: none on a blueprint or on thin paper, all of it on thick paper. */
export function inkWeight(s: PadSettings): number {
  if (s.style !== 'pad') return 0;
  const t = Math.min(1, Math.max(0, (s.opacity - 0.3) / 0.5));
  return t * t * (3 - 2 * t);
}

const LOOK = {
  pad: { paper: '#eef1df', minor: 'rgba(80,138,98,0.34)', major: 'rgba(52,112,74,0.62)', axis: 'rgba(30,62,84,0.85)', text: '#2c4a3a', frame: 'rgba(52,112,74,0.8)' },
  blueprint: { paper: '#0d2a49', minor: 'rgba(130,185,240,0.2)', major: 'rgba(150,200,255,0.42)', axis: 'rgba(205,230,255,0.85)', text: '#bcd9f6', frame: 'rgba(150,200,255,0.7)' },
} as const;

const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** A view transform: simulation frame → pixels (as `transformOf` gives it). */
export interface PadTransform {
  s: number;
  X: (x: number) => number;
  Y: (y: number) => number;
  invX: (px: number) => number;
  invY: (py: number) => number;
}

/** Draw the paper, the grid, the axes with their numbers and a caption, at the opacity of the settings, over the whole `w × h` view. */
export function drawPad(g: CanvasRenderingContext2D, T: PadTransform, w: number, h: number, s: PadSettings, geo: PadGeometry) {
  if (!(s.opacity > 0)) return;
  const look = LOOK[s.style];
  const toPx = (u: number, v: number): [number, number] => {
    const [x, y] = paperToDomain(u, v, geo, s.frame);
    return [T.X(x), T.Y(y)];
  };
  // the visible part of the paper, from the four corners of the view
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const [u, v] = domainToPaper(T.invX(px), T.invY(py), geo, s.frame);
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  }
  const pxPerCm = T.s / geo.cmPerUnit;
  const { minor, major } = gridSteps(pxPerCm);
  g.save();
  g.globalAlpha = Math.min(1, s.opacity);
  g.fillStyle = look.paper;
  g.fillRect(0, 0, w, h);
  const strokeSet = (vals: { value: number; major: boolean }[], vertical: boolean, majorWanted: boolean) => {
    g.beginPath();
    for (const { value, major: isMajor } of vals) {
      if (isMajor !== majorWanted) continue;
      const a = vertical ? toPx(value, vmin) : toPx(umin, value);
      const b = vertical ? toPx(value, vmax) : toPx(umax, value);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    }
    g.stroke();
  };
  const us = gridLines(umin, umax, minor, major);
  const vs = gridLines(vmin, vmax, minor, major);
  g.lineWidth = 0.7;
  g.strokeStyle = look.minor;
  strokeSet(us, true, false);
  strokeSet(vs, false, false);
  g.lineWidth = 1.2;
  g.strokeStyle = look.major;
  strokeSet(us, true, true);
  strokeSet(vs, false, true);
  // the axes through the leading tip: along the plate and across it
  g.lineWidth = 1.6;
  g.strokeStyle = look.axis;
  g.beginPath();
  let p = toPx(umin, 0);
  g.moveTo(p[0], p[1]);
  p = toPx(umax, 0);
  g.lineTo(p[0], p[1]);
  p = toPx(0, vmin);
  g.moveTo(p[0], p[1]);
  p = toPx(0, vmax);
  g.lineTo(p[0], p[1]);
  g.stroke();
  // numbers on the major lines of the axes, turned with the paper
  const ang = s.frame === 'plate' ? (-geo.origin.alphaDeg * Math.PI) / 180 : 0;
  g.fillStyle = look.text;
  g.font = '10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  const label = (text: string, u: number, v: number, dx: number, dy: number, align: CanvasTextAlign) => {
    const [px, py] = toPx(u, v);
    if (px < -20 || py < -20 || px > w + 20 || py > h + 20) return;
    g.save();
    g.translate(px, py);
    g.rotate(ang);
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillText(text, dx, dy);
    g.restore();
  };
  for (const { value, major: isMajor } of us) if (isMajor && Math.abs(value) > 1e-9) label(fmt(value), value, 0, 0, 11, 'center');
  for (const { value, major: isMajor } of vs) if (isMajor && Math.abs(value) > 1e-9) label(fmt(value), 0, value, -6, 0, 'right');
  label('0', 0, 0, -6, 11, 'right');
  // the caption, in the corner of the sheet, unturned
  g.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillStyle = look.text;
  g.fillText(`DRAWING PAD · grid ${fmt(minor)} cm, heavy lines every ${fmt(major)} cm · from the leading tip · ${s.frame === 'plate' ? 'turns with the plate' : 'aligned with the wind'}`, 10, 8);
  g.strokeStyle = look.frame;
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, w - 1, h - 1);
  g.restore();
}
