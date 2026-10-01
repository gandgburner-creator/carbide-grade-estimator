import { hendersonCompressibility, idealSoundSpeed2D } from '../benchmarks/KineticTheory';
import { aggregateEmptySpace, type EmptySpaceSummary } from '../measurements/EmptySpaceMonitor';
import { jackknifeSe } from '../measurements/ArrivalAnalysis';
import { mean } from '../measurements/Statistics';
import { check, combineStatus, type AcceptanceCheck, type ValidationStatus } from '../validation/Status';
import { recordHeader, SequentialExperiment, type ExperimentRecord, type Run } from './Experiment';
import {
  decimate,
  equivalence,
  featureAnalysis,
  primaryAnalysis,
  t95,
  weightedPoly,
  type AnalysisOptions,
  type PrimaryResult,
  type Series3,
} from './SoundSpeedAnalysis';
import { SOUND_MODEL, SoundRun, type SoundCase, type SoundParamsBase, type SoundRunResult } from './SoundSpeedRun';

/**
 * SMALL-AMPLITUDE SOUND SPEED (Item 2). Criteria, rationale and the validation
 * plan: docs/CRITERIA_SOUND_SPEED.md (pre-registered). Run physics: SoundRun
 * (= PulseRun, Universe A). Analysis: SoundSpeedAnalysis (model-free).
 *
 * Cases: an amplitude series of density disturbances, a zero-amplitude
 * control, and variants at the reference amplitude (timestep, domain length,
 * strip height, particle radius; disturbance type and slab width reported
 * only). Every case uses the same seeds, so differences and the zero-amplitude
 * extrapolation are jackknifed jointly over seeds.
 */
export interface SoundCriteria {
  /** detection: aligned-stack SNR ≥ detectSigma and ≥ probeDetectFraction of probes with correlation significance ≥ probeDetectSigma */
  detectSigma: number;
  probeDetectSigma: number;
  probeDetectFraction: number;
  /** competing features count if ≥ this fraction of the main one (and significant at detectSigma) */
  competingFraction: number;
  /** two-sided z thresholds: PASS below zPass, FAIL above zFail */
  zPass: number;
  zFail: number;
  /** distance linearity: minimum R² of arrival time against distance */
  r2Min: number;
  /** minimum number of amplitudes in the zero-amplitude extrapolation */
  minAmplitudes: number;
  /** precision: 95 % CI half-width of the zero-amplitude speed, relative */
  precision: number;
  /** equivalence margin for invariance tests (relative speed difference) */
  equivalence: number;
  /** amplitude at which variants are compared */
  referenceAmplitude: number;
  /** independent seed groups reported (split-half is the criterion) */
  groups: number;
  /** an inward-moving coherent wave counts as detected if its aligned stack is ≥ detectSigma AND its stack power is ≥ this fraction of the outward maximum (separates a real reflected pulse from partial alignment of the strong outward pulse) */
  inwardPowerRatio: number;
}

export interface SoundParams extends SoundParamsBase {
  analysis: Omit<AnalysisOptions, 'detectSigma' | 'probeDetectSigma' | 'probeDetectFraction' | 'competingFraction'> & {
    /** re-analysis: alternative window end (measurement-window test) and decimation stride (time-resolution test) */
    tEndVariant: number;
    timeStride: number;
  };
  criteria: SoundCriteria;
  /** store the per-seed primary probe series of amplitude/control cases in the record */
  storeSeries: boolean;
}

const DENSITY_CASE: Omit<SoundCase, 'label' | 'role'> = {
  model: SOUND_MODEL,
  areaFraction: 0.2,
  kT: 1,
  radius: 0.5,
  mass: 1,
  perturbation: 'density',
  amplitude: 0.2,
  slabWidth: 20,
  equilibrationTime: 30,
  rescaleAfterEquilibration: true,
  length: 600,
  height: 120,
  duration: 120,
  snapshotInterval: 0.5,
  binWidth: 2,
};

export const SOUND_AMPLITUDES = [0.4, 0.3, 0.2, 0.1, 0.05];

export const SOUND_VALIDATION: SoundParams = {
  cases: [
    ...SOUND_AMPLITUDES.map((a) => ({ ...DENSITY_CASE, label: `A = ${a}`, role: 'amplitude' as const, amplitude: a })),
    { ...DENSITY_CASE, label: 'control A = 0', role: 'control', amplitude: 0 },
    { ...DENSITY_CASE, label: 'Courant 0.05', role: 'variant', variant: { kind: 'timestep', judged: true }, timestep: { kind: 'adaptive', courant: 0.05, dtMax: 0.05, dtMin: 1e-7 } },
    { ...DENSITY_CASE, label: 'L = 900', role: 'variant', variant: { kind: 'domain-length', judged: true }, length: 900 },
    { ...DENSITY_CASE, label: 'H = 240', role: 'variant', variant: { kind: 'strip-height', judged: true }, height: 240 },
    { ...DENSITY_CASE, label: 'radius 0.35, H = 60', role: 'variant', variant: { kind: 'particle-radius', judged: true }, radius: 0.35, height: 60 },
    { ...DENSITY_CASE, label: 'velocity kick U = 0.2', role: 'variant', variant: { kind: 'disturbance-type', judged: false }, perturbation: 'kick', amplitude: 0.2 },
    { ...DENSITY_CASE, label: 'slab width 40', role: 'variant', variant: { kind: 'slab-width', judged: false }, slabWidth: 40 },
  ],
  // fresh validation seeds, never used by any earlier run (design pilots used 5001–5199)
  seeds: Array.from({ length: 32 }, (_, k) => 6001 + k),
  contact: 'rewind-to-contact',
  timestep: { kind: 'adaptive', courant: 0.025, dtMax: 0.05, dtMin: 1e-7 },
  forceEnergyTolerance: 1e-3,
  measurement: {
    probes: Array.from({ length: 17 }, (_, k) => 30 + 10 * k),
    widths: [10, 4, 20],
    binWidth: 2,
    snapshotInterval: 0.5,
    fieldBin: 4,
    fieldEvery: 2,
  },
  analysis: { sMin: 0.02, sMax: 2, sStep: 0.0025, tEnd: 120, halfRange: 15, tauStep: 0.125, tEndVariant: 110, timeStride: 2 },
  criteria: {
    detectSigma: 5,
    probeDetectSigma: 3,
    probeDetectFraction: 0.75,
    competingFraction: 0.5,
    zPass: 3,
    zFail: 5,
    r2Min: 0.99,
    minAmplitudes: 3,
    precision: 0.05,
    equivalence: 0.05,
    referenceAmplitude: 0.2,
    groups: 4,
    inwardPowerRatio: 0.25,
  },
  storeSeries: true,
};

interface Spec {
  caseIndex: number;
  seed: number;
}

const round = (a: ArrayLike<number>) => Array.from(a, (v) => (Number.isFinite(v) ? +v.toPrecision(5) : null));

export class SoundSpeedExperiment extends SequentialExperiment<Spec, SoundRunResult> {
  readonly type = 'sound-speed-validation' as const;
  readonly params: SoundParams;

  constructor(p: SoundParams) {
    const specs: Spec[] = [];
    p.cases.forEach((_, i) => {
      for (const seed of p.seeds) specs.push({ caseIndex: i, seed });
    });
    super(specs);
    this.params = p;
  }

  protected createRun(spec: Spec): Run<SoundRunResult> {
    return new SoundRun(this.params, spec.caseIndex, spec.seed);
  }

  private opts(): AnalysisOptions {
    const a = this.params.analysis;
    const c = this.params.criteria;
    return { sMin: a.sMin, sMax: a.sMax, sStep: a.sStep, tEnd: a.tEnd, halfRange: a.halfRange, tauStep: a.tauStep, detectSigma: c.detectSigma, probeDetectSigma: c.probeDetectSigma, probeDetectFraction: c.probeDetectFraction, competingFraction: c.competingFraction };
  }

  /** [probe][seed][sample] for one observable of one case; runs in seed order */
  private series(runs: SoundRunResult[], pick: (r: SoundRunResult) => Float32Array): Series3 {
    const P = this.params.measurement.probes.length;
    const nT = Math.min(...runs.map((r) => r.sound.times.length));
    return Array.from({ length: P }, (_, p) =>
      runs.map((r) => {
        const a = pick(r);
        const T = r.sound.times.length;
        return Array.from(a.subarray(p * T, p * T + nT));
      }),
    );
  }

  buildRecord(): ExperimentRecord {
    const p = this.params;
    const m = p.measurement;
    const cr = p.criteria;
    const opt = this.opts();
    const d = m.probes;
    const checks: AcceptanceCheck[] = [];
    const warnings: string[] = [];
    const all = this.results;
    const S = p.seeds.length;
    const runsOf = (i: number) => p.seeds.map((s) => all.find((r) => r.caseIndex === i && r.seed === s)).filter((r): r is SoundRunResult => !!r && !r.halted);
    const dof = S - 1;

    // ---------------------------------------------------------------- per case
    const caseResults = p.cases.map((c, i) => {
      const runs = runsOf(i);
      if (runs.length < S) return { label: c.label, role: c.role, missing: S - runs.length };
      const times = runs[0].sound.times.map((_, k) => k * m.snapshotInterval);
      const J = this.series(runs, (r) => r.sound.j[0]);
      const primary = primaryAnalysis(J, d, times, opt);
      const nT = times.filter((t) => t <= opt.tEnd).length;
      const features = [
        featureAnalysis('momentum peak (centroid ≥ ½ max)', J, d, times, (f) => f.tPeak, { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
        featureAnalysis('momentum front (leading ½-max crossing)', J, d, times, (f) => f.tFront, { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
        featureAnalysis('momentum tail (trailing ½-max crossing)', J, d, times, (f) => f.tTail, { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
        featureAnalysis('density-excess peak', this.series(runs, (r) => r.sound.n), d, times, (f) => f.tPeak, { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
        featureAnalysis('kinetic-stress peak', this.series(runs, (r) => r.sound.s), d, times, (f) => f.tPeak, { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
        featureAnalysis('momentum minimum after the peak (rarefaction / inward wave)', J, d, times, (f) => (f.minimum && f.minimum.significant ? f.minimum.t : Number.NaN), { detectSigma: cr.detectSigma, tEnd: opt.tEnd }),
      ];
      // competing peaks at single probes (reported)
      const peakAtProbes = features[0].probes;
      const right = primaryAnalysis(this.series(runs, (r) => r.sound.jR), d, times, opt);
      const left = primaryAnalysis(this.series(runs, (r) => r.sound.jL), d, times, opt);
      const half = Math.ceil(d.length / 2);
      const inner = primaryAnalysis(J.slice(0, half), d.slice(0, half), times, opt);
      const outer = primaryAnalysis(J.slice(d.length - half), d.slice(d.length - half), times, opt);
      const pair = (a: number, b: number) => ({ from: d[a], to: d[b], speed: (d[b] - d[a]) / (primary.delays[b] - primary.delays[a]), se: jackknifeSe(primary.loo.delays.map((q) => (d[b] - d[a]) / (q[b] - q[a]))) });
      const pairwise = [...d.slice(0, -1).map((_, k) => pair(k, k + 1)), pair(0, half - 1), pair(half - 1, d.length - 1), pair(0, d.length - 1)];
      // ensemble coarse field for x–t plots
      const fb = runs[0].sound.fieldBins;
      const fr = Math.min(...runs.map((r) => r.sound.fieldTimes.length));
      const field = new Array<number>(fb * fr).fill(0);
      for (const r of runs) for (let k = 0; k < fb * fr; k++) field[k] += r.sound.field[k] / runs.length;
      const peakHeights = features[0].probes.map((q) => q.snr);
      return {
        label: c.label,
        role: c.role,
        variant: c.variant ?? null,
        case: { ...c, model: undefined },
        seeds: runs.length,
        amplitude: c.amplitude,
        realizedAmplitude: mean(runs.map((r) => r.sound.realizedAmplitude)),
        inserted: mean(runs.map((r) => r.sound.inserted)),
        particles: mean(runs.map((r) => r.count)),
        kTStart: mean(runs.map((r) => r.kTStart)),
        kTEnd: mean(runs.map((r) => r.kTEnd)),
        gridDeviationMax: Math.max(...runs.map((r) => r.sound.gridDeviationMax)),
        energyResidualMax: Math.max(...runs.map((r) => r.conservation.maxAbsRelativeEnergyResidual)),
        primary,
        features,
        peakAtProbes,
        peakSnrAtProbes: peakHeights,
        sides: { right: { speed: right.speed, se: right.se, detected: right.detected }, left: { speed: left.speed, se: left.se, detected: left.detected } },
        placement: {
          inner: { probes: d.slice(0, half), speed: inner.speed, se: inner.se, detected: inner.detected, loo: inner.loo.speed },
          outer: { probes: d.slice(d.length - half), speed: outer.speed, se: outer.se, detected: outer.detected, loo: outer.loo.speed },
        },
        pairwise,
        linearResponse: { templatePeak: primary.templatePeak, templatePeakPerAmplitude: c.amplitude > 0 ? primary.templatePeak / c.amplitude : null },
        field: { bins: fb, binWidth: m.fieldBin, rows: fr, times: runs[0].sound.fieldTimes.slice(0, fr).map((t) => +t.toFixed(3)), values: round(field) },
        series: p.storeSeries && c.role !== 'variant' ? { observable: 'outward momentum density, primary probe width', perProbe: J.map((ps) => ps.map((s) => round(s.slice(0, nT)))) } : null,
        _J: J,
        _times: times,
      };
    });
    type CaseRes = Extract<(typeof caseResults)[number], { primary: PrimaryResult }>;
    const ok = (x: (typeof caseResults)[number]): x is CaseRes => 'primary' in x;
    const missing = caseResults.filter((x) => !ok(x));

    // ------------------------------------------------------- safety, ledger, space
    const halted = all.filter((r) => r.halted);
    checks.push(check('numerical-safety', 'No run halted by the safety monitor', 'zero failures', halted.length ? `${halted.length} run(s)` : 'none', halted.length === 0));
    const eMax = Math.max(...all.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
    checks.push(check('energy-accounting', 'Rigid elastic disks close the energy ledger to round-off (phase 2)', 'max |relative residual| < 1e-9', eMax.toExponential(2), eMax < 1e-9));
    const empty = aggregateEmptySpace(all.map((r) => r.emptySpace).filter((e): e is EmptySpaceSummary => e !== null));
    checks.push(check('no-empty-space', 'No sustained near-zero-occupancy region (Master prompt §20)', 'no flag', empty.flaggedRuns ? `${empty.flaggedRuns} run(s) flagged` : 'none', empty.flaggedRuns === 0));
    if (missing.length) warnings.push(`cases with missing/halted runs: ${missing.map((x) => x.label).join('; ')}`);

    // ---------------------------------------------------------------- control
    const ctrl = caseResults.find((x) => ok(x) && x.role === 'control') as CaseRes | undefined;
    let controlInfo: unknown = null;
    if (ctrl) {
      const P = ctrl.primary;
      const probeMax = ctrl._J.map((ps) => {
        const nT = ctrl._times.filter((t) => t <= opt.tEnd).length;
        const E = ps[0].slice(0, nT).map((_, k) => mean(ps.map((s) => s[k])));
        const sigma = Math.sqrt(mean(E.map((_, k) => (Math.sqrt(ps.reduce((a, s) => a + (s[k] - E[k]) ** 2, 0) / (ps.length - 1)) / Math.sqrt(ps.length)) ** 2)));
        return Math.max(...E.map((v) => Math.abs(v))) / sigma;
      });
      const signal = P.stackSnr >= cr.detectSigma || P.inward.snr >= cr.detectSigma || probeMax.some((v) => v >= cr.detectSigma);
      controlInfo = { outwardStackSnr: P.stackSnr, inwardStackSnr: P.inward.snr, maxProbeSnr: Math.max(...probeMax), probeSnr: probeMax };
      checks.push(check('S1-control-no-signal', 'No disturbance, no signal: the zero-amplitude control shows no coherent outward or inward pulse and no 5σ excursion at any probe',
        `outward and inward aligned-stack SNR < ${cr.detectSigma}; every probe max |J|/σ < ${cr.detectSigma} (FAIL otherwise: a signal without a disturbance is an artefact)`,
        `outward ${P.stackSnr.toFixed(2)}, inward ${P.inward.snr.toFixed(2)}, max probe ${Math.max(...probeMax).toFixed(2)}`, !signal, 'FAILED'));
    }

    // ------------------------------------------------- amplitude series, extrapolation
    const amps = caseResults.filter((x): x is CaseRes => ok(x) && x.role === 'amplitude').sort((a, b) => b.amplitude - a.amplitude);
    const distLin = (x: CaseRes) => {
      const z = Math.abs(x.primary.curvature.z);
      const status: ValidationStatus = x.primary.fit.r2 >= cr.r2Min && z < cr.zPass ? 'PASSED' : z > cr.zFail ? 'FAILED' : 'INCONCLUSIVE';
      return { r2: x.primary.fit.r2, residualRms: x.primary.fit.residualRms, curvatureZ: x.primary.curvature.z, status };
    };
    const fitSet = (set: CaseRes[]) => {
      const A = set.map((x) => x.amplitude);
      const c = set.map((x) => x.primary.speed);
      const w = set.map((x) => 1 / x.primary.se ** 2);
      const lin = weightedPoly(A, c, w, 1);
      const looLin = Array.from({ length: S }, (_, i) => weightedPoly(A, set.map((x) => x.primary.loo.speed[i]), w, 1));
      const c0se = jackknifeSe(looLin.map((q) => q[0]));
      const slopeSe = jackknifeSe(looLin.map((q) => q[1]));
      let curv = { q: Number.NaN, se: Number.NaN, z: Number.NaN };
      if (set.length >= 3) {
        const quad = weightedPoly(A, c, w, 2);
        const looQ = Array.from({ length: S }, (_, i) => weightedPoly(A, set.map((x) => x.primary.loo.speed[i]), w, 2)[2]);
        const se = jackknifeSe(looQ);
        curv = { q: quad[2], se, z: quad[2] / se };
      }
      const chi2 = set.reduce((a, x, k) => a + ((c[k] - (lin[0] + lin[1] * A[k])) / x.primary.se) ** 2, 0);
      return { amplitudes: A, c0: lin[0], c0Se: c0se, slope: lin[1], slopeSe, curvature: curv, chi2, dofFit: set.length - 2, looC0: looLin.map((q) => q[0]) };
    };
    const detected = amps.filter((x) => x.primary.detected);
    const noiseDominated = amps.filter((x) => !x.primary.detected).map((x) => ({ amplitude: x.amplitude, stackSnr: x.primary.stackSnr, probesDetected: x.primary.probesDetected }));
    let set = detected.slice();
    const dropped: { amplitude: number; reason: string }[] = [];
    while (set.length >= cr.minAmplitudes) {
      const top = set[0];
      const dl = distLin(top);
      const f = fitSet(set);
      const reasons: string[] = [];
      if (top.primary.ambiguous) reasons.push('primary feature ambiguous');
      if (dl.status !== 'PASSED') reasons.push(`distance linearity ${dl.status} (R² ${dl.r2.toFixed(4)}, curvature z ${dl.curvatureZ.toFixed(2)})`);
      if (!(Math.abs(f.curvature.z) < cr.zPass)) reasons.push(`c(A) curvature z ${f.curvature.z.toFixed(2)} over ${set.map((x) => x.amplitude).join(', ')}`);
      if (!reasons.length) break;
      dropped.push({ amplitude: top.amplitude, reason: reasons.join('; ') });
      set = set.slice(1);
    }
    const enough = set.length >= cr.minAmplitudes;
    const fit = enough ? fitSet(set) : null;
    const fitAll = detected.length >= 3 ? fitSet(detected) : null;
    const smallest3 = enough ? fitSet(set.slice(-3)) : null;
    checks.push(check('S2-detection', 'A propagating disturbance is detected at enough amplitudes',
      `aligned-stack SNR ≥ ${cr.detectSigma} and correlation significance ≥ ${cr.probeDetectSigma}σ at ≥ ${Math.round(100 * cr.probeDetectFraction)} % of probes, at ≥ ${cr.minAmplitudes} amplitudes`,
      `detected: ${detected.map((x) => x.amplitude).join(', ') || 'none'}; noise-dominated: ${noiseDominated.map((x) => `${x.amplitude} (SNR ${x.stackSnr.toFixed(1)}, ${x.probesDetected}/${d.length} probes)`).join(', ') || 'none'}`,
      detected.length >= cr.minAmplitudes, 'INCONCLUSIVE'));
    const ambiguousIn = set.filter((x) => x.primary.ambiguous);
    checks.push(check('S3-unambiguous', 'The primary feature is unambiguous at every amplitude used for the extrapolation',
      `no competing coherent moveout or correlation peak ≥ ${cr.competingFraction} of the main one and ≥ ${cr.detectSigma}σ; every leave-one-seed-out moveout and delay inside the main peak's ½-max interval`,
      enough ? (ambiguousIn.length ? ambiguousIn.map((x) => `A = ${x.amplitude}`).join(', ') : `all unambiguous (${set.map((x) => x.amplitude).join(', ')})`) : 'no extrapolation set',
      enough && ambiguousIn.length === 0, 'INCONCLUSIVE'));
    const dls = set.map((x) => ({ amplitude: x.amplitude, ...distLin(x) }));
    const dlStatus: ValidationStatus = !enough ? 'INCONCLUSIVE' : dls.some((q) => q.status === 'FAILED') ? 'FAILED' : dls.every((q) => q.status === 'PASSED') ? 'PASSED' : 'INCONCLUSIVE';
    checks.push(check('S4-distance-linearity', 'Arrival time is linear in distance (constant-speed propagation; probe placement does not change the speed)',
      `R² ≥ ${cr.r2Min} and |curvature z| < ${cr.zPass} at every amplitude used (FAIL if |z| > ${cr.zFail})`,
      enough ? dls.map((q) => `A ${q.amplitude}: R² ${q.r2.toFixed(4)}, z ${q.curvatureZ.toFixed(2)}`).join('; ') : 'no extrapolation set',
      dlStatus === 'PASSED', dlStatus === 'FAILED' ? 'FAILED' : 'INCONCLUSIVE'));
    checks.push(check('S5-amplitude-extrapolation', 'The speed extrapolates linearly to zero amplitude over ≥ 3 amplitudes',
      `c(A) = c₀ + k·A (weighted by jackknife SEs) over the largest top-down set of detected amplitudes with no ambiguity, distance-linear, and |c(A) curvature z| < ${cr.zPass}; ≥ ${cr.minAmplitudes} amplitudes`,
      enough ? `set ${set.map((x) => x.amplitude).join(', ')}; curvature z ${fit!.curvature.z.toFixed(2)}${dropped.length ? `; dropped ${dropped.map((q) => `${q.amplitude} (${q.reason})`).join('; ')}` : ''}` : `only ${set.length} usable amplitude(s)${dropped.length ? `; dropped ${dropped.map((q) => `${q.amplitude} (${q.reason})`).join('; ')}` : ''}`,
      enough, 'INCONCLUSIVE'));
    const relHalf = fit ? (t95(dof) * fit.c0Se) / fit.c0 : Number.NaN;
    checks.push(check('S6-precision', 'Zero-amplitude speed c₀ is precise',
      `95 % CI half-width of c₀ (joint jackknife over seeds, t with ${dof} dof) < ${100 * cr.precision} %`,
      fit ? `c₀ = ${fit.c0.toFixed(4)} ± ${fit.c0Se.toFixed(4)} (SE); 95 % half-width ${(100 * relHalf).toFixed(2)} %` : 'no c₀',
      fit !== null && relHalf < cr.precision, 'INCONCLUSIVE'));

    // ------------------------------------------------------------ split halves, groups
    let reproducibility: unknown = null;
    if (fit) {
      const halves = [0, 1].map((h) => Array.from({ length: S }, (_, i) => i).filter((i) => i % 2 === h));
      const w = set.map((x) => 1 / x.primary.se ** 2);
      const A = set.map((x) => x.amplitude);
      const halfFits = halves.map((idx) => {
        const per = set.map((x) => primaryAnalysis(x._J, d, x._times, opt, idx));
        const c0 = weightedPoly(A, per.map((q) => q.speed), w, 1)[0];
        const loo = idx.map((_, j) => weightedPoly(A, per.map((q) => q.loo.speed[j]), w, 1)[0]);
        return { seeds: idx.map((i) => p.seeds[i]), perAmplitude: per.map((q, k) => ({ amplitude: A[k], speed: q.speed, se: q.se })), c0, se: jackknifeSe(loo) };
      });
      const z = (halfFits[0].c0 - halfFits[1].c0) / Math.hypot(halfFits[0].se, halfFits[1].se);
      const G = cr.groups;
      const groups = Array.from({ length: G }, (_, g) => Array.from({ length: S }, (_, i) => i).filter((i) => i % G === g)).map((idx) => {
        const per = set.map((x) => primaryAnalysis(x._J, d, x._times, opt, idx));
        return { seeds: idx.map((i) => p.seeds[i]), perAmplitude: per.map((q, k) => ({ amplitude: A[k], speed: q.speed })), c0: weightedPoly(A, per.map((q) => q.speed), w, 1)[0] };
      });
      const gc0 = groups.map((g) => g.c0);
      reproducibility = { halves: halfFits, halvesZ: z, groups, groupC0Sd: Math.sqrt(gc0.reduce((a, v) => a + (v - mean(gc0)) ** 2, 0) / (G - 1)) };
      const st: ValidationStatus = Math.abs(z) < cr.zPass ? 'PASSED' : Math.abs(z) > cr.zFail ? 'FAILED' : 'INCONCLUSIVE';
      checks.push(check('S7-seed-reproducibility', 'Two independent halves of the seeds give the same zero-amplitude speed',
        `|z| < ${cr.zPass} for c₀(odd-index seeds) − c₀(even-index seeds), within-half jackknife SEs (FAIL if |z| > ${cr.zFail})`,
        `${halfFits[0].c0.toFixed(4)} ± ${halfFits[0].se.toFixed(4)} vs ${halfFits[1].c0.toFixed(4)} ± ${halfFits[1].se.toFixed(4)}, z = ${z.toFixed(2)}`,
        st === 'PASSED', st === 'FAILED' ? 'FAILED' : 'INCONCLUSIVE'));
    } else {
      checks.push(check('S7-seed-reproducibility', 'Two independent halves of the seeds give the same zero-amplitude speed', 'requires c₀', 'no c₀', false, 'INCONCLUSIVE'));
    }

    // --------------------------------------------------------------- invariance
    const ref = amps.find((x) => x.amplitude === cr.referenceAmplitude);
    const invariance: unknown[] = [];
    const compare = (id: string, what: string, v: PrimaryResult, judged: boolean) => {
      if (!ref) return;
      const r = ref.primary;
      const diff = v.speed - r.speed;
      const se = jackknifeSe(v.loo.speed.map((s, i) => s - r.loo.speed[i]));
      const eq = equivalence(diff / r.speed, se / r.speed, dof, cr.equivalence);
      const usable = v.detected && !v.ambiguous;
      const status: ValidationStatus = usable ? eq.status : 'INCONCLUSIVE';
      invariance.push({ id, what, judged, reference: r.speed, variant: v.speed, variantSe: v.se, difference: diff, differenceSe: se, ...eq, detected: v.detected, ambiguous: v.ambiguous, status });
      if (judged)
        checks.push(check(id, `Speed at A = ${cr.referenceAmplitude} does not depend materially on ${what}`,
          `95 % CI of the relative difference inside ±${100 * cr.equivalence} % (FAIL if entirely outside; variant must be detected and unambiguous)`,
          `${(100 * eq.rel).toFixed(2)} % [${(100 * eq.ci95[0]).toFixed(2)}, ${(100 * eq.ci95[1]).toFixed(2)}]${usable ? '' : ' (variant not detected or ambiguous)'}`,
          status === 'PASSED', status === 'FAILED' ? 'FAILED' : 'INCONCLUSIVE'));
    };
    if (ref) {
      const a = p.analysis;
      const reTimes = ref._times;
      const refRuns = runsOf(caseResults.indexOf(ref));
      compare('S8-probe-width-4', `probe width (4 vs ${m.widths[0]})`, primaryAnalysis(this.series(refRuns, (r) => r.sound.j[1]), d, reTimes, opt), true);
      compare('S8-probe-width-20', `probe width (20 vs ${m.widths[0]})`, primaryAnalysis(this.series(refRuns, (r) => r.sound.j[2]), d, reTimes, opt), true);
      const dec = decimate(ref._J, reTimes, a.timeStride);
      compare('S8-time-resolution', `sampling interval (${a.timeStride * m.snapshotInterval} vs ${m.snapshotInterval})`, primaryAnalysis(dec.per, d, dec.times, { ...opt, tauStep: opt.tauStep * a.timeStride }), true);
      compare('S8-measurement-window', `analysis window end (${a.tEndVariant} vs ${a.tEnd})`, primaryAnalysis(ref._J, d, reTimes, { ...opt, tEnd: a.tEndVariant }), true);
      for (const v of caseResults.filter((x): x is CaseRes => ok(x) && x.role === 'variant')) {
        const kind = v.variant!.kind;
        const id = kind === 'timestep' ? 'S8-timestep' : kind === 'domain-length' ? 'S9-domain-length' : kind === 'strip-height' ? 'S9-strip-height' : kind === 'particle-radius' ? 'S9-particle-radius' : `R-${kind}`;
        compare(id, v.label, v.primary, v.variant!.judged);
      }
    }

    // ---------------------------------------------------------- reflections / window
    const reflection = set.concat(caseResults.filter((x): x is CaseRes => ok(x) && x.role === 'variant')).map((x) => {
      const c = x.case;
      const peak = x.features[0];
      const t0 = peak.fit ? peak.fit.intercept : 0;
      const outerProbe = x.peakAtProbes[x.peakAtProbes.length - 1];
      const fr = x.features[1].probes[x.features[1].probes.length - 1];
      const rise = outerProbe.detected && fr.detected ? Math.max(0, outerProbe.t - fr.t) : 10;
      const cHi = x.primary.speed + 3 * x.primary.se;
      const tWrap = t0 + (c.length - d[d.length - 1]) / cHi - rise;
      return { label: x.label, t0, rise, cHi, earliestWrappedArrival: tWrap, windowEnd: opt.tEnd, clear: tWrap > opt.tEnd, inwardStackSnr: x.primary.inward.snr, inwardRatio: x.primary.inward.ratio, inwardSpeed: x.primary.inward.speed, inwardDetected: x.primary.inward.snr >= cr.detectSigma && x.primary.inward.ratio >= cr.inwardPowerRatio };
    });
    const bad = reflection.filter((q) => !q.clear || q.inwardDetected);
    checks.push(check('S10-reflection-exclusion', 'No wrapped (periodic-image) or reflected wave can reach any probe inside the analysis window, and no coherent inward-moving wave is detected',
      `earliest wrapped arrival at the outermost probe, t₀ + (L − d_max)/(c + 3 SE) − rise time, after the window end; no inward wave with aligned-stack SNR ≥ ${cr.detectSigma} and power ≥ ${cr.inwardPowerRatio} of the outward maximum; for every amplitude used and every variant`,
      bad.length ? bad.map((q) => `${q.label}: wrapped ${q.earliestWrappedArrival.toFixed(1)}, inward SNR ${q.inwardStackSnr.toFixed(1)} (power ratio ${q.inwardRatio.toFixed(3)})`).join('; ') : `clear (earliest wrapped arrival ${Math.min(...reflection.map((q) => q.earliestWrappedArrival)).toFixed(1)} > ${opt.tEnd}; max inward SNR ${Math.max(...reflection.map((q) => q.inwardStackSnr)).toFixed(2)})`,
      bad.length === 0, 'INCONCLUSIVE'));

    // --------------------------------------------------------------- classification
    const status = combineStatus(checks);
    const classification = checks.some((c) => c.status === 'FAILED') ? 'FAIL' : checks.every((c) => c.status === 'PASSED') ? 'PASS' : 'INCONCLUSIVE';

    // ------------------------------------------------- external benchmarks (comparison only)
    const kT = ref ? ref.kTStart : 1;
    const phi = p.cases[0].areaFraction;
    const Z = hendersonCompressibility(phi);
    const h = 1e-5;
    const dZ = (hendersonCompressibility(phi + h) - hendersonCompressibility(phi - h)) / (2 * h);
    const mass = p.cases[0].mass;
    const benchmarks = {
      note: 'EXTERNAL comparison only, computed after the measurement; nothing here enters a run, an analysis or a criterion. Hard-disk values use the Henderson equation of state.',
      kT,
      idealGas2D_sqrt2kT_m: idealSoundSpeed2D(kT, mass),
      hardDiskIsothermal: Math.sqrt((kT / mass) * (Z + phi * dZ)),
      hardDiskAdiabatic: Math.sqrt((kT / mass) * (Z + phi * dZ + Z * Z)),
      measuredC0: fit ? fit.c0 : null,
    };

    const strip = (x: (typeof caseResults)[number]) => {
      if (!ok(x)) return x;
      const { _J: _j, _times: _t, ...rest } = x;
      return rest;
    };
    const c0 = p.cases[0];
    return {
      ...recordHeader('sound-speed-validation', 'Small-amplitude sound speed: amplitude series, control and invariance tests', p.seeds),
      particleCount: mean(all.map((r) => r.count)),
      particleScale: { radius: c0.radius, diameter: 2 * c0.radius, mass: c0.mass },
      density: { numberDensity: c0.areaFraction / (Math.PI * c0.radius ** 2), massDensity: (c0.mass * c0.areaFraction) / (Math.PI * c0.radius ** 2), areaFraction: c0.areaFraction },
      temperature: { kT: c0.kT, definition: 'kT = KE/N (A-03)' },
      speed: null,
      geometry: `periodic box ${c0.length} × ${c0.height} (variants differ); planar density disturbance in a central slab of width ${c0.slabWidth}`,
      wallModel: 'none (periodic)',
      accommodation: 0,
      restitution: 1,
      occupancyModel: 'off',
      ks: 0,
      timestep: p.timestep,
      domain: { xmin: 0, xmax: c0.length, ymin: 0, ymax: c0.height, periodicX: true, periodicY: true },
      duration: { time: all.reduce((a, r) => a + (r.times[r.times.length - 1] ?? 0), 0), steps: this.steps, collisionsPerParticle: Number.NaN },
      reynolds: { simulation: null, effective: null, physical: null, note: 'No mean flow.' },
      mach: { Mp: null, benchmark: null, note: 'This experiment measures c_p; flow experiments use it for Mp = V/c_p.' },
      results: {
        criteria: 'docs/CRITERIA_SOUND_SPEED.md',
        classification,
        settings: { measurement: m, analysis: p.analysis, criteria: cr },
        extrapolation: fit
          ? { set: set.map((x) => x.amplitude), dropped, noiseDominated, ...fit, ci95: [fit.c0 - t95(dof) * fit.c0Se, fit.c0 + t95(dof) * fit.c0Se], relHalfWidth95: relHalf, allDetected: fitAll, smallestThree: smallest3 }
          : { set: set.map((x) => x.amplitude), dropped, noiseDominated, allDetected: fitAll },
        amplitudeSeries: amps.map((x) => ({ amplitude: x.amplitude, realized: x.realizedAmplitude, speed: x.primary.speed, se: x.primary.se, ci95: x.primary.ci95, seedSd: x.primary.seedSd, detected: x.primary.detected, ambiguous: x.primary.ambiguous, stackSnr: x.primary.stackSnr, ...distLin(x) })),
        control: controlInfo,
        invariance,
        reproducibility,
        reflection,
        emptySpace: empty,
        cases: caseResults.map(strip),
      },
      uncertainty: { note: 'Statistical: delete-1 jackknife over seeds of the whole analysis (seed-averaged signals); differences and the extrapolation are jackknifed jointly (same seeds in every case). Systematic/numerical: invariance tests, reported separately.' },
      convergence: { status: 'NOT ASSESSED', note: 'Timestep, probe width, sampling, window, domain length, strip height and particle radius are judged as invariance tests (S8, S9).' },
      benchmarks,
      assumptions: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07'],
      acceptance: checks,
      status,
      warnings,
      safetyFlags: all.flatMap((r) => r.safetyFlags),
      config: p,
    };
  }
}

