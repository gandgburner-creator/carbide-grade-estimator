import type { SurfaceFlowAnalysis } from '../measurements/SeparationDetector';
import { basisFromAnalysis } from './Basis';
import type { AnalysisMode, ConstructionBasis } from './Construction';
import type { RunSummary } from './History';
import type { Side } from './SurfaceGeometry';

/**
 * AUTO-BUILD (experimental): repeat "simulate, propose, accept" without clicking, and stop by itself
 * when the measurements give nothing to respond to.
 *
 * It decides nothing that the manual workflow does not already decide. Each step uses the same
 * construction rule (Construction.ts) on the same measured basis (Basis.ts); only the clicking is
 * automated. What is added here is the choice of side and evidence, and the stopping rule, both
 * stated in plain terms:
 *
 *   side      the side with the STRONGEST MEASURED BACKFLOW, i.e. the most negative region-mean
 *             near-wall flux Q_w. Detector regions (CANDIDATE_SEPARATION or better) come before weak ones.
 *   evidence  'detector' when the detector reports a candidate region on some side; otherwise, only
 *             if the person allowed it, 'exploratory' (a stretch whose pooled flux is negative but
 *             not significantly so). An exploratory increment is a hypothesis test built from
 *             measurements that noise alone could produce, and is tagged as such everywhere.
 *
 *   stop      'finished'          the requested number of increments was added (the last one was simulated)
 *             'nothing-measured'  no side offers anything to respond to (reason given per side)
 *             'failed'            a run did not pass its numerical-integrity checks, so its measurements
 *                                 cannot be trusted
 *             'limit'             an increment would break the geometry limits (thickness, slope, curvature)
 *             'user'              the person stopped it
 *
 * Nothing here is an optimiser: it has no objective, never compares versions to decide, and the
 * only judgement made after each re-simulation is the one the proposal stated in advance (reported
 * by the comparison, not used to steer).
 */
export interface AutoChoice {
  side: Side;
  mode: AnalysisMode;
  basis: ConstructionBasis;
  /** region-mean near-wall flux Q_w of the stretch chosen (more negative = more backflow) */
  strength: number;
  /** one sentence for the log */
  why: string;
}

export type AutoDecision = { ok: true; choice: AutoChoice } | { ok: false; reason: string };

const SIDES: Side[] = ['upper', 'lower'];

/** Pick the next stretch to respond to, or say why there is none. */
export function chooseNext(analyses: Record<Side, SurfaceFlowAnalysis>, allowWeak: boolean, source: { recordId: string | null; versionId: string | null }): AutoDecision {
  const detector: AutoChoice[] = [];
  const weak: AutoChoice[] = [];
  const why: string[] = [];
  for (const side of SIDES) {
    const a = analyses[side];
    const d = basisFromAnalysis(a, 'detector', source);
    if (d.ok && a.region && a.region.kind === 'reversed') {
      detector.push({ side, mode: 'detector', basis: d.basis, strength: a.region.meanQw, why: `the detector reports ${a.level.replace(/_/g, ' ').toLowerCase()} on the ${side} side` });
      continue;
    }
    if (!d.ok) why.push(`${side}: ${d.reason}`);
    if (!allowWeak) continue;
    const w = basisFromAnalysis(a, 'exploratory', source);
    if (w.ok && a.primary.exploratory) weak.push({ side, mode: 'exploratory', basis: w.basis, strength: a.primary.exploratory.meanQw, why: `weak evidence on the ${side} side (pooled flux negative but not significant)` });
    else if (!w.ok) why.push(`${side}: ${w.reason}`);
  }
  const strongest = (list: AutoChoice[]) => [...list].sort((p, q) => p.strength - q.strength)[0];
  if (detector.length) return { ok: true, choice: strongest(detector) };
  if (weak.length) return { ok: true, choice: strongest(weak) };
  return {
    ok: false,
    reason: `nothing is measured to respond to${allowWeak ? '' : ' at the detector’s evidence level (use of weak evidence is switched off)'}. ${why.join('; ')}`,
  };
}

export interface AutoState {
  /** increments to add in total, and how many have been added */
  target: number;
  done: number;
  allowWeak: boolean;
  /** the finished run of the head version, or null if it has not been simulated */
  headRun: RunSummary | null;
  headId: string;
}

export type StopKind = 'finished' | 'nothing-measured' | 'failed' | 'limit' | 'user';

export type AutoAction = { kind: 'simulate' } | { kind: 'propose'; choice: AutoChoice } | { kind: 'stop'; stop: StopKind; reason: string };

/** What auto-build does next, given where it stands. Pure: the same state gives the same action. */
export function nextAutoAction(s: AutoState): AutoAction {
  if (!s.headRun) return { kind: 'simulate' };
  if (s.headRun.integrity.status !== 'PASSED') {
    return { kind: 'stop', stop: 'failed', reason: `the run of ${s.headId} did not pass its numerical-integrity checks (${s.headRun.integrity.status}), so its measurements cannot be trusted` };
  }
  if (s.done >= s.target) return { kind: 'stop', stop: 'finished', reason: `added ${s.done} increment${s.done === 1 ? '' : 's'}, as asked, and simulated the result` };
  const d = chooseNext(s.headRun.analysis, s.allowWeak, { recordId: s.headRun.recordId, versionId: s.headId });
  if (!d.ok) return { kind: 'stop', stop: 'nothing-measured', reason: d.reason };
  return { kind: 'propose', choice: d.choice };
}
