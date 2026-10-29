import { useState } from 'react';
import { CfdGeometry } from './CfdGeometry';
import { FlowGeometry } from './FlowGeometry';
import { Lab } from './Lab';

/**
 * Three workspaces side by side: the laboratory, the particle flow-guided geometry (A) and the CFD flow-guided geometry (B). All stay mounted (each owns its own worker), so
 * switching does not interrupt a run or lose state.
 */
export function AppShell() {
  const [mode, setMode] = useState<'lab' | 'flow' | 'cfd'>('lab');
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="workspace">
        <button className={mode === 'lab' ? 'on' : ''} onClick={() => setMode('lab')}>
          LABORATORY
        </button>
        <button className={mode === 'flow' ? 'on' : ''} onClick={() => setMode('flow')}>
          FLOW-GUIDED GEOMETRY A · PARTICLES <span className="tag imposed">EXPERIMENTAL</span>
        </button>
        <button className={mode === 'cfd' ? 'on' : ''} onClick={() => setMode('cfd')}>
          FLOW-GUIDED GEOMETRY B · CFD <span className="tag imposed">EXPERIMENTAL</span>
        </button>
      </nav>
      <div className="shell-body" style={{ display: mode === 'lab' ? undefined : 'none' }}>
        <Lab />
      </div>
      <div className="shell-body" style={{ display: mode === 'flow' ? undefined : 'none' }}>
        <FlowGeometry />
      </div>
      <div className="shell-body" style={{ display: mode === 'cfd' ? undefined : 'none' }}>
        <CfdGeometry />
      </div>
    </div>
  );
}
