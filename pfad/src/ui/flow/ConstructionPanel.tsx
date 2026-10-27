import { LEVELS, type SurfaceFlowAnalysis } from '../../measurements/SeparationDetector';
import type { ConstructionConfig, EvidenceMode, Proposal } from '../../geometry/Construction';
import type { GeometryVersion } from '../../geometry/History';
import type { Side } from '../../geometry/SurfaceGeometry';
import { fmt } from '../Panels';
import { LevelBadge } from './DetectorPanel';

export interface ConstructionProps {
  head: GeometryVersion;
  side: Side;
  onSide: (s: Side) => void;
  mode: EvidenceMode;
  onMode: (m: EvidenceMode) => void;
  cfg: ConstructionConfig;
  onCfg: (c: ConstructionConfig) => void;
  analyses: Record<Side, SurfaceFlowAnalysis> | null;
  proposal: Proposal | null;
  pointIdx: number;
  playing: boolean;
  busy: boolean;
  canUndo: boolean;
  message: string | null;
  onPropose: () => void;
  onAdvance: () => void;
  onBack: () => void;
  onToEnd: () => void;
  onPlay: () => void;
  onAcceptUpTo: () => void;
  onAcceptAll: () => void;
  onReject: () => void;
  onUndo: () => void;
}

/** Propose, step through, accept or reject one increment; undo the last accepted one. */
export function ConstructionPanel(p: ConstructionProps) {
  const a = p.analyses?.[p.side] ?? null;
  const detectorOk = !!a && a.region?.kind === 'reversed' && LEVELS.indexOf(a.level) >= LEVELS.indexOf('CANDIDATE_SEPARATION');
  const exploratoryOk = !!a?.primary.exploratory;
  const pr = p.proposal;
  const pt = pr && p.pointIdx >= 0 ? pr.points[p.pointIdx] : null;
  const last = pr ? pr.points.length - 1 : -1;
  const set = (k: keyof ConstructionConfig, v: number) => p.onCfg({ ...p.cfg, [k]: v });
  return (
    <div>
      {!p.head.run && <div className="warn">The current geometry ({p.head.id}) has not been simulated yet: there is no measured flow to build from. Run it first.</div>}
      <div className="seg" style={{ marginBottom: 6 }}>
        {(['upper', 'lower'] as const).map((s) => (
          <button key={s} className={`ctl ${p.side === s ? 'on' : ''}`} onClick={() => p.onSide(s)} disabled={!!pr}>
            {s === 'upper' ? 'upper side' : 'lower side'}
            {p.analyses && (
              <>
                {' '}
                <LevelBadge level={p.analyses[s].level} />
              </>
            )}
          </button>
        ))}
      </div>
      <div className="mode-pick">
        <label className={p.mode === 'detector' ? 'on' : ''}>
          <input type="radio" checked={p.mode === 'detector'} onChange={() => p.onMode('detector')} disabled={!!pr} />
          <span>
            <b>Follow the detector</b>
            <br />
            <span className="note">{detectorOk ? `${a!.level.replace(/_/g, ' ').toLowerCase()} over x = ${a!.region!.xLo.toFixed(1)}–${a!.region!.xHi.toFixed(1)} d` : 'unavailable: needs a candidate separation region or better'}</span>
          </span>
        </label>
        <label className={`${p.mode === 'exploratory' ? 'on' : ''} explore`}>
          <input type="radio" checked={p.mode === 'exploratory'} onChange={() => p.onMode('exploratory')} disabled={!!pr} />
          <span>
            <b>Exploratory</b> <span className="tag imposed">BELOW EVIDENCE</span>
            <br />
            <span className="note">
              {exploratoryOk
                ? `uses the pooled flux over x = ${a!.primary.exploratory!.xLo.toFixed(1)}–${a!.primary.exploratory!.xHi.toFixed(1)} d, negative but not significant. A hypothesis test, not a response to a detection.`
                : 'unavailable: no stretch has a forward outer flow and a negative pooled flux'}
            </span>
          </span>
        </label>
      </div>
      <details className="effective">
        <summary>Construction rule and bounds</summary>
        <div className="params">
          {(
            [
              ['relaxation', 'fraction of the measured height per increment (η)', 0.05, 1, 0.05],
              ['maxStep', 'largest height added at a station [d]', 0.1, 3, 0.1],
              ['shrink', 'SE subtracted from the height (detector mode)', 0, 3, 0.5],
              ['ramp', 'ease-in length at the onset [d]', 1, 12, 1],
              ['taper', 'ease-out length [d]', 1, 12, 1],
              ['leReserve', 'untouched next to the leading edge [d]', 0, 10, 1],
              ['teReserve', 'untouched next to the trailing edge [d]', 0, 15, 1],
            ] as const
          ).map(([k, label, lo, hi, step]) => (
            <label key={k} className="wide" title={label}>
              {label}
              <input type="number" min={lo} max={hi} step={step} value={p.cfg[k]} disabled={!!pr || (k === 'shrink' && p.mode === 'exploratory')} onChange={(e) => set(k, Number(e.target.value))} />
            </label>
          ))}
          {(
            [
              ['maxSlope', 'largest |dy/dx|'],
              ['maxCurvature', 'largest |second difference|/dx'],
              ['minThickness', 'smallest thickness [d]'],
              ['maxThickness', 'largest thickness [d]'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="wide">
              limit: {label}
              <input type="number" step={0.05} value={p.cfg.limits[k]} disabled={!!pr} onChange={(e) => p.onCfg({ ...p.cfg, limits: { ...p.cfg.limits, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
        <div className="note">
          The increment is δ(x) = min(maxStep, η·(h − shrink·SE)) × ease-in × ease-out, added along the normal of the chosen side over the measured stretch. The trailing edge is held fixed; nothing is imposed there. If a limit would be exceeded the increment is scaled
          down, and if none fits there is no proposal.
        </div>
      </details>
      <div className="seg" style={{ margin: '8px 0' }}>
        <button className="ctl primary" disabled={!!pr || p.busy || !p.head.run || (p.mode === 'detector' ? !detectorOk : !exploratoryOk)} onClick={p.onPropose}>
          PROPOSE INCREMENT
        </button>
        <button className="ctl" disabled={!p.canUndo || p.busy || !!pr} onClick={p.onUndo} title="return to the parent geometry; the undone version stays in the history">
          UNDO LAST ACCEPTED
        </button>
      </div>
      {p.message && <div className={p.message.startsWith('No proposal') || p.message.startsWith('Cannot') ? 'warn' : 'info'}>{p.message}</div>}
      {pr && (
        <div className="proposal">
          {pr.mode === 'exploratory' ? <div className="exp-banner">EXPLORATORY PROPOSAL — below the detector’s evidence thresholds; heights are point estimates that noise alone could produce</div> : <div className="note">Proposal follows the detector’s {pr.basis.level.replace(/_/g, ' ').toLowerCase()} region.</div>}
          <div className="note">
            <b>Measured basis.</b> {pr.basis.summary}
          </div>
          <div className="note">
            <b>Proposed.</b> {pr.rationale.split('. ')[0]}. {pr.points.length} points, {fmt(pr.area, 3)} d² of material{pr.scale < 1 ? `, scaled ${pr.scale.toFixed(2)} by the geometry limits` : ''}.
          </div>
          <div className="note">
            <span className="tag reference">HYPOTHESIS</span> {pr.hypothesis}
          </div>
          <div className="seg" style={{ margin: '6px 0' }}>
            <button className="ctl" onClick={p.onBack} disabled={p.pointIdx < 0} title="move the construction point back">
              ◀ BACK
            </button>
            <button className="ctl primary" onClick={p.onAdvance} disabled={p.pointIdx >= last} title="advance the construction point one step">
              ADVANCE ▶
            </button>
            <button className="ctl" onClick={p.onPlay} disabled={p.pointIdx >= last && !p.playing}>
              {p.playing ? '❚❚ PAUSE' : '▶ DRAW'}
            </button>
            <button className="ctl" onClick={p.onToEnd} disabled={p.pointIdx >= last}>
              TO END
            </button>
          </div>
          <div className="status-line">
            <span>
              construction point {Math.max(0, p.pointIdx + 1)} / {pr.points.length}
            </span>
          </div>
          {pt ? (
            <table className="results" style={{ marginTop: 4 }}>
              <tbody>
                <tr>
                  <td>position x</td>
                  <td>{pt.x.toFixed(1)} d</td>
                </tr>
                <tr>
                  <td>surface y: old → new</td>
                  <td>
                    {pt.yOld.toFixed(3)} → {pt.yNew.toFixed(3)} d
                  </td>
                </tr>
                <tr>
                  <td>added normal height δ</td>
                  <td>{pt.deltaNormal.toFixed(3)} d</td>
                </tr>
                <tr>
                  <td>
                    <span className="tag measured">MEASURED</span> h_ds here
                  </td>
                  <td>
                    {fmt(pt.measured, 3)} ± {fmt(pt.measuredSE, 2)} d
                  </td>
                </tr>
                <tr>
                  <td>ease weight</td>
                  <td>{pt.weight.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="note">Press ADVANCE to move the construction point to the first point of the increment, at the onset of the measured region.</div>
          )}
          <div className="seg" style={{ marginTop: 8 }}>
            <button className="ctl primary" onClick={p.onAcceptUpTo} disabled={p.pointIdx < 0 || p.busy} title="accept the surface only as far as the construction point; the rest eases away">
              ACCEPT UP TO HERE
            </button>
            <button className="ctl" onClick={p.onAcceptAll} disabled={p.busy}>
              ACCEPT ALL
            </button>
            <button className="ctl" onClick={p.onReject} disabled={p.busy}>
              REJECT
            </button>
          </div>
          <div className="note">Accepting creates a new version (nothing is overwritten) that must be simulated before the next increment.</div>
        </div>
      )}
    </div>
  );
}
