import { bodyPolygon, place, sampleSurface, type Placement, type Side, type SurfaceGeometry } from './SurfaceGeometry';
import type { GeometryVersion, Project, ReferenceGeometry } from './History';

/**
 * Geometry exports. The body frame has the leading edge at the origin, x along the chord and y
 * across it, in particle diameters d; the simulation frame adds the placement (angle of attack
 * and leading-edge position). A surface is a polyline: the sampled coordinates ARE the geometry
 * the engine simulated (every station is a polygon vertex), not a fitted curve.
 */
export interface SvgOutline {
  label: string;
  geometry: SurfaceGeometry;
  style: 'current' | 'previous' | 'proposal' | 'reference';
}

const STYLE: Record<SvgOutline['style'], { stroke: string; fill: string; dash: string; width: number }> = {
  current: { stroke: '#e6edf3', fill: 'rgba(88,166,255,0.18)', dash: '', width: 1.6 },
  previous: { stroke: '#8b98a5', fill: 'none', dash: '4 3', width: 1 },
  proposal: { stroke: '#d29922', fill: 'rgba(210,153,34,0.15)', dash: '5 3', width: 1.4 },
  reference: { stroke: '#b392f0', fill: 'none', dash: '2 3', width: 1.2 },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** SVG of one or more outlines in the body frame (y up), with a scale bar in particle diameters. */
export function geometrySVG(outlines: SvgOutline[], opts: { title: string; description?: string; marker?: { x: number; y: number } | null; widthPx?: number } = { title: 'PFAD geometry' }): string {
  const W = opts.widthPx ?? 900;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const o of outlines) {
    const v = bodyPolygon(o.geometry);
    for (let k = 0; k < v.length; k += 2) {
      x0 = Math.min(x0, v[k]);
      x1 = Math.max(x1, v[k]);
      y0 = Math.min(y0, v[k + 1]);
      y1 = Math.max(y1, v[k + 1]);
    }
  }
  if (!Number.isFinite(x0)) throw new Error('no outline to draw');
  const pad = 3;
  const sc = W / (x1 - x0 + 2 * pad);
  const H = Math.max(120, (y1 - y0 + 2 * pad) * sc + 60);
  const X = (x: number) => ((x - x0 + pad) * sc).toFixed(2);
  const Y = (y: number) => ((y1 + pad - y) * sc).toFixed(2);
  const paths = outlines
    .map((o) => {
      const v = bodyPolygon(o.geometry);
      const d = Array.from({ length: v.length / 2 }, (_, i) => `${i ? 'L' : 'M'}${X(v[2 * i])} ${Y(v[2 * i + 1])}`).join(' ') + ' Z';
      const st = STYLE[o.style];
      return `<path d="${d}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="${st.width}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}><title>${esc(o.label)}</title></path>`;
    })
    .join('\n  ');
  const bar = 5;
  const by = H - 22;
  const legend = outlines.map((o, i) => `<text x="8" y="${16 + 14 * i}" font-size="11" fill="${STYLE[o.style].stroke}">${esc(`${o.style}: ${o.label}`)}</text>`).join('\n  ');
  const marker = opts.marker ? `<circle cx="${X(opts.marker.x)}" cy="${Y(opts.marker.y)}" r="5" fill="#f85149" stroke="#fff" stroke-width="1"><title>construction point</title></circle>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" viewBox="0 0 ${W} ${H.toFixed(0)}" font-family="monospace">
  <title>${esc(opts.title)}</title>
  ${opts.description ? `<desc>${esc(opts.description)}</desc>` : ''}
  <rect width="100%" height="100%" fill="#0b0e12"/>
  ${paths}
  ${marker}
  ${legend}
  <line x1="${(W - 20 - bar * sc).toFixed(1)}" y1="${by}" x2="${(W - 20).toFixed(1)}" y2="${by}" stroke="#8b98a5" stroke-width="2"/>
  <text x="${(W - 20 - bar * sc).toFixed(1)}" y="${by - 6}" font-size="11" fill="#8b98a5">${bar} d (particle diameters)</text>
</svg>
`;
}

/** SVG of a project's head with the previous versions on the active path as faint outlines. */
export function projectSVG(p: Project, versionId: string = p.head, withPrevious = true): string {
  const byId = new Map(p.versions.map((v) => [v.id, v]));
  const chain: GeometryVersion[] = [];
  for (let v = byId.get(versionId) ?? null; v; v = v.parent ? (byId.get(v.parent) ?? null) : null) chain.unshift(v);
  const current = chain[chain.length - 1];
  const outlines: SvgOutline[] = [
    ...(withPrevious ? chain.slice(0, -1).map((v) => ({ label: `${v.id} ${v.label}`, geometry: v.geometry, style: 'previous' as const })) : []),
    ...p.references.map((r) => ({ label: `${r.name} (imported reference, not constructed by PFAD)`, geometry: r.geometry, style: 'reference' as const })),
    { label: `${current.id} ${current.label}`, geometry: current.geometry, style: 'current' },
  ];
  return geometrySVG(outlines, {
    title: `${p.name} — ${current.id}`,
    description: `Flow-guided geometry version ${current.id} (${current.origin}), parent ${current.parent ?? 'none'}, created ${current.createdAt}. Body frame, units of particle diameters.`,
  });
}

/** Sampled surface coordinates (CSV with provenance comments). With a placement the simulation-frame coordinates are added. */
export function surfaceCSV(v: GeometryVersion, meta: { project: string; codeVersion: string; modelVersion: string }, placement?: Placement): string {
  const rows: string[] = [];
  for (const side of ['lower', 'upper'] as Side[]) {
    const s = sampleSurface(v.geometry, side);
    const sim = placement ? place(s.flatMap((q) => [q.x, q.y]), placement) : null;
    s.forEach((q, i) => rows.push([side, i, q.x, q.y, q.s, q.slopeDeg, ...(sim ? [sim[2 * i], sim[2 * i + 1]] : [])].map((c) => (typeof c === 'number' ? String(Number(c.toPrecision(9))) : c)).join(',')));
  }
  const head = [
    '# PFAD flow-guided geometry: sampled surface coordinates (the polyline the engine simulated)',
    `# project: ${meta.project}`,
    `# version: ${v.id}  parent: ${v.parent ?? 'none'}  origin: ${v.origin}${v.undone ? '  (UNDONE)' : ''}`,
    `# label: ${v.label}`,
    `# createdAt: ${v.createdAt}`,
    `# codeVersion: ${meta.codeVersion}  modelVersion: ${meta.modelVersion}`,
    `# chord: ${v.geometry.chord} d  stations: ${v.geometry.stations}`,
    '# units: particle diameters d. Body frame: leading edge at the origin, x along the chord, y across it.',
    ...(placement ? [`# simulation frame: angle of attack ${placement.alphaDeg} deg (nose up in a stream along +x), leading edge at (${placement.x.toFixed(4)}, ${placement.y.toFixed(4)})`] : []),
    ['side', 'station', 'x', 'y', 'arc_length', 'slope_deg', ...(placement ? ['x_sim', 'y_sim'] : [])].join(','),
  ];
  return `${head.join('\n')}\n${rows.join('\n')}\n`;
}

/**
 * An imported reference outline: CSV with columns x, upper, lower (header optional), any units.
 * It is rescaled to `chord`, resampled onto `stations`, and kept as a REFERENCE: it never enters the
 * construction path.
 */
export function parseReferenceOutline(text: string, name: string, chord: number, stations: number): ReferenceGeometry {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[,\s;]+/).map(Number))
    .filter((r) => r.length >= 3 && r.every(Number.isFinite));
  if (rows.length < 4) throw new Error('a reference outline needs at least 4 rows of x, upper, lower');
  rows.sort((a, b) => a[0] - b[0]);
  const xmin = rows[0][0];
  const L = rows[rows.length - 1][0] - xmin;
  if (!(L > 0)) throw new Error('the outline has zero length');
  const k = chord / L;
  const interp = (col: 1 | 2, x: number) => {
    if (x <= rows[0][0]) return rows[0][col];
    for (let i = 0; i + 1 < rows.length; i++) {
      if (x <= rows[i + 1][0]) {
        const f = (x - rows[i][0]) / (rows[i + 1][0] - rows[i][0] || 1);
        return rows[i][col] + f * (rows[i + 1][col] - rows[i][col]);
      }
    }
    return rows[rows.length - 1][col];
  };
  const xs = Array.from({ length: stations + 1 }, (_, i) => xmin + (i * L) / stations);
  return {
    id: '',
    name,
    source: name,
    importedAt: new Date().toISOString(),
    imported: true,
    geometry: { chord, stations, upper: xs.map((x) => interp(1, x) * k), lower: xs.map((x) => interp(2, x) * k) },
  };
}
