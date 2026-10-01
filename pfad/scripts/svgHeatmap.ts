/** Minimal SVG heat map of a cell field (CLI result inspection; not part of the lab UI). */
export interface HeatmapOptions {
  title: string;
  /** row-major values [j * nx + i]; NaN cells are drawn grey */
  values: number[];
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  cellW: number;
  cellH: number;
  /** colour scale: 'diverging' is blue (< 0) – white (0) – red (> 0), symmetric about 0 */
  scale: 'diverging' | 'sequential';
  vMin?: number;
  vMax?: number;
  label: string;
  /** polylines drawn on top (e.g. the ceiling, a ψ = 0 line), in data coordinates */
  lines?: { x: number[]; y: number[]; color: string; width?: number; dashed?: boolean }[];
  /** cells to outline (e.g. significant reversal), as [i, j] */
  outline?: { cells: [number, number][]; color: string };
  /** pixels per data unit (x and y) */
  pxPerUnit?: number;
  yStretch?: number;
}

function colour(v: number, lo: number, hi: number, scale: HeatmapOptions['scale']): string {
  if (!Number.isFinite(v)) return '#bbbbbb';
  if (scale === 'diverging') {
    const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const t = Math.max(-1, Math.min(1, v / m));
    const a = Math.abs(t);
    // white → red (#c0392b) or white → blue (#2166ac)
    const [r, g, b] = t >= 0 ? [192, 57, 43] : [33, 102, 172];
    const mix = (c: number) => Math.round(255 + (c - 255) * a);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
  // light yellow → dark blue
  const r = Math.round(255 - 230 * t);
  const g = Math.round(247 - 160 * t);
  const b = Math.round(188 - 20 * t);
  return `rgb(${r},${g},${b})`;
}

export function svgHeatmap(o: HeatmapOptions): string {
  const k = o.pxPerUnit ?? 1.6;
  const ks = k * (o.yStretch ?? 1);
  const m = { l: 60, r: 110, t: 36, b: 44 };
  const Wd = o.nx * o.cellW;
  const Hd = o.ny * o.cellH;
  const W = Math.round(m.l + Wd * k + m.r);
  const H = Math.round(m.t + Hd * ks + m.b);
  const finite = o.values.filter(Number.isFinite);
  const lo = o.vMin ?? Math.min(...finite);
  const hi = o.vMax ?? Math.max(...finite);
  const px = (x: number) => m.l + (x - o.x0) * k;
  const py = (y: number) => m.t + Hd * ks - (y - o.y0) * ks;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif" font-size="11">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<text x="${m.l}" y="22" font-size="13" font-weight="600">${o.title}</text>`);
  for (let j = 0; j < o.ny; j++) {
    for (let i = 0; i < o.nx; i++) {
      const v = o.values[j * o.nx + i];
      const x = px(o.x0 + i * o.cellW);
      const y = py(o.y0 + (j + 1) * o.cellH);
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(o.cellW * k + 0.3).toFixed(1)}" height="${(o.cellH * ks + 0.3).toFixed(1)}" fill="${colour(v, lo, hi, o.scale)}"/>`);
    }
  }
  if (o.outline) {
    for (const [i, j] of o.outline.cells) {
      parts.push(`<rect x="${px(o.x0 + i * o.cellW).toFixed(1)}" y="${py(o.y0 + (j + 1) * o.cellH).toFixed(1)}" width="${(o.cellW * k).toFixed(1)}" height="${(o.cellH * ks).toFixed(1)}" fill="none" stroke="${o.outline.color}" stroke-width="1.2"/>`);
    }
  }
  for (const l of o.lines ?? []) {
    const pts = l.x.map((x, q) => `${px(x).toFixed(1)},${py(l.y[q]).toFixed(1)}`).join(' ');
    parts.push(`<polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 1.5}"${l.dashed ? ' stroke-dasharray="5 3"' : ''}/>`);
  }
  // axes
  parts.push(`<rect x="${m.l}" y="${m.t}" width="${(Wd * k).toFixed(1)}" height="${(Hd * ks).toFixed(1)}" fill="none" stroke="#333"/>`);
  const ticks = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, q) => a + ((b - a) * q) / n);
  for (const x of ticks(o.x0, o.x0 + Wd, 8)) parts.push(`<text x="${px(x).toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle">${Math.round(x)}</text>`);
  for (const y of ticks(o.y0, o.y0 + Hd, 4)) parts.push(`<text x="${m.l - 6}" y="${(py(y) + 4).toFixed(1)}" text-anchor="end">${Math.round(y * 10) / 10}</text>`);
  parts.push(`<text x="${m.l + (Wd * k) / 2}" y="${H - 8}" text-anchor="middle">x (particle diameters)</text>`);
  parts.push(`<text transform="translate(14 ${m.t + (Hd * ks) / 2}) rotate(-90)" text-anchor="middle">y</text>`);
  // colour bar
  const cbx = W - m.r + 30;
  const cbh = Math.min(160, Hd * ks);
  for (let q = 0; q < 40; q++) {
    const v = hi - ((hi - lo) * (q + 0.5)) / 40;
    parts.push(`<rect x="${cbx}" y="${(m.t + (q * cbh) / 40).toFixed(1)}" width="14" height="${(cbh / 40 + 0.5).toFixed(1)}" fill="${colour(v, lo, hi, o.scale)}"/>`);
  }
  parts.push(`<text x="${cbx + 18}" y="${m.t + 8}">${hi.toPrecision(3)}</text>`);
  parts.push(`<text x="${cbx + 18}" y="${m.t + cbh}">${lo.toPrecision(3)}</text>`);
  parts.push(`<text x="${cbx}" y="${m.t + cbh + 16}">${o.label}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}
