/**
 * Couette reference + sweeps, with Mp = U/c_p taken from MEASURED pulse
 * speeds (results/sound-speed_sweeps.json, Universe A cases 'A φ=…').
 *   npx tsx scripts/run-couette-reference.ts [threads]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { COUETTE_REFERENCE, COUETTE_SWEEPS, type CouetteParams } from '../src/experiments/CouetteExperiment';
import { runParallel } from './parallel';

const threads = Number(process.argv[2] ?? 4);
const soundSpeed: CouetteParams['soundSpeed'] = [];
const src = 'results/sound-speed_sweeps.json';
if (existsSync(src)) {
  const rec = JSON.parse(readFileSync(src, 'utf8'));
  for (const c of rec.results.cases) {
    const m = /^A φ=([0-9.]+)$/.exec(c?.label ?? '');
    if (m && c.speed && c.track.valid) {
      soundSpeed.push({ areaFraction: Number(m[1]), value: c.speed.mean, se: c.speed.se, source: `${src} (${c.label}, kT = 1, ${rec.modelVersion})` });
    }
  }
}
console.log('measured c_p available for φ =', soundSpeed.map((s) => s.areaFraction).join(', ') || 'none');

(async () => {
  for (const [type, base, name] of [
    ['viscosity', COUETTE_REFERENCE, 'viscosity_reference'],
    ['viscosity-sweeps', COUETTE_SWEEPS, 'viscosity_sweeps'],
  ] as const) {
    const t0 = Date.now();
    const rec = await runParallel(type, { ...base, soundSpeed }, threads, (d, n) => process.stdout.write(`\r${type}: ${d}/${n}   `));
    writeFileSync(`results/${name}.json`, JSON.stringify(rec));
    console.log(`\n${type}: ${rec.status} (${((Date.now() - t0) / 1000).toFixed(0)} s) → results/${name}.json`);
  }
})();
