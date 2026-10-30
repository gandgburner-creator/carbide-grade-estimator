import { useEffect, useRef, useState } from 'react';
import { CFD_FIELD_LABEL, robustRange } from '../../cfd/CfdFields';
import type { CfdViewKind } from '../../workers/cfdProtocol';
import { cfdScale } from './cfdPalette';
import type { GridField } from '../../measurements/Streamlines';
import { FieldGL } from './FieldGL';
import { Tracers } from './Tracers';
import { transformOf, type Camera, type ViewHandle } from '../ParticleView';

type T = ReturnType<typeof transformOf>;

/**
 * The CFD field on its domain (plate units), with the body and the construction drawn over it. The pointer and wheel move and
 * zoom the camera; the overlay is drawn by the caller in plate units.
 */
export function CfdView({
  field,
  kind,
  domain,
  camera,
  onCamera,
  overlay,
  caption,
  handles,
  onHandleDrag,
  tracers,
}: {
  field: { nx: number; ny: number; values: ArrayLike<number> } | null;
  kind: CfdViewKind;
  domain: { w: number; h: number };
  camera: Camera | null;
  onCamera: (c: Camera | null) => void;
  overlay: (g: CanvasRenderingContext2D, T: T) => void;
  caption: string;
  /** points the person can pick up and drag (plate units in the domain); a drag reports where the point was dropped to, and the view does not pan meanwhile */
  handles?: ViewHandle[];
  onHandleDrag?: (id: string, x: number, y: number) => void;
  /** a velocity field (units of the free-stream speed) to carry animated tracer points, or null for none */
  tracers?: GridField | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const gpuField = useRef<FieldGL | null>(null);
  const drag = useRef<{ x: number; y: number; cam: Camera } | null>(null);
  const handleDrag = useRef<string | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const canvas = ref.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const T = transformOf({ xmin: 0, xmax: domain.w, ymin: 0, ymax: domain.h } as Parameters<typeof transformOf>[0], canvas.clientWidth, canvas.clientHeight, camera ?? { zoom: 1, cx: domain.w / 2, cy: domain.h / 2 });
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { T, px, py, x: T.invX(px), y: T.invY(py) };
  };
  const trRef = useRef<HTMLCanvasElement>(null);
  const tracerSys = useRef<Tracers | null>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ro = new ResizeObserver(() => setSize((s) => s + 1));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  const range = field ? robustRange(field.values, kind) : { lo: 0, hi: 1, signed: false };
  const sc = cfdScale(range.lo, range.hi, range.signed);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
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
    const d = { xmin: 0, xmax: domain.w, ymin: 0, ymax: domain.h };
    const T = transformOf(d as Parameters<typeof transformOf>[0], w, h, camera);
    g.fillStyle = '#10151b';
    g.fillRect(T.X(0), T.Y(domain.h), domain.w * T.s, domain.h * T.s);
    if (field) {
      // the field is drawn by the graphics card (cubic interpolation, colour scale, relief); the 2-D canvas draws it itself where there is no WebGL2
      let drawn = false;
      if (!gpuField.current) gpuField.current = new FieldGL();
      if (gpuField.current.ok) {
        drawn = gpuField.current.render({ nx: field.nx, ny: field.ny, values: field.values, lut: sc.lut, lo: sc.lo, hi: sc.hi, domain, x0: T.X(0), y0: T.Y(domain.h), scale: T.s, cssW: w, cssH: h, dpr, shade: kind === 'speed' ? 0.12 : 0.28 });
        if (drawn) g.drawImage(gpuField.current.canvas, 0, 0, w, h);
      }
      if (!drawn) {
        let o = off.current;
        if (!o) o = off.current = document.createElement('canvas');
        o.width = field.nx;
        o.height = field.ny;
        const og = o.getContext('2d')!;
        const img = og.createImageData(field.nx, field.ny);
        for (let j = 0; j < field.ny; j++)
          for (let i = 0; i < field.nx; i++) {
            const v = field.values[j * field.nx + i];
            const p = ((field.ny - 1 - j) * field.nx + i) * 4;
            if (!Number.isFinite(v)) {
              img.data[p] = 40;
              img.data[p + 1] = 44;
              img.data[p + 2] = 50;
              img.data[p + 3] = 255;
              continue;
            }
            const [r, gg, b] = sc.color(v);
            img.data[p] = r;
            img.data[p + 1] = gg;
            img.data[p + 2] = b;
            img.data[p + 3] = 255;
          }
        og.putImageData(img, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(o, T.X(0), T.Y(domain.h), domain.w * T.s, domain.h * T.s);
      }
    }
    g.strokeStyle = '#2a333d';
    g.lineWidth = 1;
    g.strokeRect(T.X(0), T.Y(domain.h), domain.w * T.s, domain.h * T.s);
    overlay(g, T);
  });
  void size;

  const haveTracers = !!tracers;
  // the animated tracers live on a canvas of their own over the field: a frame fades the trails a little and adds this frame's steps
  useEffect(() => {
    const c = trRef.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (!haveTracers || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    if (!tracerSys.current) tracerSys.current = new Tracers();
    let raf = 0;
    const frame = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const T = transformOf({ xmin: 0, xmax: domain.w, ymin: 0, ymax: domain.h } as Parameters<typeof transformOf>[0], w, h, camera);
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.09)';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      tracerSys.current!.tick();
      tracerSys.current!.draw(g, (x) => T.X(x), (y) => T.Y(y));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [haveTracers, domain.w, domain.h, camera?.zoom, camera?.cx, camera?.cy, size]);
  // a new velocity field (a frame of a run in progress) replaces the one the tracers ride on; the tracers and their trails stay
  useEffect(() => {
    if (!tracerSys.current) tracerSys.current = new Tracers();
    tracerSys.current.setField(tracers ?? null, domain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracers, domain.w, domain.h]);

  const info = CFD_FIELD_LABEL[kind];
  return (
    <div className="view-wrap" style={{ position: 'relative' }}>
      <canvas
        ref={ref}
        className="particle-canvas"
        aria-label="CFD field view"
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
        onWheel={(e) => {
          e.preventDefault();
          const cur = camera ?? { zoom: 1, cx: domain.w / 2, cy: domain.h / 2 };
          onCamera({ ...cur, zoom: Math.min(40, Math.max(1, cur.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) });
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = at(e);
          if (p && handles?.length) {
            let best: string | null = null;
            let bestD = 16;
            for (const h of handles) {
              const d = Math.hypot(p.T.X(h.x) - p.px, p.T.Y(h.y) - p.py);
              if (d <= bestD) {
                bestD = d;
                best = h.id;
              }
            }
            if (best) {
              handleDrag.current = best;
              return;
            }
          }
          drag.current = { x: e.clientX, y: e.clientY, cam: camera ?? { zoom: 1, cx: domain.w / 2, cy: domain.h / 2 } };
        }}
        onPointerMove={(e) => {
          if (handleDrag.current) {
            const p = at(e);
            if (p) onHandleDrag?.(handleDrag.current, p.x, p.y);
            return;
          }
          const d0 = drag.current;
          const canvas = ref.current;
          if (!d0 || !canvas) return;
          const T = transformOf({ xmin: 0, xmax: domain.w, ymin: 0, ymax: domain.h } as Parameters<typeof transformOf>[0], canvas.clientWidth, canvas.clientHeight, d0.cam);
          onCamera({ ...d0.cam, cx: d0.cam.cx - (e.clientX - d0.x) / T.s, cy: d0.cam.cy + (e.clientY - d0.y) / T.s });
        }}
        onPointerUp={() => {
          handleDrag.current = null;
          drag.current = null;
        }}
      />
      <canvas ref={trRef} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      <div className="legend" style={{ maxWidth: 'min(660px, 82%)' }}>
        <div>{caption}</div>
        <div className="legend-scale" style={{ marginTop: 4 }}>
          <span>{sc.lo.toPrecision(3)}</span>
          <div className="bar" style={{ background: sc.css }} />
          <span>{sc.hi.toPrecision(3)}</span>
          <span className="muted">
            {info.label} [{info.units}]
          </span>
        </div>
      </div>
    </div>
  );
}
