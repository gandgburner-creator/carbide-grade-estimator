/**
 * Compose the frozen inputs for the Universe B runs and the judged analysis
 * (amendment A2 §7: after Stage 0b). Universe A data and post-D2 analytical predictions only.
 *
 *   npx tsx scripts/ub0-freeze.ts [--stage0 results/ub0/stage0] [--stage0b results/ub0/stage0b]
 *        [--pred results/ub0/predictions_stage0b.json] [--out results/ub0/frozen_inputs.json]
 *
 * Order (A2 §7): Stage 0b analysis (--final, no review open) → the predictions regenerated
 * with results/ub0/stage0b/stage0b_reference.json (label stage0b) → this script →
 * scripts/ub0-power.ts (final power plan and seed plan).
 *
 * The file it writes holds (src/universeB/UB0Freeze.ts):
 *  - KTred: the Stage 0 mapping input (sets k_s) — the ONLY Universe A value that sets a
 *    Universe B parameter, unchanged by Stage 0b;
 *  - cA per N_c (matched Courant numbers), soundAmplitude, cRatio: standing-wave length and amplitude;
 *  - judgedGamma: PQ3 judged intervals with propagated uncertainty (A1 §5), per N_c's matched c_A;
 *  - WhatShells, rpaStrength, rho, What160: PQ5 and PQ3 constants;
 *  - A: matched Universe A references for PQ1, PQ2 (K_T,A), PQ5.
 * The previous (Stage 0, pre-A2) file stays in git history (f8cb934).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeFrozen, type PredictionFile } from '../src/universeB/UB0Freeze';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const s0 = JSON.parse(readFileSync(join(arg('--stage0', 'results/ub0/stage0'), 'stage0_summary.json'), 'utf8'));
const s0b = JSON.parse(readFileSync(join(arg('--stage0b', 'results/ub0/stage0b'), 'stage0b_summary.json'), 'utf8'));
const predFile = arg('--pred', 'results/ub0/predictions_stage0b.json');
const pred = JSON.parse(readFileSync(predFile, 'utf8')) as PredictionFile;
const out = arg('--out', 'results/ub0/frozen_inputs.json');
if (s0b.review?.length) {
  console.error(`Stage 0b raised ${s0b.review.length} review trigger(s); nothing is frozen until the review:\n  ${s0b.review.join('\n  ')}`);
  process.exit(4);
}
if (pred.label !== 'stage0b') throw new Error(`predictions ${predFile} are labelled '${pred.label}', not 'stage0b'`);
const frozen = composeFrozen({
  KTred: s0.mapping.KTred,
  refs: s0b.matchedReferences,
  amplitude: s0b.amplitude,
  pred,
  provenance: { stage0Commit: s0.commit, stage0bCommit: s0b.commit, predictionsCommit: pred.commit, predictions: predFile },
});
writeFileSync(out, `${JSON.stringify(frozen, null, 1)}\n`);
console.log(JSON.stringify(frozen, null, 1));
console.log(`\nwrote ${out}`);
