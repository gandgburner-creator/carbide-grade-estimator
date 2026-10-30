/// <reference lib="webworker" />
import { CfdFillRun } from '../cfd/CfdFill';
import { CfdRun } from '../cfd/CfdRun';
import { GpuCfdRun } from '../cfd/gpu/GpuCfdRun';
import { openGpu } from '../cfd/gpu/LbmGpu';
import type { CfdFromWorker, CfdToWorker, CfdViewKind } from './cfdProtocol';

/**
 * The CFD worker: one lattice Boltzmann run at a time, on the CPU or on the graphics card (WebGPU). It computes in slices of about
 * 30 ms and yields to the message queue between them, so PAUSE and STOP act promptly, and posts a frame of the instantaneous field
 * about four times a second. A run asked for on the card that cannot get one (no WebGPU, too little memory) runs on the CPU and says so.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
type AnyRun = CfdRun | CfdFillRun | GpuCfdRun;
let run: AnyRun | null = null;
let engine: CfdFrameEngine = { kind: 'cpu', adapter: 'JavaScript on the CPU' };
let engineNote: string | undefined;
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
/** bumped by every start, stop and unload: a start that was still waiting for the card gives up when it is no longer the latest */
let startToken = 0;

type CfdFrameEngine = { kind: 'cpu' | 'gpu'; adapter: string };

const post = (m: CfdFromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

async function snap(r: AnyRun, kind: CfdViewKind, stride: number): Promise<{ nx: number; ny: number; values: Float32Array }> {
  return r instanceof GpuCfdRun ? r.snapshot(kind, stride) : r.snapshot(kind, stride);
}

async function frame(r: AnyRun | null = run) {
  if (!r) return;
  const stride = Math.max(1, Math.ceil(r.nx / 300));
  const snapshot = await snap(r, view, stride);
  const l = r.live();
  const flow = vectors ? { ux: await snap(r, 'ux', stride), uy: await snap(r, 'uy', stride) } : null;
  if (r !== run) return;
  post(
    {
      type: 'frame',
      epoch,
      progress: r.progress(),
      phase: l.phase,
      steps: l.steps,
      convective: l.convective,
      blocks: l.blocks,
      fx: l.fx,
      fy: l.fy,
      running,
      activeMs,
      stepsPerSecond: rate,
      tau: r.tau,
      nx: r.nx,
      ny: r.ny,
      cellsPerUnit: r.cpu,
      engine,
      ...(engineNote ? { engineNote } : {}),
      field: { kind: view, nx: snapshot.nx, ny: snapshot.ny, values: snapshot.values, stride },
      ...(flow ? { flow: { nx: flow.ux.nx, ny: flow.ux.ny, ux: flow.ux.values, uy: flow.uy.values, stride } } : {}),
      ...(r instanceof CfdFillRun ? { fill: r.fillState() } : {}),
    },
    flow ? [snapshot.values.buffer, flow.ux.values.buffer, flow.uy.values.buffer] : [snapshot.values.buffer],
  );
  lastFrame = performance.now();
}

function dispose(r: AnyRun | null) {
  if (r instanceof GpuCfdRun) void r.destroy().catch(() => undefined);
}

function fail(message: string) {
  const r = run;
  running = false;
  run = null;
  dispose(r);
  post({ type: 'failed', epoch, message, activeMs });
}

async function loop() {
  try {
    for (;;) {
      const cur = run;
      if (!running || !cur) return;
      const t0 = performance.now();
      if (cur instanceof GpuCfdRun) await cur.advance(30);
      else while (performance.now() - t0 < 30 && cur.phase !== 'done') cur.advance(10);
      if (run !== cur) continue;
      const t1 = performance.now();
      activeMs += t1 - t0;
      if (t1 - rateAt > 1000) {
        rate = ((cur.solver.steps - rateSteps) * 1000) / (t1 - rateAt);
        rateAt = t1;
        rateSteps = cur.solver.steps;
      }
      if (cur.phase === 'done') {
        running = false;
        await frame(cur);
        if (run !== cur) continue;
        if (cur instanceof CfdFillRun) {
          const result = cur.result();
          if (!result.finite) fail(`the simulation became unstable after ${result.steps} steps (the flow was too violent for this resolution and Reynolds number)`);
          else post({ type: 'filled', epoch, result, activeMs });
          return;
        }
        const result = cur.result();
        if (result.integrity.checks.find((c) => c.id === 'stable')?.pass === false) fail(`the simulation became unstable after ${result.steps} steps (the flow was too violent for this resolution and Reynolds number)`);
        else {
          post({ type: 'done', epoch, result, activeMs });
          if (cur instanceof GpuCfdRun) {
            run = null;
            dispose(cur);
          }
        }
        return;
      }
      if (t1 - lastFrame > 250) await frame(cur);
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (e) {
    fail((e as Error).message);
  } finally {
    looping = false;
  }
}

function kick() {
  if (running && !looping) {
    looping = true;
    void loop();
  }
}

/** Build a run on the card, or on the CPU when the card cannot: returns the run and says which it is. */
async function build(m: Extract<CfdToWorker, { type: 'start' }>): Promise<{ run: AnyRun; engine: CfdFrameEngine; note?: string }> {
  if (m.engine === 'gpu') {
    let reason = 'this browser has no WebGPU adapter';
    try {
      const g = await openGpu();
      if (g) {
        try {
          const r = await GpuCfdRun.create(m.params, g.device, g.info);
          return { run: r, engine: { kind: 'gpu', adapter: `${g.info.description || g.info.device || g.info.vendor || 'WebGPU adapter'}${g.info.software ? ' (software implementation)' : ''}` } };
        } catch (e) {
          reason = (e as Error).message;
          g.device.destroy();
        }
      }
    } catch (e) {
      reason = (e as Error).message;
    }
    return { run: new CfdRun(m.params), engine: { kind: 'cpu', adapter: 'JavaScript on the CPU' }, note: `Ran on the CPU instead of the graphics card: ${reason}.` };
  }
  return { run: new CfdRun(m.params), engine: { kind: 'cpu', adapter: 'JavaScript on the CPU' } };
}

function begin(m: { epoch: number; view: CfdViewKind; vectors?: boolean }) {
  epoch = m.epoch;
  view = m.view;
  vectors = !!m.vectors;
  activeMs = 0;
  rate = 0;
  rateAt = performance.now();
  rateSteps = 0;
  engineNote = undefined;
}

ctx.onmessage = (ev: MessageEvent<CfdToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'start': {
      const old = run;
      run = null;
      running = false;
      dispose(old);
      const token = ++startToken;
      begin(m);
      void build(m)
        .then(async (b) => {
          if (token !== startToken) {
            dispose(b.run);
            return;
          }
          run = b.run;
          engine = b.engine;
          engineNote = b.note;
          running = true;
          await frame();
          kick();
        })
        .catch((e) => {
          if (token === startToken) post({ type: 'failed', epoch, message: (e as Error).message, activeMs: 0 });
        });
      return;
    }
    case 'startFill': {
      const old = run;
      run = null;
      running = false;
      dispose(old);
      startToken++;
      begin(m);
      try {
        // the auto fill moves the body inside a running flow: it is computed on the CPU solver
        run = new CfdFillRun(m.params, m.plate, m.paths, m.spacing, m.fill);
        engine = { kind: 'cpu', adapter: 'JavaScript on the CPU' };
        engineNote = 'The auto fill runs on the CPU (it reshapes the body while the flow goes on); a computation of the finished shape can run on the graphics card.';
      } catch (e) {
        run = null;
        post({ type: 'failed', epoch, message: (e as Error).message, activeMs: 0 });
        return;
      }
      running = true;
      void frame().then(kick);
      return;
    }
    case 'finishNow':
      if (run instanceof CfdFillRun && run.phase !== 'done') {
        run.finishEarly();
        running = true;
      }
      break;
    case 'view':
      view = m.kind;
      vectors = !!m.vectors;
      if (run && !running) void frame();
      break;
    case 'pause':
      running = false;
      if (run) void frame();
      break;
    case 'resume':
      if (run && run.phase !== 'done') running = true;
      break;
    case 'stop': {
      startToken++;
      const r = run;
      if (r) post({ type: 'stopped', epoch, message: 'the run was stopped; nothing was kept', activeMs });
      running = false;
      run = null;
      dispose(r);
      break;
    }
    case 'unload': {
      startToken++;
      const r = run;
      running = false;
      run = null;
      dispose(r);
      epoch = m.epoch;
      break;
    }
  }
  kick();
};
