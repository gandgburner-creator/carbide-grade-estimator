import { useEffect, useRef, useState } from 'react';
import { FIELD_INFO } from '../app/fields';
import type { Frame } from '../workers/protocol';
import { fieldScale, ramp } from './colors';

export { ramp } from './colors';

export interface ViewOptions {
  vectors: boolean;
  collisions: boolean;
  trails: boolean;
  colorBySpeed: boolean;
  particles: boolean;
}

/** zoom about the domain point (cx, cy); zoom 1 fits the domain */
export interface Camera {
  zoom: number;
  cx: number;
  cy: number;
}

interface Props {
  frame: Frame | null;
  options: ViewOptions;
  selected: number | null;
  onPick: (index: number | null) => void;
  camera: Camera | null;
  onCamera: (c: Camera | null) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** drawn last, in simulation coordinates through the view transform (workspace annotations) */
  overlay?: (g: CanvasRenderingContext2D, T: ReturnType<typeof transformOf>, frame: Frame) => void;
  /** drawn before the particles, over the field cells and under the body (e.g. a measured mean field) */
  underlay?: (g: CanvasRenderingContext2D, T: ReturnType<typeof transformOf>, frame: Frame) => void;
  /** points the person can pick up and drag (simulation coordinates); a drag reports where the point was dropped to, and the view does not pan meanwhile */
  handles?: ViewHandle[];
  onHandleDrag?: (id: string, x: number, y: number) => void;
}

export interface ViewHandle {
  id: string;
  x: number;
  y: number;
}

type Dom = Frame['domain'];

export function transformOf(d: Dom, w: number, h: number, cam: Camera | null) {
  const pad = 14;
  const fit = Math.min((w - 2 * pad) / (d.xmax - d.xmin), (h - 2 * pad) / (d.ymax - d.ymin));
  const zoom = cam?.zoom ?? 1;
  const cx = cam?.cx ?? (d.xmin + d.xmax) / 2;
  const cy = cam?.cy ?? (d.ymin + d.ymax) / 2;
  const s = fit * zoom;
  return {
    s,
    fit,
    X: (x: number) => w / 2 + (x - cx) * s,
    Y: (y: number) => h / 2 - (y - cy) * s, // y up
    invX: (px: number) => cx + (px - w / 2) / s,
    invY: (py: number) => cy - (py - h / 2) / s,
  };
}

export function ParticleView({ frame, options, selected, onPick, camera, onCamera, canvasRef, overlay, underlay, handles, onHandleDrag }: Props) {
  const localRef = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? localRef;
  const frameRef = useRef<Frame | null>(null);
  frameRef.current = frame;
  const drag = useRef<{ x: number; y: number; cam: Camera; moved: boolean } | null>(null);
  const handleDrag = useRef<string | null>(null);
  const [probe, setProbe] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [size, setSize] = useState(0);

  // redraw on container resize
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setSize((s) => s + 1));
    ro.observe(c);
    return () => ro.disconnect();
  }, [ref]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !frame) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0e12';
    g.fillRect(0, 0, w, h);
    const d = frame.domain;
    const T = transformOf(d, w, h, camera);

    g.fillStyle = '#10151b';
    g.fillRect(T.X(d.xmin), T.Y(d.ymax), (d.xmax - d.xmin) * T.s, (d.ymax - d.ymin) * T.s);

    if (frame.field) {
      const f = frame.field;
      const sc = fieldScale(f.kind, f.min, f.max);
      const cw = ((d.xmax - d.xmin) / f.nx) * T.s;
      const ch = ((d.ymax - d.ymin) / f.ny) * T.s;
      for (let cy = 0; cy < f.ny; cy++) {
        for (let cx = 0; cx < f.nx; cx++) {
          const [r, gg, b] = sc.color(f.values[cy * f.nx + cx]);
          g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
          g.fillRect(T.X(d.xmin) + cx * cw, T.Y(d.ymin) - (cy + 1) * ch, cw + 0.6, ch + 0.6);
        }
      }
    }

    underlay?.(g, T, frame);
    const n = frame.count;
    const P = frame.positions;
    const V = frame.velocities;
    if (options.particles) {
      let vmax = 1e-9;
      if (options.colorBySpeed && !frame.field) for (let i = 0; i < n; i++) vmax = Math.max(vmax, Math.hypot(V[2 * i], V[2 * i + 1]));
      for (let i = 0; i < n; i++) {
        const x = T.X(P[2 * i]);
        const y = T.Y(P[2 * i + 1]);
        if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
        const r = Math.max(0.8, frame.radii[i] * T.s);
        if (frame.field) g.fillStyle = 'rgba(255,255,255,0.55)';
        else if (options.colorBySpeed) {
          const [cr, cg, cb] = ramp(Math.hypot(V[2 * i], V[2 * i + 1]) / (0.6 * vmax));
          g.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
        } else g.fillStyle = '#9fb3c8';
        g.beginPath();
        g.arc(x, y, r, 0, 2 * Math.PI);
        g.fill();
      }
    }

    if (options.vectors) {
      const stride = Math.max(1, Math.floor(n / 700));
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      const scale = 1.5 * T.s;
      for (let i = 0; i < n; i += stride) {
        const x = T.X(P[2 * i]);
        const y = T.Y(P[2 * i + 1]);
        g.moveTo(x, y);
        g.lineTo(x + V[2 * i] * scale, y - V[2 * i + 1] * scale);
      }
      g.stroke();
    }

    if (options.collisions) {
      const C = frame.collisions;
      g.fillStyle = 'rgba(255, 196, 0, 0.9)';
      for (let k = 0; k < C.length / 2; k++) {
        g.globalAlpha = 0.25 + 0.75 * (1 - k / (C.length / 2));
        g.fillRect(T.X(C[2 * k]) - 1.5, T.Y(C[2 * k + 1]) - 1.5, 3, 3);
      }
      g.globalAlpha = 1;
    }

    const side = (s: string) => {
      g.beginPath();
      if (s === 'left' || s === 'right') {
        const x = T.X(s === 'left' ? d.xmin : d.xmax);
        g.moveTo(x, T.Y(d.ymin));
        g.lineTo(x, T.Y(d.ymax));
      } else {
        const y = T.Y(s === 'bottom' ? d.ymin : d.ymax);
        g.moveTo(T.X(d.xmin), y);
        g.lineTo(T.X(d.xmax), y);
      }
      g.stroke();
    };
    for (const wall of frame.walls) {
      const col = wall.accommodation > 0 ? `rgba(255, 150, 60, ${0.5 + 0.5 * wall.accommodation})` : '#c9d1d9';
      g.strokeStyle = col;
      g.lineWidth = 3;
      side(wall.side);
      if (wall.tangentialVelocity !== 0 && (wall.side === 'top' || wall.side === 'bottom')) {
        const y = T.Y(wall.side === 'bottom' ? d.ymin : d.ymax) + (wall.side === 'bottom' ? 14 : -8);
        g.fillStyle = col;
        g.font = '11px ui-monospace, monospace';
        g.fillText(`U = ${wall.tangentialVelocity.toPrecision(3)} →`, T.X(d.xmin) + 6, y);
      }
      for (const sg of wall.segments) {
        g.strokeStyle = `rgba(255, 150, 60, ${0.5 + 0.5 * sg.accommodation})`;
        g.lineWidth = 5;
        g.beginPath();
        if (wall.side === 'bottom' || wall.side === 'top') {
          const y = T.Y(wall.side === 'bottom' ? d.ymin : d.ymax);
          g.moveTo(T.X(sg.from), y);
          g.lineTo(T.X(sg.to), y);
        } else {
          const x = T.X(wall.side === 'left' ? d.xmin : d.xmax);
          g.moveTo(x, T.Y(sg.from));
          g.lineTo(x, T.Y(sg.to));
        }
        g.stroke();
      }
    }
    for (const b of frame.bodies ?? []) {
      const v = b.vertices;
      g.beginPath();
      g.moveTo(T.X(v[0]), T.Y(v[1]));
      for (let k = 2; k < v.length; k += 2) g.lineTo(T.X(v[k]), T.Y(v[k + 1]));
      g.closePath();
      g.fillStyle = '#2a3440';
      g.fill();
      g.strokeStyle = b.accommodation > 0 ? `rgba(255, 150, 60, ${0.5 + 0.5 * b.accommodation})` : '#c9d1d9';
      g.lineWidth = 2;
      g.stroke();
    }
    g.setLineDash([6, 4]);
    g.strokeStyle = 'rgba(88,166,255,0.8)';
    g.lineWidth = 2;
    for (const s of frame.openSides) side(s);
    g.setLineDash([4, 4]);
    g.strokeStyle = '#3b4652';
    g.lineWidth = 1;
    if (d.periodicX) ['left', 'right'].forEach(side);
    if (d.periodicY) ['bottom', 'top'].forEach(side);
    g.setLineDash([]);

    if (selected !== null && selected < n) {
      const tr = frame.inspected?.trajectory;
      if (options.trails && tr && tr.length >= 4) {
        g.strokeStyle = 'rgba(88,166,255,0.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(T.X(tr[0]), T.Y(tr[1]));
        for (let k = 2; k < tr.length; k += 2) {
          if (Math.abs(tr[k] - tr[k - 2]) > 0.5 * (d.xmax - d.xmin) || Math.abs(tr[k + 1] - tr[k - 1]) > 0.5 * (d.ymax - d.ymin)) g.moveTo(T.X(tr[k]), T.Y(tr[k + 1]));
          else g.lineTo(T.X(tr[k]), T.Y(tr[k + 1]));
        }
        g.stroke();
      }
      g.strokeStyle = '#58a6ff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(T.X(P[2 * selected]), T.Y(P[2 * selected + 1]), Math.max(4, frame.radii[selected] * T.s + 3), 0, 2 * Math.PI);
      g.stroke();
    }

    overlay?.(g, T, frame);

    // scale bar: a round number of particle diameters
    const target = 80 / T.s;
    const p10 = 10 ** Math.floor(Math.log10(target));
    const len = [1, 2, 5, 10].map((k) => k * p10).find((v) => v >= target * 0.5) ?? p10;
    g.strokeStyle = '#8b98a5';
    g.fillStyle = '#8b98a5';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(12, h - 12);
    g.lineTo(12 + len * T.s, h - 12);
    g.stroke();
    g.font = '10px ui-monospace, monospace';
    g.fillText(`${len} d`, 12, h - 17);
  }, [frame, options, selected, camera, size, ref, overlay, underlay]);

  const toDomain = (ev: { clientX: number; clientY: number }) => {
    const f = frameRef.current;
    const canvas = ref.current;
    if (!f || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const T = transformOf(f.domain, canvas.clientWidth, canvas.clientHeight, camera);
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    return { x: T.invX(px), y: T.invY(py), px, py, T };
  };

  const cam = (): Camera => {
    const d = frameRef.current!.domain;
    return camera ?? { zoom: 1, cx: (d.xmin + d.xmax) / 2, cy: (d.ymin + d.ymax) / 2 };
  };

  const onWheel = (ev: React.WheelEvent<HTMLCanvasElement>) => {
    const p = toDomain(ev);
    if (!p) return;
    const c = cam();
    const k = Math.exp(-ev.deltaY * 0.0015);
    const zoom = Math.min(200, Math.max(0.5, c.zoom * k));
    const r = zoom / c.zoom;
    // keep the domain point under the cursor fixed
    onCamera({ zoom, cx: p.x - (p.x - c.cx) / r, cy: p.y - (p.y - c.cy) / r });
  };

  const hitHandle = (ev: { clientX: number; clientY: number }): string | null => {
    const p = toDomain(ev);
    if (!p || !handles?.length) return null;
    let best: string | null = null;
    let bestD = 16;
    for (const h of handles) {
      const d = Math.hypot(p.T.X(h.x) - p.px, p.T.Y(h.y) - p.py);
      if (d <= bestD) {
        bestD = d;
        best = h.id;
      }
    }
    return best;
  };

  const onDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (!frameRef.current) return;
    const hit = hitHandle(ev);
    if (hit) {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      handleDrag.current = hit;
      return;
    }
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { x: ev.clientX, y: ev.clientY, cam: cam(), moved: false };
  };

  const onMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toDomain(ev);
    if (handleDrag.current) {
      if (p) onHandleDrag?.(handleDrag.current, p.x, p.y);
      return;
    }
    if (p) setProbe({ x: p.x, y: p.y, px: p.px, py: p.py });
    const dr = drag.current;
    if (!dr || !p) return;
    const dx = ev.clientX - dr.x;
    const dy = ev.clientY - dr.y;
    if (!dr.moved && Math.hypot(dx, dy) < 4) return;
    dr.moved = true;
    onCamera({ zoom: dr.cam.zoom, cx: dr.cam.cx - dx / p.T.s, cy: dr.cam.cy + dy / p.T.s });
  };

  const onUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (handleDrag.current) {
      handleDrag.current = null;
      return;
    }
    const dr = drag.current;
    drag.current = null;
    if (!dr || dr.moved) return;
    const f = frameRef.current;
    const p = toDomain(ev);
    if (!f || !p) return;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < f.count; i++) {
      const dd = Math.hypot(f.positions[2 * i] - p.x, f.positions[2 * i + 1] - p.y);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    onPick(best >= 0 && bestD < Math.max(0.6, 8 / p.T.s) ? best : null);
  };

  // field value under the pointer
  let readout: string | null = null;
  if (probe && frame) {
    const d = frame.domain;
    const inside = probe.x >= d.xmin && probe.x <= d.xmax && probe.y >= d.ymin && probe.y <= d.ymax;
    if (inside) {
      readout = `x ${probe.x.toFixed(2)}  y ${probe.y.toFixed(2)} d`;
      const f = frame.field;
      if (f) {
        const cx = Math.min(f.nx - 1, Math.floor(((probe.x - d.xmin) / (d.xmax - d.xmin)) * f.nx));
        const cy = Math.min(f.ny - 1, Math.floor(((probe.y - d.ymin) / (d.ymax - d.ymin)) * f.ny));
        const info = FIELD_INFO[f.kind as keyof typeof FIELD_INFO];
        readout += `  ·  ${info.symbol} = ${f.values[cy * f.nx + cx].toPrecision(4)} ${info.units}  (cell ${cx},${cy})`;
      }
    }
  }

  return (
    <div className="canvas-host">
      <canvas
        ref={ref}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setProbe(null)}
        onDoubleClick={() => onCamera(null)}
        // a touch drag scrolls the page until the view is zoomed; then it pans
        style={{ touchAction: camera ? 'none' : 'pan-y' }}
        aria-label="Particle view: wheel to zoom, drag to pan, double-click to fit, click a particle to inspect it, drag the red dot, the pointer or the green dot to move them"
      />
      {readout && <div className="probe">{readout}</div>}
    </div>
  );
}
