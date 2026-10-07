/**
 * Integrator implementation check for UB-0 (NOT a pilot, NOT judged data).
 *
 *   npx tsx scripts/ub0-drift-check.ts [--out results/ub0/implementation/drift_check.json]
 *
 * Small boxes with the judged geometry ratios, design seeds 9961+ (block
 * 9501–9999, never judged), one seed per case, a 60 D/σ_v window at Courant
 * 0.025 and 0.0125. Reads ONLY the energy ledger and, after the run has
 * finished, the occupancy stiffness ω·dt of the final configuration
 * (read-only). No physics observable is computed.
 *
 * Reports per case: the energy residual at t ≈ 30 and 60 (linear growth gives a
 * ratio ≈ 2, a random walk ≈ 1.4), the drift rate per D/σ_v, its linear
 * extrapolation to the judged measurement window against the PQ7(b) gate
 * (A1 §4.3), and the order between the two Courant numbers (4 = second order).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { henderson, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { DRIFT_LIMIT_STATIC, DRIFT_LIMIT_WAVE } from '../src/universeB/UB0Blind';
import { tauD } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';
import type { UBOccupancyForce } from '../src/universeB/UBOccupancyForce';

const argv = process.argv.slice(2);
const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'results/ub0/implementation/drift_check.json';
const KT = henderson.KTred(UB0_PHI);
const W = 60;

interface Case {
  name: string;
  spec: Partial<UB0Spec>;
  judgedWindow: number;
  wave: boolean;
}
const cases: Case[] = [
  { name: 'SK N4 c2 (500)', spec: { kind: 'static', Nc: 4, ch: 2, L: 24 }, judgedWindow: 500, wave: false },
  { name: 'SL N4 c2 (4200)', spec: { kind: 'static', Nc: 4, ch: 2, L: 24 }, judgedWindow: 4200, wave: false },
  { name: 'SK N4 c4 (500)', spec: { kind: 'static', Nc: 4, ch: 4, L: 26 }, judgedWindow: 500, wave: false },
  { name: 'SL/SK N16 c2 (4200)', spec: { kind: 'static', Nc: 16, ch: 2, L: 26 }, judgedWindow: 4200, wave: false },
  { name: 'SK N64 c2 (500)', spec: { kind: 'static', Nc: 64, ch: 2, L: 50 }, judgedWindow: 500, wave: false },
  { name: 'W N4 c2 (2000)', spec: { kind: 'wall', Nc: 4, ch: 2, width: 14, height: 40, settle: 0 }, judgedWindow: 2000, wave: false },
  { name: 'W N4 c4 (2000)', spec: { kind: 'wall', Nc: 4, ch: 4, width: 26, height: 80, settle: 0 }, judgedWindow: 2000, wave: false },
  { name: 'W N16 c2 (2000)', spec: { kind: 'wall', Nc: 16, ch: 2, width: 26, height: 80, settle: 0 }, judgedWindow: 2000, wave: false },
  { name: 'C N4 (3000)', spec: { kind: 'couette', Nc: 4, ch: 2, width: 14, height: 40, wallSpeed: 1, settle: 0 }, judgedWindow: 3000, wave: false },
  { name: 'C N16 (3000)', spec: { kind: 'couette', Nc: 16, ch: 2, width: 26, height: 40, wallSpeed: 1, settle: 0 }, judgedWindow: 3000, wave: false },
  { name: 'T N4 a1 (1.5τD80)', spec: { kind: 'shear', Nc: 4, ch: 2, L: 24, amplitude: 1 }, judgedWindow: 1.5 * tauD(80), wave: true },
  { name: 'T N4 a0.5 (1.5τD80)', spec: { kind: 'shear', Nc: 4, ch: 2, L: 24, amplitude: 0.5 }, judgedWindow: 1.5 * tauD(80), wave: true },
  { name: 'T N16 a1 (1.5τD80)', spec: { kind: 'shear', Nc: 16, ch: 2, L: 26, amplitude: 1 }, judgedWindow: 1.5 * tauD(80), wave: true },
];

const rows: Record<string, unknown>[] = [];
let seed = 9961;
console.log('case                   Courant  res(30)    res(60)   60/30  rate/(D/σ_v)  judged-window extrapolation   ω·dt(end)');
for (const c of cases) {
  const s0 = seed++;
  const proj: number[] = [];
  for (const courant of [0.025, 0.0125]) {
    const spec = { e: 0.9, KTred: KT, phi: UB0_PHI, observables: false, prep: 5, settle: 1, sample: 1, measure: W, id: 'drift-check', seed: s0, courant, ...c.spec } as UB0Spec;
    const run = new UB0Run(spec);
    let wave = Number.NaN;
    let at30 = Number.NaN;
    let t30 = Number.NaN;
    const norm = () => (c.wave ? run.sim.energyResidual() / wave : run.sim.energyResidual() / Math.abs(run.sim.E0));
    while (!run.done) {
      run.advance(200);
      const phase = (run as unknown as { phase: string }).phase;
      if (phase === 'measure' && Number.isNaN(wave)) wave = run.info.imposedKineticEnergy ?? Number.NaN;
      if (phase === 'measure' && Number.isNaN(at30) && run.sim.time / spec.Nc >= 30) {
        at30 = norm();
        t30 = run.sim.time / spec.Nc;
      }
    }
    const r = run.result();
    const m = r.phaseLedgers.measure as { energyResidual: number; relativeEnergyResidual: number };
    const rel = c.wave ? m.energyResidual / r.info.imposedKineticEnergy : m.relativeEnergyResidual;
    const rate = rel / W;
    const p = rate * c.judgedWindow;
    proj.push(p);
    const gate = c.wave ? DRIFT_LIMIT_WAVE : DRIFT_LIMIT_STATIC;
    const occ = run.sim.forceModels[0] as UBOccupancyForce | undefined;
    const omegaDt = occ ? occ.maxOmega(run.sim.store, run.sim.domain) * run.sim.lastDt : Number.NaN;
    rows.push({ case: c.name, spec: { ...spec, id: undefined }, courant, residual30: at30, t30, residual60: rel, ratio60over30: rel / at30, ratePerDsigma: rate, judgedWindow: c.judgedWindow, extrapolated: p, gate, overGate: Math.abs(p) > gate, omegaDtEnd: omegaDt });
    console.log(
      `${c.name.padEnd(22)} ${courant.toString().padEnd(7)} ${at30.toExponential(2).padStart(9)} ${rel.toExponential(2).padStart(9)} ${(rel / at30).toFixed(2).padStart(6)} ${rate.toExponential(2).padStart(12)}   ${p.toExponential(1).padStart(8)} vs ${gate.toExponential(0)} ${Math.abs(p) > gate ? 'OVER' : 'ok  '}   ${Number.isFinite(omegaDt) ? omegaDt.toFixed(4) : '—'}`,
    );
  }
  console.log(`${''.padEnd(22)} order 0.025→0.0125: ${(proj[0] / proj[1]).toFixed(1)}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ note: 'implementation check; design seeds 9961+; energy ledger and end-of-run ω·dt only', window: W, rows }, null, 1)}\n`);
console.log(`wrote ${out}`);
