import type { Simulation } from '../core/Simulation';

/**
 * Energy and momentum conservation diagnostics (Master prompt §10, §35).
 *
 * "Energy error" is the residual of the full ledger identity (see core/Ledger),
 * so it measures numerical error only — physical dissipation or wall heat is
 * accounted, not counted as error. "Momentum error" is likewise the residual of
 * P(t) − P(0) − (impulse from walls and external forces).
 *
 * Both are tracked as the maximum |relative residual| seen at any sample, plus
 * the final value.
 */
export interface ConservationSample {
  t: number;
  kinetic: number;
  internal: number;
  potential: number;
  dissipatedExternal: number;
  wallEnergyOut: number;
  relativeEnergyResidual: number;
  relativeMomentumResidual: number;
  momentumX: number;
  momentumY: number;
}

export class ConservationMonitor {
  readonly samples: ConservationSample[] = [];
  maxAbsEnergyResidual = 0;
  maxMomentumResidual = 0;
  private readonly sim: Simulation;

  constructor(sim: Simulation) {
    this.sim = sim;
    this.sample();
  }

  sample(): ConservationSample {
    const sim = this.sim;
    const p = sim.store.momentum();
    const s: ConservationSample = {
      t: sim.time,
      kinetic: sim.store.kineticEnergy(),
      internal: sim.store.internalEnergy(),
      potential: sim.potentialEnergy,
      dissipatedExternal: sim.ledger.dissipatedExternal,
      wallEnergyOut: sim.ledger.wallEnergyOut,
      relativeEnergyResidual: sim.relativeEnergyResidual(),
      relativeMomentumResidual: sim.relativeMomentumResidual(),
      momentumX: p.x,
      momentumY: p.y,
    };
    this.maxAbsEnergyResidual = Math.max(this.maxAbsEnergyResidual, Math.abs(s.relativeEnergyResidual));
    this.maxMomentumResidual = Math.max(this.maxMomentumResidual, s.relativeMomentumResidual);
    this.samples.push(s);
    return s;
  }

  summary() {
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return {
      initialEnergy: this.sim.E0,
      finalKinetic: last.kinetic,
      finalInternal: last.internal,
      kineticChangeFraction: first.kinetic > 0 ? (last.kinetic - first.kinetic) / first.kinetic : 0,
      dissipatedExternal: last.dissipatedExternal,
      wallEnergyOut: last.wallEnergyOut,
      finalRelativeEnergyResidual: last.relativeEnergyResidual,
      maxAbsRelativeEnergyResidual: this.maxAbsEnergyResidual,
      finalRelativeMomentumResidual: last.relativeMomentumResidual,
      maxRelativeMomentumResidual: this.maxMomentumResidual,
      samples: this.samples.length,
    };
  }
}
