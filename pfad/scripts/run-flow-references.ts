/**
 * Boundary-layer, separation and Kutta reference runs, with Re and Mp built from
 * MEASURED transport properties of other records (never from a formula):
 *   μ   — results/viscosity_reference.json (Couette, φ = 0.1)
 *   c_p — results/sound-speed_sweeps.json (Universe A case 'A φ=0.1')
 *   npx tsx scripts/run-flow-references.ts [threads] [boundary-layer|separation|kutta ...]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ADVERSE_GRADIENT_REFERENCE } from '../src/experiments/AdverseGradientExperiment';
import { BOUNDARY_LAYER_REFERENCE } from '../src/experiments/BoundaryLayerExperiment';
import type { ExperimentRecord } from '../src/experiments/Experiment';
import { KUTTA_REFERENCE } from '../src/experiments/KuttaExperiment';
import { runParallel } from './parallel';

const threads = Number(process.argv[2] ?? 4);
const which = process.argv.slice(3);
const wanted = (t: string) => which.length === 0 || which.includes(t);

type Measured = { value: number; se: number; source: string } | null;

function measuredViscosity(): Measured {
  const src = 'results/viscosity_reference.json';
  if (!existsSync(src)) return null;
  const rec = JSON.parse(readFileSync(src, 'utf8'));
  const c = rec.results.cases[0];
  if (!c?.muEff || !Number.isFinite(c.muEff.mean)) return null;
  return { value: c.muEff.mean, se: c.muEff.se, source: `${src} (${c.label}, Couette μ_eff, ${rec.modelVersion})` };
}

function measuredSoundSpeed(): Measured {
  const src = 'results/sound-speed_sweeps.json';
  if (!existsSync(src)) return null;
  const rec = JSON.parse(readFileSync(src, 'utf8'));
  const c = rec.results.cases.find((k: { label?: string } | null) => k?.label === 'A φ=0.1');
  if (!c?.speed || !c.track?.valid) return null;
  return { value: c.speed.mean, se: c.speed.se, source: `${src} (${c.label}, ${rec.modelVersion})` };
}

function summary(rec: ExperimentRecord): string {
  const lines = [`${rec.title}: ${rec.status}`];
  for (const c of rec.acceptance) lines.push(`  [${c.status}] ${c.id}: ${c.measured} (criterion: ${c.criterion})`);
  lines.push(`  Re: ${rec.reynolds.note}`);
  lines.push(`  Mp: ${rec.mach.Mp ?? 'n/a'} — ${rec.mach.note}`);
  return lines.join('\n');
}

(async () => {
  const viscosity = measuredViscosity();
  const soundSpeed = measuredSoundSpeed();
  console.log(`measured μ: ${viscosity ? `${viscosity.value} ± ${viscosity.se} from ${viscosity.source}` : 'none'}`);
  console.log(`measured c_p: ${soundSpeed ? `${soundSpeed.value} ± ${soundSpeed.se} from ${soundSpeed.source}` : 'none'}`);
  const jobs = [
    ['boundary-layer', { ...BOUNDARY_LAYER_REFERENCE, viscosity, soundSpeed }, 'boundary-layer_reference'],
    ['separation', { ...ADVERSE_GRADIENT_REFERENCE, viscosity, soundSpeed }, 'separation_reference'],
    ['kutta', { ...KUTTA_REFERENCE, viscosity, soundSpeed }, 'kutta_reference'],
  ] as const;
  for (const [type, params, name] of jobs) {
    if (!wanted(type)) continue;
    const t0 = Date.now();
    const rec = await runParallel(type, params, threads, (d, n) => process.stdout.write(`\r${type}: ${d}/${n}   `));
    writeFileSync(`results/${name}.json`, JSON.stringify(rec));
    console.log(`\n${summary(rec)}\n(${((Date.now() - t0) / 1000).toFixed(0)} s) → results/${name}.json\n`);
  }
})();
