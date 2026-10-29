import type { Proposal } from '../../geometry/Construction';
import type { ReplayFrame } from '../../geometry/History';
import { bodyPolygon, place, segmentAt, sideY, stationX, type Placement, type Side, type SurfaceGeometry } from '../../geometry/SurfaceGeometry';
import type { StationRow } from '../../measurements/SeparationDetector';
import { arrowsOf, type Streamline } from '../../measurements/Streamlines';
import type { transformOf } from '../ParticleView';

type T = ReturnType<typeof transformOf>;

export interface OverlayState {
  placement: Placement;
  /** the body in the simulation */
  geometry: SurfaceGeometry;
  /** the parent version, drawn faintly */
  previous: SurfaceGeometry | null;
  proposal: Proposal | null;
  /** index of the construction point in the proposal (−1: nothing built yet) */
  pointIdx: number;
  /** stretch the measurements flagged, on one side */
  region: { side: Side; xLo: number; xHi: number; kind: 'reversed' | 'reduced' | 'exploratory' } | null;
  /** dividing-streamline heights of the measured version */
  dividing: { side: Side; stations: StationRow[]; exploratory: boolean } | null;
  replay: ReplayFrame | null;
  /** a version other than the simulated head that is being viewed: its outline is drawn brightly */
  viewed: SurfaceGeometry | null;
  showStations: boolean;
  alphaDeg: number;
  /** a surface outline imported for comparison */
  references: SurfaceGeometry[];
  /** a live fill in progress: where the particles stopped touching the surface, and how far the front has got */
  live?: { side: Side; onset: number | null; front: number | null } | null;
  /** the construction pointer: where it is, the anchor its tether runs to (body frame; y outward on `side`), and an unplaced candidate */
  /** streamlines of the measured mean flow, in simulation coordinates */
  streams?: { lines: Streamline[]; arrowEvery: number } | null;
  pointer?: { side: Side; at: { x: number; y: number }; anchor: { x: number; y: number }; preview: SurfaceGeometry | null; previewAt: { x: number; y: number } | null } | null;
}

const COLORS = { tether: '#7ee787', reversed: '#f85149', reduced: '#d29922', exploratory: '#d29922', proposal: '#f0b429', dividing: '#39c5cf', marker: '#ff4d4d' };

/** Annotations of the construction workflow, drawn over the particle view in simulation coordinates. */
export function makeOverlay(st: OverlayState) {
  return (g: CanvasRenderingContext2D, T: T) => {
    const pl = st.placement;
    const P = (x: number, y: number): [number, number] => {
      const q = place([x, y], pl);
      return [T.X(q[0]), T.Y(q[1])];
    };
    const outline = (geo: SurfaceGeometry) => {
      const v = bodyPolygon(geo);
      g.beginPath();
      for (let k = 0; k < v.length; k += 2) {
        const [px, py] = P(v[k], v[k + 1]);
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
    };
    const line = (pts: [number, number][]) => {
      g.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    };

    // streamlines of the measured mean flow (paths of the mean motion, not of single particles)
    if (st.streams) {
      g.lineWidth = 1.2;
      g.strokeStyle = 'rgba(150,215,255,0.8)';
      g.fillStyle = 'rgba(150,215,255,0.9)';
      for (const l of st.streams.lines) {
        g.beginPath();
        for (let k = 0; k < l.points.length; k += 2) {
          const px = T.X(l.points[k]);
          const py = T.Y(l.points[k + 1]);
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.stroke();
        for (const [ax, ay, ang] of arrowsOf(l, st.streams.arrowEvery)) {
          const px = T.X(ax);
          const py = T.Y(ay);
          // screen y runs down, so the angle flips
          const a = -ang;
          g.beginPath();
          g.moveTo(px + 5 * Math.cos(a), py + 5 * Math.sin(a));
          g.lineTo(px + 5 * Math.cos(a + 2.5), py + 5 * Math.sin(a + 2.5));
          g.lineTo(px + 5 * Math.cos(a - 2.5), py + 5 * Math.sin(a - 2.5));
          g.closePath();
          g.fill();
        }
      }
    }

    // imported references and the previous version: faint outlines
    for (const r of st.references) {
      outline(r);
      g.setLineDash([2, 3]);
      g.strokeStyle = '#b392f0';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
    }
    if (st.previous) {
      outline(st.previous);
      g.setLineDash([5, 4]);
      g.strokeStyle = 'rgba(200,210,220,0.55)';
      g.lineWidth = 1.2;
      g.stroke();
      g.setLineDash([]);
    }
    if (st.viewed) {
      outline(st.viewed);
      g.fillStyle = 'rgba(88,166,255,0.18)';
      g.fill();
      g.strokeStyle = '#58a6ff';
      g.lineWidth = 2;
      g.stroke();
    }
    // replay: the surface as it stood when the construction point had reached its position (view only)
    if (st.replay) {
      outline(st.replay.geometry);
      g.fillStyle = 'rgba(88,166,255,0.25)';
      g.fill();
      g.strokeStyle = '#e6edf3';
      g.lineWidth = 2;
      g.stroke();
    }

    const geo = st.replay ? st.replay.geometry : st.geometry;
    const x = stationX(geo);

    // flagged stretch along the surface
    if (st.region && !st.replay) {
      const y = sideY(geo, st.region.side);
      const sgn = st.region.side === 'upper' ? 1 : -1;
      const pts: [number, number][] = [];
      for (let i = 0; i <= geo.stations; i++) {
        if (x[i] < st.region.xLo - 1e-9 || x[i] > st.region.xHi + 1e-9) continue;
        pts.push(P(x[i], y[i] + sgn * 0.45));
      }
      if (pts.length > 1) {
        line(pts);
        g.strokeStyle = COLORS[st.region.kind];
        g.lineWidth = 4;
        g.lineCap = 'round';
        if (st.region.kind === 'exploratory') g.setLineDash([3, 5]);
        g.stroke();
        g.setLineDash([]);
        g.lineCap = 'butt';
      }
    }

    // live fill: the stretch being filled, the separation point and the front
    if (st.live && !st.replay) {
      const { side, onset, front } = st.live;
      const y = sideY(geo, side);
      const sgn = side === 'upper' ? 1 : -1;
      const at = (xq: number): [number, number] => {
        const i = segmentAt(geo, xq);
        const f = (xq - x[i]) / (x[i + 1] - x[i]);
        return P(xq, y[i] + f * (y[i + 1] - y[i]) + sgn * 0.45);
      };
      if (onset !== null && front !== null && front > onset) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= geo.stations; i++) if (x[i] >= onset && x[i] <= front) pts.push(P(x[i], y[i] + sgn * 0.45));
        if (pts.length > 1) {
          line(pts);
          g.strokeStyle = COLORS.proposal;
          g.lineWidth = 4;
          g.lineCap = 'round';
          g.stroke();
          g.lineCap = 'butt';
        }
      }
      g.font = '10px ui-monospace, monospace';
      if (onset !== null) {
        const [mx, my] = at(onset);
        g.beginPath();
        g.arc(mx, my, 5, 0, 2 * Math.PI);
        g.fillStyle = COLORS.marker;
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = '#ffb3b3';
        g.fillText('separation (particles stop touching)', mx + 8, my - 8);
      }
      if (front !== null) {
        const [fx, fy] = at(front);
        g.beginPath();
        g.arc(fx, fy, 4, 0, 2 * Math.PI);
        g.fillStyle = COLORS.proposal;
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = '#ffe08a';
        g.fillText('front', fx + 7, fy - 6);
      }
    }

    // the pointer, its tether to the anchor, and the surface a candidate position would give
    if (st.pointer && !st.replay) {
      const pt = st.pointer;
      const sgn = pt.side === 'upper' ? 1 : -1;
      if (pt.preview) {
        outline(pt.preview);
        g.setLineDash([4, 4]);
        g.strokeStyle = COLORS.proposal;
        g.lineWidth = 1.8;
        g.stroke();
        g.setLineDash([]);
        if (pt.previewAt) {
          const [qx, qy] = P(pt.previewAt.x, sgn * pt.previewAt.y);
          g.beginPath();
          g.arc(qx, qy, 5, 0, 2 * Math.PI);
          g.strokeStyle = COLORS.proposal;
          g.lineWidth = 1.8;
          g.stroke();
        }
      }
      const a = P(pt.at.x, sgn * pt.at.y);
      const b = P(pt.anchor.x, sgn * pt.anchor.y);
      line([a, b]);
      g.setLineDash([6, 4]);
      g.strokeStyle = COLORS.tether;
      g.lineWidth = 1.6;
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(b[0], b[1], 4, 0, 2 * Math.PI);
      g.fillStyle = COLORS.tether;
      g.fill();
      g.beginPath();
      g.arc(a[0], a[1], 6, 0, 2 * Math.PI);
      g.fillStyle = COLORS.marker;
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
      g.font = '10px ui-monospace, monospace';
      g.fillStyle = '#ffb3b3';
      g.fillText('pointer', a[0] + 8, a[1] - 8);
      g.fillStyle = COLORS.tether;
      g.fillText('tether → anchor', b[0] - 70, b[1] - 8);
    }

    // measured dividing streamline: the surface of zero net near-wall flux, at its measured height along the normal
    if (st.dividing && !st.replay) {
      const side = st.dividing.side;
      const y = sideY(geo, side);
      const sgn = side === 'upper' ? 1 : -1;
      const pts: [number, number][] = [];
      for (const s of st.dividing.stations) {
        const h = st.dividing.exploratory ? s.hdsRaw : s.hds;
        if ((h.state !== 'closed' && h.state !== 'open') || !(h.value > 0)) continue;
        // the station centre on the surface, then the measured height along the local normal
        const i = segmentAt(geo, s.x);
        const f = (s.x - x[i]) / (x[i + 1] - x[i]);
        const cy = y[i] + f * (y[i + 1] - y[i]);
        const tx = x[i + 1] - x[i];
        const ty = y[i + 1] - y[i];
        const L = Math.hypot(tx, ty);
        pts.push(P(s.x + (-ty / L) * sgn * h.value, cy + (tx / L) * sgn * h.value));
      }
      if (pts.length > 1) {
        line(pts);
        g.strokeStyle = COLORS.dividing;
        g.lineWidth = 1.8;
        g.setLineDash(st.dividing.exploratory ? [2, 4] : [7, 3]);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = COLORS.dividing;
        g.font = '10px ui-monospace, monospace';
        g.fillText(st.dividing.exploratory ? 'dividing streamline (point estimate)' : 'dividing streamline', pts[0][0] + 4, pts[0][1] - 6);
      }
    }

    // proposed increment: built part solid, the rest dotted, the construction point on top
    const pr = st.proposal;
    if (pr && !st.replay) {
      const pts = pr.points;
      const built = pts.slice(0, st.pointIdx + 1);
      if (pts.length) {
        // faint: the whole proposed curve
        const full: [number, number][] = [P(pts[0].x, pts[0].yOld), ...pts.map((q) => P(q.x, q.yNew)), P(pts[pts.length - 1].x + 1, pts[pts.length - 1].yOld)];
        line(full);
        g.setLineDash([2, 4]);
        g.strokeStyle = 'rgba(240,180,41,0.5)';
        g.lineWidth = 1.5;
        g.stroke();
        g.setLineDash([]);
      }
      if (built.length) {
        const upper: [number, number][] = built.map((q) => P(q.x, q.yNew));
        const lower: [number, number][] = built.map((q) => P(q.x, q.yOld)).reverse();
        g.beginPath();
        [...upper, ...lower].forEach(([px, py], i) => (i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
        g.closePath();
        g.fillStyle = 'rgba(240,180,41,0.35)';
        g.fill();
        line(upper);
        g.strokeStyle = COLORS.proposal;
        g.lineWidth = 2.6;
        g.stroke();
        const last = built[built.length - 1];
        const [mx, my] = P(last.x, last.yNew);
        g.beginPath();
        g.arc(mx, my, 6, 0, 2 * Math.PI);
        g.fillStyle = COLORS.marker;
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
      }
    }
    if (st.replay?.marker) {
      const m = st.replay.marker;
      const [mx, my] = P(m.x, m.y);
      g.beginPath();
      g.arc(mx, my, 6, 0, 2 * Math.PI);
      g.fillStyle = COLORS.marker;
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.stroke();
    }

    // station ticks (analysis stations are 2 d wide) and orientation
    if (st.showStations) {
      g.strokeStyle = 'rgba(139,152,165,0.5)';
      g.lineWidth = 1;
      for (const side of ['upper', 'lower'] as const) {
        const y = sideY(geo, side);
        const sgn = side === 'upper' ? 1 : -1;
        for (let i = 0; i <= geo.stations; i += 2) {
          const [a, b] = [P(x[i], y[i]), P(x[i], y[i] + sgn * 0.7)];
          g.beginPath();
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
          g.stroke();
        }
      }
    }
    g.font = '11px ui-monospace, monospace';
    g.fillStyle = '#c9d1d9';
    const mid = geo.chord / 2;
    const half = Math.round(geo.stations / 2);
    // the labels stand off the surface along its outward normal and read away from the body
    g.textAlign = 'left';
    const up = P(mid, sideY(geo, 'upper')[half] + 3.5);
    g.fillText('upper side', up[0], up[1]);
    g.textAlign = 'right';
    const lo = P(mid, sideY(geo, 'lower')[half] - 3.5);
    g.fillText('lower side', lo[0], lo[1] + 8);
    g.textAlign = 'left';
    const le = P(0, 0);
    const te = P(geo.chord, 0);
    g.fillText('LE', le[0] + (le[0] < te[0] ? -22 : 8), le[1] + (le[1] < te[1] ? -8 : 14));
    g.fillText('TE', te[0] + (te[0] > le[0] ? 8 : -22), te[1] + (te[1] > le[1] ? 14 : -8));
  };
}

/** A small arrow for the incoming stream, drawn in screen space at the left of the view. */
export function drawStream(g: CanvasRenderingContext2D, T: T, domain: { xmin: number; ymin: number; ymax: number }, speed: number, alphaDeg: number) {
  const x = T.X(domain.xmin) + 14;
  const y = T.Y((domain.ymin + domain.ymax) / 2);
  g.strokeStyle = '#58a6ff';
  g.fillStyle = '#58a6ff';
  g.lineWidth = 2;
  for (const dy of [-18, 0, 18]) {
    g.beginPath();
    g.moveTo(x, y + dy);
    g.lineTo(x + 34, y + dy);
    g.stroke();
    g.beginPath();
    g.moveTo(x + 34, y + dy);
    g.lineTo(x + 27, y + dy - 4);
    g.lineTo(x + 27, y + dy + 4);
    g.closePath();
    g.fill();
  }
  g.font = '10px ui-monospace, monospace';
  g.fillText(`U = ${speed}`, x, y - 28);
  g.fillText(`α = ${alphaDeg}°`, x, y + 36);
}
