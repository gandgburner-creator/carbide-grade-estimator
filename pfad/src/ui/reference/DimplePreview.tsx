import { useMemo, useState } from 'react';
import { airfoilBody } from '../../reference/Airfoils';
import { dimpledBody, type DimpleSpec } from '../../reference/Dimples';

/**
 * A picture of a section with its dimples, true to scale: the thin grey line is the section as it was, the filled outline the dimpled
 * section. The dimples are small, so the picture can be magnified (the section is shown from the chord position chosen, the vertical
 * range follows the surface that carries the dimples).
 */
export function DimplePreview({ contour, spec }: { contour: number[]; spec: DimpleSpec }) {
  const [zoom, setZoom] = useState(4);
  const [pos, setPos] = useState(30);
  const made = useMemo(() => {
    try {
      const d = dimpledBody(contour, spec, 1);
      const b = airfoilBody(contour, 1, d.body.geometry.stations);
      return { dimpled: d.body.geometry, base: b.geometry, error: null as string | null };
    } catch (e) {
      return { dimpled: null, base: null, error: (e as Error).message };
    }
  }, [contour, spec]);
  if (!made.dimpled || !made.base) return <div className="error">{made.error}</div>;
  const W = 560;
  const H = zoom === 1 ? 170 : 150;
  const w = 1 / zoom;
  const x0 = (pos / 100) * (1 - w);
  const focus: 'upper' | 'lower' = spec.surface === 'lower' ? 'lower' : 'upper';
  const g = made.dimpled;
  const xs = g.xs!;
  const sc = W / w;
  // the vertical centre: the middle of the whole section when it is shown whole, else the dimpled surface inside the window
  let ymid = 0;
  if (zoom === 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= g.stations; k++) {
      lo = Math.min(lo, g.lower[k]);
      hi = Math.max(hi, g.upper[k]);
    }
    ymid = (lo + hi) / 2;
  } else {
    let sum = 0;
    let n = 0;
    for (let k = 0; k <= g.stations; k++) if (xs[k] >= x0 && xs[k] <= x0 + w) {
      sum += (focus === 'upper' ? g.upper : g.lower)[k];
      n++;
    }
    ymid = n ? sum / n : 0;
  }
  const X = (x: number) => (x - x0) * sc;
  const Y = (y: number) => H / 2 - (y - ymid) * sc;
  // the closed outline: along the upper surface, back along the lower
  const path = (geo: typeof g) => {
    const pts: string[] = [];
    for (let k = 0; k <= geo.stations; k++) pts.push(`${X(xs[k]).toFixed(1)} ${Y(geo.upper[k]).toFixed(1)}`);
    for (let k = geo.stations; k >= 0; k--) pts.push(`${X(xs[k]).toFixed(1)} ${Y(geo.lower[k]).toFixed(1)}`);
    return 'M' + pts.join('L') + 'Z';
  };
  return (
    <div data-testid="dimple-preview">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ background: '#0b0e12', borderRadius: 4, display: 'block', maxWidth: W }} role="img" aria-label="the section with its dimples, true to scale">
        <path d={path(made.base)} fill="none" stroke="#6b7785" strokeWidth="1" strokeDasharray="3 3" />
        <path d={path(g)} fill="rgba(88,166,255,0.22)" stroke="#9cc3ea" strokeWidth="1.3" />
      </svg>
      <div className="seg" style={{ margin: '4px 0', flexWrap: 'wrap' }}>
        <label className="field-inline">
          magnify{' '}
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="dimple preview magnification">
            {[1, 2, 4, 8, 16].map((z) => (
              <option key={z} value={z}>
                ×{z}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline" style={{ opacity: zoom === 1 ? 0.4 : 1 }}>
          from the leading edge → trailing edge{' '}
          <input type="range" min={0} max={100} value={pos} disabled={zoom === 1} onChange={(e) => setPos(Number(e.target.value))} aria-label="dimple preview position" />
        </label>
      </div>
      <div className="note">
        True to scale (dashed: the section without dimples). Showing {(100 * x0).toFixed(0)} % to {(100 * (x0 + w)).toFixed(0)} % of the chord.
      </div>
    </div>
  );
}
