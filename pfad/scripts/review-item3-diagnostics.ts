/**
 * Design-review diagnostics for Item 3 (after the INCONCLUSIVE classification).
 *
 * Read-only analysis of the existing raw records. NOT part of any
 * classification and not a pre-registration: it informs the choice of the
 * next experiment (docs/REVIEW_AFTER_ITEM3.md). Nothing is simulated.
 *
 *  R1  near-wall momentum budget from particle sums (kinetic + collisional
 *      momentum flux and floor impulses): which terms act on the slow layer
 *  R2  wall pressure, core velocity and the near-wall temperature gradient
 *      along the plate (thermal-creep scale)
 *  R3  the post-hoc wall-shear band tested on the independent variant seed sets
 *  R4  what the wall impulse measures: flux-weighted incident velocity
 *      against the near-wall mean velocity; emitted momentum
 *  R5  coherence: per-seed signs of u_wall, τ_w and ψ by column
 *  R6  detector statistics: block autocorrelation, adjacent-column
 *      correlation, power of the registered column test for the rib
 *
 *   npx tsx scripts/review-item3-diagnostics.ts results/bl-separation_*.json
 */
import { readFileSync } from 'node:fs';
import { columnsIn, variantX, type BLSCriteria } from '../src/experiments/BLSeparationReport';
import type { BLSParams } from '../src/experiments/BoundaryLayerSeparationExperiment';
import { coarsen, floorOf, seedStat, streamFunction, summarizeCase, tOneSided, type CaseSummary } from '../src/experiments/WallFlowAnalysis';
import type { WallFlowRunResult } from '../src/experiments/WallFlowRun';
import { wallFlowGeometry } from '../src/experiments/WallFlowRun';
import type { GridSumsData } from '../src/measurements/GridSums';

type Rec = { config: BLSParams & { criteria: BLSCriteria }; results: { runs: WallFlowRunResult[] } };
const recs: Rec[] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const params = recs[0].config;
const C = params.criteria;
const byCase: Record<string, WallFlowRunResult[]> = {};
for (const r of recs.flatMap((q) => q.results.runs)) (byCase[r.label] ??= []).push(r);
const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toPrecision(n) : 'n/a');
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const S: Record<string, CaseSummary> = {};
const sum = (k: string) => (S[k] ??= summarizeCase(k, byCase[k], C.observable));

// ---------------------------------------------------------------- R1 momentum budget
/**
 * Per run, per 20-wide column: B(x) = ∫₀^h Π_xx dy (total streamwise momentum
 * flux through a vertical section of the band, kinetic Σ m v_x² plus the
 * collisional virial), F(h) = Π_xy at y = h (x-momentum flux upward out of
 * the band), τ_w (x-momentum delivered to the floor). In steady state
 * dB/dx + F(h) + τ_w = 0. Reported per column: −dB/dx (net streamwise force
 * on the band from the stress difference — negative = adverse),
 * −F(h) (supply of forward momentum from above), τ_w, and the residual.
 */
function budget(r: WallFlowRunResult, h: number) {
  const g: GridSumsData = coarsen(r.nearWall, Math.round(C.observable.cellX / r.nearWall.cellW), 1);
  const A = g.cellW * g.cellH;
  const rows = Math.round(h / g.cellH);
  const ct = g.collisionTime ?? r.measurementTime;
  const pixx = (c: number) => g.sxx![c] / (g.snapshots * A) + (g.cxx ? g.cxx[c] / (ct * A) : 0);
  const pixy = (c: number) => g.sxy![c] / (g.snapshots * A) + (g.cxy ? g.cxy[c] / (ct * A) : 0);
  const B: number[] = [];
  const F: number[] = [];
  for (let i = 0; i < g.nx; i++) {
    let b = 0;
    for (let j = 0; j < rows; j++) b += pixx(j * g.nx + i) * g.cellH;
    B.push(b);
    // flux through y = h: mean of the rows just below and just above
    F.push(0.5 * (pixy((rows - 1) * g.nx + i) + pixy(rows * g.nx + i)));
  }
  const fl = floorOf(r);
  const per = Math.round(C.observable.cellX / fl.bin);
  const tau = Array.from({ length: g.nx }, (_, i) => {
    let t = 0;
    for (let k = 0; k < per; k++) t += fl.tangential[i * per + k] ?? 0;
    return t / (r.measurementTime * C.observable.cellX);
  });
  const x = Array.from({ length: g.nx }, (_, i) => g.x0 + (i + 0.5) * g.cellW);
  const dB = x.map((_, i) => (i > 0 && i < g.nx - 1 ? (B[i + 1] - B[i - 1]) / (2 * g.cellW) : Number.NaN));
  return { x, B, F, tau, dB, lost: g.collisionsLost ?? 0 };
}

console.log('ITEM 3 — DESIGN-REVIEW DIAGNOSTICS (read-only; not part of any classification)');
for (const h of [4, 10]) {
  console.log(`\nR1. Near-wall momentum budget, band y < ${h} (seed mean ± SE). Terms per unit length per unit time:`);
  console.log('    force = −dB/dx (stress-difference force on the band; < 0 adverse), supply = −Π_xy(h) (forward momentum entering from above),');
  console.log('    τ_w (forward momentum given to the wall), residual = force + supply − τ_w (≈ 0 in a steady state; measures the estimator)');
  for (const k of ['A1-r1', 'A1-r2.5', 'A1-rib']) {
    if (!byCase[k]) continue;
    const per = byCase[k].map((r) => budget(r, h));
    const x = per[0].x;
    const lost = per.reduce((a, p) => a + p.lost, 0);
    console.log(`  ${k} (collisions lost from the log: ${lost})`);
    for (let i = 0; i < x.length; i++) {
      if (x[i] < 110 || x[i] > 490) continue;
      if (k === 'A1-r1' && ![150, 210, 310, 410].includes(x[i])) continue;
      if (k === 'A1-rib' && !(x[i] >= 170 && x[i] <= 330)) continue;
      const force = seedStat(per.map((p) => -p.dB[i]));
      const supply = seedStat(per.map((p) => -p.F[i]));
      const tw = seedStat(per.map((p) => p.tau[i]));
      const res = seedStat(per.map((p) => -p.dB[i] - p.F[i] - p.tau[i]));
      console.log(`    x ${String(x[i]).padStart(3)}: force ${f(force.mean, 2).padStart(9)} ± ${f(force.se, 1).padEnd(7)} supply ${f(supply.mean, 2).padStart(9)} ± ${f(supply.se, 1).padEnd(7)} τ_w ${f(tw.mean, 2).padStart(9)} ± ${f(tw.se, 1).padEnd(7)} residual ${f(res.mean, 2).padStart(9)} ± ${f(res.se, 1)}`);
    }
  }
}

// ---------------------------------------------------------------- R2 pressure, core, temperature
console.log('\nR2. Along the plate (A1-r2.5 vs A1-r1): wall pressure p_w, core U_e and density n_e, ceiling H, near-wall kT (y < 4)');
function nearWallKT(s: CaseSummary, i: number, band: number, m: number): number {
  const g = s.nearWall;
  let N = 0, px = 0, py = 0, sxx = 0, syy = 0;
  for (let j = 0; j < g.ny; j++) {
    if ((j + 1) * g.cellH > band + 1e-9) break;
    const c = j * g.nx + i;
    N += g.count[c]; px += g.px[c]; py += g.py[c]; sxx += g.sxx![c]; syy += g.syy![c];
  }
  return (sxx + syy - (px * px + py * py) / (m * N)) / (2 * N);
}
for (const k of ['A1-r1', 'A1-r2.5']) {
  const s = sum(k);
  const geo = wallFlowGeometry(byCase[k][0].config);
  const cols = columnsIn(s, [100, 500]).filter((_, q) => q % 2 === 0);
  console.log(`  ${k}`);
  console.log('    x     H      p_w        U_e     n_e     kT(y<4)');
  for (const i of cols) console.log(`    ${String(s.x[i]).padEnd(5)} ${f(geo.ceiling(s.x[i]), 3).padEnd(6)} ${f(s.stat.pW[i].mean, 4).padEnd(10)} ${f(s.stat.Ue[i].mean, 3).padEnd(7)} ${f(s.stat.ne[i].mean, 3).padEnd(7)} ${f(nearWallKT(s, i, 4, 1), 4)}`);
}

// ---------------------------------------------------------------- R3 out-of-sample τ_w band
console.log('\nR3. The post-hoc τ_w band (300, 440) — chosen on A1-r2.5 seeds 7001–7008 — evaluated on independent seed sets');
for (const k of ['A1-r2.5', 'A1-r2.5-dt', 'A1-r2.5-len', 'A1-r2.5-res', 'A1-r2.5-H', 'A05-r2.5', 'A1-r2', 'A1-r1']) {
  if (!byCase[k]) continue;
  const s = sum(k);
  const c = params.cases.find((q) => q.key === k)!;
  const ref = params.cases.find((q) => q.key === c.reference) ?? c;
  const rcfg = { diffuser: (ref.overrides.diffuser ?? params.base.diffuser) as [number, number] };
  const vcfg = { diffuser: (c.overrides.diffuser ?? params.base.diffuser) as [number, number] };
  const w: [number, number] = c.variant === 'height' ? [variantX(rcfg, vcfg, 'height', 300), variantX(rcfg, vcfg, 'height', 440)] : [300, 440];
  const cols = columnsIn(s, w);
  const perSeed = s.perSeed.tauW.map((row) => mean(cols.map((i) => row[i])));
  const st = seedStat(perSeed);
  const u = seedStat(s.perSeed.uWall.map((row) => mean(cols.map((i) => row[i]))));
  console.log(`  ${k.padEnd(12)} band (${w.map((v) => Math.round(v)).join(', ')}): τ_w ${f(st.mean, 3)} ± ${f(st.se, 2)} (t ${f(st.t, 3)}; ${perSeed.filter((v) => v < 0).length}/${st.n} seeds < 0); u_wall ${f(u.mean, 3)} ± ${f(u.se, 2)}`);
}

// ---------------------------------------------------------------- R4 what the wall impulse measures
console.log('\nR4. Wall impulse decomposition (A1-r2.5 and A1-r1, seed-summed): per column, incident tangential momentum per hit');
console.log('    (flux-weighted velocity of the arriving particles), emitted tangential momentum per hit (≈ 0 for a diffuse wall at rest),');
console.log('    and the density-weighted mean u of the first row (y < 1) and of y < 4');
for (const k of ['A1-r1', 'A1-r2.5']) {
  const runs = byCase[k];
  const s = sum(k);
  const bin = runs[0].floor.bin;
  const per = Math.round(C.observable.cellX / bin);
  console.log(`  ${k}`);
  for (const x of [150, 310, 350, 370, 390, 410, 430]) {
    const i = s.x.indexOf(x);
    let hits = 0, inc = 0, emi = 0, diff = 0;
    for (const r of runs) for (let q = 0; q < per; q++) {
      const b = i * per + q;
      hits += r.floor.total.hits[b]; inc += r.floor.total.incidentTangential[b]; emi += r.floor.total.emittedTangential[b]; diff += r.floor.total.diffuseHits[b];
    }
    const g = coarsen(runs.map((r) => r.nearWall).reduce((a, b2) => ({ ...a, count: a.count.map((v, c) => v + b2.count[c]), px: a.px.map((v, c) => v + b2.px[c]) })), 2, 1);
    const u1 = g.px[i] / g.count[i];
    let N4 = 0, P4 = 0;
    for (let j = 0; j < 4; j++) { N4 += g.count[j * g.nx + i]; P4 += g.px[j * g.nx + i]; }
    console.log(`    x ${x}: incident ${f(inc / hits, 3)} per hit, emitted ${f(emi / hits, 2)} per hit, diffuse fraction ${f(diff / hits, 4)}; u(y<1) ${f(u1, 3)}, u(y<4) ${f(P4 / N4, 3)}`);
  }
}

// ---------------------------------------------------------------- R5 coherence by seed
console.log('\nR5. Per-seed signs by column (A1-r2.5, 8 seeds; rib, 4 seeds): number of seeds with u_wall < 0 / τ_w < 0 / ψ(y = 10) < 0');
for (const k of ['A1-r2.5', 'A1-rib']) {
  const s = sum(k);
  const runs = byCase[k];
  const psi10 = runs.map((r) => {
    const sf = streamFunction(coarsen(r.nearWall, 2, 1));
    const row = sf.yTop.findIndex((y) => Math.abs(y - 10) < 1e-9);
    return sf.psi.map((col) => col[row]);
  });
  const w = k === 'A1-rib' ? [200, 320] : [280, 480];
  const cols = columnsIn(s, w as [number, number]);
  console.log(`  ${k}: ` + cols.map((i) => `${s.x[i]}: ${s.perSeed.uWall.filter((r) => r[i] < 0).length}/${s.perSeed.tauW.filter((r) => r[i] < 0).length}/${psi10.filter((p) => p[i] < 0).length}`).join('  '));
}

// ---------------------------------------------------------------- R6 detector statistics
console.log('\nR6. Detector statistics');
function lag1(series: number[]): number {
  const m = mean(series);
  let num = 0, den = 0;
  for (let k = 0; k < series.length; k++) { den += (series[k] - m) ** 2; if (k > 0) num += (series[k] - m) * (series[k - 1] - m); }
  return num / den;
}
for (const [k, w] of [['A1-r1', [280, 480]], ['A1-r2.5', [280, 480]], ['A1-rib', [220, 260]]] as const) {
  const s = sum(k);
  const cols = columnsIn(s, w as unknown as [number, number]);
  // lag-1 autocorrelation of 120-unit block means (per seed and column, pooled), after removing each seed-column mean
  const ac: number[] = [];
  for (const seed of s.blockU) for (const i of cols) ac.push(lag1(seed.map((b) => b[i])));
  // adjacent-column correlation of block deviations
  let sxy = 0, sxx = 0, syy = 0;
  for (const seed of s.blockU) for (let q = 0; q + 1 < cols.length; q++) {
    const a = seed.map((b) => b[cols[q]]);
    const bq = seed.map((b) => b[cols[q + 1]]);
    const ma = mean(a), mb = mean(bq);
    for (let t = 0; t < a.length; t++) { sxy += (a[t] - ma) * (bq[t] - mb); sxx += (a[t] - ma) ** 2; syy += (bq[t] - mb) ** 2; }
  }
  // within-run SE of a seed's column mean from its blocks, vs the seed-to-seed SD
  const within = mean(s.blockU.flatMap((seed) => cols.map((i) => { const v = seed.map((b) => b[i]); const m = mean(v); return Math.sqrt(v.reduce((z, y) => z + (y - m) ** 2, 0) / (v.length - 1) / v.length); })));
  const between = mean(cols.map((i) => s.stat.uWall[i].sd));
  console.log(`  ${k.padEnd(8)} window (${w.join(', ')}): block lag-1 autocorrelation ${f(mean(ac), 2)} (median of ${ac.length}: ${f(ac.sort((p, q) => p - q)[Math.floor(ac.length / 2)], 2)}); adjacent-column correlation of block deviations ${f(sxy / Math.sqrt(sxx * syy), 2)}; within-run SE of a seed's column mean ${f(within, 2)} vs seed-to-seed SD ${f(between, 2)}`);
}
// power of the registered test for the rib (noncentral t by Monte Carlo, using the observed effect and SD)
{
  const s = sum('A1-rib');
  const cols = columnsIn(s, [220, 260]);
  let seedState = 12345;
  const rnd = () => { seedState = (seedState * 1103515245 + 12345) % 2147483648; return seedState / 2147483648; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (const n of [4, 8, 12, 16]) {
    let both = 0, region = 0;
    const trials = 20000;
    const tc = tOneSided(C.alphaColumn, n - 1);
    const tr = tOneSided(0.025, n - 1);
    for (let t = 0; t < trials; t++) {
      const ok: boolean[] = [];
      const regionVals: number[] = [];
      const draws = cols.map((i) => Array.from({ length: n }, () => s.stat.uWall[i].mean + s.stat.uWall[i].sd * gauss()));
      for (const d of draws) { const st = seedStat(d); ok.push(st.mean < 0 && st.t <= -tc); }
      for (let q = 0; q < n; q++) regionVals.push(mean(draws.map((d) => d[q])));
      if (ok.every(Boolean)) both++;
      const rs = seedStat(regionVals);
      if (rs.mean < 0 && rs.t <= -tr) region++;
    }
    console.log(`  rib, n = ${n}: power of the registered 2-column test (each p ≤ ${C.alphaColumn}) ≈ ${f(both / trials, 2)}; power of a pre-declared region-mean test (220–260, p ≤ 0.025) ≈ ${f(region / trials, 2)}  [effect and SD as observed; columns treated as independent]`);
  }
}

// ---------------------------------------------------------------- R7 budget onset across the series
console.log('\nR7. Budget onset (band y < 10): first column on the plate (x > 200) where the forward supply from above no longer exceeds the adverse');
console.log('    stress-difference force (supply + force ≤ 0), and the τ_w zero crossings; seed means');
for (const k of ['A1-r1', 'A1-r1.5', 'A1-r2', 'A1-r2.5', 'A05-r1', 'A05-r2', 'A05-r2.5', 'A1-r2.5-dt', 'A1-r2.5-len', 'A1-r2.5-res']) {
  if (!byCase[k]) continue;
  const per = byCase[k].map((r) => budget(r, 10));
  const x = per[0].x;
  const end = byCase[k][0].config.plate[1];
  let onset = 'none';
  let minNet = Infinity;
  let minAt = 0;
  const cross: number[] = [];
  let prev = Number.NaN;
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] < 200 || x[i] > end - 20) continue;
    const net = mean(per.map((p) => -p.F[i] - p.dB[i]));
    if (net < minNet) { minNet = net; minAt = x[i]; }
    if (onset === 'none' && net <= 0) onset = String(x[i]);
    const tw = mean(per.map((p) => p.tau[i]));
    if (Number.isFinite(prev) && Math.sign(tw) !== Math.sign(prev)) cross.push(x[i] - 10);
    prev = tw;
  }
  console.log(`  ${k.padEnd(12)} onset ${onset.padEnd(5)} min(supply + force) ${f(minNet, 2)} at x ${minAt}; τ_w sign changes near x ${cross.join(', ') || '—'}`);
}
