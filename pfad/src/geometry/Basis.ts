import { LEVELS, type SurfaceFlowAnalysis } from '../measurements/SeparationDetector';
import type { AnalysisMode, BasisStation, ConstructionBasis } from './Construction';

/**
 * Turn a detector analysis of one side into the basis of a construction proposal.
 *
 * 'detector' mode needs the detector's own region at level CANDIDATE_SEPARATION or higher and uses
 * the significance-gated dividing-streamline heights. 'exploratory' mode uses the weaker region
 * (stations whose pooled flux is negative but not significantly so) and the ungated point
 * estimates: it exists so the loop can be exercised at the statistics a browser run affords, it
 * is labelled as such everywhere, and it is never a detection.
 */
export function basisFromAnalysis(
  a: SurfaceFlowAnalysis,
  mode: AnalysisMode,
  source: { recordId: string | null; versionId: string | null },
): { ok: true; basis: ConstructionBasis } | { ok: false; reason: string } {
  const st = a.primary.stations;
  const bs = (gated: boolean): BasisStation[] =>
    st.map((s) => {
      const h = gated ? s.hds : s.hdsRaw;
      return { x: s.x, h: h.value, se: h.se, state: h.state, qw: s.qw.mean, u1: s.u1.mean };
    });
  const seeds = a.data.seeds;
  if (mode === 'detector') {
    const r = a.region;
    if (!r || r.kind !== 'reversed') return { ok: false, reason: `the detector finds no backflow region on the ${a.side} side (level ${a.level})` };
    if (LEVELS.indexOf(a.level) < LEVELS.indexOf('CANDIDATE_SEPARATION')) return { ok: false, reason: `the detector level ${a.level} is below CANDIDATE_SEPARATION: use exploratory mode to build from weaker evidence` };
    return {
      ok: true,
      basis: {
        side: a.side,
        mode,
        detector: a.detector,
        level: a.level,
        region: { xLo: r.xLo, xHi: r.xHi },
        stations: bs(true),
        source: { ...source, seeds },
        summary: `Detector ${a.detector} reports ${a.level} on the ${a.side} side over x = ${r.xLo.toFixed(1)}–${r.xHi.toFixed(1)} d (region-mean Q_w = ${r.meanQw.toFixed(4)}, backflow in ${(100 * r.persistence).toFixed(0)} % of time blocks, ${seeds.length} seeds).`,
      },
    };
  }
  const e = a.primary.exploratory;
  if (!e) return { ok: false, reason: `no stretch of the ${a.side} side has a forward outer flow and a negative pooled flux with a dividing streamline: there is nothing to respond to` };
  return {
    ok: true,
    basis: {
      side: a.side,
      mode,
      detector: a.detector,
      level: a.level,
      region: { xLo: e.xLo, xHi: e.xHi },
      stations: bs(false),
      source: { ...source, seeds },
      summary:
        `EXPLORATORY — detector level on the ${a.side} side is ${a.level}, below a candidate: over x = ${e.xLo.toFixed(1)}–${e.xHi.toFixed(1)} d (${e.stations} stations) the pooled flux Q_w is negative ` +
        `(mean ${e.meanQw.toFixed(4)}) but not significantly. The heights are point estimates of the pooled flux profile and may be produced by noise.`,
    },
  };
}
