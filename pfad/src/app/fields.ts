import type { FieldKind } from '../workers/protocol';

/**
 * What every displayed field is (UI contract): its quantity, symbol, units and
 * whether it is measured directly from particle data in a cell or derived from
 * such measurements. Units are the model units of docs/MODEL_ASSUMPTIONS.md A-01:
 * particle mass m = 1, diameter d = 1, k_B = 1, reference kT₀ = 1, time unit
 * τ = d·√(m/kT₀). No physical (SI) scaling exists yet; none is implied.
 */
export type FieldOrigin = 'measured' | 'derived';

export interface FieldInfo {
  label: string;
  symbol: string;
  units: string;
  origin: FieldOrigin;
  /** how the cell value is formed from particle data */
  definition: string;
}

export const UNITS_NOTE = 'model units (A-01): m = d = k_B = kT₀ = 1, τ = d·√(m/kT₀); no physical scaling';

export const FIELD_INFO: Record<Exclude<FieldKind, 'none'>, FieldInfo> = {
  occupancy: {
    label: 'occupancy',
    symbol: 'φ',
    units: '1 (area fraction)',
    origin: 'measured',
    definition: 'Σ disk area in the cell / (snapshots · cell area)',
  },
  occupancyGradient: {
    label: 'occupancy gradient',
    symbol: '|∇φ|',
    units: '1/d',
    origin: 'derived',
    definition: 'central difference of the measured φ field',
  },
  density: {
    label: 'mass density',
    symbol: 'ρ',
    units: 'm/d²',
    origin: 'measured',
    definition: 'Σ m in the cell / (snapshots · cell area)',
  },
  speed: {
    label: 'mean velocity magnitude',
    symbol: '|u|',
    units: '√(kT₀/m)',
    origin: 'derived',
    definition: '|u| of the measured mass-weighted mean velocity u = Σ m v / Σ m',
  },
  ux: {
    label: 'mean velocity, x',
    symbol: 'u_x',
    units: '√(kT₀/m)',
    origin: 'measured',
    definition: 'Σ m v_x / Σ m over the particles in the cell',
  },
  uy: {
    label: 'mean velocity, y',
    symbol: 'u_y',
    units: '√(kT₀/m)',
    origin: 'measured',
    definition: 'Σ m v_y / Σ m over the particles in the cell',
  },
  momentumX: {
    label: 'momentum density, x',
    symbol: 'ρu_x',
    units: '√(m·kT₀)/d²',
    origin: 'measured',
    definition: 'Σ m v_x in the cell / (snapshots · cell area)',
  },
  momentumY: {
    label: 'momentum density, y',
    symbol: 'ρu_y',
    units: '√(m·kT₀)/d²',
    origin: 'measured',
    definition: 'Σ m v_y in the cell / (snapshots · cell area)',
  },
  kT: {
    label: 'temperature (peculiar kinetic energy per particle)',
    symbol: 'kT',
    units: 'kT₀',
    origin: 'measured',
    definition: '(Σ ½m|v|² − ½|Σ m v|²/Σ m) / Σ count, peculiar to the cell mean velocity (A-03)',
  },
  pressure: {
    label: 'local pressure (particle stress)',
    symbol: 'P = ½(P_xx + P_yy)',
    units: 'kT₀/d²',
    origin: 'measured',
    definition:
      'momentum transfer per unit time and area inside the gas: kinetic flux Σ m (v−u)(v−u) plus logged collisional impulses at contact points. Wall pressure is measured separately, from wall impulses only.',
  },
  shear: {
    label: 'local shear stress (particle stress)',
    symbol: 'τ_xy = −P_xy',
    units: 'kT₀/d²',
    origin: 'measured',
    definition: 'off-diagonal part of the same momentum-transfer stress tensor',
  },
};

/** "instantaneous" for one snapshot, otherwise the averaging window. */
export function temporalLabel(snapshots: number, t0: number, t1: number): string {
  if (snapshots <= 1) return 'instantaneous (1 snapshot)';
  return `time-averaged over ${snapshots} snapshots, t = ${t0.toPrecision(4)} … ${t1.toPrecision(4)} τ`;
}

/** Samples per cell below which a cell value is dominated by noise (display rule, not a statistic). */
export const NOISE_SAMPLES = 100;
