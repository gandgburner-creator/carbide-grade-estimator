import { useCallback, useEffect, useRef, useState } from 'react';
import type { CfdFillConfig, CfdFillResult } from '../../cfd/CfdFill';
import type { CfdParams, CfdResult } from '../../cfd/CfdRun';
import type { PlateSpec, PointerPaths } from '../../geometry/Pointer';
import type { CfdFrame, CfdFromWorker, CfdToWorker, CfdViewKind } from '../../workers/cfdProtocol';

export type CfdPhase = 'idle' | 'running' | 'paused' | 'finished' | 'stopped' | 'failed';

/**
 * One CFD worker for the workspace: start a run, stream frames, deliver the result. Messages from an earlier run are dropped
 * by epoch; the worker's own state, not the click, decides running or paused.
 */
export function useCfd(onResult: (result: CfdResult, activeMs: number) => void, onEnd: (kind: 'stopped' | 'failed', message: string) => void, onFilled?: (result: CfdFillResult, activeMs: number) => void) {
  const workerRef = useRef<Worker | null>(null);
  const epochRef = useRef(0);
  const resultCb = useRef(onResult);
  const endCb = useRef(onEnd);
  const filledCb = useRef(onFilled);
  resultCb.current = onResult;
  endCb.current = onEnd;
  filledCb.current = onFilled;
  const [frame, setFrame] = useState<CfdFrame | null>(null);
  const [phase, setPhase] = useState<CfdPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../../workers/cfd.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onerror = (ev) => setError(`CFD worker error: ${ev.message}`);
    w.onmessage = (ev: MessageEvent<CfdFromWorker>) => {
      const m = ev.data;
      if (m.epoch !== epochRef.current) return;
      switch (m.type) {
        case 'frame':
          setFrame(m);
          setPhase((prev) => (prev === 'finished' || prev === 'stopped' || prev === 'failed' ? prev : m.running ? 'running' : prev === 'running' ? 'paused' : prev));
          break;
        case 'done':
          setPhase('finished');
          resultCb.current(m.result, m.activeMs);
          break;
        case 'filled':
          setPhase('finished');
          filledCb.current?.(m.result, m.activeMs);
          break;
        case 'stopped':
          setPhase('stopped');
          endCb.current('stopped', m.message);
          break;
        case 'failed':
          setPhase('failed');
          endCb.current('failed', m.message);
          break;
      }
    };
    return () => w.terminate();
  }, []);

  const send = useCallback((m: CfdToWorker) => workerRef.current?.postMessage(m), []);
  const start = useCallback(
    (params: CfdParams, view: CfdViewKind, vectors = false) => {
      epochRef.current++;
      setError(null);
      setFrame(null);
      setPhase('running');
      send({ type: 'start', epoch: epochRef.current, params, view, vectors });
    },
    [send],
  );
  const startFill = useCallback(
    (params: CfdParams, plate: PlateSpec, paths: PointerPaths, spacing: number, fill: CfdFillConfig, view: CfdViewKind, vectors = false) => {
      epochRef.current++;
      setError(null);
      setFrame(null);
      setPhase('running');
      send({ type: 'startFill', epoch: epochRef.current, params, plate, paths, spacing, fill, view, vectors });
    },
    [send],
  );
  const finishNow = useCallback(() => send({ type: 'finishNow' }), [send]);
  const setView = useCallback((kind: CfdViewKind, vectors = false) => send({ type: 'view', kind, vectors }), [send]);
  const pause = useCallback(() => {
    send({ type: 'pause' });
    setPhase('paused');
  }, [send]);
  const resume = useCallback(() => {
    send({ type: 'resume' });
    setPhase('running');
  }, [send]);
  const stop = useCallback(() => send({ type: 'stop' }), [send]);
  const unload = useCallback(() => {
    epochRef.current++;
    send({ type: 'unload', epoch: epochRef.current });
    setFrame(null);
    setPhase('idle');
  }, [send]);
  return { frame, phase, error, start, startFill, finishNow, setView, pause, resume, stop, unload };
}
