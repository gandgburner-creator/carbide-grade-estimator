import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExperimentRecord, ExperimentType } from '../../experiments/Experiment';
import type { FieldKind, Frame, FromWorker, ToWorker } from '../../workers/protocol';

export type SimPhase = 'idle' | 'loaded' | 'running' | 'paused' | 'finished' | 'stopped' | 'failed';

/**
 * One simulation worker for the workspace: load an experiment, run it, stream frames, deliver the
 * record. Messages from an unloaded experiment are dropped by epoch; the worker's own state, not
 * the click, decides running or paused (a frame queued before PAUSE was handled still says running).
 */
export function useSimulation(onRecord: (record: ExperimentRecord, activeMs: number) => void, onEnd: (kind: 'stopped' | 'failed', message: string) => void) {
  const workerRef = useRef<Worker | null>(null);
  const epochRef = useRef(0);
  const recordCb = useRef(onRecord);
  const endCb = useRef(onEnd);
  recordCb.current = onRecord;
  endCb.current = onEnd;
  const [frame, setFrame] = useState<Frame | null>(null);
  const [phase, setPhase] = useState<SimPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const times = useRef<number[]>([]);

  useEffect(() => {
    const w = new Worker(new URL('../../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onerror = (ev) => setError(`Simulation worker error: ${ev.message}`);
    w.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.epoch !== epochRef.current) return;
      switch (m.type) {
        case 'frame': {
          setFrame(m);
          setPhase((prev) => (prev === 'finished' || prev === 'stopped' || prev === 'failed' ? prev : m.running ? 'running' : prev === 'running' ? 'paused' : prev));
          const now = performance.now();
          times.current = [...times.current.filter((t) => now - t < 1000), now];
          setFps(times.current.length);
          break;
        }
        case 'record':
          setPhase('finished');
          recordCb.current(m.record, m.activeMs);
          break;
        case 'stopped':
          setPhase('stopped');
          endCb.current('stopped', m.message);
          break;
        case 'failed':
          setPhase('failed');
          endCb.current('failed', m.message);
          break;
        case 'error':
          setError(m.message);
          break;
        case 'checkpoint':
          break;
      }
    };
    return () => w.terminate();
  }, []);

  const send = useCallback((m: ToWorker) => workerRef.current?.postMessage(m), []);

  const load = useCallback(
    (experiment: ExperimentType, params: unknown) => {
      epochRef.current++;
      setError(null);
      setFrame(null);
      send({ type: 'init', experiment, params, epoch: epochRef.current });
      setPhase('loaded');
    },
    [send],
  );
  const view = useCallback((field: FieldKind, perCell: number, average: boolean) => send({ type: 'view', field, perCell, average, trails: false, profile: null }), [send]);
  const run = useCallback(() => {
    send({ type: 'run' });
    setPhase('running');
  }, [send]);
  const pause = useCallback(() => {
    send({ type: 'pause' });
    setPhase('paused');
  }, [send]);
  const stop = useCallback(() => send({ type: 'stop' }), [send]);
  const unload = useCallback(() => {
    epochRef.current++;
    send({ type: 'unload', epoch: epochRef.current });
    setFrame(null);
    setPhase('idle');
  }, [send]);

  return { frame, phase, error, fps, load, run, pause, stop, unload, view, send };
}
