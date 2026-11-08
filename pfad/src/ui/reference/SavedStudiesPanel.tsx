import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { METRICS, compareCsv, compareTable, conditionsDiffer, highestPoint, metricOf, seriesOf, type Metric, type SavedStudy, type Series } from '../../reference/SavedStudies';
import type { StudyRow } from '../../reference/Study';
import { downloadText } from '../download';

/** The categorical colours of the chart, the dark-surface steps, in their fixed order (a ninth series is not drawn: the table has all of them). */
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const MARKS = ['circle', 'square', 'triangle', 'diamond'] as const;
const MAX_DRAWN = COLORS.length;

const digitsOf = (m: Metric) => METRICS.find((x) => x.id === m)!.digits;
const labelOf = (m: Metric) => METRICS.find((x) => x.id === m)!.label;

function Mark({ kind, x, y, color, r = 4.5 }: { kind: (typeof MARKS)[number]; x: number; y: number; color: string; r?: number }) {
  const common = { fill: color, stroke: '#0b0e12', strokeWidth: 1.5 };
  if (kind === 'square') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...common} />;
  if (kind === 'triangle') return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z`} {...common} />;
  if (kind === 'diamond') return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

function niceTicks(lo: number, hi: number, n = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** The chosen series over the angle: one line each, with one standard error as a bar at every point, a legend, a crosshair and a tooltip. */
function CompareChart({ series, colors, metric }: { series: Series[]; colors: Map<string, string>; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(Math.max(240, Math.min(1100, Math.round(el.getBoundingClientRect().width))));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // drawn at the size it is shown, so that its text stays readable in a narrow column; the labels at the line ends need room
  const W = width;
  const wide = W >= 520;
  const H = wide ? 340 : 250;
  const m = { l: 46, r: wide ? 130 : 12, t: 12, b: 38 };
  const pts = series.flatMap((s) => s.points.map((p) => ({ a: p.alphaDeg, v: metricOf(p, metric) })).filter((q) => q.v));
  if (!pts.length) return <div className="note">nothing to draw for {labelOf(metric)}</div>;
  const amin = Math.min(...pts.map((q) => q.a));
  const amax = Math.max(...pts.map((q) => q.a));
  let lo = Math.min(...pts.map((q) => q.v!.mean - (Number.isFinite(q.v!.se) ? q.v!.se : 0)));
  let hi = Math.max(...pts.map((q) => q.v!.mean + (Number.isFinite(q.v!.se) ? q.v!.se : 0)));
  if (metric !== 'ld') lo = Math.min(lo, 0);
  if (hi - lo < 1e-9) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;
  const X = (a: number) => m.l + (amax === amin ? (W - m.l - m.r) / 2 : ((a - amin) / (amax - amin)) * (W - m.l - m.r));
  const Y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const yt = niceTicks(lo, hi);
  const angles = [...new Set(pts.map((q) => q.a))].sort((a, b) => a - b);
  const xt = angles.length <= 9 ? angles : niceTicks(amin, amax, 8);
  const d = digitsOf(metric);
  // end labels for up to four series, pushed apart so that they do not overlap
  const ends = series
    .map((s) => {
      const last = [...s.points].reverse().find((p) => metricOf(p, metric));
      return last ? { s, y: Y(metricOf(last, metric)!.mean), x: X(last.alphaDeg) } : null;
    })
    .filter((e): e is { s: Series; y: number; x: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = angles[0];
    for (const a of angles) if (Math.abs(X(a) - px) < Math.abs(X(best) - px)) best = a;
    setHover(best);
  };
  const tip = hover === null ? null : series.map((s) => ({ s, p: s.points.find((p) => p.alphaDeg === hover) })).filter((t) => t.p && metricOf(t.p, metric));
  return (
    <div ref={box} style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${labelOf(metric)} against the angle of attack for the chosen series`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', background: '#0b0e12', borderRadius: 4 }} data-testid="compare-chart">
        {yt.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="#222b35" strokeWidth="1" />
            <text x={m.l - 6} y={Y(v) + 3.5} fill="#8b98a5" fontSize="10.5" textAnchor="end" fontFamily="ui-monospace, monospace">
              {Number(v.toFixed(d + 1))}
            </text>
          </g>
        ))}
        {xt.map((a) => (
          <text key={a} x={X(a)} y={H - m.b + 15} fill="#8b98a5" fontSize="10.5" textAnchor="middle" fontFamily="ui-monospace, monospace">
            {a}°
          </text>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 4} fill="#8b98a5" fontSize="11" textAnchor="middle">
          angle of attack
        </text>
        <text x={12} y={(m.t + H - m.b) / 2} fill="#8b98a5" fontSize="11" textAnchor="middle" transform={`rotate(-90 12 ${(m.t + H - m.b) / 2})`}>
          {labelOf(metric)}
        </text>
        {metric !== 'ld' && lo < 0 && <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} stroke="#44505c" strokeWidth="1" />}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={H - m.b} stroke="#6b7785" strokeWidth="1" strokeDasharray="3 3" />}
        {series.map((s, i) => {
          const c = colors.get(s.key) ?? '#999';
          const line = s.points.filter((p) => metricOf(p, metric));
          const path = line.map((p, k) => `${k ? 'L' : 'M'}${X(p.alphaDeg).toFixed(1)} ${Y(metricOf(p, metric)!.mean).toFixed(1)}`).join('');
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={c} strokeWidth="2" strokeDasharray={s.dimples ? '6 3' : undefined} strokeLinejoin="round" />
              {line.map((p) => {
                const v = metricOf(p, metric)!;
                const x = X(p.alphaDeg);
                return (
                  <g key={p.alphaDeg}>
                    {Number.isFinite(v.se) && v.se > 0 && <line x1={x} x2={x} y1={Y(v.mean - v.se)} y2={Y(v.mean + v.se)} stroke={c} strokeWidth="1.2" opacity="0.8" />}
                    <Mark kind={MARKS[i % MARKS.length]} x={x} y={Y(v.mean)} color={c} />
                  </g>
                );
              })}
            </g>
          );
        })}
        {series.length <= 4 && wide &&
          ends.map((e) => (
            <text key={e.s.key} x={e.x + 9} y={e.y + 3.5} fill="#c9d1d9" fontSize="10.5">
              {e.s.section.length > 20 ? `${e.s.section.slice(0, 19)}…` : e.s.section}
            </text>
          ))}
      </svg>
      {tip && tip.length > 0 && hover !== null && (
        <div className="chart-tip" role="status" style={{ position: 'absolute', top: 8, left: Math.min(Math.max(8, (X(hover) / W) * 100), 55) + '%', transform: 'translateX(8px)' }}>
          <b>{hover}°</b>
          {tip.map((t) => {
            const v = metricOf(t.p!, metric)!;
            return (
              <div key={t.s.key}>
                <span style={{ color: colors.get(t.s.key) }}>●</span> {t.s.section}: {v.mean.toFixed(d)}
                {Number.isFinite(v.se) ? ` ± ${v.se.toFixed(d)}` : ''}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Saving the airfoil study that is on the screen, and comparing saved studies: any sections of any saved studies, side by side, with the
 * differences from one of them and their uncertainty. The numbers are those the runs gave; nothing is recomputed or ranked.
 */
export function SavedStudiesPanel(p: {
  rows: StudyRow[];
  running: boolean;
  saved: SavedStudy[];
  /** returns a message (what was saved, or why not) */
  onSave: (name: string) => string;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onImport: (text: string) => string;
  storageMessage: string | null;
}) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [metric, setMetric] = useState<Metric>('ld');
  const [refKey, setRefKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  const wrap = (node: React.ReactNode) => (big ? createPortal(<div className="compare-overlay" role="dialog" aria-label="comparison of saved studies">{node}</div>, document.body) : node);
  const chosen = p.saved.filter((s) => sel.includes(s.id));
  const all = useMemo(() => seriesOf(chosen), [chosen.map((s) => s.id).join('|'), p.saved]);
  const shown = all.filter((s) => !hidden.includes(s.key));
  const drawn = shown.slice(0, MAX_DRAWN);
  const colors = new Map(drawn.map((s, i) => [s.key, COLORS[i]]));
  const table = useMemo(() => compareTable(shown, metric, refKey), [shown.map((s) => s.key).join('|'), metric, refKey, p.saved]);
  const differ = conditionsDiffer(chosen);
  const multi = chosen.length > 1;
  const d = digitsOf(metric);
  const nameOf = (s: Series) => (multi ? `${s.section} — ${s.studyName}` : s.section);
  const toggle = (id: string) => setSel((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <div className="saved-studies" data-testid="saved-studies">
      <h3 className="h3">Save this study · compare saved studies</h3>
      <div className="note">
        Press SAVE after a study to keep it (with its conditions) in this browser, then tick any saved studies below to compare their sections side by side: other sections, the same sections at another resolution or Reynolds number, plain and dimpled versions. The comparison shows the numbers the runs gave; it ranks nothing.
      </div>
      <div className="seg" style={{ margin: '4px 0', flexWrap: 'wrap' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="a name for this study (optional)" aria-label="name for the study to save" style={{ minWidth: 200 }} />
        <button
          className="ctl primary"
          disabled={!p.rows.length || p.running}
          aria-label="save this study"
          onClick={() => {
            setMsg(p.onSave(name));
            setName('');
          }}
          title={p.rows.length ? 'keep the table above, with its conditions, in this browser' : 'run a study first'}
        >
          SAVE THIS STUDY ({p.rows.length} {p.rows.length === 1 ? 'row' : 'rows'})
        </button>
      </div>
      {msg && <div className="note" data-testid="save-message">{msg}</div>}
      {p.storageMessage && <div className="warn">{p.storageMessage}</div>}
      {!p.saved.length && <div className="note">No saved studies yet.</div>}
      {p.saved.length > 0 && (
        <>
          <div className="saved-list" data-testid="saved-list">
            {p.saved.map((s) => (
              <div key={s.id} className="saved-item" data-saved={s.name}>
                <label className="field-inline" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`compare ${s.name}`} />
                  <span>
                    <b>{s.name}</b>
                    <div className="note">
                      {new Date(s.savedAt).toLocaleString()} · {[...new Set(s.rows.map((r) => r.name))].length} sections × {s.conditions.angles.length} angles ({s.rows.length} runs) · Re {Math.round(s.conditions.reynolds)} · {s.conditions.cells} cells · {s.conditions.engine}
                      {s.conditions.flow ? ` · ${s.conditions.flow}` : ''}
                    </div>
                  </span>
                </label>
                <span className="seg">
                  <button
                    className="ctl"
                    aria-label={`rename ${s.name}`}
                    onClick={() => {
                      const n = window.prompt('A new name for this saved study', s.name);
                      if (n && n.trim()) p.onRename(s.id, n.trim());
                    }}
                  >
                    RENAME
                  </button>
                  <button
                    className="ctl"
                    aria-label={`delete ${s.name}`}
                    onClick={() => {
                      if (window.confirm(`Delete the saved study “${s.name}”?`)) {
                        p.onDelete(s.id);
                        setSel((c) => c.filter((x) => x !== s.id));
                      }
                    }}
                  >
                    DELETE
                  </button>
                </span>
              </div>
            ))}
          </div>
          <div className="seg" style={{ margin: '4px 0', flexWrap: 'wrap' }}>
            <button className="ctl" onClick={() => setSel(p.saved.map((s) => s.id))} disabled={sel.length === p.saved.length} aria-label="tick all saved studies">
              TICK ALL
            </button>
            <button className="ctl" onClick={() => setSel([])} disabled={!sel.length} aria-label="untick all saved studies">
              UNTICK ALL
            </button>
            <button className="ctl" onClick={() => downloadText('saved-airfoil-studies.json', JSON.stringify({ format: 'pfad-saved-studies/1', studies: p.saved }, null, 1), 'application/json')} aria-label="export the saved studies to a file">
              EXPORT FILE
            </button>
            <label className="ctl" style={{ cursor: 'pointer' }}>
              IMPORT FILE
              <input
                type="file"
                accept=".json,application/json"
                aria-label="import saved studies from a file"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setMsg(p.onImport(await f.text()));
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </>
      )}
      {p.saved.length === 0 && (
        <label className="ctl" style={{ cursor: 'pointer', display: 'inline-block' }}>
          IMPORT FILE
          <input
            type="file"
            accept=".json,application/json"
            aria-label="import saved studies from a file"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setMsg(p.onImport(await f.text()));
              e.target.value = '';
            }}
          />
        </label>
      )}

      {chosen.length > 0 && wrap(
        <div className="compare-box" data-testid="compare-box">
          <div className="seg" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="h3" style={{ margin: 0 }}>Comparison of {chosen.length} saved {chosen.length === 1 ? 'study' : 'studies'}</h3>
            <button className="ctl" style={{ flex: '0 0 auto' }} onClick={() => setBig((b) => !b)} aria-label={big ? 'close the large comparison' : 'enlarge the comparison'} title={big ? 'back to the column (Esc)' : 'open the comparison over the whole window'}>
              {big ? 'CLOSE' : 'ENLARGE'}
            </button>
          </div>
          {differ.map((t, i) => (
            <div key={i} className="warn" data-testid="compare-differ">
              Not run under the same conditions: {t}.
            </div>
          ))}
          <div className="seg" style={{ margin: '4px 0', flexWrap: 'wrap' }}>
            <label className="field-inline">
              show{' '}
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="comparison quantity">
                {METRICS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-inline">
              differences from{' '}
              <select value={table.reference ?? ''} onChange={(e) => setRefKey(e.target.value)} aria-label="compare relative to">
                {shown.map((s) => (
                  <option key={s.key} value={s.key}>
                    {nameOf(s)}
                  </option>
                ))}
              </select>
            </label>
            <button className="ctl" style={{ flex: '0 0 auto' }} onClick={() => downloadText('airfoil-comparison.csv', compareCsv(shown, chosen), 'text/csv')} disabled={!shown.length} aria-label="download the comparison as CSV">
              CSV
            </button>
          </div>
          <div className="cmp-legend" data-testid="compare-legend">
            {all.map((s) => {
              const off = hidden.includes(s.key);
              const i = drawn.indexOf(s);
              return (
                <button key={s.key} className={`cmp-legend-item ${off ? 'off' : ''}`} onClick={() => setHidden((h) => (h.includes(s.key) ? h.filter((x) => x !== s.key) : [...h, s.key]))} aria-pressed={!off} aria-label={`${off ? 'show' : 'hide'} ${nameOf(s)}`} title={off ? 'show in the chart and the table' : 'hide from the chart and the table'}>
                  <svg width="26" height="12" aria-hidden="true">
                    <line x1="1" x2="25" y1="6" y2="6" stroke={i >= 0 ? COLORS[i] : '#555'} strokeWidth="2" strokeDasharray={s.dimples ? '6 3' : undefined} />
                    {i >= 0 && <Mark kind={MARKS[i % MARKS.length]} x={13} y={6} color={COLORS[i]} r={3.5} />}
                  </svg>{' '}
                  {nameOf(s)}
                </button>
              );
            })}
          </div>
          {shown.length > MAX_DRAWN && <div className="note">The chart draws the first {MAX_DRAWN} of the {shown.length} series; hide some in the legend to see the others in it. The table has all of them.</div>}
          {drawn.length > 0 && <CompareChart series={drawn} colors={colors} metric={metric} />}
          <div className="note">Dashed lines are dimpled versions. A bar is one standard error of a run’s time blocks. The curve between the points is a straight line, not a fit.</div>
          <div style={{ overflowX: 'auto' }}>
          <table className="results compare" data-testid="compare-table" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>α</th>
                {shown.map((s) => (
                  <th key={s.key} title={`${s.section} — ${s.studyName}`} style={{ borderBottom: `3px solid ${colors.get(s.key) ?? '#555'}` }}>
                    {s.section}
                    {multi && <div className="note">{s.studyName}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.alphaDeg} data-compare-row={r.alphaDeg}>
                  <td>{r.alphaDeg}°</td>
                  {r.cells.map((c, i) => (
                    <td key={shown[i].key}>
                      {c ? (
                        <>
                          <b>{c.value.mean.toFixed(d)}</b>
                          {Number.isFinite(c.value.se) ? <span className="note"> ±{c.value.se.toFixed(d)}</span> : null}
                          {c.integrity !== 'PASSED' && <span className="note" title="the integrity checks of this run did not all pass"> {c.integrity === 'WARNING' ? '!' : '✗'}</span>}
                          {c.delta && (
                            <div className={`note ${c.clear ? 'delta-clear' : 'delta-unclear'}`} title={c.clear === null ? 'the uncertainty of the difference is not known' : c.clear ? 'larger than twice its uncertainty' : 'within twice its uncertainty: not a clear difference'}>
                              Δ {c.delta.mean >= 0 ? '+' : ''}
                              {c.delta.mean.toFixed(d)}
                              {c.clear === false ? ' ≈' : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="note">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="note">
            Δ is the value minus that of {(() => {
              const r = shown.find((s) => s.key === table.reference);
              return r ? <b>{nameOf(r)}</b> : 'the first series';
            })()}{' '}
            at the same angle; “≈” marks a difference that is not larger than twice its uncertainty (the standard errors of the two added in quadrature), which these runs cannot tell from no difference. A “—” means that series has no run at that angle.
          </div>
          <div className="note">
            Highest {labelOf(metric)} among the angles run:{' '}
            {shown.map((s, i) => {
              const t = highestPoint(s, metric);
              return t ? (
                <span key={s.key}>
                  {i ? '; ' : ''}
                  <b>{nameOf(s)}</b> {metricOf(t, metric)!.mean.toFixed(d)} at {t.alphaDeg}°
                </span>
              ) : null;
            })}
            . A value at the edge of the angles run may not be the true maximum.
          </div>
        </div>
      )}
    </div>
  );
}
