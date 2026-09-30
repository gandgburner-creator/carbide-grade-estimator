/** Minimal SVG line/point plot for CLI result inspection (not part of the lab UI). */
export interface Series {
  label: string;
  x: number[];
  y: number[];
  err?: number[];
  color: string;
  dashed?: boolean;
  /** thin, translucent, unlabelled (e.g. one line per seed under an ensemble curve) */
  thin?: boolean;
  /** draw point markers */
  markers?: boolean;
  /** no line between points */
  noLine?: boolean;
}

export function svgPlot(opts: {
  title: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  yMin?: number;
  yMax?: number;
  width?: number;
  height?: number;
  logY?: boolean;
}): string {
  const W = opts.width ?? 720;
  const H = opts.height ?? 440;
  const m = { l: 70, r: 20, t: 40, b: 55 };
  const xs = opts.series.flatMap((s) => s.x);
  const ys = opts.series.flatMap((s) => s.y).filter((v) => Number.isFinite(v));
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let y0 = opts.yMin ?? Math.min(...ys);
  let y1 = opts.yMax ?? Math.max(...ys);
  if (opts.logY) {
    y0 = Math.log10(Math.max(y0, 1e-6));
    y1 = Math.log10(y1);
  }
  const ty = (v: number) => (opts.logY ? Math.log10(Math.max(v, 1e-12)) : v);
  const px = (v: number) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const py = (v: number) => H - m.b - ((ty(v) - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="12">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600">${opts.title}</text>`);
  for (let k = 0; k <= 5; k++) {
    const v = y0 + ((y1 - y0) * k) / 5;
    const yy = H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
    parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="#e5e5e5"/>`);
    const lab = opts.logY ? (10 ** v).toPrecision(2) : v.toPrecision(3);
    parts.push(`<text x="${m.l - 6}" y="${yy + 4}" text-anchor="end">${lab}</text>`);
    const xv = x0 + ((x1 - x0) * k) / 5;
    parts.push(`<text x="${px(xv)}" y="${H - m.b + 18}" text-anchor="middle">${xv.toPrecision(3)}</text>`);
  }
  parts.push(`<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}" stroke="#333"/>`);
  parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="#333"/>`);
  parts.push(`<text x="${W / 2}" y="${H - 12}" text-anchor="middle">${opts.xLabel}</text>`);
  parts.push(`<text transform="translate(16 ${H / 2}) rotate(-90)" text-anchor="middle">${opts.yLabel}</text>`);
  opts.series.forEach((s) => {
    const pts = s.x.map((xv, i) => `${px(xv).toFixed(1)},${py(s.y[i]).toFixed(1)}`).join(' ');
    if (!s.noLine) {
      parts.push(
        `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.thin ? 0.8 : 1.8}"${s.thin ? ' opacity="0.45"' : ''}${s.dashed ? ' stroke-dasharray="6 4"' : ''}/>`,
      );
    }
    if (s.markers) s.x.forEach((xv, i) => parts.push(`<circle cx="${px(xv).toFixed(1)}" cy="${py(s.y[i]).toFixed(1)}" r="3" fill="${s.color}"/>`));
    if (s.err) {
      s.x.forEach((xv, i) => {
        const e = s.err![i];
        if (!Number.isFinite(e)) return;
        parts.push(
          `<line x1="${px(xv)}" x2="${px(xv)}" y1="${py(s.y[i] - e)}" y2="${py(s.y[i] + e)}" stroke="${s.color}" opacity="0.6"/>`,
        );
      });
    }
  });
  opts.series
    .filter((s) => !s.thin && s.label)
    .forEach((s, k) => {
      parts.push(`<rect x="${W - m.r - 230}" y="${m.t + 6 + k * 18}" width="14" height="3" fill="${s.color}"/>`);
      parts.push(`<text x="${W - m.r - 210}" y="${m.t + 11 + k * 18}">${s.label}</text>`);
    });
  parts.push('</svg>');
  return parts.join('\n');
}
