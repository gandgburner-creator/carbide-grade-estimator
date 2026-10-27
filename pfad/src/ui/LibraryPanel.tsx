import { useMemo, useState } from 'react';
import { recordCSV, recordJSON, safeName } from '../app/exporters';
import { bundle, searchLibrary, type LibraryEntry, type LibraryQuery, type LibraryStore } from '../app/library';
import { downloadText } from './download';
import { Badge, fmt } from './Panels';

/** Searchable list of runs and imported records, with open, resume, export and delete. */
export function LibraryPanel({
  store,
  entries,
  persistent,
  activeId,
  onOpen,
  onImport,
  onChanged,
}: {
  store: LibraryStore;
  entries: LibraryEntry[];
  persistent: boolean;
  activeId: string | null;
  onOpen: (e: LibraryEntry) => void;
  onImport: (files: FileList) => void;
  onChanged: () => void;
}) {
  const [q, setQ] = useState<LibraryQuery>({ text: '', outcome: 'all', universe: 'all', status: 'all' });
  const shown = useMemo(() => searchLibrary(entries, q), [entries, q]);
  const exportEntry = async (e: LibraryEntry, kind: 'json' | 'csv') => {
    const p = await store.payload(e.id);
    if (!p?.record) return;
    if (kind === 'json') downloadText(`${safeName(p.record.experimentId)}.json`, recordJSON(p.record, e.provenance), 'application/json');
    else downloadText(`${safeName(p.record.experimentId)}_measured.csv`, recordCSV(p.record, e.provenance), 'text/csv');
  };
  const exportAll = async () => {
    const items = await Promise.all(shown.map(async (entry) => ({ entry, payload: await store.payload(entry.id) })));
    downloadText(`pfad-library-${new Date().toISOString().slice(0, 10)}.json`, bundle(items), 'application/json');
  };
  return (
    <div>
      <div className="note" style={{ marginBottom: 6 }}>
        {persistent ? 'Stored in this browser (IndexedDB).' : 'Storage unavailable: the library lasts for this session only.'} Every run started here is recorded — completed, stopped,
        failed or checkpointed. Import record files from <code>pfad/results/*.json</code> or a library bundle.
      </div>
      <div className="lib-filters">
        <input className="search" placeholder="search id, title, type, seed, status…" value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} />
        <select value={q.outcome} onChange={(e) => setQ({ ...q, outcome: e.target.value as LibraryQuery['outcome'] })}>
          {['all', 'running', 'completed', 'stopped', 'failed', 'interrupted', 'checkpoint', 'imported'].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <select value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value as LibraryQuery['status'] })}>
          {['all', 'PASSED', 'FAILED', 'INCONCLUSIVE', 'NOT CONVERGED', 'UNTESTED'].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <div className="seg" style={{ margin: '6px 0' }}>
        <label className="ctl" style={{ cursor: 'pointer' }}>
          IMPORT…
          <input
            type="file"
            multiple
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(ev) => {
              if (ev.target.files?.length) onImport(ev.target.files);
              ev.target.value = '';
            }}
          />
        </label>
        <button className="ctl" disabled={!shown.length} onClick={exportAll}>
          EXPORT {shown.length} AS BUNDLE
        </button>
      </div>
      <div className="lib-list">
        {shown.map((e) => (
          <div key={e.id} className={`lib-item ${activeId === e.id ? 'active' : ''}`}>
            <div className="row-between">
              <button className="linklike" onClick={() => onOpen(e)} title="open">
                {e.title}
              </button>
              <Badge status={e.status} />
            </div>
            <div className="note">
              <span className={`tag ${e.outcome}`}>{e.outcome.toUpperCase()}</span> {e.experimentType} · universe {e.universe} · seeds {e.seeds.join(',')} ·{' '}
              {new Date(e.createdAt).toLocaleString()}
              {e.runtimeMs !== null && <> · {fmt(e.runtimeMs / 1000, 3)} s compute</>}
              {e.summary?.progress !== undefined && e.outcome !== 'completed' && <> · {(100 * e.summary.progress).toFixed(0)} % done</>}
              <br />
              code {e.provenance.codeVersion.slice(0, 12)} · model {e.provenance.modelVersion} · preset {e.provenance.preset}
              {e.message && (
                <>
                  <br />
                  {e.message}
                </>
              )}
            </div>
            <div className="seg">
              <button className="ctl" onClick={() => onOpen(e)}>
                {e.outcome === 'checkpoint' ? 'RESUME' : e.hasRecord ? 'OPEN' : 'LOAD CONFIG'}
              </button>
              <button className="ctl" disabled={!e.hasRecord} onClick={() => exportEntry(e, 'json')}>
                JSON
              </button>
              <button className="ctl" disabled={!e.hasRecord} onClick={() => exportEntry(e, 'csv')}>
                CSV
              </button>
              <button
                className="ctl"
                onClick={async () => {
                  if (window.confirm(`Delete "${e.title}" (${e.id}) from this browser's library? Exported files are not affected.`)) {
                    await store.remove(e.id);
                    onChanged();
                  }
                }}
              >
                DELETE
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="note">No entries{entries.length ? ' match' : ' yet'}.</div>}
      </div>
    </div>
  );
}
