import { useEffect, useMemo, useRef, useState } from 'react';
import { profileCSV, safeName, seriesCSV, transferCSV } from '../app/exporters';
import type { Provenance } from '../app/provenance';
import type { Frame, ProfileRequest } from '../workers/protocol';
import { Chart } from './Chart';
import { downloadCanvasPNG, downloadText } from './download';
import { fmt } from './Panels';

const SERIES_UNITS: Record<string, string> = {
  'energy residual (rel.)': '1',
  'momentum residual (rel.)': '1',
  pressure: 'kT₀/d²',
  kT: 'kT₀',
  time: 'τ',
};
const unitOf = (k: string) => SERIES_UNITS[k] ?? (k.startsWith('P_wall') ? 'kT₀/d²' : k.startsWith('F_') ? 'kT₀/d' : '');

type Tab = 'series' | 'profile' | 'transfer';

/** Measurements over time and space for the loaded run: live series, near-wall profile, wall momentum transfer. */
export function AnalysisPanel({
  frame,
  particles,
  provenance,
  profile,
  onProfile,
  onResetWindow,
}: {
  frame: Frame | null;
  particles: number;
  provenance: Provenance | null;
  profile: ProfileRequest | null;
  onProfile: (p: ProfileRequest | null) => void;
  onResetWindow: () => void;
}) {
  const [tab, setTab] = useState<Tab>('series');
  const [key, setKey] = useState('energy residual (rel.)');
  const [quantity, setQuantity] = useState<'ux' | 'uy' | 'kT' | 'numberDensity'>('ux');
  const chartCanvas = useRef<HTMLCanvasElement | null>(null);
  const keys = useMemo(() => Object.keys(frame?.history.columns ?? {}), [frame?.history]);
  useEffect(() => {
    if (keys.length && !keys.includes(key)) setKey(keys.find((k) => /pressure|P_wall/.test(k)) ?? keys[0]);
  }, [keys, key]);

  const d = frame?.domain;
  const pr = frame?.profile ?? null;
  const tr = frame?.transfer ?? null;
  const stem = provenance ? safeName(`${provenance.experimentType}-s${provenance.seeds.join('_')}`) : 'pfad';
  const qLabel = { ux: 'u_x [√(kT₀/m)]', uy: 'u_y [√(kT₀/m)]', kT: 'kT [kT₀]', numberDensity: 'n [1/d²]' }[quantity];

  return (
    <div className="analysis">
      <div className="tabs small">
        <button className={`tab ${tab === 'series' ? 'on' : ''}`} onClick={() => setTab('series')}>
          Time series
        </button>
        <button className={`tab ${tab === 'profile' ? 'on' : ''}`} onClick={() => setTab('profile')}>
          Near-wall profile
        </button>
        <button className={`tab ${tab === 'transfer' ? 'on' : ''}`} onClick={() => setTab('transfer')}>
          Wall momentum transfer
        </button>
      </div>
      {!frame && <div className="note">Load an experiment to see its measurements.</div>}
      {frame && tab === 'series' && (
        <div>
          <div className="toolbar">
            <select value={key} onChange={(e) => setKey(e.target.value)}>
              {keys.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <span className="note">{frame.history.t.length} points of the current run{frame.runCount > 1 ? ` (${frame.runLabel})` : ''}</span>
            <button className="ctl" disabled={!provenance || !frame.history.t.length} onClick={() => provenance && downloadText(`${stem}_series.csv`, seriesCSV(frame.history, provenance, Object.fromEntries(keys.map((k) => [k, unitOf(k)]))), 'text/csv')}>
              CSV
            </button>
            <button className="ctl" disabled={!chartCanvas.current} onClick={() => chartCanvas.current && downloadCanvasPNG(`${stem}_${safeName(key)}.png`, chartCanvas.current, [`${key} vs t — live values (window/running means), not the recorded estimate`], provenance)}>
              PNG
            </button>
          </div>
          <Chart xs={frame.history.t} ys={frame.history.columns[key] ?? []} xLabel="t [τ]" yLabel={`${key}${unitOf(key) ? ` [${unitOf(key)}]` : ''}`} onCanvas={(c) => (chartCanvas.current = c)} />
          <div className="note">Live values as the run reports them; the record&apos;s estimates use block averaging and seed ensembles. Running means start when the current run (or phase) starts.</div>
        </div>
      )}
      {frame && tab === 'profile' && d && (
        <div>
          <div className="toolbar">
            <label className="field-inline">
              <input
                type="checkbox"
                checked={!!profile}
                onChange={(e) =>
                  // default: about 40 particles per bin per snapshot, at most one bin per particle diameter
                  onProfile(e.target.checked ? { x0: d.xmin, x1: d.xmax, bins: Math.max(4, Math.min(Math.floor(d.ymax - d.ymin), Math.round(particles / 40))) } : null)
                }
              />
              measure
            </label>
            {profile && (
              <>
                <span>x from</span>
                <input type="number" step="any" style={{ width: 64 }} value={profile.x0} onChange={(e) => onProfile({ ...profile, x0: Number(e.target.value) })} />
                <span>to</span>
                <input type="number" step="any" style={{ width: 64 }} value={profile.x1} onChange={(e) => onProfile({ ...profile, x1: Number(e.target.value) })} />
                <span>bins</span>
                <input type="number" min={2} max={200} style={{ width: 48 }} value={profile.bins} onChange={(e) => onProfile({ ...profile, bins: Math.max(2, Math.min(200, Math.round(Number(e.target.value) || 2))) })} />
                <select value={quantity} onChange={(e) => setQuantity(e.target.value as typeof quantity)}>
                  <option value="ux">u_x(y)</option>
                  <option value="uy">u_y(y)</option>
                  <option value="kT">kT(y)</option>
                  <option value="numberDensity">n(y)</option>
                </select>
                <button className="ctl" disabled={!pr || !provenance} onClick={() => pr && provenance && downloadText(`${stem}_profile.csv`, profileCSV(pr, provenance), 'text/csv')}>
                  CSV
                </button>
                <button className="ctl" disabled={!pr} onClick={() => chartCanvas.current && downloadCanvasPNG(`${stem}_profile_${quantity}.png`, chartCanvas.current, [`${qLabel} vs height, x in [${pr?.x0}, ${pr?.x1}), ${pr?.snapshots} snapshots — measured`], provenance)}>
                  PNG
                </button>
              </>
            )}
          </div>
          {profile && pr ? (
            <>
              <Chart xs={pr[quantity].map((b) => b.mean)} xErr={pr[quantity].map((b) => b.se)} ys={pr.y} xLabel={qLabel} yLabel="y − y_min [d]" markers onCanvas={(c) => (chartCanvas.current = c)} />
              <div className="note">
                <span className="tag measured">MEASURED</span> Mass-weighted bin averages of particle data in x ∈ [{fmt(pr.x0, 3)}, {fmt(pr.x1, 3)}), {pr.snapshots} snapshot{pr.snapshots === 1 ? '' : 's'} since it was switched on; bars ± 1 SE
                from {pr.batches} batch means (batch independence not checked). No profile shape is fitted or imposed. Whether a near-wall deficit is a boundary layer, and whether any
                viscosity is emergent, is decided by the experiments&apos; acceptance criteria, not by this plot.
              </div>
            </>
          ) : (
            <div className="note">Switch on to accumulate a cross-stream profile (u_x, u_y, kT, n against height) over a chosen x window, e.g. above a plate.</div>
          )}
        </div>
      )}
      {frame && tab === 'transfer' && (
        <div>
          {tr ? (
            <>
              <div className="toolbar">
                <span className="note">
                  window t = {fmt(tr.t0)} … {fmt(tr.t1)} τ
                </span>
                <button className="ctl" onClick={onResetWindow}>
                  restart window
                </button>
                <button className="ctl" disabled={!provenance} onClick={() => provenance && downloadText(`${stem}_wall-transfer.csv`, transferCSV(tr, provenance), 'text/csv')}>
                  CSV
                </button>
              </div>
              <table className="results">
                <thead>
                  <tr>
                    <th>wall</th>
                    <th>L [d]</th>
                    <th>A_w</th>
                    <th>hits</th>
                    <th>P_wall [kT₀/d²]</th>
                    <th>τ_wall [kT₀/d²]</th>
                  </tr>
                </thead>
                <tbody>
                  {tr.walls.map((w) => (
                    <tr key={w.side}>
                      <td>{w.side}</td>
                      <td>{fmt(w.length, 4)}</td>
                      <td>{fmt(w.accommodation, 3)}</td>
                      <td>{w.hits}</td>
                      <td>{fmt(w.pressure)}</td>
                      <td>{fmt(w.shear)}</td>
                    </tr>
                  ))}
                  {tr.bodies.map((b, i) => (
                    <tr key={`b${i}`}>
                      <td>body {i}</td>
                      <td colSpan={2}>F = Δimpulse/Δt</td>
                      <td>{b.hits}</td>
                      <td colSpan={2}>
                        F_x {fmt(b.fx)} · F_y {fmt(b.fy)} kT₀/d
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="note">
                <span className="tag measured">MEASURED</span> P_wall = Σ normal impulse delivered to the wall / (Δt · L); τ_wall = Σ tangential impulse / (Δt · L); body force = Δ(impulse on the body) / Δt.
                Momentum transfer only — no equation of state, no velocity–pressure relation. Time-averaged since the window started (each run or phase restarts it). Lift and drag, where an
                experiment reports them, are components of the same measured impulse.
              </div>
            </>
          ) : (
            <div className="note">This configuration has no walls or bodies (fully periodic): there is no wall momentum transfer to measure.</div>
          )}
        </div>
      )}
    </div>
  );
}
