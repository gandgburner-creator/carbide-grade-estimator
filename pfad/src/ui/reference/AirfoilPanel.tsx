import { useMemo, useState } from 'react';
import { AIRFOIL_PRESETS, airfoilBody, describeMetrics, parseAirfoilDat, sectionFromCode, type AirfoilAim, type AirfoilBody, type AirfoilProfile } from '../../reference/Airfoils';
import { DIMPLES_2D_NOTE, DIMPLE_LIMITS, DIMPLE_PRESETS, dimpleAdvice, dimpleCentres, dimpleShort, dimpleTextsOf, dimpledBody, parseDimples, type DimpleRecord, type DimpleSpec, type DimpleTexts } from '../../reference/Dimples';
import { highestLd, resolutionAdvice, studyCsv, type StudyRow } from '../../reference/Study';
import { DimplePreview } from './DimplePreview';

const AIMS: { id: AirfoilAim | 'all'; label: string }[] = [
  { id: 'all', label: 'all sections' },
  { id: 'high-lift', label: 'high lift' },
  { id: 'efficiency', label: 'efficiency (lift-to-drag)' },
  { id: 'symmetric', label: 'symmetric references' },
  { id: 'designed', label: 'Claude’s designs (18°, 350 km/h)' },
];

/** a small picture of the outline */
function Outline({ contour }: { contour: number[] }) {
  const d = useMemo(() => {
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i < contour.length; i += 2) {
      xmin = Math.min(xmin, contour[i]);
      xmax = Math.max(xmax, contour[i]);
      ymin = Math.min(ymin, contour[i + 1]);
      ymax = Math.max(ymax, contour[i + 1]);
    }
    const w = 96;
    const s = (w - 4) / (xmax - xmin || 1);
    const cy = (ymin + ymax) / 2;
    return contour.reduce((acc, v, i) => (i % 2 ? acc : `${acc}${i ? 'L' : 'M'}${(2 + (v - xmin) * s).toFixed(1)} ${(14 - (contour[i + 1] - cy) * s).toFixed(1)}`), '') + 'Z';
  }, [contour]);
  return (
    <svg viewBox="0 0 96 28" width="96" height="28" aria-hidden="true" style={{ flex: '0 0 96px' }}>
      <path d={d} fill="rgba(150,190,230,0.25)" stroke="#9cc3ea" strokeWidth="1" />
    </svg>
  );
}

/** A dimple setting: a box to type in and a slider for the same value. */
function DimpleField(p: { label: string; aria: string; value: string; onChange: (v: string) => void; min: number; max: number; step: number }) {
  const v = Number(p.value.replace(',', '.'));
  return (
    <label>
      {p.label}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input inputMode="decimal" value={p.value} onChange={(e) => p.onChange(e.target.value)} aria-label={p.aria} style={{ width: 64 }} />
        <input type="range" min={p.min} max={p.max} step={p.step} value={Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.min} onChange={(e) => p.onChange(e.target.value)} aria-label={`${p.aria}, slider`} style={{ flex: 1, minWidth: 0 }} />
      </span>
    </label>
  );
}

/** The id of a section's dimpled version in the study list. */
export const DIMPLED_SUFFIX = '+dimples';

/** A section's dimpled version as a profile: the same coordinates, a name and a source that say what was pressed into it. */
export function dimpledProfile(a: AirfoilProfile, r: DimpleRecord): AirfoilProfile {
  return {
    ...a,
    id: `${a.id}${DIMPLED_SUFFIX}`,
    name: `${a.name} + dimples (${dimpleShort(r.spec)})`,
    family: `${a.family}, dimpled`,
    known: `${a.known}. Dimpled version: ${r.count} dimples ${r.spec.surface === 'both' ? 'on each surface' : `on the ${r.spec.surface} surface`}, ${r.label}, ${(100 * r.surfaceGain).toFixed(1)} % more surface length on the dimpled surface${r.spec.surface === 'both' ? 's' : ''}; the numbers of the card are those of the section before its dimples. Nothing shows that these dimples help this section`,
    source: { ...a.source, text: `${a.source.text}; then ${r.count} dimples pressed into it (${r.label})` },
  };
}

/**
 * The reference airfoils: sections whose shape comes from a published formula, any other four- or five-digit code, and any section from
 * a coordinate file. Choosing one starts a project with it as a FIXED body (the solver does not know where a body came from); ticking
 * several puts them in the airfoil study below, which computes their lift and drag at several angles.
 */
export function AirfoilPanel(p: {
  /** lattice cells along the chord at the chosen resolution (for the resolution advice) */
  cells: number;
  disabled: boolean;
  onLoad: (profile: AirfoilProfile, body: AirfoilBody, dimples?: DimpleRecord) => void;
  /** the dimple settings (text boxes) and their change */
  dimples: DimpleTexts;
  onDimples: (t: DimpleTexts) => void;
  extra: AirfoilProfile[];
  onExtra: (list: AirfoilProfile[]) => void;
  picked: string[];
  onPicked: (ids: string[]) => void;
  openName: string | null;
}) {
  const [aim, setAim] = useState<AirfoilAim | 'all'>('all');
  const [code, setCode] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState('4-4412');
  const all = [...AIRFOIL_PRESETS, ...p.extra];
  const dimpleCheck = useMemo(() => parseDimples(p.dimples), [p.dimples]);
  const spec: DimpleSpec | null = dimpleCheck.ok ? dimpleCheck.spec : null;
  const previewAirfoil = all.find((a) => a.id === previewId) ?? all[0];
  const centres = spec ? dimpleCentres(spec) : [];
  const advice = spec ? dimpleAdvice(spec, p.cells) : [];
  const useDimpled = (a: AirfoilProfile) => {
    if (!spec) return;
    try {
      const d = dimpledBody(a.contour, spec);
      p.onLoad(dimpledProfile(a, d.record), d.body, d.record);
      setError(null);
    } catch (e) {
      setInfo(null);
      setError(`${a.name}: ${(e as Error).message}`);
    }
  };
  const setField = (k: keyof DimpleTexts, v: string) => p.onDimples({ ...p.dimples, [k]: v });
  const presetValue = DIMPLE_PRESETS.find((d) => JSON.stringify(dimpleTextsOf(d.spec)) === JSON.stringify(p.dimples))?.id ?? 'custom';
  const shown = all.filter((a) => aim === 'all' || a.source.kind === 'imported' || a.aims.includes(aim));
  const bodies = useMemo(() => {
    const m = new Map<string, AirfoilBody | string>();
    for (const a of all) {
      try {
        m.set(a.id, airfoilBody(a.contour));
      } catch (e) {
        m.set(a.id, (e as Error).message);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.extra]);
  const add = (a: AirfoilProfile) => {
    if (AIRFOIL_PRESETS.some((x) => x.id === a.id)) {
      setError(null);
      setInfo(`${a.name} is already in the list.`);
      return;
    }
    try {
      airfoilBody(a.contour);
    } catch (e) {
      setError(`${a.name}: ${(e as Error).message}`);
      return;
    }
    p.onExtra([...p.extra.filter((x) => x.id !== a.id), a]);
    setError(null);
    setInfo(`${a.name} was added to the list below.`);
  };
  const addCode = () => {
    try {
      add(sectionFromCode(code));
      setCode('');
    } catch (e) {
      setInfo(null);
      setError((e as Error).message);
    }
  };
  const addText = (txt: string, fileName?: string) => {
    try {
      const d = parseAirfoilDat(txt);
      const id = `file-${d.name.replace(/\W+/g, '-').toLowerCase()}-${p.extra.length + 1}`;
      add({ id, name: d.name, family: `${d.format} file`, known: `the section in ${fileName ?? 'the pasted file'}, used exactly as its coordinates give it${d.notes.length ? ` (${d.notes.join('; ')})` : ''}`, aims: ['reference'], source: { kind: 'imported', text: `a file${fileName ? ` (${fileName})` : ''} in ${d.format} format, as given` }, contour: d.contour });
      setText('');
    } catch (e) {
      setInfo(null);
      setError((e as Error).message);
    }
  };
  const toggle = (id: string) => p.onPicked(p.picked.includes(id) ? p.picked.filter((x) => x !== id) : [...p.picked, id]);
  return (
    <div className="airfoil-panel" data-testid="airfoil-panel">
      <div className="note">
        Start from a well-known section instead of the rounded plate. The shapes of the numbered sections are computed from their published formulas (four- and five-digit families, trailing edge closed to a point); other sections (Eppler, Selig, Wortmann, Clark Y …) exist only as coordinate tables, which this program does not carry: bring the section’s own <code>.dat</code> file (for example from the UIUC airfoil database or airfoiltools.com) below. A section is a <b>fixed body</b>: the pointer builds on the rounded plate and does not apply to it. What the flow does around it is computed, not looked up, and no section is called best here: the descriptions are the sections’ reputations.
      </div>
      <details className="dimple-box" open data-testid="dimple-box">
        <summary>
          <b>Dimples</b> · a dimpled version of any section below
        </summary>
        <div className="note">
          Like a golf ball: shallow round dents pressed into the surface of a section. Choose how <b>big</b> the dimples are (diameter along the chord and depth), how <b>dense</b> (the share of the stretch they cover: the closer, the more of them) and where, then press <b>USE WITH DIMPLES</b> on a section, or tick “dimpled version too” to put its dimpled twin in the study.
        </div>
        <details>
          <summary className="note">what a dimple is in this computation</summary>
          <div className="note">{DIMPLES_2D_NOTE}</div>
        </details>
        <label className="field-inline">
          settings{' '}
          <select
            value={presetValue}
            onChange={(e) => {
              const d = DIMPLE_PRESETS.find((x) => x.id === e.target.value);
              if (d) p.onDimples(dimpleTextsOf(d.spec));
            }}
            aria-label="dimple settings preset"
          >
            <option value="custom">your own values</option>
            {DIMPLE_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="dimple-fields">
          <label>
            dimples on
            <select value={p.dimples.surface} onChange={(e) => setField('surface', e.target.value)} aria-label="dimples on surface">
              <option value="upper">the upper surface</option>
              <option value="lower">the lower surface</option>
              <option value="both">both surfaces</option>
            </select>
          </label>
          <DimpleField label="size: diameter [% of chord]" aria="dimple diameter in % of the chord" value={p.dimples.diameterPct} onChange={(v) => setField('diameterPct', v)} min={100 * DIMPLE_LIMITS.diameter[0]} max={100 * DIMPLE_LIMITS.diameter[1]} step={0.5} />
          <DimpleField label="size: depth [% of the diameter]" aria="dimple depth in % of the diameter" value={p.dimples.depthPct} onChange={(v) => setField('depthPct', v)} min={100 * DIMPLE_LIMITS.depthRatio[0]} max={100 * DIMPLE_LIMITS.depthRatio[1]} step={1} />
          <DimpleField label="density: share of the stretch covered [%]" aria="dimple density in % covered" value={p.dimples.coveragePct} onChange={(v) => setField('coveragePct', v)} min={100 * DIMPLE_LIMITS.coverage[0]} max={100 * DIMPLE_LIMITS.coverage[1]} step={1} />
          <DimpleField label="stretch starts at [% of chord]" aria="dimples start in % of the chord" value={p.dimples.fromPct} onChange={(v) => setField('fromPct', v)} min={100 * DIMPLE_LIMITS.from} max={98} step={1} />
          <DimpleField label="stretch ends at [% of chord]" aria="dimples end in % of the chord" value={p.dimples.toPct} onChange={(v) => setField('toPct', v)} min={2} max={100 * DIMPLE_LIMITS.to} step={1} />
        </div>
        {!dimpleCheck.ok && (
          <div className="error" data-testid="dimple-errors">
            {dimpleCheck.errors.join('; ')}
          </div>
        )}
        {spec && (
          <div className="note" data-testid="dimple-readout">
            {centres.length} dimples on {spec.surface === 'both' ? 'each surface' : `the ${spec.surface} surface`}, {(100 * (spec.diameter / spec.coverage)).toFixed(2)} % of the chord from centre to centre ({(100 * (spec.diameter / spec.coverage - spec.diameter)).toFixed(2)} % between neighbours). At {p.cells} cells along the chord a dimple is {(spec.diameter * p.cells).toFixed(1)} cells wide and {(spec.diameter * spec.depthRatio * p.cells).toFixed(2)} cells deep.
          </div>
        )}
        {advice.map((t, i) => (
          <div key={i} className="note" style={{ color: 'var(--warn, #d29922)' }}>
            {t}.
          </div>
        ))}
        {spec && previewAirfoil && (
          <>
            <label className="field-inline">
              preview on{' '}
              <select value={previewAirfoil.id} onChange={(e) => setPreviewId(e.target.value)} aria-label="dimple preview section">
                {all.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <DimplePreview contour={previewAirfoil.contour} spec={spec} />
          </>
        )}
      </details>
      <label className="field-inline">
        show{' '}
        <select value={aim} onChange={(e) => setAim(e.target.value as AirfoilAim | 'all')} aria-label="airfoil list filter">
          {AIMS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="airfoil-list">
        {shown.map((a) => {
          const b = bodies.get(a.id);
          const ok = typeof b !== 'string' && b !== undefined;
          const advice = ok ? resolutionAdvice(b.metrics.thickness, b.metrics.noseRadius, p.cells) : [];
          return (
            <div key={a.id} className={`airfoil-card ${p.openName === a.name ? 'open' : ''}`} data-airfoil={a.name}>
              <div className="airfoil-head">
                <Outline contour={a.contour} />
                <div>
                  <b>{a.name}</b> <span className="muted">{a.family}</span>
                  <div className="note">{ok ? describeMetrics(b.metrics) : b}</div>
                </div>
              </div>
              {a.designedFor && (
                <div className="note" style={{ color: 'var(--warn, #d29922)' }} data-testid="designed-note">
                  Drawn for {a.designedFor.text}. A hypothesis chosen by reasoning, not an optimised or validated section: nothing here shows it is the best for that condition, and this workspace cannot reach that Reynolds number to test it. USE sets {a.designedFor.alphaDeg}° and {a.designedFor.speedKmh} km/h.
                </div>
              )}
              <details>
                <summary className="note">{a.designedFor ? 'the design · source' : 'known for · source'}</summary>
                <div className="note">{a.known}.</div>
                <div className="note">Shape: {a.source.text}.</div>
              </details>
              {advice.map((t, i) => (
                <div key={i} className="note" style={{ color: 'var(--warn, #d29922)' }}>
                  at {p.cells} cells: {t}.
                </div>
              ))}
              <div className="seg" style={{ margin: '4px 0', flexWrap: 'wrap' }}>
                <button className="ctl" disabled={p.disabled || !ok} onClick={() => ok && p.onLoad(a, b)} aria-label={`use ${a.name}`} title="start a project with this section as the body (the open project stays in the saved projects)">
                  USE
                </button>
                <button className="ctl" disabled={p.disabled || !ok || !spec} onClick={() => useDimpled(a)} aria-label={`use ${a.name} with dimples`} title={spec ? 'start a project with the dimpled version of this section, with the dimple settings above' : 'the dimple settings above are not valid'}>
                  USE WITH DIMPLES
                </button>
                <label className="field-inline" title="include this section in the airfoil study">
                  <input type="checkbox" checked={p.picked.includes(a.id)} disabled={!ok} onChange={() => toggle(a.id)} aria-label={`study ${a.name}`} /> in the study
                </label>
                <label className="field-inline" title="include the dimpled version of this section (with the dimple settings at the time of RUN STUDY) in the airfoil study">
                  <input type="checkbox" checked={p.picked.includes(a.id + DIMPLED_SUFFIX)} disabled={!ok} onChange={() => toggle(a.id + DIMPLED_SUFFIX)} aria-label={`study ${a.name} with dimples`} /> dimpled version too
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <h3 className="h3">Another section</h3>
      <div className="params simple">
        <label title="a four-digit code such as 4412 or 0012, or a five-digit code such as 23012">
          section code
          <input value={code} placeholder="4412, 23015 …" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} aria-label="section code" />
        </label>
      </div>
      <button className="ctl" onClick={addCode} disabled={!code.trim()} aria-label="add section by code">
        ADD
      </button>
      <label className="field-inline" style={{ display: 'block', marginTop: 6 }}>
        a coordinate file (Selig or Lednicer <code>.dat</code>){' '}
        <input
          type="file"
          accept=".dat,.txt,.csv,text/plain"
          aria-label="airfoil coordinate file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) addText(await f.text(), f.name);
            e.target.value = '';
          }}
        />
      </label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={'…or paste the file here:\nE387 …\n 1.00000  0.00000\n 0.99 0.0004\n…'} aria-label="pasted airfoil coordinates" style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 11 }} />
      <button className="ctl" onClick={() => addText(text)} disabled={!text.trim()} aria-label="add section from pasted coordinates">
        ADD FROM TEXT
      </button>
      {error && <div className="error">{error}</div>}
      {info && !error && <div className="note">{info}</div>}
    </div>
  );
}

/** The airfoil study: bodies picked above × angles typed here, run one after the other; the table of what was computed. */
export function AirfoilStudy(p: {
  picked: string[];
  anglesText: string;
  onAngles: (t: string) => void;
  anglesError: string | null;
  rows: StudyRow[];
  running: { done: number; total: number; label: string } | null;
  message: string | null;
  disabled: boolean;
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
  cells: number;
  reynolds: number;
  engine: string;
}) {
  const top = highestLd(p.rows);
  const highest = top[0];
  const download = () => {
    const blob = new Blob([studyCsv(p.rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'airfoil-study.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="airfoil-study" data-testid="airfoil-study">
      <div className="note">
        Every body ticked above is computed at every angle typed here, one run after the other, with the conditions of the open project (Reynolds number {Math.round(p.reynolds)}, {p.cells} cells along the chord, {p.engine}). The table is what these runs gave: a <b>two-dimensional flow at that Reynolds number</b>. The Reynolds number a lattice of this size can run is far below that of a real wing, where thin cambered sections and thick ones behave differently, so the order of the sections here is the order of these runs, not a ranking of the sections.
      </div>
      <div className="params simple">
        <label title="angles of attack in degrees, separated by commas or spaces">
          angles of attack [°]
          <input value={p.anglesText} onChange={(e) => p.onAngles(e.target.value)} aria-label="study angles" disabled={p.disabled || !!p.running} />
        </label>
      </div>
      {p.anglesError && <div className="error">{p.anglesError}</div>}
      <div className="seg" style={{ margin: '4px 0' }}>
        <button className="ctl primary" onClick={p.onRun} disabled={p.disabled || !!p.running || !p.picked.length || !!p.anglesError} aria-label="run the airfoil study" title={p.picked.length ? 'compute every ticked section at every angle' : 'tick “in the study” on at least one section'}>
          RUN STUDY ({p.picked.length} {p.picked.length === 1 ? 'section' : 'sections'})
        </button>
        <button className="ctl" onClick={p.onStop} disabled={!p.running} aria-label="stop the airfoil study">
          STOP
        </button>
        <button className="ctl" onClick={p.onClear} disabled={!!p.running || !p.rows.length} aria-label="clear the study table">
          CLEAR
        </button>
        <button className="ctl" onClick={download} disabled={!p.rows.length} aria-label="download the study as CSV">
          CSV
        </button>
      </div>
      {p.running && (
        <div className="note">
          Run {p.running.done + 1} of {p.running.total}: {p.running.label}
        </div>
      )}
      {p.message && <div className="warn">{p.message}</div>}
      {p.rows.length > 0 && (
        <>
          <table className="results compare" data-testid="study-table">
            <thead>
              <tr>
                <th>section</th>
                <th>α</th>
                <th title="lift coefficient, per ½ρU² and chord (2-D)">C_l</th>
                <th title="drag coefficient">C_d</th>
                <th title="the ratio of the two">L/D</th>
                <th title="integrity checks of the run">run</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r) => (
                <tr key={r.jobId} className={highest && r.jobId === highest.jobId ? 'row-top' : undefined} data-study-row={r.jobId}>
                  <td className="q">{r.name}</td>
                  <td>{r.alphaDeg}°</td>
                  <td>{r.lift.mean.toFixed(3)}</td>
                  <td>{r.drag.mean.toFixed(4)}</td>
                  <td>
                    <b>{r.ld ? r.ld.mean.toFixed(1) : '—'}</b>
                    {r.ld && Number.isFinite(r.ld.se) ? <span className="note"> ±{r.ld.se.toFixed(1)}</span> : null}
                  </td>
                  <td title={`${r.engine}; thickness ${r.thicknessCells.toFixed(1)} cells, nose radius ${r.noseCells.toFixed(2)} cells`}>{r.integrity === 'PASSED' ? '✓' : r.integrity === 'WARNING' ? '!' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {top.length > 0 && (
            <div className="note">
              The highest L/D of each section among the angles run:{' '}
              {top.map((r, i) => (
                <span key={r.jobId}>
                  {i ? '; ' : ''}
                  <b>{r.name}</b> {r.ld!.mean.toFixed(1)} at {r.alphaDeg}°
                </span>
              ))}
              . A value at the edge of the angles run means the true maximum may lie beyond them. Lift and drag are those of the computed flow (pressure and viscous), per unit depth, in a channel with slip walls (blockage inflates them); each uncertainty is one standard error of the run’s time blocks.
            </div>
          )}
        </>
      )}
    </div>
  );
}
