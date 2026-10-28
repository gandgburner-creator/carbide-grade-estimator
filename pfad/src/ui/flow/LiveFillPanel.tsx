import type { Side } from '../../geometry/SurfaceGeometry';

export interface LiveSettings {
  side: 'auto' | Side;
  interval: number;
  relaxation: number;
  maxStep: number;
  frontSpeed: number;
}

export interface LiveStatus {
  phase: string;
  time: number;
  updates: string;
  separationX: number;
  front: number;
  maxGap: number;
  meanGap: number;
}

/**
 * Live fill: the surface grows while the simulation runs, where the particles stop touching it, from that
 * separation point toward the trailing edge. This card starts and stops it and reports what it is doing.
 */
export function LiveFillPanel(p: {
  settings: LiveSettings;
  onSettings: (s: LiveSettings) => void;
  active: boolean;
  status: LiveStatus | null;
  onStart: () => void;
  onStop: () => void;
  blocked: string | null;
  lastResult: string | null;
}) {
  const s = p.settings;
  const set = (k: keyof LiveSettings, v: number | string) => p.onSettings({ ...s, [k]: v } as LiveSettings);
  const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
  return (
    <div>
      <div className="note">
        Starts the stream past the <b>current geometry</b> and, while it runs, watches where the particles <b>stop touching</b> the surface (the wake behind it). From that <b>separation point</b> it adds a little material at a time, only into empty space, and the front of the fill moves toward the{' '}
        <b>trailing edge</b>, which stays where it is. It stops when the void has closed or when nothing more fits. The result is a new version (not yet measured: simulate it afterwards).
      </div>
      <div className="params" style={{ margin: '6px 0' }}>
        <label className="wide">
          side to fill
          <select value={s.side} disabled={p.active} onChange={(e) => set('side', e.target.value)} aria-label="side to fill">
            <option value="upper">upper side</option>
            <option value="lower">lower side</option>
            <option value="auto">the side with the bigger void</option>
          </select>
        </label>
      </div>
      <details className="effective">
        <summary>Settings</summary>
        <div className="params">
          {(
            [
              ['interval', 'time between updates [τ]', 20, 200, 10],
              ['relaxation', 'fraction of the gap filled per update', 0.05, 1, 0.05],
              ['maxStep', 'most material added per update [d]', 0.1, 1, 0.1],
              ['frontSpeed', 'front advance per update [d]', 0.25, 4, 0.25],
            ] as const
          ).map(([k, label, lo, hi, step]) => (
            <label key={k} className="wide">
              {label}
              <input type="number" min={lo} max={hi} step={step} value={s[k]} disabled={p.active} onChange={(e) => set(k, Number(e.target.value))} />
            </label>
          ))}
        </div>
      </details>
      <div className="seg" style={{ margin: '6px 0' }}>
        {!p.active ? (
          <button className="ctl primary" onClick={p.onStart} disabled={!!p.blocked} title={p.blocked ?? 'start the stream and the live fill'}>
            ▶ START LIVE FILL
          </button>
        ) : (
          <button className="ctl" onClick={p.onStop} title="ends the run; the shape grown so far is not kept">
            ■ STOP (discards the run)
          </button>
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
              <td>simulation time</td>
              <td>{f(p.status.time, 0)} τ</td>
            </tr>
            <tr>
              <td>updates</td>
              <td>{p.status.updates}</td>
            </tr>
            <tr>
              <td>separation point (last update)</td>
              <td>{f(p.status.separationX)} d from the leading edge</td>
            </tr>
            <tr>
              <td>front of the fill</td>
              <td>{f(p.status.front)} d</td>
            </tr>
            <tr>
              <td>gap behind the front, mean / largest</td>
              <td>
                {f(p.status.meanGap)} / {f(p.status.maxGap)} d{p.status.maxGap >= 12 ? ' (≥ 12: beyond the sampled window)' : ''}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {p.lastResult && !p.active && <div className="info">{p.lastResult}</div>}
      <div className="note">
        <span className="tag imposed">EXPERIMENTAL</span> “Not touching” means the density of the layer next to the wall is under half the free stream’s (wake-void/0). That is an occupancy definition, not the classical one, and it has not been validated. One seed builds the shape, so another seed can give a slightly different one.
      </div>
    </div>
  );
}
