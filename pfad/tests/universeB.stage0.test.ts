import { describe, expect, it } from 'vitest';
import { henderson } from '../src/universeB/CoarseGrainMap';
import type { PlannedRun } from '../src/universeB/UB0Plans';
import { UB0Run, type UB0Spec } from '../src/universeB/UB0Run';
import { staticEstimate } from '../src/universeB/UB0Estimators';
import { aggregateStage0, qualityGates } from '../src/universeB/UB0Stage0';

const A = { Nc: 1, ch: 0, e: 1, KTred: henderson.KTred(0.2), courant: 0.025, observables: true };
function runTiny(group: string, seed: number, spec: Omit<UB0Spec, 'id' | 'seed'>, periodHint?: number) {
  const plan: PlannedRun = { ...spec, id: `t-${group}-${seed}`, seed, group, planned: true, periodHint } as PlannedRun;
  const { group: _g, planned: _p, periodHint: _h, ...core } = plan;
  void _g;
  void _p;
  void _h;
  const run = new UB0Run(core);
  while (!run.done) run.advance(2000);
  return { plan, result: run.result() };
}

describe('Stage 0 aggregation (smoke test on tiny Universe A runs)', () => {
  it('runs end to end, applies the quality gates and forms K by the central difference', () => {
    const stat = (phi: number) => ({ kind: 'static' as const, phi, L: 14, prep: 3, settle: 1, measure: 20, sample: 1, ...A });
    const res = [
      ...[1, 2].map((s) => runTiny('SK18', s, stat(0.18))),
      ...[3, 4].map((s) => runTiny('SK20', s, stat(0.2))),
      ...[5, 6].map((s) => runTiny('SK22', s, stat(0.22))),
      ...[7, 8].map((s) => runTiny('SL', s, { ...stat(0.2), extras: true })),
      ...[9, 10].map((s) => runTiny('L160', s, { ...A, kind: 'sound', phi: 0.2, L: 14, amplitude: 0.05, prep: 3, settle: 1, measure: 30, sample: 0.5 }, 5)),
      ...[11, 12].map((s) => runTiny('W40', s, { ...A, kind: 'wall', phi: 0.2, width: 10, height: 12, prep: 3, settle: 0, measure: 20, sample: 1 })),
    ];
    for (const r of res) expect(qualityGates(r.result)).toEqual([]);
    const s = aggregateStage0(res);
    const p = (g: string) => res.filter((x) => x.plan.group === g).map((x) => staticEstimate(x.result).Pnorm);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const K = (0.2 / 0.04) * (mean(p('SK22')) - mean(p('SK18')));
    expect(s.mapping.KTred.value).toBeCloseTo(K / (0.2 / (Math.PI / 4)), 12);
    expect(s.excluded).toEqual([]);
    expect(s.predictionInputs).toHaveProperty('KTred');
    expect(Number.isFinite((s.references.c_A as { value: number }).value)).toBe(true);
  });
});
