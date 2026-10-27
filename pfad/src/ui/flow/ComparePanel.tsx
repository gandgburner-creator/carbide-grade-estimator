import { useEffect, useMemo, useState } from 'react';
import { compareVersions, fieldDifference, type Comparison, type FieldGrid } from '../../geometry/Compare';
import { geometrySVG } from '../../geometry/Export';
import type { Project } from '../../geometry/History';
import { fmt } from '../Panels';
import { LevelBadge, StationPlots } from './DetectorPanel';
import { FieldMap } from './FieldMap';

const FIELD_UNITS: Record<string, string> = { ux: 'd/τ', uy: 'd/τ', density: 'm/d²', kT: 'kT₀', occupancy: '1' };

/** Two simulated versions side by side: geometry overlay, the stated prediction, every indicator, station curves and field differences. */
export function FlowComparePanel({ project, a, b, onChange, getFields, side }: { project: Project; a: string; b: string; onChange: (a: string, b: string) => void; getFields: (recordId: string) => Promise<FieldGrid | null>; side: 'upper' | 'lower' }) {
  const withRuns = project.versions.filter((v) => v.run);
  const va = project.versions.find((v) => v.id === a);
  const vb = project.versions.find((v) => v.id === b);
  const [field, setField] = useState<'ux' | 'uy' | 'density' | 'kT'>('ux');
  const [fa, setFa] = useState<FieldGrid | null>(null);
  const [fb, setFb] = useState<FieldGrid | null>(null);
  const [selX, setSelX] = useState<number | null>(null);
  const cmp: Comparison | null = useMemo(() => {
    try {
      return va?.run && vb?.run && va.id !== vb.id ? compareVersions(va, vb) : null;
    } catch {
      return null;
    }
  }, [va, vb]);
  useEffect(() => {
    let live = true;
    setFa(null);
    setFb(null);
    if (va?.run && vb?.run) {
      getFields(va.run.recordId).then((f) => live && setFa(f));
      getFields(vb.run.recordId).then((f) => live && setFb(f));
    }
    return () => {
      live = false;
    };
  }, [va, vb, getFields]);
  const diff = useMemo(() => {
    try {
      return fa && fb ? fieldDifference(fa, fb, field) : null;
    } catch {
      return null;
    }
  }, [fa, fb, field]);

  if (withRuns.length < 2) return <div className="note">Comparison needs two simulated versions. Simulate the starting geometry, accept an increment, simulate that too, then compare.</div>;
  const svg = va && vb ? geometrySVG([{ label: `${va.id} ${va.label}`, geometry: va.geometry, style: 'previous' }, { label: `${vb.id} ${vb.label}`, geometry: vb.geometry, style: 'current' }], { title: `${va.id} vs ${vb.id}`, widthPx: 520 }) : '';
  return (
    <div>
      <div className="two-col">
        {(
          [
            ['A (earlier)', a, (v: string) => onChange(v, b)],
            ['B (later)', b, (v: string) => onChange(a, v)],
          ] as const
        ).map(([label, val, set]) => (
          <label className="field" key={label}>
            {label}
            <select value={val} onChange={(e) => set(e.target.value)}>
              {withRuns.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id} — {v.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!cmp ? (
        <div className="note">Choose two different simulated versions.</div>
      ) : (
        <>
          <div className="svg-box" dangerouslySetInnerHTML={{ __html: svg }} />
          {cmp.notes.map((n, i) => (
            <div key={i} className="warn">
              {n}
            </div>
          ))}
          {cmp.conditionChanges.length > 0 && <div className="warn">Conditions differ: {cmp.conditionChanges.join('; ')}</div>}
          {cmp.hypothesis && (
            <div className={`hyp ${cmp.hypothesis.outcome.replace(' ', '-')}`}>
              <div className="row-between">
                <b>The stated prediction</b>
                <span className="badge">{cmp.hypothesis.outcome.toUpperCase()}</span>
              </div>
              <div className="note">{cmp.hypothesis.stated}</div>
              <div>{cmp.hypothesis.detail}</div>
            </div>
          )}
          <h3 className="h3">Indicators (no composite score: each is reported on its own)</h3>
          <table className="results">
            <thead>
              <tr>
                <th>quantity</th>
                <th>A</th>
                <th>B</th>
                <th>B − A ± se</th>
                <th>z</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...(cmp.hypothesis?.delta ? [cmp.hypothesis.delta] : []), ...cmp.indicators].map((d) => (
                <tr key={d.id} title={d.convention}>
                  <td>{d.label}</td>
                  <td>
                    {fmt(d.a, 3)}±{fmt(d.seA, 1)}
                  </td>
                  <td>
                    {fmt(d.b, 3)}±{fmt(d.seB, 1)}
                  </td>
                  <td>
                    {fmt(d.diff, 3)}±{fmt(d.se, 2)}
                  </td>
                  <td>{d.z === null ? '—' : d.z.toFixed(1)}</td>
                  <td>{d.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">Hover a row for what “larger” means. Differences use √(se_A² + se_B²); |z| &lt; 2 is unresolved. Force rows are raw impulse rates (no lift or drag coefficient, no efficiency).</div>
          <h3 className="h3">Detector level</h3>
          <table className="results">
            <tbody>
              {(['upper', 'lower'] as const).map((s) => (
                <tr key={s}>
                  <td>{s}</td>
                  <td>
                    <LevelBadge level={va!.run!.analysis[s].level} />
                  </td>
                  <td>→</td>
                  <td>
                    <LevelBadge level={vb!.run!.analysis[s].level} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="h3">Near-wall measurements along the {side} side</h3>
          <StationPlots analysis={vb!.run!.analysis[side]} other={va!.run!.analysis[side]} otherLabel={`${va!.id} (A)`} selectedX={selX} onSelectX={setSelX} height={120} />
          <div className="note">Dashed grey: A; blue: B; bands ± 1 SE.</div>
          <h3 className="h3">Integrity and reproducibility</h3>
          <table className="results">
            <tbody>
              {(
                [
                  ['A', va!],
                  ['B', vb!],
                ] as const
              ).map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v.run!.integrity.status}</td>
                  <td>E {Number(v.run!.integrity.maxEnergyResidual).toExponential(1)}</td>
                  <td>p {Number(v.run!.integrity.maxMomentumResidual).toExponential(1)}</td>
                  <td>seeds {v.run!.seeds.join(',')}</td>
                  <td>code {v.run!.codeVersion.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="note">Run-to-run spread is the standard error in every cell above (time blocks pooled over seeds). The same configuration and seeds reproduce a run exactly (checked by the test suite).</div>
          <h3 className="h3">Field difference B − A</h3>
          <div className="seg" style={{ marginBottom: 6 }}>
            {(['ux', 'uy', 'density', 'kT'] as const).map((f) => (
              <button key={f} className={`ctl ${field === f ? 'on' : ''}`} onClick={() => setField(f)}>
                {f}
              </button>
            ))}
          </div>
          {diff ? (
            <>
              <FieldMap values={diff.values} nx={diff.nx} ny={diff.ny} kind="ux" signed label={`${field}(B) − ${field}(A)`} units={FIELD_UNITS[field]} width={420} />
              <div className="note">
                <span className="tag derived">DERIVED</span> cell-by-cell difference of the seed-averaged measurement-window means (RMS {fmt(diff.rms, 3)}, max {fmt(diff.maxAbs, 3)}). Cells have only a few hundred particle samples: look for structure, not single cells.
              </div>
            </>
          ) : (
            <div className="note">Field data for both runs are needed (they are stored with the run records in this browser’s library).</div>
          )}
        </>
      )}
    </div>
  );
}
