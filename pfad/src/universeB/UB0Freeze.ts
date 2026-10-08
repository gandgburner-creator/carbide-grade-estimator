import { UB0_PHI } from './CoarseGrainMap';
import type { FrozenJudged } from './UB0Pipeline';
import type { SoundAmplitude } from './UB0Plans';
import { lucyHat } from './Predictions';
import type { MatchedReferences } from './UB0Stage0b';
import type { Stat } from './UB0Stage0';

/**
 * The frozen inputs of the Universe B plan and the judged analysis (amendment A2 §7;
 * scripts/ub0-freeze.ts). Composed from:
 *   - the Stage 0 mapping input K_T,A (UNCHANGED by Stage 0b: it alone sets k_s);
 *   - the Stage 0b matched Universe A references and the amplitude decision;
 *   - the post-D2 analytical predictions regenerated with the Stage 0b inputs.
 * A prediction file without the A2 map marker is refused, so pre- and post-D2 outputs
 * can never be mixed.
 */
export interface PredictionFile {
  label: string;
  commit: string;
  map?: { releaseFraction: string; amendment: string };
  values: Record<string, number>;
}

export function assertPostD2(p: PredictionFile): void {
  if (!p.map || p.map.amendment !== 'A2 (D2)') throw new Error(`prediction file '${p.label}' (${p.commit}) predates the A2 release-fraction correction; regenerate it`);
}

export function composeFrozen(o: {
  KTred: Stat;
  refs: MatchedReferences;
  amplitude: SoundAmplitude;
  pred: PredictionFile;
  provenance: Record<string, string>;
}): FrozenJudged & { note: string; provenance: Record<string, string>; KTredStat: Stat; cAStat: MatchedReferences['cA']; courant: Record<string, number> } {
  assertPostD2(o.pred);
  const v = o.pred.values;
  const get = (k: string) => {
    const x = v[k];
    if (!Number.isFinite(x)) throw new Error(`prediction value ${k} missing`);
    return x;
  };
  const n = UB0_PHI / (Math.PI / 4);
  const shellW = (Nc: number): [number, number] => {
    const h = 2 * Math.sqrt(Nc); // c_h = 2, in D
    const k1 = (2 * Math.PI) / 80;
    return [lucyHat(k1, h), lucyHat(Math.SQRT2 * k1, h)];
  };
  return {
    version: 'A2',
    note: 'UB-0 frozen inputs (amendment A2). Universe A statistics (Stage 0 + Stage 0b) and post-D2 analytical predictions only; no Universe B data.',
    provenance: o.provenance,
    KTred: o.KTred.value,
    KTredStat: o.KTred,
    cA: { 4: o.refs.cA[4].value, 16: o.refs.cA[16].value, 64: o.refs.cA[64].value },
    cAStat: o.refs.cA,
    soundAmplitude: o.amplitude,
    courant: o.refs.courant,
    cRatio: { 4: [get('mf.cLo.4'), get('mf.cHi.4')], 16: [get('mf.cLo.16'), get('mf.cHi.16')], 64: [get('mf.cLo.64'), get('mf.cHi.64')] },
    judgedGamma: { 4: [get('pq3.lo.4'), get('pq3.hi.4')], 16: [get('pq3.lo.16'), get('pq3.hi.16')], 64: [get('pq3.lo.64'), get('pq3.hi.64')] },
    What160: { 4: get('mf.What160.4'), 16: get('mf.What160.16'), 64: get('mf.What160.64') },
    WhatShells: { 4: shellW(4), 16: shellW(16) },
    rpaStrength: { 4: 3 * o.KTred.value, 16: 15 * o.KTred.value },
    rho: n,
    A: {
      nu: o.refs.nu,
      KT: { ...o.KTred, value: o.KTred.value * n, se: o.KTred.se * n },
      SA: o.refs.SA,
    },
  };
}
