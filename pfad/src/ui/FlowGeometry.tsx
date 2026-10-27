import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { recordJSON, safeName } from '../app/exporters';
import type { LibraryEntry, LibraryStore } from '../app/library';
import { openLibrary } from '../app/libraryIdb';
import { openProjects, type ProjectStore } from '../app/projectStore';
import { reservedSeedErrors } from '../app/seeds';
import { CODE_VERSION, makeProvenance } from '../app/provenance';
import { PFAD_MODEL_VERSION } from '../core/version';
import type { ExperimentRecord } from '../experiments/Experiment';
import { FLOW_GEOMETRY_EXTENDED, FLOW_GEOMETRY_QUICK, placementFor, type FlowGeometryParams, type FlowGeometryResults } from '../experiments/FlowGeometryExperiment';
import { basisFromAnalysis } from '../geometry/Basis';
import type { FieldGrid } from '../geometry/Compare';
import { DEFAULT_CONSTRUCTION, newProposalId, proposeIncrement, type ConstructionConfig, type EvidenceMode, type Proposal } from '../geometry/Construction';
import { parseReferenceOutline, projectSVG, surfaceCSV } from '../geometry/Export';
import {
  acceptProposal,
  addReference,
  attachRun,
  changeConditions,
  headVersion,
  logRunEnd,
  newProject,
  parseProject,
  projectToJSON,
  recordProposal,
  rejectProposal,
  replayFrames,
  undo,
  version,
  type Project,
} from '../geometry/History';
import { runSummaryFromRecord } from '../geometry/RunSummary';
import { flatPlate, type Side } from '../geometry/SurfaceGeometry';
import { fieldScale } from './colors';
import { downloadText } from './download';
import { DetectorPanel, LevelBadge, ProfilePanel, StationPlots } from './flow/DetectorPanel';
import { ConstructionPanel } from './flow/ConstructionPanel';
import { FlowComparePanel } from './flow/ComparePanel';
import { FieldMap } from './flow/FieldMap';
import { HistoryPanel } from './flow/HistoryPanel';
import { drawStream, makeOverlay } from './flow/overlay';
import { useSimulation } from './flow/useSimulation';
import { fmt } from './Panels';
import { ParticleView, type Camera, type ViewOptions } from './ParticleView';

type Conditions = Omit<FlowGeometryParams, 'geometry'>;
type FieldChoice = 'none' | 'speed' | 'ux' | 'uy' | 'density' | 'kT';

const FIELD_NOTE: Record<Exclude<FieldChoice, 'none'>, { label: string; units: string }> = {
  speed: { label: 'mean velocity magnitude |u| (derived from u_x, u_y)', units: 'd/τ' },
  ux: { label: 'mean velocity u_x', units: 'd/τ' },
  uy: { label: 'mean velocity u_y', units: 'd/τ' },
  density: { label: 'mass density ρ', units: 'm/d²' },
  kT: { label: 'temperature kT (peculiar kinetic energy per particle)', units: 'kT₀' },
};

interface Setup {
  name: string;
  preset: 'quick' | 'extended';
  chord: number;
  thickness: number;
}
const DEFAULT_SETUP: Setup = { name: 'Flat plate study', preset: 'quick', chord: 30, thickness: 3 };

function conditionsFor(s: Setup): Conditions {
  const base = s.preset === 'quick' ? FLOW_GEOMETRY_QUICK : FLOW_GEOMETRY_EXTENDED;
  const { geometry, ...c } = base;
  void geometry;
  // the domain scales with the chord as in the Kutta rig (6 chords × 3.33 chords)
  return { ...c, length: Math.round(6 * s.chord), height: Math.round((10 * s.chord) / 3) };
}

function makeProject(s: Setup): Project {
  return newProject(s.name || 'Flat plate study', conditionsFor(s) as unknown as Record<string, unknown>, flatPlate(s.chord, s.thickness));
}

interface Draft {
  alphaDeg: string;
  areaFraction: string;
  speed: string;
  seeds: string;
  startup: string;
  measure: string;
  blocks: string;
}
const draftOf = (c: Record<string, unknown>): Draft => ({
  alphaDeg: String(c.alphaDeg),
  areaFraction: String(c.areaFraction),
  speed: String(c.speed),
  seeds: (c.seeds as number[]).join(','),
  startup: String(c.startup),
  measure: String(c.measure),
  blocks: String(c.blocks),
});

/** Validate the editable conditions and return the new conditions object (or the errors). */
function readDraft(d: Draft, base: Conditions): { ok: true; cond: Conditions; warnings: string[] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const num = (name: string, v: string, lo: number, hi: number, integer = false) => {
    const x = Number(v);
    if (!Number.isFinite(x) || v.trim() === '') errors.push(`${name}: not a number`);
    else if (x < lo || x > hi) errors.push(`${name} must lie in [${lo}, ${hi}]`);
    else if (integer && !Number.isInteger(x)) errors.push(`${name} must be an integer`);
    return x;
  };
  const alphaDeg = num('angle of attack', d.alphaDeg, 0, 89);
  const areaFraction = num('area fraction φ', d.areaFraction, 0.02, 0.3);
  const speed = num('stream speed', d.speed, 0.1, 3);
  const startup = num('start-up time', d.startup, 20, 2000);
  const measure = num('measurement window', d.measure, 40, 5000);
  const blocks = num('time blocks', d.blocks, 4, 64, true);
  const seeds = d.seeds
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (!seeds.length || seeds.some((s) => !Number.isInteger(s) || s < 1 || s > 2 ** 31 - 1)) errors.push('seeds: distinct positive integers, separated by commas');
  if (new Set(seeds).size !== seeds.length) errors.push('seeds must be distinct (independent samples)');
  errors.push(...reservedSeedErrors(seeds));
  if (seeds.length < 3 && seeds.length > 0) warnings.push('fewer than 3 seeds: the detector can never reach CONFIRMED (it needs seed agreement)');
  const N = (areaFraction * base.length * base.height) / (Math.PI * base.radius * base.radius);
  if (N > 8000) warnings.push(`about ${Math.round(N)} particles: a run will be slow in the browser`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, cond: { ...base, alphaDeg, areaFraction, speed, startup, measure, blocks, seeds }, warnings };
}

const entryId = (recordId: string) => `fg-${recordId}`;

/** A view centred on the body, about two chords tall, instead of the whole open-boundary domain. */
function bodyCamera(c: Conditions, chord: number): Camera {
  return { zoom: Math.max(1, Math.min(c.length, c.height) / (chord * 1.9)), cx: c.length / 3, cy: c.height / 2 };
}

export function FlowGeometry() {
  const [lib, setLib] = useState<{ store: LibraryStore; persistent: boolean } | null>(null);
  const [projs, setProjs] = useState<{ store: ProjectStore; persistent: boolean } | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string; createdAt: string; versions: number; head: string }[]>([]);
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [project, setProject] = useState<Project>(() => makeProject(DEFAULT_SETUP));
  const [draft, setDraft] = useState<Draft>(() => draftOf(project.conditions));
  const [draftReason, setDraftReason] = useState('');
  const [side, setSide] = useState<Side>('upper');
  const [mode, setMode] = useState<EvidenceMode>('detector');
  const [cfg, setCfg] = useState<ConstructionConfig>(DEFAULT_CONSTRUCTION);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pointIdx, setPointIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [viewId, setViewId] = useState('v0');
  const [selX, setSelX] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<'detector' | 'compare' | 'history'>('detector');
  const [bottomTab, setBottomTab] = useState<'stations' | 'profile' | 'mean'>('stations');
  const [cmp, setCmp] = useState<[string, string]>(['v0', 'v0']);
  const [replayIdx, setReplayIdx] = useState<number | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [fieldKind, setFieldKind] = useState<FieldChoice>('none');
  const [overlayParent, setOverlayParent] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [withRecords, setWithRecords] = useState(true);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [options, setOptions] = useState<ViewOptions>({ particles: true, vectors: false, collisions: false, trails: false, colorBySpeed: true });
  const [grids, setGrids] = useState<Record<string, FieldGrid | null>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const records = useRef(new Map<string, ExperimentRecord>());
  const runningVersion = useRef<string | null>(null);
  const libRef = useRef(lib);
  libRef.current = lib;
  const projectRef = useRef(project);
  projectRef.current = project;

  // ---- persistence
  useEffect(() => {
    let live = true;
    openLibrary().then((l) => live && setLib(l));
    openProjects().then(async (p) => {
      if (!live) return;
      setProjs(p);
      setSaved(await p.store.list());
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!projs) return;
    const t = setTimeout(() => {
      projs.store
        .put(project)
        .then(() => projs.store.list())
        .then(setSaved)
        .catch((e) => setMessage(`Could not save the project: ${(e as Error).message}. Export it to keep it.`));
    }, 400);
    return () => clearTimeout(t);
  }, [project, projs]);

  // ---- simulation
  const onRecord = useCallback((record: ExperimentRecord, activeMs: number) => {
    const v = runningVersion.current;
    runningVersion.current = null;
    if (!v) return;
    records.current.set(record.experimentId, record);
    try {
      const summary = runSummaryFromRecord(record, { codeVersion: CODE_VERSION, activeMs });
      setProject((p) => attachRun(p, v, summary));
      setViewId(v);
      setMessage(`Simulation of ${v} finished (record ${record.experimentId}).`);
    } catch (e) {
      setMessage(`Cannot summarise the run: ${(e as Error).message}`);
    }
    const l = libRef.current;
    if (l) {
      const p = record.config as FlowGeometryParams;
      const entry: LibraryEntry = {
        id: entryId(record.experimentId),
        title: `Flow-guided geometry — ${projectRef.current.name} ${v}`,
        experimentType: 'flow-geometry',
        catalogKey: 'flow-geometry',
        universe: 'A',
        seeds: record.seeds,
        createdAt: record.timestamp,
        outcome: 'completed',
        runtimeMs: activeMs,
        status: record.status,
        hasRecord: true,
        config: p,
        provenance: makeProvenance({ experimentType: 'flow-geometry', universe: 'A', preset: `flow-guided project ${projectRef.current.id}, version ${v}`, seeds: record.seeds, createdAt: record.timestamp }),
        summary: { particles: record.particleCount },
      };
      l.store.put(entry, { record }).catch(() => setMessage('The run record could not be stored in the library (storage full?). Export the project with its records to keep it.'));
    }
  }, []);
  const onEnd = useCallback((kind: 'stopped' | 'failed', text: string) => {
    const v = runningVersion.current;
    runningVersion.current = null;
    if (v) setProject((p) => logRunEnd(p, v, kind, text));
    setMessage(`${kind === 'stopped' ? 'Stopped' : 'Failed'}: ${text}`);
  }, []);
  const sim = useSimulation(onRecord, onEnd);

  const head = headVersion(project);
  const viewed = project.versions.some((v) => v.id === viewId) ? version(project, viewId) : head;
  const parent = viewed.parent ? version(project, viewed.parent) : null;
  const wantKey = `${project.id}|${head.id}|${JSON.stringify(project.conditions)}`;
  const [loadedKey, setLoadedKey] = useState('');
  const paramsOf = useCallback((v: typeof head): FlowGeometryParams => ({ ...(project.conditions as unknown as Conditions), geometry: v.geometry }), [project.conditions]);
  const loadHead = useCallback(() => {
    sim.load('flow-geometry', paramsOf(head));
    sim.view('none', 25, true);
    setLoadedKey(wantKey);
    setCamera(bodyCamera(project.conditions as unknown as Conditions, head.geometry.chord));
  }, [sim, paramsOf, head, wantKey, project.conditions]);
  useEffect(() => {
    if (sim.phase !== 'running' && sim.phase !== 'paused' && loadedKey !== wantKey) loadHead();
  }, [wantKey, loadedKey, sim.phase, loadHead]);

  const busy = sim.phase === 'running' || sim.phase === 'paused';
  const run = () => {
    const c = readDraft(draft, project.conditions as unknown as Conditions);
    if (c.ok && JSON.stringify(c.cond) !== JSON.stringify(project.conditions)) {
      setMessage('The conditions form has unapplied changes: apply them (they are recorded) or reset the form before simulating.');
      return;
    }
    if (loadedKey !== wantKey || sim.phase === 'finished' || sim.phase === 'stopped' || sim.phase === 'failed' || sim.phase === 'idle') {
      sim.load('flow-geometry', paramsOf(head));
      sim.view('none', 25, true);
      setLoadedKey(wantKey);
    }
    runningVersion.current = head.id;
    setMessage(head.run ? `Re-simulating ${head.id}: the new run replaces its stored summary (the earlier record stays in the library and the log).` : null);
    sim.run();
  };

  // ---- measured data for the viewed version
  const getGrid = useCallback(
    async (recordId: string): Promise<FieldGrid | null> => {
      const r = records.current.get(recordId) ?? ((await libRef.current?.store.payload(entryId(recordId)))?.record as ExperimentRecord | undefined);
      if (!r) return null;
      records.current.set(recordId, r);
      const f = (r.results as unknown as FlowGeometryResults).fields;
      return f ? { nx: f.nx, ny: f.ny, cell: f.cell, ux: f.ux, uy: f.uy, density: f.density, kT: f.kT, occupancy: f.occupancy } : null;
    },
    [],
  );
  useEffect(() => {
    const id = viewed.run?.recordId;
    if (!id || id in grids) return;
    getGrid(id).then((g) => setGrids((s) => ({ ...s, [id]: g })));
  }, [viewed.run?.recordId, grids, getGrid, lib]);
  const grid = viewed.run ? grids[viewed.run.recordId] ?? null : null;
  const analyses = viewed.run?.analysis ?? null;
  const analysis = analyses?.[side] ?? null;
  const parentAnalysis = overlayParent && parent?.run ? parent.run.analysis[side] : null;
  const win = viewed.run ? { t0: (viewed.run.conditions.startup as number) ?? 0, t1: ((viewed.run.conditions.startup as number) ?? 0) + ((viewed.run.conditions.measure as number) ?? 0) } : null;
  useEffect(() => {
    if (analysis && (selX === null || !analysis.primary.stations.some((s) => Math.abs(s.x - selX) < 1e-6))) setSelX(analysis.region ? analysis.primary.stations[analysis.region.first].x : (analysis.primary.exploratory ? analysis.primary.stations[analysis.primary.exploratory.first].x : analysis.primary.stations[Math.floor(analysis.primary.stations.length / 2)].x));
  }, [analysis, selX]);

  // ---- construction
  const propose = () => {
    setMessage(null);
    const r0 = head.run;
    if (!r0) return setMessage('Cannot propose: simulate the current geometry first.');
    const b = basisFromAnalysis(r0.analysis[side], mode, { recordId: r0.recordId, versionId: head.id });
    if (!b.ok) return setMessage(`No proposal: ${b.reason}`);
    const c = mode === 'exploratory' ? { ...cfg, shrink: 0 } : cfg;
    const id = newProposalId(head.id, project.proposals.length + 1);
    const r = proposeIncrement(head.geometry, b.basis, c, id);
    if (!r.ok) return setMessage(`No proposal: ${r.reason}`);
    setProject(recordProposal(project, r.proposal));
    setProposal(r.proposal);
    setPointIdx(-1);
    setPlaying(false);
    setViewId(head.id);
  };
  const accept = (all: boolean) => {
    if (!proposal) return;
    try {
      const { project: np, version: v } = acceptProposal(project, proposal.id, all ? undefined : pointIdx);
      setProject(np);
      setProposal(null);
      setPointIdx(-1);
      setPlaying(false);
      setViewId(v.id);
      setCmp([v.parent!, v.id]);
      setMessage(`Accepted as ${v.id} (${v.construction!.acceptedPoints} of ${v.construction!.totalPoints} points). It has not been simulated: run it to see what the new surface does.`);
    } catch (e) {
      setMessage(`Cannot accept: ${(e as Error).message}`);
    }
  };
  const reject = () => {
    if (!proposal) return;
    const note = window.prompt('Why reject this increment? (optional; kept in the history)');
    if (note === null) return;
    setProject(rejectProposal(project, proposal.id, note));
    setProposal(null);
    setPointIdx(-1);
    setPlaying(false);
    setMessage('Rejected: the geometry is unchanged and the proposal stays in the history.');
  };
  const doUndo = () => {
    try {
      const np = undo(project);
      setProject(np);
      setProposal(null);
      setViewId(np.head);
      setMessage(`Undone: the head is ${np.head} again. The undone version stays in the history.`);
    } catch (e) {
      setMessage(`Cannot undo: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    if (!playing || !proposal) return;
    const t = setInterval(() => {
      setPointIdx((i) => {
        if (i >= proposal.points.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 320);
    return () => clearInterval(t);
  }, [playing, proposal]);

  // ---- replay
  const frames = useMemo(() => replayFrames(project), [project]);
  useEffect(() => {
    if (!replaying) return;
    const t = setInterval(() => {
      setReplayIdx((i) => {
        if (i === null) return i;
        if (i >= frames.length - 1) {
          setReplaying(false);
          return i;
        }
        return i + 1;
      });
    }, 220);
    return () => clearInterval(t);
  }, [replaying, frames.length]);

  // ---- conditions and projects
  const applyConditions = () => {
    const c = readDraft(draft, project.conditions as unknown as Conditions);
    if (!c.ok) return setMessage(`Conditions: ${c.errors.join('; ')}`);
    if (JSON.stringify(c.cond) === JSON.stringify(project.conditions)) return setMessage('The conditions are unchanged.');
    const hasRuns = project.versions.some((v) => v.run);
    if (hasRuns && !window.confirm('Changing the flow conditions after a version was simulated makes later comparisons not like for like. The change is recorded in the history. Continue?')) return;
    setProject(changeConditions(project, c.cond as unknown as Record<string, unknown>, draftReason));
    setDraftReason('');
    setMessage(c.warnings.length ? `Conditions applied. Note: ${c.warnings.join('; ')}` : 'Conditions applied and recorded.');
  };
  const newProjectFromSetup = () => {
    if (project.versions.length > 1 || project.versions.some((v) => v.run)) {
      if (!window.confirm(`Start a new project? “${project.name}” stays in the saved projects of this browser.`)) return;
    }
    const p = makeProject(setup);
    setProject(p);
    setDraft(draftOf(p.conditions));
    setProposal(null);
    setPointIdx(-1);
    setViewId('v0');
    setCmp(['v0', 'v0']);
    setSelX(null);
    setMessage(null);
    setReplayIdx(null);
    records.current.clear();
    setGrids({});
  };
  const openProject = (p: Project, recs: Record<string, unknown> = {}) => {
    sim.unload();
    setProject(p);
    setDraft(draftOf(p.conditions));
    setProposal(null);
    setPointIdx(-1);
    setViewId(p.head);
    setCmp([p.versions.find((v) => v.id === p.head)?.parent ?? p.head, p.head]);
    setSelX(null);
    setReplayIdx(null);
    setGrids({});
    for (const [id, r] of Object.entries(recs)) {
      records.current.set(id, r as ExperimentRecord);
      libRef.current?.store.put(
        {
          id: entryId(id),
          title: `Flow-guided geometry — imported record ${id}`,
          experimentType: 'flow-geometry',
          catalogKey: 'flow-geometry',
          universe: 'A',
          seeds: (r as ExperimentRecord).seeds,
          createdAt: (r as ExperimentRecord).timestamp,
          outcome: 'imported',
          runtimeMs: null,
          status: (r as ExperimentRecord).status,
          hasRecord: true,
          config: (r as ExperimentRecord).config,
          provenance: makeProvenance({ experimentType: 'flow-geometry', universe: 'A', preset: 'imported with a project', seeds: (r as ExperimentRecord).seeds }),
        },
        { record: r as ExperimentRecord },
      );
    }
    setLoadedKey('');
  };

  // ---- exports
  const stem = safeName(`${project.name}-${viewed.id}`);
  const exportProject = (embed: boolean) => {
    const recs: Record<string, unknown> = {};
    if (embed) for (const v of project.versions) if (v.run) {
      const r = records.current.get(v.run.recordId);
      if (r) recs[v.run.recordId] = r;
    }
    downloadText(`${safeName(project.name)}-project.json`, projectToJSON(project, recs), 'application/json');
  };
  const exportSVG = () => downloadText(`${stem}.svg`, projectSVG(project, viewed.id), 'image/svg+xml');
  const exportCSV = () => downloadText(`${stem}-surface.csv`, surfaceCSV(viewed, { project: project.name, codeVersion: CODE_VERSION, modelVersion: PFAD_MODEL_VERSION }, placementFor({ ...(project.conditions as unknown as Conditions), geometry: viewed.geometry })), 'text/csv');
  const exportRecord = () => {
    const r = viewed.run ? records.current.get(viewed.run.recordId) : undefined;
    if (!r) return setMessage('The full record of this run is not in memory: open the saved project or re-simulate. (The project JSON holds the run summary.)');
    downloadText(`${safeName(r.experimentId)}.json`, recordJSON(r, makeProvenance({ experimentType: 'flow-geometry', universe: 'A', preset: `flow-guided project ${project.id}, ${viewed.id}`, seeds: r.seeds, createdAt: r.timestamp })), 'application/json');
  };
  const importProject = async (f: File) => {
    try {
      const { project: p, records: recs } = parseProject(await f.text());
      openProject(p, recs);
      setMessage(`Imported project “${p.name}” (${p.versions.length} versions).`);
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  };
  const importReference = async (f: File) => {
    try {
      const ref = parseReferenceOutline(await f.text(), f.name, head.geometry.chord, head.geometry.stations);
      setProject((p) => addReference(p, { name: f.name, source: f.name, importedAt: ref.importedAt, geometry: ref.geometry }));
      setMessage(`Reference outline “${f.name}” added: drawn dashed violet; it is not constructed by PFAD and never part of the construction.`);
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  };

  // ---- drawing
  const replayFrame = replayIdx !== null ? frames[Math.min(replayIdx, frames.length - 1)] : null;
  const overlay = useMemo(() => {
    const a = analysis;
    const region = a?.region ? { side, xLo: a.region.xLo, xHi: a.region.xHi, kind: a.region.kind } : a?.primary.exploratory && mode === 'exploratory' ? { side, xLo: a.primary.exploratory.xLo, xHi: a.primary.exploratory.xHi, kind: 'exploratory' as const } : null;
    const showDividing = a && a.primary.stations.some((s) => (mode === 'exploratory' ? s.hdsRaw : s.hds).state === 'closed' || (mode === 'exploratory' ? s.hdsRaw : s.hds).state === 'open');
    const st = {
      placement: placementFor({ ...(project.conditions as unknown as Conditions), geometry: head.geometry }),
      geometry: viewed.id === head.id ? head.geometry : viewed.geometry,
      previous: viewed.id === head.id && head.parent ? version(project, head.parent).geometry : null,
      proposal,
      pointIdx,
      region,
      dividing: showDividing && a ? { side, stations: a.primary.stations, exploratory: mode === 'exploratory' } : null,
      replay: replayFrame,
      viewed: viewed.id !== head.id ? viewed.geometry : null,
      showStations,
      alphaDeg: (project.conditions as unknown as Conditions).alphaDeg,
      references: project.references.map((r) => r.geometry),
    };
    const draw = makeOverlay(st);
    return (g: CanvasRenderingContext2D, T: Parameters<typeof draw>[1], frame: NonNullable<typeof sim.frame>) => {
      draw(g, T);
      drawStream(g, T, frame.domain, (project.conditions as unknown as Conditions).speed, st.alphaDeg);
    };
  }, [analysis, side, mode, project, head, viewed, proposal, pointIdx, replayFrame, showStations, sim.frame]);

  const underlay = useMemo(() => {
    if (fieldKind === 'none' || !grid) return undefined;
    const vals = (fieldKind === 'speed' ? grid.ux.map((u, i) => Math.hypot(u, grid.uy[i])) : grid[fieldKind]) as number[];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const sc = fieldScale(fieldKind === 'speed' ? 'speed' : fieldKind === 'ux' || fieldKind === 'uy' ? fieldKind : fieldKind, lo, hi);
    return (g: CanvasRenderingContext2D, T: { s: number; X: (x: number) => number; Y: (y: number) => number }, frame: NonNullable<typeof sim.frame>) => {
      const d = frame.domain;
      const cw = ((d.xmax - d.xmin) / grid.nx) * T.s;
      const ch = ((d.ymax - d.ymin) / grid.ny) * T.s;
      for (let cy = 0; cy < grid.ny; cy++) {
        for (let cx = 0; cx < grid.nx; cx++) {
          const [r, gg, b] = sc.color(vals[cy * grid.nx + cx]);
          g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
          g.fillRect(T.X(d.xmin) + cx * cw, T.Y(d.ymin) - (cy + 1) * ch, cw + 0.6, ch + 0.6);
        }
      }
    };
  }, [fieldKind, grid, sim.frame]);
  useEffect(() => setOptions((o) => ({ ...o, particles: fieldKind === 'none' })), [fieldKind]);

  const conds = project.conditions as unknown as Conditions;
  const dirty = (() => {
    const c = readDraft(draft, conds);
    return c.ok && JSON.stringify(c.cond) !== JSON.stringify(project.conditions);
  })();
  const draftCheck = readDraft(draft, conds);
  const canUndo = head.origin === 'constructed' && !proposal;
  const f = sim.frame;
  const stage = !head.run ? 'simulate the starting geometry' : proposal ? 'review the proposed increment' : head.origin === 'constructed' && !head.run ? 'simulate the new geometry' : 'propose an increment';

  return (
    <div className="lab flow">
      <header className="topbar">
        <div>
          <h1>FLOW-GUIDED GEOMETRY · EXPERIMENTAL</h1>
          <div className="meta">
            watch a surface develop from measured particle flow, one small step at a time · model {PFAD_MODEL_VERSION} · code {CODE_VERSION.slice(0, 12)} · model units (m = d = kT₀ = 1) · Universe A only (Universe B is locked)
          </div>
        </div>
        <span className="prediction-label">NOT AN OPTIMISER · NOT VALIDATED · DETECTOR EXPERIMENTAL</span>
      </header>
      <div className="main">
        <div className="column">
          <div className="section">
            <h2>1 · Project</h2>
            <div className="params">
              <label className="wide">
                name
                <input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} />
              </label>
              <label>
                chord [d]
                <input type="number" min={12} max={80} value={setup.chord} onChange={(e) => setSetup({ ...setup, chord: Number(e.target.value) })} />
              </label>
              <label>
                thickness [d]
                <input type="number" min={2} max={12} step={0.5} value={setup.thickness} onChange={(e) => setSetup({ ...setup, thickness: Number(e.target.value) })} />
              </label>
            </div>
            <div className="seg" style={{ margin: '6px 0' }}>
              {(['quick', 'extended'] as const).map((k) => (
                <button key={k} className={`ctl ${setup.preset === k ? 'on' : ''}`} onClick={() => setSetup({ ...setup, preset: k })} title={k === 'quick' ? '3 seeds, 240 τ window: about a minute or two per version, weak statistics' : '6 seeds, 480 τ window: several minutes per version, a candidate region needs this much'}>
                  {k === 'quick' ? 'QUICK (3 seeds)' : 'EXTENDED (6 seeds)'}
                </button>
              ))}
            </div>
            <button className="ctl" onClick={newProjectFromSetup}>
              NEW PROJECT (flat plate)
            </button>
            <div className="note" style={{ marginTop: 4 }}>
              Starts from a flat plate: {project.versions[0].geometry.chord} × {fmt(project.versions[0].geometry.upper[0] - project.versions[0].geometry.lower[0])} d, blunt ends. No airfoil profile is built in. Open project: <b>{project.name}</b> · {project.versions.length} version{project.versions.length === 1 ? '' : 's'}.
            </div>
          </div>

          <div className="section">
            <h2>2 · Flow conditions</h2>
            <div className="note" style={{ marginBottom: 4 }}>
              Held fixed across versions so runs are comparable. A change is recorded in the history.
            </div>
            <div className="params">
              {(
                [
                  ['alphaDeg', 'angle of attack [°]'],
                  ['areaFraction', 'area fraction φ'],
                  ['speed', 'stream speed [d/τ]'],
                  ['startup', 'start-up [τ]'],
                  ['measure', 'window [τ]'],
                  ['blocks', 'time blocks'],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  {label}
                  <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} disabled={busy} />
                </label>
              ))}
              <label className="wide">
                seeds (independent samples)
                <input value={draft.seeds} onChange={(e) => setDraft({ ...draft, seeds: e.target.value })} disabled={busy} />
              </label>
              <label className="wide">
                reason (optional, kept in the history)
                <input value={draftReason} onChange={(e) => setDraftReason(e.target.value)} disabled={busy} />
              </label>
            </div>
            {!draftCheck.ok && draftCheck.errors.map((e, i) => <div key={i} className="error">{e}</div>)}
            {draftCheck.ok && draftCheck.warnings.map((e, i) => <div key={i} className="warn">{e}</div>)}
            <button className="ctl" onClick={applyConditions} disabled={busy || !dirty || !draftCheck.ok}>
              APPLY CHANGES
            </button>
            <details className="effective">
              <summary>
                Effective conditions — domain {conds.length} × {conds.height} d, {Math.round((conds.areaFraction * conds.length * conds.height) / (Math.PI * conds.radius ** 2))} particles, diffuse faces, open boundaries
              </summary>
              <pre>{JSON.stringify({ ...conds, detector: conds.detector.id }, null, 1)}</pre>
            </details>
          </div>

          <div className="section run-section">
            <h2>3 · Simulate {head.id}</h2>
            <div className="controls">
              <button className="ctl primary" disabled={busy || !!proposal || !draftCheck.ok || dirty} onClick={run} title="run the current geometry with the project's seeds">
                SIMULATE
              </button>
              <button className="ctl" disabled={sim.phase !== 'running'} onClick={sim.pause}>
                PAUSE
              </button>
              <button className="ctl" disabled={sim.phase !== 'paused'} onClick={sim.run}>
                RESUME
              </button>
              <button className="ctl" disabled={!busy} onClick={sim.stop} title="end the run; no result is kept">
                STOP
              </button>
              <button className="ctl" disabled={sim.phase === 'running'} onClick={loadHead} title="rebuild the initial state">
                RESET
              </button>
            </div>
            <div className="status-line">
              <span className={`phase ${sim.phase}`}>{sim.phase.toUpperCase()}</span>
              {f && (
                <span>
                  {(100 * f.progress).toFixed(0)} % · {String(f.live.phase ?? '')} · run {Math.min(f.runIndex + 1, f.runCount)}/{f.runCount} (seed {String(project.conditions.seeds ? (project.conditions.seeds as number[])[Math.min(f.runIndex, f.runCount - 1)] : '')}) · {(f.activeMs / 1000).toFixed(0)} s
                </span>
              )}
            </div>
            <div className="progress">
              <div style={{ width: `${(100 * (f?.progress ?? 0)).toFixed(1)}%` }} />
            </div>
            {sim.error && <div className="error">{sim.error}</div>}
            {message && <div className={/^(Cannot|No proposal|Import failed|Conditions:)/.test(message) ? 'warn' : 'info'}>{message}</div>}
            <div className="note run-help">
              Next: <b>{stage}</b>. Each version is simulated with the same seeds and conditions.
            </div>
          </div>

          <div className="section">
            <h2>4 · Construction</h2>
            <ConstructionPanel
              head={head}
              side={side}
              onSide={setSide}
              mode={mode}
              onMode={setMode}
              cfg={cfg}
              onCfg={setCfg}
              analyses={head.run?.analysis ?? null}
              proposal={proposal}
              pointIdx={pointIdx}
              playing={playing}
              busy={busy}
              canUndo={canUndo}
              message={null}
              onPropose={propose}
              onAdvance={() => setPointIdx((i) => Math.min((proposal?.points.length ?? 1) - 1, i + 1))}
              onBack={() => setPointIdx((i) => Math.max(-1, i - 1))}
              onToEnd={() => setPointIdx((proposal?.points.length ?? 1) - 1)}
              onPlay={() => {
                if (!proposal) return;
                if (!playing && pointIdx >= proposal.points.length - 1) setPointIdx(-1);
                setPlaying(!playing);
              }}
              onAcceptUpTo={() => accept(false)}
              onAcceptAll={() => accept(true)}
              onReject={reject}
              onUndo={doUndo}
            />
          </div>
        </div>

        <div className="column center">
          <div className="view-toolbar">
            <span>measured mean field</span>
            <select value={fieldKind} onChange={(e) => setFieldKind(e.target.value as FieldChoice)} aria-label="measured mean field" title={`mean over the measurement window and the seeds of ${viewed.id}`}>
              <option value="none">none (particles)</option>
              {(Object.keys(FIELD_NOTE) as (keyof typeof FIELD_NOTE)[]).map((k) => (
                <option key={k} value={k} disabled={!grid}>
                  {FIELD_NOTE[k].label}
                </option>
              ))}
            </select>
            <label className="field-inline">
              <input type="checkbox" checked={options.particles} onChange={(e) => setOptions({ ...options, particles: e.target.checked })} />
              particles
            </label>
            <label className="field-inline">
              <input type="checkbox" checked={options.colorBySpeed} onChange={(e) => setOptions({ ...options, colorBySpeed: e.target.checked })} />
              speed colour
            </label>
            <label className="field-inline">
              <input type="checkbox" checked={showStations} onChange={(e) => setShowStations(e.target.checked)} />
              stations
            </label>
            <span className="zoom-buttons">
              <button className="ctl" onClick={() => setCamera((c) => ({ ...(c ?? { zoom: 1, cx: conds.length / 3, cy: conds.height / 2 }), zoom: Math.min(60, (c?.zoom ?? 1) * 1.6) }))} aria-label="zoom in">
                ＋
              </button>
              <button className="ctl" onClick={() => setCamera((c) => (c && c.zoom / 1.6 > 1.05 ? { ...c, zoom: c.zoom / 1.6 } : null))} aria-label="zoom out">
                －
              </button>
              <button className="ctl" onClick={() => setCamera(bodyCamera(conds, head.geometry.chord))} title="zoom to the body">
                BODY
              </button>
              <button className="ctl" onClick={() => setCamera(null)} disabled={!camera}>
                FIT
              </button>
            </span>
          </div>
          {(viewed.id !== head.id || replayFrame) && (
            <div className="exp-banner">
              {replayFrame ? `REPLAY — ${replayFrame.label}. A view of the construction history, not a simulation.` : `Viewing the measurements of ${viewed.id}; the simulated body is ${head.id} (head). Select the head in History to return.`}
            </div>
          )}
          <div className="view-wrap">
            <ParticleView frame={f} options={options} selected={null} onPick={() => undefined} camera={camera} onCamera={setCamera} canvasRef={canvasRef} overlay={overlay} underlay={underlay} />
            {!f && <div className="empty-view">Building the starting state…</div>}
            <div className="legend" style={{ maxWidth: 'min(640px, 80%)' }}>
              <div>
                <b>{head.id}</b> {head.label} · α = {conds.alphaDeg}° · {f?.count ?? 0} particles · t = {f ? fmt(f.perf.time) : '—'} τ · energy error {f ? fmt(f.perf.energyError, 2) : '—'}
              </div>
              {fieldKind !== 'none' && grid && (
                <div>
                  <span className="tag measured">MEASURED</span> {FIELD_NOTE[fieldKind].label} [{FIELD_NOTE[fieldKind].units}] — mean of {viewed.run!.seeds.length} seeds over t = {win?.t0} … {win?.t1} τ of {viewed.id}, cell {grid.cell} d
                </div>
              )}
              <div className="muted">
                <span style={{ color: '#f85149' }}>■</span> backflow region · <span style={{ color: '#d29922' }}>■</span> slow / exploratory stretch · <span style={{ color: '#39c5cf' }}>┄</span> dividing streamline · <span style={{ color: '#f0b429' }}>■</span> proposed surface ·{' '}
                <span style={{ color: '#ff4d4d' }}>●</span> construction point
              </div>
            </div>
          </div>
          <div className="analysis" style={{ height: 'auto', minHeight: 300 }}>
            <div className="tabs small">
              {(
                [
                  ['stations', 'Along the surface'],
                  ['profile', 'Near-wall profile'],
                  ['mean', 'Measured mean fields'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={`tab ${bottomTab === k ? 'on' : ''}`} onClick={() => setBottomTab(k)}>
                  {label}
                </button>
              ))}
              <span style={{ flex: 1 }} />
              <span className="note" style={{ alignSelf: 'center' }}>
                side:
              </span>
              {(['upper', 'lower'] as const).map((s) => (
                <button key={s} className={`tab ${side === s ? 'on' : ''}`} onClick={() => setSide(s)} disabled={!!proposal}>
                  {s}
                </button>
              ))}
              {parent?.run && (
                <label className="field-inline note" style={{ marginLeft: 8 }}>
                  <input type="checkbox" checked={overlayParent} onChange={(e) => setOverlayParent(e.target.checked)} /> overlay {parent.id}
                </label>
              )}
            </div>
            {!viewed.run && <div className="note">{viewed.id} has not been simulated: press SIMULATE to measure its near-wall flow. Until then there are no measurements, and none are drawn.</div>}
            {viewed.run && bottomTab === 'stations' && <StationPlots analysis={analysis} other={parentAnalysis} otherLabel={parent ? `${parent.id} (parent)` : undefined} selectedX={selX} onSelectX={setSelX} />}
            {viewed.run && bottomTab === 'profile' && <ProfilePanel analysis={analysis} selectedX={selX} />}
            {viewed.run && bottomTab === 'mean' && (
              <div>
                {grid ? (
                  <div className="plot-grid">
                    {(['ux', 'uy', 'density', 'kT'] as const).map((k) => (
                      <FieldMap key={k} values={grid[k]} nx={grid.nx} ny={grid.ny} kind={k === 'density' ? 'density' : k === 'kT' ? 'kT' : k} label={FIELD_NOTE[k].label} units={FIELD_NOTE[k].units} width={300} />
                    ))}
                  </div>
                ) : (
                  <div className="note">The cell fields of this run are not in memory or the library (open the project with its records, or re-simulate).</div>
                )}
                <div className="note">
                  <span className="tag measured">MEASURED</span> seed-averaged means over the measurement window, {grid ? `${grid.nx}×${grid.ny} cells of ${grid.cell} d` : ''}; cells inside the body hold no particles. Momentum and energy residuals of the run:{' '}
                  {viewed.run ? `${Number(viewed.run.integrity.maxMomentumResidual).toExponential(1)} / ${Number(viewed.run.integrity.maxEnergyResidual).toExponential(1)}` : ''}.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="column">
          <div className="tabs">
            {(
              [
                ['detector', 'Measurements'],
                ['compare', 'Comparison'],
                ['history', 'History'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`tab ${rightTab === k ? 'on' : ''}`} onClick={() => setRightTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'detector' && (
            <div className="section">
              <h2>
                near-wall measurements of {viewed.id} {viewed.run && <LevelBadge level={analysis?.level ?? 'NONE'} />}
              </h2>
              <DetectorPanel analysis={analysis} window={win} onSelectX={(x) => (setSelX(x), setBottomTab('profile'))} selectedX={selX} />
              {viewed.run && (
                <div className="kv" style={{ marginTop: 8 }}>
                  <div className="row">
                    <span className="k">force on the body, lab x</span>
                    <span>
                      {fmt(viewed.run.forces.fx.mean, 4)} ± {fmt(viewed.run.forces.fx.se, 2)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">force on the body, lab y</span>
                    <span>
                      {fmt(viewed.run.forces.fy.mean, 4)} ± {fmt(viewed.run.forces.fy.se, 2)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">integrity</span>
                    <span>
                      {viewed.run.integrity.status} (E {Number(viewed.run.integrity.maxEnergyResidual).toExponential(1)}, p {Number(viewed.run.integrity.maxMomentumResidual).toExponential(1)})
                    </span>
                  </div>
                  <div className="note">
                    Forces are the measured impulse rate delivered to the body (<span className="tag measured">MEASURED</span>, momentum transfer), not coefficients. No lift, drag or efficiency figure is computed or optimised, because this model has not yet shown which of them it measures reliably.
                  </div>
                </div>
              )}
            </div>
          )}
          {rightTab === 'compare' && (
            <div className="section">
              <h2>comparison</h2>
              <FlowComparePanel project={project} a={cmp[0]} b={cmp[1]} onChange={(a, b) => setCmp([a, b])} getFields={getGrid} side={side} />
            </div>
          )}
          {rightTab === 'history' && (
            <div className="section">
              <h2>history</h2>
              <HistoryPanel
                project={project}
                viewId={viewed.id}
                onView={(id) => {
                  setViewId(id);
                  setReplayIdx(null);
                }}
                onCompare={(a, b) => {
                  setCmp([a, b]);
                  setRightTab('compare');
                }}
                replayFrames={frames}
                replayIdx={replayIdx}
                replaying={replaying}
                onReplayStart={() => {
                  setReplayIdx(0);
                  setReplaying(true);
                  setViewId(head.id);
                }}
                onReplayToggle={() => {
                  if (!replaying && replayIdx !== null && replayIdx >= frames.length - 1) setReplayIdx(0);
                  setReplaying(!replaying);
                }}
                onReplaySeek={(i) => {
                  setReplaying(false);
                  setReplayIdx(i);
                }}
                onReplayStop={() => {
                  setReplaying(false);
                  setReplayIdx(null);
                }}
                saved={saved}
                persistent={projs?.persistent ?? false}
                onOpenSaved={async (id) => {
                  const p = await projs?.store.get(id);
                  if (p) openProject(p);
                }}
                onDeleteSaved={async (id) => {
                  await projs?.store.remove(id);
                  setSaved(await (projs?.store.list() ?? Promise.resolve([])));
                }}
                onExportProject={exportProject}
                onExportSVG={exportSVG}
                onExportCSV={exportCSV}
                onExportRecord={exportRecord}
                onImportProject={importProject}
                onImportReference={importReference}
                withRecords={withRecords}
                onWithRecords={setWithRecords}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
