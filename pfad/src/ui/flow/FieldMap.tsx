import { useEffect, useRef } from 'react';
import { fieldScale } from '../colors';
import type { FieldKind } from '../../workers/protocol';

/** A cell field of a run (nx × ny, row-major, y up) drawn as a small heat map; used for measured means and for differences. */
export function FieldMap({ values, nx, ny, kind, signed, label, units, width = 360 }: { values: number[]; nx: number; ny: number; kind: FieldKind; signed?: boolean; label: string; units: string; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#10151b';
    g.fillRect(0, 0, w, h);
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    // a difference is centred on 0 whatever the field; a plain field follows its own kind
    const sc = signed ? fieldScale('ux', lo, hi) : fieldScale(kind, lo, hi);
    const cw = w / nx;
    const ch = h / ny;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = values[j * nx + i];
        const [r, gg, b] = Number.isFinite(v) ? sc.color(v) : [40, 40, 40];
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(i * cw, h - (j + 1) * ch, cw + 0.6, ch + 0.6);
      }
    }
  }, [values, nx, ny, kind, signed]);
  const finite = values.filter(Number.isFinite);
  const lo = finite.length ? Math.min(...finite) : 0;
  const hi = finite.length ? Math.max(...finite) : 0;
  const sc = signed || kind === 'ux' || kind === 'uy' ? fieldScale('ux', lo, hi) : fieldScale(kind, lo, hi);
  return (
    <div>
      <canvas ref={ref} className="chart" style={{ width, height: Math.round((width * ny) / nx), maxWidth: '100%' }} aria-label={label} />
      <div className="legend-scale" style={{ marginTop: 4 }}>
        <span>{sc.lo.toPrecision(3)}</span>
        <div className="bar" style={{ background: sc.css }} />
        <span>{sc.hi.toPrecision(3)}</span>
        <span className="muted">
          {label} [{units}]
        </span>
      </div>
    </div>
  );
}
