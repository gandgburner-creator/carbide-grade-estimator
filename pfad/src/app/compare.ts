import type { ExperimentRecord } from '../experiments/Experiment';
import { flatten, type Row } from './flatten';

/**
 * Side-by-side comparison of two records' measured results (record.results).
 * Descriptive only: the difference and its combined standard error
 * √(se_a² + se_b²) assume independent runs; z = Δ / se_Δ is a scale, not a
 * preregistered test. Formal comparisons use the A/B experiment (§40).
 */
export interface ComparedRow {
  path: string;
  a: Row | null;
  b: Row | null;
  diff: number | null;
  seDiff: number | null;
  z: number | null;
}

export interface Comparison {
  sameType: boolean;
  sameModel: boolean;
  rows: ComparedRow[];
  notes: string[];
}

export function compareRecords(a: ExperimentRecord, b: ExperimentRecord): Comparison {
  const ra = new Map(flatten(a.results).map((r) => [r.path, r]));
  const rb = new Map(flatten(b.results).map((r) => [r.path, r]));
  const paths = [...new Set([...ra.keys(), ...rb.keys()])];
  const rows: ComparedRow[] = paths.map((path) => {
    const x = ra.get(path) ?? null;
    const y = rb.get(path) ?? null;
    let diff: number | null = null;
    let seDiff: number | null = null;
    let z: number | null = null;
    if (x && y && typeof x.value === 'number' && typeof y.value === 'number' && !x.summarised && !y.summarised) {
      diff = y.value - x.value;
      if (typeof x.se === 'number' && typeof y.se === 'number' && Number.isFinite(x.se) && Number.isFinite(y.se)) {
        seDiff = Math.hypot(x.se, y.se);
        z = seDiff > 0 ? diff / seDiff : null;
      }
    }
    return { path, a: x, b: y, diff, seDiff, z };
  });
  const notes: string[] = ['Descriptive comparison: Δ = B − A, se_Δ = √(se_A² + se_B²) for independent runs; not a hypothesis test.'];
  const sameType = a.experimentType === b.experimentType;
  const sameModel = a.modelVersion === b.modelVersion;
  if (!sameType) notes.push(`Different experiment types (${a.experimentType} vs ${b.experimentType}): only paths present in both are comparable.`);
  if (!sameModel) notes.push(`Different model versions (${a.modelVersion} vs ${b.modelVersion}): a difference may come from the model change.`);
  const shared = a.seeds.filter((s) => b.seeds.includes(s));
  if (shared.length) notes.push(`Shared seeds (${shared.join(', ')}): the runs are not independent, so se_Δ is not valid.`);
  return { sameType, sameModel, rows, notes };
}
