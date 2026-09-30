import type { DomainSpec } from '../core/Domain';
import { ParticleStore } from '../core/ParticleStore';
import { Rng, RNG_STREAM } from '../core/Random';

/**
 * Initial-condition generators. All randomness comes from the experiment seed
 * via fixed RNG streams, so a stored configuration regenerates the same gas.
 *
 * Velocity distributions (documented per Master prompt §9):
 *  'maxwell'       v_x, v_y ~ N(0, kT/m) independently (2D Maxwell–Boltzmann)
 *  'uniform-speed' |v| = sqrt(2kT/m), direction uniform — far from equilibrium
 *  'uniform-box'   v_x, v_y ~ U(−a, a), a = sqrt(3kT/m)  (same ⟨v_x²⟩ as Maxwell)
 *  'two-beam'      half the particles at +sqrt(2kT/m) x̂, half at −sqrt(2kT/m) x̂
 *                  — maximally anisotropic
 *
 * Optional post-processing (each recorded in the returned info):
 *  removeDrift : subtract the mass-weighted mean velocity (zero net momentum)
 *  exactKT     : rescale velocities so that KE/N = kT exactly at t = 0
 *                (a one-time initialisation choice, NOT a thermostat)
 *  flow        : add a uniform mean velocity afterwards (for flow experiments)
 *
 * Positions: 'random' = random sequential addition without overlap, keeping
 * every disk fully inside bounded axes; 'lattice' = square lattice with small
 * random jitter, for dense packings where random addition would jam.
 */
export type VelocityDistribution = 'maxwell' | 'uniform-speed' | 'uniform-box' | 'two-beam';
export type Placement = 'random' | 'lattice';

export interface Region {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface GasInit {
  count: number;
  radius: number;
  mass: number;
  kT: number;
  distribution: VelocityDistribution;
  seed: number;
  domain: DomainSpec;
  /** sub-region to fill (defaults to the whole domain) */
  region?: Region;
  placement?: Placement;
  removeDrift?: boolean;
  exactKT?: boolean;
  flow?: { x: number; y: number };
  /** extra capacity to reserve (e.g. for particles injected later) */
  extraCapacity?: number;
}

export interface GasInitInfo {
  count: number;
  areaFraction: number;
  numberDensity: number;
  kTInitial: number;
  placementAttempts: number;
  placement: Placement;
  distribution: VelocityDistribution;
  removeDrift: boolean;
  exactKT: boolean;
}

export function createGas(init: GasInit, into?: ParticleStore): { store: ParticleStore; info: GasInitInfo } {
  const store = into ?? new ParticleStore(init.count + (init.extraCapacity ?? 0));
  const first = store.count;
  const placement = init.placement ?? 'random';
  const attempts =
    placement === 'random' ? placeRandom(store, init) : placeLattice(store, init);
  assignVelocities(store, first, init);
  const region = init.region ?? init.domain;
  const area = (region.xmax - region.xmin) * (region.ymax - region.ymin);
  let pa = 0;
  let ke = 0;
  for (let i = first; i < store.count; i++) {
    pa += Math.PI * store.radius[i] * store.radius[i];
    ke += 0.5 * store.mass[i] * (store.vx[i] ** 2 + store.vy[i] ** 2);
  }
  return {
    store,
    info: {
      count: init.count,
      areaFraction: pa / area,
      numberDensity: init.count / area,
      kTInitial: ke / init.count,
      placementAttempts: attempts,
      placement,
      distribution: init.distribution,
      removeDrift: init.removeDrift ?? true,
      exactKT: init.exactKT ?? true,
    },
  };
}

function bounds(init: GasInit) {
  const d = init.domain;
  const reg = init.region ?? d;
  const r = init.radius;
  // keep disks entirely inside the region on bounded axes (and inside the domain walls)
  const padX = d.periodicX && !init.region ? 0 : r;
  const padY = d.periodicY && !init.region ? 0 : r;
  return {
    x0: reg.xmin + padX,
    x1: reg.xmax - padX,
    y0: reg.ymin + padY,
    y1: reg.ymax - padY,
  };
}

function placeRandom(store: ParticleStore, init: GasInit): number {
  const rng = new Rng(init.seed, RNG_STREAM.positions);
  const d = init.domain;
  const r = init.radius;
  const { x0, x1, y0, y1 } = bounds(init);
  if (!(x1 > x0 && y1 > y0)) throw new Error('region too small for the particle radius');
  const cell = 2 * r;
  const W = d.xmax - d.xmin;
  const H = d.ymax - d.ymin;
  const nx = Math.max(1, Math.floor(W / cell));
  const ny = Math.max(1, Math.floor(H / cell));
  const cw = W / nx;
  const ch = H / ny;
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cy * nx + cx;
  // existing particles block placement too
  const cellOf = (x: number, y: number) => [
    Math.min(nx - 1, Math.max(0, Math.floor((x - d.xmin) / cw))),
    Math.min(ny - 1, Math.max(0, Math.floor((y - d.ymin) / ch))),
  ];
  for (let i = 0; i < store.count; i++) {
    const [cx, cy] = cellOf(store.x[i], store.y[i]);
    const k = key(cx, cy);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(i);
  }
  const imageDx = (dx: number) => (d.periodicX ? dx - W * Math.round(dx / W) : dx);
  const imageDy = (dy: number) => (d.periodicY ? dy - H * Math.round(dy / H) : dy);
  const reach = Math.ceil((r + Math.max(r, store.maxRadius())) / Math.min(cw, ch));
  const maxAttempts = 2000 * init.count + 10000;
  let attempts = 0;
  let placed = 0;
  while (placed < init.count) {
    if (++attempts > maxAttempts) {
      throw new Error(
        `random placement jammed after ${attempts} attempts (${placed}/${init.count} placed); use placement 'lattice'`,
      );
    }
    const x = rng.uniform(x0, x1);
    const y = rng.uniform(y0, y1);
    const [cx, cy] = cellOf(x, y);
    let ok = true;
    for (let oy = -reach; oy <= reach && ok; oy++) {
      for (let ox = -reach; ox <= reach && ok; ox++) {
        let qx = cx + ox;
        let qy = cy + oy;
        if (qx < 0 || qx >= nx) {
          if (!d.periodicX) continue;
          qx = (qx + nx) % nx;
        }
        if (qy < 0 || qy >= ny) {
          if (!d.periodicY) continue;
          qy = (qy + ny) % ny;
        }
        const list = cells.get(key(qx, qy));
        if (!list) continue;
        for (const j of list) {
          const dx = imageDx(x - store.x[j]);
          const dy = imageDy(y - store.y[j]);
          const R = r + store.radius[j];
          if (dx * dx + dy * dy < R * R) {
            ok = false;
            break;
          }
        }
      }
    }
    if (!ok) continue;
    const i = store.add({ x, y, vx: 0, vy: 0, mass: init.mass, radius: r });
    const k = key(cx, cy);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(i);
    placed++;
  }
  return attempts;
}

function placeLattice(store: ParticleStore, init: GasInit): number {
  const rng = new Rng(init.seed, RNG_STREAM.positions);
  const { x0, x1, y0, y1 } = bounds(init);
  const w = x1 - x0;
  const h = y1 - y0;
  const aspect = w / h;
  let ncol = Math.max(1, Math.ceil(Math.sqrt(init.count * aspect)));
  let nrow = Math.ceil(init.count / ncol);
  while (nrow * ncol < init.count) nrow++;
  const sx = w / ncol;
  const sy = h / nrow;
  const r = init.radius;
  if (sx < 2 * r || sy < 2 * r) throw new Error('lattice spacing smaller than particle diameter');
  const jitX = Math.max(0, (sx - 2 * r) / 2) * 0.9;
  const jitY = Math.max(0, (sy - 2 * r) / 2) * 0.9;
  let placed = 0;
  for (let row = 0; row < nrow && placed < init.count; row++) {
    for (let col = 0; col < ncol && placed < init.count; col++) {
      const x = x0 + (col + 0.5) * sx + rng.uniform(-jitX, jitX);
      const y = y0 + (row + 0.5) * sy + rng.uniform(-jitY, jitY);
      store.add({ x, y, vx: 0, vy: 0, mass: init.mass, radius: r });
      placed++;
    }
  }
  return placed;
}

function assignVelocities(store: ParticleStore, first: number, init: GasInit): void {
  const rng = new Rng(init.seed, RNG_STREAM.velocities);
  const m = init.mass;
  const kT = init.kT;
  const n = store.count - first;
  for (let k = 0; k < n; k++) {
    const i = first + k;
    let vx = 0;
    let vy = 0;
    switch (init.distribution) {
      case 'maxwell': {
        const s = Math.sqrt(kT / m);
        vx = s * rng.gaussian();
        vy = s * rng.gaussian();
        break;
      }
      case 'uniform-speed': {
        const v = Math.sqrt((2 * kT) / m);
        const a = 2 * Math.PI * rng.next();
        vx = v * Math.cos(a);
        vy = v * Math.sin(a);
        break;
      }
      case 'uniform-box': {
        const a = Math.sqrt((3 * kT) / m);
        vx = rng.uniform(-a, a);
        vy = rng.uniform(-a, a);
        break;
      }
      case 'two-beam': {
        const v = Math.sqrt((2 * kT) / m);
        vx = k % 2 === 0 ? v : -v;
        vy = 0;
        break;
      }
    }
    store.vx[i] = vx;
    store.vy[i] = vy;
  }
  if (init.removeDrift ?? true) {
    let px = 0;
    let py = 0;
    let M = 0;
    for (let i = first; i < store.count; i++) {
      px += store.mass[i] * store.vx[i];
      py += store.mass[i] * store.vy[i];
      M += store.mass[i];
    }
    for (let i = first; i < store.count; i++) {
      store.vx[i] -= px / M;
      store.vy[i] -= py / M;
    }
  }
  if ((init.exactKT ?? true) && n > 0 && kT > 0) {
    let ke = 0;
    for (let i = first; i < store.count; i++) ke += 0.5 * store.mass[i] * (store.vx[i] ** 2 + store.vy[i] ** 2);
    const f = Math.sqrt((kT * n) / ke);
    for (let i = first; i < store.count; i++) {
      store.vx[i] *= f;
      store.vy[i] *= f;
    }
  }
  if (init.flow) {
    for (let i = first; i < store.count; i++) {
      store.vx[i] += init.flow.x;
      store.vy[i] += init.flow.y;
    }
  }
}

/** Side length of a square box holding `count` disks of `radius` at area fraction `phi`. */
export function squareBoxSide(count: number, radius: number, phi: number): number {
  return Math.sqrt((count * Math.PI * radius * radius) / phi);
}
