import { describe, expect, it } from 'vitest';
import { DEFAULT_DEPTH_CM, DEFAULT_SCENARIO, parseDepth, wingForces } from '../src/experiments/PhysicalScenario';
import { measuredForces, referenceForce } from '../src/geometry/Forces';
import { newProject, parseProject, projectToJSON, setWingDepth } from '../src/geometry/History';
import { flatPlate } from '../src/geometry/SurfaceGeometry';

const conditions = { areaFraction: 0.1, radius: 0.5, mass: 1, speed: 1, alphaDeg: 30 };
const forces = (fx: number, fy: number) => ({ fx: { mean: fx, se: 0.2, n: 48 }, fy: { mean: fy, se: 0.1, n: 48 }, moment: { mean: 0, se: 1, n: 48 } });

describe('drag and lift as measured in the simulation', () => {
  it('the reference force is the free stream’s dynamic pressure times the chord, from the imposed conditions only', () => {
    const rho = 0.1 / (Math.PI * 0.25);
    expect(referenceForce(conditions, 30)).toBeCloseTo(0.5 * rho * 1 * 30, 12);
    expect(referenceForce({ ...conditions, speed: 2 }, 30)! / referenceForce(conditions, 30)!).toBeCloseTo(4, 12);
    expect(referenceForce(conditions, 60)! / referenceForce(conditions, 30)!).toBeCloseTo(2, 12);
    expect(referenceForce({ alphaDeg: 30 }, 30)).toBeNull();
    expect(referenceForce({ ...conditions, speed: 0 }, 30)).toBeNull();
  });

  it('drag is the force along the stream and lift the force across it; coefficients carry the uncertainty', () => {
    const m = measuredForces({ conditions, forces: forces(5.085, 1.46) }, 30)!;
    expect(m.drag.mean).toBe(5.085);
    expect(m.lift.mean).toBe(1.46);
    expect(m.dragCoeff.mean).toBeCloseTo(5.085 / m.reference, 12);
    expect(m.liftCoeff.mean).toBeCloseTo(1.46 / m.reference, 12);
    expect(m.dragCoeff.se).toBeCloseTo(0.2 / m.reference, 12);
    expect(m.liftCoeff.se).toBeCloseTo(0.1 / m.reference, 12);
    // a plate at 65° in this simulation: both coefficients are of order one
    expect(m.dragCoeff.mean).toBeGreaterThan(1);
    expect(m.dragCoeff.mean).toBeLessThan(5);
    expect(measuredForces({ conditions: { alphaDeg: 1 }, forces: forces(1, 1) }, 30)).toBeNull();
  });
});

describe('scaled to a wing of a given depth in the described air', () => {
  const m = measuredForces({ conditions, forces: forces(1, 0.5) }, 30)!;
  // make the drag coefficient exactly 1 and the lift coefficient exactly 0.5
  const unit = measuredForces({ conditions, forces: forces(referenceForce(conditions, 30)!, 0.5 * referenceForce(conditions, 30)!) }, 30)!;
  const air = { ...DEFAULT_SCENARIO, lengthCm: 20, speedKmh: 36, tempC: 15, altitudeM: 0 };

  it('F = C · ½ρU² · chord · depth', () => {
    const w = wingForces(unit, air, 100);
    expect(w.dynamicPressure).toBeCloseTo(0.5 * 1.225 * 100, 0);
    expect(w.area).toBeCloseTo(0.2, 12);
    expect(w.drag.mean).toBeCloseTo(12.25, 1);
    expect(w.lift.mean).toBeCloseTo(6.125, 1);
    expect(w.aspectRatio).toBeCloseTo(5, 12);
  });

  it('is linear in the depth, quadratic in the wind, and smaller in thin air', () => {
    const base = wingForces(unit, air, 100).drag.mean;
    expect(wingForces(unit, air, 200).drag.mean / base).toBeCloseTo(2, 12);
    expect(wingForces(unit, { ...air, speedKmh: 72 }, 100).drag.mean / base).toBeCloseTo(4, 12);
    expect(wingForces(unit, { ...air, altitudeM: 3000 }, 100).drag.mean).toBeLessThan(base * 0.8);
    expect(wingForces(unit, { ...air, tempC: -30 }, 100).drag.mean).toBeGreaterThan(base);
  });

  it('carries the uncertainty through, and newtonsPerUnit scales any force the same way', () => {
    const w = wingForces(m, air, 100);
    expect(w.drag.se / w.drag.mean).toBeCloseTo(m.dragCoeff.se / m.dragCoeff.mean, 12);
    expect(w.drag.mean).toBeCloseTo(m.drag.mean * w.newtonsPerUnit, 9);
    expect(w.lift.mean).toBeCloseTo(m.lift.mean * w.newtonsPerUnit, 9);
  });

  it('the wing depth is checked, and kept with the project without being a flow condition', () => {
    expect(parseDepth('50')).toEqual({ ok: true, depthCm: 50 });
    expect(parseDepth('0').ok).toBe(false);
    expect(parseDepth('x').ok).toBe(false);
    expect(parseDepth('6000').ok).toBe(false);
    expect(DEFAULT_DEPTH_CM).toBeGreaterThan(0);
    const p = setWingDepth(newProject('t', { alphaDeg: 30 }, flatPlate(30, 3)), 75);
    expect(p.wingDepthCm).toBe(75);
    expect(p.log.length).toBe(1); // nothing was logged as a change of conditions
    expect(p.conditions).toEqual({ alphaDeg: 30 });
    expect(parseProject(projectToJSON(p)).project.wingDepthCm).toBe(75);
  });
});
