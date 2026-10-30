import { anchorMoved, anchorOf, baseHeight, defaultAnchor, pointerOf, radiusOf, trailingRadiusOf, type PlateSpec, type PointerPaths, type PointerStepConfig } from '../../geometry/Pointer';
import { dotsFromTexts, type PointerTexts } from '../../geometry/PointerInput';
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

export type { PointerTexts };

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
  /** what applying the typed values would change, in words (empty when the typed values read the current state) */
  changes?: string[];
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
  const at = pointerOf(paths, p.side);
  const a = anchorOf(plate, paths, p.side);
  const left = a.x - at.x;
  const moved = anchorMoved(plate, paths, p.side);
  const thin = plate.trailingThickness !== undefined && Math.abs(plate.trailingThickness - plate.thickness) > 1e-9;
  const putAnchorBack = () => {
    const d = defaultAnchor(plate);
    p.onTexts({ ...p.texts, anchorX: cm(d.x + radiusOf(plate)), anchorRise: cm(d.y - baseHeight(plate, d.x)) });
  };
  // where the two dots are on the wall for the typed positions (they follow the wall: only where along it is typed)
  const dots = dotsFromTexts(plate, paths, p.side, p.texts, p.cmPerUnit);
  const hasPointerBox = p.texts.x.trim() !== '' || p.texts.rise.trim() !== '';
  return (
    <div>
      <div className="note">
        The plate is a slot shape: both ends are half-circles (leading end {cm(plate.thickness)} cm across{thin ? `, trailing end ${cm(2 * trailingRadiusOf(plate))} cm across, joined by the straight edges that touch both` : ', and the trailing end the same'}). There are three points on a side. The <b>red dot</b> is where the drawn curve now ends (it starts on top of the leading circle). The <b>pointer</b> is where you put it next: an <b>arc</b> (a smooth curve) is drawn from the red dot to it. From the pointer a straight <b>tether</b>, a rope, runs to the <b>green dot</b>, the anchor tied at the trailing end (the green dashed line). The red and the green dot <b>stay on the wall</b> and slide along it (drag them on the picture, or type where along the plate); the pointer is free above it. The direction the curve has at the red dot and at the pointer can be set.
        Where the pointer has been, the surface is a smooth curve through its positions; beyond it the surface is the tether. Material is only added: nothing goes below the plate. {p.caveat}
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
            <td>red dot now</td>
            <td>
              {cm(at.x + radiusOf(plate))} cm from the leading tip, {cm(at.y - baseHeight(plate, at.x))} cm above the plate{at.angle !== undefined ? `, curve leaves it at ${((at.angle * 180) / Math.PI).toFixed(0)}°` : ''}
            </td>
          </tr>
          <tr>
            <td>green dot (anchor, tether end)</td>
            <td>
              {cm(a.x + radiusOf(plate))} cm from the leading tip, {cm(a.y - baseHeight(plate, a.x))} cm above the plate{moved ? ' (moved)' : ''}
            </td>
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
      <div className="note">Pointer: where the arc from the red dot ends and the rope starts.</div>
      <div className="params" style={{ margin: '4px 0' }}>
        <label>
          along the plate [cm] (0 = leading tip)
          <input inputMode="decimal" value={p.texts.x} disabled={p.sweep.active} onChange={(e) => set('x', e.target.value)} aria-label="pointer position along the plate in cm" />
        </label>
        <label>
          above the plate [cm]
          <input inputMode="decimal" value={p.texts.rise} disabled={p.sweep.active} onChange={(e) => set('rise', e.target.value)} aria-label="pointer height above the plate in cm" />
        </label>
        <label>
          curve arrives at [°]
          <input inputMode="decimal" placeholder="along the rope" value={p.texts.angle} disabled={p.sweep.active} onChange={(e) => set('angle', e.target.value)} aria-label="direction of the curve at the pointer in degrees" />
        </label>
      </div>
      <details className="effective" open>
        <summary>Red dot, green dot and the arc between them</summary>
        <div className="note">
          <b>Red dot</b>: where the arc starts. It sits <b>on the wall</b> (the surface as it is now: the plate, the curve you have drawn, then the rope) and slides along it to any point from the leftmost point of the leading edge (0) to just before the green dot; its height is the wall’s, and a curve that starts on the plate’s own wall leaves it tangentially. Drag it on the picture or type where along the plate it is (0 at the leftmost point of the leading edge, the plate’s length at the trailing tip). Sliding it back along what you have drawn drops what was drawn beyond it (the version before stays in the history). A direction is in degrees from the plate axis, positive outward; empty means along the rope.
        </div>
        <div className="params" style={{ margin: '4px 0' }}>
          <label>
            red dot along [cm]
            <input inputMode="decimal" value={p.texts.redX} disabled={p.sweep.active} onChange={(e) => set('redX', e.target.value)} aria-label="red dot position along the plate in cm" />
          </label>
          <label>
            curve leaves it at [°]
            <input inputMode="decimal" placeholder="along the rope" value={p.texts.redAngle} disabled={p.sweep.active} onChange={(e) => set('redAngle', e.target.value)} aria-label="direction of the curve at the red dot in degrees" />
          </label>
        </div>
        <div className="note" aria-label="red dot height">on the wall there: {cm(dots.red.y - baseHeight(plate, dots.red.x))} cm above the plate</div>
        <div className="note">
          <b>Green dot</b>: where the rope is tied. It sits on the <b>plate’s own wall</b> and slides along it, in front of the red dot, to any point up to the trailing tip; behind it the surface is the plate’s wall again. Drag it or type where along the plate it is.
        </div>
        <div className="params" style={{ margin: '4px 0' }}>
          <label>
            green dot along [cm]
            <input inputMode="decimal" value={p.texts.anchorX} disabled={p.sweep.active} onChange={(e) => set('anchorX', e.target.value)} aria-label="green dot position along the plate in cm" />
          </label>
        </div>
        <div className="seg">
          <button className="ctl" onClick={putAnchorBack} disabled={p.sweep.active} title="put the green dot back at the top of the trailing circle (then press the button below to apply)">
            GREEN DOT BACK AT THE TRAILING CIRCLE
          </button>
        </div>
      </details>
      {p.textError && (left > 1e-9 || !hasPointerBox) && <div className="error">{p.textError}</div>}
      {!p.textError && p.changes && p.changes.length > 0 && <div className="note">Applying this: {p.changes.join('; ')}. The dashed yellow line shows the surface it would give.</div>}
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl primary" onClick={p.onPlace} disabled={!!p.blocked || !!p.textError || p.sweep.active} title={p.blocked ?? 'draw the surface through these points and make it a new version'}>
          {hasPointerBox ? 'PLACE POINTER' : 'APPLY CHANGES'}
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
