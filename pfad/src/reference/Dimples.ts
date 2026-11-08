import type { SurfaceGeometry } from '../geometry/SurfaceGeometry';
import { airfoilBody, type AirfoilBody } from './Airfoils';

/**
 * ============================================================================
 *  DIMPLES — A DIMPLED VERSION OF ANY SECTION OF THE LIST
 * ============================================================================
 * A golf ball is covered with shallow round dimples; the idea tried here is the same on a wing section. A dimpled version of a section
 * is that section with a row of spherical-cap dents pressed into its upper and/or lower surface, along a stretch of the chord the
 * person chooses, with the SIZE of the dents (diameter along the chord and depth) and their DENSITY (the share of the stretch they
 * cover, which sets the spacing between them) chosen too. It is a SHAPE and nothing else, like every body of the list:
 * the solver does not know it is looking at a dimpled section, and no performance number is stored. What the flow does around it is computed.
 *
 * What a dimple is in a two-dimensional computation. The section is a slice of a wing, and a dimple on a wing is a round dent. Cut by the
 * plane of the slice, a round dent shows as a circular notch in the outline, and the CFD workspace is two-dimensional, so a notch in the
 * outline is a dent that is stretched along the whole span: a GROOVE across the wing, not a round dimple. The three-dimensional flow
 * in and around a round dimple (the vortices it throws off, its way of making the boundary layer turbulent, the drag crisis of a
 * sphere, which sets in at Reynolds numbers of tens of thousands to a few hundred thousand) cannot be shown by a two-dimensional
 * lattice that runs at Reynolds numbers below about two thousand. The dimpled versions are offered to see what the computed flow
 * does with such a surface, and the notes in the program say so; nothing here claims that dimples lower the drag of a wing.
 *
 * The shape. A dimple is a circular segment: its diameter d is its width along the chord, its depth h = depthRatio · d is measured
 * along the surface normal (a half-sphere is depthRatio 0.5). Along the chosen stretch the dimples are placed at equal pitch d / coverage,
 * the whole row centred in the stretch; coverage 1 means the dimples touch, 0.5 means the gaps are as wide as the dimples.
 */
export type DimpleSide = 'upper' | 'lower' | 'both';

export interface DimpleSpec {
  surface: DimpleSide;
  /** width of a dimple along the chord, fraction of the chord */
  diameter: number;
  /** depth as a fraction of the diameter (a circular segment: 0.5 is a half circle) */
  depthRatio: number;
  /** the share of the covered stretch that dimples occupy: the pitch (centre to centre) is diameter / coverage */
  coverage: number;
  /** the stretch of the chord that carries dimples, fractions of the chord, from < to */
  from: number;
  to: number;
}

export const DIMPLE_LIMITS = {
  diameter: [0.015, 0.2],
  depthRatio: [0.02, 0.5],
  coverage: [0.1, 1],
  from: 0.02,
  to: 0.98,
} as const;

/** The input boxes as text (percent), so that a person can type; `parseDimples` turns them into a spec or says what is wrong. */
export interface DimpleTexts {
  surface: DimpleSide;
  diameterPct: string;
  depthPct: string;
  coveragePct: string;
  fromPct: string;
  toPct: string;
}

export const DEFAULT_DIMPLE_TEXTS: DimpleTexts = { surface: 'upper', diameterPct: '4', depthPct: '10', coveragePct: '70', fromPct: '8', toPct: '92' };

export const dimpleTextsOf = (s: DimpleSpec): DimpleTexts => ({
  surface: s.surface,
  diameterPct: String(round(100 * s.diameter, 3)),
  depthPct: String(round(100 * s.depthRatio, 3)),
  coveragePct: String(round(100 * s.coverage, 3)),
  fromPct: String(round(100 * s.from, 3)),
  toPct: String(round(100 * s.to, 3)),
});

function round(v: number, d: number) {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Ready-made settings (starting points, not recommendations: nobody has shown them to help a wing). */
export const DIMPLE_PRESETS: { id: string; label: string; spec: DimpleSpec }[] = [
  { id: 'golf', label: 'golf-ball-like: medium, shallow, close together', spec: { surface: 'upper', diameter: 0.04, depthRatio: 0.1, coverage: 0.75, from: 0.08, to: 0.92 } },
  { id: 'fine', label: 'fine and dense: small, many', spec: { surface: 'upper', diameter: 0.02, depthRatio: 0.15, coverage: 0.85, from: 0.08, to: 0.92 } },
  { id: 'coarse', label: 'coarse and sparse: large, few', spec: { surface: 'upper', diameter: 0.08, depthRatio: 0.15, coverage: 0.5, from: 0.1, to: 0.9 } },
  { id: 'both', label: 'medium on both surfaces', spec: { surface: 'both', diameter: 0.05, depthRatio: 0.12, coverage: 0.7, from: 0.1, to: 0.9 } },
];

export type DimpleCheck = { ok: true; spec: DimpleSpec } | { ok: false; errors: string[] };

/** The settings as a spec, or what is wrong with them in words. */
export function parseDimples(t: DimpleTexts): DimpleCheck {
  const errors: string[] = [];
  const num = (name: string, s: string, lo: number, hi: number, unit = '%'): number => {
    const v = Number(s.trim().replace(',', '.'));
    if (!s.trim() || !Number.isFinite(v)) {
      errors.push(`${name}: “${s}” is not a number`);
      return Number.NaN;
    }
    if (v < lo - 1e-9 || v > hi + 1e-9) errors.push(`${name} ${v}${unit} is outside ${round(lo, 3)} … ${round(hi, 3)}${unit}`);
    return v;
  };
  const L = DIMPLE_LIMITS;
  const diameter = num('dimple diameter', t.diameterPct, 100 * L.diameter[0], 100 * L.diameter[1]) / 100;
  const depthRatio = num('dimple depth', t.depthPct, 100 * L.depthRatio[0], 100 * L.depthRatio[1]) / 100;
  const coverage = num('density (share covered)', t.coveragePct, 100 * L.coverage[0], 100 * L.coverage[1]) / 100;
  const from = num('start of the stretch', t.fromPct, 100 * L.from, 100 * L.to) / 100;
  const to = num('end of the stretch', t.toPct, 100 * L.from, 100 * L.to) / 100;
  if (!['upper', 'lower', 'both'].includes(t.surface)) errors.push('surface must be upper, lower or both');
  if (!errors.length) {
    if (!(from < to)) errors.push('the stretch must end after it starts');
    else if (to - from < diameter) errors.push(`the stretch (${round(100 * (to - from), 1)} % of the chord) is shorter than one dimple (${round(100 * diameter, 1)} %)`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, spec: { surface: t.surface, diameter, depthRatio, coverage, from, to } };
}

/** The chord positions (fractions) of the dimple centres: equal pitch d / coverage, the row centred in the stretch. */
export function dimpleCentres(s: DimpleSpec): number[] {
  const pitch = s.diameter / s.coverage;
  const span = s.to - s.from;
  if (span < s.diameter) return [];
  const n = Math.floor((span - s.diameter) / pitch + 1e-9) + 1;
  const first = s.from + s.diameter / 2 + (span - s.diameter - (n - 1) * pitch) / 2;
  return Array.from({ length: n }, (_, i) => first + i * pitch);
}

/** The depth of one dimple at distance u from its centre (u and the result in the same unit as d): a circular segment of width d and depth h. */
export function capDepth(u: number, d: number, h: number): number {
  if (Math.abs(u) >= d / 2 || !(h > 0)) return 0;
  const R = (d * d) / 4 / (2 * h) + h / 2;
  return Math.max(0, Math.sqrt(R * R - u * u) - (R - h));
}

/** Short words for a setting: used in names and tables. */
export function dimpleLabel(s: DimpleSpec): string {
  const p = (v: number) => String(round(100 * v, 1));
  return `dimples ${s.surface === 'both' ? 'both sides' : s.surface} ⌀${p(s.diameter)} % depth ${p(s.depthRatio)} % of ⌀ cover ${p(s.coverage)} % over ${p(s.from)}–${p(s.to)} %`;
}

/** The settings in a few words, for the name of a dimpled body: unique to the settings, so two dimpled versions of one section stay apart in a table. */
export function dimpleShort(s: DimpleSpec): string {
  const p = (v: number) => String(round(100 * v, 1));
  return `⌀${p(s.diameter)} %, depth ${p(s.depthRatio)} %, ${p(s.coverage)} % cover, ${p(s.from)}–${p(s.to)} %${s.surface === 'upper' ? '' : s.surface === 'both' ? ', both sides' : ', lower'}`;
}

/** The number of stations per side that a section needs so that its dimples are drawn by at least about six stations across (stations are cosine spaced: the widest spacing is π / (2 n) of the chord). */
export function stationsFor(s: DimpleSpec): number {
  return Math.min(900, Math.max(160, Math.ceil((3 * Math.PI) / s.diameter)));
}

/** What was made, measured from the finished coordinates. */
export interface DimpleRecord {
  spec: DimpleSpec;
  /** dimples on each dimpled surface */
  count: number;
  /** centre-to-centre distance, fraction of the chord */
  pitch: number;
  /** stations per side of the finished body */
  stations: number;
  /** the surface length of the dimpled surfaces compared with the same surfaces before the dimples, minus 1 (more wetted length) */
  surfaceGain: number;
  /** stations where a dimple was made shallower because the section is too thin there to hold it */
  thinned: number;
  label: string;
}

export interface DimpledBody {
  body: AirfoilBody;
  record: DimpleRecord;
}

const MIN_GAP = 0.006;

/**
 * Press the dimples into a body. Each dimple's depth is measured along the surface normal (the displacement in y is the depth times √(1 + s²) for a
 * surface of slope s), where the section is thinner than twice the depth plus a small gap the dimple is made shallower, and the ends of the
 * section (the first and last 2 % of the chord) are never touched.
 */
export function applyDimples(g: SurfaceGeometry, s: DimpleSpec): { geometry: SurfaceGeometry; record: Omit<DimpleRecord, 'label'> } {
  const xs = g.xs ?? Array.from({ length: g.stations + 1 }, (_, i) => (i * g.chord) / g.stations);
  const n = g.stations;
  const centres = dimpleCentres(s);
  const h = s.depthRatio * s.diameter;
  const slopeAt = (y: number[], k: number) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(n, k + 1);
    return (y[b] - y[a]) / (xs[b] - xs[a] || 1);
  };
  const depthAt = (k: number) => {
    const c = xs[k] / g.chord;
    let deepest = 0;
    for (const ctr of centres) {
      const u = c - ctr;
      if (Math.abs(u) < s.diameter / 2) deepest = Math.max(deepest, capDepth(u, s.diameter, h));
    }
    return deepest * g.chord;
  };
  const upper = g.upper.slice();
  const lower = g.lower.slice();
  const du = new Array<number>(n + 1).fill(0);
  const dl = new Array<number>(n + 1).fill(0);
  for (let k = 1; k < n; k++) {
    const depth = depthAt(k);
    if (!(depth > 0)) continue;
    if (s.surface !== 'lower') du[k] = depth * Math.sqrt(1 + slopeAt(g.upper, k) ** 2);
    if (s.surface !== 'upper') dl[k] = depth * Math.sqrt(1 + slopeAt(g.lower, k) ** 2);
  }
  let thinned = 0;
  for (let k = 1; k < n; k++) {
    if (!(du[k] > 0 || dl[k] > 0)) continue;
    const gap0 = g.upper[k] - g.lower[k];
    const allowed = Math.max(0, gap0 - MIN_GAP * g.chord);
    const asked = du[k] + dl[k];
    const f = asked > allowed ? allowed / asked : 1;
    if (f < 1) thinned++;
    upper[k] = g.upper[k] - f * du[k];
    lower[k] = g.lower[k] + f * dl[k];
  }
  const length = (y: number[]) => {
    let L = 0;
    for (let k = 0; k < n; k++) L += Math.hypot(xs[k + 1] - xs[k], y[k + 1] - y[k]);
    return L;
  };
  let before = 0;
  let after = 0;
  if (s.surface !== 'lower') {
    before += length(g.upper);
    after += length(upper);
  }
  if (s.surface !== 'upper') {
    before += length(g.lower);
    after += length(lower);
  }
  const geometry: SurfaceGeometry = { ...g, upper, lower, xs };
  return { geometry, record: { spec: s, count: centres.length, pitch: s.diameter / s.coverage, stations: n, surfaceGain: before > 0 ? after / before - 1 : 0, thinned } };
}

/** A section's body with the dimples pressed in, and what was made. The numbers of `body.metrics` are those of the section before the dimples. Throws an Error that says what is wrong. */
export function dimpledBody(contour: number[], s: DimpleSpec, chord = 30): DimpledBody {
  const base = airfoilBody(contour, chord, stationsFor(s));
  const { geometry, record } = applyDimples(base.geometry, s);
  const label = dimpleLabel(s);
  const notes = [...base.notes];
  if (record.count === 0) throw new Error('no dimple fits in the stretch');
  if (record.thinned > 0) notes.push(`the section is too thin to hold the dimples at ${record.thinned} stations: they are shallower there`);
  return { body: { ...base, geometry, notes }, record: { ...record, label } };
}

/** What the lattice can and cannot resolve of the dimples at a resolution, in words (empty when nothing needs saying). */
export function dimpleAdvice(s: DimpleSpec, cells: number): string[] {
  const out: string[] = [];
  const depthCells = s.depthRatio * s.diameter * cells;
  const widthCells = s.diameter * cells;
  const need = Math.ceil(1.5 / (s.depthRatio * s.diameter) / 16) * 16;
  if (depthCells < 0.5) out.push(`the dimples are only ${depthCells.toFixed(2)} lattice cells deep at ${cells} cells along the chord: smaller than the lattice can see, so the surface shows as a stair-step roughness and not as dimples (${need > 256 ? 'more than 256 cells would be needed for 1.5 cells of depth: make the dimples deeper or larger' : `${need} cells along the chord give 1.5 cells of depth`})`);
  else if (depthCells < 1.5) out.push(`the dimples are ${depthCells.toFixed(2)} lattice cells deep at ${cells} cells along the chord: barely resolved (${need > 256 ? 'more than 256 cells would be needed for 1.5 cells of depth: make the dimples deeper or larger' : `${need} cells give 1.5 cells of depth`})`);
  if (widthCells < 4) out.push(`a dimple is ${widthCells.toFixed(1)} cells wide: its shape is not resolved (at least 4 cells are needed)`);
  return out;
}

/** The two-dimensional caveat, in words, for the screen and the record. */
export const DIMPLES_2D_NOTE =
  'In this two-dimensional computation a dimple is a notch in the outline that runs along the whole span, a groove across the wing, not a round dent. The flow in and around a round dimple (its vortices, the way it makes a boundary layer turbulent, the drag crisis of a sphere that sets in at Reynolds numbers of tens of thousands) is three-dimensional and lies beyond a lattice that runs below Reynolds number 2000. What a run shows is what the computed flow does with this grooved surface, not whether dimples help a wing.';
