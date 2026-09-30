/**
 * Minimal 2D vector helpers for non-hot code paths (setup, analysis, geometry).
 *
 * Hot loops (collision detection, integration) operate directly on the typed
 * arrays in ParticleStore and do not allocate Vector2 objects.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** z-component of the 3D cross product of (a,0) and (b,0). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const length = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  if (l === 0) throw new Error('normalize: zero-length vector');
  return { x: a.x / l, y: a.y / l };
}

/** Rotate a vector counter-clockwise by `angle` radians. */
export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * a.x - s * a.y, y: s * a.x + c * a.y };
}

/** Left-hand perpendicular (counter-clockwise by 90°). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
