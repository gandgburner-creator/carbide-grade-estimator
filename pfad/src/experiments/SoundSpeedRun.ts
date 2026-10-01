import { MODEL_A, PulseRun, type PulseCase, type PulseParams, type PulseRunResult } from './PressurePulseExperiment';

/**
 * SMALL-AMPLITUDE SOUND SPEED — one run (Item 2, docs/CRITERIA_SOUND_SPEED.md).
 *
 * Physics: exactly `PulseRun` (subclass; nothing physical is overridden):
 * a periodic L × H box of rigid elastic disks (Universe A) relaxes for
 * `equilibrationTime`, peculiar velocities are rescaled once to kT (A-04), and
 * the disturbance is applied at t = 0 of phase 2:
 *   'density' — extra particles (fractional excess A) placed by random
 *               sequential addition among the existing ones in the central
 *               slab |x − L/2| < w/2, Maxwellian at the current kT;
 *   'kick'    — slab particles receive an outward velocity ±U.
 * No sound speed, equation of state or wave model enters the run.
 *
 * Measurement only (this class): every `snapshotInterval` on a fixed time grid,
 * bins of width `binWidth` across the box give, per bin, Σ m v_x, the particle
 * count and Σ m v_x². Folded about the slab centre (distance d ≥ 0, outward
 * positive on both sides):
 *   j(d)  outward momentum density   (Σ m v_x)_right − (Σ m v_x)_left, / 2·area
 *   δn(d) number-density excess       mean of both sides − box mean
 *   δs(d) kinetic x-stress excess     Σ m v_x² (both sides) / 2·area − box mean
 * and, per side, j_R(d) and j_L(d). These are averaged over probe windows of
 * width p centred at the probe distances, for each probe width in `widths`
 * (j) and for the primary width (δn, δs, j_R, j_L). A coarse folded j field
 * (every `fieldEvery`-th snapshot, bins of `fieldBin`) is kept for x–t plots.
 */
export type SoundRole = 'amplitude' | 'control' | 'variant';
export type VariantKind = 'timestep' | 'domain-length' | 'strip-height' | 'particle-radius' | 'disturbance-type' | 'slab-width';

export interface SoundCase extends PulseCase {
  role: SoundRole;
  /** variants: what is varied relative to the reference case, and whether the comparison is a pass/fail criterion */
  variant?: { kind: VariantKind; judged: boolean };
}

export interface SoundMeasurement {
  probes: number[];
  /** primary probe width first */
  widths: number[];
  binWidth: number;
  snapshotInterval: number;
  fieldBin: number;
  fieldEvery: number;
}

export interface SoundParamsBase extends PulseParams {
  cases: SoundCase[];
  measurement: SoundMeasurement;
}

export interface SoundRunData {
  /** actual sample times (fixed grid k·Δt; the step that crosses a grid time is sampled) */
  times: number[];
  gridDeviationMax: number;
  /** j at each probe width: flattened [probe][sample] */
  j: Float32Array[];
  n: Float32Array;
  s: Float32Array;
  jR: Float32Array;
  jL: Float32Array;
  field: Float32Array;
  fieldBins: number;
  fieldTimes: number[];
  inserted: number;
  realizedAmplitude: number;
}

export type SoundRunResult = PulseRunResult & { sound: SoundRunData };

export const SOUND_MODEL = MODEL_A;

export class SoundRun extends PulseRun {
  private readonly m: SoundMeasurement;
  private readonly maxSnap: number;
  private readonly nb: number;
  private readonly cnt: Float64Array;
  private readonly mom: Float64Array;
  private readonly kin: Float64Array;
  private readonly jw: Float32Array[];
  private readonly nw: Float32Array;
  private readonly sw: Float32Array;
  private readonly jRw: Float32Array;
  private readonly jLw: Float32Array;
  private readonly fieldBins: number;
  private readonly field: Float32Array;
  private readonly fieldTimes: number[] = [];
  private ns = 0;
  private gridDev = 0;
  /** probe bin ranges [q0, q1) per width */
  private readonly ranges: [number, number][][];

  constructor(p: SoundParamsBase, caseIndex: number, seed: number) {
    super(p, caseIndex, seed);
    const c = this.c;
    const m = p.measurement;
    this.m = m;
    this.nb = Math.round(c.length / m.binWidth);
    if (this.nb % 2 !== 0 || Math.abs(this.nb * m.binWidth - c.length) > 1e-9) throw new Error('length must be an even multiple of the bin width');
    this.maxSnap = Math.floor(c.duration / m.snapshotInterval + 1e-9) + 2;
    this.cnt = new Float64Array(this.nb);
    this.mom = new Float64Array(this.nb);
    this.kin = new Float64Array(this.nb);
    const P = m.probes.length;
    this.jw = m.widths.map(() => new Float32Array(P * this.maxSnap));
    this.nw = new Float32Array(P * this.maxSnap);
    this.sw = new Float32Array(P * this.maxSnap);
    this.jRw = new Float32Array(P * this.maxSnap);
    this.jLw = new Float32Array(P * this.maxSnap);
    this.ranges = m.widths.map((w) => m.probes.map((d) => [Math.max(0, Math.round((d - w / 2) / m.binWidth)), Math.min(this.nb / 2, Math.round((d + w / 2) / m.binWidth))] as [number, number]));
    this.fieldBins = Math.floor(this.nb / 2 / Math.round(m.fieldBin / m.binWidth));
    this.field = new Float32Array(this.fieldBins * (Math.floor(this.maxSnap / m.fieldEvery) + 1));
  }

  protected override snapshot(): void {
    const c = this.c;
    const m = this.m;
    const nb = this.nb;
    const half = nb / 2;
    const b = m.binWidth;
    const { x, vx, mass } = this.store;
    this.cnt.fill(0);
    this.mom.fill(0);
    this.kin.fill(0);
    let kinTot = 0;
    for (let i = 0; i < this.store.count; i++) {
      let q = Math.floor(x[i] / b);
      if (q < 0) q = 0;
      else if (q >= nb) q = nb - 1;
      const pv = mass[i] * vx[i];
      this.cnt[q]++;
      this.mom[q] += pv;
      this.kin[q] += pv * vx[i];
      kinTot += pv * vx[i];
    }
    const area = b * c.height;
    const nbar = this.meanDensity;
    const sbar = kinTot / (c.length * c.height);
    const k = this.ns;
    if (k < this.maxSnap) {
      const T = this.maxSnap;
      const fold = (q: number) => ({ r: half + q, l: half - 1 - q });
      const avg = (q0: number, q1: number, f: (q: number) => number) => {
        let s = 0;
        for (let q = q0; q < q1; q++) s += f(q);
        return q1 > q0 ? s / (q1 - q0) : Number.NaN;
      };
      const jF = (q: number) => {
        const { r, l } = fold(q);
        return (this.mom[r] - this.mom[l]) / (2 * area);
      };
      m.widths.forEach((_, wi) => {
        this.ranges[wi].forEach(([q0, q1], pi) => {
          this.jw[wi][pi * T + k] = avg(q0, q1, jF);
        });
      });
      this.ranges[0].forEach(([q0, q1], pi) => {
        this.nw[pi * T + k] = avg(q0, q1, (q) => {
          const { r, l } = fold(q);
          return (this.cnt[r] + this.cnt[l]) / (2 * area) - nbar;
        });
        this.sw[pi * T + k] = avg(q0, q1, (q) => {
          const { r, l } = fold(q);
          return (this.kin[r] + this.kin[l]) / (2 * area) - sbar;
        });
        this.jRw[pi * T + k] = avg(q0, q1, (q) => this.mom[half + q] / area);
        this.jLw[pi * T + k] = avg(q0, q1, (q) => -this.mom[half - 1 - q] / area);
      });
      if (k % m.fieldEvery === 0) {
        const per = Math.round(m.fieldBin / b);
        const row = k / m.fieldEvery;
        for (let f = 0; f < this.fieldBins; f++) this.field[row * this.fieldBins + f] = avg(f * per, (f + 1) * per, jF);
        this.fieldTimes.push(this.sim.time);
      }
    }
    this.gridDev = Math.max(this.gridDev, Math.abs(this.sim.time - k * m.snapshotInterval));
    this.times.push(this.sim.time);
    this.ns++;
    this.nextSnapshot = this.ns * m.snapshotInterval;
  }

  override result(): SoundRunResult {
    const base = super.result();
    const T = this.maxSnap;
    const nT = Math.min(this.ns, T);
    const P = this.m.probes.length;
    const trim = (a: Float32Array) => {
      const out = new Float32Array(P * nT);
      for (let p = 0; p < P; p++) out.set(a.subarray(p * T, p * T + nT), p * nT);
      return out;
    };
    const c = this.c;
    const n0 = (this.store.count - this.extra) / (c.length * c.height);
    return {
      ...base,
      outward: [],
      outwardDensity: [],
      sound: {
        times: this.times.slice(0, nT),
        gridDeviationMax: this.gridDev,
        j: this.jw.map(trim),
        n: trim(this.nw),
        s: trim(this.sw),
        jR: trim(this.jRw),
        jL: trim(this.jLw),
        field: this.field.slice(0, this.fieldBins * this.fieldTimes.length),
        fieldBins: this.fieldBins,
        fieldTimes: this.fieldTimes.slice(),
        inserted: this.extra,
        realizedAmplitude: c.perturbation === 'density' ? this.extra / (n0 * c.slabWidth * c.height) : Number.NaN,
      },
    };
  }
}
