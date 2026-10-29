import type { PhysicalInputs } from '../../experiments/FlowGeometryExperiment';
import { sci, wingForces } from '../../experiments/PhysicalScenario';
import type { ForceMeasure } from '../../geometry/Forces';
import type { Est } from '../../measurements/SeparationDetector';
import { fmt } from '../Panels';

const n = (e: Est, digits = 3) => `${fmt(e.mean, digits)} ± ${fmt(e.se, 2)}`;

/**
 * Lift and drag of one simulated version: as measured in the simulation (per unit depth, model units), as the
 * simulation's dimensionless coefficients, and scaled to the wing and the air that were described. The last column
 * is a scaling of the simulation's coefficients, never a prediction for the real wing, and is labelled so.
 */
export function ForcesPanel({ forces, scenario, depthCm, compact = false, cfd = null }: { forces: ForceMeasure | null; scenario: PhysicalInputs | null; depthCm: number | null; compact?: boolean; /** set for the CFD workspace: the Reynolds number of the run and of the real plate */ cfd?: { run: number; real: number } | null }) {
  if (!forces) return <div className="note">Lift and drag need the conditions of the run (density, radius, mass, speed); this run does not carry them.</div>;
  const w = scenario && depthCm ? wingForces(forces, scenario, depthCm) : null;
  return (
    <div className="forces">
      <table className="results compare">
        <thead>
          <tr>
            <th />
            <th title="measured momentum-transfer rate on the body, per unit depth, in the simulation's own units">measured</th>
            <th title="divided by ½ρU²c of the simulation (dimensionless, per unit depth)">coefficient</th>
            {w && <th title="the simulation's coefficient × ½ρU² of your air × (plate length × wing depth)">your wing, your air</th>}
          </tr>
        </thead>
        <tbody>
          <tr title="the force on the body along the stream (downstream is positive)">
            <td className="q">
              <b>Drag</b>
              <br />
              <span className="note">along the stream</span>
            </td>
            <td>{n(forces.drag)}</td>
            <td>{n(forces.dragCoeff)}</td>
            {w && <td>{n(w.drag, 3)} N</td>}
          </tr>
          <tr title="the force on the body across the stream (positive = toward +y; upward for a nose-up body)">
            <td className="q">
              <b>Lift</b>
              <br />
              <span className="note">across the stream</span>
            </td>
            <td>{n(forces.lift)}</td>
            <td>{n(forces.liftCoeff)}</td>
            {w && <td>{n(w.lift, 3)} N</td>}
          </tr>
        </tbody>
      </table>
      <div className="note">
        {cfd ? (
          <>
            <span className="tag measured">COMPUTED</span> drag and lift are the force the fluid exerts on the body (pressure and viscous), from the momentum exchanged with its surface, averaged over the window and its time blocks (± 1 standard error of the block means), per unit depth because the simulation is 2-D.{' '}
          </>
        ) : (
          <>
            <span className="tag measured">MEASURED</span> drag and lift are the momentum the particles hand to the body per unit time, averaged over the measurement window and the seeds (± 1 standard error), per unit depth because the simulation is 2-D.{' '}
          </>
        )}
        <span className="tag derived">DERIVED</span> the coefficient divides by the simulation’s own ½ρU²·chord ({sci(forces.reference)} in its units).
        {w && (
          <>
            {' '}
            <span className="tag imposed">SCALED ESTIMATE</span> the last column multiplies the coefficients by the dynamic pressure of your air (ρ = {w.air.density.toFixed(3)} kg/m³, wind {(scenario!.speedKmh / 3.6).toFixed(1)} m/s: q = {w.dynamicPressure.toFixed(1)} Pa) and the area of your wing ({(w.chordM * 100).toFixed(0)} × {depthCm} cm = {w.area.toFixed(3)} m², depth : chord = {w.aspectRatio.toFixed(1)}).
          </>
        )}
      </div>
      {w ? (
        <div className="warn">
          {cfd
            ? `NOT A PREDICTION for your wing. The coefficients were computed for a two-dimensional flow at Reynolds number ${Math.round(cfd.run)}${cfd.real > cfd.run * 1.05 ? `, while your plate in your air has ${Math.round(cfd.real)}: a real plate at that Reynolds number has a turbulent boundary layer, and where the flow separates and the force coefficients can differ` : ''}; a real wing of this depth also has end effects a 2-D simulation cannot show. The newtons only put the simulation’s numbers in units you can picture.`
            : 'NOT A PREDICTION for your wing. The coefficients were measured in a thin 2-D gas of hard disks; real air at your speed has Reynolds and Mach numbers the simulation does not reproduce, and a real wing of this depth has end effects a 2-D simulation cannot show. The newtons only put the simulation’s numbers in units you can picture.'}
        </div>
      ) : (
        <div className="note">Set up with the plain inputs (length, temperature, height, wind) to scale these to a wing in your air; until then only the simulation’s own numbers are shown.</div>
      )}
      {!compact && <div className="note">No composite score and no lift-to-drag ranking is made: the two forces are reported on their own, and nothing here is optimised.</div>}
    </div>
  );
}
