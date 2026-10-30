type RGB = [number, number, number];

/**
 * Colour scales of the CFD field view. They are drawn on a dark background, so the sequential scale (inferno-like, perceptually ordered)
 * runs from black through purple and orange to pale yellow, and the diverging scale for signed fields (pressure, vorticity, velocity
 * components, total pressure) has its neutral value dark, so that the sign and the size of a structure are both visible and zero
 * disappears into the background.
 */
const SEQUENTIAL: RGB[] = [
  [0, 0, 4],
  [31, 12, 72],
  [85, 15, 109],
  [136, 34, 106],
  [186, 54, 85],
  [227, 89, 51],
  [249, 140, 10],
  [249, 201, 50],
  [252, 255, 164],
];

const DIVERGING: RGB[] = [
  [190, 245, 255],
  [70, 185, 245],
  [32, 96, 205],
  [18, 40, 100],
  [14, 22, 36],
  [110, 28, 40],
  [214, 70, 36],
  [247, 150, 40],
  [255, 232, 160],
];

function lerp(stops: RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

export interface CfdScale {
  lo: number;
  hi: number;
  signed: boolean;
  color(v: number): RGB;
  /** 256 colours, RGBA bytes, for a texture */
  lut: Uint8Array;
  /** CSS gradient for the legend bar */
  css: string;
}

/** The colour scale of a field with the range `lo … hi` (symmetric about zero when `signed`). */
export function cfdScale(lo: number, hi: number, signed: boolean): CfdScale {
  const stops = signed ? DIVERGING : SEQUENTIAL;
  const span = hi - lo || 1;
  const color = (v: number) => lerp(stops, (v - lo) / span);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = lerp(stops, i / 255);
    lut[4 * i] = Math.round(r);
    lut[4 * i + 1] = Math.round(g);
    lut[4 * i + 2] = Math.round(b);
    lut[4 * i + 3] = 255;
  }
  const css = `linear-gradient(90deg, ${Array.from({ length: 9 }, (_, k) => `rgb(${lerp(stops, k / 8).map((c) => Math.round(c)).join(',')})`).join(',')})`;
  return { lo, hi, signed, color, lut, css };
}
