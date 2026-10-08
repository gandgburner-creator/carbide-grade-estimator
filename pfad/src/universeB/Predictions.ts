import { lucyW } from '../occupancy/OccupancyModel';
import { tTwoSidedCritical } from '../measurements/Statistics';
import { henderson, parcelMap, releaseFractionFor, UB0_PHI } from './CoarseGrainMap';

/**
 * UB-0 analytical predictions (design review docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md,
 * Appendix A; pre-registration gate G3).
 *
 * Everything here is a deterministic function of Universe A reference values
 * and the coarse-graining map. NO Universe B simulation data enters.
 *
 * Every number carries a status:
 *   exact      — follows from the definition of the parcel or from Universe A's
 *                exact scale symmetry (m → N_c m, d → √N_c d at fixed φ, kT)
 *   mechanics  — an exact mechanical identity whose numerical value depends on a
 *                mean-field input (e.g. the contact theorem evaluated with the MF pressure)
 *   mean-field — follows from the mean-field (RPA / local-density) closure; an
 *                APPROXIMATION, never to be read as exact
 *   estimate   — an order-of-magnitude or RPA-of-fluctuations estimate, sizing a risk
 *   design     — a property of the planned configurations (box sizes, seeds)
 *   input      — a Universe A reference value (measured or external benchmark)
 */
export type Status = 'exact' | 'mechanics' | 'mean-field' | 'estimate' | 'design' | 'input';

export interface Quantity {
  value: number;
  status: Status;
  equation: string;
  source?: string;
}

export interface RefValue {
  value: number;
  source: string;
  /** standard error and degrees of freedom (Stage 0 measurements; absent for external benchmarks) */
  se?: number;
  df?: number;
}

/** Universe A reference values at φ = 0.2 (molecular units m = d = kT = 1). */
export interface UniverseAReference {
  label: string;
  phi: number;
  /** compressibility factor Z = P/(n kT) */
  Z: RefValue;
  /** reduced isothermal modulus K_T/(n kT) = Z + φZ′ */
  KTred: RefValue;
  /** adiabatic small-amplitude sound speed / c_th */
  cA: RefValue;
  /** mean free path / d */
  lambda: RefValue;
  /** kinematic viscosity / (d c_th) */
  nu: RefValue;
  /** collisions per particle per (d/c_th) */
  collisionRate: RefValue;
  /**
   * c_A measured at the Courant number matched to each N_c's standing-wave runs (A2 §1.4;
   * Stage 0b). When present, the sound band and the PQ3 judged interval at that N_c use it.
   */
  cAByNc?: Partial<Record<number, RefValue>>;
}

/** The reference with c_A replaced by the value matched to N_c, if one is given (A2 §1.4). */
export function referenceForNc(ref: UniverseAReference, Nc: number): UniverseAReference {
  const c = ref.cAByNc?.[Nc];
  return c ? { ...ref, cA: c } : ref;
}

const PHI = UB0_PHI;

/** Reference used by the design review (Henderson EOS + Items 1–2 measurements). Stage 0 replaces it. */
export function reviewReference(): UniverseAReference {
  const g = henderson.gContact(PHI);
  const n = PHI / (Math.PI / 4);
  return {
    label: 'design-review inputs (Henderson EOS; Item 1/2 measurements)',
    phi: PHI,
    Z: { value: henderson.Z(PHI), source: 'Henderson 2D hard-disk EOS (EXTERNAL benchmark)' },
    KTred: { value: henderson.KTred(PHI), source: 'Henderson 2D hard-disk EOS (EXTERNAL benchmark)' },
    cA: { value: 2.170, source: 'Item 2 pre-registered c₀ = 2.170 ± 0.038 (REPORT_SOUND_SPEED.md)' },
    lambda: { value: 0.96, source: 'φ = 0.2 Couette sweep, Kn = 0.024 at H = 40 (EXPERIMENT_LOG.md §6)' },
    nu: { value: 0.351 / n, source: 'φ = 0.2 Couette μ = 0.351 ± 0.033 (EXPERIMENT_LOG.md §6), ν = μ/ρ' },
    collisionRate: {
      value: n * 2 * Math.sqrt(Math.PI) * g,
      source: 'Enskog estimate n·2d·√(πkT/m)·g(d) with Henderson g(d) (EXTERNAL); Stage 0 measures it',
    },
  };
}

// ───────────────────────── numerical helpers ─────────────────────────

/**
 * Bessel J₀ by its integral representation (1/π)∫₀^π cos(x sin θ) dθ, trapezoid rule on
 * the periodic integrand (error ~ J_{2m}(x): negligible for m = 96 and x ≤ 60).
 */
export function besselJ0(x: number): number {
  const m = 96;
  let s = 0;
  for (let k = 0; k < m; k++) {
    const th = ((k + 0.5) / m) * Math.PI;
    s += Math.cos(x * Math.sin(th));
  }
  return s / m;
}

/** Composite Simpson rule on [a, b] with an even number of intervals. */
function simpson(f: (x: number) => number, a: number, b: number, intervals: number): number {
  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const hstep = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 === 1 ? 4 : 2) * f(a + i * hstep);
  return (s * hstep) / 3;
}

/**
 * 2D Fourier transform of the Lucy kernel, W̃(k) = 2π ∫₀^h W(r) J₀(kr) r dr (W̃(0) = 1).
 * W(r; h) = w(r/h)/h², so W̃ depends on kh only.
 */
export function lucyHat(k: number, h: number): number {
  return simpson((r) => 2 * Math.PI * lucyW(r, h) * besselJ0(k * r) * r, 0, h, 400);
}

const HAT_QMAX = 60;
const HAT_DQ = 0.01;
let hatTable: Float64Array | null = null;
/** W̃ as a function of q = kh, tabulated once and linearly interpolated (for the RPA integrals). */
export function lucyHatFast(q: number): number {
  if (!hatTable) {
    const n = Math.round(HAT_QMAX / HAT_DQ) + 1;
    hatTable = new Float64Array(n);
    for (let i = 0; i < n; i++) hatTable[i] = lucyHat(i * HAT_DQ, 1);
  }
  if (q >= HAT_QMAX) return 0;
  const u = q / HAT_DQ;
  const i = Math.floor(u);
  const t = u - i;
  return hatTable[i] * (1 - t) + hatTable[i + 1] * t;
}

/** Lucy kernel projected on one axis: W₁(s) = ∫ W(√(s² + x²)) dx. ∫W₁ ds = 1. */
export function lucyProjected(s: number, h: number): number {
  const a = Math.abs(s);
  if (a >= h) return 0;
  const xm = Math.sqrt(h * h - a * a);
  return 2 * simpson((x) => lucyW(Math.sqrt(a * a + x * x), h), 0, xm, 400);
}

/** Uniform disk weight of radius R (area-normalised) projected on one axis. */
export function diskProjected(z: number, R: number): number {
  const a = Math.abs(z);
  return a >= R ? 0 : (2 * Math.sqrt(R * R - a * a)) / (Math.PI * R * R);
}

// ───────────────────────── mean-field closure ─────────────────────────

/** Mean-field pressure decomposition, in units of n_p kT (parcel number density). */
export function meanFieldPressure(Nc: number, ref: UniverseAReference) {
  const Z = ref.Z.value;
  const K = ref.KTred.value;
  const occ = 0.5 * (Nc - 1) * K; // P_occ/(n_p kT) = ½ k_s φ / kT
  const total = Z + occ;
  return {
    hardCore: Z,
    occupancy: occ,
    total,
    /** Z_B/Z_A = P_B/P_A */
    ZratioBA: total / (Nc * Z),
    occupancyShare: occ / total,
  };
}

/** Γ_self band (full exchange … no exchange) and the matching c_B/c_A band if K_B = K_T,A. */
export function soundBand(Nc: number, ref: UniverseAReference) {
  const GammaA = (ref.cA.value * ref.cA.value) / ref.KTred.value; // ρ c²/K_T with ρ = n m, m = 1
  const delta = GammaA - 1;
  const lo = 1 + delta / (Nc * Nc);
  const hi = 1 + delta / Nc;
  return {
    GammaA,
    deltaA: delta,
    Gamma: [lo, hi] as [number, number],
    cRatio: [Math.sqrt(lo / GammaA), Math.sqrt(hi / GammaA)] as [number, number],
    /** largest extra stiffness of a collisionless kinetic share, n_p kT / K_B */
    collisionlessAllowance: 1 / (Nc * ref.KTred.value),
  };
}

/**
 * The judged PQ3 band with Universe A uncertainty propagated (amendment A1 §5):
 * Γ_A = c_A²/(K_T,A/(nkT)), SE by the delta method, Welch–Satterthwaite df;
 * band edges at the 95 % limits of Δ_A = Γ_A − 1, then ±0.05 outside.
 * Without SEs (external inputs) the point band is returned with zero widening.
 */
export function soundBandWithUncertainty(Nc: number, ref: UniverseAReference, tolerance = 0.05) {
  const b = soundBand(Nc, ref);
  const c = ref.cA;
  const K = ref.KTred;
  const relC = c.se !== undefined ? (2 * c.se) / c.value : 0;
  const relK = K.se !== undefined ? K.se / K.value : 0;
  const seGamma = b.GammaA * Math.hypot(relC, relK);
  let t = 0;
  let df = Number.POSITIVE_INFINITY;
  if (seGamma > 0) {
    const terms = [
      { v: relC ** 2, d: c.df ?? Number.POSITIVE_INFINITY },
      { v: relK ** 2, d: K.df ?? Number.POSITIVE_INFINITY },
    ];
    const num = (terms[0].v + terms[1].v) ** 2;
    const den = terms.reduce((a, x) => a + (Number.isFinite(x.d) && x.v > 0 ? (x.v * x.v) / x.d : 0), 0);
    df = den > 0 ? num / den : Number.POSITIVE_INFINITY;
    t = tTwoSidedCritical(0.05, Number.isFinite(df) ? df : 1e6);
  }
  const dLo = b.deltaA - t * seGamma;
  const dHi = b.deltaA + t * seGamma;
  const lo = 1 + dLo / (Nc * Nc);
  const hi = 1 + dHi / Nc;
  return { GammaA: b.GammaA, seGammaA: seGamma, dfGammaA: df, deltaLo: dLo, deltaHi: dHi, band: [lo, hi] as [number, number], judged: [lo - tolerance, hi + tolerance] as [number, number] };
}

// ───────────────────────── coupling (RPA estimates) ─────────────────────────

export interface Coupling {
  Nc: number;
  ch: number;
  /** h / D */
  hOverD: number;
  Nnb: number;
  invNnb: number;
  /** u(0)/kT */
  GammaC: number;
  /** u(D)/kT */
  uAtD: number;
  /** rms single-parcel occupancy energy / kT (RPA, screened) */
  rmsPsi: number;
  /** rms of one Cartesian component of the occupancy force × D / kT (RPA) */
  rmsForceD: number;
}

/**
 * RPA estimates in parcel units (D = 1, kT = 1). S_hc taken as S_A(0) = 1/(K_T/(nkT)),
 * valid for kD ≪ 1 where W̃ is non-negligible because h ≫ D.
 */
export function coupling(Nc: number, ch: number, ref: UniverseAReference): Coupling {
  const n = PHI / (Math.PI / 4);
  const h = ch * Math.sqrt(Nc);
  const ksA = (((Nc - 1) * ref.KTred.value) / PHI) * (Math.PI / 4); // k_s a / kT, D = 1
  const SA0 = 1 / ref.KTred.value;
  const kmax = 40 / h;
  const steps = 4000;
  let vpsi = 0;
  let vF = 0;
  for (let i = 0; i < steps; i++) {
    const k = ((i + 0.5) / steps) * kmax;
    const uh = ksA * lucyHatFast(k * h);
    const S = 1 / (1 / SA0 + n * uh);
    const w = ((n * uh * uh * S * k) / (2 * Math.PI)) * (kmax / steps);
    vpsi += w;
    vF += (w * k * k) / 2;
  }
  const Nnb = n * Math.PI * h * h;
  return {
    Nc,
    ch,
    hOverD: h,
    Nnb,
    invNnb: 1 / Nnb,
    GammaC: ksA * lucyW(0, h),
    uAtD: ksA * lucyW(1, h),
    rmsPsi: Math.sqrt(vpsi),
    rmsForceD: Math.sqrt(vF),
  };
}

// ───────────────────────── wall profile (1D density functional) ─────────────────────────

/** dZ/dφ of the Henderson EOS. */
export function hendersonZPrime(phi: number): number {
  return phi / 4 / (1 - phi) ** 2 + (2 * (1 + (phi * phi) / 8)) / (1 - phi) ** 3;
}

export type HardCoreFunctional = 'LDA' | 'SDA';
export type Ensemble = 'grand' | 'canonical';

export interface WallProfileOptions {
  Nc: number;
  ch: number;
  functional: HardCoreFunctional;
  ensemble: Ensemble;
  /** box height H in units of h (walls at 0 and H; parcel centres in [D/2, H − D/2]) */
  HoverH: number;
  /** grid spacing in D */
  dy?: number;
  tol?: number;
  maxIter?: number;
}

export interface WallProfile {
  options: Required<WallProfileOptions>;
  converged: boolean;
  iterations: number;
  residual: number;
  /** centre positions (D units, measured from the wall plane) and area fractions φ(y) = n(y)πD²/4 */
  y: number[];
  phi: number[];
  /** φ at the first grid point (≈ contact, smoothed by the functional) */
  phiContact: number;
  phiAt: { hQuarter: number; hHalf: number; h: number };
  /** minimum of φ within [D/2, D/2 + 1.5h] and its position (in h) */
  phiMin: number;
  yMinOverH: number;
  /** core reference density: n_b (grand) or n(H/2) (canonical), as φ */
  phiCore: number;
  /** ∫_{D/2}^{D/2+1.5h} (n − n_core) dy, in units of n_b h */
  excessOverH15: number;
  /** the same over the half box, units n_b h */
  excessHalfBox: number;
}

/**
 * Planar wall box with the occupancy force and no wall term (design review §9.2, App. A.4):
 *   ln n(y) + βμ_ex[n](y) + β k_s a ∫ W₁(y − y′) n(y′) dy′ = βμ
 * Hard cores: LDA  βμ_ex = βf_ex(φ(y)) + Z(φ(y)) − 1 (Henderson),
 *             SDA  (Nordholm-type smoothed density, uniform disk weight of radius D):
 *                  φ̄ = a∫w₁ n,  βμ_ex = βf_ex(φ̄(y)) + a∫ n(y′) βf_ex′(φ̄(y′)) w₁(y′ − y) dy′.
 * Grand: μ fixed by the bulk at φ = 0.2. Canonical: ∫n dy = n_b H (the run's count).
 * Parcel units D = 1, kT = 1.
 */
export function wallProfile(opts: WallProfileOptions, ref: UniverseAReference): WallProfile {
  const o: Required<WallProfileOptions> = { dy: 0.05, tol: 1e-10, maxIter: 400000, ...opts };
  const { Nc, ch } = o;
  const a = Math.PI / 4;
  const nb = PHI / a;
  const h = ch * Math.sqrt(Nc);
  const H = o.HoverH * h;
  const ksA = (((Nc - 1) * ref.KTred.value) / PHI) * a;
  const r = 0.5;
  const Ny = Math.floor((H - 2 * r) / o.dy);
  const y = Array.from({ length: Ny }, (_, i) => r + (i + 0.5) * o.dy);
  const Kocc = Math.ceil(h / o.dy) + 1;
  const kerOcc = Array.from({ length: Kocc }, (_, m) => lucyProjected(m * o.dy, h) * o.dy);
  const Kw = Math.ceil(1 / o.dy) + 1;
  const kerW = Array.from({ length: Kw }, (_, m) => diskProjected(m * o.dy, 1) * o.dy);
  const conv = (ker: number[], f: Float64Array, out: Float64Array) => {
    const K = ker.length;
    for (let i = 0; i < Ny; i++) {
      let s = 0;
      const j0 = Math.max(0, i - K + 1);
      const j1 = Math.min(Ny - 1, i + K - 1);
      for (let j = j0; j <= j1; j++) s += ker[Math.abs(i - j)] * f[j];
      out[i] = s;
    }
  };
  const muEx = (phi: number) => henderson.betaFex(phi) + henderson.Z(phi) - 1;
  const muBulk = Math.log(nb) + muEx(PHI) + ksA * nb;
  const Ntot = nb * H;

  // LDA local inversion: ln n + μ_ex(φ) = target (monotone in n), Newton in ln n with bisection safeguard
  const dMuEx = (phi: number) => henderson.betaFexPrime(phi) + hendersonZPrime(phi);
  const invertLDA = (target: number): number => {
    let lo = -60;
    let hi = Math.log(0.9999 / a);
    let x = Math.min(hi - 1e-6, Math.max(lo, target));
    for (let k = 0; k < 100; k++) {
      const nn = Math.exp(x);
      const f = x + muEx(nn * a) - target;
      if (Math.abs(f) < 1e-14) break;
      if (f > 0) hi = x;
      else lo = x;
      let xn = x - f / (1 + nn * a * dMuEx(nn * a));
      if (!(xn > lo && xn < hi)) xn = 0.5 * (lo + hi);
      x = xn;
    }
    return Math.exp(x);
  };

  let n = new Float64Array(Ny).fill(nb);
  const psi = new Float64Array(Ny);
  const phibar = new Float64Array(Ny);
  const tmp = new Float64Array(Ny);
  const corr = new Float64Array(Ny);
  const next = new Float64Array(Ny);
  let alpha = 0.5 / (1 + (ksA * nb) / 3);
  if (o.functional === 'SDA') alpha *= 0.5;
  let mu = muBulk;
  let residual = Infinity;
  let prevResidual = Infinity;
  let it = 0;
  for (; it < o.maxIter; it++) {
    conv(kerOcc, n, psi);
    for (let i = 0; i < Ny; i++) psi[i] *= ksA;
    if (o.functional === 'LDA') {
      for (let i = 0; i < Ny; i++) next[i] = invertLDA(mu - psi[i]);
      if (o.ensemble === 'canonical') {
        let s = 0;
        for (let i = 0; i < Ny; i++) s += next[i] * o.dy;
        mu += 0.5 * Math.log(Ntot / s);
      }
    } else {
      conv(kerW, n, phibar);
      for (let i = 0; i < Ny; i++) {
        phibar[i] = Math.min(phibar[i] * a, 0.999);
        tmp[i] = n[i] * henderson.betaFexPrime(phibar[i]);
      }
      conv(kerW, tmp, corr);
      // external-potential form: n_i ∝ exp(−V_i), V_i = βf_ex(φ̄_i) + a·corr_i + ψ_i
      for (let i = 0; i < Ny; i++) tmp[i] = henderson.betaFex(phibar[i]) + a * corr[i] + psi[i];
      if (o.ensemble === 'grand') {
        for (let i = 0; i < Ny; i++) next[i] = Math.exp(muBulk - tmp[i]);
      } else {
        let minV = Infinity;
        for (let i = 0; i < Ny; i++) minV = Math.min(minV, tmp[i]);
        let s = 0;
        for (let i = 0; i < Ny; i++) {
          next[i] = Math.exp(-(tmp[i] - minV));
          s += next[i] * o.dy;
        }
        for (let i = 0; i < Ny; i++) next[i] *= Ntot / s;
      }
    }
    residual = 0;
    for (let i = 0; i < Ny; i++) residual = Math.max(residual, Math.abs(next[i] - n[i]) / nb);
    if (o.functional === 'LDA' && o.ensemble === 'canonical') {
      let sN = 0;
      for (let i = 0; i < Ny; i++) sN += next[i] * o.dy;
      residual = Math.max(residual, Math.abs(sN / Ntot - 1));
    }
    if (residual < o.tol) break;
    if (residual > prevResidual * 1.5 && it > 10) alpha *= 0.5;
    prevResidual = residual;
    const mixed = new Float64Array(Ny);
    for (let i = 0; i < Ny; i++) mixed[i] = (1 - alpha) * n[i] + alpha * next[i];
    n = mixed;
  }
  const phi = Array.from(n, (v) => v * a);
  const at = (yy: number) => phi[Math.min(Ny - 1, Math.max(0, Math.round((yy - r) / o.dy - 0.5)))];
  const nCore = o.ensemble === 'grand' ? nb : n[Math.floor(Ny / 2)];
  let ex15 = 0;
  let exHalf = 0;
  let phiMin = Infinity;
  let yMin = 0;
  for (let i = 0; i < Ny; i++) {
    if (y[i] < r + 1.5 * h) {
      ex15 += (n[i] - nCore) * o.dy;
      if (phi[i] < phiMin) {
        phiMin = phi[i];
        yMin = y[i];
      }
    }
    if (y[i] < H / 2) exHalf += (n[i] - nCore) * o.dy;
  }
  return {
    options: o,
    converged: residual < o.tol,
    iterations: it,
    residual,
    y,
    phi,
    phiContact: phi[0],
    phiAt: { hQuarter: at(r + h / 4), hHalf: at(r + h / 2), h: at(r + h) },
    phiMin,
    yMinOverH: (yMin - r) / h,
    phiCore: nCore * a,
    excessOverH15: ex15 / (nb * h),
    excessHalfBox: exHalf / (nb * h),
  };
}

// ───────────────────────── planned configurations (design §4.3, §5, §11.2) ─────────────────────────

export interface WaveConditions {
  Nc: number;
  L: number; // box side in D
  parcels: number;
  Kn: number;
  Re: number;
  epsilon: number; // at U₀ = σ_v
  decayTime: number; // D/σ_v
  collisionsPerDecay: number;
  machBand: [number, number]; // U₀ = σ_v
  heatingFraction: number; // ΔT/T over the decay at U₀ = σ_v
  perSeedNuError: number; // relative, U₀ = σ_v
}

export function shearWaveConditions(Nc: number, L: number, ref: UniverseAReference): WaveConditions {
  const n = PHI / (Math.PI / 4);
  const k = (2 * Math.PI) / L;
  const parcels = Math.round(n * L * L);
  const nu = ref.nu.value;
  const tau = 1 / (nu * k * k);
  const band = soundBand(Nc, ref);
  const cOverSigma = (r: number) => Math.sqrt(Nc) * ref.cA.value * r;
  const mach: [number, number] =
    Nc === 1 ? [1 / ref.cA.value, 1 / ref.cA.value] : [1 / cOverSigma(band.cRatio[1]), 1 / cOverSigma(band.cRatio[0])];
  return {
    Nc,
    L,
    parcels,
    Kn: k * ref.lambda.value,
    Re: 1 / (nu * k),
    epsilon: k * ref.lambda.value,
    decayTime: tau,
    collisionsPerDecay: tau * ref.collisionRate.value,
    machBand: mach,
    heatingFraction: 0.25 / Nc,
    perSeedNuError: Math.sqrt(2 / parcels),
  };
}

/** Expected 95 % CI half-width of a log ratio of two seed means (Welch). */
export function ratioHalfWidth(sdA: number, nA: number, sdB: number, nB: number): number {
  const va = (sdA * sdA) / nA;
  const vb = (sdB * sdB) / nB;
  const se = Math.sqrt(va + vb);
  const dof = (va + vb) ** 2 / ((va * va) / (nA - 1) + (vb * vb) / (nB - 1));
  return tTwoSidedCritical(0.05, dof) * se;
}

/** Local-equilibrium bound N_c ≲ ε a Re_δ /(Ma c_A/c_th)², a = ν/(λ c_th) (previous review §5). */
export function localEquilibriumBound(ReDelta: number, Ma: number, ref: UniverseAReference, eps = 0.1): number {
  const aCoef = ref.nu.value / ref.lambda.value;
  return (eps * aCoef * ReDelta) / (Ma * ref.cA.value) ** 2;
}

export function minReDelta(Nc: number, Ma: number, ref: UniverseAReference, eps = 0.1): number {
  const aCoef = ref.nu.value / ref.lambda.value;
  return (Nc * (Ma * ref.cA.value) ** 2) / (eps * aCoef);
}

/** Sound-wave local-equilibrium parameter ωτ_c for a standing wave of wavelength L (D units). */
export function soundOmegaTau(Nc: number, L: number, ref: UniverseAReference): [number, number] {
  const k = (2 * Math.PI) / L;
  if (Nc === 1) {
    const v = (ref.cA.value * k) / ref.collisionRate.value;
    return [v, v];
  }
  const b = soundBand(Nc, ref);
  const c = (r: number) => Math.sqrt(Nc) * ref.cA.value * r;
  return [(c(b.cRatio[0]) * k) / ref.collisionRate.value, (c(b.cRatio[1]) * k) / ref.collisionRate.value];
}

/** Map quantities at N_c (molecular units). */
export function mapQuantities(Nc: number, ch: number, e: number, ref: UniverseAReference) {
  const m = parcelMap({ Nc, ch, e: Nc === 1 ? 1 : e }, { KTred: ref.KTred.value, phi: PHI });
  return {
    ...m,
    kineticPressureRatio: 1 / Nc,
    collisionRatePhysical: ref.collisionRate.value / Nc,
    lambdaMolecular: ref.lambda.value * m.diameter,
    S0parcel: 1 / (Nc * ref.KTred.value),
    Nnb: m.numberDensity * Math.PI * m.h * m.h,
  };
}

/**
 * Mean balance of the IMPLEMENTED A-16 release law (CollisionModel): the inelastic
 * loss (1 − e²)·½μv_n² goes into the pair's reservoirs FIRST, and the release takes
 * the fraction ρ of E_i + E_j INCLUDING that loss. With flux-weighted contacts
 * (⟨½μv_n²⟩ = kT_kin) and reservoirs at (N_c − 1)kT_int, stationarity
 * (1 − ρ)(1 − e²)kT_kin = ρ·2(N_c − 1)kT_int gives
 *   T_kin/T_int = 2(N_c − 1)ρ / ((1 − e²)(1 − ρ)).
 * The design's ρ_rel = (1 − e²)/(2(N_c − 1)) gives 1/(1 − ρ_rel), not 1;
 * T_kin = T_int needs ρ* = (1 − e²)/(2(N_c − 1) + 1 − e²), which the map uses since
 * amendment A2 (D2). Means only.
 */
export function releaseEquilibrium(Nc: number, e: number, rho: number): number {
  return (2 * (Nc - 1) * rho) / ((1 - e * e) * (1 - rho));
}

/** ρ*, the map's release fraction (CoarseGrainMap.releaseFractionFor). */
export function rhoBalanced(Nc: number, e: number): number {
  return releaseFractionFor(Nc, e);
}

/** The design's superseded ρ_rel = (1 − e²)/(2(N_c − 1)) (A2 erratum record only; never used by a run). */
export function rhoDesignSuperseded(Nc: number, e: number): number {
  return (1 - e * e) / (2 * (Nc - 1));
}
