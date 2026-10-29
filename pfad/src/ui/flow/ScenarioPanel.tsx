import type { PhysicalInputs } from '../../experiments/FlowGeometryExperiment';
import { FIELDS, sci, type ScenarioReport } from '../../experiments/PhysicalScenario';

export type ScenarioText = Record<keyof PhysicalInputs, string>;

export const scenarioText = (s: PhysicalInputs): ScenarioText => ({
  lengthCm: String(s.lengthCm),
  thicknessCm: String(s.thicknessCm),
  tempC: String(s.tempC),
  altitudeM: String(s.altitudeM),
  speedKmh: String(s.speedKmh),
  alphaDeg: String(s.alphaDeg),
});

/**
 * The six plain inputs and, right under them, what the simulation will actually run and how far
 * that is from the real plate. Nothing is hidden: the same numbers are recorded with every run.
 */
export function ScenarioPanel(p: {
  text: ScenarioText;
  onText: (key: keyof PhysicalInputs, value: string) => void;
  errors: string[] | null;
  report: ScenarioReport | null;
  disabled: boolean;
  /** the project was set up in model units (before the plain inputs existed): the plain inputs only start a new project */
  legacy: boolean;
  /** length or thickness differ from the open project's plate: they apply to a new project only */
  shapeDiffers: boolean;
  preset: 'quick' | 'extended';
  onPreset: (k: 'quick' | 'extended') => void;
  /** wing depth (span) in cm: scales the 2-D forces; not a flow condition */
  depthText: string;
  onDepth: (v: string) => void;
  depthError: string | null;
}) {
  const r = p.report;
  return (
    <div>
      <div className="params simple">
        {FIELDS.map((f) => (
          <label key={f.key} title={f.role}>
            {f.label} [{f.unit}]
            <input inputMode="decimal" value={p.text[f.key]} disabled={p.disabled} onChange={(e) => p.onText(f.key, e.target.value)} aria-label={`${f.label} in ${f.unit}`} />
            <span className="hint">{f.role}</span>
          </label>
        ))}
      </div>
      <div className="params simple" style={{ marginTop: 4 }}>
        <label title="the simulation is two-dimensional; this scales its forces to a wing this deep">
          wing depth (span) [cm]
          <input inputMode="decimal" value={p.depthText} onChange={(e) => p.onDepth(e.target.value)} aria-label="wing depth in cm" />
          <span className="hint">only scales lift and drag to a wing this deep (the simulation is 2-D); it does not change the simulation</span>
        </label>
      </div>
      {p.depthError && <div className="error">{p.depthError}</div>}
      <div className="seg" style={{ margin: '6px 0' }}>
        {(['quick', 'extended'] as const).map((k) => (
          <button key={k} className={`ctl ${p.preset === k ? 'on' : ''}`} disabled={p.disabled} onClick={() => p.onPreset(k)} title={k === 'quick' ? 'about 2 minutes per version; weak statistics' : 'about 4 minutes per version or more; stronger statistics'}>
            {k === 'quick' ? 'QUICK LOOK' : 'LONGER RUN'}
          </button>
        ))}
      </div>
      {p.errors && p.errors.map((e, i) => <div key={i} className="error">{e}</div>)}
      {p.shapeDiffers && !p.legacy && <div className="warn">Length and thickness take effect when you start a new project (the open plate keeps its shape).</div>}
      {p.legacy && <div className="warn">This project was set up in model units, so these inputs only apply to a new project.</div>}
      {r && (
        <div className="scenario-box">
          <h3 className="h3">What the simulation will run</h3>
          <ul className="plain">
            {r.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <table className="results compare">
            <thead>
              <tr>
                <th />
                <th>your real plate</th>
                <th>the simulation</th>
              </tr>
            </thead>
            <tbody>
              <tr title="wind speed ÷ speed of sound">
                <td className="q">Mach number</td>
                <td>{sci(r.real.mach)}</td>
                <td>{sci(r.simulated.mach)}</td>
              </tr>
              <tr title="inertia ÷ viscosity">
                <td className="q">Reynolds number</td>
                <td>{sci(r.real.reynolds)}</td>
                <td>{sci(r.simulated.reynolds)}</td>
              </tr>
              <tr title="gap between molecules ÷ plate length">
                <td className="q">Knudsen number</td>
                <td>{sci(r.real.knudsen)}</td>
                <td>{sci(r.simulated.knudsen)}</td>
              </tr>
              <tr>
                <td className="q">particles simulated</td>
                <td>—</td>
                <td>{r.particles.toLocaleString('en')}</td>
              </tr>
            </tbody>
          </table>
          <div className="note">Real-air values are standard reference formulas (for comparison only, never used inside the simulation). The simulation’s values come from this model’s own measured sound speed and viscosity.</div>
          {r.cautions.map((c, i) => (
            <div key={i} className="warn">
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

