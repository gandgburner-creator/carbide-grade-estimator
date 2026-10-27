import { useEffect, useRef, useState } from 'react';

interface Props {
  xs: number[];
  ys: number[];
  xLabel: string;
  yLabel: string;
  color?: string;
  yZero?: boolean;
  /** error bars (± one SE) along x or y */
  xErr?: number[];
  yErr?: number[];
  /** draw the points as markers (profiles) */
  markers?: boolean;
  height?: number;
  onCanvas?: (c: HTMLCanvasElement | null) => void;
}

const M = { l: 62, r: 10, t: 10, b: 30 };

/** Axis number: exponent form for very small or large magnitudes, otherwise enough digits to tell the ends apart. */
function tick(v: number, digits: number): string {
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) return v.toExponential(2);
  return v.toPrecision(digits);
}

/**
 * Canvas line chart (one series, one y axis). Hover snaps to the nearest point
 * and shows its values; error bars are ± one standard error where given.
 */
export function Chart({ xs, ys, xLabel, yLabel, color = '#3987e5', yZero = false, xErr, yErr, markers = false, height = 150, onCanvas }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geo = useRef<{ X: (x: number) => number; Y: (y: number) => number; pts: [number, number, number][] } | null>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);

  useEffect(() => {
    onCanvas?.(ref.current);
  }, [onCanvas]);

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
    const pts = xs.map((x, i) => [x, ys[i], i] as [number, number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    geo.current = null;
    if (pts.length < 2) {
      g.fillText('no data yet', M.l, h / 2);
      return;
    }
    const ex = (i: number) => (xErr && Number.isFinite(xErr[i]) ? xErr[i] : 0);
    const ey = (i: number) => (yErr && Number.isFinite(yErr[i]) ? yErr[i] : 0);
    let x0 = Math.min(...pts.map(([x, , i]) => x - ex(i)));
    let x1 = Math.max(...pts.map(([x, , i]) => x + ex(i)));
    let y0 = Math.min(...pts.map(([, y, i]) => y - ey(i)));
    let y1 = Math.max(...pts.map(([, y, i]) => y + ey(i)));
    if (yZero) y0 = Math.min(0, y0);
    if (y1 === y0) {
      y1 += Math.abs(y1) * 0.05 + 1e-9;
      y0 -= Math.abs(y0) * 0.05 + 1e-9;
    }
    if (x1 === x0) {
      x1 += Math.abs(x1) * 0.05 + 1e-9;
      x0 -= Math.abs(x0) * 0.05 + 1e-9;
    }
    const X = (x: number) => M.l + ((x - x0) / (x1 - x0)) * (w - M.l - M.r);
    const Y = (y: number) => h - M.b - ((y - y0) / (y1 - y0)) * (h - M.t - M.b);
    geo.current = { X, Y, pts };
    // recessive axes and a zero line when zero is in range
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
    if (x0 < 0 && x1 > 0) {
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(X(0), M.t);
      g.lineTo(X(0), h - M.b);
      g.stroke();
      g.setLineDash([]);
    }
    const digits = (a: number, b: number) => Math.min(8, Math.max(3, Math.ceil(Math.log10(Math.max(Math.abs(a), Math.abs(b)) / (b - a || 1))) + 2));
    const dy = digits(y0, y1);
    const dx = digits(x0, x1);
    g.fillStyle = '#8b98a5';
    g.fillText(tick(y1, dy), 2, M.t + 8);
    g.fillText(tick(y0, dy), 2, h - M.b);
    g.fillText(tick(x0, dx), M.l, h - M.b + 12);
    const xl = tick(x1, dx);
    g.fillText(xl, w - M.r - g.measureText(xl).width, h - M.b + 12);
    const cap = `${yLabel}  vs  ${xLabel}`;
    g.fillText(cap, Math.max(M.l, (w - g.measureText(cap).width) / 2), h - 4);
    // error bars
    g.strokeStyle = 'rgba(139,152,165,0.7)';
    g.beginPath();
    for (const [x, y, i] of pts) {
      if (ex(i) > 0) {
        g.moveTo(X(x - ex(i)), Y(y));
        g.lineTo(X(x + ex(i)), Y(y));
      }
      if (ey(i) > 0) {
        g.moveTo(X(x), Y(y - ey(i)));
        g.lineTo(X(x), Y(y + ey(i)));
      }
    }
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], k) => (k === 0 ? g.moveTo(X(x), Y(y)) : g.lineTo(X(x), Y(y))));
    g.stroke();
    if (markers) {
      g.fillStyle = color;
      for (const [x, y] of pts) {
        g.beginPath();
        g.arc(X(x), Y(y), 3, 0, 2 * Math.PI);
        g.fill();
      }
    }
    if (hover && hover.i < pts.length) {
      const [x, y] = pts[hover.i];
      g.strokeStyle = 'rgba(230,237,243,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X(x), M.t);
      g.lineTo(X(x), h - M.b);
      g.stroke();
      g.fillStyle = '#e6edf3';
      g.beginPath();
      g.arc(X(x), Y(y), 4, 0, 2 * Math.PI);
      g.fill();
    }
  }, [xs, ys, xLabel, yLabel, color, yZero, xErr, yErr, markers, hover, height]);

  const onMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const G = geo.current;
    if (!G) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    let best = -1;
    let bd = Infinity;
    G.pts.forEach(([x, y], k) => {
      const d = Math.hypot(G.X(x) - px, (G.Y(y) - py) * (markers ? 1 : 0.05));
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    setHover(best >= 0 ? { i: best, px, py } : null);
  };

  const hp = hover && geo.current?.pts[hover.i];
  return (
    <div className="chart-wrap" style={{ height }}>
      <canvas ref={ref} className="chart" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} aria-label={`${yLabel} versus ${xLabel}`} />
      {hp && hover && (
        <div className="chart-tip" style={{ left: Math.min(hover.px + 10, (ref.current?.clientWidth ?? 300) - 180), top: 6 }}>
          <div>
            {xLabel}: {hp[0].toPrecision(5)}
            {xErr && Number.isFinite(xErr[hp[2]]) ? ` ± ${xErr[hp[2]].toPrecision(2)}` : ''}
          </div>
          <div>
            {yLabel}: {hp[1].toPrecision(5)}
            {yErr && Number.isFinite(yErr[hp[2]]) ? ` ± ${yErr[hp[2]].toPrecision(2)}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
