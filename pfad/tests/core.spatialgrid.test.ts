import { describe, expect, it } from 'vitest';
import { Domain } from '../src/core/Domain';
import { ParticleStore } from '../src/core/ParticleStore';
import { Rng } from '../src/core/Random';
import { SpatialGrid } from '../src/core/SpatialGrid';

/** O(N²) reference — test-only, never used by the simulation. */
function bruteForcePairs(store: ParticleStore, domain: Domain, cutoff: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < store.count; i++) {
    for (let j = i + 1; j < store.count; j++) {
      const dx = domain.imageDx(store.x[i] - store.x[j]);
      const dy = domain.imageDy(store.y[i] - store.y[j]);
      if (dx * dx + dy * dy < cutoff * cutoff) out.add(`${i}-${j}`);
    }
  }
  return out;
}

function randomStore(n: number, domain: Domain, seed: number): ParticleStore {
  const rng = new Rng(seed);
  const s = new ParticleStore(n);
  for (let k = 0; k < n; k++) {
    s.add({
      x: rng.uniform(domain.xmin, domain.xmax),
      y: rng.uniform(domain.ymin, domain.ymax),
      vx: 0,
      vy: 0,
      mass: 1,
      radius: 0.5,
    });
  }
  return s;
}

const cases: [string, boolean, boolean][] = [
  ['bounded box', false, false],
  ['periodic x', true, false],
  ['periodic y', false, true],
  ['fully periodic', true, true],
];

describe('SpatialGrid', () => {
  for (const [name, periodicX, periodicY] of cases) {
    it(`finds exactly the brute-force neighbour pairs (${name})`, () => {
      const domain = new Domain({ xmin: -3, xmax: 17, ymin: 2, ymax: 13.5, periodicX, periodicY });
      const store = randomStore(600, domain, 11);
      const cutoff = 1.3;
      const grid = new SpatialGrid(domain, cutoff, store.capacity);
      grid.build(store);
      const found = new Set<string>();
      let visits = 0;
      grid.forEachPairWithin(store, cutoff, (i, j, dx, dy, r2) => {
        visits++;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        found.add(key);
        expect(dx).toBeCloseTo(domain.imageDx(store.x[i] - store.x[j]), 12);
        expect(dy).toBeCloseTo(domain.imageDy(store.y[i] - store.y[j]), 12);
        expect(r2).toBeCloseTo(dx * dx + dy * dy, 12);
      });
      const expected = bruteForcePairs(store, domain, cutoff);
      expect(visits).toBe(found.size); // each pair exactly once
      expect(found).toEqual(expected);
      expect(expected.size).toBeGreaterThan(50);
    });
  }

  it('handles the minimum periodic grid (3 cells) without double counting', () => {
    const domain = new Domain({ xmin: 0, xmax: 3.3, ymin: 0, ymax: 3.3, periodicX: true, periodicY: true });
    const store = randomStore(40, domain, 5);
    const grid = new SpatialGrid(domain, 1.1, store.capacity);
    expect(grid.nx).toBe(3);
    grid.build(store);
    const seen: string[] = [];
    grid.forEachPairWithin(store, 1.1, (i, j) => seen.push(i < j ? `${i}-${j}` : `${j}-${i}`));
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(bruteForcePairs(store, domain, 1.1));
  });

  it('refuses a periodic axis with fewer than 3 cells', () => {
    const domain = new Domain({ xmin: 0, xmax: 2, ymin: 0, ymax: 10, periodicX: true, periodicY: false });
    expect(() => new SpatialGrid(domain, 1, 10)).toThrow(/periodic x axis/);
  });

  it('finds particles near a query point, across cells and periodic images', () => {
    const domain = new Domain({ xmin: 0, xmax: 20, ymin: 0, ymax: 20, periodicX: true, periodicY: false });
    const store = randomStore(500, domain, 9);
    const grid = new SpatialGrid(domain, 1, store.capacity);
    grid.build(store);
    for (const [qx, qy, R] of [
      [0.2, 10, 2.5],
      [19.9, 0.1, 3.7],
      [10, 10, 0.8],
    ]) {
      const got: number[] = [];
      grid.forEachNear(store, qx, qy, R, (j) => got.push(j));
      const want: number[] = [];
      for (let j = 0; j < store.count; j++) {
        const dx = domain.imageDx(store.x[j] - qx);
        const dy = store.y[j] - qy;
        if (dx * dx + dy * dy < R * R) want.push(j);
      }
      expect(got.sort((a, b) => a - b)).toEqual(want);
    }
  });
});
