/**
 * CAMBER: the mid-line of the plate between the leading and the trailing circle as an adjustable SPLINE instead of a straight line.
 *
 * The plate is still the plate (two round ends joined by their straight edges, thicknesses as chosen); camber WARPS it: the whole
 * outline, and everything drawn on it, is lifted by the height of the spline at that place along the chord. The two tips stay on
 * the chord line (the straight line from the leftmost point of the leading edge to the trailing tip, which is also what the angle of
 * attack is measured against), so the spline arches between them. The thicknesses are VERTICAL thicknesses (where the spline is steep
 * the round ends are slightly sheared, not exact circles), and heights drawn with the pointer stay heights above the (now curved) wall.
 *
 * The spline is the natural cubic spline through the control points the person sets, with the two tips fixed at height 0. It is a
 * construction choice, not a flow law: nothing here knows an airfoil family, and no camber is optimal.
 */
export interface CamberPoint {
  /** along the chord from the leftmost point of the leading edge [d] */
  x: number;
  /** height above the chord line [d]; positive toward the upper side */
  y: number;
}

export interface CamberSpec {
  /** the control points between the tips, increasing in x */
  points: CamberPoint[];
}

export const CAMBER_LIMITS = {
  /** the control points keep at least this fraction of the chord from the tips and from each other */
  minGap: 0.03,
  /** the spline may rise at most this fraction of the chord above or below the chord line */
  maxHeight: 0.35,
  /** and its slope may not exceed this (dy/dx) */
  maxSlope: 1,
  /** the most control points */
  maxPoints: 8,
};

/** Why a camber is not allowed on a plate of this length, or null. */
export function validateCamber(c: CamberSpec, length: number): string | null {
  const L = CAMBER_LIMITS;
  if (c.points.length > L.maxPoints) return `at most ${L.maxPoints} control points`;
  let prev = 0;
  for (const p of c.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return 'a control point is not a number';
    if (p.x < prev + L.minGap * length - 1e-9) return `control points must keep ${(100 * L.minGap).toFixed(0)} % of the plate length from the tips and from each other`;
    if (p.x > length * (1 - L.minGap) + 1e-9) return `control points must keep ${(100 * L.minGap).toFixed(0)} % of the plate length from the trailing tip`;
    if (Math.abs(p.y) > L.maxHeight * length + 1e-9) return `the mid-line may not rise more than ${(100 * L.maxHeight).toFixed(0)} % of the plate length from the chord line`;
    prev = p.x;
  }
  const f = camberFunction(c, length);
  let slope = 0;
  let peak = 0;
  const n = 200;
  for (let i = 0; i <= n; i++) {
    const x = (length * i) / n;
    peak = Math.max(peak, Math.abs(f(x)));
    if (i > 0) slope = Math.max(slope, Math.abs(f(x) - f(x - length / n)) / (length / n));
  }
  if (peak > L.maxHeight * length + 1e-9) return `the spline rises more than ${(100 * L.maxHeight).toFixed(0)} % of the plate length from the chord line between its control points`;
  if (slope > L.maxSlope + 1e-9) return `the spline is steeper than ${L.maxSlope} (${((Math.atan(L.maxSlope) * 180) / Math.PI).toFixed(0)}°) somewhere: spread the control points or lower them`;
  return null;
}

/**
 * The height of the mid-line above the chord line at x along the chord: the natural cubic spline through (0, 0), the control
 * points and (length, 0); zero without control points (a straight plate).
 */
export function camberFunction(c: CamberSpec | undefined | null, length: number): (x: number) => number {
  if (!c || c.points.length === 0) return () => 0;
  const xs = [0, ...c.points.map((p) => p.x), length];
  const ys = [0, ...c.points.map((p) => p.y), 0];
  const n = xs.length;
  // second derivatives of the natural spline (zero at both ends), by the tridiagonal algorithm
  const m = new Array<number>(n).fill(0);
  if (n > 2) {
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(1);
    const cc = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const h0 = xs[i] - xs[i - 1];
      const h1 = xs[i + 1] - xs[i];
      a[i] = h0;
      b[i] = 2 * (h0 + h1);
      cc[i] = h1;
      d[i] = 6 * ((ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0);
    }
    for (let i = 1; i < n; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * cc[i - 1];
      d[i] -= w * d[i - 1];
    }
    m[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) m[i] = (d[i] - cc[i] * m[i + 1]) / b[i];
  }
  return (x: number) => {
    if (x <= 0 || x >= length) return 0;
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const A = (xs[k + 1] - x) / h;
    const B = (x - xs[k]) / h;
    return A * ys[k] + B * ys[k + 1] + (((A * A * A - A) * m[k] + (B * B * B - B) * m[k + 1]) * h * h) / 6;
  };
}

/** The plate with this camber (null or none: straight). */
export function withCamber<T extends { camber?: CamberSpec }>(plate: T, c: CamberSpec | null | undefined): T {
  const next = { ...plate };
  if (c && c.points.length) next.camber = { points: c.points.map((p) => ({ ...p })) };
  else delete next.camber;
  return next;
}

/** What a camber is, in words (for version labels and the log). */
export function describeCamber(c: CamberSpec | null | undefined, length: number): string {
  if (!c || !c.points.length) return 'camber removed (the mid-line is straight)';
  const f = camberFunction(c, length);
  let top = 0;
  let at = 0;
  for (let i = 1; i < 200; i++) {
    const x = (length * i) / 200;
    if (Math.abs(f(x)) > Math.abs(top)) {
      top = f(x);
      at = x;
    }
  }
  return `camber set: a spline through ${c.points.length} control point${c.points.length === 1 ? '' : 's'}, ${Math.abs(top).toFixed(2)} d ${top >= 0 ? 'above' : 'below'} the chord line at its greatest, at x = ${at.toFixed(1)} d from the leading tip`;
}
