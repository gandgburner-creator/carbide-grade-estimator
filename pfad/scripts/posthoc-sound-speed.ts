/**
 * POST-HOC diagnostics for the Item 2 validation record (reported, never used
 * for the classification; written after the validation data were seen):
 *  1. equilibrium-noise propagation signature: per-seed slant-stack cross
 *     power of the zero-amplitude control, averaged over seeds;
 *  2. sensitivity of the zero-amplitude speed to the extrapolation model.
 *
 *   npx tsx scripts/posthoc-sound-speed.ts results/sound-speed_validation.json results/sound-speed_validation_posthoc.json results/plots/sound_speed
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jackknifeSe, slantStack } from '../src/measurements/ArrivalAnalysis';
import { weightedPoly } from '../src/experiments/SoundSpeedAnalysis';
import { svgPlot } from './svgPlot';

/* eslint-disable @typescript-eslint/no-explicit-any */
const [path, outPath, plotDir] = process.argv.slice(2);
const rec = JSON.parse(readFileSync(path, 'utf8'));
const R = rec.results;
const d: number[] = R.settings.measurement.probes;
const dt = R.settings.measurement.snapshotInterval;
const tEnd = R.settings.analysis.tEnd;
const out: any = { note: 'POST HOC diagnostics, written after the validation data were seen; not used for any criterion.' };

// 1. equilibrium noise
const ctrl = R.cases.find((c: any) => c.role === 'control');
const per = ctrl.series.perProbe.map((ps: any[]) => ps.map((s: any[]) => s.map((v) => v ?? 0)));
const S = per[0].length;
const times = per[0][0].map((_: any, k: number) => k * dt);
const grid: number[] = [];
for (let s = 0.25; s <= 0.75 + 1e-9; s += 0.0025) grid.push(+s.toFixed(4));
const noise: any = {};
const curves: Record<string, { speed: number[]; mean: number[]; se: number[] }> = {};
for (const sign of [1, -1]) {
  const P = Array.from({ length: S }, (_, i) => slantStack(per.map((ps: number[][]) => ps[i]), d, times, grid.map((s) => sign * s), tEnd));
  const mean = grid.map((_, g) => P.reduce((a, q) => a + q[g], 0) / S);
  const se = grid.map((_, g) => Math.sqrt(P.reduce((a, q) => a + (q[g] - mean[g]) ** 2, 0) / (S - 1) / S));
  const hump = (skip: number) => {
    const y = grid.map((_, g) => P.reduce((a, q, i) => (i === skip ? a : a + q[g]), 0));
    const mx = Math.max(...y);
    const idx = y.map((v, g) => (v >= 0.8 * mx ? g : -1)).filter((g) => g >= 0);
    const q = weightedPoly(idx.map((g) => grid[g]), idx.map((g) => y[g] / mx), idx.map(() => 1), 2);
    return 1 / (-q[1] / (2 * q[2]));
  };
  const iMax = mean.indexOf(Math.max(...mean));
  const key = sign > 0 ? 'outward' : 'inward';
  noise[key] = { speed: hump(-1), se: jackknifeSe(Array.from({ length: S }, (_, i) => hump(i))), peakZ: mean[iMax] / se[iMax] };
  curves[key] = { speed: grid.map((s) => 1 / s), mean, se };
}
out.equilibriumNoise = {
  method: 'Per-seed slant-stack cross power of the control (A = 0) at slownesses 0.25–0.75 in each direction, summed over the 64 seeds; speed = vertex of a quadratic fitted over the hump (≥ 80 % of its maximum, robust to the interpolation ripple at exact sample alignments); jackknife over seeds; peakZ = mean / SE across seeds at the maximum.',
  ...noise,
};
const norm = Math.max(...curves.outward.mean, ...curves.inward.mean);
writeFileSync(join(plotDir, 'posthoc_equilibrium_noise.svg'), svgPlot({
  title: 'POST HOC — control (no disturbance): per-seed stack cross power, mean over 64 seeds (± 2 SE)',
  xLabel: 'trial speed (|moveout|)', yLabel: 'mean cross power (normalised)',
  series: [
    { label: `outward: hump at ${noise.outward.speed.toFixed(3)} ± ${noise.outward.se.toFixed(3)} (peak z ${noise.outward.peakZ.toFixed(1)})`, x: curves.outward.speed, y: curves.outward.mean.map((v) => v / norm), err: curves.outward.se.map((v) => (2 * v) / norm), color: '#d1242f' },
    { label: `inward: hump at ${noise.inward.speed.toFixed(3)} ± ${noise.inward.se.toFixed(3)} (peak z ${noise.inward.peakZ.toFixed(1)})`, x: curves.inward.speed, y: curves.inward.mean.map((v) => v / norm), err: curves.inward.se.map((v) => (2 * v) / norm), color: '#1f6feb' },
  ],
}));

// 2. extrapolation models
const amps = R.cases.filter((c: any) => c.role === 'amplitude').sort((a: any, b: any) => b.amplitude - a.amplitude);
const A = amps.map((c: any) => c.amplitude);
const c = amps.map((x: any) => x.primary.speed);
const w = amps.map((x: any) => 1 / x.primary.se ** 2);
const Sn = amps[0].primary.loo.speed.length;
const loo = (k: number) => amps.map((x: any) => x.primary.loo.speed[k]);
const fit = (idx: number[], deg: 1 | 2) => {
  const f = (y: number[]) => weightedPoly(idx.map((i) => A[i]), idx.map((i) => y[i]), idx.map((i) => w[i]), deg);
  const full = f(c);
  return { amplitudes: idx.map((i) => A[i]), coefficients: full, c0: full[0], se: jackknifeSe(Array.from({ length: Sn }, (_, k) => f(loo(k))[0])) };
};
const wmean = (idx: number[]) => {
  const g = (y: number[]) => idx.reduce((a, i) => a + w[i] * y[i], 0) / idx.reduce((a, i) => a + w[i], 0);
  return { amplitudes: idx.map((i) => A[i]), value: g(c), se: jackknifeSe(Array.from({ length: Sn }, (_, k) => g(loo(k)))) };
};
out.extrapolationSensitivity = {
  preRegisteredLinearAll: fit([0, 1, 2, 3, 4], 1),
  quadraticAll: fit([0, 1, 2, 3, 4], 2),
  linearWithout04: fit([1, 2, 3, 4], 1),
  linearSmallestThree: fit([2, 3, 4], 1),
  weightedMeanAtMost02: wmean([2, 3, 4]),
  weightedMeanAtMost01: wmean([3, 4]),
};
const xs = Array.from({ length: 41 }, (_, k) => 0.01 * k);
const E = out.extrapolationSensitivity;
const line = (q: number[]) => xs.map((a) => q.reduce((s, ck, k) => s + ck * a ** k, 0));
writeFileSync(join(plotDir, 'posthoc_extrapolation_models.svg'), svgPlot({
  title: 'POST HOC — zero-amplitude speed under alternative extrapolation models (pre-registered: linear, all)',
  xLabel: 'amplitude A', yLabel: 'speed',
  series: [
    { label: 'measured c(A) ± SE (primary)', x: A, y: c, err: amps.map((x: any) => x.primary.se), color: '#1f6feb', markers: true, noLine: true },
    { label: `linear, all (pre-registered): c₀ ${E.preRegisteredLinearAll.c0.toFixed(3)} ± ${E.preRegisteredLinearAll.se.toFixed(3)}`, x: xs, y: line(E.preRegisteredLinearAll.coefficients), color: '#d1242f' },
    { label: `quadratic, all: c₀ ${E.quadraticAll.c0.toFixed(3)} ± ${E.quadraticAll.se.toFixed(3)}`, x: xs, y: line(E.quadraticAll.coefficients), color: '#9a6700', dashed: true },
    { label: `linear, 3 smallest: c₀ ${E.linearSmallestThree.c0.toFixed(3)} ± ${E.linearSmallestThree.se.toFixed(3)}`, x: xs.filter((a) => a <= 0.2), y: line(E.linearSmallestThree.coefficients).slice(0, 21), color: '#1a7f37', dashed: true },
    { label: `equilibrium-noise moveout ${noise.outward.speed.toFixed(3)} / ${noise.inward.speed.toFixed(3)} (out / in)`, x: [0, 0.4], y: [0.5 * (noise.outward.speed + noise.inward.speed), 0.5 * (noise.outward.speed + noise.inward.speed)], color: '#8250df', dashed: true },
  ],
}));
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ equilibriumNoise: noise, extrapolation: Object.fromEntries(Object.entries(E).map(([k, v]: any) => [k, v.c0 !== undefined ? `${v.c0.toFixed(4)} ± ${v.se.toFixed(4)}` : `${v.value.toFixed(4)} ± ${v.se.toFixed(4)}`])) }, null, 1));
