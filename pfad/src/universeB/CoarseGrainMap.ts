/**
 * UB-0 coarse-graining map 𝓜_{N_c}: Universe A (rigid disks, m = d = kT = 1)
 * → Universe B parcels of N_c molecules (docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md §2).
 *
 * Every Universe B run is set up through this map; nothing in it is fitted to
 * a Universe B observable. All quantities are in MOLECULAR units (m = d = kT = 1),
 * so parcel diameter D = √N_c and parcel thermal speed σ_v = 1/√N_c.
 *
 * Status of each rule (design review §1.2, §2):
 *   exact     M = N_c m; D = √N_c d (keeps φ_p = φ); n_p = n/N_c;
 *             E_int = (N_c − 1) kT per parcel (internal translational dof)
 *   derived   ρ_rel = (1 − e²)/(2(N_c − 1) + 1 − e²) — the mean balance of the A-16
 *             release law AS CODED (the release takes ρ of the reservoirs after this
 *             collision's own loss is deposited) at T_kin = T_int, given e (means only;
 *             tested by PQ4). Amendment A2 (D2) corrected the design's
 *             (1 − e²)/(2(N_c − 1)), which assumed release from the pre-collision
 *             reservoir and balances at T_kin/T_int = 1/(1 − ρ_rel) instead.
 *   closure   k_s = (N_c − 1) K_T,A /(n φ) — MEAN-FIELD closure on Universe A's
 *             isothermal modulus (K_T,A from Universe A, never from Universe B)
 *   choice    c_h (kernel rule h = c_h √N_c D), e, Lucy kernel — pre-registered
 *             non-physical choices (class C)
 *
 * N_c = 1 is the identity: no occupancy force, no reservoir, e = 1, i.e. Universe A.
 */
export const UB0_PHI = 0.2;

export interface MapInputs {
  /** K_T,A /(n kT): Universe A's reduced isothermal modulus (Z + φZ′ for a hard-disk EOS) */
  KTred: number;
  /** area fraction φ (default 0.2) */
  phi?: number;
  /** molecular temperature (default 1) */
  kT?: number;
}

export interface ParcelChoice {
  /** molecules per parcel, integer ≥ 1 */
  Nc: number;
  /** kernel-width constant c_h in h = c_h √N_c D */
  ch: number;
  /** restitution e (must be 1 at N_c = 1) */
  e: number;
}

export interface ParcelMap {
  Nc: number;
  ch: number;
  e: number;
  phi: number;
  kT: number;
  /** parcel mass M = N_c m */
  mass: number;
  /** parcel core diameter D = √N_c d and radius D/2 */
  diameter: number;
  radius: number;
  /** parcel number density n_p = n/N_c (molecular units) */
  numberDensity: number;
  /** mass density ρ = n m (invariant) */
  massDensity: number;
  /** parcel thermal speed σ_v = √(kT/M) */
  sigmaV: number;
  /** reservoir energy per parcel (N_c − 1) kT */
  internalEnergy: number;
  /** A-16 release fraction (0 at N_c = 1) */
  releaseFraction: number;
  /** occupancy stiffness k_s (0 at N_c = 1) */
  ks: number;
  /** occupancy kernel support h = c_h √N_c D (molecular units); 0 at N_c = 1 */
  h: number;
  /** parcel area a = πD²/4 (the A-15 pair weight for equal parcels) */
  parcelArea: number;
}

/**
 * ρ* = (1 − e²)/(2(N_c − 1) + 1 − e²): with flux-weighted contacts the mean loss per
 * collision is (1 − e²)kT_kin, deposited into the pair's reservoirs before the release
 * takes ρ of (E_i + E_j + loss). Stationarity (1 − ρ)(1 − e²)kT_kin = ρ·2(N_c − 1)kT_int
 * at T_kin = T_int gives ρ*. Means only (amendment A2, D2).
 */
export function releaseFractionFor(Nc: number, e: number): number {
  return (1 - e * e) / (2 * (Nc - 1) + 1 - e * e);
}

export function parcelMap(choice: ParcelChoice, inputs: MapInputs): ParcelMap {
  const { Nc, ch, e } = choice;
  const phi = inputs.phi ?? UB0_PHI;
  const kT = inputs.kT ?? 1;
  if (!Number.isInteger(Nc) || Nc < 1) throw new Error(`N_c must be an integer ≥ 1, got ${Nc}`);
  if (!(inputs.KTred > 0)) throw new Error(`K_T,A/(n kT) must be > 0, got ${inputs.KTred}`);
  if (Nc === 1 && e !== 1) throw new Error('N_c = 1 is Universe A: restitution must be 1');
  if (Nc > 1 && !(e > 0 && e < 1)) throw new Error(`a parcel universe needs 0 < e < 1, got ${e}`);
  if (Nc > 1 && !(ch > 0)) throw new Error(`c_h must be > 0, got ${ch}`);
  const n = phi / (Math.PI / 4); // molecular number density, d = 1
  const D = Math.sqrt(Nc);
  return {
    Nc,
    ch: Nc > 1 ? ch : 0,
    e,
    phi,
    kT,
    mass: Nc,
    diameter: D,
    radius: D / 2,
    numberDensity: n / Nc,
    massDensity: n,
    sigmaV: Math.sqrt(kT / Nc),
    internalEnergy: (Nc - 1) * kT,
    releaseFraction: Nc > 1 ? releaseFractionFor(Nc, e) : 0,
    ks: ((Nc - 1) * inputs.KTred * kT) / phi,
    h: Nc > 1 ? ch * Math.sqrt(Nc) * D : 0,
    parcelArea: (Math.PI * D * D) / 4,
  };
}

/** Henderson's 2D hard-disk equation of state — an EXTERNAL benchmark, used until Stage 0 measures K_T,A. */
export const henderson = {
  Z: (phi: number): number => (1 + (phi * phi) / 8) / (1 - phi) ** 2,
  /** Z + φ dZ/dφ = K_T/(n kT) */
  KTred: (phi: number): number => {
    const Z = (1 + (phi * phi) / 8) / (1 - phi) ** 2;
    const dZ = (phi / 4 / (1 - phi) ** 2) + (2 * (1 + (phi * phi) / 8)) / (1 - phi) ** 3;
    return Z + phi * dZ;
  },
  /** contact value of the pair correlation g(d) */
  gContact: (phi: number): number => (1 - (7 * phi) / 16) / (1 - phi) ** 2,
  /** β f_ex per particle = ∫₀^φ (Z − 1)/φ′ dφ′ = (9/8) φ/(1−φ) − (7/8) ln(1−φ) */
  betaFex: (phi: number): number => (9 / 8) * (phi / (1 - phi)) - (7 / 8) * Math.log(1 - phi),
  /** d(β f_ex)/dφ */
  betaFexPrime: (phi: number): number => 9 / 8 / (1 - phi) ** 2 + 7 / 8 / (1 - phi),
};
