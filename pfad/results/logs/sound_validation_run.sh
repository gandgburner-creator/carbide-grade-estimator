#!/bin/bash
# Item 2 validation (seeds 6001-6064), pre-registered in docs/CRITERIA_SOUND_SPEED.md.
cd "$(dirname "$0")/../.."
L=results/logs/sound_validation_timings.txt
echo "commit $(git rev-parse HEAD)" > $L
echo "host $(nproc) cores; node $(node --version)" >> $L
CMD=(npx tsx scripts/run-experiment.ts sound-speed-validation --parallel 4 --out results --name sound-speed_validation)
t0=$(date +%s); echo "START $(date -u +%FT%TZ): ${CMD[*]}" >> $L
NODE_OPTIONS=--max-old-space-size=8192 "${CMD[@]}" > results/logs/sound_validation.out 2>&1; rc=$?
echo "END   $(date -u +%FT%TZ) exit=$rc seconds=$(($(date +%s)-t0))" >> $L
echo DONE > results/logs/sound_validation.done
