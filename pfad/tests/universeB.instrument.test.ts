import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/core/Simulation';
import { createGas } from '../src/gas/InitialConditions';
import { henderson } from '../src/universeB/CoarseGrainMap';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';
import { stage0Plan } from '../src/universeB/UB0Plans';
import { readJsonGz, runJob, writeJsonGz } from '../scripts/ub0Job';

const A = { Nc: 1, ch: 0, e: 1, KTred: henderson.KTred(0.2), courant: 0.025, observables: true, phi: 0.2 };
const tiny: Record<string, UB0Spec> = {
  static: { ...A, id: 't-static', kind: 'static', seed: 3, L: 12, prep: 2, settle: 1, measure: 4, sample: 0.5, extras: true },
  shear: { ...A, id: 't-shear', kind: 'shear', seed: 4, L: 12, amplitude: 1, prep: 2, settle: 1, measure: 4, sample: 0.5 },
  sound: { ...A, id: 't-sound', kind: 'sound', seed: 5, L: 12, amplitude: 0.05, prep: 2, settle: 1, measure: 4, sample: 0.5 },
  wall: { ...A, id: 't-wall', kind: 'wall', seed: 6, width: 8, height: 10, prep: 2, settle: 0, measure: 4, sample: 0.5 },
  couette: { ...A, id: 't-couette', kind: 'couette', seed: 7, width: 8, height: 10, wallSpeed: 1, prep: 2, settle: 0, measure: 4, sample: 0.5 },
};

function strip(r: ReturnType<UB0Run['result']>) {
  const { timing, ...rest } = r;
  void timing;
  return JSON.stringify(rest);
}

function straight(spec: UB0Spec) {
  const run = new UB0Run(spec);
  let steps = 0;
  while (!run.done) steps += run.advance(1000);
  return { result: strip(run.result()), steps };
}

describe('UB-0 instrument: Universe A path (N_c = 1)', () => {
  it('N_c = 1 reproduces the Universe A engine bit for bit', () => {
    const spec = tiny.static;
    const run = new UB0Run({ ...spec, prep: 50 });
    // the same gas and configuration built directly with the Universe A engine
    const L = 12;
    const domain = { xmin: 0, xmax: L, ymin: 0, ymax: L, periodicX: true, periodicY: true };
    const count = Math.round((0.2 / (Math.PI / 4)) * L * L);
    const { store } = createGas({ count, radius: 0.5, mass: 1, kT: 1, distribution: 'maxwell', seed: spec.seed, domain, removeDrift: true, exactKT: true });
    const sim = new Simulation(
      {
        domain,
        walls: [],
        collision: { enabled: true, restitution: 1, contact: 'rewind-to-contact', dissipationTarget: 'external' },
        timestep: { kind: 'adaptive', courant: 0.025, dtMax: 1, dtMin: 1e-7 },
        seed: spec.seed,
        referenceKT: 1,
      },
      store,
    );
    expect(run.sim.forceModels).toHaveLength(0);
    for (let k = 0; k < 400; k++) {
      run.sim.step();
      sim.step();
    }
    const a = run.sim.store;
    for (const f of ['x', 'y', 'vx', 'vy'] as const) {
      expect(Buffer.from(a[f].buffer).equals(Buffer.from(store[f].buffer))).toBe(true);
    }
    expect(run.sim.time).toBe(sim.time);
    expect(run.sim.log.count).toBe(sim.log.count);
  });

  for (const kind of Object.keys(tiny)) {
    it(`checkpoint/resume is byte-identical (${kind})`, () => {
      const spec = tiny[kind];
      const ref = straight(spec);
      for (const cut of [7, Math.floor(ref.steps / 2), ref.steps - 5]) {
        const run = new UB0Run(spec);
        let taken = 0;
        while (taken < cut && !run.done) taken += run.advance(Math.min(13, cut - taken));
        const state = JSON.parse(JSON.stringify(run.checkpoint()));
        const resumed = UB0Run.resume(state);
        while (!resumed.done) resumed.advance(1000);
        expect(strip(resumed.result())).toBe(ref.result);
      }
    });
  }

  it('the runner job resumes from an on-disk checkpoint without duplicating samples', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub0-'));
    try {
      const spec = tiny.shear;
      const ref = straight(spec);
      const run = new UB0Run(spec);
      run.advance(Math.floor(ref.steps * 0.6));
      writeJsonGz(join(dir, 'state.json.gz'), run.checkpoint());
      const r = runJob({ spec, statePath: join(dir, 'state.json.gz'), resultPath: join(dir, 'res.json.gz'), checkpointSeconds: 0 });
      expect(r.resumed).toBe(true);
      const res = readJsonGz<ReturnType<UB0Run['result']>>(join(dir, 'res.json.gz'));
      expect(strip(res)).toBe(ref.result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Universe A ledgers close: energy and momentum to round-off in a periodic box', () => {
    const run = new UB0Run(tiny.static);
    while (!run.done) run.advance(1000);
    const r = run.result();
    const m = r.phaseLedgers.measure as { relativeEnergyResidual: number; relativeMomentumResidual: number; lateContactsUnexplained: number };
    expect(Math.abs(m.relativeEnergyResidual)).toBeLessThan(1e-11);
    expect(m.relativeMomentumResidual).toBeLessThan(1e-11);
    expect(r.info.rescaleVelocityFactor).toBeGreaterThan(0);
  });

  it('the Stage 0 plan is Universe A only, with unique seeds in its block', () => {
    const p = stage0Plan({ reserve: true });
    expect(p.every((s) => s.Nc === 1 && s.e === 1)).toBe(true);
    const seeds = p.map((s) => s.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(Math.min(...seeds)).toBe(10001);
    expect(Math.max(...seeds)).toBe(10424);
    const planned = stage0Plan();
    expect(planned.length).toBe(8 + 8 + 8 + 8 + 48 + 96 + 12 + 4 + 8 + 4 + 4 + 4);
  });
});
