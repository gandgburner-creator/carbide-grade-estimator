import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PFAD_MODEL_VERSION } from '../core/version';
import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import { EXPERIMENTS } from '../experiments/registry';
import type { ValidationStatus } from '../validation/Status';
import type { FieldKind, Frame, FromWorker, ToWorker } from '../workers/protocol';
import { CATALOG, type CatalogEntry } from './catalog';
import { Chart } from './Chart';
import {
  AirfoilLock,
  Badge,
  ExperimentSelector,
  ExportPanel,
  Inspector,
  LiveMetrics,
  ParamsForm,
  PerfOverlay,
  RecordView,
  SeedPicker,
} from './Panels';
import { ParticleView, ramp, type ViewOptions } from './ParticleView';

type Params = Record<string, unknown>;

function paramsFor(entry: CatalogEntry, preset: 'quick' | 'reference'): Params | null {
  if (!entry.engine) return null;
  const reg = EXPERIMENTS[entry.engine];
  if (!reg) return null;
  return { ...(preset === 'quick' ? reg.quick : reg.defaults), ...(entry.preset ?? {}) } as Params;
}

const FIELD_LABELS: Record<FieldKind, string> = {
  none: 'none',
  occupancy: 'occupancy φ',
  occupancyGradient: '|∇φ|',
  density: 'density ρ',
  speed: 'mean velocity |u|',
  kT: 'kT (peculiar)',
  pressure: 'pressure (particle stress)',
  shear: 'shear stress τ_xy (particle stress)',
};

export function Lab() {
  const workerRef = useRef<Worker | null>(null);
  const epochRef = useRef(0);
  const [entry, setEntry] = useState<CatalogEntry>(CATALOG[0]);
  const [preset, setPreset] = useState<'quick' | 'reference'>('quick');
  const [params, setParams] = useState<Params | null>(() => paramsFor(CATALOG[0], 'quick'));
  const [frame, setFrame] = useState<Frame | null>(null);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ValidationStatus>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [field, setField] = useState<FieldKind>('none');
  const [perCell, setPerCell] = useState(25);
  const [average, setAverage] = useState(true);
  const [options, setOptions] = useState<ViewOptions>({ vectors: false, collisions: false, trails: true, colorBySpeed: true });
  const [fps, setFps] = useState(0);
  const renderMs = useRef(0);
  const frameTimes = useRef<number[]>([]);

  const send = useCallback((m: ToWorker) => workerRef.current?.postMessage(m), []);

  useEffect(() => {
    const w = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.epoch !== epochRef.current) return; // from an unloaded experiment
      if (m.type === 'frame') {
        const t0 = performance.now();
        setFrame(m);
        const now = performance.now();
        frameTimes.current = [...frameTimes.current.filter((t) => now - t < 1000), now];
        setFps(frameTimes.current.length);
        renderMs.current = performance.now() - t0;
      } else if (m.type === 'record') {
        setRecord(m.record);
      } else if (m.type === 'error') {
        setError(m.message);
      }
    };
    return () => w.terminate();
  }, []);

  // remember the status of the last completed record per catalog entry
  useEffect(() => {
    if (record) setStatuses((s) => ({ ...s, [entry.key]: record.status }));
  }, [record, entry.key]);

  useEffect(() => {
    send({ type: 'view', field, perCell, average, trails: options.trails });
  }, [field, perCell, average, options.trails, send]);

  const engineStatuses = useMemo(() => {
    const out: Record<string, ValidationStatus> = {};
    for (const c of CATALOG) if (c.engine && statuses[c.key]) out[c.engine] = statuses[c.key];
    return out;
  }, [statuses]);

  const select = (e: CatalogEntry) => {
    epochRef.current++;
    send({ type: 'unload', epoch: epochRef.current });
    setEntry(e);
    setParams(paramsFor(e, preset));
    setRecord(null);
    setError(null);
    setLoaded(false);
    setFrame(null);
    setSelected(null);
  };

  const load = () => {
    if (!entry.engine || !params) return;
    setRecord(null);
    setError(null);
    setSelected(null);
    epochRef.current++;
    send({ type: 'init', experiment: entry.engine as ExperimentType, params, epoch: epochRef.current });
    send({ type: 'view', field, perCell, average, trails: options.trails });
    setLoaded(true);
  };

  const running = frame?.running ?? false;
  const finished = frame?.finished ?? false;
  const liveStatus: ValidationStatus = record ? record.status : running ? 'RUNNING' : 'UNTESTED';
  const series = frame?.series ?? [];

  return (
    <div className="lab">
      <header className="topbar">
        <div>
          <h1>PFAD v0.2 — PARTICLE-FIELD EXPERIMENTAL LABORATORY · PHASE 0</h1>
          <div className="meta">
            model {PFAD_MODEL_VERSION} · 2D hard disks · no classical aerodynamics in the solver · benchmarks shown separately
          </div>
        </div>
        <span className="prediction-label">PFAD MODEL PREDICTION — NOT EXTERNALLY VALIDATED</span>
      </header>
      <div className="main">
        <div className="column">
          <ExperimentSelector selected={entry.key} onSelect={select} statuses={statuses} />
          <div className="section">
            <h2>
              {entry.label} <span style={{ float: 'right' }}><Badge status={liveStatus} /></span>
            </h2>
            {!entry.engine || !params ? (
              <div className="note">
                {entry.summary}
                <br />
                <br />
                Status UNTESTED: this experiment is scheduled for {entry.step} of the development order and has no implementation yet.
                Nothing is simulated or displayed for it.
              </div>
            ) : (
              <>
                <div className="seg" style={{ marginBottom: 8 }}>
                  {(['quick', 'reference'] as const).map((p) => (
                    <button
                      key={p}
                      className={`ctl ${preset === p ? 'on' : ''}`}
                      disabled={running}
                      onClick={() => {
                        setPreset(p);
                        setParams(paramsFor(entry, p));
                      }}
                      title={p === 'quick' ? 'reduced size, for looking — not for reported results' : 'documented reference configuration'}
                    >
                      {p === 'quick' ? 'QUICK LOOK' : 'REFERENCE'}
                    </button>
                  ))}
                </div>
                <ParamsForm key={`${entry.key}-${preset}`} entry={entry} params={params} onChange={setParams} disabled={running} />
                <div style={{ marginTop: 8 }}>
                  <SeedPicker
                    key={`seeds-${entry.key}-${preset}`}
                    seeds={(params.seeds as number[]) ?? [7]}
                    onChange={(s) => setParams({ ...params, seeds: s })}
                    disabled={running}
                  />
                </div>
              </>
            )}
          </div>
          {entry.engine && params && (
            <div className="section">
              <h2>Controls</h2>
              <div className="controls">
                <button className="ctl primary" disabled={running || (loaded && !finished && !!frame)} onClick={load}>
                  LOAD
                </button>
                <button className="ctl primary" disabled={!loaded || running || finished} onClick={() => send({ type: 'run' })}>
                  RUN
                </button>
                <button className="ctl" disabled={!running} onClick={() => send({ type: 'pause' })}>
                  PAUSE
                </button>
                <button className="ctl" disabled={!loaded || running || finished} onClick={() => send({ type: 'step', steps: 1 })}>
                  STEP
                </button>
                <button className="ctl" disabled={!loaded || finished} onClick={() => send({ type: 'stop' })}>
                  STOP
                </button>
                <button className="ctl" disabled={running} onClick={load}>
                  RESET
                </button>
              </div>
              <div className="note" style={{ marginTop: 6 }}>
                LOAD builds the initial state; RESET rebuilds it from the same seed (identical replay).
              </div>
              {error && <div className="error">{error}</div>}
            </div>
          )}
          <AirfoilLock statuses={engineStatuses} />
        </div>

        <div className="column" style={{ padding: 0 }}>
          <div className="view-wrap">
            <div className="view-toolbar">
              <span>field</span>
              <select value={field} onChange={(e) => setField(e.target.value as FieldKind)}>
                {(Object.keys(FIELD_LABELS) as FieldKind[]).map((k) => (
                  <option key={k} value={k}>
                    {FIELD_LABELS[k]}
                  </option>
                ))}
              </select>
              <span title="target particles per cell per snapshot; fewer means noisier cells">particles/cell</span>
              <input type="number" min={1} max={1000} value={perCell} style={{ width: 52 }} onChange={(e) => setPerCell(Math.max(1, Number(e.target.value) || 25))} />
              <label style={{ display: 'flex', gap: 3, alignItems: 'center' }} title="accumulate the field over frames (temporal averaging)">
                <input type="checkbox" checked={average} onChange={(e) => setAverage(e.target.checked)} />
                time-average
              </label>
              <button className="ctl" style={{ padding: '2px 6px' }} onClick={() => send({ type: 'resetAverage' })}>
                reset avg
              </button>
              {(['vectors', 'collisions', 'trails', 'colorBySpeed'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                  <input type="checkbox" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />
                  {k === 'colorBySpeed' ? 'colour by speed' : k}
                </label>
              ))}
            </div>
            <ParticleView
              frame={frame}
              options={options}
              selected={selected}
              onPick={(i) => {
                setSelected(i);
                send({ type: 'inspect', index: i });
              }}
            />
            <PerfOverlay frame={frame} fps={fps} renderMs={renderMs.current} />
            {frame?.field && (
              <div className="legend">
                {FIELD_LABELS[frame.field.kind]} — measured, {frame.field.nx}×{frame.field.ny} cells, {frame.field.particlesPerCell.toFixed(1)} particles/cell,{' '}
                {frame.field.snapshots} snapshot{frame.field.snapshots === 1 ? '' : 's'}
                {frame.field.note && <div>{frame.field.note}</div>}
                {frame.field.particlesPerCell * frame.field.snapshots < 100 && (
                  <div style={{ color: 'var(--inconclusive)' }}>fewer than 100 samples per cell: noise-dominated</div>
                )}
                <div
                  className="bar"
                  style={{
                    background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${ramp(t).map((c) => c | 0).join(',')})`).join(',')})`,
                  }}
                />
                min {frame.field.min.toPrecision(3)} · mean {frame.field.mean.toPrecision(3)} · max {frame.field.max.toPrecision(3)}
              </div>
            )}
            {!frame && (
              <div className="note" style={{ position: 'absolute', top: '45%', width: '100%', textAlign: 'center' }}>
                Select an implemented experiment and press LOAD.
              </div>
            )}
          </div>
        </div>

        <div className="column">
          <div className="section">
            <h2>Live measurement</h2>
            <LiveMetrics frame={frame} />
            <Chart xs={series.map((s) => s.c)} ys={series.map((s) => s.value)} xLabel="collisions/particle" yLabel={series[0]?.label ?? 'value'} />
            <div className="note">Instantaneous window values; the recorded estimate uses block averaging and seed ensembles.</div>
          </div>
          <div className="section">
            <h2>Particle inspector</h2>
            <Inspector data={frame?.inspected ?? null} />
          </div>
          <div className="section">
            <h2>Experiment record</h2>
            <RecordView record={record} />
          </div>
          <div className="section">
            <h2>Export</h2>
            <ExportPanel record={record} config={params} experiment={entry.engine ?? entry.key} />
          </div>
        </div>
      </div>
    </div>
  );
}
