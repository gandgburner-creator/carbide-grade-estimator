import { useMemo, useState } from 'react';
import { filterRows, flatten, type Row } from '../app/flatten';
import type { LibraryEntry } from '../app/library';
import { makeProvenance } from '../app/provenance';
import { recordCSV, recordJSON, safeName } from '../app/exporters';
import type { ExperimentRecord } from '../experiments/Experiment';
import { downloadText } from './download';
import { Badge, fmt, RecordView } from './Panels';

/**
 * A record, separated into what was measured, what is reference (benchmarks),
 * what was imposed (configuration), what was assumed, and its validation state.
 */
export function ResultsPanel({ record, entry }: { record: ExperimentRecord | null; entry: LibraryEntry | null }) {
  const [tab, setTab] = useState<'measured' | 'reference' | 'imposed' | 'assumptions' | 'validation'>('measured');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => (record ? flatten(record.results) : []), [record]);
  const bench = useMemo(() => (record ? flatten(record.benchmarks) : []), [record]);
  const imposed = useMemo(() => (record ? flatten(record.config, { maxArray: 64 }) : []), [record]);
  if (!record) return <div className="note">No record yet: it appears when every run of an experiment has finished, or when you open one from the library.</div>;
  const prov = entry?.provenance ?? makeProvenance({ experimentType: record.experimentType, universe: 'A', preset: 'unknown', seeds: record.seeds, createdAt: record.timestamp, modelVersion: record.modelVersion, codeVersion: 'not recorded' });
  return (
    <div>
      <div className="row-between">
        <b>{record.title}</b>
        <Badge status={record.status} />
      </div>
      <div className="note">
        {record.experimentId} · model {record.modelVersion} · code {prov.codeVersion.slice(0, 12)} · seeds {record.seeds.join(', ')} · N = {record.particleCount}
        {entry?.outcome === 'imported' && <> · imported from {entry.source}</>}
      </div>
      <div className="seg" style={{ margin: '6px 0' }}>
        <button className="ctl" onClick={() => downloadText(`${safeName(record.experimentId)}.json`, recordJSON(record, prov), 'application/json')}>
          RECORD JSON
        </button>
        <button className="ctl" onClick={() => downloadText(`${safeName(record.experimentId)}_measured.csv`, recordCSV(record, prov), 'text/csv')}>
          MEASURED CSV
        </button>
      </div>
      <div className="tabs small">
        {(
          [
            ['measured', `Measured (${rows.length})`],
            ['reference', `Reference (${bench.length})`],
            ['imposed', 'Imposed'],
            ['assumptions', `Assumptions (${record.assumptions.length})`],
            ['validation', 'Validation'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'measured' && (
        <>
          <div className="note">
            <span className="tag measured">MEASURED</span> record.results: quantities measured from particle data and quantities derived from them by the experiment&apos;s analysis. Uncertainties as the
            record states them (± SE, 95 % CI).
          </div>
          <RecordView record={record} compact />
          <RowTable rows={filterRows(rows, query)} query={query} onQuery={setQuery} />
        </>
      )}
      {tab === 'reference' && (
        <>
          <div className="note">
            <span className="tag reference">REFERENCE — NOT MEASURED</span> Classical benchmark values kept separate from the measurements. They never feed back into a run and are not validation of
            PFAD by themselves.
          </div>
          <RowTable rows={bench} />
        </>
      )}
      {tab === 'imposed' && (
        <>
          <div className="note">
            <span className="tag imposed">IMPOSED</span> The configuration the run was given (parameters, not results). Re-run it with <code>npm run exp -- replay &lt;record.json&gt;</code>.
          </div>
          <div className="kv">
            {[
              ['geometry', record.geometry],
              ['wall model', record.wallModel],
              ['accommodation', JSON.stringify(record.accommodation)],
              ['restitution', JSON.stringify(record.restitution)],
              ['occupancy model', record.occupancyModel],
              ['timestep', JSON.stringify(record.timestep)],
              ['temperature', `${record.temperature.kT} (${record.temperature.definition})`],
            ].map(([k, v]) => (
              <div className="row" key={k}>
                <span className="k">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <RowTable rows={imposed} />
        </>
      )}
      {tab === 'assumptions' && (
        <ul className="plain">
          {record.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
          {record.assumptions.length === 0 && <li className="note">The record lists no assumptions.</li>}
          <li className="note">Model-wide assumptions: docs/MODEL_ASSUMPTIONS.md.</li>
        </ul>
      )}
      {tab === 'validation' && (
        <>
          <div className="note">
            Status <Badge status={record.status} /> combines the acceptance checks (worst wins). PASSED means the stated criterion was met in these runs, nothing more; no result here is externally validated.
          </div>
          <div className="checks">
            {record.acceptance.map((c) => (
              <div className="check" key={c.id}>
                <div className="id">
                  <Badge status={c.status} /> {c.id}
                </div>
                <div className="detail">
                  {c.description}
                  <br />
                  measured: {c.measured}
                  <br />
                  criterion: {c.criterion}
                </div>
              </div>
            ))}
            {record.acceptance.length === 0 && <div className="note">No acceptance criteria: nothing was tested (status UNTESTED).</div>}
          </div>
          <div className="kv" style={{ marginTop: 6 }}>
            <div className="row">
              <span className="k">convergence</span>
              <span>
                {record.convergence.status}: {record.convergence.note}
              </span>
            </div>
            <div className="row">
              <span className="k">Re</span>
              <span>{record.reynolds.note}</span>
            </div>
            <div className="row">
              <span className="k">Mach</span>
              <span>{record.mach.note}</span>
            </div>
          </div>
          {record.warnings.map((w, i) => (
            <div className="warn" key={i}>
              {w}
            </div>
          ))}
          {record.safetyFlags.map((f, i) => (
            <div className={f.severity === 'failure' ? 'error' : 'warn'} key={`f${i}`}>
              {f.code}: {f.message}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function RowTable({ rows, query, onQuery, limit = 400 }: { rows: Row[]; query?: string; onQuery?: (q: string) => void; limit?: number }) {
  return (
    <div>
      {onQuery && <input className="search" placeholder="filter by name…" value={query} onChange={(e) => onQuery(e.target.value)} />}
      <div className="table-scroll">
        <table className="results">
          <thead>
            <tr>
              <th>quantity</th>
              <th>value</th>
              <th>± SE</th>
              <th>95 % CI</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.path}>
                <td className="path">{(r.path || '(value)').replace(/([.[])/g, '\u200b$1')}</td>
                <td>{r.summarised ? `${r.value} values (JSON)` : fmt(r.value)}</td>
                <td>{r.se !== undefined ? fmt(r.se, 2) : ''}</td>
                <td>{r.ci95 ? `[${fmt(r.ci95[0], 3)}, ${fmt(r.ci95[1], 3)}]` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <div className="note">{rows.length - limit} more rows: use the filter or the CSV export.</div>}
    </div>
  );
}
