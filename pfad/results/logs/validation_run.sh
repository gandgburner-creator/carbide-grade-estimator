#!/bin/bash
# Fresh thermal validation (seeds 31-40), pre-registered in docs/CRITERIA_THERMAL_VISCOSITY.md section 6.
cd "$(dirname "$0")/../.."
L=results/logs/validation_timings.txt
echo "commit $(git rev-parse HEAD)" > $L
echo "host $(nproc) cores; node $(node --version)" >> $L
CMD=(npx tsx scripts/run-experiment.ts thermal --parallel 4 --set 'seeds=[31,32,33,34,35,36,37,38,39,40]' --out results --name thermal_validation_s31-40)
t0=$(date +%s); echo "START $(date -u +%FT%TZ): ${CMD[*]}" >> $L
"${CMD[@]}" > results/logs/thermal_validation.out 2>&1; rc=$?
echo "END   $(date -u +%FT%TZ) exit=$rc seconds=$(($(date +%s)-t0))" >> $L
echo DONE > results/logs/validation.done
