/**
 * LATTICE BOLTZMANN SOLVER (conventional CFD, D2Q9, two-relaxation-time collision).
 *
 * This is the engine of the CFD workspace ("flow-guided geometry B"). It is a separate, conventional solver of the
 * incompressible Navier–Stokes equations (to second order in the Mach number) and has nothing to do with the particle
 * engine: no particle, no model unit, no Universe. It solves for the density ρ and velocity u of a continuum fluid on a
 * square lattice (Δx = Δt = 1, sound speed c_s² = 1/3, kinematic viscosity ν = (τ − ½)/3).
 *
 *   collision   f_i ← f_i − ω⁺ (f_i⁺ − f_i^eq⁺) − ω⁻ (f_i⁻ − f_i^eq⁻),   f⁺ = (f_i + f_ī)/2, f⁻ = (f_i − f_ī)/2,
 *               ω⁺ = 1/τ, and ω⁻ from Λ = (1/ω⁺ − ½)(1/ω⁻ − ½) = 3/16 (the value that makes the bounce-back wall sit where it
 *               is drawn and keeps the solution independent of τ to leading order)
 *   walls       no-slip, by bounce-back with the linear interpolation of Bouzidi, Firdaouss and Lallemand (2001) so that
 *               a curved or tilted wall sits where the geometry puts it (the fraction q of each wall link is computed
 *               from the polygon, see Raster.ts) instead of on the staircase of the lattice
 *   force       momentum exchange: every wall link hands the body c_k (f*_k + f_k̄) per step (f* post-collision)
 *   boundaries  left: equilibrium inflow at the free-stream velocity; right: zero-gradient outflow; top and bottom: slip
 *               (specular) walls — or all periodic, for the channel test
 *
 * Nothing is imposed that decides the physics of a body in the flow: no Kutta condition, no circulation, no separation
 * point. Whatever the flow does around a body, it does because the equations say so; where the numerical result is
 * trustworthy is limited by the resolution (see docs/FLOW_GUIDED_GEOMETRY.md: it is validated on the cases in
 * tests/cfd.lbm.test.ts and on nothing else).
 */
export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1];
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
export const WGT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
/** opposite direction */
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
/** the direction with c_y reversed (specular reflection at a slip wall) */
const FLIPY = [0, 1, 4, 3, 2, 8, 7, 6, 5];

export interface LbmConfig {
  nx: number;
  ny: number;
  /** relaxation time τ > ½; ν = (τ − ½) / 3 */
  tau: number;
  /** free-stream velocity (lattice units; keep below about 0.15) */
  uIn: number;
  /** 1 = solid; the default is no solid */
  solid?: Uint8Array;
  /** per node and direction k: fraction q ∈ (0, 1] of the link from this fluid node to its solid neighbour (node + c_k) at which the wall lies; 0 = not a wall link. Index k·N + n */
  wallQ?: Float32Array;
  xMode?: 'open' | 'periodic';
  yMode?: 'slip' | 'periodic';
  /** constant body force per unit mass (the channel test) */
  bodyForce?: [number, number];
  /** start from rest instead of the free stream */
  rest?: boolean;
  /** steps over which the inflow velocity is raised smoothly from 0 to uIn (0 = at once); the fluid then starts at rest */
  rampSteps?: number;
  /** the TRT "magic" parameter Λ (default 3/16) */
  magic?: number;
  /** Smagorinsky constant Cs of a sub-grid eddy viscosity (0 or absent: none, i.e. direct simulation) */
  smagorinsky?: number;
  /** relative amplitude of a small random perturbation of the starting velocity (seeded; breaks symmetry so shedding can start) */
  noise?: number;
  seed?: number;
}

/** small deterministic generator (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LbmSolver {
  readonly nx: number;
  readonly ny: number;
  readonly N: number;
  readonly tau: number;
  readonly nu: number;
  readonly uIn: number;
  readonly solid: Uint8Array;
  readonly wallQ: Float32Array;
  /** 0 = bulk fluid (all neighbours fluid, not on the edge), 1 = fluid needing the general path, 2 = solid */
  private readonly kind: Uint8Array;
  private fa: Float64Array;
  private fb: Float64Array;
  private readonly xMode: 'open' | 'periodic';
  private readonly yMode: 'slip' | 'periodic';
  private readonly gx: number;
  private readonly gy: number;
  private readonly omegaP: number;
  private readonly omegaM: number;
  private readonly ramp: number;
  private readonly cs: number;
  private readonly magic: number;
  steps = 0;
  /** force on the solid from the last step (momentum per step) */
  fx = 0;
  fy = 0;
  private readonly off: number[];

  constructor(c: LbmConfig) {
    if (!(c.tau > 0.5)) throw new Error('τ must exceed ½');
    this.nx = c.nx;
    this.ny = c.ny;
    this.N = c.nx * c.ny;
    this.tau = c.tau;
    this.nu = (c.tau - 0.5) / 3;
    this.uIn = c.uIn;
    this.solid = c.solid ?? new Uint8Array(this.N);
    this.wallQ = c.wallQ ?? new Float32Array(9 * this.N);
    this.xMode = c.xMode ?? 'open';
    this.yMode = c.yMode ?? 'slip';
    this.gx = c.bodyForce?.[0] ?? 0;
    this.gy = c.bodyForce?.[1] ?? 0;
    this.omegaP = 1 / c.tau;
    this.magic = c.magic ?? 3 / 16;
    this.omegaM = 1 / (this.magic / (c.tau - 0.5) + 0.5);
    this.cs = c.smagorinsky ?? 0;
    this.ramp = c.rampSteps ?? 0;
    this.off = CX.map((cx, k) => cx + CY[k] * c.nx);
    this.fa = new Float64Array(9 * this.N);
    this.fb = new Float64Array(9 * this.N);
    this.kind = new Uint8Array(this.N);
    const { nx, ny } = this;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        if (this.solid[n]) {
          this.kind[n] = 2;
          continue;
        }
        let general = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        if (!general) for (let k = 1; k < 9; k++) if (this.solid[n + this.off[k]]) general = true;
        this.kind[n] = general ? 1 : 0;
      }
    }
    // initial state: the free stream (or rest), with an optional seeded perturbation
    const rand = rng(c.seed ?? 1);
    const u0 = c.rest || (c.rampSteps ?? 0) > 0 ? 0 : c.uIn;
    for (let n = 0; n < this.N; n++) {
      const pert = c.noise ? c.noise * c.uIn * (rand() - 0.5) * 2 : 0;
      const ux = this.solid[n] ? 0 : u0 + pert;
      const uy = this.solid[n] ? 0 : pert;
      for (let k = 0; k < 9; k++) this.fa[k * this.N + n] = this.feq(k, 1, ux, uy);
    }
  }

  private feq(k: number, rho: number, ux: number, uy: number): number {
    const cu = CX[k] * ux + CY[k] * uy;
    return WGT[k] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (ux * ux + uy * uy));
  }

  /** density and velocity at a node (post-streaming populations) */
  macro(n: number): { rho: number; ux: number; uy: number } {
    const f = this.fa;
    const N = this.N;
    let rho = 0;
    let mx = 0;
    let my = 0;
    for (let k = 0; k < 9; k++) {
      const v = f[k * N + n];
      rho += v;
      mx += CX[k] * v;
      my += CY[k] * v;
    }
    return { rho, ux: mx / rho + 0.5 * this.gx, uy: my / rho + 0.5 * this.gy };
  }

  /** Fill arrays with ρ, u_x, u_y for every node (0 / free-stream-free: solid nodes get ρ = 1 and u = 0). */
  fields(rho: Float64Array, ux: Float64Array, uy: Float64Array): void {
    const f = this.fa;
    const N = this.N;
    for (let n = 0; n < N; n++) {
      if (this.solid[n]) {
        rho[n] = 1;
        ux[n] = 0;
        uy[n] = 0;
        continue;
      }
      let r = 0;
      let mx = 0;
      let my = 0;
      for (let k = 0; k < 9; k++) {
        const v = f[k * N + n];
        r += v;
        mx += CX[k] * v;
        my += CY[k] * v;
      }
      rho[n] = r;
      ux[n] = mx / r + 0.5 * this.gx;
      uy[n] = my / r + 0.5 * this.gy;
    }
  }

  /** total mass of the fluid nodes (conserved in a closed or periodic box) */
  mass(): number {
    let m = 0;
    const f = this.fa;
    const N = this.N;
    for (let n = 0; n < N; n++) {
      if (this.solid[n]) continue;
      for (let k = 0; k < 9; k++) m += f[k * N + n];
    }
    return m;
  }

  /** One collision and one streaming step. Returns false if the state has become non-finite. */
  step(): boolean {
    const { N, nx, ny } = this;
    const f = this.fa;
    const g = this.fb;
    const cs2 = this.cs * this.cs;
    const tau0 = this.tau;
    const magic = this.magic;
    const gx = this.gx;
    const gy = this.gy;
    const kind = this.kind;
    // ---- collision, in place (post-collision populations f*)
    for (let n = 0; n < N; n++) {
      if (kind[n] === 2) continue;
      const f0 = f[n];
      const f1 = f[N + n];
      const f2 = f[2 * N + n];
      const f3 = f[3 * N + n];
      const f4 = f[4 * N + n];
      const f5 = f[5 * N + n];
      const f6 = f[6 * N + n];
      const f7 = f[7 * N + n];
      const f8 = f[8 * N + n];
      const rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
      const ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho + 0.5 * gx;
      const uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho + 0.5 * gy;
      const usq = 1.5 * (ux * ux + uy * uy);
      // equilibria
      const e0 = (4 / 9) * rho * (1 - usq);
      const w1 = rho / 9;
      const w5 = rho / 36;
      const e1 = w1 * (1 + 3 * ux + 4.5 * ux * ux - usq);
      const e3 = w1 * (1 - 3 * ux + 4.5 * ux * ux - usq);
      const e2 = w1 * (1 + 3 * uy + 4.5 * uy * uy - usq);
      const e4 = w1 * (1 - 3 * uy + 4.5 * uy * uy - usq);
      const c5 = ux + uy;
      const c6 = -ux + uy;
      const e5 = w5 * (1 + 3 * c5 + 4.5 * c5 * c5 - usq);
      const e7 = w5 * (1 - 3 * c5 + 4.5 * c5 * c5 - usq);
      const e6 = w5 * (1 + 3 * c6 + 4.5 * c6 * c6 - usq);
      const e8 = w5 * (1 - 3 * c6 + 4.5 * c6 * c6 - usq);
      let omP = this.omegaP;
      let omM = this.omegaM;
      if (cs2 > 0) {
        // Smagorinsky sub-grid viscosity from the non-equilibrium momentum flux (Hou et al. 1996): τ = ½ (τ₀ + √(τ₀² + 18√2 Cs² |Π| / ρ))
        const pxx = f1 + f3 + f5 + f6 + f7 + f8 - (e1 + e3 + e5 + e6 + e7 + e8);
        const pyy = f2 + f4 + f5 + f6 + f7 + f8 - (e2 + e4 + e5 + e6 + e7 + e8);
        const pxy = f5 - f6 + f7 - f8 - (e5 - e6 + e7 - e8);
        const q = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
        const tauT = 0.5 * (tau0 + Math.sqrt(tau0 * tau0 + (18 * Math.SQRT2 * cs2 * q) / rho));
        omP = 1 / tauT;
        omM = 1 / (magic / (tauT - 0.5) + 0.5);
      }
      // two-relaxation-time collision for each pair (k, k̄); the rest population relaxes with ω⁺
      f[n] = f0 - omP * (f0 - e0);
      let sp = 0.5 * (f1 + f3 - e1 - e3);
      let sm = 0.5 * (f1 - f3 - e1 + e3);
      f[N + n] = f1 - omP * sp - omM * sm;
      f[3 * N + n] = f3 - omP * sp + omM * sm;
      sp = 0.5 * (f2 + f4 - e2 - e4);
      sm = 0.5 * (f2 - f4 - e2 + e4);
      f[2 * N + n] = f2 - omP * sp - omM * sm;
      f[4 * N + n] = f4 - omP * sp + omM * sm;
      sp = 0.5 * (f5 + f7 - e5 - e7);
      sm = 0.5 * (f5 - f7 - e5 + e7);
      f[5 * N + n] = f5 - omP * sp - omM * sm;
      f[7 * N + n] = f7 - omP * sp + omM * sm;
      sp = 0.5 * (f6 + f8 - e6 - e8);
      sm = 0.5 * (f6 - f8 - e6 + e8);
      f[6 * N + n] = f6 - omP * sp - omM * sm;
      f[8 * N + n] = f8 - omP * sp + omM * sm;
      if (gx !== 0 || gy !== 0) {
        // Guo forcing for the two-relaxation-time collision: the part of the force that is odd in c enters with (1 − ω⁻/2), the even part with (1 − ω⁺/2)
        const ug = ux * gx + uy * gy;
        const cm = 1 - 0.5 * omM;
        const cp = 1 - 0.5 * omP;
        for (let k = 0; k < 9; k++) {
          const cg = CX[k] * gx + CY[k] * gy;
          const cu = CX[k] * ux + CY[k] * uy;
          f[k * N + n] += WGT[k] * (cm * 3 * cg + cp * (9 * cu * cg - 3 * ug));
        }
      }
    }
    // ---- streaming (pull), walls by interpolated bounce-back, momentum exchange
    let fx = 0;
    let fy = 0;
    const periodicX = this.xMode === 'periodic';
    const periodicY = this.yMode === 'periodic';
    const off = this.off;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const n = j * nx + i;
        const kd = kind[n];
        if (kd === 2) continue;
        if (kd === 0) {
          g[n] = f[n];
          for (let k = 1; k < 9; k++) g[k * N + n] = f[k * N + n - off[k]];
          continue;
        }
        g[n] = f[n];
        for (let k = 1; k < 9; k++) {
          let si = i - CX[k];
          let sj = j - CY[k];
          let outside = false;
          if (si < 0 || si >= nx) {
            if (periodicX) si = (si + nx) % nx;
            else outside = true;
          }
          if (sj < 0 || sj >= ny) {
            if (periodicY) sj = (sj + ny) % ny;
            else outside = true;
          }
          if (outside) {
            // slip walls at the top and bottom: specular reflection of the population that would have come from outside
            if (si >= 0 && si < nx) g[k * N + n] = f[FLIPY[k] * N + n];
            // left and right edges are overwritten below
            else g[k * N + n] = f[k * N + n];
            continue;
          }
          const s = sj * nx + si;
          if (!this.solid[s]) {
            g[k * N + n] = f[k * N + s];
            continue;
          }
          // wall between this node and its neighbour s = n − c_k: the link toward the wall is in direction kb = k̄
          const kb = OPP[k];
          let q = this.wallQ[kb * N + n];
          if (!(q > 0)) q = 0.5;
          let v: number;
          if (q < 0.5) {
            // the node behind this one, n + c_k (away from the wall)
            const bi = i + CX[k];
            const bj = j + CY[k];
            const ok = bi >= 0 && bi < nx && bj >= 0 && bj < ny && !this.solid[bj * nx + bi];
            v = ok ? 2 * q * f[kb * N + n] + (1 - 2 * q) * f[kb * N + bj * nx + bi] : f[kb * N + n];
          } else {
            v = (1 / (2 * q)) * f[kb * N + n] + ((2 * q - 1) / (2 * q)) * f[k * N + n];
          }
          g[k * N + n] = v;
          // momentum handed to the wall through this link: c_kb (f*_kb + f_k)
          const m = f[kb * N + n] + v;
          fx += CX[kb] * m;
          fy += CY[kb] * m;
        }
      }
    }
    // ---- open boundaries
    if (!periodicX) {
      const r = this.ramp > 0 ? Math.min(1, this.steps / this.ramp) : 1;
      const u = this.uIn * r * r * (3 - 2 * r);
      for (let j = 0; j < ny; j++) {
        const n = j * nx;
        if (!this.solid[n]) {
          // Zou–He velocity inflow (u, 0): the density follows from the populations that arrive from the interior
          const f0 = g[n];
          const f2 = g[2 * N + n];
          const f4 = g[4 * N + n];
          const f3 = g[3 * N + n];
          const f6 = g[6 * N + n];
          const f7 = g[7 * N + n];
          const rho = (f0 + f2 + f4 + 2 * (f3 + f6 + f7)) / (1 - u);
          g[N + n] = f3 + (2 / 3) * rho * u;
          g[5 * N + n] = f7 - 0.5 * (f2 - f4) + (1 / 6) * rho * u;
          g[8 * N + n] = f6 + 0.5 * (f2 - f4) + (1 / 6) * rho * u;
        }
        const r = j * nx + nx - 1;
        if (!this.solid[r]) for (let k = 0; k < 9; k++) g[k * N + r] = g[k * N + r - 1];
      }
    }
    this.fx = fx;
    this.fy = fy;
    this.fa = g;
    this.fb = f;
    this.steps++;
    // a non-finite state is detected on a node that is always fluid in a normal set-up
    const probe = g[(ny >> 1) * nx + (nx >> 1)];
    return Number.isFinite(probe) && Number.isFinite(fx) && Number.isFinite(fy);
  }

  /** largest speed on the fluid nodes, and the range of the density (a stability monitor) */
  monitor(): { maxSpeed: number; rhoMin: number; rhoMax: number; finite: boolean } {
    const f = this.fa;
    const N = this.N;
    let maxS = 0;
    let rmin = Infinity;
    let rmax = -Infinity;
    let finite = true;
    for (let n = 0; n < N; n++) {
      if (this.solid[n]) continue;
      let r = 0;
      let mx = 0;
      let my = 0;
      for (let k = 0; k < 9; k++) {
        const v = f[k * N + n];
        r += v;
        mx += CX[k] * v;
        my += CY[k] * v;
      }
      if (!Number.isFinite(r)) {
        finite = false;
        continue;
      }
      const s = Math.hypot(mx / r, my / r);
      if (s > maxS) maxS = s;
      if (r < rmin) rmin = r;
      if (r > rmax) rmax = r;
    }
    return { maxSpeed: maxS, rhoMin: rmin, rhoMax: rmax, finite };
  }
}
