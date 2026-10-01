#!/bin/bash
# Item 3 validation (seeds 7001-7304), pre-registered in docs/CRITERIA_BOUNDARY_LAYER_SEPARATION.md.
# Run from a worktree whose src/ and criteria are identical to the pre-registration commit (bb7f92e).
# Groups run one after another; each writes its own raw record results/bl-separation_<group>.json.
# Every finished run is checkpointed under results/checkpoints/bl-separation_<group>/, so the script
# can be re-launched after an interruption: finished groups are skipped and finished runs are reused
# (a run is deterministic for its seed, so a resumed record equals an uninterrupted one).
cd "$(dirname "$0")/../.."
L=results/logs/bl_validation_timings.txt
echo "commit $(git rev-parse HEAD) (launch $(date -u +%FT%TZ))" >> $L
echo "host $(nproc) cores; node $(node --version)" >> $L
for G in aw1 aw0 variants aw05; do
  if [ -f results/bl-separation_$G.json ]; then echo "SKIP  group=$G (record exists)" >> $L; continue; fi
  CMD=(npx tsx scripts/run-experiment.ts boundary-layer-separation --parallel 4 --set "groups=[\"$G\"]" --out results --name bl-separation_$G --checkpoint results/checkpoints/bl-separation_$G)
  t0=$(date +%s); echo "START $(date -u +%FT%TZ): ${CMD[*]}" >> $L
  NODE_OPTIONS=--max-old-space-size=12000 "${CMD[@]}" >> results/logs/bl_validation_$G.out 2>&1; rc=$?
  echo "END   $(date -u +%FT%TZ) group=$G exit=$rc seconds=$(($(date +%s)-t0))" >> $L
  if [ $rc -ne 0 ]; then echo "ABORT group $G" >> $L; break; fi
done
echo DONE > results/logs/bl_validation.done
