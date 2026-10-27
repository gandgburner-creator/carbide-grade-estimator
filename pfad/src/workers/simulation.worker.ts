/// <reference lib="webworker" />
import { LabSession } from '../app/LabSession';
import type { FromWorker, ToWorker } from './protocol';

/**
 * Simulation worker: a thin adapter around LabSession, which owns the
 * experiment and produces frames. The loop yields to the message queue between
 * slices so PAUSE/STOP are handled promptly (Master prompt §35).
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const session = new LabSession((msg: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(msg, transfer));

let looping = false;
function loop() {
  if (!session.running) {
    looping = false;
    return;
  }
  session.tick();
  setTimeout(loop, 0);
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  session.handle(ev.data);
  if (session.running && !looping) {
    looping = true;
    loop();
  }
};
