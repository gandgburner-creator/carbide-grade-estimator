import type { Rng } from '../core/Random';

/**
 * Sampling of particles entering a domain from a reservoir (open boundary).
 *
 * The reservoir is DEFINED as a gas of number density n whose velocities are a
 * drifting 2D Maxwellian (temperature kT, velocity U). This is a boundary
 * condition — the stated state of the incoming stream — not a flow law.
 * Particles crossing a plane with inward normal velocity component v_n > 0 do
 * so at a rate proportional to v_n, so with σ = √(kT/m), a = U_n/σ, s = v_n/σ:
 *
 *   flux per unit boundary length   Γ = n σ [φ(a) + a Φ(a)]
 *   crossing-velocity density       p(s) ∝ s exp(−(s − a)²/2),  s > 0
 *   tangential velocity             v_t ~ U_t + σ N(0, 1)
 *
 * p(s) is sampled exactly by numerically inverting its closed-form CDF
 *   G(s) = −exp(−(s − a)²/2) + a √(π/2) erf((s − a)/√2),
 *   F(s) = (G(s) − G(0)) / (G(∞) − G(0)).
 */

/** erf, Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return s * y;
}

const phi = (a: number) => Math.exp(-0.5 * a * a) / Math.sqrt(2 * Math.PI);
const Phi = (a: number) => 0.5 * (1 + erf(a / Math.SQRT2));

/** Γ/n per unit length: expected crossings per unit density, time and length. */
export function reservoirFluxPerDensity(normalDrift: number, kT: number, mass: number): number {
  const sigma = Math.sqrt(kT / mass);
  const a = normalDrift / sigma;
  return sigma * (phi(a) + a * Phi(a));
}

/** Sample the reduced inward normal velocity s = v_n/σ (> 0) of a crossing particle. */
export function sampleCrossingNormal(a: number, rng: Rng): number {
  const G = (s: number) => -Math.exp(-0.5 * (s - a) ** 2) + a * Math.sqrt(Math.PI / 2) * erf((s - a) / Math.SQRT2);
  const G0 = G(0);
  const Ginf = a * Math.sqrt(Math.PI / 2);
  const target = G0 + rng.next() * (Ginf - G0);
  let lo = 0;
  let hi = Math.max(a, 0) + 12;
  for (let k = 0; k < 60; k++) {
    const mid = 0.5 * (lo + hi);
    if (G(mid) < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Poisson variate (Knuth for small means, normal approximation above 50). */
export function poisson(mean: number, rng: Rng): number {
  if (mean <= 0) return 0;
  if (mean > 50) return Math.max(0, Math.round(mean + Math.sqrt(mean) * rng.gaussian()));
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}
