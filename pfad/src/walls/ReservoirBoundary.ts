import type { HardDiskCollider } from '../core/CollisionModel';
import type { Domain } from '../core/Domain';
import type { Ledger } from '../core/Ledger';
import type { ParticleStore } from '../core/ParticleStore';
import type { Rng } from '../core/Random';
import { poisson, reservoirFluxPerDensity, sampleCrossingNormal } from '../gas/InflowSampling';
import type { WallSide } from './WallModel';

/**
 * OPEN (RESERVOIR) BOUNDARY on one side of a bounded axis.
 *
 * Outflow: a particle whose centre crosses the boundary plane leaves the domain
 * and is removed; its energy, momentum and mass are ledgered.
 * Inflow: particles from a reservoir of stated state (n, kT, U) enter at the
 * kinetic crossing rate, with velocities from the flux-weighted drifting
 * Maxwellian (gas/InflowSampling). Each entrant is placed a random fraction
 * of its step's travel inside the plane, at a uniformly random position along
 * the boundary; a position overlapping an existing disk is re-drawn (up to
 * `maxPlacementTries` times, then the entrant is dropped). Re-draws and drops
 * are counted, because they make the realised inflow differ from the stated
 * reservoir, and the realised state near the inlet is reported by experiments.
 *
 * The reservoir state is a boundary condition, not an aerodynamic law.
 */
export interface ReservoirBoundaryConfig {
  side: WallSide;
  numberDensity: number;
  kT: number;
  velocity: { x: number; y: number };
  mass: number;
  radius: number;
  /** internal energy given to entering parcels (Universe B); default 0 */
  internalEnergy?: number;
  maxPlacementTries?: number;
  /**
   * Optional position-dependent reservoir velocity along the boundary:
   * piecewise-linear in the tangential coordinate `at` (x for bottom/top, y for
   * left/right), clamped at the ends. Overrides `velocity`. Entrant positions
   * are then sampled in proportion to the local kinetic crossing flux.
   */
  velocityProfile?: { at: number[]; x: number[]; y: number[] };
}

export const RESERVOIR_BOUNDARY_VERSION = 'reservoir-boundary/1';

export class ReservoirBoundary {
  readonly config: Required<Omit<ReservoirBoundaryConfig, 'velocityProfile'>> & Pick<ReservoirBoundaryConfig, 'velocityProfile'>;
  private readonly domain: Domain;
  /** inward normal */
  private readonly nx: number;
  private readonly ny: number;
  private readonly plane: number;
  injected = 0;
  removed = 0;
  placementRedraws = 0;
  droppedEntrants = 0;

  constructor(config: ReservoirBoundaryConfig, domain: Domain) {
    this.config = { internalEnergy: 0, maxPlacementTries: 50, ...config };
    this.domain = domain;
    switch (config.side) {
      case 'left':
        [this.nx, this.ny, this.plane] = [1, 0, domain.xmin];
        break;
      case 'right':
        [this.nx, this.ny, this.plane] = [-1, 0, domain.xmax];
        break;
      case 'bottom':
        [this.nx, this.ny, this.plane] = [0, 1, domain.ymin];
        break;
      case 'top':
        [this.nx, this.ny, this.plane] = [0, -1, domain.ymax];
        break;
    }
    if ((config.side === 'left' || config.side === 'right') && domain.periodicX) throw new Error('reservoir on a periodic x axis');
    if ((config.side === 'bottom' || config.side === 'top') && domain.periodicY) throw new Error('reservoir on a periodic y axis');
  }

  private along(): { lo: number; hi: number } {
    const d = this.domain;
    const r = this.config.radius;
    // keep entrants clear of walls on the other axis (they are placed with their full disk inside)
    return this.nx !== 0 ? { lo: d.ymin + r, hi: d.ymax - r } : { lo: d.xmin + r, hi: d.xmax - r };
  }

  /** Signed distance of a point inside the domain from the plane (positive = inside). */
  private inside(x: number, y: number): number {
    return this.nx !== 0 ? (x - this.plane) * this.nx : (y - this.plane) * this.ny;
  }

  /** Reservoir velocity at tangential coordinate t (profile or uniform). */
  velocityAt(t: number): { x: number; y: number } {
    const pr = this.config.velocityProfile;
    if (!pr) return this.config.velocity;
    const { at } = pr;
    if (t <= at[0]) return { x: pr.x[0], y: pr.y[0] };
    const n = at.length;
    if (t >= at[n - 1]) return { x: pr.x[n - 1], y: pr.y[n - 1] };
    let k = 0;
    while (at[k + 1] < t) k++;
    const f = (t - at[k]) / (at[k + 1] - at[k]);
    return { x: pr.x[k] + f * (pr.x[k + 1] - pr.x[k]), y: pr.y[k] + f * (pr.y[k + 1] - pr.y[k]) };
  }

  private fluxTable: { lo: number; hi: number; mean: number; max: number } | null = null;

  /** Mean and maximum crossing flux per unit density along the boundary (profile case). */
  private flux(lo: number, hi: number) {
    if (this.fluxTable && this.fluxTable.lo === lo && this.fluxTable.hi === hi) return this.fluxTable;
    const c = this.config;
    let sum = 0;
    let max = 0;
    const K = 400;
    for (let k = 0; k < K; k++) {
      const t = lo + ((k + 0.5) / K) * (hi - lo);
      const v = this.velocityAt(t);
      const f = reservoirFluxPerDensity(v.x * this.nx + v.y * this.ny, c.kT, c.mass);
      sum += f;
      if (f > max) max = f;
    }
    this.fluxTable = { lo, hi, mean: sum / K, max };
    return this.fluxTable;
  }

  apply(store: ParticleStore, dt: number, rng: Rng, ledger: Ledger, collider: HardDiskCollider): { removed: number; injected: number } {
    // ---- outflow
    let removed = 0;
    for (let i = store.count - 1; i >= 0; i--) {
      if (this.inside(store.x[i], store.y[i]) >= 0) continue;
      const m = store.mass[i];
      ledger.boundaryEnergyOut += 0.5 * m * (store.vx[i] ** 2 + store.vy[i] ** 2) + store.energy[i];
      ledger.boundaryMomentumOutX += m * store.vx[i];
      ledger.boundaryMomentumOutY += m * store.vy[i];
      ledger.particlesOut++;
      const moved = store.removeSwap(i);
      if (moved >= 0) collider.moveParticle(moved, i);
      removed++;
    }
    this.removed += removed;

    // ---- inflow
    const c = this.config;
    const sigma = Math.sqrt(c.kT / c.mass);
    const { lo, hi } = this.along();
    const length = hi - lo;
    const profile = !!c.velocityProfile;
    const fl = profile ? this.flux(lo, hi) : null;
    const uniformFlux = reservoirFluxPerDensity(c.velocity.x * this.nx + c.velocity.y * this.ny, c.kT, c.mass);
    const expected = c.numberDensity * (profile ? fl!.mean : uniformFlux) * length * dt;
    const n = poisson(expected, rng);
    let injected = 0;
    for (let k = 0; k < n; k++) {
      if (store.count >= store.capacity) {
        this.droppedEntrants++;
        continue;
      }
      let placed = false;
      let px = 0;
      let py = 0;
      let vx = 0;
      let vy = 0;
      for (let tries = 0; tries < c.maxPlacementTries; tries++) {
        // position ∝ local crossing flux (rejection); uniform when there is no profile
        let t = lo + length * rng.next();
        if (profile) {
          let guard = 0;
          while (guard++ < 1000) {
            const v = this.velocityAt(t);
            const f = reservoirFluxPerDensity(v.x * this.nx + v.y * this.ny, c.kT, c.mass);
            if (rng.next() * fl!.max <= f) break;
            t = lo + length * rng.next();
          }
        }
        const U = this.velocityAt(t);
        const Un = U.x * this.nx + U.y * this.ny;
        const Ut = this.nx !== 0 ? U.y : U.x;
        const vn = sigma * sampleCrossingNormal(Un / sigma, rng);
        const vt = Ut + sigma * rng.gaussian();
        const depth = vn * dt * rng.next();
        px = this.nx !== 0 ? this.plane + this.nx * depth : t;
        py = this.nx !== 0 ? t : this.plane + this.ny * depth;
        vx = this.nx !== 0 ? vn * this.nx : vt;
        vy = this.nx !== 0 ? vt : vn * this.ny;
        if (!this.overlaps(store, px, py)) {
          placed = true;
          break;
        }
        this.placementRedraws++;
      }
      if (!placed) {
        this.droppedEntrants++;
        continue;
      }
      const i = store.add({ x: px, y: py, vx, vy, mass: c.mass, radius: c.radius, energy: c.internalEnergy });
      collider.resetParticle(i);
      ledger.boundaryEnergyOut -= 0.5 * c.mass * (vx * vx + vy * vy) + c.internalEnergy;
      ledger.boundaryMomentumOutX -= c.mass * vx;
      ledger.boundaryMomentumOutY -= c.mass * vy;
      ledger.particlesIn++;
      injected++;
    }
    this.injected += injected;
    return { removed, injected };
  }

  /** Brute-force overlap test restricted to a band near the boundary (entrants sit within v·dt of it). */
  private overlaps(store: ParticleStore, px: number, py: number): boolean {
    const r = this.config.radius;
    const { x, y, radius } = store;
    for (let j = 0; j < store.count; j++) {
      const R = r + radius[j];
      const dx = x[j] - px;
      if (dx > R || dx < -R) continue;
      const dy = y[j] - py;
      if (dy > R || dy < -R) continue;
      if (dx * dx + dy * dy < R * R) return true;
    }
    return false;
  }

  stats() {
    return {
      side: this.config.side,
      injected: this.injected,
      removed: this.removed,
      placementRedraws: this.placementRedraws,
      droppedEntrants: this.droppedEntrants,
    };
  }
}
