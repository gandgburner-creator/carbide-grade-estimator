import { useEffect, useRef, useState } from 'react';

export interface StationSeries {
  label: string;
  color: string;
  x: number[];
  y: number[];
  se?: number[];
  dashed?: boolean;
}

interface Props {
  series: StationSeries[];
  title: string;
  yLabel: string;
  /** shaded stretch of the chord (the detector's or the exploratory region) */
  region?: { xLo: number; xHi: number; color: string; label: string } | null;
  /** highlighted station (the one whose profile is shown) */
  selectedX?: number | null;
  onSelect?: (x: number) => void;
  height?: number;
}

const M = { l: 54, r: 10, t: 18, b: 24 };

/** Mean ± 1 SE of a station quantity along the chord; click selects a station. Several series may be overlaid. */
export function StationChart({ series, title, yLabel, region, selectedX, onSelect, height = 150 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useRef<{ X: (x: number) => number; Y: (y: number) => number; xs: number[] } | null>(null);
  const [hover, setHover] = useState<{ px: number; i: number } | null>(null);

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
    g.font = '10px ui-monospace, monospace';
    g.fillStyle = '#8b98a5';
    g.fillText(title, M.l, 11);
    const pts = series.flatMap((s) => s.x.map((x, i) => ({ x, y: s.y[i], e: s.se?.[i] ?? 0 }))).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    geo.current = null;
    if (pts.length < 2) {
      g.fillText('no data', M.l, h / 2);
      return;
    }
    const xs = [...new Set(series[0]?.x ?? [])];
    let x0 = Math.min(...pts.map((p) => p.x));
    let x1 = Math.max(...pts.map((p) => p.x));
    let y0 = Math.min(0, ...pts.map((p) => p.y - (Number.isFinite(p.e) ? p.e : 0)));
    let y1 = Math.max(0, ...pts.map((p) => p.y + (Number.isFinite(p.e) ? p.e : 0)));
    if (y1 === y0) y1 = y0 + 1;
    const padY = 0.06 * (y1 - y0);
    y0 -= padY;
    y1 += padY;
    const half = (x1 - x0) / (2 * Math.max(1, xs.length - 1));
    x0 -= half;
    x1 += half;
    const X = (x: number) => M.l + ((x - x0) / (x1 - x0)) * (w - M.l - M.r);
    const Y = (y: number) => h - M.b - ((y - y0) / (y1 - y0)) * (h - M.t - M.b);
    geo.current = { X, Y, xs };
    if (region) {
      g.fillStyle = region.color;
      g.globalAlpha = 0.18;
      g.fillRect(X(region.xLo), M.t, X(region.xHi) - X(region.xLo), h - M.t - M.b);
      g.globalAlpha = 1;
      g.fillStyle = region.color;
      g.fillText(region.label, X(region.xLo) + 3, M.t + 10);
    }
    g.strokeStyle = '#2a333d';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(M.l, M.t);
    g.lineTo(M.l, h - M.b);
    g.lineTo(w - M.r, h - M.b);
    g.stroke();
    if (y0 < 0 && y1 > 0) {
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(M.l, Y(0));
      g.lineTo(w - M.r, Y(0));
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = '#8b98a5';
    const f = (v: number) => (Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(1) : v.toPrecision(2));
    g.fillText(f(y1), 2, M.t + 8);
    g.fillText(f(y0), 2, h - M.b);
    g.fillText(x0.toFixed(0), M.l, h - 8);
    const xl = `${x1.toFixed(0)}  x [d]`;
    g.fillText(xl, w - M.r - g.measureText(xl).width, h - 8);
    g.save();
    g.translate(10, h / 2 + 20);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();
    if (selectedX != null) {
      g.strokeStyle = 'rgba(230,237,243,0.35)';
      g.beginPath();
      g.moveTo(X(selectedX), M.t);
      g.lineTo(X(selectedX), h - M.b);
      g.stroke();
    }
    for (const s of series) {
      g.fillStyle = s.color;
      g.strokeStyle = s.color;
      if (s.se) {
        g.globalAlpha = 0.2;
        g.beginPath();
        s.x.forEach((x, i) => {
          if (Number.isFinite(s.y[i]) && Number.isFinite(s.se![i])) g[i === 0 ? 'moveTo' : 'lineTo'](X(x), Y(s.y[i] + s.se![i]));
        });
        for (let i = s.x.length - 1; i >= 0; i--) if (Number.isFinite(s.y[i]) && Number.isFinite(s.se![i])) g.lineTo(X(s.x[i]), Y(s.y[i] - s.se![i]));
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
      }
      g.lineWidth = 1.8;
      g.setLineDash(s.dashed ? [5, 3] : []);
      g.beginPath();
      let started = false;
      s.x.forEach((x, i) => {
        if (!Number.isFinite(s.y[i])) return;
        g[started ? 'lineTo' : 'moveTo'](X(x), Y(s.y[i]));
        started = true;
      });
      g.stroke();
      g.setLineDash([]);
      s.x.forEach((x, i) => {
        if (!Number.isFinite(s.y[i])) return;
        g.beginPath();
        g.arc(X(x), Y(s.y[i]), 2.5, 0, 2 * Math.PI);
        g.fill();
      });
    }
    if (hover) {
      g.strokeStyle = 'rgba(230,237,243,0.6)';
      g.beginPath();
      g.moveTo(hover.px, M.t);
      g.lineTo(hover.px, h - M.b);
      g.stroke();
    }
  }, [series, title, yLabel, region, selectedX, hover, height]);

  const nearest = (clientX: number, el: HTMLCanvasElement) => {
    const G = geo.current;
    if (!G) return null;
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    let bd = Infinity;
    G.xs.forEach((x, i) => {
      const d = Math.abs(G.X(x) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { px: G.X(G.xs[best]), i: best, x: G.xs[best] };
  };

  const h = hover && series[0] ? hover.i : null;
  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas
        ref={ref}
        className="chart"
        style={{ height, cursor: onSelect ? 'pointer' : 'default' }}
        onPointerMove={(e) => {
          const n = nearest(e.clientX, e.currentTarget);
          setHover(n ? { px: n.px, i: n.i } : null);
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const n = nearest(e.clientX, e.currentTarget);
          if (n && onSelect) onSelect(n.x);
        }}
        aria-label={`${title}: ${yLabel} along the chord`}
      />
      {h !== null && geo.current && (
        <div className="chart-tip" style={{ left: Math.min(hover!.px + 8, (ref.current?.clientWidth ?? 300) - 200), top: 18 }}>
          <div>x = {geo.current.xs[h].toFixed(1)} d</div>
          {series.map((s) => {
            const i = s.x.findIndex((x) => Math.abs(x - geo.current!.xs[h]) < 1e-6);
            return i < 0 ? null : (
              <div key={s.label} style={{ color: s.color }}>
                {s.label}: {Number.isFinite(s.y[i]) ? s.y[i].toPrecision(3) : 'n/a'}
                {s.se && Number.isFinite(s.se[i]) ? ` ± ${s.se[i].toPrecision(2)}` : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
