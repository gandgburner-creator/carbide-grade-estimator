import { useMemo, useState } from 'react';
import type { ExperimentRecord } from '../experiments/Experiment';
import type { ValidationStatus } from '../validation/Status';
import type { Frame, InspectData } from '../workers/protocol';
import { CATALOG, PHASE0_CRITERIA, type CatalogEntry } from './catalog';

export const fmt = (v: unknown, digits = 4): string => {
  if (typeof v !== 'number') return String(v ?? '—');
  if (!Number.isFinite(v)) return String(v);
  if (v !== 0 && (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e5)) return v.toExponential(digits - 1);
  return Number.isInteger(v) ? String(v) : v.toPrecision(digits);
};

export function Badge({ status }: { status: ValidationStatus | string }) {
  return <span className={`badge ${String(status).replace(' ', '-')}`}>{status}</span>;
}

// ---------------------------------------------------------------- selector
export function ExperimentSelector({
  selected,
  onSelect,
  statuses,
  entries = CATALOG,
  title = 'Experiments — Phase 0',
}: {
  selected: string;
  onSelect: (e: CatalogEntry) => void;
  statuses: Record<string, ValidationStatus>;
  entries?: CatalogEntry[];
  title?: string;
}) {
  return (
    <div className="section">
      <h2>{title}</h2>
      <div className="exp-list">
        {entries.map((e) => (
          <button
            key={e.key}
            className={`exp-item ${selected === e.key ? 'active' : ''} ${e.engine ? '' : 'disabled'}`}
            onClick={() => onSelect(e)}
            title={e.summary}
          >
            <span>
              {e.label}
              <br />
              <span className="step">
                {e.step}
                {e.universe === 'A+variants' ? ' · incl. experimental model variants' : ''}
              </span>
            </span>
            {e.locked ? <Badge status="LOCKED" /> : <Badge status={statuses[e.key] ?? 'UNTESTED'} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- parameters
type Params = Record<string, unknown>;

export function ParamsForm({
  entry,
  params,
  onChange,
  disabled,
  hidden = [],
}: {
  entry: CatalogEntry;
  params: Params;
  onChange: (p: Params) => void;
  disabled: boolean;
  /** parameters that do not apply to this configuration (not shown) */
  hidden?: string[];
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const keys = Object.keys(params).filter((k) => k !== 'seeds' && !hidden.includes(k));
  const set = (k: string, v: unknown) => onChange({ ...params, [k]: v });
  return (
    <div className="params">
      {keys.map((k) => {
        const v = params[k];
        if (typeof v === 'number') {
          return (
            <label key={k}>
              {k}
              <input
                type="number"
                value={drafts[k] ?? String(v)}
                disabled={disabled}
                step="any"
                onChange={(e) => {
                  setDrafts({ ...drafts, [k]: e.target.value });
                  const n = Number(e.target.value);
                  if (e.target.value !== '' && Number.isFinite(n)) set(k, n);
                }}
              />
            </label>
          );
        }
        if (typeof v === 'boolean') {
          return (
            <label key={k} className="check-label">
              <input type="checkbox" checked={v} disabled={disabled} onChange={(e) => set(k, e.target.checked)} />
              {k}
            </label>
          );
        }
        if (typeof v === 'string') {
          const options =
            k === 'distribution'
              ? ['maxwell', 'uniform-speed', 'uniform-box', 'two-beam']
              : k === 'contact'
                ? ['rewind-to-contact', 'impulse-at-detection']
                : k === 'kind' && entry.engine === 'ub-instrument'
                  ? ['static', 'shear', 'sound', 'wall', 'couette']
                  : [v];
          return (
            <label key={k}>
              {k}
              <select value={v} disabled={disabled} onChange={(e) => set(k, e.target.value)}>
                {options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          );
        }
        // arrays and objects: JSON
        const text = drafts[k] ?? JSON.stringify(v);
        let valid = true;
        try {
          JSON.parse(text);
        } catch {
          valid = false;
        }
        return (
          <label key={k} className="wide">
            {k} {valid ? '' : '(invalid JSON)'}
            <input
              value={text}
              disabled={disabled}
              onChange={(e) => {
                setDrafts({ ...drafts, [k]: e.target.value });
                try {
                  set(k, JSON.parse(e.target.value));
                } catch {
                  /* keep draft until valid */
                }
              }}
            />
          </label>
        );
      })}
      <div className="wide note">{entry.summary}</div>
    </div>
  );
}

export function SeedPicker({ seeds, onChange, disabled }: { seeds: number[]; onChange: (s: number[]) => void; disabled: boolean }) {
  const [custom, setCustom] = useState(seeds.join(','));
  const base = seeds[0] ?? 7;
  const pick = (n: number) => {
    const s = Array.from({ length: n }, (_, i) => base + i);
    setCustom(s.join(','));
    onChange(s);
  };
  return (
    <div>
      <div className="seg" style={{ marginBottom: 6 }}>
        {[1, 5, 10].map((n) => (
          <button key={n} className={`ctl ${seeds.length === n ? 'on' : ''}`} disabled={disabled} onClick={() => pick(n)}>
            {n} seed{n > 1 ? 's' : ''}
          </button>
        ))}
      </div>
      <div className="params">
        <label className="wide">
          custom seeds (comma separated)
          <input
            value={custom}
            disabled={disabled}
            onChange={(e) => {
              setCustom(e.target.value);
              const s = e.target.value
                .split(',')
                .map((x) => Number(x.trim()))
                .filter((x) => Number.isInteger(x));
              if (s.length) onChange(s);
            }}
          />
        </label>
      </div>
      <div className="note">Independent samples (seeds): {seeds.length}</div>
    </div>
  );
}

// ---------------------------------------------------------------- live metrics
export function LiveMetrics({ frame }: { frame: Frame | null }) {
  if (!frame) return <div className="note">No experiment loaded.</div>;
  const errors = frame.flags.filter((f) => f.severity === 'failure');
  return (
    <div>
      <div className="kv">
        <div className="row">
          <span className="k">run</span>
          <span>
            {frame.runLabel} ({Math.min(frame.runIndex + 1, frame.runCount)}/{frame.runCount})
          </span>
        </div>
        {Object.entries(frame.live).map(([k, v]) => (
          <div className="row" key={k}>
            <span className="k">{k}</span>
            <span>{fmt(v)}</span>
          </div>
        ))}
      </div>
      <div className="progress">
        <div style={{ width: `${(100 * frame.progress).toFixed(1)}%` }} />
      </div>
      {errors.map((f, i) => (
        <div className="error" key={i}>
          {f.code}: {f.message} (t = {fmt(f.time)}) — simulation halted, nothing repaired
        </div>
      ))}
      {frame.flags
        .filter((f) => f.severity === 'warning')
        .map((f, i) => (
          <div className="warn" key={i}>
            {f.code}: {f.message}
          </div>
        ))}
    </div>
  );
}

export function PerfOverlay({ frame, fps, renderMs }: { frame: Frame | null; fps: number; renderMs: number }) {
  if (!frame) return null;
  const elapsed = frame.activeMs / 1000;
  const p = frame.perf;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const rows: [string, string][] = [
    ['FPS', fmt(fps, 3)],
    ['sim steps/s', fmt(p.stepsPerSecond, 3)],
    ['particles', String(frame.count)],
    ['compute time', `${elapsed.toFixed(1)} s`],
    ['collisions', String(p.collisionCount)],
    ['field ms', fmt(p.fieldMs, 2)],
    ['render ms', fmt(renderMs, 2)],
    ['memory', mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a'],
    ['t [τ]', fmt(p.time)],
    ['dt', fmt(p.dt, 3)],
    ['max |v|', fmt(p.maxSpeed, 3)],
    ['energy error', fmt(p.energyError, 2)],
    ['momentum error', fmt(p.momentumError, 2)],
  ];
  return (
    <div className="perf">
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span style={{ color: 'var(--muted)' }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Inspector({ data }: { data: InspectData | null }) {
  if (!data) return <div className="note">Click a particle to inspect it.</div>;
  const rows: [string, string][] = [
    ['ID', String(data.id)],
    ['position', `(${fmt(data.x)}, ${fmt(data.y)})`],
    ['velocity', `(${fmt(data.vx)}, ${fmt(data.vy)})`],
    ['momentum', `(${fmt(data.mass * data.vx)}, ${fmt(data.mass * data.vy)})`],
    ['kinetic energy', fmt(data.kineticEnergy)],
    ['internal energy', fmt(data.internalEnergy)],
    ['local occupancy φ', fmt(data.localOccupancy)],
    ['∇φ', `(${fmt(data.occupancyGradient[0])}, ${fmt(data.occupancyGradient[1])})`],
    ['collisions', String(data.collisions)],
    ['wall hits', String(data.wallHits)],
    ['trajectory points', String(data.trajectory.length / 2)],
  ];
  return (
    <div>
      <div className="kv">
        {rows.map(([k, v]) => (
          <div className="row" key={k}>
            <span className="k">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <table className="results" style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th>t</th>
            <th>partner</th>
            <th>J</th>
            <th>v_n</th>
            <th>ΔKE</th>
          </tr>
        </thead>
        <tbody>
          {data.recentCollisions.map((c, i) => (
            <tr key={i}>
              <td>{fmt(c.t)}</td>
              <td>{c.partner}</td>
              <td>{fmt(c.J, 3)}</td>
              <td>{fmt(c.vn, 3)}</td>
              <td>{fmt(c.dKE, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">Enable “trails” to record this particle’s trajectory.</div>
    </div>
  );
}

// ---------------------------------------------------------------- record
export function RecordView({ record, compact = false }: { record: ExperimentRecord | null; compact?: boolean }) {
  if (!record) return <div className="note">The record appears when every run has finished.</div>;
  if (compact) return <Headline record={record} />;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{record.title}</b>
        <Badge status={record.status} />
      </div>
      <div className="note" style={{ margin: '4px 0 8px' }}>
        model {record.modelVersion} · seeds {record.seeds.join(', ')} · N = {record.particleCount}
      </div>
      <div className="checks">
        {record.acceptance.map((c) => (
          <div className="check" key={c.id} style={{ borderColor: `var(--${c.status === 'PASSED' ? 'passed' : c.status === 'FAILED' ? 'failed' : 'inconclusive'})` }}>
            <div className="id">
              <Badge status={c.status} /> {c.id}
            </div>
            <div className="detail">
              measured: {c.measured}
              <br />
              criterion: {c.criterion}
            </div>
          </div>
        ))}
      </div>
      <Headline record={record} />
      {record.warnings.slice(0, 8).map((w, i) => (
        <div className="warn" key={i}>
          {w}
        </div>
      ))}
      <div className="note" style={{ marginTop: 6 }}>
        Re: {record.reynolds.note} Mach: {record.mach.note}
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Headline({ record }: { record: ExperimentRecord }) {
  const r = record.results as any;
  const b = record.benchmarks as any;
  if (record.experimentType === 'static-box' && r.elastic?.measuredPressure) {
    const P = r.elastic.measuredPressure;
    const Z = r.elastic.dimensionlessPressure;
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <tbody>
          <tr>
            <td>MEASURED wall pressure</td>
            <td>
              {fmt(P.mean)} ± {fmt(P.se, 2)}
            </td>
          </tr>
          <tr>
            <td>MEASURED P·A/(N·kT)</td>
            <td>
              {fmt(Z?.mean)} [{fmt(Z?.ci95?.[0])}, {fmt(Z?.ci95?.[1])}]
            </td>
          </tr>
          <tr>
            <td>benchmark: ideal gas (ratio)</td>
            <td>{fmt(b.pressure?.idealGas_NkT_over_A?.measuredOverBenchmark)}</td>
          </tr>
          <tr>
            <td>benchmark: hard-disk EOS (ratio)</td>
            <td>{fmt(b.pressure?.hardDiskHenderson?.measuredOverBenchmark)}</td>
          </tr>
          {r.inelasticDecay &&
            Object.entries<any>(r.inelasticDecay).map(([e, d]) => (
              <tr key={e}>
                <td>{e}: collisions/particle to halve P</td>
                <td>
                  {fmt(d.collisionsPerParticleToHalvePressure?.mean)}
                  {d.collisionsPerParticleToHalvePressure?.se ? ` ± ${fmt(d.collisionsPerParticleToHalvePressure.se, 2)}` : ''}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    );
  }
  if ((record.experimentType === 'sound-speed' || record.experimentType === 'sound-speed-sweeps' || record.experimentType === 'sound-speed-linear') && Array.isArray(r.cases)) {
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>case</th>
            <th>MEASURED c_p</th>
            <th>hard-disk ref.</th>
          </tr>
        </thead>
        <tbody>
          {r.cases.map((c: any, i: number) =>
            c ? (
              <tr key={i}>
                <td>{c.label}</td>
                <td>{c.speed ? `${fmt(c.speed.mean)} ± ${fmt(c.speed.se, 2)}` : c.track.reason}</td>
                <td>{fmt(b.perCase?.[i]?.hardDiskAdiabatic ?? b.perCase?.[i]?.occupancyMeanFieldOnly)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    );
  }
  if ((record.experimentType === 'viscosity' || record.experimentType === 'viscosity-sweeps') && Array.isArray(r.cases)) {
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>case</th>
            <th>MEASURED μ_eff</th>
            <th>Kn</th>
            <th>Re_sim</th>
            <th>Enskog ref.</th>
          </tr>
        </thead>
        <tbody>
          {r.cases.map((c: any, i: number) => (
            <tr key={i}>
              <td>{c.label}</td>
              <td>
                {fmt(c.muEff.mean)} ± {fmt(c.muEff.se, 2)}
              </td>
              <td>{fmt(c.knudsen, 3)}</td>
              <td>{fmt(c.reynolds.simulation, 3)}</td>
              <td>{fmt(b.perCase?.[i]?.enskogEta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (record.experimentType === 'boundary-layer' && Array.isArray(r.stations)) {
    return (
      <>
        <div className="note" style={{ marginTop: 8 }}>
          {r.determination}
        </div>
        <table className="results" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>station</th>
              <th>MEASURED U_e</th>
              <th>wall deficit</th>
              <th>δ*</th>
              <th>τ_w</th>
            </tr>
          </thead>
          <tbody>
            {r.stations.map((st: any, i: number) => (
              <tr key={i}>
                <td>{st.label}</td>
                <td>{fmt(st.Ue.mean, 3)}</td>
                <td>
                  {fmt(st.deficitAtWall.mean, 2)} ± {fmt(st.deficitAtWall.se, 1)}
                </td>
                <td>
                  {fmt(st.displacementThickness.mean, 3)} ± {fmt(st.displacementThickness.se, 1)}
                </td>
                <td>{fmt(st.wallShear.mean, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  if (record.experimentType === 'scaling' && Array.isArray(r.perMetric)) {
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>MEASURED outcome</th>
            {r.levels.map((L: any) => (
              <th key={L.name}>
                {L.name} ({fmt(L.size, 3)} d)
              </th>
            ))}
            <th>verdict</th>
          </tr>
        </thead>
        <tbody>
          {r.perMetric.map((m: any) => (
            <tr key={m.metric}>
              <td>{m.metric}</td>
              {m.values.map((v: any, k: number) => (
                <td key={k}>{v.mean === null ? 'n/a' : `${fmt(v.mean, 3)} ± ${fmt(v.se, 2)}`}</td>
              ))}
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (record.experimentType === 'kutta' && Array.isArray(r.cases)) {
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>case</th>
            <th>MEASURED lift</th>
            <th>Γ_body</th>
            <th>TE departure</th>
            <th>finding</th>
          </tr>
        </thead>
        <tbody>
          {r.cases.map((c: any, i: number) =>
            c ? (
              <tr key={i}>
                <td>{c.label}</td>
                <td>
                  {fmt(c.lift.mean, 3)} ± {fmt(c.lift.se, 2)}
                </td>
                <td>
                  {fmt(c.gammaBody.mean, 3)} ± {fmt(c.gammaBody.se, 2)}
                </td>
                <td>
                  {fmt(c.departure.angleToBisectorDeg.mean, 2)}° ± {fmt(c.departure.angleToBisectorDeg.se, 2)}
                </td>
                <td>{String(c.determination).split(':')[0]}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    );
  }
  if (record.experimentType === 'ub-instrument' && r.ensemble) {
    const primary: Record<string, string[]> = {
      static: ['Pnorm', 'Pkin', 'Pcoll', 'T', 'a2', 'collisionRate_p', 'lambda_p'],
      shear: ['nu_p', 'nuRaw_p', 'nuKin_p', 'nuColl_p', 'Tstart', 'Tend'],
      sound: ['c', 'cDensity', 'gamma_p'],
      wall: ['Pwall', 'gw1', 'gw2', 'gw3'],
      couette: ['mu', 'shearRate', 'tauWall', 'slipBottom', 'slipTop'],
    };
    return (
      <table className="results" style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>MEASURED ({r.kind}, Universe A)</th>
            <th>mean ± SE over seeds</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {(primary[r.kind] ?? []).filter((k) => r.ensemble[k]).map((k) => (
            <tr key={k}>
              <td>{k}</td>
              <td>
                {fmt(r.ensemble[k].mean)} ± {fmt(r.ensemble[k].se, 2)}
              </td>
              <td>{r.ensemble[k].n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (record.experimentType === 'separation' && Array.isArray(r.configurations)) {
    return (
      <>
        <table className="results" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>strength</th>
              <th>set</th>
              <th>MEASURED outcome</th>
              <th>outer decel.</th>
              <th>max reverse frac.</th>
            </tr>
          </thead>
          <tbody>
            {r.configurations.map((c: any, i: number) => (
              <tr key={i}>
                <td>{c.strength}</td>
                <td>{c.role}</td>
                <td>
                  {c.classification}
                  {c.separated ? ` at x = ${fmt(c.onset, 3)}` : ''}
                </td>
                <td>{fmt(100 * c.outerDeceleration, 2)} %</td>
                <td>{fmt(c.maxReverseFraction, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.thresholdHypotheses.map((h: any) => (
          <div className="note" key={h.indicator}>
            Hypothesis {h.indicator}:{' '}
            {h.critical === null ? h.note : `critical ${fmt(h.critical, 3)} from ${h.trainedOn} training config(s); test accuracy ${h.classificationAccuracy ?? 'n/a'}`}
          </div>
        ))}
      </>
    );
  }
  return null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function ExportPanel({ record, config, experiment }: { record: ExperimentRecord | null; config: unknown; experiment: string }) {
  const download = (name: string, data: unknown) => {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="seg">
      <button className="ctl" disabled={!record} onClick={() => record && download(`${record.experimentId}.json`, record)}>
        EXPORT RECORD
      </button>
      <button className="ctl" onClick={() => download(`pfad-config-${experiment}.json`, { experiment, params: config })}>
        EXPORT CONFIG
      </button>
    </div>
  );
}

export function AirfoilLock({ statuses }: { statuses: Record<string, ValidationStatus> }) {
  const done = useMemo(() => PHASE0_CRITERIA.filter((c) => c.engine !== null).length, []);
  return (
    <div className="section locked">
      <h2>Airfoil optimisation — locked</h2>
      <div className="note" style={{ marginBottom: 6 }}>
        Unlocks only when every Phase 0 criterion (Master prompt §42) has passed. {done}/{PHASE0_CRITERIA.length} have an
        experiment implemented; results must also pass their checks and convergence studies.
      </div>
      <ul>
        {PHASE0_CRITERIA.map((c) => (
          <li key={c.text}>
            <span>{c.text}</span>
            <Badge status={c.engine ? (statuses[c.engine] ?? 'UNTESTED') : 'UNTESTED'} />
          </li>
        ))}
      </ul>
    </div>
  );
}
