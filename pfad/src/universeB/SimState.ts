import type { Simulation } from '../core/Simulation';
import type { SafetyCode, SafetyFlag } from '../core/Safety';
import type { ParticleStore } from '../core/ParticleStore';

/**
 * Exact capture and restore of a Simulation's dynamical state, for mid-run
 * checkpoints (UB-0 runner). Restoring into a freshly constructed Simulation
 * with the same configuration and store capacity reproduces the remaining
 * trajectory bit for bit (tests/universeB.simstate.test.ts).
 *
 * Typed arrays are stored as base64 of their raw bytes (exact, including −0).
 * The collision log's ring buffer is NOT stored: its aggregates are, and the
 * UB-0 runs consume every event in the step that produced it, so no event is
 * read after a checkpoint. Spatial grids are rebuilt every step and carry no state.
 *
 * Private fields of Simulation, HardDiskCollider and CollisionLog are reached by
 * structural casts; nothing in the engine is modified.
 */
export interface Typed {
  t: 'f64' | 'i32' | 'u32';
  b64: string;
}

export function encode(a: Float64Array | Int32Array | Uint32Array, n = a.length): Typed {
  const t = a instanceof Float64Array ? 'f64' : a instanceof Int32Array ? 'i32' : 'u32';
  const bytes = new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT);
  return { t, b64: Buffer.from(bytes).toString('base64') };
}

export function decodeInto(target: Float64Array | Int32Array | Uint32Array, e: Typed): number {
  const buf = Buffer.from(e.b64, 'base64');
  const per = target.BYTES_PER_ELEMENT;
  const n = buf.length / per;
  if (n > target.length) throw new Error(`typed array too small: ${n} > ${target.length}`);
  const view = new Uint8Array(target.buffer, target.byteOffset, n * per);
  view.set(buf);
  return n;
}

export function encodeF64(a: ArrayLike<number>): Typed {
  return encode(Float64Array.from(a));
}

export function decodeF64(e: Typed): Float64Array {
  const buf = Buffer.from(e.b64, 'base64');
  const out = new Float64Array(buf.length / 8);
  new Uint8Array(out.buffer).set(buf);
  return out;
}

const STORE_F64 = ['x', 'y', 'vx', 'vy', 'fx', 'fy', 'mass', 'radius', 'energy', 'deformation'] as const;
const STORE_U32 = ['id', 'collisions', 'wallHits'] as const;
const WALL_ARRAYS = [
  'hits',
  'normalImpulse',
  'tangentialImpulse',
  'energyIn',
  'incidentEnergy',
  'emittedEnergy',
  'incidentTangential',
  'emittedTangential',
  'diffuseHits',
] as const;
const LOG_SCALARS = [
  'count',
  'sumImpulse',
  'sumDKE',
  'sumVn2',
  'lateContacts',
  'lateContactsUnexplained',
  'multiCollisions',
  'degenerateContacts',
  'maxOverlapFraction',
] as const;

export interface StoreState {
  count: number;
  nextId: number;
  f64: Record<string, Typed>;
  u32: Record<string, Typed>;
}

export function captureStore(s: ParticleStore): StoreState {
  const f64: Record<string, Typed> = {};
  const u32: Record<string, Typed> = {};
  for (const k of STORE_F64) f64[k] = encode(s[k], s.count);
  for (const k of STORE_U32) u32[k] = encode(s[k], s.count);
  return { count: s.count, nextId: s.nextId, f64, u32 };
}

export function restoreStore(s: ParticleStore, st: StoreState): void {
  if (st.count > s.capacity) throw new Error('store capacity too small for the checkpoint');
  s.count = st.count;
  s.nextId = st.nextId;
  for (const k of STORE_F64) decodeInto(s[k], st.f64[k]);
  for (const k of STORE_U32) decodeInto(s[k], st.u32[k]);
}

export interface SimState {
  store: StoreState;
  time: number;
  stepCount: number;
  lastDt: number;
  potentialEnergy: number;
  halted: boolean;
  flags: SafetyFlag[];
  warned: SafetyCode[];
  E0: number;
  P0: { x: number; y: number };
  momentumScale: number;
  referenceKT: number;
  wallRng: [number, number, number, number];
  boundaryRng: [number, number, number, number];
  ledger: Record<string, number>;
  log: Record<string, number>;
  colliderLastStep: Typed;
  colliderLastEvent: Typed;
  walls: { arrays: Record<string, Typed>; lateContacts: number }[];
}

interface SimPrivate {
  wallRng: { getState(): [number, number, number, number]; setState(s: readonly [number, number, number, number]): void };
  boundaryRng: { getState(): [number, number, number, number]; setState(s: readonly [number, number, number, number]): void };
  warned: Set<SafetyCode>;
  E0: number;
  P0: { x: number; y: number };
  momentumScale: number;
  referenceKT: number;
}

export function captureSimulation(sim: Simulation): SimState {
  const p = sim as unknown as SimPrivate;
  const c = sim.collider as unknown as { lastStep: Int32Array; lastEventStep: Int32Array };
  const log = sim.log as unknown as Record<string, number>;
  const ledger: Record<string, number> = { ...(sim.ledger.toJSON() as Record<string, number>) };
  const logState: Record<string, number> = {};
  for (const k of LOG_SCALARS) logState[k] = log[k];
  return {
    store: captureStore(sim.store),
    time: sim.time,
    stepCount: sim.stepCount,
    lastDt: sim.lastDt,
    potentialEnergy: sim.potentialEnergy,
    halted: sim.halted,
    flags: sim.flags.map((f) => ({ ...f })),
    warned: [...p.warned],
    E0: p.E0,
    P0: { ...p.P0 },
    momentumScale: p.momentumScale,
    referenceKT: p.referenceKT,
    wallRng: p.wallRng.getState(),
    boundaryRng: p.boundaryRng.getState(),
    ledger,
    log: logState,
    colliderLastStep: encode(c.lastStep, sim.store.count),
    colliderLastEvent: encode(c.lastEventStep, sim.store.count),
    walls: sim.walls.map((w) => {
      const arrays: Record<string, Typed> = {};
      for (const k of WALL_ARRAYS) arrays[k] = encode(w[k]);
      return { arrays, lateContacts: w.lateContacts };
    }),
  };
}

/** Restore into a Simulation freshly constructed with the same configuration and store capacity. */
export function restoreSimulation(sim: Simulation, st: SimState): void {
  const p = sim as unknown as SimPrivate;
  const c = sim.collider as unknown as { lastStep: Int32Array; lastEventStep: Int32Array };
  const log = sim.log as unknown as Record<string, number>;
  restoreStore(sim.store, st.store);
  sim.time = st.time;
  sim.stepCount = st.stepCount;
  sim.lastDt = st.lastDt;
  sim.potentialEnergy = st.potentialEnergy;
  sim.halted = st.halted;
  sim.flags.length = 0;
  sim.flags.push(...st.flags.map((f) => ({ ...f })));
  p.warned.clear();
  for (const w of st.warned) p.warned.add(w);
  p.E0 = st.E0;
  p.P0 = { ...st.P0 };
  p.momentumScale = st.momentumScale;
  p.referenceKT = st.referenceKT;
  p.wallRng.setState(st.wallRng);
  p.boundaryRng.setState(st.boundaryRng);
  Object.assign(sim.ledger, st.ledger);
  for (const k of LOG_SCALARS) log[k] = st.log[k];
  // the ring buffer starts empty after a restore (see header)
  (sim.log as unknown as { head: number; size: number }).head = 0;
  (sim.log as unknown as { head: number; size: number }).size = 0;
  c.lastStep.fill(-10);
  c.lastEventStep.fill(-10);
  decodeInto(c.lastStep, st.colliderLastStep);
  decodeInto(c.lastEventStep, st.colliderLastEvent);
  if (st.walls.length !== sim.walls.length) throw new Error('wall count differs from the checkpoint');
  st.walls.forEach((w, i) => {
    const wall = sim.walls[i];
    for (const k of WALL_ARRAYS) decodeInto(wall[k], w.arrays[k]);
    wall.lateContacts = w.lateContacts;
  });
}
