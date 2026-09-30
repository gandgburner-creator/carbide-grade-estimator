import { useEffect, useRef } from 'react';
import type { Frame } from '../workers/protocol';

export interface ViewOptions {
  vectors: boolean;
  collisions: boolean;
  trails: boolean;
  colorBySpeed: boolean;
}

interface Props {
  frame: Frame | null;
  options: ViewOptions;
  selected: number | null;
  onPick: (index: number | null) => void;
}

/** Perceptually ordered colour ramp (approximate viridis), t ∈ [0, 1]. */
export function ramp(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])];
}

function transform(frame: Frame, w: number, h: number) {
  const d = frame.domain;
  const pad = 14;
  const sx = (w - 2 * pad) / (d.xmax - d.xmin);
  const sy = (h - 2 * pad) / (d.ymax - d.ymin);
  const s = Math.min(sx, sy);
  const ox = (w - s * (d.xmax - d.xmin)) / 2;
  const oy = (h - s * (d.ymax - d.ymin)) / 2;
  return {
    s,
    X: (x: number) => ox + (x - d.xmin) * s,
    Y: (y: number) => h - oy - (y - d.ymin) * s, // y up
    invX: (px: number) => d.xmin + (px - ox) / s,
    invY: (py: number) => d.ymin + (h - oy - py) / s,
  };
}

export function ParticleView({ frame, options, selected, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<Frame | null>(null);
  frameRef.current = frame;

  useEffect(() => {
    const canvas = canvasRef.current;
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
    const T = transform(frame, w, h);
    const d = frame.domain;

    // domain background
    g.fillStyle = '#10151b';
    g.fillRect(T.X(d.xmin), T.Y(d.ymax), (d.xmax - d.xmin) * T.s, (d.ymax - d.ymin) * T.s);

    // field overlay
    if (frame.field) {
      const f = frame.field;
      const cw = ((d.xmax - d.xmin) / f.nx) * T.s;
      const ch = ((d.ymax - d.ymin) / f.ny) * T.s;
      const span = f.max - f.min || 1;
      for (let cy = 0; cy < f.ny; cy++) {
        for (let cx = 0; cx < f.nx; cx++) {
          const v = f.values[cy * f.nx + cx];
          const [r, gg, b] = ramp((v - f.min) / span);
          g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
          g.fillRect(T.X(d.xmin) + cx * cw, T.Y(d.ymin) - (cy + 1) * ch, cw + 0.6, ch + 0.6);
        }
      }
    }

    // particles
    const n = frame.count;
    const P = frame.positions;
    const V = frame.velocities;
    let vmax = 1e-9;
    if (options.colorBySpeed && !frame.field) {
      for (let i = 0; i < n; i++) vmax = Math.max(vmax, Math.hypot(V[2 * i], V[2 * i + 1]));
    }
    for (let i = 0; i < n; i++) {
      const r = Math.max(0.8, frame.radii[i] * T.s);
      if (frame.field) g.fillStyle = 'rgba(255,255,255,0.55)';
      else if (options.colorBySpeed) {
        const [cr, cg, cb] = ramp(Math.hypot(V[2 * i], V[2 * i + 1]) / (0.6 * vmax));
        g.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`;
      } else g.fillStyle = '#9fb3c8';
      g.beginPath();
      g.arc(T.X(P[2 * i]), T.Y(P[2 * i + 1]), r, 0, 2 * Math.PI);
      g.fill();
    }

    // velocity vectors (subsample)
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

    // recent collisions
    if (options.collisions) {
      const C = frame.collisions;
      g.fillStyle = 'rgba(255, 196, 0, 0.9)';
      for (let k = 0; k < C.length / 2; k++) {
        const a = 1 - k / (C.length / 2);
        g.globalAlpha = 0.25 + 0.75 * a;
        g.fillRect(T.X(C[2 * k]) - 1.5, T.Y(C[2 * k + 1]) - 1.5, 3, 3);
      }
      g.globalAlpha = 1;
    }

    // walls
    for (const wall of frame.walls) {
      const col = wall.accommodation > 0 ? `rgba(255, 150, 60, ${0.5 + 0.5 * wall.accommodation})` : '#c9d1d9';
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      if (wall.side === 'left' || wall.side === 'right') {
        const x = T.X(wall.side === 'left' ? d.xmin : d.xmax);
        g.moveTo(x, T.Y(d.ymin));
        g.lineTo(x, T.Y(d.ymax));
      } else {
        const y = T.Y(wall.side === 'bottom' ? d.ymin : d.ymax);
        g.moveTo(T.X(d.xmin), y);
        g.lineTo(T.X(d.xmax), y);
      }
      g.stroke();
      if (wall.tangentialVelocity !== 0 && (wall.side === 'top' || wall.side === 'bottom')) {
        const y = T.Y(wall.side === 'bottom' ? d.ymin : d.ymax) + (wall.side === 'bottom' ? 12 : -12);
        g.fillStyle = col;
        g.font = '11px monospace';
        g.fillText(`U = ${wall.tangentialVelocity} →`, T.X(d.xmin) + 6, y + 4);
      }
    }
    // periodic boundaries drawn dashed
    g.setLineDash([4, 4]);
    g.strokeStyle = '#3b4652';
    g.lineWidth = 1;
    if (d.periodicX) {
      for (const x of [d.xmin, d.xmax]) {
        g.beginPath();
        g.moveTo(T.X(x), T.Y(d.ymin));
        g.lineTo(T.X(x), T.Y(d.ymax));
        g.stroke();
      }
    }
    if (d.periodicY) {
      for (const y of [d.ymin, d.ymax]) {
        g.beginPath();
        g.moveTo(T.X(d.xmin), T.Y(y));
        g.lineTo(T.X(d.xmax), T.Y(y));
        g.stroke();
      }
    }
    g.setLineDash([]);

    // selected particle + trajectory
    if (selected !== null && selected < n) {
      const tr = frame.inspected?.trajectory;
      if (options.trails && tr && tr.length >= 4) {
        g.strokeStyle = 'rgba(88,166,255,0.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(T.X(tr[0]), T.Y(tr[1]));
        for (let k = 2; k < tr.length; k += 2) {
          // break the line across periodic wraps
          if (Math.abs(tr[k] - tr[k - 2]) > 0.5 * (d.xmax - d.xmin) || Math.abs(tr[k + 1] - tr[k - 1]) > 0.5 * (d.ymax - d.ymin)) {
            g.moveTo(T.X(tr[k]), T.Y(tr[k + 1]));
          } else g.lineTo(T.X(tr[k]), T.Y(tr[k + 1]));
        }
        g.stroke();
      }
      g.strokeStyle = '#58a6ff';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(T.X(P[2 * selected]), T.Y(P[2 * selected + 1]), Math.max(4, frame.radii[selected] * T.s + 3), 0, 2 * Math.PI);
      g.stroke();
    }
  }, [frame, options, selected]);

  const onClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const f = frameRef.current;
    const canvas = canvasRef.current;
    if (!f || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const T = transform(f, canvas.clientWidth, canvas.clientHeight);
    const x = T.invX(ev.clientX - rect.left);
    const y = T.invY(ev.clientY - rect.top);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < f.count; i++) {
      const dd = Math.hypot(f.positions[2 * i] - x, f.positions[2 * i + 1] - y);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    onPick(best >= 0 && bestD < Math.max(3, 6 / T.s) ? best : null);
  };

  return (
    <div className="canvas-host">
      <canvas ref={canvasRef} onClick={onClick} aria-label="Particle view" />
    </div>
  );
}
