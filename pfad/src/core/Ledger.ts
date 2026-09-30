/**
 * Explicit energy and momentum bookkeeping (Bible §13, Master prompt §12).
 *
 * Energy never silently appears or disappears: every channel through which the
 * gas's mechanical energy changes is accumulated here, so that
 *
 *   KE + E_internal + E_potential + dissipatedExternal + wallEnergyOut + forceWorkOut
 *     − E(0)  ≈ 0
 *
 * holds up to floating-point error. The residual of that identity is the
 * reported "energy error". Likewise for momentum, which the gas exchanges only
 * with walls, external forces and open boundaries:
 *
 *   P_gas(t) − P_gas(0) − wallImpulse − forceImpulse + boundaryMomentumOut ≈ 0.
 *
 * Open (reservoir) boundaries add and remove particles; the energy, momentum
 * and mass they carry are ledgered here, so conservation stays auditable.
 */
export class Ledger {
  /** Kinetic energy lost in inelastic collisions and NOT stored anywhere in the model. */
  dissipatedExternal = 0;
  /** Kinetic energy moved into particle internal energy (a subset of E_internal). */
  dissipatedToInternal = 0;
  /** Internal energy returned to kinetic energy by a reservoir release model. */
  releasedFromInternal = 0;
  /** Net energy transferred from the gas into walls (negative = walls heated the gas). */
  wallEnergyOut = 0;
  /** Net impulse delivered by walls to the gas. */
  wallImpulseX = 0;
  wallImpulseY = 0;
  /** Net impulse delivered by external (non-pairwise) forces. */
  forceImpulseX = 0;
  forceImpulseY = 0;
  /** Work removed from the gas by external forces. */
  forceWorkOut = 0;
  /** Energy (kinetic + internal) carried out through open boundaries minus carried in. */
  boundaryEnergyOut = 0;
  /** Momentum carried out through open boundaries minus carried in. */
  boundaryMomentumOutX = 0;
  boundaryMomentumOutY = 0;
  /** Particles removed / injected at open boundaries. */
  particlesOut = 0;
  particlesIn = 0;

  reset(): void {
    this.dissipatedExternal = 0;
    this.dissipatedToInternal = 0;
    this.releasedFromInternal = 0;
    this.wallEnergyOut = 0;
    this.wallImpulseX = 0;
    this.wallImpulseY = 0;
    this.forceImpulseX = 0;
    this.forceImpulseY = 0;
    this.forceWorkOut = 0;
    this.boundaryEnergyOut = 0;
    this.boundaryMomentumOutX = 0;
    this.boundaryMomentumOutY = 0;
    this.particlesOut = 0;
    this.particlesIn = 0;
  }

  toJSON() {
    return {
      dissipatedExternal: this.dissipatedExternal,
      dissipatedToInternal: this.dissipatedToInternal,
      releasedFromInternal: this.releasedFromInternal,
      wallEnergyOut: this.wallEnergyOut,
      wallImpulseX: this.wallImpulseX,
      wallImpulseY: this.wallImpulseY,
      forceImpulseX: this.forceImpulseX,
      forceImpulseY: this.forceImpulseY,
      forceWorkOut: this.forceWorkOut,
      boundaryEnergyOut: this.boundaryEnergyOut,
      boundaryMomentumOutX: this.boundaryMomentumOutX,
      boundaryMomentumOutY: this.boundaryMomentumOutY,
      particlesOut: this.particlesOut,
      particlesIn: this.particlesIn,
    };
  }
}
