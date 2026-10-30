/// <reference lib="webworker" />
import { CfdFillRun } from '../cfd/CfdFill';
import { CfdRun } from '../cfd/CfdRun';
import type { CfdFromWorker, CfdToWorker, CfdViewKind } from './cfdProtocol';

/**
 * The CFD worker: one lattice Boltzmann run at a time. It computes in slices of about 30 ms and yields to the message queue
 * between them, so PAUSE and STOP act promptly, and posts a frame of the instantaneous field about four times a second.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let run: CfdRun | CfdFillRun | null = null;
let epoch = 0;
let running = false;
let view: CfdViewKind = 'speed';
let vectors = false;
let activeMs = 0;
let lastFrame = 0;
let looping = false;
let rate = 0;
let rateAt = 0;
let rateSteps = 0;

const post = (m: CfdFromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

function frame() {
  if (!run) return;
  const stride = Math.max(1, Math.ceil(run.nx / 300));
  const snap = run.snapshot(view, stride);
  const l = run.live();
  const flow = vectors ? { ux: run.snapshot('ux', stride), uy: run.snapshot('uy', stride) } : null;
  post(
    {
      type: 'frame',
      epoch,
      progress: run.progress(),
      phase: l.phase,
      steps: l.steps,
      convective: l.convective,
      blocks: l.blocks,
      fx: l.fx,
      fy: l.fy,
      running,
      activeMs,
      stepsPerSecond: rate,
      tau: run.tau,
      nx: run.nx,
      ny: run.ny,
      cellsPerUnit: run.cpu,
      field: { kind: view, nx: snap.nx, ny: snap.ny, values: snap.values, stride },
      ...(flow ? { flow: { nx: flow.ux.nx, ny: flow.ux.ny, ux: flow.ux.values, uy: flow.uy.values, stride } } : {}),
      ...(run instanceof CfdFillRun ? { fill: run.fillState() } : {}),
    },
    flow ? [snap.values.buffer, flow.ux.values.buffer, flow.uy.values.buffer] : [snap.values.buffer],
  );
  lastFrame = performance.now();
}

function loop() {
  if (!running || !run) {
    looping = false;
    return;
  }
  const t0 = performance.now();
  try {
    while (performance.now() - t0 < 30 && run.phase !== 'done') run.advance(10);
  } catch (e) {
    running = false;
    looping = false;
    post({ type: 'failed', epoch, message: (e as Error).message, activeMs });
    return;
  }
  const t1 = performance.now();
  activeMs += t1 - t0;
  if (t1 - rateAt > 1000) {
    rate = ((run.solver.steps - rateSteps) * 1000) / (t1 - rateAt);
    rateAt = t1;
    rateSteps = run.solver.steps;
  }
  if (run.phase === 'done') {
    running = false;
    looping = false;
    frame();
    if (run instanceof CfdFillRun) {
      const result = run.result();
      if (!result.finite) post({ type: 'failed', epoch, message: `the simulation became unstable after ${result.steps} steps (the flow was too violent for this resolution and Reynolds number)`, activeMs });
      else post({ type: 'filled', epoch, result, activeMs });
      return;
    }
    const result = run.result();
    if (result.integrity.checks.find((c) => c.id === 'stable')?.pass === false) post({ type: 'failed', epoch, message: `the simulation became unstable after ${result.steps} steps (the flow was too violent for this resolution and Reynolds number)`, activeMs });
    else post({ type: 'done', epoch, result, activeMs });
    return;
  }
  if (t1 - lastFrame > 250) frame();
  setTimeout(loop, 0);
}

ctx.onmessage = (ev: MessageEvent<CfdToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'start':
      epoch = m.epoch;
      view = m.view;
      vectors = !!m.vectors;
      activeMs = 0;
      rate = 0;
      rateAt = performance.now();
      rateSteps = 0;
      try {
        run = new CfdRun(m.params);
      } catch (e) {
        run = null;
        post({ type: 'failed', epoch, message: (e as Error).message, activeMs: 0 });
        return;
      }
      running = true;
      frame();
      break;
    case 'startFill':
      epoch = m.epoch;
      view = m.view;
      vectors = !!m.vectors;
      activeMs = 0;
      rate = 0;
      rateAt = performance.now();
      rateSteps = 0;
      try {
        run = new CfdFillRun(m.params, m.plate, m.paths, m.spacing, m.fill);
      } catch (e) {
        run = null;
        post({ type: 'failed', epoch, message: (e as Error).message, activeMs: 0 });
        return;
      }
      running = true;
      frame();
      break;
    case 'finishNow':
      if (run instanceof CfdFillRun && run.phase !== 'done') {
        run.finishEarly();
        running = true;
      }
      break;
    case 'view':
      view = m.kind;
      vectors = !!m.vectors;
      if (run && !running) frame();
      break;
    case 'pause':
      running = false;
      if (run) frame();
      break;
    case 'resume':
      if (run && run.phase !== 'done') running = true;
      break;
    case 'stop':
      if (run) post({ type: 'stopped', epoch, message: 'the run was stopped; nothing was kept', activeMs });
      running = false;
      run = null;
      break;
    case 'unload':
      running = false;
      run = null;
      epoch = m.epoch;
      break;
  }
  if (running && !looping) {
    looping = true;
    loop();
  }
};
