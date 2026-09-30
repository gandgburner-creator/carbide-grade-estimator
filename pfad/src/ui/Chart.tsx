import { useEffect, useRef } from 'react';

interface Props {
  xs: number[];
  ys: number[];
  xLabel: string;
  yLabel: string;
  color?: string;
  yZero?: boolean;
}

/** Minimal canvas line chart (no DOM node per point). */
export function Chart({ xs, ys, xLabel, yLabel, color = '#58a6ff', yZero = false }: Props) {
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
    g.clearRect(0, 0, w, h);
    const m = { l: 46, r: 8, t: 8, b: 22 };
    g.font = '10px monospace';
    g.fillStyle = '#8b98a5';
    const pts = xs.map((x, i) => [x, ys[i]] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pts.length < 2) {
      g.fillText('no data yet', m.l, h / 2);
      return;
    }
    const x0 = Math.min(...pts.map((p) => p[0]));
    const x1 = Math.max(...pts.map((p) => p[0]));
    let y0 = Math.min(...pts.map((p) => p[1]));
    let y1 = Math.max(...pts.map((p) => p[1]));
    if (yZero) y0 = Math.min(0, y0);
    if (y1 === y0) {
      y1 += Math.abs(y1) * 0.05 + 1e-9;
      y0 -= Math.abs(y0) * 0.05 + 1e-9;
    }
    const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (w - m.l - m.r);
    const Y = (y: number) => h - m.b - ((y - y0) / (y1 - y0)) * (h - m.t - m.b);
    g.strokeStyle = '#2a333d';
    g.beginPath();
    g.moveTo(m.l, m.t);
    g.lineTo(m.l, h - m.b);
    g.lineTo(w - m.r, h - m.b);
    g.stroke();
    // enough significant digits to tell the axis ends apart
    const digits = Math.min(8, Math.max(3, Math.ceil(Math.log10(Math.max(Math.abs(y0), Math.abs(y1)) / (y1 - y0))) + 2));
    g.fillText(y1.toPrecision(digits), 2, m.t + 8);
    g.fillText(y0.toPrecision(digits), 2, h - m.b);
    g.fillText(x0.toPrecision(3), m.l, h - 6);
    const xl = x1.toPrecision(3);
    g.fillText(xl, w - m.r - g.measureText(xl).width, h - 6);
    g.fillText(`${yLabel} vs ${xLabel}`, m.l + 50, h - 6);
    g.strokeStyle = color;
    g.lineWidth = 1.4;
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(X(x), Y(y)) : g.lineTo(X(x), Y(y))));
    g.stroke();
  }, [xs, ys, xLabel, yLabel, color, yZero]);
  return <canvas ref={ref} className="chart" />;
}
