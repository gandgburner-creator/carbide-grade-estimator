import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import type { ValidationStatus } from '../validation/Status';
import { makeProvenance, type Provenance } from './provenance';

/**
 * The experiment library: every run started in the app (completed, stopped,
 * failed or checkpointed) and every imported record. Entries hold metadata;
 * the record and any checkpoint are stored separately (`LibraryPayload`) so
 * listing stays fast with large records.
 */
export type Outcome = 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted' | 'checkpoint' | 'imported';

/** Entries left 'running' by a closed or reloaded page become 'interrupted' (no record was produced). */
export function markInterrupted(e: LibraryEntry): LibraryEntry | null {
  if (e.outcome !== 'running') return null;
  return { ...e, outcome: 'interrupted', message: 'The page was closed or reloaded while this run was in progress; it produced no record.' };
}

export interface LibraryEntry {
  id: string;
  title: string;
  experimentType: ExperimentType | string;
  catalogKey: string | null;
  universe: 'A' | 'B';
  seeds: number[];
  createdAt: string;
  outcome: Outcome;
  /** active compute time in the app, ms (null for imports) */
  runtimeMs: number | null;
  /** record validation status; UNTESTED when there is no record */
  status: ValidationStatus;
  hasRecord: boolean;
  /** the configuration the run used (or the record's config) */
  config: unknown;
  provenance: Provenance;
  message?: string;
  /** imported file name */
  source?: string;
  /** simulation time and particle count at the end (or at the checkpoint) */
  summary?: { simTime?: number; particles?: number; progress?: number };
}

export interface LibraryPayload {
  record?: ExperimentRecord;
  checkpoint?: unknown;
}

export interface LibraryStore {
  list(): Promise<LibraryEntry[]>;
  payload(id: string): Promise<LibraryPayload | null>;
  put(entry: LibraryEntry, payload?: LibraryPayload): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryLibrary implements LibraryStore {
  private entries = new Map<string, LibraryEntry>();
  private payloads = new Map<string, LibraryPayload>();
  async list() {
    return [...this.entries.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async payload(id: string) {
    return this.payloads.get(id) ?? null;
  }
  async put(entry: LibraryEntry, payload?: LibraryPayload) {
    this.entries.set(entry.id, entry);
    if (payload) this.payloads.set(entry.id, payload);
  }
  async remove(id: string) {
    this.entries.delete(id);
    this.payloads.delete(id);
  }
}

export interface LibraryQuery {
  text?: string;
  outcome?: Outcome | 'all';
  universe?: 'A' | 'B' | 'all';
  status?: ValidationStatus | 'all';
}

/** Case-insensitive match on id, title, type, seeds, status and source; then the filters. */
export function searchLibrary(entries: LibraryEntry[], q: LibraryQuery): LibraryEntry[] {
  const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (q.outcome && q.outcome !== 'all' && e.outcome !== q.outcome) return false;
    if (q.universe && q.universe !== 'all' && e.universe !== q.universe) return false;
    if (q.status && q.status !== 'all' && e.status !== q.status) return false;
    if (!words.length) return true;
    const hay = [e.id, e.title, e.experimentType, e.catalogKey ?? '', e.outcome, e.status, e.source ?? '', e.seeds.join(' '), e.provenance.codeVersion, e.message ?? '']
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function isRecord(x: unknown): x is ExperimentRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.experimentId === 'string' && typeof r.experimentType === 'string' && typeof r.status === 'string' && Array.isArray(r.acceptance) && Array.isArray(r.seeds);
}

/** Library entry for an imported record file (the record keeps its own provenance). */
export function entryFromRecord(record: ExperimentRecord & { labProvenance?: Provenance }, source: string, universe: 'A' | 'B' = 'A'): LibraryEntry {
  const prov =
    record.labProvenance ??
    makeProvenance({
      experimentType: record.experimentType,
      universe,
      preset: 'imported',
      seeds: record.seeds,
      createdAt: record.timestamp,
      modelVersion: record.modelVersion,
      codeVersion: 'not recorded (record made outside the app)',
    });
  return {
    id: `import:${record.experimentId}`,
    title: record.title,
    experimentType: record.experimentType,
    catalogKey: null,
    universe,
    seeds: record.seeds,
    createdAt: record.timestamp,
    outcome: 'imported',
    runtimeMs: null,
    status: record.status,
    hasRecord: true,
    config: record.config,
    provenance: prov,
    source,
    summary: { simTime: record.duration?.time, particles: record.particleCount },
  };
}

/** Parse an imported file: one record, or a library bundle exported by the app. */
export function parseImport(text: string, name: string): { entry: LibraryEntry; payload: LibraryPayload }[] {
  const data = JSON.parse(text) as unknown;
  if (isRecord(data)) return [{ entry: entryFromRecord(data, name), payload: { record: data } }];
  const b = data as { format?: string; items?: { entry: LibraryEntry; payload: LibraryPayload }[] };
  if (b && b.format === LIBRARY_BUNDLE && Array.isArray(b.items)) return b.items.map((it) => ({ entry: { ...it.entry, source: name }, payload: it.payload }));
  throw new Error('not a PFAD experiment record or library bundle');
}

export const LIBRARY_BUNDLE = 'pfad-lab-library/1';

export function bundle(items: { entry: LibraryEntry; payload: LibraryPayload | null }[]): string {
  return JSON.stringify({ format: LIBRARY_BUNDLE, exportedAt: new Date().toISOString(), items: items.map((i) => ({ entry: i.entry, payload: i.payload ?? {} })) }, null, 1);
}
