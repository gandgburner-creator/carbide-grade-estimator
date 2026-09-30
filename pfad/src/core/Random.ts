/**
 * Deterministic pseudo-random numbers.
 *
 * Generator: sfc32 ("Small Fast Counting", C. Doty-Humphrey; passes PractRand),
 * seeded through splitmix32 from (seed, stream). Only 32-bit integer operations
 * are used (Math.imul, |0, >>>), so a given (seed, stream) produces the same
 * sequence on every JavaScript engine. This is what makes experiments
 * replayable from a stored seed (Bible §32).
 *
 * Streams: independent sub-generators derived from one experiment seed. PFAD
 * uses separate streams for initial positions, initial velocities and wall
 * re-emission, so that e.g. switching a wall from specular to diffuse does not
 * change the initial condition of an A/B comparison.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  readonly seed: number;
  readonly stream: number;

  constructor(seed: number, stream = 0) {
    if (!Number.isInteger(seed)) throw new Error(`Rng seed must be an integer, got ${seed}`);
    this.seed = seed;
    this.stream = stream;
    let s = (seed ^ Math.imul(stream + 0x632be5ab, 0x9e3779b9)) >>> 0;
    const splitmix32 = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = splitmix32();
    this.b = splitmix32();
    this.c = splitmix32();
    this.d = splitmix32();
    for (let i = 0; i < 16; i++) this.nextU32();
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform double in [0, 1) with 53 bits of resolution. */
  next(): number {
    const hi = this.nextU32() >>> 5; // 27 bits
    const lo = this.nextU32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform double in (0, 1]; safe as the argument of Math.log. */
  nextOpen(): number {
    return 1 - this.next();
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal variate (Box–Muller, no cached pair: one call = two uniforms). */
  gaussian(): number {
    const u1 = this.nextOpen();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Internal state, for checkpoint/replay. */
  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = state;
  }
}

/** Named, fixed stream ids so experiments stay reproducible when code is reordered. */
export const RNG_STREAM = {
  positions: 1,
  velocities: 2,
  walls: 3,
  perturbation: 4,
  analysis: 5,
} as const;
