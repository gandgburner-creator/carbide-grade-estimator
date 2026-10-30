/**
 * THE FIELD ON THE GRAPHICS CARD (WebGL2). The CFD field of a run is a grid of a few hundred by a couple of hundred values; drawing
 * each as a coloured square (or stretching them with the browser's bilinear filter) shows the grid. This draws, for every pixel of the
 * screen:
 *   - the field interpolated with a cubic B-spline of the 4 × 4 neighbouring values (smooth, no overshoot), weighted by which of them
 *     lie in the fluid, so the colours run smoothly up to the body instead of fading out into it,
 *   - a 256-colour scale (a texture) with the range of the legend,
 *   - a faint relief shading from the local gradient of the field, which makes vortices and shear layers stand out,
 * and nothing else: the body, the streamlines and the construction are drawn over it by the caller. It only changes how a computed field
 * is DRAWN; it computes nothing.
 */
const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uField;
uniform sampler2D uLut;
uniform vec2 uDim;
uniform vec2 uCanvas;
uniform vec4 uView;
uniform vec2 uDomain;
uniform vec3 uRange;
out vec4 o;

vec4 wts(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  float s = 1.0 - t;
  return vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}

vec2 at(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uDim) - 1);
  return texelFetch(uField, p, 0).rg;
}

void main() {
  float cssX = gl_FragCoord.x / uView.w;
  float cssY = (uCanvas.y - gl_FragCoord.y) / uView.w;
  float xd = (cssX - uView.x) / uView.z;
  float yd = uDomain.y - (cssY - uView.y) / uView.z;
  if (xd < 0.0 || yd < 0.0 || xd > uDomain.x || yd > uDomain.y) discard;
  vec2 p = vec2(xd / uDomain.x * uDim.x, yd / uDomain.y * uDim.y) - 0.5;
  vec2 b = floor(p);
  vec2 f = p - b;
  vec4 wx = wts(f.x);
  vec4 wy = wts(f.y);
  float num = 0.0;
  float den = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      float w = wx[i] * wy[j];
      vec2 s = at(ivec2(b) + ivec2(i - 1, j - 1));
      num += w * s.g * s.r;
      den += w * s.g;
    }
  }
  if (den < 0.02) {
    o = vec4(0.16, 0.17, 0.2, 1.0);
    return;
  }
  float v = num / den;
  float t = clamp((v - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  vec3 c = texture(uLut, vec2((t * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  // relief: light from the upper left, from the screen-space gradient of the field in units of the colour range
  vec2 g = vec2(dFdx(t), dFdy(t));
  float relief = clamp(dot(g, vec2(-0.7071, 0.7071)) * 18.0, -1.0, 1.0);
  c *= 1.0 + uRange.z * relief;
  o = vec4(c, 1.0);
}`;

export interface GlFieldDraw {
  nx: number;
  ny: number;
  values: ArrayLike<number>;
  lut: Uint8Array;
  lo: number;
  hi: number;
  /** the domain in plate units, where its top-left corner is on screen and how many screen pixels (CSS) a plate unit is */
  domain: { w: number; h: number };
  x0: number;
  y0: number;
  scale: number;
  /** the size of the view in CSS pixels, and the device pixel ratio */
  cssW: number;
  cssH: number;
  dpr: number;
  /** strength of the relief shading (0 = none) */
  shade: number;
}

export class FieldGL {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private fieldTex: WebGLTexture | null = null;
  private lutTex: WebGLTexture | null = null;
  private uploaded: { values: ArrayLike<number>; nx: number; ny: number } | null = null;
  private lutKey: Uint8Array | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  /** WebGL runs on the processor (no graphics card): the sixteen-tap shader would take seconds a frame, so the 2-D canvas draws the field instead */
  private software = false;
  private slow = false;
  private timed = 0;
  private timedMs = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    try {
      this.gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    } catch {
      this.gl = null;
    }
    if (this.gl) {
      try {
        this.init(this.gl);
        const info = this.gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = info ? String(this.gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
        const forced = typeof location !== 'undefined' && /[?&]gl=1\b/.test(location.search);
        this.software = !forced && /swiftshader|llvmpipe|software|basic render/i.test(renderer);
      } catch {
        this.gl = null;
      }
    }
  }

  get ok(): boolean {
    return this.gl !== null && !this.software && !this.slow;
  }

  private init(gl: WebGL2RenderingContext) {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['uField', 'uLut', 'uDim', 'uCanvas', 'uView', 'uDomain', 'uRange']) this.loc[n] = gl.getUniformLocation(p, n);
    this.fieldTex = gl.createTexture();
    this.lutTex = gl.createTexture();
  }

  /** Draw the field; returns false when there is no WebGL2 (the caller draws it itself). */
  render(d: GlFieldDraw): boolean {
    const gl = this.gl;
    if (!gl || !this.prog || gl.isContextLost()) return false;
    const W = Math.max(1, Math.round(d.cssW * d.dpr));
    const H = Math.max(1, Math.round(d.cssH * d.dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.uploaded || this.uploaded.values !== d.values || this.uploaded.nx !== d.nx || this.uploaded.ny !== d.ny) {
      const data = new Float32Array(d.nx * d.ny * 2);
      for (let i = 0; i < d.nx * d.ny; i++) {
        const v = d.values[i];
        const fin = Number.isFinite(v);
        data[2 * i] = fin ? v : 0;
        data[2 * i + 1] = fin ? 1 : 0;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, d.nx, d.ny, 0, gl.RG, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.uploaded = { values: d.values, nx: d.nx, ny: d.ny };
    }
    if (this.lutKey !== d.lut) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.lut);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.lutKey = d.lut;
    }
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(this.loc.uField, 0);
    gl.uniform1i(this.loc.uLut, 1);
    gl.uniform2f(this.loc.uDim, d.nx, d.ny);
    gl.uniform2f(this.loc.uCanvas, W, H);
    gl.uniform4f(this.loc.uView, d.x0, d.y0, d.scale, d.dpr);
    gl.uniform2f(this.loc.uDomain, d.domain.w, d.domain.h);
    gl.uniform3f(this.loc.uRange, d.lo, d.hi === d.lo ? d.lo + 1 : d.hi, d.shade);
    const t0 = performance.now();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // the first few frames are timed: a card that needs more than 80 ms a frame hands the drawing back to the 2-D canvas
    if (this.timed < 4 && !(typeof location !== 'undefined' && /[?&]gl=1\b/.test(location.search))) {
      gl.finish();
      this.timedMs += performance.now() - t0;
      if (++this.timed === 4 && this.timedMs / 4 > 80) this.slow = true;
    }
    return true;
  }
}
