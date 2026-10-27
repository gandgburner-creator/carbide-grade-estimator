import { useEffect, useMemo, useState } from 'react';
import { compareRecords, type Comparison } from '../app/compare';
import { csvCell } from '../app/exporters';
import type { LibraryEntry, LibraryStore } from '../app/library';
import { downloadText } from './download';
import { fmt } from './Panels';

/** Two library records side by side (descriptive; formal comparisons use the A/B experiment). */
export function ComparePanel({ store, entries }: { store: LibraryStore; entries: LibraryEntry[] }) {
  const withRecords = entries.filter((e) => e.hasRecord);
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [query, setQuery] = useState('');
  const [onlyBoth, setOnlyBoth] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!a || !b) return setCmp(null);
      const [pa, pb] = await Promise.all([store.payload(a), store.payload(b)]);
      if (live && pa?.record && pb?.record) setCmp(compareRecords(pa.record, pb.record));
    })();
    return () => {
      live = false;
    };
  }, [a, b, store]);

  const rows = useMemo(() => {
    if (!cmp) return [];
    const q = query.trim().toLowerCase();
    return cmp.rows.filter((r) => (!onlyBoth || (r.a && r.b)) && (!q || r.path.toLowerCase().includes(q)) && !(r.a?.summarised || r.b?.summarised));
  }, [cmp, query, onlyBoth]);

  const label = (e: LibraryEntry) => `${e.title} · seeds ${e.seeds.join(',')} · ${e.outcome} · ${e.createdAt.slice(0, 16)}`;
  const csv = () => {
    const head = ['path', 'A', 'A se', 'B', 'B se', 'B - A', 'se diff', 'z'];
    const lines = rows.map((r) => [r.path, r.a?.value, r.a?.se, r.b?.value, r.b?.se, r.diff, r.seDiff, r.z].map(csvCell).join(','));
    const ea = entries.find((e) => e.id === a)!;
    const eb = entries.find((e) => e.id === b)!;
    const meta = [`# A: ${ea.id} (code ${ea.provenance.codeVersion}, model ${ea.provenance.modelVersion})`, `# B: ${eb.id} (code ${eb.provenance.codeVersion}, model ${eb.provenance.modelVersion})`, ...(cmp?.notes ?? []).map((n) => `# ${n}`)];
    downloadText('pfad-comparison.csv', `${meta.join('\n')}\n${head.join(',')}\n${lines.join('\n')}\n`, 'text/csv');
  };

  if (withRecords.length < 2) return <div className="note">Comparison needs two library entries with records (finished runs or imported records).</div>;
  return (
    <div>
      <label className="field">
        A
        <select value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">— choose —</option>
          {withRecords.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        B
        <select value={b} onChange={(e) => setB(e.target.value)}>
          <option value="">— choose —</option>
          {withRecords.map((e) => (
            <option key={e.id} value={e.id}>
              {label(e)}
            </option>
          ))}
        </select>
      </label>
      {cmp && (
        <>
          {cmp.notes.map((n, i) => (
            <div key={i} className={i === 0 ? 'note' : 'warn'}>
              {n}
            </div>
          ))}
          <div className="lib-filters">
            <input className="search" placeholder="filter by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="field-inline">
              <input type="checkbox" checked={onlyBoth} onChange={(e) => setOnlyBoth(e.target.checked)} /> in both
            </label>
            <button className="ctl" onClick={csv}>
              CSV
            </button>
          </div>
          <div className="table-scroll">
            <table className="results">
              <thead>
                <tr>
                  <th>quantity</th>
                  <th>A</th>
                  <th>B</th>
                  <th>B − A ± se</th>
                  <th>z</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((r) => (
                  <tr key={r.path}>
                    <td className="path">{r.path}</td>
                    <td>
                      {fmt(r.a?.value)}
                      {r.a?.se !== undefined ? ` ± ${fmt(r.a.se, 2)}` : ''}
                    </td>
                    <td>
                      {fmt(r.b?.value)}
                      {r.b?.se !== undefined ? ` ± ${fmt(r.b.se, 2)}` : ''}
                    </td>
                    <td>{r.diff === null ? '' : `${fmt(r.diff, 3)}${r.seDiff !== null ? ` ± ${fmt(r.seDiff, 2)}` : ''}`}</td>
                    <td>{r.z === null ? '' : fmt(r.z, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
