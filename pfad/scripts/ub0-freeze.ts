/**
 * Compose the frozen inputs for the Universe B runs and the judged analysis
 * (gate G3, after Stage 0). Universe A data and analytical predictions only.
 *
 *   npx tsx scripts/ub0-freeze.ts [--stage0 results/ub0/stage0] [--pred results/ub0/predictions_stage0.json]
 *
 * Writes results/ub0/frozen_inputs.json:
 *  - KTred: the mapping input (sets k_s); the ONLY Universe A value that sets a Universe B parameter
 *  - cA, cRatio: for the standing-wave length and amplitude (A1 §4.2)
 *  - judgedGamma: PQ3 judged intervals with propagated uncertainty (A1 §5)
 *  - WhatShells, rpaStrength, rho: PQ5 and PQ3 constants
 *  - A: Universe A reference statistics for PQ1, PQ2, PQ5
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { lucyHat } from '../src/universeB/Predictions';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const s0dir = arg('--stage0', 'results/ub0/stage0');
const predFile = arg('--pred', 'results/ub0/predictions_stage0.json');
const summary = JSON.parse(readFileSync(join(s0dir, 'stage0_summary.json'), 'utf8'));
const pred = JSON.parse(readFileSync(predFile, 'utf8'));
const v = pred.values as Record<string, number>;
const n = UB0_PHI / (Math.PI / 4);
const KTred = summary.mapping.KTred;
const ref = summary.references;
const shellW = (Nc: number): [number, number] => {
  const h = 2 * Math.sqrt(Nc); // c_h = 2, in D
  const k1 = (2 * Math.PI) / 80;
  return [lucyHat(k1, h), lucyHat(Math.SQRT2 * k1, h)];
};
const frozen = {
  note: 'UB-0 frozen inputs (gate G3). Universe A Stage 0 statistics and analytical predictions only; no Universe B data.',
  stage0Commit: summary.commit,
  predictionsCommit: pred.commit,
  KTred: KTred.value,
  KTredStat: KTred,
  cA: ref.c_A.value,
  cRatio: { 4: [v['mf.cLo.4'], v['mf.cHi.4']], 16: [v['mf.cLo.16'], v['mf.cHi.16']], 64: [v['mf.cLo.64'], v['mf.cHi.64']] },
  judgedGamma: { 4: [v['pq3.lo.4'], v['pq3.hi.4']], 16: [v['pq3.lo.16'], v['pq3.hi.16']], 64: [v['pq3.lo.64'], v['pq3.hi.64']] },
  What160: { 4: v['mf.What160.4'], 16: v['mf.What160.16'], 64: v['mf.What160.64'] },
  WhatShells: { 4: shellW(4), 16: shellW(16) },
  rpaStrength: { 4: 3 * KTred.value, 16: 15 * KTred.value },
  rho: n,
  A: {
    nuL80: ref.nu_L80_U1,
    nuL160: ref.nu_L160_U1,
    KT: { ...KTred, value: KTred.value * n, se: KTred.se * n },
    SA: [ref.S_A_shell1, ref.S_A_shell2],
  },
};
writeFileSync('results/ub0/frozen_inputs.json', JSON.stringify(frozen, null, 1));
console.log(JSON.stringify(frozen, null, 1));
