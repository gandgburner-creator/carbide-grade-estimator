export interface AutoLogLine {
  text: string;
  kind: 'info' | 'warn' | 'stop';
}

export interface AutoRun {
  active: boolean;
  target: number;
  done: number;
  allowWeak: boolean;
  /** number of versions the project had when auto-build started */
  startCount: number;
  log: AutoLogLine[];
  stopped: { stop: string; reason: string } | null;
}

export const EMPTY_AUTO: AutoRun = { active: false, target: 3, done: 0, allowWeak: true, startCount: 1, log: [], stopped: null };

/**
 * Auto-build: repeat simulate → propose → accept by itself and stop when nothing is measured.
 * It adds no judgement of its own (see geometry/AutoBuild.ts); this card only starts, stops and reports it.
 */
export function AutoBuildPanel(p: {
  auto: AutoRun;
  target: number;
  onTarget: (n: number) => void;
  allowWeak: boolean;
  onAllowWeak: (b: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  /** why it cannot start now (null: it can) */
  blocked: string | null;
  phaseText: string;
}) {
  const a = p.auto;
  return (
    <div>
      <div className="note">
        Repeats <b>simulate → propose → accept</b> on its own, on the side with the strongest measured backflow, and <b>stops by itself when nothing is measured</b>. One cycle takes about as long as one simulation (a few minutes at this size). It has no goal and does not
        compare shapes to choose: it only applies the same construction rule again to what the last simulation measured.
      </div>
      <div className="params" style={{ margin: '6px 0' }}>
        <label className="wide">
          increments to add (1–10)
          <input type="number" min={1} max={10} step={1} value={p.target} disabled={a.active} onChange={(e) => p.onTarget(Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))))} aria-label="number of increments to add" />
        </label>
        <label className="wide field-inline">
          <input type="checkbox" checked={p.allowWeak} disabled={a.active} onChange={(e) => p.onAllowWeak(e.target.checked)} /> also build from weak measurements
        </label>
      </div>
      <div className={p.allowWeak ? 'warn' : 'note'}>
        {p.allowWeak
          ? 'Weak measurements are below the detector’s evidence thresholds and may be noise. Increments built from them are tagged EXPLORATORY everywhere. Switch this off to build only where the detector reports a candidate separation region (in this model that is rare).'
          : 'Detector evidence only: it will stop at once if no side reaches CANDIDATE SEPARATION.'}
      </div>
      <div className="seg" style={{ margin: '6px 0' }}>
        {!a.active ? (
          <button className="ctl primary" onClick={p.onStart} disabled={!!p.blocked} title={p.blocked ?? 'start repeating simulate, propose and accept'}>
            ▶ START AUTO-BUILD
          </button>
        ) : (
          <button className="ctl" onClick={p.onStop}>
            ■ STOP AUTO-BUILD
          </button>
        )}
      </div>
      {p.blocked && !a.active && <div className="note">{p.blocked}</div>}
      {a.active && (
        <div className="status-line">
          <span className="phase running">AUTO-BUILD</span>
          <span>
            {a.done} of {a.target} increments added · {p.phaseText}
          </span>
        </div>
      )}
      {a.log.length > 0 && (
        <ul className="plain auto-log" aria-label="auto-build log">
          {a.log.map((l, i) => (
            <li key={i} className={l.kind}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
