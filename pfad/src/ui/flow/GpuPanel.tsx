import { useState } from 'react';
import { gpuBytes, type GpuInfo } from '../../cfd/gpu/LbmGpu';
import { runGpuSelfTest, type SelfTestLine } from '../../cfd/gpu/GpuSelfTest';

export type Engine = 'gpu' | 'cpu';

/** The adapter name for display. */
export const adapterName = (i: GpuInfo) => `${i.description || [i.vendor, i.architecture, i.device].filter(Boolean).join(' ') || 'WebGPU adapter'}${i.software ? ' (software implementation)' : ''}`;

/**
 * Where the simulations are computed: the CPU (the solver of Lbm.ts in JavaScript) or this computer's graphics card (the same
 * solver as WebGPU compute shaders). The particle universe always runs on the CPU. A self-test runs the classical cases on the
 * card, with the same thresholds as the CPU tests, and measures its speed.
 */
export function GpuPanel(p: { engine: Engine; onEngine: (e: Engine) => void; info: GpuInfo | null | undefined; disabled: boolean }) {
  const [lines, setLines] = useState<SelfTestLine[]>([]);
  const [testing, setTesting] = useState<'quick' | 'full' | null>(null);
  const [mlups, setMlups] = useState<number | null>(null);
  const checking = p.info === undefined;
  const ready = !!p.info;
  const test = async (full: boolean) => {
    setLines([]);
    setMlups(null);
    setTesting(full ? 'full' : 'quick');
    try {
      const r = await runGpuSelfTest({ cylinders: full, onLine: (l) => setLines((a) => [...a, l]) });
      setMlups(r.mlups ?? null);
    } catch (e) {
      setLines((a) => [...a, { id: 'error', label: 'The self-test stopped', ok: false, detail: (e as Error).message }]);
    } finally {
      setTesting(null);
    }
  };
  return (
    <div className="gpu-panel" data-testid="gpu-panel">
      <div className="seg" style={{ margin: '4px 0' }}>
        <button className={`ctl ${p.engine === 'gpu' ? 'on' : ''}`} disabled={p.disabled || !ready} onClick={() => p.onEngine('gpu')} aria-label="compute on the graphics card" title="the lattice Boltzmann solver as WebGPU compute shaders on this computer's graphics card">
          GPU
        </button>
        <button className={`ctl ${p.engine === 'cpu' ? 'on' : ''}`} disabled={p.disabled} onClick={() => p.onEngine('cpu')} aria-label="compute on the processor" title="the same solver in JavaScript on the processor">
          CPU
        </button>
      </div>
      <div className="note">
        {checking && 'Looking for a graphics card (WebGPU)…'}
        {!checking && !ready && 'No WebGPU adapter was found in this browser, so the CFD runs on the CPU. Use a current Chrome or Edge with hardware acceleration switched on to use the graphics card.'}
        {ready && (
          <>
            Graphics card: <b>{adapterName(p.info!)}</b>
            {p.info!.software ? ' — a software implementation of WebGPU: correct but slow; the CPU may be as fast.' : '.'} It allows buffers of up to {Math.round(Math.min(p.info!.maxStorageBufferBindingSize, p.info!.maxBufferSize) / 1048576)} MiB; the finest preset (256 cells) needs about {Math.round(gpuBytes(2304, 1536) / 1048576)} MiB of the card’s memory. The particle universe always runs on the CPU.
          </>
        )}
      </div>
      <div className="seg" style={{ margin: '4px 0' }}>
        <button className="ctl" disabled={!ready || testing !== null || p.disabled} onClick={() => test(false)} aria-label="test the graphics card" title="the channel-flow case against the exact solution and the CPU solver, and the speed (about a minute)">
          {testing === 'quick' ? 'TESTING…' : 'TEST THE GPU'}
        </button>
        <button className="ctl" disabled={!ready || testing !== null || p.disabled} onClick={() => test(true)} aria-label="full test of the graphics card" title="also the two cylinder cases at Re = 20 and 100 (a few minutes on a graphics card)">
          {testing === 'full' ? 'TESTING…' : 'FULL TEST (CYLINDERS)'}
        </button>
      </div>
      {lines.map((l) => (
        <div key={l.id} className={l.ok ? 'note' : 'warn'}>
          {l.ok ? '✓' : '✗'} <b>{l.label}</b>: {l.detail}
        </div>
      ))}
      {mlups !== null && (
        <div className="note">
          Measured speed: <b>{mlups.toFixed(0)} million node updates per second</b>. A run of {`96 cells (about 0.5 million nodes, 35 000 steps)`} then takes about {Math.max(1, Math.round((0.5e6 * 35000) / (mlups * 1e6)))} s of computing; the finest preset (256 cells, 3.5 million nodes, 170 000 steps) about {Math.max(1, Math.round((3.5e6 * 170000) / (mlups * 1e6) / 60))} min.
        </div>
      )}
    </div>
  );
}
