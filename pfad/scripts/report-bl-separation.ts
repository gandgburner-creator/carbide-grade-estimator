/**
 * Report for Item 3, boundary layer + separation discovery
 * (docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md). Reads one or more raw records
 * of the 'boundary-layer-separation' experiment, runs the pre-registered
 * analysis (src/experiments/BLSeparationReport.ts), prints tables and the
 * PASS / INCONCLUSIVE / FAIL classification, and writes plots, an animation
 * and a JSON summary. Runs no simulation.
 *
 *   npx tsx scripts/report-bl-separation.ts <outdir> <record.json> [record.json …]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, columnsIn, nearestColumn, type BLSCriteria } from '../src/experiments/BLSeparationReport';
import type { BLSParams } from '../src/experiments/BoundaryLayerSeparationExperiment';
import { cellMoments, coarsen, dividingHeight, seedStat, streamFunction, sumGrids, tOneSided, type CaseSummary } from '../src/experiments/WallFlowAnalysis';
import { wallFlowGeometry, type WallFlowRunResult } from '../src/experiments/WallFlowRun';
import { svgHeatmap } from './svgHeatmap';
import { svgPlot, type Series } from './svgPlot';

const [outDir, ...paths] = process.argv.slice(2);
if (!outDir || paths.length === 0) {
  console.error('usage: report-bl-separation.ts <outdir> <record.json> [record.json …]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------ load
type Rec = { experimentType: string; experimentId: string; modelVersion: string; config: BLSParams & { criteria: BLSCriteria }; results: { runs: WallFlowRunResult[] } };
const recs: Rec[] = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')));
for (const r of recs) if (r.experimentType !== 'boundary-layer-separation') throw new Error(`${r.experimentId}: not a boundary-layer-separation record`);
const params = recs[0].config;
const baseKey = JSON.stringify({ base: params.base, cases: params.cases, criteria: params.criteria });
for (const r of recs) {
  if (JSON.stringify({ base: r.config.base, cases: r.config.cases, criteria: r.config.criteria }) !== baseKey) throw new Error(`${r.experimentId}: configuration differs from the first record`);
}
const runs = recs.flatMap((r) => r.results.runs);
const C = params.criteria;
const A = analyse(params, runs, C);

const COLORS = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#57606a', '#0a7ea4', '#bf3989', '#e16f24', '#000000'];
const files: string[] = [];
const put = (name: string, content: string) => {
  writeFileSync(join(outDir, name), content);
  files.push(join(outDir, name));
};
const f = (v: number, n = 3) => (Number.isFinite(v) ? v.toPrecision(n) : 'n/a');
const S = A.summaries;
const keysPresent = Object.keys(S);
const byCase: Record<string, WallFlowRunResult[]> = {};
for (const r of runs) (byCase[r.label] ??= []).push(r);

// ------------------------------------------------------------------ header and cases
console.log('ITEM 3 — BOUNDARY LAYER + SEPARATION DISCOVERY');
console.log(`  records: ${recs.map((r) => r.experimentId).join(', ')}`);
console.log(`  model ${recs[0].modelVersion}; ${runs.length} runs; criteria docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md`);
const b = params.base;
console.log(`  base: L ${b.length}, H_in ${b.heightIn}, φ ${b.areaFraction}, d ${2 * b.radius}, kT ${b.kT}, Q-reference speed U ${b.speed}, plate [${b.plate}], diffuser [${b.diffuser}], contraction [${b.contraction}], fringe [${b.fringe}] ν ${b.fringeRate}`);
console.log(`  timestep Courant ${b.timestep.kind === 'adaptive' ? b.timestep.courant : 'fixed'}; start-up ${b.startupTime}; measurement ${b.measurementTime}; sampling ${b.sampleInterval}; ${b.blocks} blocks`);
console.log('\nCASES');
for (const c of params.cases) {
  const rs = byCase[c.key] ?? [];
  if (!rs.length) {
    console.log(`  ${c.key.padEnd(12)} (no runs in these records)`);
    continue;
  }
  const kT = rs.map((r) => {
    const s = r.series;
    const k = s.t.findIndex((t) => t >= r.measurementStart);
    return s.kT.slice(k).reduce((a, v) => a + v, 0) / Math.max(1, s.kT.length - k);
  });
  console.log(
    `  ${c.key.padEnd(12)} ${c.role.padEnd(16)} r ${c.overrides.expansion ?? b.expansion} Aw ${c.overrides.accommodation ?? b.accommodation}${c.variant ? ` [${c.variant} of ${c.reference}]` : ''}: ${rs.length} seeds (${rs.map((r) => r.seed).join(',')}), N ${rs[0].particles}, ` +
      `inflow Q ${f(seedStat(rs.map((r) => r.massFlux.measured)).mean, 4)}/${f(rs[0].massFlux.target, 4)}, fringe U_a ${f(seedStat(rs.map((r) => r.fringe.drift)).mean, 3)} U_b ${f(seedStat(rs.map((r) => r.fringe.exitDrift)).mean, 3)}, kT ${f(seedStat(kT).mean, 4)}, wall-clock ${f(seedStat(rs.map((r) => r.wallSeconds)).mean, 3)} s/run`,
  );
}

// ------------------------------------------------------------------ energy ledger
console.log('\nENERGY AND MOMENTUM LEDGER (per case, measurement window, per unit time; residuals over the whole run)');
for (const k of keysPresent) {
  const rs = byCase[k];
  const T = (r: WallFlowRunResult) => r.measurementTime;
  const fe = seedStat(rs.map((r) => r.fringe.energyIn / T(r)));
  const fp = seedStat(rs.map((r) => r.fringe.momentumX / T(r)));
  const we = seedStat(rs.map((r) => r.floor.total.energyIn.reduce((a, v) => a + v, 0) / T(r)));
  const wt = seedStat(rs.map((r) => r.floor.total.tangentialImpulse.reduce((a, v) => a + v, 0) / T(r)));
  const ci = seedStat(rs.map((r) => r.ceiling.reduce((a, c) => a + c.impulseX, 0) / T(r)));
  const ke = seedStat(rs.map((r) => r.series.kinetic[r.series.kinetic.length - 1]));
  const res = Math.max(...rs.map((r) => r.conservation.maxAbsRelativeEnergyResidual));
  console.log(
    `  ${k.padEnd(12)} KE ${f(ke.mean, 5)}; fringe work in ${f(fe.mean, 4)}, floor heat out ${f(we.mean, 4)}; fringe x-impulse ${f(fp.mean, 4)} = plate drag ${f(wt.mean, 4)} + ceiling ${f(ci.mean, 4)} (+ storage); internal 0, deformation 0, ceiling work 0 (specular); max |energy residual| ${res.toExponential(2)}`,
  );
}

// ------------------------------------------------------------------ Part I tables
console.log('\nPART I — NEAR-WALL STRUCTURE (stations on the plate)');
const st = A.details.structure as Record<string, { x: number; deficit: { mean: number; se: number; t: number }; delta1: { mean: number; se: number }; delta2: { mean: number; se: number }; yHalf: { mean: number; se: number }; tauW: { mean: number; se: number }; uWall: { mean: number; se: number }; Ue: { mean: number; se: number } }[]>;
for (const [k, rows] of Object.entries(st)) {
  console.log(`  ${k}`);
  for (const r of rows) {
    console.log(
      `    x ${String(r.x).padStart(4)}: U_e ${f(r.Ue.mean)}  u_wall ${f(r.uWall.mean)}±${f(r.uWall.se, 2)}  deficit ${f(r.deficit.mean)}±${f(r.deficit.se, 2)} (t ${f(r.deficit.t, 3)})  δ₁ ${f(r.delta1.mean)}±${f(r.delta1.se, 2)}  δ₂ ${f(r.delta2.mean)}±${f(r.delta2.se, 2)}  y½ ${f(r.yHalf.mean)}±${f(r.yHalf.se, 2)}  τ_w ${f(r.tauW.mean, 3)}±${f(r.tauW.se, 2)}`,
    );
  }
}

// ------------------------------------------------------------------ fluctuation statistics
console.log('\nFLUCTUATION STATISTICS (seed-summed, Δx = ' + C.observable.cellX + ' column at each station; "fluctuations", not turbulence)');
const bands: [number, number][] = [[0, 2], [2, 4], [4, 8], [8, 16], [16, 32]];
for (const k of [C.keys.attached, C.keys.strong, C.keys.specularAttached].filter((q) => byCase[q])) {
  const rs = byCase[k];
  const g = coarsen(sumGrids(rs.map((r) => r.nearWall)), Math.round(C.observable.cellX / rs[0].nearWall.cellW), 1);
  console.log(`  ${k}`);
  for (const x of C.stations) {
    const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / g.cellW)));
    const line = bands.map(([a, bb]) => {
      const cells: number[] = [];
      for (let j = Math.round(a / g.cellH); j < Math.round(bb / g.cellH) && j < g.ny; j++) cells.push(j * g.nx + i);
      const m = cellMoments(g, cells, rs[0].config.mass, rs[0].config.radius);
      return `y ${a}–${bb}: n ${f(m.n, 3)} φ ${f(m.phi, 2)} u ${f(m.u, 2)} σu ${f(m.sigmaU, 3)} v ${f(m.v, 1)} σv ${f(m.sigmaV, 3)} ρu′v′ ${f(m.kineticFlux, 2)} τc ${f(m.collisionalShear, 2)} kT ${f(m.kT, 3)}`;
    });
    console.log(`    x ${x}:\n      ${line.join('\n      ')}`);
  }
}

// ------------------------------------------------------------------ Part II tables
console.log('\nPART II — DECELERATION SERIES (plate columns; seed ensembles)');
const series = [C.keys.attached, C.keys.weak, C.keys.moderate, C.keys.strong, ...C.keys.seriesAw05, C.keys.specularAttached, C.keys.specularStrong].filter((k, i, a) => S[k] && a.indexOf(k) === i);
const ref = S[C.keys.strong];
const win = columnsIn(ref, C.searchWindow);
console.log('  x     ' + series.map((k) => k.padStart(18)).join(''));
for (const i of win) {
  const x = ref.x[i];
  console.log(
    `  ${String(x).padStart(4)}  ` +
      series
        .map((k) => {
          const s = S[k];
          const j = nearestColumn(s, x);
          const u = s.stat.uWall[j];
          const star = u.t <= -tOneSided(C.alphaColumn, u.n - 1) ? '*' : ' ';
          return `${f(u.mean, 2).padStart(7)}±${f(u.se, 1).padEnd(6)}${star}`.padStart(18);
        })
        .join(''),
  );
}
console.log('  (near-wall velocity, y < ' + C.observable.nearWallBand + '; * = one-sided p ≤ ' + C.alphaColumn + ' for u < 0)');
console.log('\n  wall shear τ_w (floor tangential impulse per time per length)');
for (const i of win) {
  const x = ref.x[i];
  console.log(
    `  ${String(x).padStart(4)}  ` +
      series
        .map((k) => {
          const s = S[k];
          const j = nearestColumn(s, x);
          const u = s.stat.tauW[j];
          return `${f(u.mean, 2).padStart(9)}±${f(u.se, 1).padEnd(7)}`.padStart(18);
        })
        .join(''),
  );
}
console.log('\nSEPARATED REGIONS (≥ ' + C.minColumns + ' contiguous columns, one-sided p ≤ ' + C.alphaColumn + ')');
for (const k of series) {
  const rs = A.regions[k];
  if (!rs.length) {
    console.log(`  ${k}: none`);
    continue;
  }
  for (const r of rs) {
    console.log(
      `  ${k}: x ∈ [${r.from}, ${r.to}] (${r.columns.length} columns): u_wall ${f(r.uWall.mean)}±${f(r.uWall.se, 2)} (t ${f(r.uWall.t, 3)}), τ_w ${f(r.tauW.mean, 3)}±${f(r.tauW.se, 2)} (t ${f(r.tauW.t, 3)}), ψ_wall ${f(r.psiWall.mean, 3)}±${f(r.psiWall.se, 2)}, negative blocks ${f(r.blockNegative, 3)}, halves ${f(r.firstHalf.mean)} / ${f(r.secondHalf.mean)}, seeds negative ${r.seedsNegative}/${r.uWall.n}`,
    );
  }
}
console.log('\nTHRESHOLD (order parameters vs expansion; reported)');
const th = A.details.threshold as Record<string, ({ key: string; expansion: number; accommodation: number; minColumnU: number; reversedLength: number; regionU: { mean: number; se: number; t: number }; regionTau: { mean: number; se: number; t: number } } | null)[]>;
for (const [g, rows] of Object.entries(th)) {
  for (const r of rows) {
    if (!r) continue;
    console.log(
      `  ${g.padEnd(5)} ${r.key.padEnd(12)} r ${r.expansion}  min column u_wall ${f(r.minColumnU)}  reversed length ${r.reversedLength}  region u_wall ${f(r.regionU.mean)}±${f(r.regionU.se, 2)} (t ${f(r.regionU.t, 3)})  region τ_w ${f(r.regionTau.mean, 3)}±${f(r.regionTau.se, 2)}`,
    );
  }
}

// ------------------------------------------------------------------ external comparisons
console.log('\nEXTERNAL COMPARISON (labelled; never used by the classification)');
const geoBase = wallFlowGeometry(params.base);
const n0 = params.base.areaFraction / (Math.PI * params.base.radius ** 2);
const mu = 0.351; // viscosity_sweeps.json, φ = 0.2 (4 seeds, INCONCLUSIVE record); Enskog benchmark 0.379
const c0 = 2.17; // Item 2 registered zero-amplitude disturbance speed (φ = 0.2); post-hoc small-amplitude estimates ≈ 2.26
const A1 = S[C.keys.attached];
if (A1) {
  const i = nearestColumn(A1, C.stations[0]);
  const Ue = A1.stat.Ue[i].mean;
  const rho = A1.stat.ne[i].mean * params.base.mass;
  const Lp = params.base.plate[1] - params.base.plate[0];
  console.log(`  Re_plate = ρ U_e L_plate / μ ≈ ${f((rho * Ue * Lp) / mu, 3)} (μ = ${mu}, φ = 0.2 Couette sweep, INCONCLUSIVE; Enskog 0.379)`);
  console.log(`  Mp = U_e / c ≈ ${f(Ue / c0, 3)} (c = ${c0}, Item 2 registered c₀; small-amplitude post-hoc ≈ 2.26 → ${f(Ue / 2.26, 3)})`);
  for (const r of st[C.keys.attached] ?? []) {
    const x = r.x - params.base.plate[0];
    const nu = mu / rho;
    console.log(`  x−x_LE ${x}: measured δ₁ ${f(r.delta1.mean)} vs Blasius 1.72√(νx/U) = ${f(1.7208 * Math.sqrt((nu * x) / r.Ue.mean))} (continuum, zero pressure gradient, no slip — not expected to hold here)`);
  }
}
console.log(`  domain fluid area ${f(geoBase.fluidArea, 5)}; n₀ ${f(n0, 4)}`);

// ------------------------------------------------------------------ checks
console.log('\nCHECKS');
for (const c of A.checks) {
  console.log(`  [${(c.reported ? 'REPORTED' : c.verdict).padEnd(12)}] ${c.id}: ${c.question}`);
  console.log(`      criterion: ${c.criterion}`);
  console.log(`      measured:  ${c.measured}`);
}
console.log(`\nPART I (near-wall structure): ${A.partI}`);
console.log(`PART II (separation): ${A.partII}`);
console.log(`ITEM 3 CLASSIFICATION: ${A.overall}`);

// ------------------------------------------------------------------ plots
const plateLines = () => [{ x: [params.base.plate[0], params.base.plate[1]], y: [0.3, 0.3], color: '#000', width: 3 }];
const ceilingLine = (cfg: WallFlowRunResult['config']) => {
  const g = wallFlowGeometry(cfg);
  return { x: g.knots.map((k) => k.x), y: g.knots.map((k) => k.h), color: '#333', width: 1.5 };
};
// 1. particle snapshot near the wall
for (const k of keysPresent) {
  const rs = byCase[k].filter((r) => r.frames.length > 0);
  if (!rs.length) continue;
  const fr = rs[0].frames[0];
  const W = rs[0].config.frames!;
  const sx = 4;
  const w = (W.x1 - W.x0) * sx + 80;
  const h = W.height * sx + 60;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="sans-serif" font-size="11"><rect width="${w}" height="${h}" fill="#fff"/>`, `<text x="10" y="16" font-size="13" font-weight="600">${k} seed ${rs[0].seed}: particles near the wall at t = ${f(fr.t, 5)} (colour: v_x, blue &lt; 0 &lt; red)</text>`];
  for (let q = 0; q < fr.p.length; q += 4) {
    const vx = fr.p[q + 2];
    const a = Math.min(1, Math.abs(vx) / 1.5);
    const col = vx >= 0 ? `rgba(192,57,43,${0.25 + 0.75 * a})` : `rgba(33,102,172,${0.25 + 0.75 * a})`;
    parts.push(`<circle cx="${(40 + (fr.p[q] - W.x0) * sx).toFixed(1)}" cy="${(h - 30 - fr.p[q + 1] * sx).toFixed(1)}" r="${(params.base.radius * sx).toFixed(1)}" fill="${col}"/>`);
  }
  parts.push(`<line x1="40" x2="${w - 40}" y1="${h - 30}" y2="${h - 30}" stroke="#000" stroke-width="2"/></svg>`);
  put(`snapshot_${k}.svg`, parts.join('\n'));
}
// 2./7./8. velocity heat maps with reversal outlines and ψ = 0 lines
const tMap = (k: string) => {
  // per-seed near-wall cell velocities → t map for u < 0
  const rs = byCase[k];
  const grids = rs.map((r) => coarsen(r.nearWall, Math.round(C.observable.cellX / r.nearWall.cellW), Math.round(C.observable.cellY / r.nearWall.cellH)));
  const g0 = grids[0];
  const out: [number, number][] = [];
  for (let j = 0; j < g0.ny; j++) for (let i = 0; i < g0.nx; i++) {
    const st2 = seedStat(grids.map((g) => g.px[j * g.nx + i] / Math.max(1, g.count[j * g.nx + i])));
    if (st2.mean < 0 && st2.t <= -tOneSided(C.alphaColumn, st2.n - 1)) out.push([i, j]);
  }
  return out;
};
for (const k of keysPresent) {
  const s = S[k];
  const cfg = byCase[k][0].config;
  const o = s.outer;
  const uo = o.px.map((p, c) => (o.count[c] > 0 ? p / o.count[c] : Number.NaN));
  put(`velocity_${k}.svg`, svgHeatmap({ title: `${k}: mean streamwise velocity u(x, y) (seed-summed)`, values: uo, nx: o.nx, ny: o.ny, x0: o.x0, y0: o.y0, cellW: o.cellW, cellH: o.cellH, scale: 'diverging', vMin: -1.4, vMax: 1.4, label: 'u', lines: [ceilingLine(cfg), ...plateLines()], pxPerUnit: 1.4 }));
  const g = s.nearWall;
  const un = g.px.map((p, c) => (g.count[c] > 0 ? p / g.count[c] : Number.NaN));
  const psi = streamFunction(g);
  const zero = psi.x.map((x, i) => ({ x, h: dividingHeight(psi.psi[i], psi.yTop) })).filter((q) => Number.isFinite(q.h));
  put(
    `reverse_flow_${k}.svg`,
    svgHeatmap({
      title: `${k}: near-wall u (y < ${g.ny * g.cellH}); black boxes: u < 0 at one-sided p ≤ ${C.alphaColumn}; green: dividing streamline ψ = 0`,
      values: un,
      nx: g.nx,
      ny: g.ny,
      x0: g.x0,
      y0: g.y0,
      cellW: g.cellW,
      cellH: g.cellH,
      scale: 'diverging',
      vMin: -0.3,
      vMax: 0.3,
      label: 'u',
      outline: { cells: tMap(k), color: '#000' },
      lines: zero.length ? [{ x: zero.map((q) => q.x), y: zero.map((q) => q.h), color: '#1a7f37', width: 2 }] : [],
      pxPerUnit: 1.4,
      yStretch: 4,
    }),
  );
  // 6. occupancy (area fraction) near the wall
  const phi = g.count.map((cnt) => (cnt * Math.PI * params.base.radius ** 2) / (g.snapshots * g.cellW * g.cellH));
  put(`occupancy_${k}.svg`, svgHeatmap({ title: `${k}: occupancy φ near the wall`, values: phi, nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, cellW: g.cellW, cellH: g.cellH, scale: 'sequential', vMin: 0, vMax: 0.4, label: 'φ', pxPerUnit: 1.4, yStretch: 4 }));
}
// 3./4. profiles at stations
const profileOf = (k: string, x: number) => {
  const s = S[k];
  const rs = byCase[k];
  const i = nearestColumn(s, x);
  const g0 = coarsen(rs[0].nearWall, Math.round(C.observable.cellX / rs[0].nearWall.cellW), Math.round(C.observable.cellY / rs[0].nearWall.cellH));
  const ys = Array.from({ length: g0.ny }, (_, j) => (j + 0.5) * g0.cellH);
  const per = rs.map((r) => {
    const g = coarsen(r.nearWall, Math.round(C.observable.cellX / r.nearWall.cellW), Math.round(C.observable.cellY / r.nearWall.cellH));
    return ys.map((_, j) => g.px[j * g.nx + i] / Math.max(1, g.count[j * g.nx + i]));
  });
  const perRhoU = rs.map((r) => {
    const g = coarsen(r.nearWall, Math.round(C.observable.cellX / r.nearWall.cellW), Math.round(C.observable.cellY / r.nearWall.cellH));
    return ys.map((_, j) => g.px[j * g.nx + i] / (g.snapshots * g.cellW * g.cellH));
  });
  return { ys, per, perRhoU, Ue: s.perSeed.Ue.map((row) => row[i]) };
};
for (const x of C.stations) {
  const ser: Series[] = [];
  const def: Series[] = [];
  series.forEach((k, q) => {
    const p = profileOf(k, x);
    const m = p.ys.map((_, j) => seedStat(p.per.map((row) => row[j])));
    ser.push({ label: k, x: m.map((v) => v.mean), y: p.ys, color: COLORS[q % COLORS.length] });
    const d = p.ys.map((_, j) => seedStat(p.perRhoU.map((row, s) => row[j] * (p.Ue[s] - p.per[s][j]))));
    def.push({ label: k, x: d.map((v) => v.mean), y: p.ys, color: COLORS[q % COLORS.length] });
  });
  put(`profile_x${x}.svg`, svgPlot({ title: `mean streamwise velocity at x = ${x} (seed means)`, xLabel: 'u', yLabel: 'y', series: ser }));
  put(`momentum_deficit_x${x}.svg`, svgPlot({ title: `momentum-flux deficit ρu(U_e − u) at x = ${x}`, xLabel: 'ρu(U_e − u)', yLabel: 'y', series: def }));
}
// 5./9. wall impulse and separation indicators vs x
const along = (field: 'tauW' | 'pW' | 'uWall' | 'psiWall' | 'delta1' | 'Ue', title: string, yl: string) => {
  const ser: Series[] = series.map((k, q) => ({ label: k, x: S[k].x, y: S[k].stat[field].map((v) => v.mean), err: S[k].stat[field].map((v) => v.se), color: COLORS[q % COLORS.length] }));
  put(`${field}_vs_x.svg`, svgPlot({ title, xLabel: 'x', yLabel: yl, series: ser }));
};
along('tauW', 'wall shear: floor tangential impulse per time per length (seed mean ± SE)', 'τ_w');
along('pW', 'wall pressure: floor normal impulse per time per length', 'p_w');
along('uWall', `near-wall velocity (y < ${C.observable.nearWallBand})`, 'u_wall');
along('psiWall', `near-wall mass flux ∫ρu dy (y < ${C.observable.nearWallBand})`, 'ψ_wall');
along('delta1', 'mass-flux deficit thickness δ₁', 'δ₁');
along('Ue', 'core velocity U_e', 'U_e');
// 10. time evolution in the primary region
const pr = A.details.primaryRegion as { columns: number[]; from: number; to: number } | null;
{
  const s = S[C.keys.strong];
  const cols = pr ? pr.columns : columnsIn(s, C.responseWindow);
  const ser: Series[] = [];
  s.blockU.forEach((seed) => ser.push({ label: '', x: seed.map((_, k) => k), y: seed.map((blk) => cols.reduce((a, i) => a + blk[i], 0) / cols.length), color: '#888', thin: true }));
  const K = s.blockU[0].length;
  const m = Array.from({ length: K }, (_, k) => seedStat(s.blockU.map((seed) => cols.reduce((a, i) => a + seed[k][i], 0) / cols.length)));
  ser.push({ label: `${C.keys.strong} seed mean`, x: m.map((_, k) => k), y: m.map((v) => v.mean), err: m.map((v) => v.se), color: COLORS[1], markers: true });
  const c1 = S[C.keys.attached];
  if (c1) {
    const cc = cols.map((i) => nearestColumn(c1, s.x[i]));
    const mc = Array.from({ length: K }, (_, k) => seedStat(c1.blockU.map((seed) => cc.reduce((a, i) => a + seed[k][i], 0) / cc.length)));
    ser.push({ label: `${C.keys.attached} (attached control)`, x: mc.map((_, k) => k), y: mc.map((v) => v.mean), err: mc.map((v) => v.se), color: COLORS[0], markers: true });
  }
  put('time_evolution_region.svg', svgPlot({ title: `near-wall velocity in ${pr ? `the primary region [${pr.from}, ${pr.to}]` : 'the response window'} per time block (thin: seeds)`, xLabel: 'measurement block', yLabel: 'u_wall', series: ser }));
}
// 11. seed-to-seed variation
for (const k of [C.keys.attached, C.keys.strong].filter((q) => S[q])) {
  const s = S[k];
  const ser: Series[] = s.perSeed.uWall.map((row) => ({ label: '', x: s.x, y: row, color: '#888', thin: true }));
  ser.push({ label: `${k} seed mean`, x: s.x, y: s.stat.uWall.map((v) => v.mean), err: s.stat.uWall.map((v) => v.se), color: COLORS[1] });
  put(`seeds_uwall_${k}.svg`, svgPlot({ title: `${k}: near-wall velocity per seed (thin) and ensemble`, xLabel: 'x', yLabel: 'u_wall', series: ser }));
}
// 12. convergence: variants vs references
for (const c of params.cases.filter((q) => q.role === 'variant' && S[q.key] && q.reference && S[q.reference])) {
  const r0 = S[c.reference!];
  const v = S[c.key];
  put(
    `convergence_${c.key}.svg`,
    svgPlot({
      title: `${c.variant} variant ${c.key} vs ${c.reference}: near-wall velocity`,
      xLabel: 'x',
      yLabel: 'u_wall',
      series: [
        { label: c.reference!, x: r0.x, y: r0.stat.uWall.map((q) => q.mean), err: r0.stat.uWall.map((q) => q.se), color: COLORS[0] },
        { label: c.key, x: v.x, y: v.stat.uWall.map((q) => q.mean), err: v.stat.uWall.map((q) => q.se), color: COLORS[1] },
      ],
    }),
  );
}
// threshold plot
{
  const ser: Series[] = [];
  Object.values(th).forEach((rows, q) => {
    const ok = rows.filter((r): r is NonNullable<typeof r> => !!r);
    if (!ok.length) return;
    ser.push({ label: `Aw ${ok[0].accommodation}: region u_wall`, x: ok.map((r) => r.expansion), y: ok.map((r) => r.regionU.mean), err: ok.map((r) => r.regionU.se), color: COLORS[q], markers: true });
  });
  put('threshold.svg', svgPlot({ title: 'near-wall velocity in the (strong-case) region vs ceiling expansion r', xLabel: 'r = H_out / H_in', yLabel: 'u_wall', series: ser }));
}
// animation (HTML canvas) from captured frames
for (const k of keysPresent) {
  const rs = byCase[k].filter((r) => r.frames.length > 1);
  if (!rs.length) continue;
  const r = rs[0];
  const W = r.config.frames!;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wall particles ${k}</title>
<style>body{font-family:sans-serif;margin:16px;background:#fff;color:#111}canvas{max-width:100%;border:1px solid #ccc}</style></head><body>
<h3>${k}, seed ${r.seed}: particles in x ∈ [${W.x0}, ${W.x1}], y &lt; ${W.height} (measured trajectories; colour = v_x, blue &lt; 0 &lt; red)</h3>
<canvas id="c"></canvas><div id="t"></div>
<script>
const F=${JSON.stringify(r.frames)};const X0=${W.x0},X1=${W.x1},H=${W.height},R=${r.config.radius};const s=Math.min(6,1100/(X1-X0));
const c=document.getElementById('c');c.width=(X1-X0)*s;c.height=H*s+8;const g=c.getContext('2d');let k=0;
function draw(){const f=F[k];g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#000';g.fillRect(0,H*s,c.width,8);
for(let q=0;q<f.p.length;q+=4){const vx=f.p[q+2],a=Math.min(1,Math.abs(vx)/1.5);g.fillStyle=vx>=0?'rgba(192,57,43,'+(0.25+0.75*a)+')':'rgba(33,102,172,'+(0.25+0.75*a)+')';
g.beginPath();g.arc((f.p[q]-X0)*s,H*s-f.p[q+1]*s,R*s,0,6.283);g.fill();}
document.getElementById('t').textContent='t = '+f.t.toFixed(2)+'  frame '+(k+1)+'/'+F.length;k=(k+1)%F.length;}
setInterval(draw,80);draw();
</script></body></html>`;
  put(`animation_${k}.html`, html);
}

// ------------------------------------------------------------------ JSON summary
const summary = {
  records: recs.map((r) => r.experimentId),
  classification: { partI: A.partI, partII: A.partII, overall: A.overall },
  checks: A.checks,
  regions: A.regions,
  details: A.details,
  cases: Object.fromEntries(
    Object.entries(S).map(([k, s]: [string, CaseSummary]) => [
      k,
      { seeds: s.seeds, x: s.x, height: s.height, stat: s.stat, blockNegative: s.blockNegative, halves: s.halves },
    ]),
  ),
  files,
};
put('report_bl_separation.json', JSON.stringify(summary, null, 1));
console.log(`\nFILES\n  ${files.join('\n  ')}`);
