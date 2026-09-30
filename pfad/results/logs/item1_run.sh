#!/bin/bash
# Item 1 reruns at commit dac9f52 (criteria: docs/CRITERIA_THERMAL_VISCOSITY.md)
cd "$(dirname "$0")/../.."
T=results/logs/timings.txt
: > $T
run() { local name=$1; shift; local t0=$(date +%s); echo "START $name $(date -u +%FT%TZ): $*" >> $T; "$@" > results/logs/$name.log 2>&1; echo "END   $name $(date -u +%FT%TZ) exit=$? seconds=$(($(date +%s)-t0))" >> $T; }
run viscosity_reference npx tsx scripts/run-couette-reference.ts 4 viscosity
run viscosity_courant-0.05 npx tsx scripts/run-experiment.ts viscosity --parallel 4 --set 'timestep={"kind":"adaptive","courant":0.05,"dtMax":1,"dtMin":1e-7}' --set 'seeds=[101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130]' --out results --name viscosity_courant-0.05
run thermal_reference npx tsx scripts/run-experiment.ts thermal --parallel 4 --out results --name thermal_reference
echo ALL_DONE > results/logs/item1.done
