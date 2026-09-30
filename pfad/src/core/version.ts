import { COLLISION_MODEL_VERSION } from './CollisionModel';
import { WALL_MODEL_VERSION } from '../walls/WallModel';

/**
 * PFAD model version. Any change to a physical rule or its numerical treatment
 * bumps this and is logged in docs/MODEL_CHANGELOG.md (Master prompt §4).
 */
export const PFAD_MODEL_VERSION = '0.2.0-p0.2';

export const MODEL_COMPONENTS = {
  dimension: '2D disks (docs/MODEL_ASSUMPTIONS.md A-02)',
  collision: COLLISION_MODEL_VERSION,
  walls: WALL_MODEL_VERSION,
  integrator: 'drift → pair collisions → walls, velocity-Verlet kicks when forces present /1',
  rng: 'sfc32 via splitmix32, named streams /1',
} as const;
