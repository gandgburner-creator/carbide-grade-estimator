import type { CfdResult } from '../../cfd/CfdRun';
import { resultPhysics, sheetOfInput, type PhysicsRow } from '../../experiments/CfdPhysics';
import type { PhysicalInputs } from '../../experiments/FlowGeometryExperiment';

const LEVEL_MARK = { ok: '', note: ' ⓘ', warn: ' ⚠' } as const;

/** The dimensionless numbers and pressure relations, one block each: name, value, formula and what it means here. */
export function PhysicsTable({ rows }: { rows: PhysicsRow[] }) {
  return (
    <div className="physics-list">
      {rows.map((r) => (
        <div key={r.id} className={`prow lvl-${r.level}`} data-row={r.id}>
          <div className="phead">
            <span className="pname">
              {r.name} <i>{r.symbol}</i>
            </span>
            <b className="pvalue">
              {r.value}
              {LEVEL_MARK[r.level]}
            </b>
          </div>
          <div className="pformula">{r.formula}</div>
          <div className="pmeaning">{r.meaning}</div>
        </div>
      ))}
    </div>
  );
}

/** Pressure extremes, local Mach number, cavitation margin and the check against Bernoulli's equation, for a finished run in the described fluid. */
export function ResultPhysicsPanel({ scenario, res }: { scenario: PhysicalInputs; res: CfdResult }) {
  const out = resultPhysics(sheetOfInput(scenario), res);
  return (
    <div data-testid="result-physics">
      <h3 className="h3">Pressures and Bernoulli check</h3>
      <div className="note">The computed pressure field, put in the units of your fluid. Pressures and speeds are time means over the window.</div>
      <PhysicsTable rows={out.rows} />
      {out.warnings.map((w, i) => (
        <div key={i} className="warn">{w}</div>
      ))}
    </div>
  );
}

/** The physics sheet of a set-up, open by default, with the statement of what it is and is not. */
export function PhysicsSheetDetails({ rows }: { rows: PhysicsRow[] }) {
  return (
    <details open className="physics-sheet">
      <summary>
        <b>Physics sheet</b> — Reynolds, Mach, Knudsen, pressures, cavitation
      </summary>
      <PhysicsTable rows={rows} />
      <div className="note">Every row is a classical relation evaluated for your fluid and wind, to tell you how close your situation is to what the solver computes. None of them is an input of the solver, which advances the Navier–Stokes equations at the Reynolds number above.</div>
    </details>
  );
}
