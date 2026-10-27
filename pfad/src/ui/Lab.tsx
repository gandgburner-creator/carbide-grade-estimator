import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fieldCSV, safeName } from '../app/exporters';
import { FIELD_INFO, NOISE_SAMPLES, temporalLabel, UNITS_NOTE } from '../app/fields';
import { markInterrupted, parseImport, type LibraryEntry, type LibraryStore, type Outcome } from '../app/library';
import { openLibrary } from '../app/libraryIdb';
import { CODE_VERSION, makeProvenance, type Provenance } from '../app/provenance';
import { validateParams, type Validation } from '../app/validate';
import { PFAD_MODEL_VERSION } from '../core/version';
import type { ExperimentRecord, ExperimentType } from '../experiments/Experiment';
import { AB_PRESETS, EXPERIMENTS } from '../experiments/registry';
import { UB_INSTRUMENT_QUICK, UB_INSTRUMENT_REFERENCE, UB_LOCK_MESSAGE, type UBInstrumentCheckpoint } from '../experiments/UBInstrumentExperiment';
import type { UB0Kind } from '../universeB/UB0Run';
import type { ValidationStatus } from '../validation/Status';
import type { FieldKind, Frame, FromWorker, ProfileRequest, ToWorker } from '../workers/protocol';
import { AnalysisPanel } from './AnalysisPanel';
import { CATALOG, type CatalogEntry } from './catalog';
import { fieldScale } from './colors';
import { ComparePanel } from './ComparePanel';
import { downloadCanvasPNG, downloadText } from './download';
import { LibraryPanel } from './LibraryPanel';
import { AirfoilLock, Badge, ExperimentSelector, fmt, Inspector, LiveMetrics, ParamsForm, PerfOverlay, SeedPicker } from './Panels';
import { ParticleView, type Camera, type ViewOptions } from './ParticleView';
import { ResultsPanel } from './ResultsPanel';

type Params = Record<string, unknown>;
type Preset = 'quick' | 'reference';
type Phase = 'idle' | 'loaded' | 'running' | 'paused' | 'finished' | 'stopped' | 'failed';
type RightTab = 'live' | 'results' | 'library' | 'compare';

const FIELD_ORDER: FieldKind[] = ['none', 'occupancy', 'density', 'ux', 'uy', 'speed', 'momentumX', 'momentumY', 'kT', 'pressure', 'shear', 'occupancyGradient'];

/** The documented parameter set for a catalog entry and preset (the validation reference). */
function paramsFor(entry: CatalogEntry, preset: Preset, kind?: UB0Kind): Params | null {
  if (!entry.engine) return null;
  if (entry.engine === 'ub-instrument') return { ...(preset === 'quick' ? UB_INSTRUMENT_QUICK : UB_INSTRUMENT_REFERENCE)[kind ?? 'static'] } as unknown as Params;
  const reg = EXPERIMENTS[entry.engine];
  if (!reg) return null;
  return { ...(preset === 'quick' ? reg.quick : reg.defaults), ...(entry.preset ?? {}) } as Params;
}

/** Instrument parameters that do not apply to the chosen kind are hidden. */
function hiddenFor(entry: CatalogEntry, params: Params | null): string[] {
  if (entry.engine !== 'ub-instrument' || !params) return [];
  const k = params.kind as UB0Kind;
  const periodic = k === 'static' || k === 'shear' || k === 'sound';
  return ['Nc', ...(periodic ? ['width', 'height'] : ['L']), ...(k === 'shear' || k === 'sound' ? [] : ['amplitude']), ...(k === 'couette' ? [] : ['wallSpeed']), ...(k === 'static' ? [] : ['extras'])];
}

interface RunInfo {
  id: string;
  entry: CatalogEntry;
  params: Params;
  provenance: Provenance;
  started: boolean;
  closed: boolean;
}

export function Lab() {
  const workerRef = useRef<Worker | null>(null);
  const epochRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [universe, setUniverse] = useState<'A' | 'B'>('A');
  const [entry, setEntry] = useState<CatalogEntry>(CATALOG[0]);
  const [preset, setPreset] = useState<Preset>('quick');
  const [formVersion, setFormVersion] = useState(0);
  const [params, setParams] = useState<Params | null>(() => paramsFor(CATALOG[0], 'quick'));
  const [frame, setFrame] = useState<Frame | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
  const [record, setRecord] = useState<ExperimentRecord | null>(null);
  const [viewEntry, setViewEntry] = useState<LibraryEntry | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [field, setField] = useState<FieldKind>('none');
  const [perCell, setPerCell] = useState(25);
  const [average, setAverage] = useState(true);
  const [options, setOptions] = useState<ViewOptions>({ particles: true, vectors: false, collisions: false, trails: true, colorBySpeed: true });
  const [showPerf, setShowPerf] = useState(true);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [profile, setProfile] = useState<ProfileRequest | null>(null);
  const [tab, setTab] = useState<RightTab>('live');
  const [fps, setFps] = useState(0);
  const [lib, setLib] = useState<{ store: LibraryStore; persistent: boolean } | null>(null);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const runRef = useRef<RunInfo | null>(null);
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const renderMs = useRef(0);
  const frameTimes = useRef<number[]>([]);

  const send = useCallback((m: ToWorker) => workerRef.current?.postMessage(m), []);
  const refresh = useCallback(async () => {
    if (lib) setEntries(await lib.store.list());
  }, [lib]);

  // library: open, and close out runs a previous page left running
  useEffect(() => {
    let live = true;
    openLibrary().then(async (l) => {
      for (const e of await l.store.list()) {
        const fixed = markInterrupted(e);
        if (fixed) await l.store.put(fixed);
      }
      if (live) setLib(l);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const setRun = (r: RunInfo | null) => {
    runRef.current = r;
    setRunInfo(r);
  };

  /** Write the current run's library entry with this outcome. */
  const saveRun = useCallback(
    async (outcome: Outcome, extra: { record?: ExperimentRecord; message?: string; activeMs?: number; checkpoint?: unknown; progress?: number; simTime?: number; particles?: number } = {}) => {
      const r = runRef.current;
      if (!r || !lib) return;
      const id = outcome === 'checkpoint' ? `${r.id}-checkpoint-${Date.now()}` : r.id;
      const e: LibraryEntry = {
        id,
        title: extra.record?.title ?? `${(r.entry.engine && EXPERIMENTS[r.entry.engine]?.title) || r.entry.label}${r.params.kind ? `: ${String(r.params.kind)}` : ''}`,
        experimentType: r.entry.engine ?? r.entry.key,
        catalogKey: r.entry.key,
        universe: 'A',
        seeds: (r.params.seeds as number[]) ?? [],
        createdAt: outcome === 'checkpoint' ? new Date().toISOString() : r.provenance.createdAt,
        outcome,
        runtimeMs: extra.activeMs ?? null,
        status: extra.record?.status ?? 'UNTESTED',
        hasRecord: !!extra.record,
        config: r.params,
        provenance: r.provenance,
        message: extra.message,
        summary: { progress: extra.progress, simTime: extra.simTime, particles: extra.particles ?? extra.record?.particleCount },
      };
      try {
        await lib.store.put(e, extra.record || extra.checkpoint ? { record: extra.record, checkpoint: extra.checkpoint } : undefined);
      } catch (err) {
        setMessage({ kind: 'error', text: `Could not store the run in the library: ${(err as Error).message}. Export it now to keep it.` });
      }
      await refresh();
      return e;
    },
    [lib, refresh],
  );

  const frameRef = useRef<Frame | null>(null);
  frameRef.current = frame;

  useEffect(() => {
    const w = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onerror = (ev) => setMessage({ kind: 'error', text: `Simulation worker error: ${ev.message}` });
    return () => w.terminate();
  }, []);

  // worker messages (re-bound when the library or callbacks change)
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.epoch !== epochRef.current) return; // from an unloaded experiment
      const fr = frameRef.current;
      switch (m.type) {
        case 'frame': {
          const t0 = performance.now();
          setFrame(m);
          if (m.running) setPhase('running');
          const now = performance.now();
          frameTimes.current = [...frameTimes.current.filter((t) => now - t < 1000), now];
          setFps(frameTimes.current.length);
          renderMs.current = performance.now() - t0;
          break;
        }
        case 'record': {
          setPhase('finished');
          setRecord(m.record);
          if (runRef.current) runRef.current.closed = true;
          saveRun('completed', { record: m.record, activeMs: m.activeMs, progress: 1 }).then((e) => e && setViewEntry(e));
          setTab('results');
          setMessage({ kind: 'info', text: `Finished: record ${m.record.experimentId} stored in the library.` });
          break;
        }
        case 'stopped':
          setPhase('stopped');
          if (runRef.current) runRef.current.closed = true;
          saveRun('stopped', { message: m.message, activeMs: m.activeMs, progress: fr?.progress, simTime: fr?.perf.time, particles: fr?.count });
          setMessage({ kind: 'warn', text: `${m.message} The run is listed in the library as STOPPED.` });
          break;
        case 'failed':
          setPhase('failed');
          if (runRef.current) runRef.current.closed = true;
          saveRun('failed', { message: m.message, activeMs: m.activeMs, progress: fr?.progress, simTime: fr?.perf.time, particles: fr?.count });
          setMessage({ kind: 'error', text: `${m.message} The run is listed in the library as FAILED.` });
          break;
        case 'checkpoint':
          setPhase('paused');
          saveRun('checkpoint', { checkpoint: m.state, activeMs: m.activeMs, progress: fr?.progress, simTime: fr?.perf.time, particles: fr?.count, message: `checkpoint at ${(100 * (fr?.progress ?? 0)).toFixed(0)} %` });
          setMessage({ kind: 'info', text: 'Checkpoint stored in the library; RESUME it there, in this or a later session.' });
          break;
        case 'error':
          setMessage({ kind: 'error', text: m.message });
          if (!runRef.current?.started) setPhase('idle');
          break;
      }
    };
  }, [saveRun]);

  useEffect(() => {
    send({ type: 'view', field, perCell, average, trails: options.trails, profile });
  }, [field, perCell, average, options.trails, profile, send]);

  // validation against the documented parameter set
  const kind = (params?.kind as UB0Kind | undefined) ?? undefined;
  const reference = useMemo(() => paramsFor(entry, preset, kind), [entry, preset, kind]);
  const validation: Validation | null = useMemo(() => {
    if (!params || !reference || !entry.engine) return null;
    if (entry.engine === 'ab-test') return { errors: [], warnings: [], changed: [] }; // A/B params embed two whole configurations
    const v = validateParams(params, reference, { protocolSeeds: entry.engine === 'ub-instrument' });
    if (entry.engine === 'ub-instrument' && params.Nc !== 1) v.errors.push({ path: 'Nc', message: UB_LOCK_MESSAGE });
    return v;
  }, [params, reference, entry.engine]);

  const statuses = useMemo(() => {
    const out: Record<string, ValidationStatus> = {};
    for (const e of [...entries].reverse()) {
      if (!e.hasRecord) continue;
      const key = e.catalogKey ?? CATALOG.find((c) => c.engine === e.experimentType)?.key;
      if (key) out[key] = e.status;
    }
    return out;
  }, [entries]);
  const engineStatuses = useMemo(() => {
    const out: Record<string, ValidationStatus> = {};
    for (const c of CATALOG) if (c.engine && statuses[c.key]) out[c.engine] = statuses[c.key];
    return out;
  }, [statuses]);

  /** A started, unfinished run that is being abandoned is recorded as stopped. */
  const abandon = (reason: string) => {
    const r = runRef.current;
    if (r && r.started && !r.closed) {
      r.closed = true;
      const fr = frameRef.current;
      saveRun('stopped', { message: reason, activeMs: fr?.activeMs, progress: fr?.progress, simTime: fr?.perf.time, particles: fr?.count });
    }
  };

  const unload = () => {
    epochRef.current++;
    send({ type: 'unload', epoch: epochRef.current });
    setFrame(null);
    setSelected(null);
    setPhase('idle');
  };

  const select = (e: CatalogEntry) => {
    abandon(`Abandoned: another experiment was selected at ${(100 * (frameRef.current?.progress ?? 0)).toFixed(0)} %.`);
    unload();
    setRun(null);
    setEntry(e);
    setParams(paramsFor(e, preset));
    setFormVersion((v) => v + 1);
    setMessage(null);
    setCamera(null);
    setProfile(null);
  };

  const load = (opts: { resume?: UBInstrumentCheckpoint; resumedFrom?: string } = {}) => {
    const p = opts.resume ? (opts.resume.params as unknown as Params) : params;
    if (!entry.engine || !p) return;
    if (!opts.resume && validation?.errors.length) {
      setMessage({ kind: 'error', text: `Fix the configuration first: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}` });
      return;
    }
    abandon('Abandoned: the experiment was reset or reloaded before it finished.');
    epochRef.current++;
    setFrame(null);
    setSelected(null);
    setMessage(null);
    const createdAt = new Date().toISOString();
    const seeds = (p.seeds as number[]) ?? [];
    const provenance = makeProvenance({
      experimentType: entry.engine,
      universe: 'A',
      preset: opts.resumedFrom ? `resumed from ${opts.resumedFrom}` : preset + (validation?.changed.length ? ` (changed: ${validation.changed.join(', ')})` : ''),
      seeds,
      createdAt,
    });
    setRun({ id: `${entry.engine}-${createdAt.replace(/[:.]/g, '-')}-s${seeds.slice(0, 6).join('_')}`, entry, params: structuredClone(p), provenance, started: false, closed: false });
    send({ type: 'init', experiment: entry.engine as ExperimentType, params: p, epoch: epochRef.current, resume: opts.resume });
    send({ type: 'view', field, perCell, average, trails: options.trails, profile });
    setPhase('loaded');
  };

  const run = () => {
    const r = runRef.current;
    if (r && !r.started) {
      r.started = true;
      saveRun('running', { message: 'in progress' });
    }
    send({ type: 'run' });
    setPhase('running');
  };

  const openEntry = async (e: LibraryEntry) => {
    if (!lib) return;
    const payload = await lib.store.payload(e.id);
    if (e.outcome === 'checkpoint' && payload?.checkpoint) {
      const cp = payload.checkpoint as UBInstrumentCheckpoint;
      const ce = CATALOG.find((c) => c.engine === 'ub-instrument')!;
      abandon('Abandoned: a checkpoint was resumed.');
      unload();
      setUniverse('A');
      setEntry(ce);
      setParams(cp.params as unknown as Params);
      setFormVersion((v) => v + 1);
      // load needs the new entry; resume directly
      epochRef.current++;
      const createdAt = new Date().toISOString();
      const provenance = makeProvenance({ experimentType: 'ub-instrument', universe: 'A', preset: `resumed from ${e.id}`, seeds: cp.params.seeds, createdAt });
      setRun({ id: `ub-instrument-${createdAt.replace(/[:.]/g, '-')}-resumed`, entry: ce, params: cp.params as unknown as Params, provenance, started: false, closed: false });
      send({ type: 'init', experiment: 'ub-instrument', params: cp.params, epoch: epochRef.current, resume: cp });
      send({ type: 'view', field, perCell, average, trails: options.trails, profile });
      setPhase('loaded');
      setTab('live');
      setMessage({ kind: 'info', text: `Resumed checkpoint ${e.id} (${(100 * (e.summary?.progress ?? 0)).toFixed(0)} % done). Press RUN to continue.` });
      return;
    }
    if (payload?.record) {
      setRecord(payload.record);
      setViewEntry(e);
      setTab('results');
      return;
    }
    // no record: offer its configuration
    const ce = (e.catalogKey && CATALOG.find((c) => c.key === e.catalogKey)) || CATALOG.find((c) => c.engine === e.experimentType);
    if (ce && e.config) {
      abandon('Abandoned: a library configuration was loaded.');
      unload();
      setRun(null);
      setEntry(ce);
      setParams(structuredClone(e.config) as Params);
      setFormVersion((v) => v + 1);
      setMessage({ kind: 'info', text: `Configuration of ${e.id} (${e.outcome}) loaded into the form. LOAD to run it again.` });
    }
  };

  const importFiles = async (files: FileList) => {
    if (!lib) return;
    let n = 0;
    const errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        for (const it of parseImport(await f.text(), f.name)) {
          await lib.store.put(it.entry, it.payload);
          n++;
        }
      } catch (err) {
        errors.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    await refresh();
    setMessage(errors.length ? { kind: 'error', text: `Imported ${n}; failed: ${errors.join('; ')}` } : { kind: 'info', text: `Imported ${n} record(s) into the library.` });
  };

  const exportFieldCSV = () => {
    const f = frame?.field;
    if (!f || !runInfo || f.kind === 'none') return;
    downloadText(
      `${safeName(runInfo.id)}_${f.kind}.csv`,
      fieldCSV({ kind: f.kind, nx: f.nx, ny: f.ny, values: f.values, snapshots: f.snapshots, particlesPerCell: f.particlesPerCell, t0: f.t0, t1: f.t1, note: f.note, domain: frame.domain }, runInfo.provenance),
      'text/csv',
    );
  };
  const exportViewPNG = () => {
    const c = canvasRef.current;
    if (!c || !frame) return;
    const f = frame.field;
    const caption = [
      `${entry.label} · ${frame.runLabel} · t = ${fmt(frame.perf.time)} τ · ${frame.count} particles`,
      f && f.kind !== 'none'
        ? `${FIELD_INFO[f.kind].label} ${FIELD_INFO[f.kind].symbol} [${FIELD_INFO[f.kind].units}], ${FIELD_INFO[f.kind].origin}, ${temporalLabel(f.snapshots, f.t0, f.t1)}; colour range ${fmt(fieldScale(f.kind, f.min, f.max).lo)} … ${fmt(fieldScale(f.kind, f.min, f.max).hi)}`
        : 'particles coloured by speed',
    ];
    downloadCanvasPNG(`${safeName(runInfo?.id ?? 'pfad-view')}_${f?.kind ?? 'particles'}.png`, c, caption, runInfo?.provenance ?? null);
  };

  const running = phase === 'running';
  const loaded = phase !== 'idle' && !!frame;
  const ended = phase === 'finished' || phase === 'stopped' || phase === 'failed';
  const catalog = CATALOG.filter((c) => (universe === 'B' ? c.universe === 'B' : c.universe !== 'B'));
  const liveStatus: ValidationStatus | 'LOCKED' = entry.locked ? 'LOCKED' : running ? 'RUNNING' : record && runInfo && record.experimentType === entry.engine && phase === 'finished' ? record.status : 'UNTESTED';
  const f = frame?.field;
  const info = f && f.kind !== 'none' ? FIELD_INFO[f.kind] : null;
  const scale = f ? fieldScale(f.kind, f.min, f.max) : null;

  return (
    <div className="lab">
      <header className="topbar">
        <div>
          <h1>PFAD LABORATORY — PARTICLE-FIELD AIRFOIL DESIGN · PHASE 0</h1>
          <div className="meta">
            model {PFAD_MODEL_VERSION} · code {CODE_VERSION.slice(0, 12)} · 2D hard disks · no continuum or aerodynamic model in the solver · {UNITS_NOTE}
          </div>
        </div>
        <div className="topbar-right">
          <div className="seg" role="group" aria-label="Universe">
            <button
              className={`ctl ${universe === 'A' ? 'on' : ''}`}
              onClick={() => {
                if (universe !== 'A') {
                  setUniverse('A');
                  select(CATALOG[0]);
                }
              }}
              title="Universe A: hard-disk molecules"
            >
              UNIVERSE A
            </button>
            <button
              className={`ctl ${universe === 'B' ? 'on' : ''}`}
              onClick={() => {
                setUniverse('B');
                select(CATALOG.find((c) => c.universe === 'B')!);
              }}
              title="Universe B: UB-0 coarse-grained parcels (locked)"
            >
              UNIVERSE B (LOCKED)
            </button>
          </div>
          <span className="prediction-label">PFAD MODEL PREDICTION — NOT EXTERNALLY VALIDATED</span>
        </div>
      </header>
      <div className="main">
        <div className="column">
          <ExperimentSelector
            selected={entry.key}
            onSelect={(e) => {
              if (e.universe === 'B') setUniverse('B');
              select(e);
            }}
            statuses={statuses}
            entries={catalog}
            title={universe === 'A' ? 'Experiments — Universe A' : 'Universe B'}
          />
          <div className="section">
            <h2>
              Configuration <span style={{ float: 'right' }}><Badge status={liveStatus} /></span>
            </h2>
            <div className="note" style={{ marginBottom: 6 }}>
              <b>{entry.label}</b> · {entry.step}
              {entry.universe === 'A+variants' && (
                <div className="warn">
                  Includes Phase 0 model variants B–E (occupancy force, internal reservoir): experimental, and not the UB-0 coarse-grained Universe B.
                </div>
              )}
            </div>
            {entry.locked ? (
              <div className="locked-note">
                {entry.summary}
                <br />
                <br />
                {entry.locked}
              </div>
            ) : !entry.engine || !params ? (
              <div className="note">{entry.summary} Not implemented: nothing is simulated or displayed for it.</div>
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
                        setParams(paramsFor(entry, p, kind));
                        setFormVersion((v) => v + 1);
                      }}
                      title={p === 'quick' ? 'reduced size, for looking — not for reported results' : 'documented reference configuration (may take long in the browser)'}
                    >
                      {p === 'quick' ? 'QUICK LOOK' : 'REFERENCE'}
                    </button>
                  ))}
                </div>
                {entry.engine === 'ub-instrument' && (
                  <div className="note" style={{ marginBottom: 6 }} title={UB_LOCK_MESSAGE}>
                    N_c = 1 (Universe A). Universe B (N_c &gt; 1) is locked by the UB-0 blinding rule (design §11.7).
                  </div>
                )}
                {entry.engine === 'ab-test' && (
                  <label className="field" style={{ display: 'block', marginBottom: 8 }}>
                    comparison preset
                    <select
                      disabled={running}
                      value=""
                      onChange={(e) => {
                        const p = AB_PRESETS[e.target.value];
                        if (p) {
                          setParams(p as unknown as Params);
                          setFormVersion((v) => v + 1);
                        }
                      }}
                    >
                      <option value="">— choose a comparison —</option>
                      {Object.keys(AB_PRESETS).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <ParamsForm
                  key={`${entry.key}-${formVersion}`}
                  entry={entry}
                  params={params}
                  hidden={hiddenFor(entry, params)}
                  onChange={(p) => {
                    if (entry.engine === 'ub-instrument' && p.kind !== params.kind) {
                      setParams({ ...(paramsFor(entry, preset, p.kind as UB0Kind) as Params), seeds: params.seeds });
                      setFormVersion((v) => v + 1);
                    } else setParams(p);
                  }}
                  disabled={running}
                />
                <div style={{ marginTop: 8 }}>
                  <SeedPicker key={`seeds-${entry.key}-${formVersion}`} seeds={(params.seeds as number[]) ?? [7]} onChange={(s) => setParams({ ...params, seeds: s })} disabled={running} />
                </div>
                {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
                  <div style={{ marginTop: 6 }}>
                    {validation.errors.map((e, i) => (
                      <div className="error" key={`e${i}`}>
                        {e.path}: {e.message}
                      </div>
                    ))}
                    {validation.warnings.map((e, i) => (
                      <div className="warn" key={`w${i}`}>
                        {e.path}: {e.message}
                      </div>
                    ))}
                  </div>
                )}
                <details className="effective">
                  <summary>
                    Effective configuration{validation?.changed.length ? ` — changed: ${validation.changed.join(', ')}` : ` — ${preset} preset, unchanged`}
                  </summary>
                  <pre>{JSON.stringify(params, null, 1)}</pre>
                  <button
                    className="ctl"
                    onClick={() =>
                      downloadText(
                        `pfad-config-${entry.engine}.json`,
                        JSON.stringify({ experiment: entry.engine, params, provenance: makeProvenance({ experimentType: entry.engine!, universe: 'A', preset, seeds: (params.seeds as number[]) ?? [] }) }, null, 1),
                        'application/json',
                      )
                    }
                  >
                    EXPORT CONFIG
                  </button>
                </details>
              </>
            )}
          </div>
          {entry.engine && params && !entry.locked && (
            <div className="section">
              <h2>Run</h2>
              <div className="controls">
                <button className="ctl primary" disabled={running || (loaded && !ended) || !!validation?.errors.length} onClick={() => load()} title="build the initial state">
                  LOAD
                </button>
                <button className="ctl primary" disabled={!loaded || running || ended} onClick={run}>
                  {phase === 'paused' ? 'RESUME' : 'RUN'}
                </button>
                <button
                  className="ctl"
                  disabled={!running}
                  onClick={() => {
                    send({ type: 'pause' });
                    setPhase('paused');
                  }}
                >
                  PAUSE
                </button>
                <button
                  className="ctl"
                  disabled={!loaded || running || ended}
                  onClick={() => {
                    const r = runRef.current;
                    if (r && !r.started) {
                      r.started = true;
                      saveRun('running', { message: 'in progress (stepping)' });
                    }
                    send({ type: 'step', steps: 1 });
                    setPhase('paused');
                  }}
                >
                  STEP
                </button>
                <button className="ctl" disabled={!loaded || ended} onClick={() => send({ type: 'stop' })} title="end the run; it is recorded as STOPPED, without a record">
                  STOP
                </button>
                <button className="ctl" disabled={running || !loaded} onClick={() => load()} title="rebuild the initial state from the same seeds (identical replay)">
                  RESET
                </button>
                <button
                  className="ctl"
                  disabled={!frame?.checkpointable || running}
                  onClick={() => send({ type: 'checkpoint' })}
                  title={frame?.checkpointable ? 'store a resumable checkpoint in the library' : 'checkpoint/resume is supported by the UB-0 instrument only'}
                >
                  CHECKPOINT
                </button>
              </div>
              <div className="status-line">
                <span className={`phase ${phase}`}>{phase.toUpperCase()}</span>
                {frame && (
                  <span>
                    {(100 * frame.progress).toFixed(1)} % · run {Math.min(frame.runIndex + 1, frame.runCount)}/{frame.runCount} · t = {fmt(frame.perf.time)} τ · {(frame.activeMs / 1000).toFixed(1)} s compute
                  </span>
                )}
              </div>
              <div className="progress">
                <div style={{ width: `${(100 * (frame?.progress ?? 0)).toFixed(1)}%` }} />
              </div>
              {message && <div className={message.kind === 'error' ? 'error' : message.kind === 'warn' ? 'warn' : 'info'}>{message.text}</div>}
              <div className="note" style={{ marginTop: 6 }}>
                LOAD builds the initial state; RESET rebuilds it from the same seeds (identical replay). Every started run is kept in the library, finished or not.
              </div>
            </div>
          )}
          {entry.locked && message && <div className={message.kind === 'error' ? 'error' : 'info'}>{message.text}</div>}
          <details className="section">
            <summary>Airfoil optimisation — locked (Phase 0 criteria)</summary>
            <AirfoilLock statuses={engineStatuses} />
          </details>
        </div>

        <div className="column center">
          <div className="view-toolbar">
            <span>field</span>
            <select value={field} onChange={(e) => setField(e.target.value as FieldKind)} aria-label="field">
              {FIELD_ORDER.map((k) => (
                <option key={k} value={k} title={k === 'none' ? '' : `${FIELD_INFO[k].definition} [${FIELD_INFO[k].units}]`}>
                  {k === 'none' ? 'none (particles)' : `${FIELD_INFO[k].label} ${FIELD_INFO[k].symbol}${FIELD_INFO[k].origin === 'derived' ? ' (derived)' : ''}`}
                </option>
              ))}
            </select>
            <span title="target particles per cell per snapshot; fewer means noisier cells">particles/cell</span>
            <input type="number" min={1} max={1000} value={perCell} style={{ width: 52 }} onChange={(e) => setPerCell(Math.max(1, Number(e.target.value) || 25))} />
            <label className="field-inline" title="accumulate the field over frames (temporal averaging); off = instantaneous">
              <input type="checkbox" checked={average} onChange={(e) => setAverage(e.target.checked)} />
              time-average
            </label>
            <button className="ctl" onClick={() => send({ type: 'resetAverage' })} title="restart the field, profile and wall-transfer averages">
              reset avg
            </button>
            {(['particles', 'vectors', 'collisions', 'trails', 'colorBySpeed'] as const).map((k) => (
              <label key={k} className="field-inline">
                <input type="checkbox" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />
                {k === 'colorBySpeed' ? 'speed colour' : k}
              </label>
            ))}
            <label className="field-inline">
              <input type="checkbox" checked={showPerf} onChange={(e) => setShowPerf(e.target.checked)} />
              perf
            </label>
            <button className="ctl" onClick={() => setCamera(null)} disabled={!camera} title="zoom to fit (or double-click the view)">
              fit {camera ? `(${camera.zoom.toFixed(1)}×)` : ''}
            </button>
            <button className="ctl" disabled={!frame} onClick={exportViewPNG}>
              PNG
            </button>
            <button className="ctl" disabled={!f || f.kind === 'none'} onClick={exportFieldCSV}>
              FIELD CSV
            </button>
          </div>
          <div className="view-wrap">
            <ParticleView
              frame={frame}
              options={options}
              selected={selected}
              camera={camera}
              onCamera={setCamera}
              canvasRef={canvasRef}
              onPick={(i) => {
                setSelected(i);
                send({ type: 'inspect', index: i });
              }}
            />
            {showPerf && <PerfOverlay frame={frame} fps={fps} renderMs={renderMs.current} />}
            {f && info && scale && (
              <div className="legend" title={info.definition}>
                <div>
                  <b>
                    {info.symbol}
                  </b>{' '}
                  [{info.units}] <span className={`tag ${info.origin}`}>{info.origin.toUpperCase()}</span> · {temporalLabel(f.snapshots, f.t0, f.t1)} · {f.nx}×{f.ny} cells, {f.particlesPerCell.toFixed(1)}/cell
                </div>
                {f.note && <div>{f.note}</div>}
                {f.particlesPerCell * f.snapshots < NOISE_SAMPLES && <div style={{ color: 'var(--inconclusive)' }}>fewer than {NOISE_SAMPLES} samples per cell: noise-dominated</div>}
                <div className="legend-scale">
                  <span>{fmt(scale.lo, 3)}</span>
                  <div className="bar" style={{ background: scale.css }} />
                  <span>{fmt(scale.hi, 3)}</span>
                  <span className="muted">
                    min {fmt(f.min, 3)} · mean {fmt(f.mean, 3)} · max {fmt(f.max, 3)}
                    {scale.diverging ? ' · centred on 0' : ''}
                  </span>
                </div>
              </div>
            )}
            {!frame && (
              <div className="empty-view">
                {entry.locked ? 'Universe B is locked: nothing is simulated.' : 'Choose an experiment and a configuration, then press LOAD and RUN.'}
                <br />
                Wheel to zoom · drag to pan · double-click to fit · click a particle to inspect it
              </div>
            )}
          </div>
          <AnalysisPanel frame={frame} particles={frame?.count ?? 0} provenance={runInfo?.provenance ?? null} profile={profile} onProfile={setProfile} onResetWindow={() => send({ type: 'resetAverage' })} />
        </div>

        <div className="column">
          <div className="tabs">
            {(
              [
                ['live', 'Live'],
                ['results', 'Results'],
                ['library', `Library (${entries.length})`],
                ['compare', 'Compare'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'live' && (
            <>
              <div className="section">
                <h2>Live measurement</h2>
                <LiveMetrics frame={frame} />
                <div className="note">Window values from the running experiment; the record&apos;s estimates use block averaging and seed ensembles. Time series: see the panel below the view.</div>
              </div>
              <div className="section">
                <h2>Particle inspector</h2>
                <Inspector data={frame?.inspected ?? null} />
              </div>
            </>
          )}
          {tab === 'results' && (
            <div className="section">
              <ResultsPanel record={record} entry={viewEntry} />
            </div>
          )}
          {tab === 'library' && lib && (
            <div className="section">
              <LibraryPanel store={lib.store} entries={entries} persistent={lib.persistent} activeId={viewEntry?.id ?? null} onOpen={openEntry} onImport={importFiles} onChanged={refresh} />
            </div>
          )}
          {tab === 'compare' && lib && (
            <div className="section">
              <ComparePanel store={lib.store} entries={entries} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
