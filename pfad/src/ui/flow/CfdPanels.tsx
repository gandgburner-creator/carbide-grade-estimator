import { useRef } from 'react';
import { cfdForceMeasure } from '../../cfd/CfdForces';
import { cfdActivePath, cfdVersion, type CfdPreset, type CfdProject, type CfdVersion } from '../../cfd/CfdProject';
import type { CfdResult } from '../../cfd/CfdRun';
import { CFD_PRESETS } from '../../cfd/CfdRun';
import type { PhysicalInputs } from '../../experiments/FlowGeometryExperiment';
import { FIELDS, sci, wingForces } from '../../experiments/PhysicalScenario';
import type { CfdSetup } from '../../experiments/CfdScenario';
import { fmt } from '../Panels';
import { ForcesPanel } from './ForcesPanel';
import type { ScenarioText } from './ScenarioPanel';

const n = (e: { mean: number; se: number }, d = 3) => `${fmt(e.mean, d)} ± ${fmt(e.se, 1)}`;

/** The plain inputs, the resolution, and what the CFD run will be (the Reynolds number above all). */
export function CfdScenarioPanel(p: {
  text: ScenarioText;
  onText: (key: keyof PhysicalInputs, value: string) => void;
  errors: string[] | null;
  setup: CfdSetup | null;
  disabled: boolean;
  preset: CfdPreset;
  onPreset: (k: CfdPreset) => void;
  depthText: string;
  onDepth: (v: string) => void;
  depthError: string | null;
}) {
  const s = p.setup;
  return (
    <div>
      <div className="params simple">
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label} [{f.unit}]
            <input inputMode="decimal" value={p.text[f.key]} disabled={p.disabled} onChange={(e) => p.onText(f.key, e.target.value)} aria-label={`${f.label} in ${f.unit}`} />
          </label>
        ))}
        <label title="the simulation is two-dimensional; this scales its forces to a wing this deep">
          wing depth (span) [cm]
          <input inputMode="decimal" value={p.depthText} onChange={(e) => p.onDepth(e.target.value)} aria-label="wing depth in cm" />
        </label>
      </div>
      <div className="note">The temperature, height and wind act only through the Reynolds number (and the density when forces are scaled to newtons). The wing depth only scales lift and drag.</div>
      {p.depthError && <div className="error">{p.depthError}</div>}
      {p.errors && p.errors.map((e, i) => <div key={i} className="error">{e}</div>)}
      <div className="seg" style={{ margin: '6px 0' }}>
        {(['quick', 'standard', 'fine'] as const).map((k) => (
          <button key={k} className={`ctl ${p.preset === k ? 'on' : ''}`} disabled={p.disabled} onClick={() => p.onPreset(k)} aria-label={`resolution ${k}`} title={`${CFD_PRESETS[k].cells} lattice cells along the plate`}>
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="note">Resolution: {s ? s.cells : CFD_PRESETS[p.preset].cells} cells along the plate. A finer lattice resolves more of the boundary layer and can run a higher Reynolds number, and takes longer: about 2 minutes (quick), 6 (standard) or 20 (fine) per version on a laptop.</div>
      {s && (
        <div className="exp-banner" style={{ margin: '6px 0' }}>
          <b>What the simulation will run</b>
          {s.lines.map((l, i) => (
            <div key={i} className="note">{l}</div>
          ))}
          {s.thicknessNote && <div className="warn">{s.thicknessNote}</div>}
          {s.cautions.map((c, i) => (
            <div key={i} className="warn">{c}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Integrity, separation and forces of one version's CFD result. */
export function CfdMeasurements(p: { version: CfdVersion; scenario: PhysicalInputs | null; depthCm: number; realReynolds: number }) {
  const run = p.version.run;
  if (!run) return <div className="note">{p.version.id} has not been simulated: press SIMULATE to compute its flow. Until then there are no results, and none are drawn.</div>;
  const res: CfdResult = run.result;
  return (
    <div>
      <div className="exp-banner">
        CFD result of {p.version.id}: Reynolds number {Math.round(res.params.reynolds)} ({res.params.cells} cells along the plate), mean over {res.windowSteps} steps in {res.params.blocks} time blocks (± 1 standard error of the block means). The solver is deterministic: there is no seed, and the only uncertainty is the time variation of the flow.
      </div>
      <h3 className="h3">Integrity of the run <span className={`tag ${res.integrity.status === 'PASSED' ? 'measured' : 'stopped'}`}>{res.integrity.status}</span></h3>
      <table className="results">
        <tbody>
          {res.integrity.checks.map((c) => (
            <tr key={c.id} title={c.criterion}>
              <td>{c.pass ? '✓' : c.hard ? '✗' : '!'}</td>
              <td>{c.label}</td>
              <td>{c.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="h3">Where the flow leaves the wall</h3>
      <div className="note">
        The wall shear C_f = τ / (½ρU²) along the downstream tangent, from the time-mean velocity beside the wall: where its sign turns from positive to negative the mean flow beside the wall reverses, which is the classical sign of separation. Nothing here assumes where that happens.
      </div>
      {(['upper', 'lower'] as const).map((s) => (
        <div key={s} className="note">
          <b>{s} side</b>: {res.separation[s].note}.{res.separation[s].reversed ? ` Reversed flow beside ${(100 * res.separation[s].reversedShare).toFixed(0)} % of its stations.` : ''}
        </div>
      ))}
      <h3 className="h3">Lift and drag of {p.version.id}</h3>
      <ForcesPanel forces={cfdForceMeasure(res)} scenario={p.scenario} depthCm={p.depthCm} cfd={{ run: res.params.reynolds, real: p.realReynolds }} />
    </div>
  );
}

/** Two versions side by side: forces (with B − A and z) and where the flow separates. */
export function CfdCompare(p: { project: CfdProject; a: string; b: string; onChange: (a: string, b: string) => void; scenario: PhysicalInputs | null; depthCm: number; realReynolds: number }) {
  const withRuns = p.project.versions.filter((v) => v.run);
  if (withRuns.length < 2) return <div className="note">Comparison needs two simulated versions. Simulate the starting plate, move the pointer, simulate that too, then compare.</div>;
  const va = cfdVersion(p.project, p.a);
  const vb = cfdVersion(p.project, p.b);
  const ra = va.run?.result;
  const rb = vb.run?.result;
  const diff = (a: { mean: number; se: number }, b: { mean: number; se: number }) => {
    const d = b.mean - a.mean;
    const se = Math.hypot(a.se, b.se);
    return { d, se, z: se > 0 ? d / se : null };
  };
  const rows: [string, { mean: number; se: number }, { mean: number; se: number }, string][] = [];
  if (ra && rb) {
    rows.push(['drag coefficient', ra.forces.dragCoeff, rb.forces.dragCoeff, ''], ['lift coefficient', ra.forces.liftCoeff, rb.forces.liftCoeff, '']);
    if (p.scenario) {
      const wa = wingForces(cfdForceMeasure(ra), p.scenario, p.depthCm);
      const wb = wingForces(cfdForceMeasure(rb), p.scenario, p.depthCm);
      rows.push(['drag on your wing', wa.drag, wb.drag, ' N'], ['lift on your wing', wa.lift, wb.lift, ' N']);
    }
  }
  return (
    <div>
      <div className="two-col pick">
        {(
          [
            ['A (earlier)', p.a, (v: string) => p.onChange(v, p.b)],
            ['B (later)', p.b, (v: string) => p.onChange(p.a, v)],
          ] as const
        ).map(([label, val, set]) => (
          <label className="field" key={label}>
            {label}
            <select value={val} onChange={(e) => set(e.target.value)}>
              {withRuns.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} — {v.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!ra || !rb || va.id === vb.id ? (
        <div className="note">Choose two different simulated versions.</div>
      ) : (
        <>
          {ra.params.reynolds !== rb.params.reynolds || ra.params.cells !== rb.params.cells || ra.params.alphaDeg !== rb.params.alphaDeg ? <div className="warn">The two runs differ in Reynolds number, resolution or angle: a difference below may come from them, not from the shape.</div> : null}
          {ra.integrity.status === 'FAILED' || rb.integrity.status === 'FAILED' ? <div className="warn">At least one run failed its integrity checks: its numbers are not reliable.</div> : null}
          <h3 className="h3">Lift and drag (no composite score: each is reported on its own)</h3>
          <table className="results compare">
            <thead>
              <tr>
                <th>quantity</th>
                <th>A</th>
                <th>B</th>
                <th>B − A ± se</th>
                <th>z</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, ea, eb, unit]) => {
                const d = diff(ea, eb);
                return (
                  <tr key={label}>
                    <td className="q">{label}</td>
                    <td>
                      {n(ea)}
                      {unit}
                    </td>
                    <td>
                      {n(eb)}
                      {unit}
                    </td>
                    <td>
                      {fmt(d.d, 3)} ± {fmt(d.se, 2)}
                      {unit}
                    </td>
                    <td>
                      {d.z === null ? '—' : d.z.toFixed(1)}
                      <br />
                      <span className="note">{d.z === null ? '' : Math.abs(d.z) < 2 ? 'unresolved' : d.d > 0 ? 'larger in B' : 'smaller in B'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="note">Differences use √(se_A² + se_B²) of the time-block means; |z| &lt; 2 is unresolved. No lift-to-drag ranking is made and no shape is called better.</div>
          <h3 className="h3">Where the flow leaves the wall</h3>
          <table className="results">
            <tbody>
              {(['upper', 'lower'] as const).map((s) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>{ra.separation[s].note}</td>
                  <td>→</td>
                  <td>{rb.separation[s].note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {vb.move && (
            <div className="hyp unresolved">
              <b>The stated prediction</b>
              <div className="note">{vb.move.hypothesis}</div>
              <div>Read it from the table above and the wall-shear curves; the CFD workspace does not score it.</div>
            </div>
          )}
        </>
      )}
      <div className="note">Reynolds number of the plate in your air: {sci(p.realReynolds)}.</div>
    </div>
  );
}

/** Versions, undo, project export and import, saved projects. */
export function CfdHistory(p: {
  project: CfdProject;
  viewId: string;
  onView: (id: string) => void;
  onCompare: (a: string, b: string) => void;
  onUndo: () => void;
  canUndo: boolean;
  onExport: () => void;
  onExportCsv: () => void;
  onImport: (f: File) => void;
  saved: { id: string; name: string; versions: number }[];
  onOpenSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  persistent: boolean;
  forceLine: (v: CfdVersion) => string | null;
}) {
  const onPath = new Set(cfdActivePath(p.project).map((v) => v.id));
  const file = useRef<HTMLInputElement>(null);
  return (
    <div>
      <h3 className="h3">Geometry versions</h3>
      <div className="lib-list">
        {[...p.project.versions].reverse().map((v) => (
          <div key={v.id} className={`lib-item ${p.viewId === v.id ? 'active' : ''} ${v.undone ? 'undone' : ''}`}>
            <div className="row-between">
              <button className="linklike" onClick={() => p.onView(v.id)} title="show this version’s results">
                {v.id} — {v.label}
              </button>
              <span>
                {p.project.head === v.id && <span className="tag measured">HEAD</span>} {v.undone && <span className="tag stopped">UNDONE</span>}
              </span>
            </div>
            <div className="note">
              <span className={`tag ${v.origin === 'initial' ? 'derived' : 'imposed'}`}>{v.origin === 'initial' ? 'INITIAL' : 'CONSTRUCTED · POINTER'}</span> parent {v.parent ?? '—'} · {new Date(v.createdAt).toLocaleString()}
              {!onPath.has(v.id) && ' · off the active path'}
              {v.move && (
                <>
                  <br />
                  {v.move.decided === 'measurement' ? 'decided by the CFD result' : 'placed by hand'}
                  {v.move.measured ? ` · ${v.move.measured.note}` : ''}
                </>
              )}
            </div>
            {v.run ? (
              <div className="note">
                simulated: Re {Math.round(v.run.result.params.reynolds)} · {v.run.result.params.cells} cells · integrity {v.run.result.integrity.status} · {(v.run.activeMs / 1000).toFixed(0)} s · code {v.run.codeVersion.slice(0, 8)}
                {p.forceLine(v) && (
                  <>
                    <br />
                    {p.forceLine(v)}
                  </>
                )}
              </div>
            ) : (
              <div className="note">not simulated</div>
            )}
            <div className="seg">
              {v.parent && v.run && p.project.versions.find((x) => x.id === v.parent)?.run && (
                <button className="ctl" onClick={() => p.onCompare(v.parent!, v.id)}>
                  COMPARE WITH PARENT
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl" onClick={p.onUndo} disabled={!p.canUndo} title="the head goes back to its parent; the undone version stays in the record">
          UNDO LAST MOVE
        </button>
      </div>
      <h3 className="h3">Export and import</h3>
      <div className="seg">
        <button className="ctl" onClick={p.onExport}>
          PROJECT JSON
        </button>
        <button className="ctl" onClick={p.onExportCsv} title="the wall measurements of the viewed version, station by station">
          WALL CSV
        </button>
        <button className="ctl" onClick={() => file.current?.click()}>
          IMPORT PROJECT
        </button>
        <input ref={file} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && p.onImport(e.target.files[0])} />
      </div>
      <h3 className="h3">Saved projects {p.persistent ? '' : '(this browser cannot store them: export to keep them)'}</h3>
      <div className="lib-list">
        {p.saved.map((s) => (
          <div key={s.id} className="lib-item">
            <div className="row-between">
              <button className="linklike" onClick={() => p.onOpenSaved(s.id)}>
                {s.name} · {s.versions} version{s.versions === 1 ? '' : 's'}
              </button>
              <button className="ctl" onClick={() => p.onDeleteSaved(s.id)} aria-label={`delete ${s.name}`}>
                ✕
              </button>
            </div>
          </div>
        ))}
        {p.saved.length === 0 && <div className="note">nothing saved yet</div>}
      </div>
    </div>
  );
}
