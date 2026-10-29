import { anchorOf, pointerOf, radiusOf, type PlateSpec, type PointerPaths, type PointerStepConfig } from '../../geometry/Pointer';
import type { Side } from '../../geometry/SurfaceGeometry';

export interface PointerLogLine {
  text: string;
  kind: 'info' | 'warn' | 'stop';
}

export interface PointerSweep {
  active: boolean;
  /** pointer steps taken by this sweep */
  steps: number;
  log: PointerLogLine[];
  stopped: { stop: string; reason: string } | null;
}

export const EMPTY_SWEEP: PointerSweep = { active: false, steps: 0, log: [], stopped: null };

export interface PointerTexts {
  /** distance along the plate from the centre of the leading circle [cm] */
  x: string;
  /** height of the pointer above the plate's own surface [cm] */
  rise: string;
}

/**
 * The construction pointer: it starts on top of the leading-edge circle, moves along the plate and outward, and a straight
 * tether runs from it to the top of the trailing-edge circle. Used by both workspaces (the particle simulation and the CFD).
 * Everything is typed and shown in centimetres of the plate that was described; `cmPerUnit` converts to the model's lengths.
 */
export function PointerPanel(p: {
  plate: PlateSpec | null;
  paths: PointerPaths | null;
  cmPerUnit: number;
  side: Side;
  onSide: (s: Side) => void;
  texts: PointerTexts;
  onTexts: (t: PointerTexts) => void;
  /** null if the typed position is acceptable, else why not */
  textError: string | null;
  step: PointerStepConfig;
  onStep: (s: PointerStepConfig) => void;
  sweep: PointerSweep;
  /** what the automatic rule responds to, in words (differs between the workspaces) */
  measuredWhat: string;
  hasMeasurement: boolean;
  onPlace: () => void;
  onAutoStep: () => void;
  onSweep: () => void;
  onStop: () => void;
  /** why the pointer cannot be used now (null: it can) */
  blocked: string | null;
  /** extra text shown under the card heading (the workspace's own caveats) */
  caveat: string;
}) {
  const { plate, paths } = p;
  const cm = (u: number) => (u * p.cmPerUnit).toFixed(2);
  const set = (k: keyof PointerTexts, v: string) => p.onTexts({ ...p.texts, [k]: v });
  const cfg = p.step;
  const setStep = (patch: Partial<PointerStepConfig>) => p.onStep({ ...cfg, ...patch });
  if (!plate || !paths) {
    return (
      <div className="note">
        The open version was not drawn with the pointer (it belongs to a flat-plate project, or an increment of the older rules changed it). Start a new project to get the rounded plate and the pointer, or undo back to a rounded-plate version.
      </div>
    );
  }
  const r = radiusOf(plate);
  const at = pointerOf(paths, p.side);
  const a = anchorOf(plate);
  const left = a.x - at.x;
  return (
    <div>
      <div className="note">
        The plate is a slot shape: both ends are half-circles (thickness {cm(plate.thickness)} cm = the diameter of the end circles). The <b>pointer</b> starts on top of the leading circle and moves along the plate and outward; a straight <b>tether</b> runs from it to the top of the trailing circle (the green dashed line).
        Where the pointer has been, the surface is a smooth curve through its positions; beyond it the surface is the tether. Material is only added: the pointer never goes below the plate. {p.caveat}
      </div>
      <div className="params" style={{ margin: '6px 0' }}>
        <label className="wide">
          side
          <select value={p.side} disabled={p.sweep.active} onChange={(e) => p.onSide(e.target.value as Side)} aria-label="pointer side">
            <option value="upper">upper side</option>
            <option value="lower">lower side</option>
          </select>
        </label>
      </div>
      <table className="results">
        <tbody>
          <tr>
            <td>pointer now</td>
            <td>
              {cm(at.x)} cm along, {cm(at.y - r)} cm above the plate
            </td>
          </tr>
          <tr>
            <td>anchor (tether end)</td>
            <td>{cm(a.x)} cm along, on the plate</td>
          </tr>
          <tr>
            <td>still to draw</td>
            <td>{left <= 1e-9 ? 'nothing: the pointer is at the anchor' : `${cm(left)} cm`}</td>
          </tr>
          <tr>
            <td>1 d (particle diameter)</td>
            <td>{p.cmPerUnit.toFixed(2)} cm of your plate</td>
          </tr>
          <tr>
            <td>pointer positions so far</td>
            <td>{(p.side === 'upper' ? paths.upper : paths.lower).length - 1}</td>
          </tr>
        </tbody>
      </table>
      <h3 className="h3">Place it by hand</h3>
      <div className="params" style={{ margin: '4px 0' }}>
        <label>
          along the plate [cm]
          <input inputMode="decimal" value={p.texts.x} disabled={p.sweep.active} onChange={(e) => set('x', e.target.value)} aria-label="pointer position along the plate in cm" />
        </label>
        <label>
          above the plate [cm]
          <input inputMode="decimal" value={p.texts.rise} disabled={p.sweep.active} onChange={(e) => set('rise', e.target.value)} aria-label="pointer height above the plate in cm" />
        </label>
      </div>
      {p.textError && <div className="error">{p.textError}</div>}
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl primary" onClick={p.onPlace} disabled={!!p.blocked || !!p.textError || p.sweep.active} title={p.blocked ?? 'draw the surface out to this position of the pointer and make it a new version'}>
          PLACE POINTER
        </button>
      </div>
      <h3 className="h3">Let the measurement move it</h3>
      <div className="note">
        Each step moves the pointer forward and sets its height just above the current surface by a fraction of {p.measuredWhat}. Where nothing is measured the curve simply follows the surface already there. It has no goal and does not compare shapes.
      </div>
      <details className="effective">
        <summary>Step settings</summary>
        <div className="params">
          <label className="wide">
            step along the plate [cm]
            <input type="number" min={0.1} step={0.1} value={Number((cfg.step * p.cmPerUnit).toFixed(3))} disabled={p.sweep.active} onChange={(e) => setStep({ step: Math.max(0.01, Number(e.target.value) / p.cmPerUnit || cfg.step) })} />
          </label>
          <label className="wide">
            fraction of the measured gap added
            <input type="number" min={0.05} max={1} step={0.05} value={cfg.relaxation} disabled={p.sweep.active} onChange={(e) => setStep({ relaxation: Math.min(1, Math.max(0.05, Number(e.target.value) || cfg.relaxation)) })} />
          </label>
          <label className="wide">
            most it may rise in one step [cm]
            <input type="number" min={0.05} step={0.05} value={Number((cfg.maxRise * p.cmPerUnit).toFixed(3))} disabled={p.sweep.active} onChange={(e) => setStep({ maxRise: Math.max(0.01, Number(e.target.value) / p.cmPerUnit || cfg.maxRise) })} />
          </label>
          <label className="wide">
            gap left unfilled [cm]
            <input type="number" min={0} step={0.05} value={Number((cfg.margin * p.cmPerUnit).toFixed(3))} disabled={p.sweep.active} onChange={(e) => setStep({ margin: Math.max(0, Number(e.target.value) / p.cmPerUnit) })} />
          </label>
        </div>
      </details>
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl" onClick={p.onAutoStep} disabled={!!p.blocked || !p.hasMeasurement || p.sweep.active || left <= 1e-9} title={p.blocked ?? (p.hasMeasurement ? 'one pointer step from the last measurement' : 'simulate this version first')}>
          ONE AUTOMATIC STEP
        </button>
        {!p.sweep.active ? (
          <button className="ctl primary" onClick={p.onSweep} disabled={!!p.blocked || left <= 1e-9} title={p.blocked ?? 'simulate, move the pointer, simulate again … until the pointer reaches the anchor'}>
            ▶ SWEEP TO THE TRAILING EDGE
          </button>
        ) : (
          <button className="ctl" onClick={p.onStop}>
            ■ STOP SWEEP
          </button>
        )}
      </div>
      {p.blocked && <div className="note">{p.blocked}</div>}
      {p.sweep.active && (
        <div className="status-line">
          <span className="phase running">SWEEP</span>
          <span>{p.sweep.steps} pointer steps so far</span>
        </div>
      )}
      {p.sweep.log.length > 0 && (
        <ul className="plain auto-log" aria-label="pointer sweep log">
          {p.sweep.log.map((l, i) => (
            <li key={i} className={l.kind}>
              {l.text}
            </li>
          ))}
        </ul>
      )}
      <div className="note">
        <span className="tag imposed">EXPERIMENTAL</span> The anchor is a construction constraint (the plate’s own trailing-edge geometry), not a flow law, and the pointer path is not an optimum: nothing here is optimised, and the next simulation, not the construction, says what the surface does.
      </div>
    </div>
  );
}
