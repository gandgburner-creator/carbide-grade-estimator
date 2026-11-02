import type { SurfaceGeometry } from '../geometry/SurfaceGeometry';

/**
 * ============================================================================
 *  REFERENCE AIRFOILS — STARTING BODIES THAT A PERSON CHOOSES
 * ============================================================================
 * Well-known airfoil sections as bodies for the CFD workspace: where a person wants to see how the computed flow treats a section
 * whose reputation they know (high lift, high lift-to-drag at low speed, a symmetric reference), or their own section from a
 * coordinate file. They are DATA (a shape) and nothing else:
 *
 *   - the solver and every decision of the workspace never see where a body came from, and know no airfoil family or lift theory
 *     (tests/reference.guards.test.ts: nothing outside the user interface and this folder imports it);
 *   - nothing here claims that any section is best, or optimal, for anything: the descriptions say what a section is known for, the
 *     numbers on a card are measured from its own coordinates, and what the flow does around it is computed, not looked up;
 *   - no performance number is stored. The CFD run computes its own lift and drag.
 *
 * Where the shapes come from. The sections defined by a published FORMULA are generated exactly (the thickness distribution and the
 * mean-line formulas of the four- and five-digit families, Abbott and von Doenhoff, "Theory of Wing Sections", 1949, with the
 * trailing edge closed to a point): their coordinates are computed here, not copied. Sections that exist only as tables of measured
 * or designed coordinates (Eppler, Selig, Wortmann, Clark Y …) are NOT stored, because they cannot be reproduced from a formula and
 * this program does not invent coordinates: bring the section's own coordinate file (Selig or Lednicer `.dat`, as on the UIUC airfoil
 * database or airfoiltools.com) with the import, and it is used exactly as given.
 */
export interface AirfoilSource {
  kind: 'formula' | 'imported' | 'designed';
  /** where the shape comes from, in words */
  text: string;
}

export interface AirfoilProfile {
  id: string;
  name: string;
  family: string;
  /** what the section is known for (its reputation, not a result of this program) */
  known: string;
  /** which of the person's aims it is usually chosen for */
  aims: AirfoilAim[];
  source: AirfoilSource;
  /** the conditions a designed section was drawn for (the screen offers to set them) */
  designedFor?: { alphaDeg: number; speedKmh: number; text: string };
  /** closed outline, chord normalised to 1 (x from the leading tip to the trailing tip), trailing edge → upper → leading edge → lower → trailing edge, interleaved x, y */
  contour: number[];
}

export type AirfoilAim = 'high-lift' | 'efficiency' | 'symmetric' | 'reference' | 'designed';

// ---- the formulas

type Camber = { yc: (x: number) => number; dyc: (x: number) => number };

/** the thickness distribution of the four- and five-digit families (half thickness at chord position x, closed trailing edge) */
const halfThickness = (t: number, x: number) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);

/** the closed outline of a section from its mean line and maximum thickness (fraction of the chord), with cosine spacing: n + 1 points per side */
function outline(c: Camber, t: number, n = 120): number[] {
  const up: number[] = [];
  const lo: number[] = [];
  for (let k = 0; k <= n; k++) {
    const x = (1 - Math.cos((Math.PI * k) / n)) / 2;
    const yt = halfThickness(t, x);
    const th = Math.atan(c.dyc(x));
    const yc = c.yc(x);
    up.push(x - yt * Math.sin(th), yc + yt * Math.cos(th));
    lo.push(x + yt * Math.sin(th), yc - yt * Math.cos(th));
  }
  // trailing edge → upper surface → leading edge → lower surface → trailing edge (the shared leading point once)
  const v: number[] = [];
  for (let k = n; k >= 0; k--) v.push(up[2 * k], up[2 * k + 1]);
  for (let k = 1; k <= n; k++) v.push(lo[2 * k], lo[2 * k + 1]);
  return v;
}

/**
 * The parameters of a DESIGNED section (not a published one), written for a flow that meets the chord line at a large angle. Its mean line is
 * the sum of two smooth pieces, both leaving the chord line at the leading tip and returning to it at the trailing tip:
 *
 *   - a CAMBER arch  m · x (1 − x)^b, scaled so that its height is `camber` at x = 1 / (1 + b) (a larger b puts the maximum camber further
 *     forward and ends the arch with a gentler slope at the tail);
 *   - a NOSE DROOP  D · x (1 − x / L)³ for x < L (and nothing behind it), whose slope D at the tip is set so that the mean line's TOTAL slope
 *     at the leading tip is `noseDeg` degrees, and which dies out smoothly (slope and curvature) at x = L = `droopLen`.
 *
 * The thickness is the distribution of the four-digit family scaled to the maximum thickness `thickness` (fraction of the chord), with a
 * factor `nose` on its nose coefficient (the nose radius grows with the square of it), and the trailing edge closed to a point.
 */
export interface DesignParams {
  camber: number;
  b: number;
  noseDeg: number;
  droopLen: number;
  thickness: number;
  nose: number;
}

interface MeanLine {
  z: (x: number) => number;
  slope: (x: number) => number;
}

function meanLineOf(d: DesignParams): MeanLine {
  if (!(d.camber >= 0 && d.b > 1 && d.noseDeg >= 0 && d.noseDeg < 60 && d.droopLen > 0.02 && d.droopLen <= 0.4 && d.thickness > 0.02 && d.nose > 0.5)) {
    throw new Error('designed section: camber ≥ 0, camber exponent above 1, a nose slope between 0° and 60°, a droop length of 2 % … 40 % of the chord, thickness above 2 % and a nose factor above 0.5');
  }
  const xm = 1 / (1 + d.b);
  const norm = xm * Math.pow(1 - xm, d.b);
  const k = d.camber / norm;
  const baseSlope0 = k; // slope of m · x (1 − x)^b at x = 0
  const D = Math.max(0, Math.tan((d.noseDeg * Math.PI) / 180) - baseSlope0);
  const L = d.droopLen;
  const z = (x: number) => k * x * Math.pow(1 - x, d.b) + (x < L ? D * x * Math.pow(1 - x / L, 3) : 0);
  const slope = (x: number) => k * (Math.pow(1 - x, d.b) - d.b * x * Math.pow(1 - x, d.b - 1)) + (x < L ? D * (Math.pow(1 - x / L, 3) - (3 * x * Math.pow(1 - x / L, 2)) / L) : 0);
  return { z, slope };
}

/** The shape of a designed section as it is when the body is made of it (chord line from the farthest point to the trailing tip), as angles in degrees. */
export interface DesignReading {
  /** how far the chord line of the finished body is turned from the x axis the mean line was written on (the rounded nose sets its foremost point a little off the axis) */
  chordTiltDeg: number;
  /** the slope of the mean line 0.25 % behind the leading tip, and 95 % along the chord, relative to the finished chord line */
  noseSlopeDeg: number;
  tailSlopeDeg: number;
  /** where the mean line is highest (fraction of the chord) and how high (fraction of the chord, relative to the finished chord line) */
  maxCamberAt: number;
  maxCamber: number;
  /** the angle of zero lift and the lift at `alphaDeg` that the linear thin-section functional gives for this mean line (2π (α − α₀)): a figure for comparing shapes, valid only while the flow stays attached and well above what a real section reaches */
  zeroLiftDeg: number;
  linearLift: number;
}

/**
 * What the mean line of a designed section does in the linear thin-section theory (Glauert; Abbott and von Doenhoff), used ONLY to describe
 * the shapes offered here: it is neither part of the solver nor of any decision of the workspace, and nothing it gives is a result of a run.
 * With x = (1 − cos θ)/2 the first Fourier coefficient of the slope is A₁ = (2/π) ∫ z′ cos θ dθ, the zero-lift angle is the mean slope
 * (1/π) ∫ z′ dθ minus A₁/2, and the lift at an angle α is 2π (α − zero-lift angle).
 */
export function designReading(d: DesignParams, alphaDeg = 18): DesignReading {
  const deg = 180 / Math.PI;
  const ml = meanLineOf(d);
  const c = designedContour(d);
  const n = c.length / 2;
  const te = [(c[0] + c[2 * n - 2]) / 2, (c[1] + c[2 * n - 1]) / 2];
  let le = 0;
  let far = -1;
  for (let i = 0; i < n; i++) {
    const dd = Math.hypot(c[2 * i] - te[0], c[2 * i + 1] - te[1]);
    if (dd > far) {
      far = dd;
      le = i;
    }
  }
  const tilt = Math.atan2(te[1] - c[2 * le + 1], te[0] - c[2 * le]);
  const N = 4000;
  let s0 = 0;
  let s1 = 0;
  let zmax = 0;
  let zAt = 0;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) * Math.PI) / N;
    const x = (1 - Math.cos(th)) / 2;
    const v = Math.atan(ml.slope(x)) - tilt;
    s0 += v;
    s1 += v * Math.cos(th);
    const zz = ml.z(x) - x * Math.tan(tilt); // height above the finished chord line (the line through the leading tip at the tilt)
    if (zz > zmax) {
      zmax = zz;
      zAt = x;
    }
  }
  const alphaI = s0 / N;
  const A1 = (2 * s1) / N;
  const zero = alphaI - A1 / 2;
  return {
    chordTiltDeg: tilt * deg,
    noseSlopeDeg: (Math.atan(ml.slope(0.0025)) - tilt) * deg,
    tailSlopeDeg: (Math.atan(ml.slope(0.95)) - tilt) * deg,
    maxCamberAt: zAt,
    maxCamber: zmax,
    zeroLiftDeg: zero * deg,
    linearLift: 2 * Math.PI * (alphaDeg / deg - zero),
  };
}

export function designedContour(d: DesignParams, n = 140): number[] {
  const ml = meanLineOf(d);
  const yc = ml.z;
  const dyc = ml.slope;
  // the thickness distribution with a modified nose coefficient, rescaled so that its maximum is exactly the thickness asked for
  // (the extra nose term vanishes with its slope at the trailing edge, so the trailing edge stays closed)
  const raw = (x: number) => 0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x + (d.nose - 1) * 0.2969 * Math.sqrt(x) * (1 - x) * (1 - x);
  let peak = 0;
  for (let i = 1; i < 2000; i++) peak = Math.max(peak, raw(i / 2000));
  const scale = d.thickness / (2 * peak);
  const yt = (x: number) => scale * raw(x);
  const up: number[] = [];
  const lo: number[] = [];
  for (let k = 0; k <= n; k++) {
    const x = (1 - Math.cos((Math.PI * k) / n)) / 2;
    const h = yt(x);
    const th = Math.atan(dyc(x));
    const c = yc(x);
    up.push(x - h * Math.sin(th), c + h * Math.cos(th));
    lo.push(x + h * Math.sin(th), c - h * Math.cos(th));
  }
  const v: number[] = [];
  for (let k = n; k >= 0; k--) v.push(up[2 * k], up[2 * k + 1]);
  for (let k = 1; k <= n; k++) v.push(lo[2 * k], lo[2 * k + 1]);
  return v;
}

/** four-digit family: maximum camber m (fraction), its position p (fraction), thickness t (fraction) */
export function fourDigit(m: number, p: number, t: number, n = 120): number[] {
  const yc = (x: number) => (m === 0 || p === 0 ? 0 : x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) * (1 - p))) * (1 - 2 * p + 2 * p * x - x * x));
  const dyc = (x: number) => (m === 0 || p === 0 ? 0 : x < p ? ((2 * m) / (p * p)) * (p - x) : ((2 * m) / ((1 - p) * (1 - p))) * (p - x));
  return outline({ yc, dyc }, t, n);
}

/** the standard (not reflexed) five-digit mean lines: position of the maximum camber p = digit pair / 20, and the constants r and k₁ of each */
const FIVE_DIGIT_LINES: Record<string, { r: number; k1: number }> = {
  '10': { r: 0.058, k1: 361.4 },
  '20': { r: 0.126, k1: 51.64 },
  '30': { r: 0.2025, k1: 15.957 },
  '40': { r: 0.29, k1: 6.643 },
  '50': { r: 0.391, k1: 3.23 },
};

/** five-digit family, standard mean line, e.g. "23012": design lift coefficient 0.3, camber line 30, thickness 12 % */
export function fiveDigit(code: string, n = 120): number[] {
  if (!/^[0-9]{5}$/.test(code) || code[0] !== '2') throw new Error('a five-digit code starts with 2 (design lift coefficient 0.3), then the mean-line pair 10, 20, 30, 40 or 50, then the thickness: for example 23012');
  const line = FIVE_DIGIT_LINES[code.slice(1, 3)];
  if (!line) throw new Error(`the mean line ${code.slice(1, 3)} is not one of the standard 10, 20, 30, 40, 50 (reflexed lines, with a 1 as third digit, are not offered)`);
  const t = Number(code.slice(3)) / 100;
  if (!(t > 0)) throw new Error('the thickness (the last two digits) must be at least 01');
  const { r, k1 } = line;
  const yc = (x: number) => (x < r ? (k1 / 6) * (x ** 3 - 3 * r * x * x + r * r * (3 - r) * x) : ((k1 * r ** 3) / 6) * (1 - x));
  const dyc = (x: number) => (x < r ? (k1 / 6) * (3 * x * x - 6 * r * x + r * r * (3 - r)) : (-k1 * r ** 3) / 6);
  return outline({ yc, dyc }, t, n);
}

/** A section from its four- or five-digit code ("4412", "0012", "23012"); throws an Error that says what is wrong. */
export function sectionFromCode(raw: string): AirfoilProfile {
  const code = raw.replace(/\s+/g, '').replace(/^naca/i, '');
  if (/^[0-9]{4}$/.test(code)) {
    const m = Number(code[0]) / 100;
    const p = Number(code[1]) / 10;
    const t = Number(code.slice(2)) / 100;
    if (!(t > 0)) throw new Error('the thickness (the last two digits) must be at least 01');
    if (m > 0 && p === 0) throw new Error('a cambered four-digit section needs its position of maximum camber (the second digit) to be 1 … 9');
    return { id: `4-${code}`, name: `NACA ${code}`, family: 'four-digit', known: describeFourDigit(m, p, t), aims: aimsOf(m, t), source: { kind: 'formula', text: 'the published four-digit thickness distribution and mean line (Abbott and von Doenhoff, 1949), trailing edge closed; computed, not copied' }, contour: fourDigit(m, p, t) };
  }
  if (/^[0-9]{5}$/.test(code)) {
    const contour = fiveDigit(code);
    const t = Number(code.slice(3)) / 100;
    return { id: `5-${code}`, name: `NACA ${code}`, family: 'five-digit', known: 'a five-digit section: its maximum camber lies far forward (a standard mean line of design lift coefficient 0.3), which gives a high maximum lift for its thickness and a small pitching moment', aims: aimsOf(0.02, t), source: { kind: 'formula', text: 'the published five-digit thickness distribution and standard mean line (Abbott and von Doenhoff, 1949), trailing edge closed; computed, not copied' }, contour };
  }
  throw new Error('a section code has four digits (like 4412 or 0012) or five (like 23012)');
}

function describeFourDigit(m: number, p: number, t: number): string {
  if (m === 0) return `a symmetric section, ${Math.round(t * 100)} % thick: no lift at zero angle, the same behaviour up and down; the usual reference for a study of the effect of angle alone`;
  const c = Math.round(m * 100);
  const where = Math.round(p * 100);
  return `${c} % camber with its maximum at ${where} % of the chord, ${Math.round(t * 100)} % thick: ${c >= 6 ? 'strongly cambered, a section chosen where a large lift coefficient at low speed is wanted' : c >= 4 ? 'clearly cambered, more lift at a given angle than a lightly cambered section, and more drag' : 'lightly cambered, lift at zero angle with low drag over a wide range of angles'}`;
}

function aimsOf(m: number, t: number): AirfoilAim[] {
  if (m === 0) return ['symmetric', 'reference'];
  const a: AirfoilAim[] = [];
  if (m >= 0.04) a.push('high-lift');
  if (m <= 0.04 && t <= 0.12) a.push('efficiency');
  if (!a.length) a.push('reference');
  return a;
}

const preset = (code: string, extra?: Partial<Pick<AirfoilProfile, 'known' | 'aims'>>): AirfoilProfile => ({ ...sectionFromCode(code), ...extra });

// ---- Claude's designs for 18° at 350 km/h

/** The condition the three designed sections were drawn for: an angle of attack of 18° in a flow of 350 km/h (97.2 m/s; Mach 0.29 in air at 15 °C at sea level; Reynolds number 1.3 million on a 20 cm chord). */
export const CLAUDE_CONDITION = { alphaDeg: 18, speedKmh: 350 } as const;

/** The parameters of the three designed sections, in the order of their names. */
export const CLAUDE_DESIGNS: { letter: 'A' | 'B' | 'C'; params: DesignParams; idea: string; risk: string }[] = [
  {
    letter: 'A',
    params: { camber: 0.045, b: 2.3, noseDeg: 22, droopLen: 0.1, thickness: 0.09, nose: 1.3 },
    idea: 'the balanced attempt: moderate thickness, a camber arch with its maximum about a third back, and a nose turned down so that it points roughly along the flow that arrives at 18°',
    risk: 'at this angle the upper surface still has a long pressure recovery behind the maximum camber, and the flow may separate from the rear of it before the nose does',
  },
  {
    letter: 'B',
    params: { camber: 0.035, b: 2.8, noseDeg: 20, droopLen: 0.08, thickness: 0.065, nose: 1.5 },
    idea: 'the lean attempt: thin, less camber, almost flat tail, the same turned-down nose; the least drag of the three if the flow stays attached, because the section is thin and the tail has little curvature',
    risk: 'a thin nose with a small radius is the first to separate when the flow angle is a little off, and its lift is the lowest of the three; the lattice of the workspace resolves a nose radius this small only at its finest settings (the card says how many cells it takes)',
  },
  {
    letter: 'C',
    params: { camber: 0.05, b: 1.5, noseDeg: 18, droopLen: 0.14, thickness: 0.12, nose: 1.25 },
    idea: 'the tolerant attempt: thick, with a large nose radius, the most camber with its maximum 41 % back and a tail that falls away at about 4°; the most lift of the three for the same angle, and the most forgiving of an angle that is not the design angle',
    risk: 'its thickness and its camber cost drag, and the long way the tail has to turn the flow back is where it is most likely to separate',
  },
];

function claudeSection(c: (typeof CLAUDE_DESIGNS)[number]): AirfoilProfile {
  const r = designReading(c.params, CLAUDE_CONDITION.alphaDeg);
  const p = c.params;
  const pc = (v: number) => (100 * v).toFixed(1);
  return {
    id: `claude-${c.letter.toLowerCase()}`,
    name: `Claude airfoil ${c.letter}`,
    family: 'designed for 18° at 350 km/h',
    known: `a section drawn by Claude for this program, for an angle of attack of 18° in a flow of 350 km/h: ${c.idea}. Its mean line leaves the chord line at ${r.noseSlopeDeg.toFixed(0)}° at the nose and ${r.tailSlopeDeg < -0.5 ? `leaves the tail at ${Math.abs(r.tailSlopeDeg).toFixed(1)}° downward` : 'ends almost flat'}; its maximum camber is ${pc(r.maxCamber)} % at ${Math.round(100 * r.maxCamberAt)} % of the chord. THIS IS A HYPOTHESIS, not a result: the shape was chosen by reasoning about the nose and the pressure recovery (and the linear thin-section figures of the mean line: zero-lift angle ${r.zeroLiftDeg.toFixed(1)}°, so a lift coefficient of ${r.linearLift.toFixed(1)} at 18° if the flow stayed attached, which no real section reaches), no solver was run at 350 km/h, no section was compared with others over a range of conditions, so it is not shown to be the best for 18° and may well be beaten by a section from the list. The risk of this one: ${c.risk}`,
    aims: ['designed'],
    source: { kind: 'designed', text: `designed here, not published: the mean line m·x(1−x)^b (m = ${pc(p.camber)} %, b = ${p.b}) plus a nose droop that makes its slope ${p.noseDeg}° at the tip and dies out over ${Math.round(100 * p.droopLen)} % of the chord, with the four-digit thickness distribution scaled to ${pc(p.thickness)} % and its nose coefficient multiplied by ${p.nose}; trailing edge closed to a point; computed, not copied` },
    designedFor: { ...CLAUDE_CONDITION, text: 'an angle of attack of 18° and a flow of 350 km/h (97.2 m/s, Mach 0.29 in air at 15 °C at sea level, Reynolds number about 1.3 million on a 20 cm chord)' },
    contour: designedContour(p),
  };
}

/** Claude's three designed sections, named "Claude airfoil A", "B" and "C". */
export const CLAUDE_AIRFOILS: AirfoilProfile[] = CLAUDE_DESIGNS.map(claudeSection);

/** The sections offered as presets: Claude's three designs, then sections from published formulas. Which is "best" is not decided here: a run computes it. */
export const AIRFOIL_PRESETS: AirfoilProfile[] = [
  ...CLAUDE_AIRFOILS,
  preset('4412'),
  preset('6409', { aims: ['high-lift', 'efficiency'] }),
  preset('6412'),
  preset('9412', { known: 'the most strongly cambered of the common four-digit sections (9 % camber at 40 % chord, 12 % thick): a very large lift coefficient at small angles, with high drag and a strong nose-down pitching moment' }),
  preset('23012', { aims: ['high-lift', 'efficiency'] }),
  preset('23015', { aims: ['high-lift'] }),
  preset('2412', { aims: ['efficiency', 'reference'] }),
  preset('2409', { aims: ['efficiency'] }),
  preset('4409', { aims: ['efficiency', 'high-lift'] }),
  preset('2415'),
  preset('0006'),
  preset('0009'),
  preset('0012'),
  preset('0015'),
];

// ---- from a coordinate file

export interface ParsedDat {
  name: string;
  contour: number[];
  format: 'Selig' | 'Lednicer';
  notes: string[];
}

/**
 * Read a coordinate file in Selig format (a name line, then the points from the trailing edge along the upper surface to the leading
 * edge and back along the lower surface) or Lednicer format (a name line, a line with the numbers of upper and lower points, the upper
 * surface from the leading edge, then the lower). Coordinates in percent of the chord are recognised. Throws an Error that says what is
 * wrong.
 */
export function parseAirfoilDat(text: string): ParsedDat {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length) throw new Error('the file is empty');
  const nums = (l: string): number[] | null => {
    const p = l.replace(/,/g, ' ').split(/\s+/);
    if (p.length < 2 || p.length > 3) return null;
    const v = p.map(Number);
    return v.every((x) => Number.isFinite(x)) ? v : null;
  };
  let name = 'imported airfoil';
  let at = 0;
  if (nums(lines[0]) === null) {
    name = lines[0].replace(/\s+/g, ' ');
    at = 1;
  }
  const notes: string[] = [];
  let format: ParsedDat['format'] = 'Selig';
  let pts: [number, number][] = [];
  const second = lines[at] ? nums(lines[at]) : null;
  const isCounts = second !== null && second.length === 2 && second[0] >= 3 && second[1] >= 3 && Number.isInteger(second[0]) && Number.isInteger(second[1]);
  if (isCounts) {
    format = 'Lednicer';
    const nu = second![0];
    const nl = second![1];
    const body = lines.slice(at + 1).map(nums).filter((v): v is number[] => v !== null);
    if (body.length < nu + nl) throw new Error(`a Lednicer file that announces ${nu} upper and ${nl} lower points has only ${body.length} coordinate lines`);
    const upper = body.slice(0, nu).map((v): [number, number] => [v[0], v[1]]);
    const lower = body.slice(nu, nu + nl).map((v): [number, number] => [v[0], v[1]]);
    pts = [...upper.reverse(), ...lower.slice(1)];
  } else {
    for (const l of lines.slice(at)) {
      const v = nums(l);
      if (v) pts.push([v[0], v[1]]);
      else if (pts.length) break;
    }
  }
  if (pts.length < 20) throw new Error(`only ${pts.length} coordinate points were found: a section needs at least 20 (Selig or Lednicer format, two numbers per line)`);
  if (pts.length > 2000) throw new Error('more than 2000 points: please thin the file');
  const xmax = Math.max(...pts.map((p) => p[0]));
  if (xmax > 5) {
    pts = pts.map(([x, y]) => [x / xmax, y / xmax]);
    notes.push('the coordinates looked like percent of the chord and were divided by their largest x');
  }
  const contour: number[] = [];
  for (const [x, y] of pts) contour.push(x, y);
  return { name, contour, format, notes };
}

// ---- from an outline to the body of the CFD workspace

export interface AirfoilMetrics {
  /** maximum thickness and where it is, as fractions of the chord */
  thickness: number;
  thicknessAt: number;
  /** maximum camber (of the mid-line between the two surfaces) and where it is */
  camber: number;
  camberAt: number;
  /** the gap between the two surfaces at the trailing edge before it was closed, and the radius of the nose estimated from the first stations, fractions of the chord */
  trailingGap: number;
  noseRadius: number;
}

export interface AirfoilBody {
  geometry: SurfaceGeometry;
  metrics: AirfoilMetrics;
  notes: string[];
}

/** Interpolate y at x on a branch with ascending x. */
function atX(b: [number, number][], x: number): number {
  let lo = 0;
  let hi = b.length - 1;
  if (x <= b[0][0]) return b[0][1];
  if (x >= b[hi][0]) return b[hi][1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (b[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - b[lo][0]) / (b[hi][0] - b[lo][0] || 1);
  return b[lo][1] + f * (b[hi][1] - b[lo][1]);
}

/** a branch with strictly ascending x: points that go back (the curl of a cambered nose, noise) are dropped */
function ascending(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) if (!out.length || p[0] > out[out.length - 1][0] + 1e-9) out.push(p);
  return out;
}

/**
 * The body of a section in the workspace's own representation: two surfaces as heights at shared stations along the chord, with the two
 * sides meeting in a point at the leading and the trailing edge. The outline is turned and scaled so that its leading point is the origin and its
 * trailing point lies on the x axis (the chord line), so the angle of attack of a run is the angle of the chord line. `chord` is the body's length in plate units, `stations` the number per
 * side (cosine spaced, closer together at the two ends). Throws an Error that says what is wrong with the outline.
 */
export function airfoilBody(contour: number[], chord = 30, stations = 160): AirfoilBody {
  const n = contour.length / 2;
  if (!(n >= 20)) throw new Error('an outline needs at least 20 points');
  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) raw.push([contour[2 * i], contour[2 * i + 1]]);
  // the trailing edge is where the outline starts and ends, the leading edge the point farthest from it, the chord the line between them
  const te: [number, number] = [(raw[0][0] + raw[n - 1][0]) / 2, (raw[0][1] + raw[n - 1][1]) / 2];
  let le = 0;
  let far = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(raw[i][0] - te[0], raw[i][1] - te[1]);
    if (d > far) {
      far = d;
      le = i;
    }
  }
  if (!(far > 0.2)) throw new Error('the outline has no usable length (its leading edge is closer than 0.2 to its trailing edge)');
  if (le < 5 || le > n - 6) throw new Error('the leading edge is not inside the outline: the points must run from the trailing edge along one surface to the leading edge and back along the other');
  // turn and scale the outline so that the leading point is (0, 0) and the trailing point (1, 0): the angle of attack is then that of the chord line
  const ang = Math.atan2(te[1] - raw[le][1], te[0] - raw[le][0]);
  const ca = Math.cos(-ang);
  const sa = Math.sin(-ang);
  const pts = raw.map(([x, y]): [number, number] => {
    const dx = x - raw[le][0];
    const dy = y - raw[le][1];
    return [(dx * ca - dy * sa) / far, (dx * sa + dy * ca) / far];
  });
  const a = pts.slice(0, le + 1).reverse(); // from the leading edge along the first branch to the trailing edge
  const b = pts.slice(le);
  const mean = (br: [number, number][]) => br.reduce((s, p) => s + p[1], 0) / br.length;
  const [upperB, lowerB] = mean(a) >= mean(b) ? [ascending(a), ascending(b)] : [ascending(b), ascending(a)];
  if (upperB.length < 8 || lowerB.length < 8) throw new Error('a surface of the outline has fewer than 8 points with increasing x: the outline folds back on itself');
  const notes: string[] = [];
  const te0 = upperB[upperB.length - 1][1] - lowerB[lowerB.length - 1][1];
  if (te0 < -0.01) throw new Error('the upper surface lies below the lower one at the trailing edge: the points are not an airfoil outline');
  if (Math.abs(te0) > 0.003) notes.push(`the trailing edge was open by ${(100 * Math.abs(te0)).toFixed(2)} % of the chord; it is closed to a point (the lattice cannot see a gap this small)`);
  const xs: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  for (let k = 0; k <= stations; k++) {
    const x = (1 - Math.cos((Math.PI * k) / stations)) / 2;
    xs.push(x * chord);
    if (k === 0 || k === stations) {
      upper.push(0);
      lower.push(0);
    } else {
      upper.push(atX(upperB, x) * chord);
      lower.push(atX(lowerB, x) * chord);
    }
  }
  // the sides must not cross
  let worst = 0;
  for (let k = 1; k < stations; k++) worst = Math.min(worst, upper[k] - lower[k]);
  if (worst < -1e-6 * chord) throw new Error('the two surfaces of the outline cross each other: it is not a simple airfoil outline');
  for (let k = 1; k < stations; k++) if (upper[k] < lower[k]) upper[k] = lower[k] = (upper[k] + lower[k]) / 2;
  // what the section is, measured from its own coordinates (heights relative to the chord line)
  let thickness = 0;
  let thicknessAt = 0;
  let camber = 0;
  let camberAt = 0;
  for (let k = 0; k <= stations; k++) {
    const th = (upper[k] - lower[k]) / chord;
    if (th > thickness) {
      thickness = th;
      thicknessAt = xs[k] / chord;
    }
    const cm = (upper[k] + lower[k]) / 2 / chord;
    if (Math.abs(cm) > Math.abs(camber)) {
      camber = cm;
      camberAt = xs[k] / chord;
    }
  }
  // the nose radius from the surface heights at x = 0.5 % of the chord: for a circle y² ≈ 2 r x
  const yHalf = (atX(upperB, 0.005) - atX(lowerB, 0.005)) / 2;
  const noseRadius = (yHalf * yHalf) / (2 * 0.005);
  const g: SurfaceGeometry = { chord, stations, upper, lower, xs, pointedEnds: true };
  return { geometry: g, metrics: { thickness, thicknessAt, camber, camberAt, trailingGap: Math.abs(te0), noseRadius }, notes };
}

/** "12.0 % thick at 30 % chord, 4.0 % camber at 40 %" */
export function describeMetrics(m: AirfoilMetrics): string {
  const pc = (v: number) => (100 * v).toFixed(1);
  return `${pc(m.thickness)} % thick at ${Math.round(100 * m.thicknessAt)} % of the chord, ${pc(Math.abs(m.camber))} % camber at ${Math.round(100 * m.camberAt)} %${m.camber < 0 ? ' (negative: curved the other way)' : ''}, nose radius ${pc(m.noseRadius)} % of the chord`;
}
