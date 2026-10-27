import { useState } from 'react';
import { FlowGeometry } from './FlowGeometry';
import { Lab } from './Lab';

/**
 * Two workspaces side by side. Both stay mounted (each owns its own simulation worker), so
 * switching does not interrupt a run or lose state.
 */
export function AppShell() {
  const [mode, setMode] = useState<'lab' | 'flow'>('lab');
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label="workspace">
        <button className={mode === 'lab' ? 'on' : ''} onClick={() => setMode('lab')}>
          LABORATORY
        </button>
        <button className={mode === 'flow' ? 'on' : ''} onClick={() => setMode('flow')}>
          FLOW-GUIDED GEOMETRY <span className="tag imposed">EXPERIMENTAL</span>
        </button>
      </nav>
      <div className="shell-body" style={{ display: mode === 'lab' ? undefined : 'none' }}>
        <Lab />
      </div>
      <div className="shell-body" style={{ display: mode === 'flow' ? undefined : 'none' }}>
        <FlowGeometry />
      </div>
    </div>
  );
}
