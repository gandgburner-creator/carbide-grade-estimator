import { MODEL_COMPONENTS, PFAD_MODEL_VERSION } from '../core/version';

declare const __PFAD_CODE_VERSION__: string | undefined;

/** Git commit the application was built from ("-dirty" when the tree had uncommitted changes). */
export const CODE_VERSION: string = typeof __PFAD_CODE_VERSION__ === 'string' ? __PFAD_CODE_VERSION__ : 'unknown';
export const APP_VERSION = 'pfad-lab/1';

export interface Provenance {
  app: string;
  codeVersion: string;
  modelVersion: string;
  modelComponents: Record<string, string>;
  experimentType: string;
  universe: 'A' | 'B';
  /** configuration preset the run started from */
  preset: string;
  seeds: number[];
  /** when the run (or the import) was created */
  createdAt: string;
  units: string;
}

export function makeProvenance(p: Pick<Provenance, 'experimentType' | 'universe' | 'preset' | 'seeds'> & { createdAt?: string; modelVersion?: string; codeVersion?: string }): Provenance {
  return {
    app: APP_VERSION,
    codeVersion: p.codeVersion ?? CODE_VERSION,
    modelVersion: p.modelVersion ?? PFAD_MODEL_VERSION,
    modelComponents: { ...MODEL_COMPONENTS },
    experimentType: p.experimentType,
    universe: p.universe,
    preset: p.preset,
    seeds: p.seeds.slice(),
    createdAt: p.createdAt ?? new Date().toISOString(),
    units: 'model units (A-01): m = d = k_B = kT₀ = 1, τ = d·√(m/kT₀)',
  };
}
