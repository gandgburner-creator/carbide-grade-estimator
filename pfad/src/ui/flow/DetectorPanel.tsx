import { useMemo, useState } from 'react';
import { LEVEL_TEXT, LEVELS, type Level, type SurfaceFlowAnalysis } from '../../measurements/SeparationDetector';
import { Chart } from '../Chart';
import { fmt } from '../Panels';
import { StationChart, type StationSeries } from './StationChart';

const LEVEL_COLOR: Record<Level, string> = {
  NONE: '#6e7681',
  REDUCED_FORWARD_VELOCITY: '#d29922',
  LOCAL_REVERSAL: '#db6d28',
  CANDIDATE_SEPARATION: '#f0883e',
  CONFIRMED_OPERATIONAL: '#f85149',
};

export function LevelBadge({ level }: { level: Level }) {
  return (
    <span className="badge" style={{ color: LEVEL_COLOR[level], borderColor: LEVEL_COLOR[level] }} title={LEVEL_TEXT[level]}>
      {level.replace(/_/g, ' ')}
    </span>
  );
}

/** The detector's findings for one side: level, evidence, criteria, sensitivity, stations — and how they are computed. */
export function DetectorPanel({ analysis, window: win, onSelectX, selectedX }: { analysis: SurfaceFlowAnalysis | null; window: { t0: number; t1: number } | null; onSelectX: (x: number) => void; selectedX: number | null }) {
  const [open, setOpen] = useState(false);
  if (!analysis) return <div className="note">No measurement yet: simulate this geometry to measure its near-wall flow.</div>;
  const a = analysis;
  const st = a.primary.stations;
  const regionKind = a.region?.kind;
  return (
    <div>
      <div className="exp-banner">EXPERIMENTAL DETECTOR — {a.label}</div>
      <div className="row-between" style={{ margin: '6px 0' }}>
        <span>
          {a.side} side · <LevelBadge level={a.level} />
        </span>
        <span className="note">{a.detector}</span>
      </div>
      <div className="note">{LEVEL_TEXT[a.level]}</div>
      <ol className="level-scale">
        {LEVELS.map((l) => (
          <li key={l} className={l === a.level ? 'on' : LEVELS.indexOf(l) < LEVELS.indexOf(a.level) ? 'below' : ''} style={l === a.level ? { borderColor: LEVEL_COLOR[l], color: LEVEL_COLOR[l] } : undefined}>
            {l.replace(/_/g, ' ').toLowerCase()}
          </li>
        ))}
      </ol>
      <div className="note">
        Time window used: {win ? `t = ${win.t0.toFixed(0)} … ${win.t1.toFixed(0)} τ (after the start-up)` : 'n/a'} · {a.data.runs} seed{a.data.runs === 1 ? '' : 's'} ({a.data.seeds.join(', ')}) · {a.data.blocks} time blocks of {a.data.blockSnapshots}{' '}
        snapshots · analysis stations {a.primary.stations[0]?.length.toFixed(1)} d wide, normal bins {a.primary.dn} d · t-critical {a.primary.tCritical.toFixed(2)} (α = {a.spec.alpha}).
      </div>
      {a.level !== a.levelBeforeSensitivity && (
        <div className="warn">
          The primary analysis reached {a.levelBeforeSensitivity.replace(/_/g, ' ')}; the sensitivity test lowered it to {a.level.replace(/_/g, ' ')}.
        </div>
      )}
      {a.reasons.length > 0 && (
        <details open>
          <summary className="note">Why not higher</summary>
          <ul className="plain">
            {a.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
      {a.region && (
        <div style={{ marginTop: 6 }}>
          <b>
            {regionKind === 'reversed' ? 'Backflow region' : 'Reduced-velocity region'} x = {a.region.xLo.toFixed(1)} … {a.region.xHi.toFixed(1)} d
          </b>
          <span className="note"> (region-mean Q_w {fmt(a.region.meanQw, 3)}, u1 {fmt(a.region.meanU1, 3)})</span>
          <table className="results" style={{ marginTop: 4 }}>
            <thead>
              <tr>
                <th>criterion</th>
                <th>measured</th>
                <th>needs</th>
                <th>pass</th>
              </tr>
            </thead>
            <tbody>
              {a.region.criteria.map((c) => (
                <tr key={c.id} title={c.description}>
                  <td>{c.id}</td>
                  <td>{c.value}</td>
                  <td>{c.threshold}</td>
                  <td style={{ color: c.pass === true ? 'var(--passed)' : c.pass === false ? 'var(--failed)' : 'var(--muted)' }}>{c.pass === true ? 'yes' : c.pass === false ? 'no' : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details style={{ marginTop: 6 }}>
        <summary className="note">Sensitivity: does the finding survive a change of analysis resolution?</summary>
        <table className="results">
          <thead>
            <tr>
              <th>variant</th>
              <th>level</th>
              <th>region onset</th>
            </tr>
          </thead>
          <tbody>
            {a.variants.map((v) => (
              <tr key={v.name}>
                <td>{v.name}</td>
                <td>{v.level.replace(/_/g, ' ').toLowerCase()}</td>
                <td>{v.onsetX === null ? '—' : `${v.onsetX.toFixed(1)} d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note">Particle size and count cannot be varied within one run: resolution sensitivity is tested only by comparing runs made at different particle scales, and is not part of these criteria.</div>
      </details>
      <details style={{ marginTop: 6 }} open>
        <summary className="note">Stations (click a row to see its profile)</summary>
        <div className="table-scroll" style={{ maxHeight: 230 }}>
          <table className="results tight">
            <thead>
              <tr>
                <th>x</th>
                <th>u1</th>
                <th>u_outer</th>
                <th>Q_w</th>
                <th>τ</th>
                <th>h_ds</th>
                <th>flags</th>
              </tr>
            </thead>
            <tbody>
              {st.map((s) => (
                <tr key={s.index} onClick={() => onSelectX(s.x)} className={selectedX !== null && Math.abs(selectedX - s.x) < 1e-6 ? 'sel' : ''} style={{ cursor: 'pointer' }}>
                  <td>{s.x.toFixed(1)}</td>
                  <td>
                    {fmt(s.u1.mean, 2)}±{fmt(s.u1.se, 1)}
                  </td>
                  <td>{fmt(s.uOuter.mean, 2)}</td>
                  <td>
                    {fmt(s.qw.mean, 2)}±{fmt(s.qw.se, 1)}
                  </td>
                  <td>
                    {fmt(s.tau.mean, 2)}±{fmt(s.tau.se, 1)}
                  </td>
                  <td>{s.hds.state === 'attached' ? '—' : `${fmt(s.hds.value, 2)}${s.hds.state === 'open' ? '+' : ''}`}</td>
                  <td style={{ textAlign: 'left' }} title="slow: u1 significantly below the outer flow · u<0, Q<0, τ<0: significantly reversed · ref?: no significantly forward reference flow, nothing is flagged · n<min: fewer near-wall samples than the detector requires">
                    {[s.flags.reduced && 'slow', s.flags.reversed && 'u<0', s.flags.fluxReversed && 'Q<0', s.flags.shearReversed && 'τ<0', !s.forward && 'ref?', !s.sufficient && 'n<min'].filter(Boolean).join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <button className="linklike" style={{ marginTop: 6 }} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} How these are measured and what they are not
      </button>
      {open && (
        <ul className="plain">
          <li>
            <span className="tag measured">MEASURED</span> u1: mean velocity along the surface (downstream = leading → trailing edge) of the particles within {a.spec.nearLayer} d of the wall; u_outer: the same in the top {a.spec.outerLayer} d of the sampled
            window; τ: downstream wall shear from the body’s own tangential impulse tally.
          </li>
          <li>
            <span className="tag derived">DERIVED</span> Q_w: net mass flux along the surface within {a.spec.fluxLayer} d of the wall (negative = backflow); h_ds: height where the cumulative flux returns to zero — the dividing streamline of the mean flow
            (assumes a statistically stationary flow); a station is “reversed” only against a significantly forward outer flow.
          </li>
          <li>
            <span className="tag imposed">CONVENTION</span> Every threshold ({a.spec.id}: α {a.spec.alpha}, persistence {a.spec.persistence}, {a.spec.minSeeds} seeds, {a.spec.minSamples} samples, deficit {a.spec.deficitFraction}) was fixed before any flow data were examined and is
            recorded with the result. They are not physical constants.
          </li>
          <li>
            <span className="tag reference">NOT VALIDATED</span> No independent separation criterion has been compared with this detector. PFAD’s earlier separation study (Item 3) was INCONCLUSIVE; this does not revise it. Standard errors come from time blocks pooled over seeds (independence assumed, not
            tested).
          </li>
        </ul>
      )}
    </div>
  );
}

/** u_t(n) and the cumulative flux Q(n) at one station. */
export function ProfilePanel({ analysis, selectedX }: { analysis: SurfaceFlowAnalysis | null; selectedX: number | null }) {
  const idx = useMemo(() => {
    if (!analysis || selectedX === null) return -1;
    return analysis.primary.stations.findIndex((s) => Math.abs(s.x - selectedX) < 1e-6);
  }, [analysis, selectedX]);
  if (!analysis || idx < 0) return <div className="note">Click a station in the plots or the table to see its near-wall profile.</div>;
  const p = analysis.profiles[idx];
  const s = analysis.primary.stations[idx];
  const n = p.n.map((t) => t - analysis.primary.dn / 2);
  return (
    <div className="two-col">
      <div>
        <Chart xs={p.ut.map((e) => e.mean)} xErr={p.ut.map((e) => e.se)} ys={n} xLabel="u_t [d/τ]" yLabel="distance from wall [d]" markers height={170} />
        <div className="note">
          <span className="tag measured">MEASURED</span> mean velocity along the surface by normal bin, ± 1 SE (time blocks), station x = {s.x.toFixed(1)} d on the {analysis.side} side.
        </div>
      </div>
      <div>
        <Chart xs={p.q.map((e) => e.mean)} xErr={p.q.map((e) => e.se)} ys={p.n} xLabel="Q [m/(d·τ)]" yLabel="height of the strip top [d]" markers color="#39c5cf" height={170} />
        <div className="note">
          <span className="tag derived">DERIVED</span> cumulative mass flux from the wall: negative where the flow carries mass backward; h_ds = {s.hds.state === 'attached' ? 'none (no significant backflow)' : `${s.hds.value.toFixed(2)} d${s.hds.state === 'open' ? ' or more (does not close within the window)' : ''}`}.
        </div>
      </div>
    </div>
  );
}

/** The four station plots for one side: u1, Q_w, τ, h_ds along the chord, optionally against another run. */
export function StationPlots({
  analysis,
  other,
  otherLabel,
  selectedX,
  onSelectX,
  height = 130,
}: {
  analysis: SurfaceFlowAnalysis | null;
  other?: SurfaceFlowAnalysis | null;
  otherLabel?: string;
  selectedX: number | null;
  onSelectX: (x: number) => void;
  height?: number;
}) {
  if (!analysis) return <div className="note">No measurement yet.</div>;
  const st = analysis.primary.stations;
  const region = analysis.region
    ? { xLo: analysis.region.xLo, xHi: analysis.region.xHi, color: analysis.region.kind === 'reversed' ? '#f85149' : '#d29922', label: analysis.region.kind === 'reversed' ? 'backflow region' : 'slow region' }
    : null;
  const mk = (label: string, color: string, rows: typeof st, pick: (s: (typeof st)[number]) => { mean: number; se: number }, dashed = false): StationSeries => ({ label, color, x: rows.map((s) => s.x), y: rows.map((s) => pick(s).mean), se: rows.map((s) => pick(s).se), dashed });
  const series = (pick: (s: (typeof st)[number]) => { mean: number; se: number }): StationSeries[] => [
    ...(other ? [mk(otherLabel ?? 'other', '#8b98a5', other.primary.stations, pick, true)] : []),
    mk('this run', '#58a6ff', st, pick),
  ];
  return (
    <div className="plot-grid">
      <StationChart title="near-wall velocity u1" yLabel="u1 [d/τ]" series={series((s) => s.u1)} region={region} selectedX={selectedX} onSelect={onSelectX} height={height} />
      <StationChart title="net near-wall flux Q_w (negative = backflow)" yLabel="Q_w" series={series((s) => s.qw)} region={region} selectedX={selectedX} onSelect={onSelectX} height={height} />
      <StationChart title="downstream wall shear τ (from wall impulses)" yLabel="τ [kT₀/d²]" series={series((s) => s.tau)} region={region} selectedX={selectedX} onSelect={onSelectX} height={height} />
      <StationChart title="dividing-streamline height h_ds (0 = no significant backflow)" yLabel="h_ds [d]" series={series((s) => ({ mean: s.hds.state === 'unknown' ? Number.NaN : s.hds.value, se: s.hds.state === 'attached' || !Number.isFinite(s.hds.se) ? 0 : s.hds.se }))} region={region} selectedX={selectedX} onSelect={onSelectX} height={height} />
    </div>
  );
}
