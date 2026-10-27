import type { FieldKind } from '../workers/protocol';

type RGB = [number, number, number];

/** Perceptually ordered sequential ramp (approximate viridis), t ∈ [0, 1]. */
export function ramp(t: number): RGB {
  return lerpStops(
    [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ],
    t,
  );
}

/** Diverging ramp for signed quantities: blue (−) ↔ neutral gray (0) ↔ red (+), t ∈ [0, 1]. */
export function divergingRamp(t: number): RGB {
  return lerpStops(
    [
      [57, 135, 229],
      [56, 56, 53],
      [224, 88, 79],
    ],
    t,
  );
}

function lerpStops(stops: RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

const SIGNED: ReadonlySet<FieldKind> = new Set<FieldKind>(['ux', 'uy', 'momentumX', 'momentumY', 'shear']);

export interface FieldScale {
  lo: number;
  hi: number;
  diverging: boolean;
  color(v: number): RGB;
  /** CSS gradient for the legend bar */
  css: string;
}

/**
 * Signed quantities whose values straddle zero use a symmetric diverging scale
 * centred on zero; everything else (including a signed field of one sign) a
 * sequential min–max scale.
 */
export function fieldScale(kind: FieldKind, min: number, max: number): FieldScale {
  const diverging = SIGNED.has(kind) && min < 0 && max > 0;
  const a = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const lo = diverging ? -a : min;
  const hi = diverging ? a : max;
  const span = hi - lo || 1;
  const f = diverging ? divergingRamp : ramp;
  const css = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${f(t).map((c) => c | 0).join(',')})`).join(',')})`;
  return { lo, hi, diverging, color: (v) => f((v - lo) / span), css };
}
