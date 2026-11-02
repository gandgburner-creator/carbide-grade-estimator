import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeName } from '../app/exporters';
import { openCfdProjects, type CfdProjectStore } from '../app/cfdProjectStore';
import { CODE_VERSION } from '../app/provenance';
import { CFD_FIELD_LABEL, fieldFromResult, streamField } from '../cfd/CfdFields';
import { DEFAULT_CFD_FILL, type CfdFillResult } from '../cfd/CfdFill';
import { cfdForceMeasure } from '../cfd/CfdForces';
import { addCfdFillVersion, addCfdPointerMove, attachCfdRun, cfdHead, cfdProjectToJSON, cfdVersion, logCfdEnd, newCfdLibraryProject, newCfdProject, parseCfdProject, setCfdWingDepth, undoCfd, type CfdLibraryBody, type CfdPreset, type CfdProject, type CfdVersion } from '../cfd/CfdProject';
import { CFD_BASE, CFD_PRESETS, GPU_PRESETS, cfdPlacement, type CfdParams, type CfdResult } from '../cfd/CfdRun';
import { CFD_PLATE_LENGTH, cfdSetup } from '../experiments/CfdScenario';
import type { PhysicalInputs } from '../experiments/FlowGeometryExperiment';
import { DEFAULT_DEPTH_CM, DEFAULT_SCENARIO, newtonsAndKgf, parseDepth, wingForces } from '../experiments/PhysicalScenario';
import { DEFAULT_FLUID_TEXTS, fluidTextsOf, parseCfdInputs, type FluidTexts } from '../experiments/FluidScenario';
import { anchorOf, camberShift, DEFAULT_POINTER_STEP, initialPaths, pointerOf, radiusOf, type PointerStepConfig } from '../geometry/Pointer';
import { measuredCfdStep } from '../geometry/PointerMeasure';
import { bodyPolygon, place, unplace, type Side } from '../geometry/SurfaceGeometry';
import { insidePolygon, smoothField, traceStreamlines, type Streamline } from '../measurements/Streamlines';
import type { CfdViewKind } from '../workers/cfdProtocol';
import { downloadText } from './download';
import { CfdFillPanel, type CfdFillSettings } from './flow/CfdFillPanel';
import { CfdView } from './flow/CfdView';
import type { GridField } from '../measurements/Streamlines';
import { CfdCompare, CfdHistory, CfdMeasurements, CfdScenarioPanel } from './flow/CfdPanels';
import { makeOverlay } from './flow/overlay';
import { addCamberPoint, camberControlsOf, camberTextsOf, dragCamberPoint, readCamberInput, type CamberTexts } from '../geometry/CamberInput';
import { CAMBER_LIMITS } from '../geometry/Camber';
import { defaultPointerTexts, dotsFromTexts, dragToTexts, EMPTY_POINTER_TEXTS, readPointerInput, type PointerTexts } from '../geometry/PointerInput';
import { EMPTY_SWEEP, PointerPanel, type PointerSweep } from './flow/PointerPanel';
import { scenarioText, type ScenarioText } from './flow/ScenarioPanel';
import { GpuPanel, type Engine } from './flow/GpuPanel';
import { AirfoilPanel, AirfoilStudy } from './reference/AirfoilPanel';
import { AIRFOIL_PRESETS, airfoilBody, type AirfoilBody, type AirfoilProfile } from '../reference/Airfoils';
import { jobsFor, parseAngles, resolutionAdvice, rowOf, type StudyJob, type StudyRow } from '../reference/Study';
import { PAD_OFF, type PadFrame, type PadSettings, type PadStyle } from './flow/DrawingPad';
import { probeGpu, type GpuInfo } from '../cfd/gpu/LbmGpu';
import { StationChart } from './flow/StationChart';
import { useCfd } from './flow/useCfd';
import type { Camera, ViewHandle } from './ParticleView';
import { fmt } from './Panels';

const KINDS: CfdViewKind[] = ['speed', 'vorticity', 'pressure', 'total', 'ux', 'uy'];

function makeCfdProjectFrom(input: PhysicalInputs, preset: CfdPreset, name: string): CfdProject {
  const setup = cfdSetup(input, preset);
  const c = CFD_PRESETS[preset];
  const params: Omit<CfdParams, 'geometry'> = { alphaDeg: input.alphaDeg, cells: c.cells, reynolds: setup.reynolds, ...CFD_BASE, warmup: c.warmup, average: c.average };
  return newCfdProject(name || 'Rounded plate CFD study', { scenario: input, preset, params, realReynolds: setup.real.reynolds }, { plate: setup.plate, paths: initialPaths(setup.plate), spacing: 1 });
}

/**
 * FLOW-GUIDED GEOMETRY B · CFD (experimental): the same rounded plate and construction pointer as the particle workspace, but the
 * flow is computed by a conventional solver of the Navier–Stokes equations (lattice Boltzmann, src/cfd). It shares nothing with the
 * particle engine and says nothing about it: no particles, no model units, no Universe A or B.
 */
export function CfdGeometry() {
  const [store, setStore] = useState<{ store: CfdProjectStore; persistent: boolean } | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string; createdAt: string; versions: number; head: string }[]>([]);
  const [sText, setSText] = useState<ScenarioText>(() => scenarioText(DEFAULT_SCENARIO));
  const [fTexts, setFTexts] = useState<FluidTexts>(() => ({ ...DEFAULT_FLUID_TEXTS }));
  const [depthText, setDepthText] = useState(String(DEFAULT_DEPTH_CM));
  const [preset, setPreset] = useState<CfdPreset>('quick');
  const [project, setProject] = useState<CfdProject>(() => makeCfdProjectFrom(DEFAULT_SCENARIO, 'quick', ''));
  const [viewId, setViewId] = useState('v0');
  const [cmp, setCmp] = useState<[string, string]>(['v0', 'v0']);
  const [kind, setKind] = useState<CfdViewKind>('speed');
  const [showStreams, setShowStreams] = useState(false);
  const [showTracers, setShowTracers] = useState(false);
  // reference airfoils: the sections added from a code or a file, the ones ticked for the study, and the study's runs and table
  const [extraAirfoils, setExtraAirfoils] = useState<AirfoilProfile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [anglesText, setAnglesText] = useState('0, 4, 8, 12');
  const [studyRows, setStudyRows] = useState<StudyRow[]>([]);
  const [studyRun, setStudyRun] = useState<{ done: number; total: number; label: string; job: StudyJob } | null>(null);
  const [studyMessage, setStudyMessage] = useState<string | null>(null);
  const studyRef = useRef<{ jobs: StudyJob[]; i: number } | null>(null);
  const studyResultRef = useRef<((r: CfdResult) => boolean) | null>(null);
  const studyEndRef = useRef<((kind: 'stopped' | 'failed', text: string) => boolean) | null>(null);
  // the drawing pad (paper with a cm grid, faded over the flow): remembered between visits
  const [pad, setPadState] = useState<PadSettings>(() => {
    try {
      const o = JSON.parse(localStorage.getItem('pfad-cfd-pad') ?? 'null') as Partial<PadSettings> | null;
      if (o && typeof o.opacity === 'number') return { opacity: Math.min(1, Math.max(0, o.opacity)), style: o.style === 'blueprint' ? 'blueprint' : 'pad', frame: o.frame === 'wind' ? 'wind' : 'plate' };
    } catch {
      /* no storage */
    }
    return PAD_OFF;
  });
  const setPad = (p: PadSettings) => {
    setPadState(p);
    try {
      localStorage.setItem('pfad-cfd-pad', JSON.stringify(p));
    } catch {
      /* private window: not remembered */
    }
  };
  const [streamSpacing, setStreamSpacing] = useState(2.5);
  const [showStations, setShowStations] = useState(false);
  const [showHeight, setShowHeight] = useState(true);
  const [side, setSide] = useState<Side>('upper');
  const [pTexts, setPTexts] = useState<PointerTexts>({ ...EMPTY_POINTER_TEXTS });
  const [pStep, setPStep] = useState<PointerStepConfig>(DEFAULT_POINTER_STEP);
  const [sweep, setSweep] = useState<PointerSweep>(EMPTY_SWEEP);
  const [fillSettings, setFillSettings] = useState<CfdFillSettings>({ settle: 1, window: 1.5, computeAfter: true });
  const [fillActive, setFillActive] = useState(false);
  const [fillResult, setFillResult] = useState<string | null>(null);
  const [pendingCompute, setPendingCompute] = useState<string | null>(null);
  const fillingRef = useRef(false);
  const computeAfterRef = useRef(true);
  computeAfterRef.current = fillSettings.computeAfter;
  // where to compute: the graphics card when there is one (remembered), otherwise the CPU
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null | undefined>(undefined);
  const [engine, setEngineState] = useState<Engine>('cpu');
  const setEngine = (e: Engine) => {
    setEngineState(e);
    try {
      localStorage.setItem('pfad-cfd-engine', e);
    } catch {
      /* private window: the choice is not remembered */
    }
    if (e === 'cpu' && GPU_PRESETS.includes(preset)) setPreset('fine');
  };
  useEffect(() => {
    let live = true;
    probeGpu().then((i) => {
      if (!live) return;
      setGpuInfo(i);
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('pfad-cfd-engine');
      } catch {
        /* no storage */
      }
      if (i && !i.software && saved !== 'cpu') setEngineState('gpu');
      else if (i && saved === 'gpu') setEngineState('gpu');
    });
    return () => {
      live = false;
    };
  }, []);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<'results' | 'compare' | 'history'>('results');
  const runningVersion = useRef<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  // ---- persistence
  useEffect(() => {
    let live = true;
    openCfdProjects().then(async (s) => {
      if (!live) return;
      setStore(s);
      setSaved(await s.store.list());
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!store) return;
    const t = setTimeout(() => {
      store.store
        .put(project)
        .then(() => store.store.list())
        .then(setSaved)
        .catch((e) => setMessage(`Could not save the project: ${(e as Error).message}. Export it to keep it.`));
    }, 600);
    return () => clearTimeout(t);
  }, [project, store]);

  // ---- the simulation
  const onResult = useCallback((result: CfdResult, activeMs: number) => {
    if (studyResultRef.current?.(result)) return;
    const v = runningVersion.current;
    runningVersion.current = null;
    if (!v) return;
    setProject((p) => attachCfdRun(p, v, { result, finishedAt: new Date().toISOString(), activeMs, codeVersion: CODE_VERSION }));
    setViewId(v);
    setMessage(`CFD of ${v} finished: ${result.integrity.status}.`);
  }, []);
  const onFilled = useCallback((res: CfdFillResult) => {
    fillingRef.current = false;
    setFillActive(false);
    try {
      const out = addCfdFillVersion(projectRef.current, res);
      setProject(out.project);
      setViewId(out.version.id);
      setCmp([out.version.parent!, out.version.id]);
      setFillResult(`Auto fill finished (${res.stop.kind}: ${res.stop.reason}). New version ${out.version.id}: ${res.moves.length} pointer moves, ${res.totalRise.toFixed(2)} d of rise in all. ${computeAfterRef.current ? 'Computing it next (an ordinary run on the new shape).' : 'It has not been computed: press COMPUTE to see what the new shape does.'}`);
      setMessage(`Auto fill added ${out.version.id}.`);
      if (computeAfterRef.current) setPendingCompute(out.version.id);
    } catch (e) {
      setFillResult(`Auto fill finished without a new version: ${(e as Error).message}`);
      setMessage(`Auto fill finished without a new version: ${res.stop.reason}`);
    }
  }, []);
  const onEnd = useCallback((kindEnd: 'stopped' | 'failed', text: string) => {
    if (studyEndRef.current?.(kindEnd, text)) return;
    if (fillingRef.current) {
      fillingRef.current = false;
      setFillActive(false);
      setFillResult(`Auto fill ${kindEnd === 'failed' ? 'failed' : 'was cancelled'}: ${text}. Nothing was kept.`);
    }
    const v = runningVersion.current;
    runningVersion.current = null;
    if (v) setProject((p) => logCfdEnd(p, v, kindEnd, text));
    setMessage(`${kindEnd === 'stopped' ? 'Stopped' : 'Failed'}: ${text}`);
    setSweep((a) => (a.active ? { ...a, active: false, stopped: { stop: kindEnd, reason: text }, log: [...a.log, { text: `Stopped (${kindEnd === 'failed' ? 'the simulation failed' : 'the simulation was stopped'}): ${text}`, kind: 'stop' as const }] } : a));
  }, []);
  const sim = useCfd(onResult, onEnd, onFilled);

  const head = cfdHead(project);
  const viewed = project.versions.some((v) => v.id === viewId) ? cfdVersion(project, viewId) : head;
  const parentOfViewed = viewed.parent ? cfdVersion(project, viewed.parent) : null;
  const params = project.conditions.params;
  const library = head.library ?? null;
  const scenario = project.conditions.scenario;
  const cond = project.conditions;
  const chord = head.geometry.chord;
  const domain = { w: params.widthL * chord, h: params.heightL * chord };
  const cmPerUnit = scenario.lengthCm / chord;
  const sCheck = parseCfdInputs(sText, fTexts);
  const newSetup = sCheck.ok ? cfdSetup(sCheck.input, preset) : null;
  const depthCm = project.wingDepthCm ?? DEFAULT_DEPTH_CM;
  const depthCheck = parseDepth(depthText);
  const busy = sim.phase === 'running' || sim.phase === 'paused';
  const locked = busy || sweep.active;
  const live = busy && sim.frame ? sim.frame : null;

  const run = () => {
    if (busy) return;
    setMessage(null);
    runningVersion.current = head.id;
    sim.start({ ...params, geometry: head.geometry }, kind, showStreams || showTracers, engine === 'gpu' && gpuInfo ? 'gpu' : 'cpu');
  };

  // ---- reference airfoils: a fixed body from a library or a file, and the study of several of them
  const engineArg: 'gpu' | 'cpu' = engine === 'gpu' && gpuInfo ? 'gpu' : 'cpu';
  const loadAirfoil = (profile: AirfoilProfile, body: AirfoilBody) => {
    if (busy) return;
    if (!sCheck.ok) return setMessage(`Inputs: ${sCheck.errors.join('; ')}`);
    if (!depthCheck.ok) return setMessage(depthCheck.error);
    if (project.versions.length > 1 || project.versions.some((v) => v.run)) {
      if (!window.confirm(`Start a new project with ${profile.name}? “${project.name}” stays in the saved projects of this browser.`)) return;
    }
    const { trailingThicknessCm: dropped, ...rest } = sCheck.input;
    void dropped;
    const input: PhysicalInputs = { ...rest, thicknessCm: Math.max(0.01, Math.round(body.metrics.thickness * rest.lengthCm * 100) / 100) };
    const setup = cfdSetup(input, preset);
    const c = CFD_PRESETS[preset];
    const params: Omit<CfdParams, 'geometry'> = { alphaDeg: input.alphaDeg, cells: c.cells, reynolds: setup.reynolds, ...CFD_BASE, warmup: c.warmup, average: c.average };
    const notes = [...body.notes, ...resolutionAdvice(body.metrics.thickness, body.metrics.noseRadius, c.cells)];
    const lib: CfdLibraryBody = { id: profile.id, name: profile.name, family: profile.family, source: profile.source.text, known: profile.known, metrics: { thickness: body.metrics.thickness, thicknessAt: body.metrics.thicknessAt, camber: body.metrics.camber, camberAt: body.metrics.camberAt, noseRadius: body.metrics.noseRadius, trailingGap: body.metrics.trailingGap }, notes };
    const plate = { length: CFD_PLATE_LENGTH, thickness: Math.max(0.5, body.metrics.thickness * CFD_PLATE_LENGTH) };
    const p = setCfdWingDepth(newCfdLibraryProject(`${profile.name} study`, { scenario: input, preset, params, realReynolds: setup.real.reynolds }, body.geometry, lib, { plate, paths: initialPaths(plate), spacing: 1 }), depthCheck.depthCm);
    sim.unload();
    setProject(p);
    setViewId('v0');
    setCmp(['v0', 'v0']);
    setCamera(null);
    setMessage(`${profile.name} is now the body (a fixed body: the pointer does not apply to it). It has not been computed: press SIMULATE.`);
  };
  const allAirfoils = [...AIRFOIL_PRESETS, ...extraAirfoils];
  const startStudyJob = (job: StudyJob) => {
    runningVersion.current = null;
    sim.start({ ...params, alphaDeg: job.alphaDeg, geometry: job.geometry }, kind, false, engineArg);
  };
  const runStudy = () => {
    if (busy) return;
    const ang = parseAngles(anglesText);
    if (!ang.ok) return setStudyMessage(ang.error);
    const bodies: { id: string; name: string; geometry: StudyJob['geometry']; thickness: number; noseRadius: number }[] = [];
    for (const id of picked) {
      const a = allAirfoils.find((x) => x.id === id);
      if (!a) continue;
      try {
        const b = airfoilBody(a.contour, CFD_PLATE_LENGTH);
        bodies.push({ id: a.id, name: a.name, geometry: b.geometry, thickness: b.metrics.thickness, noseRadius: b.metrics.noseRadius });
      } catch (e) {
        return setStudyMessage(`${a.name}: ${(e as Error).message}`);
      }
    }
    if (!bodies.length) return setStudyMessage('tick “in the study” on at least one section');
    const jobs = jobsFor(bodies, ang.angles);
    setStudyRows([]);
    setStudyMessage(null);
    studyRef.current = { jobs, i: 0 };
    setStudyRun({ done: 0, total: jobs.length, label: `${jobs[0].name} at ${jobs[0].alphaDeg}°`, job: jobs[0] });
    startStudyJob(jobs[0]);
  };
  const nextStudyJob = (note: string | null) => {
    const st = studyRef.current;
    if (!st) return;
    st.i++;
    if (note) setStudyMessage(note);
    if (st.i >= st.jobs.length) {
      studyRef.current = null;
      setStudyRun(null);
      setMessage('The airfoil study finished: the table is under the list of sections.');
      return;
    }
    const job = st.jobs[st.i];
    setStudyRun({ done: st.i, total: st.jobs.length, label: `${job.name} at ${job.alphaDeg}°`, job });
    startStudyJob(job);
  };
  studyResultRef.current = (result) => {
    const st = studyRef.current;
    if (!st) return false;
    // the row is made now, from the job that was run: the counter moves on right after
    const row = rowOf(st.jobs[st.i], result);
    setStudyRows((r) => [...r, row]);
    nextStudyJob(null);
    return true;
  };
  studyEndRef.current = (endKind, text) => {
    const st = studyRef.current;
    if (!st) return false;
    if (endKind === 'stopped') {
      studyRef.current = null;
      setStudyRun(null);
      setStudyMessage('The study was stopped; the rows computed so far are kept.');
      return true;
    }
    const job = st.jobs[st.i];
    nextStudyJob(`${job.name} at ${job.alphaDeg}° failed (${text}) and was skipped.`);
    return true;
  };
  const stopStudy = () => {
    studyRef.current = null;
    setStudyRun(null);
    setStudyMessage('The study was stopped; the rows computed so far are kept.');
    sim.stop();
  };

  // ---- project
  const newProject = () => {
    if (!sCheck.ok) return setMessage(`Inputs: ${sCheck.errors.join('; ')}`);
    if (!depthCheck.ok) return setMessage(depthCheck.error);
    if (project.versions.length > 1 || project.versions.some((v) => v.run)) {
      if (!window.confirm(`Start a new project? “${project.name}” stays in the saved projects of this browser.`)) return;
    }
    const p = setCfdWingDepth(makeCfdProjectFrom(sCheck.input, preset, ''), depthCheck.depthCm);
    sim.unload();
    setProject(p);
    setViewId('v0');
    setCmp(['v0', 'v0']);
    setCamera(null);
    setMessage(null);
  };
  const openProject = (p: CfdProject) => {
    sim.unload();
    setProject(p);
    setSText(scenarioText(p.conditions.scenario));
    setFTexts(fluidTextsOf(p.conditions.scenario.fluid));
    setPreset(p.conditions.preset);
    setDepthText(String(p.wingDepthCm ?? DEFAULT_DEPTH_CM));
    setViewId(p.head);
    setCmp([p.versions.find((v) => v.id === p.head)?.parent ?? p.head, p.head]);
    setCamera(null);
  };

  // ---- the pointer
  const shape = head.shape;
  const pointerTarget = useMemo(() => readPointerInput(shape.plate, shape.paths, shape.spacing, side, pTexts, cmPerUnit, pStep.limits), [shape, pTexts, side, cmPerUnit, pStep.limits]);
  useEffect(() => {
    if (sweep.active) return;
    setPTexts(defaultPointerTexts(shape.plate, shape.paths, side, cmPerUnit, pStep.step));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, head.id, side]);
  // the camber spline: control points typed or dragged, a preview, and APPLY makes a new version
  const [camberTexts, setCamberTexts] = useState<CamberTexts>({ points: [] });
  useEffect(() => {
    setCamberTexts(camberTextsOf(shape.plate, cmPerUnit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, head.id]);
  const camberInput = useMemo(() => readCamberInput(shape.plate, shape.paths, shape.spacing, camberTexts, cmPerUnit), [shape, camberTexts, cmPerUnit]);
  const applyCamber = () => {
    if (!camberInput.ok) return setMessage(`Cannot apply the camber: ${camberInput.reason}`);
    try {
      const out = addCfdPointerMove(project, { side, camber: camberInput.camber, limits: pStep.limits, decision: { kind: 'hand' } });
      setProject(out.project);
      afterMove(out.version, `${out.version.label}: ${out.version.id} has the new surface. It has not been simulated: run it to compute its flow.`);
    } catch (e) {
      setMessage(`Cannot apply the camber: ${(e as Error).message}`);
    }
  };
  // the red dot, the pointer and the green dot can be picked up and dragged on the picture: a drag fills in the same boxes
  const dotPlacement = cfdPlacement(params, head.geometry);
  const dotHandles = useMemo((): ViewHandle[] => {
    if (library) return [];
    const sgn = side === 'upper' ? 1 : -1;
    const r0 = radiusOf(shape.plate);
    const d = dotsFromTexts(shape.plate, shape.paths, side, pTexts, cmPerUnit);
    const toSim = (q: { x: number; y: number }) => {
      const [x, y] = place([q.x + r0, sgn * q.y + camberShift(shape.plate, q.x)], dotPlacement);
      return { x, y };
    };
    const cam = camberControlsOf(camberTexts, cmPerUnit).map((q, k) => {
      const [x, y] = place([q.x, q.y], dotPlacement);
      return { id: `camber:${k}`, x, y };
    });
    return [...cam, { id: 'green', ...toSim(d.green) }, ...(d.pointer ? [{ id: 'pointer', ...toSim(d.pointer) }] : []), { id: 'red', ...toSim(d.red) }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, side, pTexts, camberTexts, cmPerUnit, params, head.geometry, library]);
  const onDotDrag = (id: string, sx: number, sy: number) => {
    const [bx, by] = unplace([sx, sy], dotPlacement);
    if (id.startsWith('camber:')) return setCamberTexts((t) => dragCamberPoint(shape.plate, t, Number(id.slice(7)), bx, by, cmPerUnit));
    const xp = bx - radiusOf(shape.plate);
    setPTexts((t) => dragToTexts(shape.plate, shape.paths, side, id, xp, (side === 'upper' ? 1 : -1) * (by - camberShift(shape.plate, xp)), cmPerUnit, t));
  };
  const afterMove = (v: CfdVersion, text: string) => {
    setViewId(v.id);
    setCmp([v.parent ?? v.id, v.id]);
    setMessage(text);
  };
  const placePointer = () => {
    if (!pointerTarget.ok) return setMessage(`Cannot place the pointer: ${pointerTarget.reason}`);
    try {
      const out = addCfdPointerMove(project, { side, ...(pointerTarget.to ? { to: pointerTarget.to } : {}), ...(pointerTarget.edit ? { edit: pointerTarget.edit } : {}), limits: pStep.limits, decision: { kind: 'hand' } });
      setProject(out.project);
      afterMove(out.version, `${out.version.label}: ${out.version.id} has the new surface. It has not been simulated: run it to compute its flow.`);
    } catch (e) {
      setMessage(`Cannot place the pointer: ${(e as Error).message}`);
    }
  };
  const doMeasuredStep = (proj: CfdProject, v: CfdVersion) => {
    const m = measuredCfdStep(v, side, pStep);
    if (!m.ok) throw new Error(m.reason);
    return addCfdPointerMove(proj, { side, to: m.st.to, limits: pStep.limits, decision: { kind: 'measurement', step: m.st, versionId: v.id, summary: m.summary } });
  };
  const autoStep = () => {
    try {
      const out = doMeasuredStep(project, head);
      setProject(out.project);
      afterMove(out.version, `The CFD result moved the pointer: ${out.version.id}. ${out.version.move!.measured!.note}. It has not been simulated.`);
    } catch (e) {
      setMessage(`No pointer step: ${(e as Error).message}`);
    }
  };
  const sweepKey = useRef('');
  const logSweep = (text: string, k: 'info' | 'warn' | 'stop' = 'info') => setSweep((a) => ({ ...a, log: [...a.log, { text, kind: k }] }));
  const stopSweep = (stop: string, reason: string) => {
    setSweep((a) => ({ ...a, active: false, stopped: { stop, reason }, log: [...a.log, { text: `Stopped (${stop}): ${reason}.`, kind: 'stop' as const }] }));
    setMessage(`Pointer sweep stopped: ${reason}`);
  };
  const startSweep = () => {
    setMessage(null);
    sweepKey.current = '';
    setSweep({ active: true, steps: 0, log: [{ text: `Started on the ${side} side from ${head.id}: compute, move the pointer by the CFD result, compute again, until the pointer reaches the anchor.`, kind: 'info' }], stopped: null });
  };
  const stopSweepByUser = () => {
    if (busy) sim.stop();
    stopSweep('user', 'you stopped it');
  };
  // ---- auto fill: the pointer moves by itself during one run (cfd/CfdFill.ts)
  const startFill = () => {
    setMessage(null);
    setFillResult(null);
    runningVersion.current = null;
    fillingRef.current = true;
    setFillActive(true);
    sim.startFill({ ...params, geometry: head.geometry }, shape.plate, shape.paths, shape.spacing, { ...DEFAULT_CFD_FILL, side, step: pStep, settle: fillSettings.settle, window: fillSettings.window }, kind, showStreams || showTracers);
  };
  useEffect(() => {
    if (!pendingCompute || busy) return;
    setPendingCompute(null);
    if (head.id === pendingCompute && !head.run) run();
  });
  useEffect(() => {
    if (!sweep.active || busy || runningVersion.current !== null) return;
    const key = `${head.id}|${head.run ? 'run' : '-'}`;
    if (sweepKey.current === key) return;
    sweepKey.current = key;
    if (!head.run) {
      logSweep(`Computing ${head.id}…`);
      run();
      return;
    }
    if (head.run.result.integrity.status === 'FAILED') return stopSweep('failed', `the run of ${head.id} failed its integrity checks, so its numbers cannot be trusted`);
    if (pointerOf(head.shape.paths, side).x >= anchorOf(head.shape.plate, head.shape.paths, side).x - 1e-9) return stopSweep('finished', 'the pointer is at the trailing-edge anchor: the curve is complete and its last version has been computed');
    if (sweep.steps >= 40) return stopSweep('limit', 'forty pointer steps were taken');
    try {
      const out = doMeasuredStep(project, head);
      setProject(out.project);
      setViewId(out.version.id);
      setCmp([out.version.parent!, out.version.id]);
      setSweep((a) => ({ ...a, steps: a.steps + 1, log: [...a.log, { text: `Step ${a.steps + 1}: ${out.version.move!.measured!.note}. New version ${out.version.id}; computing it next.`, kind: 'info' as const }] }));
    } catch (e) {
      stopSweep('nothing-measured', (e as Error).message);
    }
  });

  // ---- what is drawn
  useEffect(() => {
    if (busy) sim.setView(kind, showStreams || showTracers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, showStreams, showTracers]);
  const stored = useMemo(() => (viewed.run && !live ? fieldFromResult(viewed.run.result, kind) : null), [viewed.run, kind, live]);
  const field = live ? { nx: live.field.nx, ny: live.field.ny, values: live.field.values } : stored;
  const streams = useMemo((): { lines: Streamline[]; arrowEvery: number } | null => {
    if (!showStreams || !viewed.run || live) return null;
    const res = viewed.run.result;
    const f = smoothField(streamField(res), 1);
    const pl = cfdPlacement(res.params, viewed.geometry);
    const poly = place(bodyPolygon(viewed.geometry), pl);
    const lines = traceStreamlines(f, { spacing: streamSpacing, testFraction: 0.5, step: 0.4, maxLength: 4 * domain.w, minSpeed: 0.04, inside: (x, y) => insidePolygon(poly, x, y), maxLines: 600 });
    return { lines, arrowEvery: 8 * (streamSpacing / 2.5) + 6 };
  }, [showStreams, viewed, live, streamSpacing, domain.w]);
  // streamlines of a run in progress: of the velocity at this instant (redrawn about every 2 s); the time-mean ones replace them when it ends
  const [liveStreams, setLiveStreams] = useState<{ lines: Streamline[]; arrowEvery: number } | null>(null);
  const liveStreamAt = useRef(0);
  const flow = live?.flow ?? null;
  useEffect(() => {
    if (!busy || !showStreams) return void setLiveStreams(null);
    if (!flow) return;
    const now = performance.now();
    if (now - liveStreamAt.current < 2000) return;
    liveStreamAt.current = now;
    const cell = flow.stride / live!.cellsPerUnit;
    const solid = Array.from(flow.ux, (u) => Number.isNaN(u));
    const f = smoothField({ nx: flow.nx, ny: flow.ny, x0: 0, y0: 0, cw: cell, ch: cell, ux: Array.from(flow.ux, (u) => (Number.isNaN(u) ? 0 : u)), uy: Array.from(flow.uy, (u) => (Number.isNaN(u) ? 0 : u)), valid: solid.map((x) => !x) }, 1);
    const pl = cfdPlacement(params, head.geometry);
    const poly = place(bodyPolygon(head.geometry), pl);
    const lines = traceStreamlines(f, { spacing: streamSpacing, testFraction: 0.5, step: 0.4, maxLength: 4 * domain.w, minSpeed: 0.04, inside: (x, y) => insidePolygon(poly, x, y), maxLines: 600 });
    setLiveStreams({ lines, arrowEvery: 8 * (streamSpacing / 2.5) + 6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, showStreams, flow, streamSpacing]);
  const shownStreams = busy && showStreams ? liveStreams : streams;
  // the velocity the animated tracers ride on: the instant of a run in progress, the time mean of a computed version
  const tracerField = useMemo((): GridField | null => {
    if (!showTracers) return null;
    if (busy) {
      if (!flow) return null;
      const cell = flow.stride / live!.cellsPerUnit;
      return { nx: flow.nx, ny: flow.ny, x0: 0, y0: 0, cw: cell, ch: cell, ux: Array.from(flow.ux, (u) => (Number.isNaN(u) ? 0 : u)), uy: Array.from(flow.uy, (u) => (Number.isNaN(u) ? 0 : u)), valid: Array.from(flow.ux, (u) => !Number.isNaN(u)) };
    }
    return viewed.run ? streamField(viewed.run.result) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTracers, busy, flow, viewed.run]);
  const caption = studyRun && live
    ? `${CFD_FIELD_LABEL[live.field.kind].label} at this instant — airfoil study, run ${studyRun.done + 1} of ${studyRun.total}: ${studyRun.label}, ${(100 * live.progress).toFixed(0)} %`
    : live
    ? `${CFD_FIELD_LABEL[live.field.kind].label} at this instant — the run of ${head.id}, ${(100 * live.progress).toFixed(0)} %, ${live.phase}`
    : viewed.run
      ? `${CFD_FIELD_LABEL[kind].label}: mean over the window of ${viewed.id} (Re ${Math.round(viewed.run.result.params.reynolds)}, ${viewed.run.result.params.cells} cells along the plate)`
      : `${viewed.id} has not been computed`;
  const overlay = useMemo(() => {
    // during an airfoil study the body of the run in progress is drawn (at its angle); a fixed body has no pointer, dots or camber
    const sj = studyRun?.job ?? null;
    const pNow = sj ? { ...params, alphaDeg: sj.alphaDeg } : params;
    const pl = cfdPlacement(pNow, sj ? sj.geometry : head.geometry);
    const fixed = !!library || !!sj;
    const pointer = fixed ? null : (() => {
      const r0 = radiusOf(shape.plate);
      const dd = dotsFromTexts(shape.plate, shape.paths, side, pTexts, cmPerUnit);
      const at = live?.fill?.pointer ?? dd.red;
      const showPreview = pointerTarget.ok && !live?.fill;
      const a = live?.fill ? anchorOf(shape.plate, shape.paths, side) : dd.green;
      const pa = showPreview && pointerTarget.ok ? pointerTarget.pointerAt : null;
      const sg = side === 'upper' ? 1 : -1;
      const body = (q: { x: number; y: number }) => ({ x: q.x + r0, y: sg * q.y + camberShift(shape.plate, q.x) });
      return { side, at: body(at), anchor: body(a), preview: showPreview && pointerTarget.ok ? pointerTarget.geometry : null, previewAt: pa ? body(pa) : null };
    })();
    const st = { placement: pl, geometry: sj ? sj.geometry : live?.fill?.geometry ?? head.geometry, previous: null, proposal: null, pointIdx: -1, region: null, dividing: null, replay: null, viewed: null, showStations, alphaDeg: pNow.alphaDeg, references: [], streams: shownStreams, pointer, camber: !fixed && camberInput.ok ? { controls: camberInput.controls, line: camberInput.line, preview: camberInput.unchanged ? null : camberInput.geometry } : null };
    const draw = makeOverlay(st);
    return (g: CanvasRenderingContext2D, T: Parameters<typeof draw>[1]) => {
      // the body: drawn solid over the field
      const bodyG = sj ? sj.geometry : live?.fill?.geometry ?? viewed.geometry;
      const poly = place(bodyPolygon(bodyG), cfdPlacement(pNow, bodyG));
      g.beginPath();
      for (let k = 0; k < poly.length; k += 2) {
        if (k === 0) g.moveTo(T.X(poly[k]), T.Y(poly[k + 1]));
        else g.lineTo(T.X(poly[k]), T.Y(poly[k + 1]));
      }
      g.closePath();
      g.fillStyle = '#1b222b';
      g.fill();
      g.strokeStyle = '#d6dde4';
      g.lineWidth = 1.6;
      g.stroke();
      // the dividing streamline of the time-mean flow, from the stations of the viewed version's result
      if (showHeight && viewed.run && !live) {
        const sideStations = viewed.run.result.stations[side];
        const y = side === 'upper' ? viewed.geometry.upper : viewed.geometry.lower;
        const xs = viewed.geometry.xs ?? [];
        const sgn = side === 'upper' ? 1 : -1;
        const pts: [number, number][] = [];
        sideStations.forEach((s, k) => {
          if (!s.h || s.hShare < 0.5 || !(s.h.mean > 0)) return;
          const tx = xs[k + 1] - xs[k];
          const ty = y[k + 1] - y[k];
          const L = Math.hypot(tx, ty);
          const cx = 0.5 * (xs[k] + xs[k + 1]);
          const cy = 0.5 * (y[k] + y[k + 1]);
          const q = place([cx + (-ty / L) * sgn * s.h.mean, cy + (tx / L) * sgn * s.h.mean], cfdPlacement(params, viewed.geometry));
          pts.push([T.X(q[0]), T.Y(q[1])]);
        });
        if (pts.length > 1) {
          g.beginPath();
          pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
          g.strokeStyle = '#39c5cf';
          g.lineWidth = 1.8;
          g.setLineDash([7, 3]);
          g.stroke();
          g.setLineDash([]);
          g.font = '10px ui-monospace, monospace';
          g.fillStyle = '#39c5cf';
          g.fillText('dividing streamline', pts[0][0] + 4, pts[0][1] - 6);
        }
      }
      // the absorbing layer in front of the outflow
      if (params.spongeL > 0) {
        const x0 = T.X(domain.w - params.spongeL * chord);
        g.fillStyle = 'rgba(11,14,18,0.45)';
        g.fillRect(x0, T.Y(domain.h), T.X(domain.w) - x0, domain.h * T.s);
        g.font = '10px ui-monospace, monospace';
        g.fillStyle = '#8b98a5';
        g.fillText('absorbing layer (not part of the result)', x0 + 6, T.Y(domain.h) + 14);
      }
      draw(g, T);
    };
  }, [params, head, viewed, shape, side, pointerTarget, camberInput, pTexts, showStations, shownStreams, showHeight, live, domain.w, domain.h, chord, library, studyRun]);

  // ---- charts
  const stationsOf = (v: CfdVersion | null) => (v?.run ? v.run.result.stations[side] : null);
  const cur = stationsOf(viewed);
  const prev = stationsOf(parentOfViewed);
  const series = (pick: (s: NonNullable<ReturnType<typeof stationsOf>>[number]) => { mean: number; se: number } | null) => {
    const mk = (list: NonNullable<ReturnType<typeof stationsOf>>, label: string, color: string, dashed = false) => {
      const xs: number[] = [];
      const ys: number[] = [];
      const ses: number[] = [];
      for (const s of list) {
        const e = pick(s);
        xs.push(s.x);
        ys.push(e ? e.mean : Number.NaN);
        ses.push(e && Number.isFinite(e.se) ? e.se : 0);
      }
      return { label, color, x: xs, y: ys, se: ses, dashed };
    };
    return [...(prev ? [mk(prev, `${parentOfViewed!.id} (parent)`, '#8b98a5', true)] : []), ...(cur ? [mk(cur, viewed.id, '#f0b429')] : [])];
  };

  const forceLine = (v: CfdVersion) => {
    if (!v.run) return null;
    const f = cfdForceMeasure(v.run.result);
    const base = `drag ${fmt(f.dragCoeff.mean, 2)} · lift ${fmt(f.liftCoeff.mean, 2)} (coefficients of this simulation)`;
    const w = wingForces(f, scenario, depthCm);
    return `${base} → ${newtonsAndKgf(w.drag.mean)} drag and ${newtonsAndKgf(w.lift.mean)} lift on your ${depthCm} cm wing in your air (scaled estimate, not a prediction)`;
  };
  const exportProject = () => downloadText(`${safeName(project.name)}-cfd-project.json`, cfdProjectToJSON(project), 'application/json');
  const exportCsv = () => {
    const r = viewed.run?.result;
    if (!r) return setMessage('The viewed version has no CFD result to export.');
    const lines = [`# ${project.name} ${viewed.id}; Reynolds ${Math.round(r.params.reynolds)}; ${r.params.cells} cells along the plate; code ${CODE_VERSION}; conventional CFD (lattice Boltzmann), not the particle model`, 'side,x,length,cf,cf_se,cp,cp_se,ut_over_U,h,h_se,h_share'];
    for (const s of ['upper', 'lower'] as const) for (const q of r.stations[s]) lines.push([s, q.x, q.length, q.cf.mean, q.cf.se, q.cp.mean, q.cp.se, q.ut.mean, q.h?.mean ?? '', q.h?.se ?? '', q.hShare].join(','));
    downloadText(`${safeName(project.name)}-${viewed.id}-wall.csv`, lines.join('\n'), 'text/csv');
  };
  const importProject = async (f: File) => {
    try {
      openProject(parseCfdProject(await f.text()));
      setMessage('Project imported.');
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    }
  };
  const doUndo = () => {
    try {
      const np = undoCfd(project);
      setProject(np);
      setViewId(np.head);
      setMessage(`Undone: the head is ${np.head} again. The undone version stays in the history.`);
    } catch (e) {
      setMessage(`Cannot undo: ${(e as Error).message}`);
    }
  };

  const f = sim.frame;
  const eta = live && live.progress > 0.03 ? (live.activeMs * (1 - live.progress)) / live.progress / 1000 : null;
  const stage = !head.run ? (library ? `compute ${library.name}` : 'compute the starting plate') : library ? 'change the angle, the speed or the fluid and compute again, or run the airfoil study' : 'move the pointer (by hand, one automatic step, or a sweep) and compute again';
  return (
    <div className="lab flow">
      <header className="topbar">
        <div>
          <h1>FLOW-GUIDED GEOMETRY B · CFD · EXPERIMENTAL</h1>
          <div className="meta">
            conventional CFD (lattice Boltzmann solution of the Navier–Stokes equations), separate from the particle research · code {CODE_VERSION.slice(0, 12)} · no particles, no model units, no Universe A or B
          </div>
        </div>
        <span className="prediction-label">NOT THE PARTICLE MODEL · NOT AN OPTIMISER · VALIDATED ONLY ON THE CASES IN THE DOCS</span>
      </header>
      <div className="main">
        <div className="column">
          <div className="section">
            <h2>1 · Your plate and the wind</h2>
            <CfdScenarioPanel
              text={sText}
              onText={(k, v) => setSText((t) => ({ ...t, [k]: v }))}
              fluid={fTexts}
              onFluid={setFTexts}
              errors={sCheck.ok ? null : sCheck.errors}
              setup={newSetup}
              disabled={locked}
              preset={preset}
              onPreset={setPreset}
              gpuPresets={engine === 'gpu' && !!gpuInfo}
              depthText={depthText}
              onDepth={(v) => {
                setDepthText(v);
                const d = parseDepth(v);
                if (d.ok) setProject((p) => setCfdWingDepth(p, d.depthCm));
              }}
              depthError={depthCheck.ok ? null : depthCheck.error}
            />
            <div className="seg" style={{ margin: '6px 0' }}>
              <button className="ctl primary" onClick={newProject} disabled={locked || !sCheck.ok || !depthCheck.ok} title="start again from a rounded plate with these values">
                START NEW PROJECT
              </button>
            </div>
            <div className="note">
              Open project: <b>{project.name}</b> · {project.versions.length} version{project.versions.length === 1 ? '' : 's'} · Re {Math.round(params.reynolds)} · {params.cells} cells along the plate · domain {params.widthL} × {params.heightL} plate lengths with slip walls at the top and bottom (blockage {head.run ? `${(100 * head.run.result.blockage).toFixed(0)} %` : 'shown after the first run'}). {library ? <>The body is <b>{library.name}</b>, a fixed body ({library.source}).</> : 'The body is the rounded plate you draw on.'} The solver knows no airfoil: a section from the library or a file is only the starting shape that was chosen.
            </div>
          </div>

          <div className="section">
            <h2>1b · Reference airfoils</h2>
            <AirfoilPanel cells={CFD_PRESETS[preset].cells} disabled={locked} onLoad={loadAirfoil} extra={extraAirfoils} onExtra={setExtraAirfoils} picked={picked} onPicked={setPicked} openName={library?.name ?? null} />
            <h3 className="h3">Airfoil study: lift, drag and L/D</h3>
            <AirfoilStudy
              picked={picked}
              anglesText={anglesText}
              onAngles={setAnglesText}
              anglesError={(() => {
                const a = parseAngles(anglesText);
                return a.ok ? null : a.error;
              })()}
              rows={studyRows}
              running={studyRun}
              message={studyMessage}
              disabled={busy && !studyRun}
              onRun={runStudy}
              onStop={stopStudy}
              onClear={() => {
                setStudyRows([]);
                setStudyMessage(null);
              }}
              cells={params.cells}
              reynolds={params.reynolds}
              engine={engineArg === 'gpu' ? 'on the graphics card' : 'on the CPU'}
            />
          </div>

          <div className="section run-section">
            <h2>2 · Compute {head.id}</h2>
            <GpuPanel engine={engine} onEngine={setEngine} info={gpuInfo} disabled={locked} />
            <div className="controls">
              <button className="ctl primary" disabled={locked} onClick={run} title="run the CFD of the current geometry">
                SIMULATE
              </button>
              <button className="ctl" disabled={sim.phase !== 'running'} onClick={sim.pause}>
                PAUSE
              </button>
              <button className="ctl" disabled={sim.phase !== 'paused'} onClick={sim.resume}>
                RESUME
              </button>
              <button className="ctl" disabled={!busy} onClick={sim.stop} title="end the run; no result is kept">
                STOP
              </button>
            </div>
            <div className="status-line">
              <span className={`phase ${sim.phase}`}>{sim.phase.toUpperCase()}</span>
              {f && busy && (
                <span>
                  {(100 * f.progress).toFixed(0)} % · {f.phase} · {f.convective.toFixed(1)} flow-throughs of the plate · {Math.round(f.stepsPerSecond)} steps/s · {f.engine.kind === 'gpu' ? 'GPU' : 'CPU'}{eta !== null ? ` · about ${Math.max(1, Math.round(eta / 60))} min left` : ''}
                </span>
              )}
            </div>
            <div className="progress">
              <div style={{ width: `${(100 * (busy || sim.phase === 'finished' ? f?.progress ?? 0 : 0)).toFixed(1)}%` }} />
            </div>
            {f?.engineNote && <div className="warn">{f.engineNote}</div>}
            {sim.error && <div className="error">{sim.error}</div>}
            {message && <div className={/^(Cannot|No pointer|Import failed|Inputs:|Failed)/.test(message) ? 'warn' : 'info'}>{message}</div>}
            <div className="note run-help">
              Next: <b>{stage}</b>. The solver is deterministic: the same plate and conditions give the same numbers, so there is no seed; the uncertainty shown is the variation of the flow in time.
            </div>
          </div>

          <div className="section">
            <h2>3 · Draw with the pointer (experimental)</h2>
            {library ? (
              <div className="note" data-testid="fixed-body-note">
                <b>{library.name}</b> is a fixed body: the red dot, the pointer, the green dot, the camber and the auto fill build on the rounded plate, and do not apply to a section taken from the library or a file. To draw with the pointer, press START NEW PROJECT (the plate project), or choose another section above.
                {library.notes.map((n, i) => (
                  <div key={i} className="warn">{n}.</div>
                ))}
              </div>
            ) : (
              <>
            <PointerPanel
              plate={shape.plate}
              paths={shape.paths}
              cmPerUnit={cmPerUnit}
              side={side}
              onSide={setSide}
              texts={pTexts}
              onTexts={setPTexts}
              textError={pointerTarget.ok ? null : pointerTarget.reason}
              changes={pointerTarget.ok ? pointerTarget.changes : []}
              camber={{ texts: camberTexts, onTexts: setCamberTexts, error: !camberInput.ok ? camberInput.reason : null, changed: camberInput.ok && !camberInput.unchanged, onAdd: () => setCamberTexts((t) => addCamberPoint(shape.plate, t, cmPerUnit)), onApply: applyCamber, maxPoints: CAMBER_LIMITS.maxPoints }}
              step={pStep}
              onStep={setPStep}
              sweep={sweep}
              measuredWhat="the height of the region of reversed flow beside it (the dividing streamline of the time-mean flow)"
              hasMeasurement={!!head.run}
              onPlace={placePointer}
              onAutoStep={autoStep}
              onSweep={startSweep}
              onStop={stopSweepByUser}
              blocked={busy ? 'A simulation is running: wait for it to finish, or stop it.' : null}
              caveat="The flow is computed, not measured from particles: the plate is resolved by the lattice cells, and a shoulder smaller than a few cells cannot be drawn."
            />
            <h3 className="h3">Auto fill (experimental)</h3>
            <CfdFillPanel
              side={side}
              settings={fillSettings}
              onSettings={setFillSettings}
              active={fillActive}
              status={
                fillActive && live
                  ? { phase: live.phase, convective: live.convective, moves: live.blocks, pointerX: (live.fill?.pointer.x ?? pointerOf(shape.paths, side).x) + radiusOf(shape.plate), lastGap: live.fill?.lastGap ?? null, lastRise: live.fill?.lastRise ?? null }
                  : null
              }
              onStart={startFill}
              onFinish={() => sim.finishNow()}
              onCancel={() => sim.stop()}
              blocked={busy ? 'A simulation is running: wait for it to finish, or stop it.' : sweep.active ? 'The pointer sweep is running.' : pointerOf(shape.paths, side).x >= anchorOf(shape.plate, shape.paths, side).x - 1e-9 ? 'The pointer of this side is already at the anchor: nothing left to draw.' : null}
              lastResult={fillResult}
            />
              </>
            )}
          </div>
        </div>

        <div className="column center">
          <div className="view-toolbar">
            <span>field</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as CfdViewKind)} aria-label="CFD field">
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {CFD_FIELD_LABEL[k].label}
                </option>
              ))}
            </select>
            <label className="field-inline" title={viewed.run || busy ? `lines everywhere tangent to the velocity: while a run is going, of the velocity at this instant; afterwards, of the time-mean velocity of ${viewed.id}` : 'available while a computation runs (the velocity at this instant) and for a version that has been computed (its time-mean)'}>
              <input type="checkbox" checked={showStreams} disabled={!viewed.run && !busy} onChange={(e) => setShowStreams(e.target.checked)} aria-label="show streamlines" />
              streamlines
            </label>
            <label className="field-inline" title="a few thousand marker points carried by the velocity on screen (the instant of a run in progress, the time mean of a computed version), with fading trails: only a picture of the flow">
              <input type="checkbox" checked={showTracers} disabled={!viewed.run && !busy} onChange={(e) => setShowTracers(e.target.checked)} aria-label="show animated tracers" />
              animated tracers
            </label>
            <label className="field-inline" title="a sheet of engineering paper with a grid in cm (from the leading tip of the plate), laid between the flow and the drawing: fade it in to read the pointer, the dots and the camber points on a quiet background, fade it out to see the flow">
              drawing pad
              <input type="range" min={0} max={100} step={1} value={Math.round(pad.opacity * 100)} onChange={(e) => setPad({ ...pad, opacity: Number(e.target.value) / 100 })} aria-label="drawing pad opacity" style={{ width: 110, verticalAlign: 'middle', margin: '0 6px' }} />
              <span className="muted">{Math.round(pad.opacity * 100)} %</span>
            </label>
            {pad.opacity > 0 && (
              <>
                <select value={pad.style} onChange={(e) => setPad({ ...pad, style: e.target.value as PadStyle })} aria-label="drawing pad paper">
                  <option value="pad">engineering pad (light)</option>
                  <option value="blueprint">blueprint (dark)</option>
                </select>
                <select value={pad.frame} onChange={(e) => setPad({ ...pad, frame: e.target.value as PadFrame })} aria-label="drawing pad grid">
                  <option value="plate">grid turns with the plate</option>
                  <option value="wind">grid follows the wind</option>
                </select>
              </>
            )}
            {showStreams && (
              <select value={streamSpacing} onChange={(e) => setStreamSpacing(Number(e.target.value))} aria-label="streamline spacing">
                <option value={4}>sparse</option>
                <option value={2.5}>normal</option>
                <option value={1.6}>dense</option>
              </select>
            )}
            <label className="field-inline">
              <input type="checkbox" checked={showHeight} onChange={(e) => setShowHeight(e.target.checked)} />
              dividing streamline
            </label>
            <label className="field-inline">
              <input type="checkbox" checked={showStations} onChange={(e) => setShowStations(e.target.checked)} />
              stations
            </label>
            <span className="zoom-buttons">
              <button className="ctl" onClick={() => setCamera((c) => ({ ...(c ?? { zoom: 1, cx: domain.w / 2, cy: domain.h / 2 }), zoom: Math.min(40, (c?.zoom ?? 1) * 1.5) }))} aria-label="zoom in">
                ＋
              </button>
              <button className="ctl" onClick={() => setCamera((c) => (c && c.zoom / 1.5 > 1.05 ? { ...c, zoom: c.zoom / 1.5 } : null))} aria-label="zoom out">
                －
              </button>
              <button className="ctl" onClick={() => setCamera({ zoom: 3.2, cx: params.bodyAtX * domain.w + 0.25 * domain.w * 0.4, cy: domain.h / 2 })} title="zoom to the body and its wake">
                BODY
              </button>
              <button className="ctl" onClick={() => setCamera(null)} disabled={!camera}>
                FIT
              </button>
            </span>
          </div>
          {viewed.id !== head.id && <div className="exp-banner">Viewing the results of {viewed.id}; the open version is {head.id} (head). Select the head in History to return.</div>}
          <CfdView field={field} kind={kind} domain={domain} camera={camera ?? { zoom: 3.2, cx: params.bodyAtX * domain.w + 0.25 * domain.w * 0.4, cy: domain.h / 2 }} onCamera={setCamera} overlay={overlay} tracers={tracerField} pad={{ settings: pad, geometry: { origin: cfdPlacement(params, head.geometry), cmPerUnit } }} caption={caption} handles={!busy && !sweep.active && viewed.id === head.id && rightTab !== 'compare' ? dotHandles : undefined} onHandleDrag={onDotDrag} />
          {showStreams && busy && (
            <div className="note">
              <span className="tag derived">DERIVED</span> streamlines of the velocity <b>at this instant</b> of the run in progress ({liveStreams ? `${liveStreams.lines.length} lines, ` : ''}redrawn about every 2 s). Behind a plate the instantaneous flow sheds vortices, so these move; when the run ends they are replaced by the streamlines of the time-mean velocity over the measurement window.
            </div>
          )}
          {!viewed.run && !busy && <div className="note">Streamlines: switched on while a computation runs (the velocity at this instant) or for a version that has been computed (its time-mean). {viewed.id} has not been computed yet.</div>}
          <div className="analysis" style={{ height: 'auto', minHeight: 250 }}>
            <div className="tabs small">
              <span className="note" style={{ alignSelf: 'center' }}>
                wall measurements along the
              </span>
              {(['upper', 'lower'] as const).map((s) => (
                <button key={s} className={`tab ${side === s ? 'on' : ''}`} onClick={() => setSide(s)} disabled={sweep.active}>
                  {s} side
                </button>
              ))}
            </div>
            {!viewed.run ? (
              <div className="note">{viewed.id} has not been computed: press SIMULATE. Until then there are no wall measurements, and none are drawn.</div>
            ) : (
              <>
              <div className="note">C_f = τ / (½ρU²) from the time-mean velocity beside the wall. h is the height of the dividing streamline above the surface (where the flux along the surface returns to zero after a reversed stretch); where it did not return within the sampled height ({viewed.run.result.profile.count > 0 ? ((viewed.run.result.profile.first + (viewed.run.result.profile.count - 1) * viewed.run.result.profile.step) / viewed.run.result.lattice.cellsPerUnit).toFixed(1) : ''} plate units) h is only a lower bound.</div>
                <div className="plot-grid">
                  <StationChart series={series((s) => s.cf)} title="wall shear C_f (negative: flow beside the wall runs toward the leading edge)" yLabel="C_f" height={140} />
                  <StationChart series={series((s) => s.cp)} title="pressure coefficient C_p beside the wall" yLabel="C_p" height={140} />
                  <StationChart series={series((s) => (s.h ? { mean: s.h.mean, se: s.h.se } : null))} title="height of the reversed-flow region h [plate units]" yLabel="h" height={140} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="column">
          <div className="tabs">
            {(
              [
                ['results', 'Results'],
                ['compare', 'Comparison'],
                ['history', 'History'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`tab ${rightTab === k ? 'on' : ''}`} onClick={() => setRightTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'results' && (
            <div className="section">
              <h2>results of {viewed.id}</h2>
              <CfdMeasurements version={viewed} scenario={scenario} depthCm={depthCheck.ok ? depthCheck.depthCm : depthCm} realReynolds={cond.realReynolds} />
            </div>
          )}
          {rightTab === 'compare' && (
            <div className="section">
              <h2>comparison</h2>
              <CfdCompare project={project} a={cmp[0]} b={cmp[1]} onChange={(a, b) => setCmp([a, b])} scenario={scenario} depthCm={depthCm} realReynolds={cond.realReynolds} />
            </div>
          )}
          {rightTab === 'history' && (
            <div className="section">
              <h2>history</h2>
              <CfdHistory
                project={project}
                viewId={viewed.id}
                onView={setViewId}
                onCompare={(a, b) => {
                  setCmp([a, b]);
                  setRightTab('compare');
                }}
                onUndo={doUndo}
                canUndo={head.origin === 'constructed' && !locked}
                onExport={exportProject}
                onExportCsv={exportCsv}
                onImport={importProject}
                saved={saved}
                onOpenSaved={async (id) => {
                  const p = await store?.store.get(id);
                  if (p) openProject(p);
                }}
                onDeleteSaved={async (id) => {
                  await store?.store.remove(id);
                  setSaved(await (store?.store.list() ?? Promise.resolve([])));
                }}
                persistent={store?.persistent ?? false}
                forceLine={forceLine}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
