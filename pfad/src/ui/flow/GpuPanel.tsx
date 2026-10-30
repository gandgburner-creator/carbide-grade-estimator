import { useState } from 'react';
import { gpuBytes, type GpuInfo } from '../../cfd/gpu/LbmGpu';
import { runGpuSelfTest, type SelfTestLine } from '../../cfd/gpu/GpuSelfTest';
import { CFD_PRESETS, presetWork } from '../../cfd/CfdRun';

/** "43 s", "7 min", "2.4 h" */
export const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`);

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
            {p.info!.software ? ' — a software implementation of WebGPU: correct but slow; the CPU may be as fast.' : '.'}
            {p.info!.integrated && !p.info!.software && ' This is the graphics of the processor (integrated), not a separate graphics card.'} It allows buffers of up to {Math.round(Math.min(p.info!.maxStorageBufferBindingSize, p.info!.maxBufferSize) / 1048576)} MiB; the finest preset (256 cells) needs about {Math.round(gpuBytes(2304, 1536) / 1048576)} MiB of the card’s memory. The particle universe always runs on the CPU.
          </>
        )}
      </div>
      {ready && p.info!.integrated && !p.info!.software && (
        <details className="note" data-testid="gpu-integrated-help">
          <summary>
            <b>Does your computer have a separate graphics card (for example an RTX)?</b> The browser has given this page the integrated one. Click for how to change that.
          </summary>
          <ol>
            <li>
              <b>Windows:</b> Settings → System → Display → Graphics. Add your browser (<code>chrome.exe</code> or <code>msedge.exe</code>) with “Browse” if it is not in the list, click it → <b>Options</b> → <b>High performance</b> (it should name the NVIDIA card) → Save.
            </li>
            <li>
              <b>NVIDIA Control Panel</b> → Manage 3D settings → Program Settings → add the browser → “Preferred graphics processor”: <b>High-performance NVIDIA processor</b> → Apply.
            </li>
            <li>Close <b>every</b> window of the browser (also from the tray) and open it again, then press TEST THE GPU: the adapter should now name the NVIDIA card and the speed should be many times higher. You can also look at <code>chrome://gpu</code> (the “Dawn info” and GL_RENDERER lines show which card the browser uses).</li>
            <li>On a desktop whose monitor cable is plugged into the motherboard, Windows treats the integrated graphics as the main one: plugging the monitor into the graphics card’s own output helps. If the setting above does not take effect, you can start Chrome with <code>--use-webgpu-power-preference=force-high-performance</code> (put it after the path in the shortcut’s target).</li>
          </ol>
          <div>The integrated graphics still work, and are faster than the CPU here; the separate card is simply much faster still.</div>
        </details>
      )}
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
          Measured speed: <b>{mlups.toFixed(0)} million node updates per second</b> (on a small lattice of 0.2 million nodes: a larger one keeps a card busier, so these are cautious estimates). Time for one run of each resolution at this speed:{' '}
          {(Object.keys(CFD_PRESETS) as (keyof typeof CFD_PRESETS)[]).map((k, i) => {
            const w = presetWork(k);
            return (
              <span key={k}>
                {i ? ' · ' : ''}
                {k} ({CFD_PRESETS[k].cells} cells) {duration((w.nodes * w.steps) / (mlups * 1e6))}
              </span>
            );
          })}
          .
        </div>
      )}
    </div>
  );
}
