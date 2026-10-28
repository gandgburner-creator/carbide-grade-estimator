import type { ExperimentRecord } from '../experiments/Experiment';
import type { FlowGeometryResults } from '../experiments/FlowGeometryExperiment';
import type { RunSummary } from './History';

/** Compact summary of a finished flow-geometry record, kept with the version it simulated. */
export function runSummaryFromRecord(record: ExperimentRecord, meta: { codeVersion: string; activeMs: number | null }): RunSummary {
  if (record.experimentType !== 'flow-geometry') throw new Error(`expected a flow-geometry record, got ${record.experimentType}`);
  const r = record.results as unknown as FlowGeometryResults;
  if (!r.surfaceFlow) throw new Error('the run produced no measurement (every seed halted)');
  // the flow conditions are everything in the configuration except the geometry and the seeds
  const conditions: Record<string, unknown> = { ...(record.config as Record<string, unknown>) };
  delete conditions.geometry;
  delete conditions.seeds;
  const halted = r.perSeed.filter((s) => s.halted).length;
  return {
    recordId: record.experimentId,
    experimentId: record.experimentId,
    seeds: record.seeds.slice(),
    finishedAt: record.timestamp,
    activeMs: meta.activeMs,
    codeVersion: meta.codeVersion,
    modelVersion: record.modelVersion,
    conditions,
    integrity: {
      status: record.status,
      maxEnergyResidual: Number(record.acceptance.find((c) => c.id === 'energy-accounting')?.measured ?? Number.NaN),
      maxMomentumResidual: Number(record.acceptance.find((c) => c.id === 'momentum-accounting')?.measured ?? Number.NaN),
      halted,
      insideDetections: Number(record.acceptance.find((c) => c.id === 'no-penetration')?.measured ?? Number.NaN),
    },
    analysis: r.surfaceFlow,
    ...(r.wake ? { wake: r.wake } : {}),
    forces: { fx: r.forces.fx, fy: r.forces.fy, moment: r.forces.moment },
  };
}
