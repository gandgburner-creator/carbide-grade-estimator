import { blockAverage, halfMeans, mean } from '../measurements/Statistics';
import { runDensity, type UB0Result } from './UB0Run';
import { occupancyStressMF, wallMFStatistic, type DensityBins } from './WallStress';

/**
 * Per-run estimators for UB-0 (design §11.3–§11.4, amendment A1 §2.4, §4.2).
 * Each takes one run's result and returns per-run numbers; ensemble statistics
 * over seeds are formed elsewhere (seed = unit of replication).
 *
 * Units: molecular (m = d = kT = 1) unless a name says `_p` (parcel units D, σ_v).
 */

// ───────────── fitting helpers (tested on synthetic data) ─────────────

/** Golden-section minimisation of f on [a, b]. */
export function goldenMin(f: (x: number) => number, a: number, b: number, iters = 200): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < iters; i++) {
    if (f1 < f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    }
  }
  return 0.5 * (a + b);
}

/**
 * Least squares in LINEAR amplitude: y ≈ A₀ exp(−b x). For fixed b, A₀ is
 * linear; b is found by golden section on [b₀/20, 20 b₀] around a log-linear
 * start b₀ (positive samples only). Unbiased by low SNR, unlike a log fit.
 */
export function expDecayFit(x: number[], y: number[]): { A0: number; b: number; rss: number } {
  const n = x.length;
  if (n < 3) return { A0: Number.NaN, b: Number.NaN, rss: Number.NaN };
  // start: log-linear fit on positive values
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    if (!(y[i] > 0)) continue;
    const ly = Math.log(y[i]);
    sx += x[i];
    sy += ly;
    sxx += x[i] * x[i];
    sxy += x[i] * ly;
    m++;
  }
  let b0 = m >= 2 ? -(m * sxy - sx * sy) / (m * sxx - sx * sx) : 1 / (x[n - 1] - x[0]);
  if (!(b0 > 0)) b0 = 1 / Math.max(1e-12, x[n - 1] - x[0]);
  const amp = (b: number) => {
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-b * x[i]);
      num += y[i] * e;
      den += e * e;
    }
    return num / den;
  };
  const rss = (b: number) => {
    const A = amp(b);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - A * Math.exp(-b * x[i]);
      s += r * r;
    }
    return s;
  };
  const lb = Math.log(b0 / 20);
  const ub = Math.log(b0 * 20);
  const b = Math.exp(goldenMin((u) => rss(Math.exp(u)), lb, ub));
  return { A0: amp(b), b, rss: rss(b) };
}

/**
 * Damped oscillation y ≈ e^{−γt}(a cos ωt + b sin ωt), variable projection:
 * (a, b) by linear least squares for each (ω, γ); ω by a grid around the best
 * periodogram peak then golden refinement; γ by golden section.
 */
export function dampedCosFit(t: number[], y: number[]): { omega: number; gamma: number; a: number; b: number; rss: number } {
  const n = t.length;
  const lin = (w: number, g: number) => {
    let cc = 0;
    let ss = 0;
    let cs = 0;
    let yc = 0;
    let ys = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-g * t[i]);
      const c = e * Math.cos(w * t[i]);
      const s = e * Math.sin(w * t[i]);
      cc += c * c;
      ss += s * s;
      cs += c * s;
      yc += y[i] * c;
      ys += y[i] * s;
    }
    const det = cc * ss - cs * cs;
    const a = (yc * ss - ys * cs) / det;
    const b = (ys * cc - yc * cs) / det;
    let rss = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.exp(-g * t[i]);
      const r = y[i] - e * (a * Math.cos(w * t[i]) + b * Math.sin(w * t[i]));
      rss += r * r;
    }
    return { a, b, rss };
  };
  // ω start: periodogram peak |Σ y e^{−iωt}|² on a grid from 2π/span to the Nyquist
  // frequency with spacing 2π/(4·span) (robust to noise in the decayed tail)
  const span = t[n - 1] - t[0];
  const dtMean = span / (n - 1);
  const wMin = (2 * Math.PI) / span;
  const wMax = Math.PI / dtMean;
  const dW = (2 * Math.PI) / (4 * span);
  let w0 = wMin;
  let pBest = -1;
  for (let w = wMin; w <= wMax; w += dW) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += y[i] * Math.cos(w * t[i]);
      im += y[i] * Math.sin(w * t[i]);
    }
    const pw = re * re + im * im;
    if (pw > pBest) {
      pBest = pw;
      w0 = w;
    }
  }
  const bestGamma = (w: number) => goldenMin((g) => lin(w, g).rss, 0, (20 * Math.PI) / span, 80);
  // refine within ±2 periodogram spacings
  let bestW = w0;
  let bestR = Infinity;
  for (let k = 0; k <= 40; k++) {
    const w = w0 + dW * (-2 + (4 * k) / 40);
    if (!(w > 0)) continue;
    const r = lin(w, bestGamma(w)).rss;
    if (r < bestR) {
      bestR = r;
      bestW = w;
    }
  }
  const dw = dW / 10;
  const omega = goldenMin((w) => lin(w, bestGamma(w)).rss, bestW - 2 * dw, bestW + 2 * dw, 80);
  const gamma = bestGamma(omega);
  const r = lin(omega, gamma);
  return { omega, gamma, a: r.a, b: r.b, rss: r.rss };
}

// ───────────── static boxes ─────────────

export interface StaticEstimate {
  Nc: number;
  phi: number;
  /** parcel number density (molecular) */
  np: number;
  T: number;
  Tint: number;
  TkinOverTint: number;
  a2: number;
  Pkin: number;
  Pcoll: number;
  Pocc: number;
  /** temperature-normalised pressure (P_kin + P_coll)/T + P_occ (design §11.4) */
  Pnorm: number;
  PnormSE: number;
  PnormReliable: boolean;
  /** stationarity: first- vs second-half means of Pnorm */
  PnormHalves: [number, number];
  S: number[];
  SSE: number[];
  /** collisions per parcel per D/σ_v */
  collisionRate_p: number;
  /** mean free path / D */
  lambda_p: number;
  psi6?: number;
  /** self-diffusion coefficient in D σ_v units (slope of ⟨Δr²⟩/4 over the second half) */
  Dself_p?: number;
  gr?: { r: number[]; g: number[] };
  maxRelEnergyResidual: number;
  maxMomentumResidual: number;
}

export function staticEstimate(r: UB0Result): StaticEstimate {
  const S = r.samples.slice(1); // the first sample closes a partial interval
  const m = r.map;
  const T = mean(S.map((s) => s.Tkin));
  const Tint = m.Nc > 1 ? mean(S.map((s) => s.Tint)) : Number.NaN;
  const pn = S.map((s) => (s.Pkin + s.Pcoll) / T + s.Pocc);
  const b = blockAverage(pn);
  const shells = [1, 2, 3].map((i) => S.map((s) => s[`S${i}`]));
  const t0 = S[0].t;
  const t1 = S[S.length - 1].t;
  const N = r.info.parcels;
  const rate = ((S[S.length - 1].collisions - S[0].collisions) * 2) / (N * (t1 - t0));
  const meanSpeed = mean(S.map((s) => s.meanSpeed));
  // λ = ⟨|v|⟩ / ν_c in molecular units; rate is per D/σ_v = per N_c molecular time units
  const lambda = (meanSpeed * m.Nc) / rate;
  const out: StaticEstimate = {
    Nc: m.Nc,
    phi: r.spec.phi,
    np: runDensity(r.spec, m),
    T,
    Tint,
    TkinOverTint: m.Nc > 1 ? T / Tint : Number.NaN,
    a2: mean(S.map((s) => s.a2)),
    Pkin: mean(S.map((s) => s.Pkin)),
    Pcoll: mean(S.map((s) => s.Pcoll)),
    Pocc: mean(S.map((s) => s.Pocc)),
    Pnorm: b.mean,
    PnormSE: b.se,
    PnormReliable: b.reliable,
    PnormHalves: (() => {
      const h = halfMeans(pn);
      return [h.first, h.second] as [number, number];
    })(),
    S: shells.map((xs) => mean(xs)),
    SSE: shells.map((xs) => blockAverage(xs).se),
    collisionRate_p: rate,
    lambda_p: lambda / m.diameter,
    maxRelEnergyResidual: Math.max(...S.map((s) => Math.abs(s.energyResidual))) / Math.abs((r.phaseLedgers.measure as { E0: number }).E0),
    maxMomentumResidual: Math.max(...S.map((s) => s.momentumResidual)),
  };
  const psi = S.filter((s) => s.psi6 !== undefined).map((s) => s.psi6);
  if (psi.length) out.psi6 = mean(psi);
  const msd = r.tallies.msd;
  if (msd && msd.length > 4) {
    const h = Math.floor(msd.length / 2);
    const xs = msd.slice(h).map((p) => p.t);
    const ys = msd.slice(h).map((p) => p.msd / (m.diameter * m.diameter));
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
    }
    out.Dself_p = sxy / sxx / 4;
  }
  if (r.tallies.gr && r.tallies.grSnapshots) {
    const gr = r.tallies.gr;
    const rmax = 3 * m.diameter;
    const bw = rmax / gr.length;
    const n = runDensity(r.spec, m);
    const g: number[] = [];
    const rr: number[] = [];
    for (let i = 0; i < gr.length; i++) {
      const shell = Math.PI * ((i + 1) ** 2 - i ** 2) * bw * bw;
      g.push(gr[i] / (r.tallies.grSnapshots * N * n * shell));
      rr.push(((i + 0.5) * bw) / m.diameter);
    }
    out.gr = { r: rr, g };
  }
  return out;
}

// ───────────── shear wave ─────────────

export interface ShearEstimate {
  Nc: number;
  /** ν in D σ_v units (= molecular d c_th), thermal-time fit at T = 1 */
  nu_p: number;
  /** ν from a raw-time fit (no heating correction) */
  nuRaw_p: number;
  A0: number;
  /** fit window in thermal time (D/σ_v) and number of samples */
  window: [number, number];
  nFit: number;
  /** stress decomposition: ν contributions (kinetic, collisional, occupancy) from the projected stress */
  nuKin_p: number;
  nuColl_p: number;
  nuOcc_p: number;
  nuStress_p: number;
  /** occupancy share s_occ = |ν_occ|/|ν_total| (PQ8) */
  occShare: number;
  /** temperature rise over the run and the cos-mode amplitude (noise check) */
  Tstart: number;
  Tend: number;
  rmsUc: number;
  /** PQ7(b): |energy residual at the end| / imposed wave energy */
  driftOverWave: number;
  maxMomentumResidual: number;
}

/** tauD_p: design time scale 1/(ν_D k_p²) in D/σ_v (amendment A1 §4.2). */
export function shearEstimate(r: UB0Result, tauD_p: number): ShearEstimate {
  const S = r.samples;
  const m = r.map;
  const L_p = r.spec.L!;
  const k_p = (2 * Math.PI) / L_p;
  // thermal time s = ∫ √T dt (T_ref = 1), trapezoid from the first sample (t ≈ 0)
  const s: number[] = [S[0].t * Math.sqrt(S[0].Tkin)];
  for (let i = 1; i < S.length; i++) {
    s.push(s[i - 1] + 0.5 * (Math.sqrt(S[i].Tkin) + Math.sqrt(S[i - 1].Tkin)) * (S[i].t - S[i - 1].t));
  }
  const lo = 0.1 * tauD_p;
  const hi = Math.min(1.5 * tauD_p, s[s.length - 1]);
  const idx: number[] = [];
  for (let i = 0; i < S.length; i++) if (s[i] >= lo && s[i] <= hi) idx.push(i);
  const fit = expDecayFit(
    idx.map((i) => s[i]),
    idx.map((i) => S[i].Us),
  );
  const tIdx: number[] = [];
  for (let i = 0; i < S.length; i++) if (S[i].t >= lo && S[i].t <= Math.min(1.5 * tauD_p, S[S.length - 1].t)) tIdx.push(i);
  const raw = expDecayFit(
    tIdx.map((i) => S[i].t),
    tIdx.map((i) => S[i].Us),
  );
  // stress decomposition over the same window: a_c(t) = −μ_c k U(t)
  const k = k_p / m.diameter; // molecular wavenumber
  const rho = m.massDensity;
  let sumU = 0;
  let ak = 0;
  let ac = 0;
  let ao = 0;
  for (const i of idx) {
    sumU += S[i].Us;
    ak += S[i].akc;
    ac += S[i].acc;
    ao += S[i].aoc;
  }
  const nuOf = (a: number) => -a / (k * sumU) / rho; // molecular ν = parcel-unit ν (D σ_v = 1)
  const nuKin = nuOf(ak);
  const nuColl = nuOf(ac);
  const nuOcc = nuOf(ao);
  const nuTot = nuKin + nuColl + nuOcc;
  const E0wave = r.info.imposedKineticEnergy;
  const last = S[S.length - 1];
  return {
    Nc: m.Nc,
    nu_p: fit.b / (k_p * k_p),
    nuRaw_p: raw.b / (k_p * k_p),
    A0: fit.A0,
    window: [lo, hi],
    nFit: idx.length,
    nuKin_p: nuKin,
    nuColl_p: nuColl,
    nuOcc_p: nuOcc,
    nuStress_p: nuTot,
    occShare: Math.abs(nuOcc) / Math.abs(nuTot),
    Tstart: S[0].Tkin,
    Tend: last.Tkin,
    rmsUc: Math.sqrt(mean(S.map((q) => q.Uc * q.Uc))),
    driftOverWave: Math.abs(last.energyResidual) / E0wave,
    maxMomentumResidual: Math.max(...S.map((q) => q.momentumResidual)),
  };
}

// ───────────── standing sound wave ─────────────

export interface SoundEstimate {
  Nc: number;
  /** phase speed ω/k in molecular units (c/c_th) */
  c: number;
  /** from the density mode (secondary) */
  cDensity: number;
  /** amplitude damping rate per D/σ_v */
  gamma_p: number;
  window: [number, number];
  driftOverWave: number;
}

/** periodHint_p: the plan's period L/c_lo in D/σ_v; the fit skips the first 2 periods. */
export function soundEstimate(r: UB0Result, periodHint_p: number): SoundEstimate {
  const S = r.samples;
  const m = r.map;
  const k_p = (2 * Math.PI) / r.spec.L!;
  const lo = 2 * periodHint_p;
  const sel = S.filter((q) => q.t >= lo);
  const t = sel.map((q) => q.t - lo);
  const v = dampedCosFit(t, sel.map((q) => q.Vs));
  const d = dampedCosFit(t, sel.map((q) => q.Rc));
  const toMol = (omega_p: number) => (omega_p / k_p) * m.sigmaV;
  const last = S[S.length - 1];
  return {
    Nc: m.Nc,
    c: toMol(v.omega),
    cDensity: toMol(d.omega),
    gamma_p: v.gamma,
    window: [lo, S[S.length - 1].t],
    driftOverWave: Math.abs(last.energyResidual) / r.info.imposedKineticEnergy,
  };
}

// ───────────── wall box ─────────────

export interface WallEstimate {
  Nc: number;
  /** plane positions measured from the bottom wall plane, in D */
  planes_p: number[];
  Pocc: number[];
  Pcoll: number[];
  Pkin: number[];
  Ptotal: number[];
  Pwall: number;
  /** G-W1: P_wall / core total normal stress */
  gw1: number;
  /** G-W2: n_contact kT_w / P_wall (both walls averaged) */
  gw2: number;
  /** G-W3: near-wall mean total normal stress / P_wall */
  gw3: number;
  /** W-MF statistic R (both walls averaged); NaN at N_c = 1 */
  R: number;
  Rwalls: [number, number];
  /** report-only */
  contactDensity: number;
  coreDensity: number;
  excessOverH15: number;
  psi6FirstLayer: number;
  densityFine: number[];
}

/**
 * Wall-box estimator (A1 §2.4). Windows: core = planes in [3h, H − 3h] and
 * near-wall = [D/2 + D/4, D/2 + 1.5h] for G-W3, [D/2, D/2 + 1.5h] for W-MF.
 * At N_c = 1 (no kernel) the windows use h := 4 d (instrument validation only).
 */
export function wallEstimate(r: UB0Result): WallEstimate {
  const m = r.map;
  const D = m.diameter;
  const W = r.spec.width! * D;
  const H = r.spec.height! * D;
  const Tm = r.measureTime * m.Nc; // molecular
  const T = r.tallies;
  const snaps = T.profileSnapshots!;
  const fine = D / 20;
  const nb = T.count!.length;
  const nFine = T.count!.map((c) => c / (snaps * W * fine));
  const pkinFine = T.mvy2!.map((v) => v / (snaps * W * fine));
  const np = T.planesOcc!.length;
  const planes = Array.from({ length: np }, (_, p) => D / 2 + p * (D / 4));
  const Pocc = T.planesOcc!.map((v) => (T.occSamples! > 0 ? v / (T.occSamples! * W) : 0));
  const Pcoll = T.planesColl!.map((v) => v / (W * Tm));
  const Pkin = planes.map((y) => pkinFine[Math.min(nb - 1, Math.floor(y / fine))]);
  const Ptotal = planes.map((_, i) => Pocc[i] + Pcoll[i] + Pkin[i]);
  const Pwall = (r.walls[0].normalImpulse + r.walls[1].normalImpulse) / (2 * W * Tm);
  const h = m.Nc > 1 ? m.h : 4 * D;
  const inWin = (y: number, a: number, b: number) => y >= a - 1e-9 * D && y <= b + 1e-9 * D;
  const core = planes.map((y, i) => (inWin(y, 3 * h, H - 3 * h) ? Ptotal[i] : Number.NaN)).filter(Number.isFinite);
  const gw1 = Pwall / mean(core);
  // near-wall mean over both walls (top wall: distance H − y)
  const near: number[] = [];
  planes.forEach((y, i) => {
    if (inWin(y, D / 2 + D / 4, D / 2 + 1.5 * h) || inWin(H - y, D / 2 + D / 4, D / 2 + 1.5 * h)) near.push(Ptotal[i]);
  });
  const gw3 = mean(near) / Pwall;
  // contact density: quadratic through the first three fine bins with centres, extrapolated to D/2
  const first = Math.round(D / 2 / fine);
  const quad = (ys: number[], ns: number[], at: number) => {
    // Lagrange through three points
    const [x0, x1, x2] = ys;
    const [y0, y1, y2] = ns;
    return (
      (y0 * (at - x1) * (at - x2)) / ((x0 - x1) * (x0 - x2)) +
      (y1 * (at - x0) * (at - x2)) / ((x1 - x0) * (x1 - x2)) +
      (y2 * (at - x0) * (at - x1)) / ((x2 - x0) * (x2 - x1))
    );
  };
  const cb = quad(
    [0, 1, 2].map((j) => (first + j + 0.5) * fine),
    [0, 1, 2].map((j) => nFine[first + j]),
    D / 2,
  );
  const lastBin = nb - 1 - first;
  const ct = quad(
    [0, 1, 2].map((j) => (j + 0.5) * fine),
    [0, 1, 2].map((j) => nFine[lastBin - j]),
    0,
  );
  void lastBin;
  const contact = 0.5 * (cb + ct);
  const gw2 = (contact * m.kT) / Pwall;
  // core density (planes' window [3h, H − 3h])
  const coreN = nFine.filter((_, b) => inWin((b + 0.5) * fine, 3 * h, H - 3 * h));
  const nCore = mean(coreN);
  // report-only density excess per wall over [D/2, D/2 + 1.5h], units n_core h
  let exB = 0;
  let exT = 0;
  for (let b = 0; b < nb; b++) {
    const yc = (b + 0.5) * fine;
    if (inWin(yc, D / 2, D / 2 + 1.5 * h)) exB += (nFine[b] - nCore) * fine;
    if (inWin(H - yc, D / 2, D / 2 + 1.5 * h)) exT += (nFine[b] - nCore) * fine;
  }
  let R = Number.NaN;
  let Rwalls: [number, number] = [Number.NaN, Number.NaN];
  if (m.Nc > 1) {
    // density bins: D/20 within D/2 + 2D of either wall, D/4 elsewhere (A1 §2.4)
    const bins: DensityBins = { y: [], width: [], n: [] };
    let b = 0;
    while (b < nb) {
      const yc = (b + 0.5) * fine;
      const nearWall = yc < D / 2 + 2 * D || yc > H - D / 2 - 2 * D;
      if (nearWall) {
        bins.y.push(yc);
        bins.width.push(fine);
        bins.n.push(nFine[b]);
        b++;
      } else {
        const take = Math.min(5, nb - b);
        let c = 0;
        for (let j = 0; j < take; j++) c += nFine[b + j];
        bins.y.push((b + take / 2) * fine);
        bins.width.push(take * fine);
        bins.n.push(c / take);
        b += take;
      }
    }
    const ksA = m.ks * m.parcelArea;
    const pMF = occupancyStressMF(bins, planes, m.h, ksA);
    const spacing = D / 4;
    const bottom = wallMFStatistic(planes, Pocc, pMF, spacing, D / 2, D / 2 + 1.5 * h, 3 * h, H - 3 * h);
    const dist = planes.map((y) => H - y).reverse();
    const top = wallMFStatistic(dist, Pocc.slice().reverse(), pMF.slice().reverse(), spacing, D / 2, D / 2 + 1.5 * h, 3 * h, H - 3 * h);
    Rwalls = [bottom.R, top.R];
    R = 0.5 * (bottom.R + top.R);
  }
  return {
    Nc: m.Nc,
    planes_p: planes.map((y) => y / D),
    Pocc,
    Pcoll,
    Pkin,
    Ptotal,
    Pwall,
    gw1,
    gw2,
    gw3,
    R,
    Rwalls,
    contactDensity: contact,
    coreDensity: nCore,
    excessOverH15: (0.5 * (exB + exT)) / (nCore * h),
    psi6FirstLayer: T.psi6Samples ? T.psi6Sum! / T.psi6Samples : Number.NaN,
    densityFine: nFine,
  };
}

// ───────────── Couette (secondary) ─────────────

export interface CouetteEstimate {
  Nc: number;
  /** core shear rate (per molecular time) and wall shear stress */
  shearRate: number;
  tauWall: number;
  /** μ = τ_w / γ̇_core (molecular units) */
  mu: number;
  /** slip at each wall (velocity jump extrapolated from the core fit), in units of the wall speed difference */
  slip: [number, number];
  Tcore: number;
}

export function couetteEstimate(r: UB0Result): CouetteEstimate {
  const m = r.map;
  const D = m.diameter;
  const W = r.spec.width! * D;
  const H = r.spec.height! * D;
  const Tm = r.measureTime * m.Nc;
  const T = r.tallies;
  const fine = D / 20;
  const group = 10; // D/2 bins
  const ys: number[] = [];
  const us: number[] = [];
  const ts: number[] = [];
  for (let b = 0; b + group <= T.count!.length; b += group) {
    let c = 0;
    let p = 0;
    let k2 = 0;
    for (let j = 0; j < group; j++) {
      c += T.count![b + j];
      p += T.mvx![b + j];
      k2 += T.mvx2![b + j] + T.mvy2![b + j];
    }
    if (c === 0) continue;
    const u = p / (m.mass * c);
    ys.push((b + group / 2) * fine);
    us.push(u);
    ts.push((k2 / c - m.mass * u * u) / 2);
  }
  const core = ys.map((y, i) => ({ y, u: us[i], T: ts[i] })).filter((q) => q.y > 0.2 * H && q.y < 0.8 * H);
  const my = mean(core.map((q) => q.y));
  const mu_ = mean(core.map((q) => q.u));
  let sxy = 0;
  let sxx = 0;
  for (const q of core) {
    sxy += (q.y - my) * (q.u - mu_);
    sxx += (q.y - my) ** 2;
  }
  const g = sxy / sxx;
  // impulse on the wall along +x: the gas drags the bottom wall (moving at −U/2) forward (+) and the top wall back (−)
  const tau = (r.walls[0].tangentialImpulse - r.walls[1].tangentialImpulse) / (2 * W * Tm);
  const Uw = (r.spec.wallSpeed ?? 0) * m.sigmaV;
  const uAt = (y: number) => mu_ + g * (y - my);
  return {
    Nc: m.Nc,
    shearRate: g,
    tauWall: tau,
    mu: tau / g,
    slip: [(uAt(0) + Uw / 2) / Uw, (Uw / 2 - uAt(H)) / Uw],
    Tcore: mean(core.map((q) => q.T)),
  };
}
