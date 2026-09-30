/**
 * ============================================================================
 *  BENCHMARKS — COMPARISON ONLY
 * ============================================================================
 * Classical kinetic-theory reference values for two-dimensional hard disks.
 * These NEVER enter the simulation: solver modules (core/, gas/, occupancy/,
 * walls/, measurements/) are forbidden from importing this directory, which
 * tests/architecture.test.ts enforces. Experiments may import it only to
 * write reference values into the `benchmarks` section of a record, next to —
 * never instead of — the measured result.
 *
 * All formulas are for 2D, with k_B = 1 (model units).
 */

/** Ideal-gas pressure in 2D: P = N kT / A (line force per unit length). */
export function idealGasPressure2D(count: number, kT: number, area: number): number {
  return (count * kT) / area;
}

/**
 * Henderson (1975) equation of state for the hard-disk fluid:
 *   Z = P A / (N kT) = (1 + φ²/8) / (1 − φ)²
 * Accurate to well under 1 % for φ ≲ 0.6. Includes the excluded-area effect
 * that an ideal gas ignores (Z = 1 + 2φ + … at low φ).
 */
export function hendersonCompressibility(phi: number): number {
  return (1 + (phi * phi) / 8) / ((1 - phi) * (1 - phi));
}

export function hardDiskPressure2D(count: number, kT: number, area: number, phi: number): number {
  return idealGasPressure2D(count, kT, area) * hendersonCompressibility(phi);
}

/**
 * Homogeneous cooling of inelastic hard disks (Haff's law) expressed in
 * collisions per particle c (each binary collision counts once for each
 * partner, c = 2 · pair collisions / N). Assuming a Maxwellian velocity
 * distribution and a homogeneous gas, the mean loss per binary collision is
 * (1 − e²) kT (because the collision-weighted ⟨v_n²⟩ = 4kT/m in 2D), so
 *   d ln T / dc = −(1 − e²)/2,   T(c) = T₀ exp(−(1 − e²) c / 2),
 * and pressure at fixed density halves after
 *   c_½ = 2 ln 2 / (1 − e²).
 * The assumptions fail when the gas clusters (strongly inelastic e).
 */
export function haffHalvingCollisions(e: number): number {
  return (2 * Math.LN2) / (1 - e * e);
}

/** Collision-weighted mean square normal relative velocity for 2D Maxwellian hard disks: 4kT/m. */
export function collisionWeightedVn2(kT: number, mass: number): number {
  return (4 * kT) / mass;
}

/** 2D Maxwell–Boltzmann speed distribution (Rayleigh): f(v) = (m v/kT) exp(−m v²/2kT). */
export function maxwellSpeedPdf2D(v: number, kT: number, mass: number): number {
  return ((mass * v) / kT) * Math.exp((-mass * v * v) / (2 * kT));
}

/** Mean speed of the 2D Maxwellian: sqrt(π kT / 2m). */
export function maxwellMeanSpeed2D(kT: number, mass: number): number {
  return Math.sqrt((Math.PI * kT) / (2 * mass));
}

/**
 * Contact value of the hard-disk radial distribution function consistent with
 * the Henderson EOS: Z = 1 + 2φ g(σ)  ⇒  g(σ) = (Z − 1)/(2φ).
 */
export function hendersonContactValue(phi: number): number {
  return (hendersonCompressibility(phi) - 1) / (2 * phi);
}

/**
 * Enskog collision frequency per particle for 2D hard disks of diameter σ:
 *   ω = 2 σ n g(σ) sqrt(π kT / m)
 * (Boltzmann value ω₀ = 2σn sqrt(πkT/m), times the contact value g(σ)).
 * Counts collisions per particle per unit time in the c convention above.
 */
export function enskogCollisionFrequency2D(n: number, sigma: number, kT: number, mass: number, phi: number): number {
  return 2 * sigma * n * hendersonContactValue(phi) * Math.sqrt((Math.PI * kT) / mass);
}

/** Mean free path λ = ⟨v⟩ / ω for 2D hard disks (Enskog). */
export function enskogMeanFreePath2D(n: number, sigma: number, phi: number): number {
  return 1 / (2 * Math.SQRT2 * sigma * n * hendersonContactValue(phi));
}

/** Ideal-gas adiabatic sound speed in 2D: c = sqrt(γ kT/m), γ = (d+2)/d = 2. */
export function idealSoundSpeed2D(kT: number, mass: number): number {
  return Math.sqrt((2 * kT) / mass);
}
