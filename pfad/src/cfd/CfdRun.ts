import { bodyPolygon, placementAt, place, type Placement, type Side, type SurfaceGeometry } from '../geometry/SurfaceGeometry';
import { LbmSolver } from './Lbm';
import { rasterize } from './Raster';
import { dividingStreamline, sampleProfiles, wallGradient, wallStations, type ProfileSpec, type WallStation } from './Walls';

/**
 * ONE CFD RUN of a body in a stream: set-up, start-up, a measurement window split into time blocks, and the measurements
 * (forces by momentum exchange, time-mean fields, near-wall profiles with wall shear, pressure and the dividing streamline,
 * and the integrity checks). It uses the lattice Boltzmann solver of Lbm.ts: conventional CFD, not the particle engine.
 *
 * Lengths of the body are in "plate units" (the plate is 30 long by default, as in the particle workspace); the lattice has
 * `cells` cells along the plate, so one plate unit is cells / chord cells. Time is counted in CONVECTIVE times
 * T = plate length / free-stream speed (in lattice steps: cells / uLattice).
 */
export interface CfdParams {
  geometry: SurfaceGeometry;
  alphaDeg: number;
  /** lattice cells along the plate (resolution) */
  cells: number;
  /** Reynolds number U L / ν of the run (plate length L) */
  reynolds: number;
  /** free-stream speed in lattice units (Mach = uLattice · √3) */
  uLattice: number;
  /** domain in plate lengths */
  widthL: number;
  heightL: number;
  /** the absorbing layer in front of the outflow: its length in plate lengths and the relaxation time at the end of it */
  spongeL: number;
  spongeTau: number;
  /** where the mid-chord sits, as a fraction of the width */
  bodyAtX: number;
  /** start-up and averaging window, in convective times */
  warmup: number;
  average: number;
  blocks: number;
  /** Smagorinsky constant of a sub-grid eddy viscosity (absent or 0: none) and the number of steps over which the inflow is raised smoothly from rest (absent or 0: at once) */
  smagorinsky?: number;
  ramp?: number;
  /** steps between samples of the fields */
  sampleEvery: number;
  seed: number;
}

export const CFD_PRESETS = {
  quick: { cells: 48, warmup: 10, average: 20 },
  standard: { cells: 64, warmup: 12, average: 22 },
  fine: { cells: 96, warmup: 14, average: 26 },
} as const;

/**
 * Lattice speed 0.06 keeps the largest local speed (about 2.5 U in the vortices) below Mach 0.3; the domain is 9 plate
 * lengths long (the last 2 are an absorbing layer in front of the outflow) and 6 high, with the mid-chord 30 % of the length from the inflow.
 */
export const CFD_BASE = { uLattice: 0.06, widthL: 9, heightL: 6, spongeL: 2, spongeTau: 1.2, bodyAtX: 0.3, blocks: 8, sampleEvery: 8, seed: 7 };

/** The smallest kinematic viscosity (lattice units) the solver runs without sub-grid modelling: τ ≥ 0.5225. Below it the two-relaxation-time scheme was found unstable on this geometry (tests/cfd.run.test.ts). */
export const MIN_VISCOSITY = 0.0075;

/** The largest Reynolds number this resolution can run (ν ≥ MIN_VISCOSITY). */
export function reynoldsCap(cells: number, uLattice = CFD_BASE.uLattice): number {
  return (uLattice * cells) / MIN_VISCOSITY;
}

export interface Est {
  mean: number;
  se: number;
  n: number;
}

const batch = (v: number[]): Est => {
  const n = v.length;
  if (n === 0) return { mean: Number.NaN, se: Number.NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, se: Number.NaN, n };
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  return { mean, se: sd / Math.sqrt(n), n };
};

export interface CfdStationResult {
  side: Side;
  /** body-frame x of the station centre and its length (plate units) */
  x: number;
  length: number;
  /** wall shear coefficient C_f = τ / (½ ρ U²) along the downstream tangent (negative: the mean flow beside the wall runs upstream) */
  cf: Est;
  /** pressure coefficient C_p = (p − p∞) / (½ ρ U²) beside the wall (one cell out) */
  cp: Est;
  /** mean velocity along the downstream tangent one cell out, in units of U */
  ut: Est;
  /** dividing-streamline height above the wall in plate units (null where the flow beside the wall is not reversed), with the share of blocks that found one */
  h: Est | null;
  hShare: number;
  /** of the blocks that found one, the share in which the flux did not return to zero within the sampled height (then h is only a lower bound: the reach of the profile) */
  hOpenShare: number;
}

export interface CfdSeparation {
  /** body-frame x where C_f first turns significantly negative after a forward stretch, in plate units, or null */
  x: number | null;
  /** body-frame x where it turns positive again after that, or null */
  reattachX: number | null;
  /** body-frame x of the stagnation point when the side starts with a reversed stretch (flow toward the leading edge), or null */
  stagnationX: number | null;
  /** stations with C_f < 0 significantly (|z| ≥ 2 on the block spread), as a share of the stations with a verdict */
  reversedShare: number;
  /** a stretch of reversed flow beside the wall was found */
  reversed: boolean;
  note: string;
}

export interface CfdGrid {
  nx: number;
  ny: number;
  /** lattice cells per grid cell (the stored fields are block averages) */
  stride: number;
  /** domain in plate units: x from 0 to width, y from 0 to height; cell (i, j) covers [i, i+1) × [j, j+1) strides */
  ux: number[];
  uy: number[];
  rho: number[];
  /** 1 where the cell is (mostly) inside the body */
  solid: number[];
}

export interface CfdResult {
  schema: 'pfad-cfd-run/1';
  params: Omit<CfdParams, 'geometry'>;
  tau: number;
  nu: number;
  lattice: { nx: number; ny: number; cellsPerUnit: number };
  /** projected height of the body over the height of the domain */
  blockage: number;
  steps: number;
  windowSteps: number;
  /** mean free-stream density measured upstream (the reference density of every coefficient) */
  rhoInf: number;
  forces: { drag: Est; lift: Est; dragCoeff: Est; liftCoeff: Est; moment?: undefined; reference: number };
  /** per time block, coefficients (so a drift or an oscillation can be seen) */
  blockForces: { dragCoeff: number[]; liftCoeff: number[] };
  stations: Record<Side, CfdStationResult[]>;
  separation: Record<Side, CfdSeparation>;
  grid: CfdGrid;
  integrity: { status: 'PASSED' | 'WARNING' | 'FAILED'; checks: { id: string; label: string; pass: boolean; /** failing this makes the whole run FAILED rather than a WARNING */ hard: boolean; value: string; criterion: string }[]; maxMach: number; fluxImbalance: number; densityDrift: number; forceDrift: number };
  /** the profile sampling used (lattice cells) */
  profile: ProfileSpec;
}

const SIDES = ['upper', 'lower'] as const;

/** The near-wall profile sampling: first sample one cell out, then every half cell, up to a third of the plate length. */
export function profileSpec(cells: number): ProfileSpec {
  const reach = Math.max(8, 0.34 * cells);
  return { first: 1, step: 0.5, count: Math.max(8, Math.floor((reach - 1) / 0.5) + 1) };
}

/** Where the body sits in the domain (plate units): mid-chord at bodyAtX of the width, mid-height, at the angle of attack. */
export function cfdPlacement(p: Pick<CfdParams, 'alphaDeg' | 'widthL' | 'heightL' | 'bodyAtX'>, g: SurfaceGeometry): Placement {
  return placementAt(g, p.bodyAtX * p.widthL * g.chord, (p.heightL * g.chord) / 2, p.alphaDeg);
}

export class CfdRun {
  readonly p: CfdParams;
  readonly solver: LbmSolver;
  readonly nx: number;
  readonly ny: number;
  readonly cpu: number;
  readonly placement: Placement;
  readonly tau: number;
  readonly nu: number;
  readonly conv: number;
  readonly warmSteps: number;
  readonly avgSteps: number;
  readonly blockSteps: number;
  readonly blockage: number;
  private readonly stations: Record<Side, WallStation[]>;
  private readonly spec: ProfileSpec;
  private readonly rho: Float64Array;
  private readonly ux: Float64Array;
  private readonly uy: Float64Array;
  private readonly sumRho: Float64Array;
  private readonly sumUx: Float64Array;
  private readonly sumUy: Float64Array;
  private readonly blkRho: Float64Array;
  private readonly blkUx: Float64Array;
  private readonly blkUy: Float64Array;
  private blkN = 0;
  private totN = 0;
  private fx: number[] = [];
  private fy: number[] = [];
  private rhoProbe: number[] = [];
  private blockFx: number[] = [];
  private blockFy: number[] = [];
  private blockRho: number[] = [];
  private blockIdx = 0;
  private readonly profUt: Record<Side, Float64Array[][]> = { upper: [], lower: [] };
  private readonly profRho: Record<Side, Float64Array[][]> = { upper: [], lower: [] };
  private fluxIn = 0;
  private fluxOut = 0;
  private maxSpeed = 0;
  private rhoMin = Infinity;
  private rhoMax = -Infinity;
  private diverged = false;
  phase: 'warm-up' | 'averaging' | 'done' = 'warm-up';

  constructor(p: CfdParams) {
    if (!(p.cells >= 16)) throw new Error('at least 16 cells along the plate');
    this.p = p;
    const g = p.geometry;
    this.cpu = p.cells / g.chord;
    this.nx = Math.round(p.widthL * p.cells);
    this.ny = Math.round(p.heightL * p.cells);
    this.nu = (p.uLattice * p.cells) / p.reynolds;
    this.tau = 3 * this.nu + 0.5;
    if (this.nu < MIN_VISCOSITY * 0.999) throw new Error(`the Reynolds number ${p.reynolds.toFixed(0)} is too high for ${p.cells} cells along the plate (τ = ${this.tau.toFixed(4)}); the limit is ${reynoldsCap(p.cells, p.uLattice).toFixed(0)}`);
    this.conv = p.cells / p.uLattice;
    this.warmSteps = Math.round(p.warmup * this.conv);
    this.avgSteps = Math.round(p.average * this.conv);
    this.blockSteps = Math.max(1, Math.floor(this.avgSteps / p.blocks));
    // the body, rotated by the angle of attack and placed with its mid-chord at (bodyAtX · width, height / 2) (plate units)
    this.placement = cfdPlacement(p, g);
    const poly = place(bodyPolygon(g), this.placement).map((v) => v * this.cpu);
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let k = 1; k < poly.length; k += 2) {
      ymin = Math.min(ymin, poly[k]);
      ymax = Math.max(ymax, poly[k]);
    }
    this.blockage = (ymax - ymin) / this.ny;
    const r = rasterize(this.nx, this.ny, poly);
    this.solver = new LbmSolver({ nx: this.nx, ny: this.ny, tau: this.tau, uIn: p.uLattice, solid: r.solid, wallQ: r.wallQ, noise: 0.01, seed: p.seed, smagorinsky: p.smagorinsky, rampSteps: p.ramp, sponge: p.spongeL > 0 ? { cells: Math.round(p.spongeL * p.cells), tau: p.spongeTau } : undefined });
    const N = this.nx * this.ny;
    this.rho = new Float64Array(N);
    this.ux = new Float64Array(N);
    this.uy = new Float64Array(N);
    this.sumRho = new Float64Array(N);
    this.sumUx = new Float64Array(N);
    this.sumUy = new Float64Array(N);
    this.blkRho = new Float64Array(N);
    this.blkUx = new Float64Array(N);
    this.blkUy = new Float64Array(N);
    this.stations = wallStations(g, this.placement, this.cpu);
    // profiles: first sample one cell out (then every half cell) up to a third of the plate length
    this.spec = profileSpec(p.cells);
    for (const s of SIDES) {
      this.profUt[s] = [];
      this.profRho[s] = [];
    }
  }

  get time(): number {
    return this.solver.steps / this.conv;
  }

  progress(): number {
    return Math.min(1, this.solver.steps / (this.warmSteps + this.blockSteps * this.p.blocks));
  }

  /** advance at most `maxSteps`; returns the number of steps taken (0 once done) */
  advance(maxSteps: number): number {
    let k = 0;
    const total = this.warmSteps + this.blockSteps * this.p.blocks;
    while (k < maxSteps && this.phase !== 'done') {
      if (!this.solver.step()) {
        this.diverged = true;
        this.phase = 'done';
        break;
      }
      k++;
      const t = this.solver.steps;
      if (t > this.warmSteps) {
        this.phase = 'averaging';
        this.blockFx.push(this.solver.fx);
        this.blockFy.push(this.solver.fy);
        if ((t - this.warmSteps) % this.p.sampleEvery === 0) this.sample();
        if ((t - this.warmSteps) % this.blockSteps === 0) this.closeBlock();
      }
      if (t >= total) this.phase = 'done';
    }
    return k;
  }

  private sample() {
    this.solver.fields(this.rho, this.ux, this.uy);
    const N = this.rho.length;
    for (let n = 0; n < N; n++) {
      this.blkRho[n] += this.rho[n];
      this.blkUx[n] += this.ux[n];
      this.blkUy[n] += this.uy[n];
    }
    this.blkN++;
    const { nx, ny } = this;
    // upstream reference density, in/out mass flux balance and the stability monitors
    this.blockRho.push(this.rho[(ny >> 1) * nx + Math.round(0.4 * this.p.cells)]);
    let fi = 0;
    let fo = 0;
    for (let j = 0; j < ny; j++) {
      fi += this.rho[j * nx + 4] * this.ux[j * nx + 4];
      fo += this.rho[j * nx + nx - 6] * this.ux[j * nx + nx - 6];
    }
    this.fluxIn += fi;
    this.fluxOut += fo;
    for (let n = 0; n < N; n += 3) {
      if (this.solver.solid[n]) continue;
      const s = Math.hypot(this.ux[n], this.uy[n]);
      if (s > this.maxSpeed) this.maxSpeed = s;
      if (this.rho[n] < this.rhoMin) this.rhoMin = this.rho[n];
      if (this.rho[n] > this.rhoMax) this.rhoMax = this.rho[n];
    }
  }

  private closeBlock() {
    const N = this.rho.length;
    const m = Math.max(1, this.blkN);
    for (let n = 0; n < N; n++) {
      this.blkRho[n] /= m;
      this.blkUx[n] /= m;
      this.blkUy[n] /= m;
    }
    for (const s of SIDES) {
      const pr = sampleProfiles(this.blkUx, this.blkUy, this.blkRho, this.solver.solid, this.nx, this.ny, this.stations[s], this.spec);
      this.profUt[s].push(pr.ut);
      this.profRho[s].push(pr.rho);
    }
    for (let n = 0; n < N; n++) {
      this.sumRho[n] += this.blkRho[n];
      this.sumUx[n] += this.blkUx[n];
      this.sumUy[n] += this.blkUy[n];
    }
    this.totN++;
    this.fx.push(this.blockFx.reduce((a, b) => a + b, 0) / this.blockFx.length);
    this.fy.push(this.blockFy.reduce((a, b) => a + b, 0) / this.blockFy.length);
    this.rhoProbe.push(this.blockRho.reduce((a, b) => a + b, 0) / Math.max(1, this.blockRho.length));
    this.blockFx = [];
    this.blockFy = [];
    this.blockRho = [];
    this.blkRho.fill(0);
    this.blkUx.fill(0);
    this.blkUy.fill(0);
    this.blkN = 0;
    this.blockIdx++;
  }

  /** the instantaneous field for the live view, decimated by `stride` (speed in units of U, vorticity in units of U / L, pressure coefficient) */
  snapshot(kind: 'speed' | 'vorticity' | 'pressure' | 'ux' | 'uy', stride: number): { nx: number; ny: number; values: Float32Array } {
    this.solver.fields(this.rho, this.ux, this.uy);
    const { nx, ny } = this;
    const U = this.p.uLattice;
    const gx = Math.ceil(nx / stride);
    const gy = Math.ceil(ny / stride);
    const out = new Float32Array(gx * gy);
    const rhoInf = this.rhoProbe.length ? this.rhoProbe[this.rhoProbe.length - 1] : 1;
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        const x = Math.min(nx - 2, Math.max(1, i * stride));
        const y = Math.min(ny - 2, Math.max(1, j * stride));
        const n = y * nx + x;
        if (this.solver.solid[n]) {
          out[j * gx + i] = Number.NaN;
          continue;
        }
        let v: number;
        if (kind === 'speed') v = Math.hypot(this.ux[n], this.uy[n]) / U;
        else if (kind === 'ux') v = this.ux[n] / U;
        else if (kind === 'uy') v = this.uy[n] / U;
        else if (kind === 'pressure') v = (this.rho[n] - 1) / 3 / (0.5 * U * U * rhoInf);
        else {
          const dvdx = (this.uy[n + 1] - this.uy[n - 1]) / 2;
          const dudy = (this.ux[n + nx] - this.ux[n - nx]) / 2;
          v = ((dvdx - dudy) * this.p.cells) / U;
        }
        out[j * gx + i] = v;
      }
    return { nx: gx, ny: gy, values: out };
  }

  live() {
    const last = this.fx.length - 1;
    return {
      phase: this.phase,
      steps: this.solver.steps,
      convective: this.time,
      blocks: `${this.blockIdx}/${this.p.blocks}`,
      fx: last >= 0 ? this.fx[last] : Number.NaN,
      fy: last >= 0 ? this.fy[last] : Number.NaN,
    };
  }

  result(): CfdResult {
    const p = this.p;
    const U = p.uLattice;
    const K = this.fx.length;
    const rhoInf = K ? this.rhoProbe.reduce((a, b) => a + b, 0) / K : 1;
    const ref = 0.5 * rhoInf * U * U * p.cells;
    const dragBlocks = this.fx.map((f) => f);
    const liftBlocks = this.fy.map((f) => f);
    const forces = {
      drag: batch(dragBlocks),
      lift: batch(liftBlocks),
      dragCoeff: batch(dragBlocks.map((f) => f / ref)),
      liftCoeff: batch(liftBlocks.map((f) => f / ref)),
      reference: ref,
    };
    // ---- stations
    const nu = this.nu;
    const spec = this.spec;
    const stationsOut = {} as Record<Side, CfdStationResult[]>;
    const separation = {} as Record<Side, CfdSeparation>;
    for (const s of SIDES) {
      const list: CfdStationResult[] = [];
      const st = this.stations[s];
      st.forEach((w, k) => {
        const cf: number[] = [];
        const cp: number[] = [];
        const ut1: number[] = [];
        const hs: number[] = [];
        let nOpen = 0;
        for (let b = 0; b < K; b++) {
          const prof = this.profUt[s][b][k];
          const grad = wallGradient(prof, spec.first);
          cf.push((rhoInf * nu * grad) / (0.5 * rhoInf * U * U));
          const r1 = this.profRho[s][b][k][0];
          cp.push(Number.isFinite(r1) ? ((r1 - rhoInf) / 3) / (0.5 * rhoInf * U * U) : Number.NaN);
          ut1.push(prof[0] / U);
          const d = dividingStreamline(prof, spec.first, spec.step);
          if (d.h !== null) {
            hs.push(d.h / this.cpu);
            if (d.open) nOpen++;
          }
        }
        const finite = (v: number[]) => v.filter((x) => Number.isFinite(x));
        list.push({
          side: s,
          x: w.x,
          length: w.length / this.cpu,
          cf: batch(finite(cf)),
          cp: batch(finite(cp)),
          ut: batch(finite(ut1)),
          h: hs.length ? batch(hs) : null,
          hShare: K ? hs.length / K : 0,
          hOpenShare: hs.length ? nOpen / hs.length : 0,
        });
      });
      stationsOut[s] = list;
      separation[s] = this.separationOf(list);
    }
    // ---- grid for the views: block averages of the time-mean fields, at most ~170 cells wide
    const stride = Math.max(1, Math.ceil(this.nx / 170));
    const gx = Math.ceil(this.nx / stride);
    const gy = Math.ceil(this.ny / stride);
    const grid: CfdGrid = { nx: gx, ny: gy, stride, ux: [], uy: [], rho: [], solid: [] };
    const m = Math.max(1, this.totN);
    for (let j = 0; j < gy; j++)
      for (let i = 0; i < gx; i++) {
        let su = 0;
        let sv = 0;
        let sr = 0;
        let c = 0;
        let sol = 0;
        let all = 0;
        for (let dj = 0; dj < stride; dj++)
          for (let di = 0; di < stride; di++) {
            const x = i * stride + di;
            const y = j * stride + dj;
            if (x >= this.nx || y >= this.ny) continue;
            all++;
            const n = y * this.nx + x;
            if (this.solver.solid[n]) {
              sol++;
              continue;
            }
            su += this.sumUx[n] / m;
            sv += this.sumUy[n] / m;
            sr += this.sumRho[n] / m;
            c++;
          }
        grid.solid.push(sol > all / 2 ? 1 : 0);
        grid.ux.push(c ? su / c / U : 0);
        grid.uy.push(c ? sv / c / U : 0);
        grid.rho.push(c ? sr / c : 1);
      }
    // ---- integrity
    const samples = Math.max(1, Math.floor(this.avgSteps / p.sampleEvery));
    const fluxImbalance = this.fluxIn !== 0 ? Math.abs(this.fluxOut - this.fluxIn) / Math.abs(this.fluxIn) : Number.NaN;
    const densityDrift = this.rhoProbe.length > 1 ? Math.abs(this.rhoProbe[this.rhoProbe.length - 1] - this.rhoProbe[0]) / rhoInf : 0;
    const half = Math.floor(K / 2);
    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : Number.NaN);
    const forceDrift = K >= 4 ? Math.abs(mean(this.fx.slice(half)) - mean(this.fx.slice(0, half))) / Math.max(1e-12, Math.abs(mean(this.fx))) : Number.NaN;
    const maxMach = this.maxSpeed * Math.sqrt(3);
    void samples;
    const checks = [
      { id: 'stable', label: 'The solution stayed finite for the whole run', pass: !this.diverged, hard: true, value: this.diverged ? 'diverged' : 'finite', criterion: 'no divergence' },
      { id: 'mach', label: 'The flow stayed in the incompressible regime: largest lattice Mach number anywhere (the density error is of order Mach²)', pass: maxMach < 0.3, hard: maxMach >= 0.45, value: maxMach.toFixed(3), criterion: '< 0.3 (a failure above 0.45)' },
      { id: 'flux', label: 'Mass flux through the domain: inflow and outflow agree', pass: fluxImbalance < 0.02, hard: fluxImbalance >= 0.1, value: Number.isFinite(fluxImbalance) ? `${(100 * fluxImbalance).toFixed(2)} %` : 'n/a', criterion: '< 2 % (a failure above 10 %)' },
      { id: 'density', label: 'The free-stream density did not drift during the window', pass: densityDrift < 0.01, hard: densityDrift >= 0.05, value: `${(100 * densityDrift).toFixed(2)} %`, criterion: '< 1 % (a failure above 5 %)' },
      { id: 'stationary', label: 'The mean drag is the same in the two halves of the window', pass: !(forceDrift > 0.1), hard: false, value: Number.isFinite(forceDrift) ? `${(100 * forceDrift).toFixed(1)} %` : 'n/a', criterion: '< 10 % (otherwise the flow had not settled)' },
      { id: 'blockage', label: 'Blockage of the body in the channel: a stream confined by slip walls is accelerated past the body, and the forces rise with it (the default plate at 65° gave a drag coefficient 11 % lower when the channel was raised from 6 to 10 plate lengths, blockage 15 % → 9 %)', pass: this.blockage < 0.1, hard: false, value: `${(100 * this.blockage).toFixed(0)} %`, criterion: '< 10 % (above it the force coefficients are inflated by the confinement)' },
    ];
    const status = checks.some((c) => !c.pass && c.hard) ? 'FAILED' : checks.every((c) => c.pass) ? 'PASSED' : 'WARNING';
    const { geometry, ...params } = p;
    void geometry;
    return {
      schema: 'pfad-cfd-run/1',
      params,
      tau: this.tau,
      nu,
      lattice: { nx: this.nx, ny: this.ny, cellsPerUnit: this.cpu },
      blockage: this.blockage,
      steps: this.solver.steps,
      windowSteps: this.blockSteps * K,
      rhoInf,
      forces: { ...forces, moment: undefined },
      blockForces: { dragCoeff: dragBlocks.map((f) => f / ref), liftCoeff: liftBlocks.map((f) => f / ref) },
      stations: stationsOut,
      separation,
      grid,
      integrity: { status, checks, maxMach, fluxImbalance, densityDrift, forceDrift },
      profile: spec,
    };
  }

  /**
   * The separation of one side from the station results, by the sign of the mean wall shear C_f along the downstream tangent:
   * a stagnation point where it turns positive after a reversed stretch at the leading edge (flow beside the wall runs toward
   * the leading edge before it); separation where it turns significantly negative after forward flow; reattachment where it
   * turns positive again.
   */
  private separationOf(list: CfdStationResult[]): CfdSeparation {
    const neg = (s: CfdStationResult) => Number.isFinite(s.cf.mean) && s.cf.mean < 0 && (Number.isFinite(s.cf.se) ? -s.cf.mean / Math.max(s.cf.se, 1e-9) >= 2 : true);
    const pos = (s: CfdStationResult) => Number.isFinite(s.cf.mean) && s.cf.mean > 0 && (Number.isFinite(s.cf.se) ? s.cf.mean / Math.max(s.cf.se, 1e-9) >= 2 : true);
    const known = list.filter((s) => Number.isFinite(s.cf.mean));
    const reversedShare = known.length ? list.filter(neg).length / known.length : 0;
    const two = (k: number, f: (s: CfdStationResult) => boolean) => k + 1 < list.length && f(list[k]) && f(list[k + 1]);
    let k = 0;
    // a reversed stretch at the leading edge ends at the stagnation point
    let stagIdx = -1;
    if (two(0, neg)) {
      for (k = 1; k < list.length; k++) if (two(k, pos)) {
        stagIdx = k;
        break;
      }
      if (stagIdx < 0) k = list.length;
    }
    const from = stagIdx >= 0 ? stagIdx : two(0, neg) ? list.length : 0;
    let sepIdx = -1;
    for (k = from; k < list.length; k++) if (two(k, neg) && (k === 0 || !neg(list[k - 1]))) {
      sepIdx = k;
      break;
    }
    let reIdx = -1;
    if (sepIdx >= 0) for (k = sepIdx + 1; k < list.length; k++) if (two(k, pos)) {
      reIdx = k;
      break;
    }
    const reversed = list.some(neg);
    const fromStart = two(0, neg);
    const parts: string[] = [];
    if (stagIdx >= 0) parts.push(`the mean flow beside the wall runs toward the leading edge up to x = ${list[stagIdx].x.toFixed(1)} (a stagnation point), then downstream`);
    else if (fromStart) parts.push('the mean flow beside the wall runs toward the leading edge along the whole side');
    if (sepIdx >= 0) parts.push(`C_f turns negative (separation) at x = ${list[sepIdx].x.toFixed(1)}${reIdx >= 0 ? ` and positive again (reattachment) at x = ${list[reIdx].x.toFixed(1)}` : ' and stays negative to the trailing edge'}`);
    if (!parts.length) parts.push(reversed ? 'C_f is negative at some stations, but not as a stretch that follows forward flow' : 'C_f is positive everywhere: the mean flow beside the wall runs downstream');
    return { x: sepIdx >= 0 ? list[sepIdx].x : null, reattachX: reIdx >= 0 ? list[reIdx].x : null, stagnationX: stagIdx >= 0 ? list[stagIdx].x : null, reversedShare, reversed, note: parts.join('; ') };
  }
}
