import type { ForceMeasure } from '../geometry/Forces';
import type { CfdResult } from './CfdRun';

/** The drag and lift of a CFD result in the form the shared panels and the scaling to newtons use (forces per unit depth, lattice units). */
export function cfdForceMeasure(res: CfdResult): ForceMeasure {
  return { drag: res.forces.drag, lift: res.forces.lift, dragCoeff: res.forces.dragCoeff, liftCoeff: res.forces.liftCoeff, reference: res.forces.reference, chord: res.params.cells };
}
