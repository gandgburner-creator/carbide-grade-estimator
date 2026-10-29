import { useRef } from 'react';
import { activePath, type GeometryVersion, type Project, type ReplayFrame } from '../../geometry/History';
import { LevelBadge } from './DetectorPanel';

interface Props {
  project: Project;
  /** one line of lift and drag for a simulated version (coefficients, and scaled newtons when the wing was described) */
  forceLine?: (v: GeometryVersion) => string | null;
  viewId: string;
  onView: (id: string) => void;
  onCompare: (a: string, b: string) => void;
  replayFrames: ReplayFrame[];
  replayIdx: number | null;
  replaying: boolean;
  onReplayStart: () => void;
  onReplayToggle: () => void;
  onReplaySeek: (i: number) => void;
  onReplayStop: () => void;
  saved: { id: string; name: string; versions: number }[];
  onOpenSaved: (id: string) => void;
  onDeleteSaved: (id: string) => void;
  persistent: boolean;
  onExportProject: (withRecords: boolean) => void;
  onExportSVG: () => void;
  onExportCSV: () => void;
  onExportRecord: () => void;
  onImportProject: (file: File) => void;
  onImportReference: (file: File) => void;
  withRecords: boolean;
  onWithRecords: (b: boolean) => void;
}

/** Versions and their runs, proposals, the replay of the construction, exports and imports. */
export function HistoryPanel(p: Props) {
  const onPath = new Set(activePath(p.project).map((v) => v.id));
  const fileProj = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tag = (v: GeometryVersion) => (v.origin === 'initial' ? 'INITIAL' : v.construction?.mode === 'exploratory' ? 'CONSTRUCTED · EXPLORATORY' : v.construction?.mode === 'live-fill' ? 'CONSTRUCTED · LIVE FILL' : v.construction?.mode === 'pointer' ? 'CONSTRUCTED · POINTER' : 'CONSTRUCTED');
  return (
    <div>
      <h3 className="h3">Geometry versions</h3>
      <div className="lib-list">
        {[...p.project.versions].reverse().map((v) => {
          const r = v.run;
          return (
            <div key={v.id} className={`lib-item ${p.viewId === v.id ? 'active' : ''} ${v.undone ? 'undone' : ''}`}>
              <div className="row-between">
                <button className="linklike" onClick={() => p.onView(v.id)} title="show this version’s measurements">
                  {v.id} — {v.label}
                </button>
                <span>
                  {p.project.head === v.id && <span className="tag measured">HEAD</span>} {v.undone && <span className="tag stopped">UNDONE</span>}
                </span>
              </div>
              <div className="note">
                <span className={`tag ${v.origin === 'initial' ? 'derived' : 'imposed'}`}>{tag(v)}</span> parent {v.parent ?? '—'} · {new Date(v.createdAt).toLocaleString()}
                {!onPath.has(v.id) && ' · off the active path'}
                {v.construction && (
                  <>
                    <br />
                    {v.construction.partial ? `accepted ${v.construction.acceptedPoints} of ${v.construction.totalPoints} points` : `accepted all ${v.construction.totalPoints} points`} · evidence: {v.construction.basis.level.replace(/_/g, ' ').toLowerCase()}
                    {v.construction.scale < 1 && ` · scaled ${v.construction.scale.toFixed(2)} by limits`}
                  </>
                )}
              </div>
              {r ? (
                <div className="note">
                  simulated: seeds {r.seeds.join(',')} · integrity {r.integrity.status} · upper <LevelBadge level={r.analysis.upper.level} /> lower <LevelBadge level={r.analysis.lower.level} /> · code {r.codeVersion.slice(0, 8)} · model {r.modelVersion}
                </div>
              ) : (
                <div className="note">not simulated</div>
              )}
              {r && p.forceLine && p.forceLine(v) && <div className="note">{p.forceLine(v)}</div>}
              <div className="seg">
                {v.parent && v.run && p.project.versions.find((x) => x.id === v.parent)?.run && (
                  <button className="ctl" onClick={() => p.onCompare(v.parent!, v.id)}>
                    COMPARE WITH PARENT
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="h3">Replay of the construction</h3>
      <div className="note">Plays the active path point by point: the surface grows as the construction point advances (view only; this is not a simulation).</div>
      {p.replayFrames.length <= 1 ? (
        <div className="note">Nothing to replay yet: accept an increment first.</div>
      ) : (
        <>
          <div className="seg" style={{ margin: '6px 0' }}>
            {p.replayIdx === null ? (
              <button className="ctl primary" onClick={p.onReplayStart}>
                ▶ REPLAY
              </button>
            ) : (
              <>
                <button className="ctl" onClick={p.onReplayToggle}>
                  {p.replaying ? '❚❚ PAUSE' : '▶ PLAY'}
                </button>
                <button className="ctl" onClick={p.onReplayStop}>
                  EXIT REPLAY
                </button>
              </>
            )}
          </div>
          {p.replayIdx !== null && (
            <>
              <input type="range" min={0} max={p.replayFrames.length - 1} value={p.replayIdx} onChange={(e) => p.onReplaySeek(Number(e.target.value))} style={{ width: '100%' }} aria-label="replay position" />
              <div className="note">
                frame {p.replayIdx + 1} / {p.replayFrames.length}: {p.replayFrames[p.replayIdx].label}
              </div>
            </>
          )}
        </>
      )}

      <h3 className="h3">Proposals</h3>
      {p.project.proposals.length === 0 ? (
        <div className="note">None yet.</div>
      ) : (
        <table className="results">
          <thead>
            <tr>
              <th>id</th>
              <th>on</th>
              <th>side</th>
              <th>mode</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {p.project.proposals.map((e) => (
              <tr key={e.id} title={e.note ?? ''}>
                <td>{e.id}</td>
                <td>{e.parent}</td>
                <td>{e.proposal.side}</td>
                <td>{e.proposal.mode}</td>
                <td>
                  {e.status}
                  {e.acceptedVersion ? ` → ${e.acceptedVersion}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details style={{ marginTop: 6 }}>
        <summary className="note">Event log ({p.project.log.length})</summary>
        <ul className="plain" style={{ maxHeight: 200, overflow: 'auto' }}>
          {[...p.project.log].reverse().map((e, i) => (
            <li key={i}>
              <span className="note">{new Date(e.t).toLocaleTimeString()}</span> <b>{e.type}</b> {e.version ?? ''} {e.detail}
            </li>
          ))}
        </ul>
      </details>

      <h3 className="h3">Export and import</h3>
      <div className="seg" style={{ marginBottom: 6 }}>
        <button className="ctl" onClick={() => p.onExportProject(p.withRecords)}>
          PROJECT JSON
        </button>
        <button className="ctl" onClick={p.onExportSVG}>
          GEOMETRY SVG
        </button>
        <button className="ctl" onClick={p.onExportCSV}>
          SURFACE CSV
        </button>
        <button className="ctl" onClick={p.onExportRecord}>
          RUN RECORD JSON
        </button>
      </div>
      <label className="field-inline note">
        <input type="checkbox" checked={p.withRecords} onChange={(e) => p.onWithRecords(e.target.checked)} /> embed the full run records in the project JSON
      </label>
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl" onClick={() => fileProj.current?.click()}>
          IMPORT PROJECT…
        </button>
        <button className="ctl" onClick={() => fileRef.current?.click()} title="CSV with columns x, upper, lower; drawn dashed in violet and never part of the construction">
          IMPORT REFERENCE OUTLINE…
        </button>
      </div>
      <input ref={fileProj} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => (e.target.files?.[0] && p.onImportProject(e.target.files[0]), (e.target.value = ''))} />
      <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }} onChange={(e) => (e.target.files?.[0] && p.onImportReference(e.target.files[0]), (e.target.value = ''))} />
      {p.project.references.length > 0 && (
        <div className="note">
          Reference outlines (<span className="tag reference">IMPORTED — not constructed by PFAD</span>): {p.project.references.map((r) => r.name).join(', ')}
        </div>
      )}
      <div className="note">
        SVG and CSV are of the version being viewed (the polyline the engine simulated, in particle diameters, body frame); the project JSON keeps every version, proposal, decision and run summary.
      </div>

      <h3 className="h3">Saved projects {p.persistent ? '(this browser)' : '(this session only)'}</h3>
      <div className="lib-list">
        {p.saved.map((s) => (
          <div key={s.id} className={`lib-item ${s.id === p.project.id ? 'active' : ''}`}>
            <div className="row-between">
              <button className="linklike" onClick={() => p.onOpenSaved(s.id)}>
                {s.name}
              </button>
              <span className="note">{s.versions} versions</span>
            </div>
            <button
              className="ctl"
              onClick={() => {
                if (window.confirm(`Delete the saved project “${s.name}” from this browser? Exported files are not affected.`)) p.onDeleteSaved(s.id);
              }}
            >
              DELETE
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
