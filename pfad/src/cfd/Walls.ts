import { place, stationX, type Placement, type Side, type SurfaceGeometry } from '../geometry/SurfaceGeometry';

/**
 * Near-wall sampling of a CFD velocity field along the normals of the body surface (lattice coordinates; node (i, j) at
 * (i + ½, j + ½)). Per STATION (one segment of the surface polyline, as in the particle workspace) it reads the velocity along
 * the outward normal at distances d = d₁, d₂, … from the wall and projects it on the downstream tangent (leading → trailing
 * edge), giving the profile u_t(d) of the flow beside the wall. From a profile:
 *
 *   wall shear   τ = ρ ν ∂u_t/∂n at the wall, from the one-sided second-order difference through u(0) = 0, u(d₁), u(2 d₁)
 *   dividing streamline  the height h at which the flux Q(d) = ∫₀ᵈ u_t dn, after a stretch of reversed flow (Q < 0), returns to zero:
 *                the surface of zero net flux that bounds a recirculating region (the same definition as in the particle workspace)
 *
 * The profile is read from a time-mean field, so a reversed u_t is mean backflow. Nothing here assumes where a flow separates:
 * the sign of τ (a fact of the field) decides, station by station.
 */
export interface WallStation {
  side: Side;
  /** body-frame x of the station centre (leading tip = 0) */
  x: number;
  /** length of the segment in lattice cells */
  length: number;
  /** centre, downstream tangent and outward normal in lattice coordinates */
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  nx: number;
  ny: number;
}

export function wallStations(g: SurfaceGeometry, pl: Placement, cellsPerUnit: number): Record<Side, WallStation[]> {
  const xs = stationX(g);
  const out = {} as Record<Side, WallStation[]>;
  for (const side of ['upper', 'lower'] as const) {
    const y = side === 'upper' ? g.upper : g.lower;
    const body: number[] = [];
    for (let i = 0; i <= g.stations; i++) body.push(xs[i], y[i]);
    const p = place(body, pl).map((v) => v * cellsPerUnit);
    const outward = side === 'upper' ? 1 : -1;
    const list: WallStation[] = [];
    for (let k = 0; k < g.stations; k++) {
      const dx = p[2 * k + 2] - p[2 * k];
      const dy = p[2 * k + 3] - p[2 * k + 1];
      const len = Math.hypot(dx, dy);
      const tx = dx / len;
      const ty = dy / len;
      list.push({ side, x: 0.5 * (xs[k] + xs[k + 1]), length: len, cx: p[2 * k] + 0.5 * dx, cy: p[2 * k + 1] + 0.5 * dy, tx, ty, nx: -ty * outward, ny: tx * outward });
    }
    out[side] = list;
  }
  return out;
}

/** Bilinear value of a node field at (x, y) from the fluid nodes around it, or NaN if too little of the neighbourhood is fluid. */
export function sampleField(field: Float64Array, solid: Uint8Array, nx: number, ny: number, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  let w = 0;
  let v = 0;
  for (let dj = 0; dj <= 1; dj++)
    for (let di = 0; di <= 1; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const n = j * nx + i;
      if (solid[n]) continue;
      const k = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
      w += k;
      v += k * field[n];
    }
  return w >= 0.6 ? v / w : Number.NaN;
}

export interface ProfileSpec {
  /** distance of the first sample from the wall, and the spacing, in lattice cells */
  first: number;
  step: number;
  /** number of samples (the profile reaches first + (count − 1) · step) */
  count: number;
}

/** u_t(d) and ρ(d) along the normal of each station. Result arrays are [station][sample]. */
export function sampleProfiles(ux: Float64Array, uy: Float64Array, rho: Float64Array, solid: Uint8Array, nx: number, ny: number, stations: WallStation[], spec: ProfileSpec): { ut: Float64Array[]; rho: Float64Array[] } {
  const ut: Float64Array[] = [];
  const rr: Float64Array[] = [];
  for (const s of stations) {
    const a = new Float64Array(spec.count);
    const b = new Float64Array(spec.count);
    for (let j = 0; j < spec.count; j++) {
      const d = spec.first + j * spec.step;
      const x = s.cx + s.nx * d;
      const y = s.cy + s.ny * d;
      const u = sampleField(ux, solid, nx, ny, x, y);
      const v = sampleField(uy, solid, nx, ny, x, y);
      a[j] = u * s.tx + v * s.ty;
      b[j] = sampleField(rho, solid, nx, ny, x, y);
    }
    ut.push(a);
    rr.push(b);
  }
  return { ut, rho: rr };
}

/** ∂u_t/∂n at the wall from u(0) = 0, u(d₁), u(2 d₁) (needs the first two samples at spacing d₁ = spec.first, i.e. spec.step = spec.first). */
export function wallGradient(profile: Float64Array, d1: number): number {
  const u1 = profile[0];
  const u2 = profile[1];
  if (!Number.isFinite(u1) || !Number.isFinite(u2)) return Number.NaN;
  return (4 * u1 - u2) / (2 * d1);
}

export interface Dividing {
  /** height of the dividing streamline above the wall in lattice cells, or null if there is no reversed flow */
  h: number | null;
  /** the flux never returned to zero within the sampled height */
  open: boolean;
  /** most negative flux reached */
  qMin: number;
}

/**
 * The dividing streamline of one profile: Q(d) = ∫₀ᵈ u_t dn (below the first sample u_t is taken linear from zero at the wall).
 * If Q goes negative the height at which it first returns to zero (interpolated) is the dividing streamline; if it does not
 * return within the profile the region is "open" (the height is at least the profile's reach).
 */
export function dividingStreamline(profile: Float64Array, first: number, step: number): Dividing {
  let q = 0.5 * first * profile[0];
  if (!Number.isFinite(q)) return { h: null, open: false, qMin: 0 };
  let qMin = Math.min(0, q);
  let negative = q < 0;
  let h: number | null = null;
  for (let j = 1; j < profile.length; j++) {
    const a = profile[j - 1];
    const b = profile[j];
    if (!Number.isFinite(a) || !Number.isFinite(b)) break;
    const dq = 0.5 * (a + b) * step;
    const q2 = q + dq;
    if (negative && q2 >= 0 && dq > 0) {
      const f = -q / dq;
      h = first + (j - 1 + f) * step;
      return { h, open: false, qMin };
    }
    q = q2;
    if (q < qMin) qMin = q;
    if (q < 0) negative = true;
  }
  return negative ? { h: first + (profile.length - 1) * step, open: true, qMin } : { h: null, open: false, qMin };
}
