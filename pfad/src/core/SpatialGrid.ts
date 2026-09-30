import type { Domain } from './Domain';
import type { ParticleStore } from './ParticleStore';

/**
 * Uniform cell list built by counting sort — O(N) per rebuild.
 *
 * Every pair of particles closer than `minCellSize` is guaranteed to lie in the
 * same or adjacent cells, so neighbour search never needs the O(N²) all-pairs
 * loop. Pairs are visited with a half stencil (self, E, NW, N, NE) so each
 * unordered pair is seen exactly once.
 *
 * Periodic axes wrap the stencil; that requires at least 3 cells along the axis
 * (otherwise a neighbour cell would be visited from both sides).
 * Particles slightly outside a bounded axis (e.g. overlapping a wall) are
 * clamped into the edge cell; they are still found.
 */
export type PairVisitor = (i: number, j: number, dx: number, dy: number, r2: number) => void;

const STENCIL_X = [1, -1, 0, 1];
const STENCIL_Y = [0, 1, 1, 1];

export class SpatialGrid {
  readonly domain: Domain;
  readonly nx: number;
  readonly ny: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly cellStart: Int32Array;
  readonly cellItems: Int32Array;
  readonly particleCell: Int32Array;
  private readonly cursor: Int32Array;
  private builtCount = 0;

  constructor(domain: Domain, minCellSize: number, capacity: number) {
    if (!(minCellSize > 0)) throw new Error(`cell size must be > 0, got ${minCellSize}`);
    this.domain = domain;
    // the 1e-12 relative slack stops e.g. 3.3 / 1.1 = 2.9999… from losing a cell
    this.nx = Math.max(1, Math.floor((domain.width / minCellSize) * (1 + 1e-12)));
    this.ny = Math.max(1, Math.floor((domain.height / minCellSize) * (1 + 1e-12)));
    if (domain.periodicX && this.nx < 3) {
      throw new Error(
        `periodic x axis needs ≥ 3 grid cells; width ${domain.width} / cell ${minCellSize} gives ${this.nx}`,
      );
    }
    if (domain.periodicY && this.ny < 3) {
      throw new Error(
        `periodic y axis needs ≥ 3 grid cells; height ${domain.height} / cell ${minCellSize} gives ${this.ny}`,
      );
    }
    this.cellW = domain.width / this.nx;
    this.cellH = domain.height / this.ny;
    const nCells = this.nx * this.ny;
    this.cellStart = new Int32Array(nCells + 1);
    this.cursor = new Int32Array(nCells);
    this.cellItems = new Int32Array(capacity);
    this.particleCell = new Int32Array(capacity);
  }

  get cellCount(): number {
    return this.nx * this.ny;
  }

  cellX(x: number): number {
    let cx = Math.floor((x - this.domain.xmin) / this.cellW);
    if (this.domain.periodicX) {
      cx %= this.nx;
      if (cx < 0) cx += this.nx;
    } else if (cx < 0) cx = 0;
    else if (cx >= this.nx) cx = this.nx - 1;
    return cx;
  }

  cellY(y: number): number {
    let cy = Math.floor((y - this.domain.ymin) / this.cellH);
    if (this.domain.periodicY) {
      cy %= this.ny;
      if (cy < 0) cy += this.ny;
    } else if (cy < 0) cy = 0;
    else if (cy >= this.ny) cy = this.ny - 1;
    return cy;
  }

  build(store: ParticleStore): void {
    const n = store.count;
    if (n > this.cellItems.length) throw new Error('SpatialGrid capacity exceeded');
    const nCells = this.nx * this.ny;
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const c = this.cellY(store.y[i]) * this.nx + this.cellX(store.x[i]);
      this.particleCell[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
    this.cursor.set(start.subarray(0, nCells));
    for (let i = 0; i < n; i++) {
      this.cellItems[this.cursor[this.particleCell[i]]++] = i;
    }
    this.builtCount = n;
  }

  /**
   * Visit every unordered pair (i, j) with |x_i - x_j| < cutoff exactly once.
   * dx, dy are the minimum-image components of x_i - x_j.
   * `cutoff` must not exceed the cell size the grid was built for.
   */
  forEachPairWithin(store: ParticleStore, cutoff: number, visit: PairVisitor): void {
    if (cutoff > Math.min(this.cellW, this.cellH) * (1 + 1e-12)) {
      throw new Error(`cutoff ${cutoff} exceeds grid cell size ${Math.min(this.cellW, this.cellH)}`);
    }
    const { nx, ny, cellStart, cellItems, domain } = this;
    const { x, y } = store;
    const px = domain.periodicX;
    const py = domain.periodicY;
    const w = domain.width;
    const h = domain.height;
    const c2 = cutoff * cutoff;
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx < nx; cx++) {
        const c = cy * nx + cx;
        const a0 = cellStart[c];
        const a1 = cellStart[c + 1];
        if (a0 === a1) continue;
        // pairs inside the cell
        for (let a = a0; a < a1; a++) {
          const i = cellItems[a];
          for (let b = a + 1; b < a1; b++) {
            const j = cellItems[b];
            let dx = x[i] - x[j];
            let dy = y[i] - y[j];
            if (px) dx -= w * Math.round(dx / w);
            if (py) dy -= h * Math.round(dy / h);
            const r2 = dx * dx + dy * dy;
            if (r2 < c2) visit(i, j, dx, dy, r2);
          }
        }
        // pairs with the half stencil of neighbours
        for (let s = 0; s < 4; s++) {
          let ncx = cx + STENCIL_X[s];
          let ncy = cy + STENCIL_Y[s];
          if (ncx < 0 || ncx >= nx) {
            if (!px) continue;
            ncx = (ncx + nx) % nx;
          }
          if (ncy < 0 || ncy >= ny) {
            if (!py) continue;
            ncy = (ncy + ny) % ny;
          }
          const nc = ncy * nx + ncx;
          const b0 = cellStart[nc];
          const b1 = cellStart[nc + 1];
          if (b0 === b1) continue;
          for (let a = a0; a < a1; a++) {
            const i = cellItems[a];
            const xi = x[i];
            const yi = y[i];
            for (let b = b0; b < b1; b++) {
              const j = cellItems[b];
              let dx = xi - x[j];
              let dy = yi - y[j];
              if (px) dx -= w * Math.round(dx / w);
              if (py) dy -= h * Math.round(dy / h);
              const r2 = dx * dx + dy * dy;
              if (r2 < c2) visit(i, j, dx, dy, r2);
            }
          }
        }
      }
    }
  }

  /**
   * Visit every particle j with |x_j - (qx, qy)| < radius (any radius; scans the
   * covering block of cells). dx, dy are minimum-image components of x_j - q.
   */
  forEachNear(
    store: ParticleStore,
    qx: number,
    qy: number,
    radius: number,
    visit: (j: number, dx: number, dy: number, r2: number) => void,
  ): void {
    const { nx, ny, cellStart, cellItems, domain } = this;
    const rx = Math.ceil(radius / this.cellW);
    const ry = Math.ceil(radius / this.cellH);
    const cx0 = this.cellX(qx);
    const cy0 = this.cellY(qy);
    const r2max = radius * radius;
    // on a periodic axis never visit the same cell twice
    const spanX = domain.periodicX ? Math.min(2 * rx + 1, nx) : 2 * rx + 1;
    const spanY = domain.periodicY ? Math.min(2 * ry + 1, ny) : 2 * ry + 1;
    for (let oy = 0; oy < spanY; oy++) {
      let cy = cy0 - ry + oy;
      if (cy < 0 || cy >= ny) {
        if (!domain.periodicY) continue;
        cy = ((cy % ny) + ny) % ny;
      }
      for (let ox = 0; ox < spanX; ox++) {
        let cx = cx0 - rx + ox;
        if (cx < 0 || cx >= nx) {
          if (!domain.periodicX) continue;
          cx = ((cx % nx) + nx) % nx;
        }
        const c = cy * nx + cx;
        for (let b = cellStart[c]; b < cellStart[c + 1]; b++) {
          const j = cellItems[b];
          const dx = domain.imageDx(store.x[j] - qx);
          const dy = domain.imageDy(store.y[j] - qy);
          const r2 = dx * dx + dy * dy;
          if (r2 < r2max) visit(j, dx, dy, r2);
        }
      }
    }
  }

  get particleCount(): number {
    return this.builtCount;
  }
}
