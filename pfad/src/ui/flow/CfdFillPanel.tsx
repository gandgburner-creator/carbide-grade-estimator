import type { Side } from '../../geometry/SurfaceGeometry';

export interface CfdFillSettings {
  /** convective times the flow adjusts after each move, and the convective times averaged for each decision */
  settle: number;
  window: number;
  /** compute the new shape (an ordinary run, with its own start-up) as soon as the fill is done */
  computeAfter: boolean;
}

export interface CfdFillStatus {
  phase: string;
  convective: number;
  moves: string;
  pointerX: number;
  lastGap: number | null;
  lastRise: number | null;
}

/**
 * AUTO FILL (CFD): the pointer moves by itself while one CFD run goes on, from the leading circle to the trailing-edge anchor, each move
 * following the dividing streamline of the reversed flow beside the surface. This card starts and stops it and says what it is doing.
 */
export function CfdFillPanel(p: {
  side: Side;
  settings: CfdFillSettings;
  onSettings: (s: CfdFillSettings) => void;
  active: boolean;
  status: CfdFillStatus | null;
  onStart: () => void;
  onFinish: () => void;
  onCancel: () => void;
  blocked: string | null;
  lastResult: string | null;
}) {
  const s = p.settings;
  const set = (k: keyof CfdFillSettings, v: number | boolean) => p.onSettings({ ...s, [k]: v } as CfdFillSettings);
  const f = (x: number | null, d = 1) => (x !== null && Number.isFinite(x) ? x.toFixed(d) : '—');
  return (
    <div>
      <div className="note">
        <b>Auto fill</b> starts one CFD run on the <b>current shape</b> and, once the flow has developed, moves the pointer along the <b>{p.side}</b> side <b>by itself</b>, to the trailing-edge anchor. Each move follows the height of the region of reversed flow beside the surface (the dividing streamline, averaged over a short window); the body is redrawn and given to the running solver, and the flow adjusts before the next move. It is <b>one pass</b>: a station is passed once and never filled again. The result is a new version (not yet computed: the flow around a body that changed during the run is a transient, so the shape is computed afresh).
      </div>
      <details className="effective">
        <summary>Settings</summary>
        <div className="params">
          <label className="wide">
            flow adjusts after each move [convective times]
            <input type="number" min={0} max={4} step={0.25} value={s.settle} disabled={p.active} onChange={(e) => set('settle', Number(e.target.value))} />
          </label>
          <label className="wide">
            averaged for each decision [convective times]
            <input type="number" min={0.5} max={4} step={0.25} value={s.window} disabled={p.active} onChange={(e) => set('window', Number(e.target.value))} />
          </label>
          <label className="field-inline wide">
            <input type="checkbox" checked={s.computeAfter} disabled={p.active} onChange={(e) => set('computeAfter', e.target.checked)} />
            compute the new shape when the fill is done
          </label>
        </div>
        <div className="note">Step along the plate, the fraction of the gap the pointer rises and its largest rise are the pointer settings above.</div>
      </details>
      <div className="seg" style={{ margin: '6px 0' }}>
        {!p.active ? (
          <button className="ctl primary" onClick={p.onStart} disabled={!!p.blocked} title={p.blocked ?? 'start a CFD run and let the pointer fill by itself'}>
            ▶ START AUTO FILL
          </button>
        ) : (
          <>
            <button className="ctl primary" onClick={p.onFinish} title="ends the run now and keeps the shape drawn so far as a new version">
              ■ STOP AND KEEP WHAT IS DRAWN
            </button>
            <button className="ctl" onClick={p.onCancel} title="ends the run; nothing is kept">
              CANCEL (discards the run)
            </button>
          </>
        )}
      </div>
      {p.blocked && !p.active && <div className="note">{p.blocked}</div>}
      {p.active && p.status && (
        <table className="results">
          <tbody>
            <tr>
              <td>phase</td>
              <td>{p.status.phase}</td>
            </tr>
            <tr>
              <td>time</td>
              <td>{f(p.status.convective)} convective times</td>
            </tr>
            <tr>
              <td>pointer moves</td>
              <td>{p.status.moves}</td>
            </tr>
            <tr>
              <td>pointer at</td>
              <td>{f(p.status.pointerX)} d along the plate</td>
            </tr>
            <tr>
              <td>last gap measured / rise</td>
              <td>
                {f(p.status.lastGap)} / {f(p.status.lastRise)} d
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {p.lastResult && !p.active && <div className="info">{p.lastResult}</div>}
      <div className="note">
        <span className="tag imposed">EXPERIMENTAL</span> “Reversed flow” is read from a short-window mean of a flow that sheds vortices, so the height it gives is rough, and behind a plate at this angle it often reaches the edge of the sampled profile. The anchor and the one-pass rule are construction rules, not flow laws. One run draws the shape; it says nothing about how the shape performs until it is computed.
      </div>
    </div>
  );
}
