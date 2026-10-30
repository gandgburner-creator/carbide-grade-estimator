import type { GridField } from '../../measurements/Streamlines';

/**
 * ANIMATED TRACERS: a few thousand massless marker points carried by the computed velocity field, drawn with fading trails, so the
 * direction and the speed of the flow can be seen moving. They are advected with the velocity that is on screen (the time-mean field of a
 * finished run, the instantaneous field of a run in progress) and are only a picture of it: they measure nothing and feed nothing back.
 * A tracer that reaches the body or leaves the domain is reborn at a random place.
 */
export class Tracers {
  private readonly n: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly age: Int16Array;
  private field: GridField | null = null;
  private w = 1;
  private h = 1;
  /** plate units a tracer travels per frame at the free-stream speed */
  speed = 1.2;

  constructor(count = 2200) {
    this.n = count;
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.age = new Int16Array(count);
  }

  setField(f: GridField | null, domain: { w: number; h: number }) {
    const first = this.field === null;
    this.field = f;
    this.w = domain.w;
    this.h = domain.h;
    if (first && f) for (let i = 0; i < this.n; i++) this.reseed(i, true);
  }

  private reseed(i: number, anywhere: boolean) {
    const f = this.field;
    for (let tries = 0; tries < 8; tries++) {
      this.x[i] = anywhere ? Math.random() * this.w : Math.random() * this.w * 0.12;
      this.y[i] = Math.random() * this.h;
      if (!f || this.sample(this.x[i], this.y[i]) !== null) break;
    }
    this.px[i] = this.x[i];
    this.py[i] = this.y[i];
    this.age[i] = Math.floor(Math.random() * 120);
  }

  /** the velocity (units of U) at a point, or null inside the body or outside the field */
  private sample(x: number, y: number): [number, number] | null {
    const f = this.field;
    if (!f) return null;
    const gx = (x - f.x0) / f.cw - 0.5;
    const gy = (y - f.y0) / f.ch - 0.5;
    if (gx < -0.5 || gy < -0.5 || gx > f.nx - 0.5 || gy > f.ny - 0.5) return null;
    const i0 = Math.min(f.nx - 2, Math.max(0, Math.floor(gx)));
    const j0 = Math.min(f.ny - 2, Math.max(0, Math.floor(gy)));
    const tx = Math.min(1, Math.max(0, gx - i0));
    const ty = Math.min(1, Math.max(0, gy - j0));
    // the nearest cell decides whether the point is in the body
    const ni = Math.min(f.nx - 1, Math.max(0, Math.round(gx)));
    const nj = Math.min(f.ny - 1, Math.max(0, Math.round(gy)));
    if (f.valid && !f.valid[nj * f.nx + ni]) return null;
    let u = 0;
    let v = 0;
    let wsum = 0;
    for (let dj = 0; dj < 2; dj++)
      for (let di = 0; di < 2; di++) {
        const k = (j0 + dj) * f.nx + (i0 + di);
        if (f.valid && !f.valid[k]) continue;
        const w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty);
        u += w * f.ux[k];
        v += w * f.uy[k];
        wsum += w;
      }
    return wsum > 0 ? [u / wsum, v / wsum] : null;
  }

  /** Advance every tracer one frame. */
  tick() {
    if (!this.field) return;
    for (let i = 0; i < this.n; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      const s = this.sample(this.x[i], this.y[i]);
      if (!s || ++this.age[i] > 260) {
        this.reseed(i, false);
        continue;
      }
      this.x[i] += s[0] * this.speed;
      this.y[i] += s[1] * this.speed;
      if (this.x[i] < 0 || this.x[i] > this.w || this.y[i] < 0 || this.y[i] > this.h) this.reseed(i, false);
    }
  }

  /** Draw the trails of this frame: segments from where each tracer was to where it is, in three brightness classes by speed. */
  draw(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number) {
    const f = this.field;
    if (!f) return;
    const bins: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - this.px[i];
      const dy = this.y[i] - this.py[i];
      const s = Math.hypot(dx, dy) / this.speed;
      if (!(s > 0.02) || Math.abs(dx) > this.w / 2) continue;
      const b = bins[s < 0.6 ? 0 : s < 1.15 ? 1 : 2];
      b.moveTo(X(this.px[i]), Y(this.py[i]));
      b.lineTo(X(this.x[i]), Y(this.y[i]));
    }
    g.lineWidth = 1.1;
    g.lineCap = 'round';
    const colors = ['rgba(140,190,255,0.55)', 'rgba(215,235,255,0.7)', 'rgba(255,245,215,0.85)'];
    bins.forEach((p, k) => {
      g.strokeStyle = colors[k];
      g.stroke(p);
    });
  }
}
