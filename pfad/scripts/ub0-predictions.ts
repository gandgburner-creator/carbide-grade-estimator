/**
 * UB-0 analytical predictions (pre-registration gates: Phase 1 now; G3 after Stage 0).
 *
 *   npx tsx scripts/ub0-predictions.ts [--inputs file.json] [--label name] [--out results/ub0]
 *
 * Without --inputs it uses the design review's Universe A inputs (Henderson EOS,
 * Item 1/2 measurements) and checks every recomputed number against the values
 * printed in docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md (exit code 2 on any
 * discrepancy). With --inputs (Stage 0 measured Universe A values) it produces
 * the predictions of record.
 *
 * Deterministic: no random numbers, no Universe B simulation data.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { henderson, UB0_PHI } from '../src/universeB/CoarseGrainMap';
import { occupancyStressMF } from '../src/universeB/WallStress';
import {
  coupling,
  lucyHat,
  localEquilibriumBound,
  mapQuantities,
  meanFieldPressure,
  minReDelta,
  ratioHalfWidth,
  reviewReference,
  shearWaveConditions,
  soundBand,
  soundOmegaTau,
  wallProfile,
  type UniverseAReference,
  type WallProfile,
} from '../src/universeB/Predictions';

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const inputsFile = arg('--inputs', '');
const outDir = arg('--out', 'results/ub0');
const ref: UniverseAReference = inputsFile ? (JSON.parse(readFileSync(inputsFile, 'utf8')) as UniverseAReference) : reviewReference();
const label = arg('--label', inputsFile ? 'measured' : 'review-inputs');
const checkAgainstReview = !inputsFile;
let commit = 'unknown';
try {
  commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}

const t0 = Date.now();
const lines: string[] = [];
const say = (s = '') => lines.push(s);
const f = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const NC = [4, 16, 64];
const E = 0.9;
const flat: Record<string, number> = {};
const put = (k: string, v: number) => {
  flat[k] = v;
  return v;
};

say(`UB-0 analytical predictions — ${label}`);
say(`commit ${commit}; φ = ${UB0_PHI}; molecular units m = d = kT = 1 unless stated; parcel units D, σ_v where stated`);
say('No Universe B simulation data is used. Status legend: exact | mechanics | mean-field | estimate | design | input.');
say();
say('UNIVERSE A REFERENCE (status: input)');
for (const k of ['Z', 'KTred', 'cA', 'lambda', 'nu', 'collisionRate'] as const) {
  say(`  ${k.padEnd(14)} ${f(ref[k].value, 5).padStart(9)}   ${ref[k].source}`);
}
const GammaA = (ref.cA.value * ref.cA.value) / ref.KTred.value;
put('GammaA', GammaA);
put('deltaA', GammaA - 1);
put('KTred', ref.KTred.value);
say(`  derived: Γ_A = c_A²/(K_T/(nkT)) = ${f(GammaA)}  (Δ_A = Γ_A − 1 = ${f(GammaA - 1)}); S_A(0) = 1/(K_T/(nkT)) = ${f(1 / ref.KTred.value)}`);
say();

// ─────────── 1. the map ───────────
say('1. THE MAP (per N_c; e = 0.9, c_h = 2)');
say('   exact:      M = N_c m;  D = √N_c d;  n_p = n/N_c;  φ_p = φ;  ρ = n m;  σ_v = √(kT/M);  E_int = (N_c − 1) kT');
say('   exact (hard-core parcel gas = scaled copy of A): P_kin,B/P_A = 1/N_c;  λ_p/D = λ_A/d;');
say('               collision rate per parcel = (rate_A)·σ_v/D, i.e. rate_A/N_c per (d/c_th);  ν, μ invariant for the hard-core gas alone');
say('   derived:    ρ_rel = (1 − e²)/(2(N_c − 1))  [equilibrium of A-16 at T_kin = T_int, means only]');
say('   mean-field: k_s = (N_c − 1) K_T,A/(n φ);  h = c_h √N_c D (choice)');
say('   N_c   M     D      n_p       σ_v     E_int   ρ_rel     k_s      h(D)  h(d)   N_nb   P_kin/P_A  rate/(d/c)  λ_p(d)  S_p(0)');
for (const Nc of [1, ...NC]) {
  const q = mapQuantities(Nc, 2, E, ref);
  const hD = Nc > 1 ? q.h / q.diameter : 0;
  say(
    `   ${String(Nc).padStart(3)} ${String(q.mass).padStart(4)} ${f(q.diameter, 3).padStart(6)} ${f(q.numberDensity, 5).padStart(9)} ${f(q.sigmaV, 4).padStart(7)} ${f(q.internalEnergy, 0).padStart(6)} ${f(q.releaseFraction, 5).padStart(8)} ${f(q.ks, 2).padStart(8)} ${f(hD, 1).padStart(5)} ${f(q.h, 1).padStart(5)} ${f(q.Nnb, 1).padStart(6)} ${f(q.kineticPressureRatio, 4).padStart(9)} ${f(q.collisionRatePhysical, 4).padStart(10)} ${f(q.lambdaMolecular, 3).padStart(7)} ${f(q.S0parcel, 4).padStart(7)}`,
  );
  if (Nc > 1) {
    put(`map.np.${Nc}`, q.numberDensity);
    put(`map.sigmaV.${Nc}`, q.sigmaV);
    put(`map.Pkin.${Nc}`, q.kineticPressureRatio);
    put(`map.rate.${Nc}`, q.collisionRatePhysical);
    put(`map.lambda.${Nc}`, q.lambdaMolecular);
    put(`map.Eint.${Nc}`, q.internalEnergy);
    put(`map.rhoRel.${Nc}`, q.releaseFraction);
    put(`map.ks.${Nc}`, q.ks);
    put(`map.hD.${Nc}`, hD);
    put(`map.hd.${Nc}`, q.h);
    put(`map.Nnb.${Nc}`, q.Nnb);
    put(`map.S0.${Nc}`, q.S0parcel);
  }
}
put('map.ksPerNcMinus1', ref.KTred.value / UB0_PHI);
say(`   k_s/(N_c − 1) = K_T,A/(nφ) = ${f(ref.KTred.value / UB0_PHI, 3)} kT`);
say();

// ─────────── 2. mean-field pressure, modulus, sound ───────────
say('2. PRESSURE CLOSURE AND SOUND (mean-field unless stated)');
say('   P_occ/(n_p kT) = ½(N_c − 1) K_T,A/(nkT);   P_B/(n_p kT) = Z + P_occ/(n_p kT);   Z_B/Z_A = 1/N_c + (1 − 1/N_c)·K_T,A/(2 n kT Z)');
say('   K_B = K_kin + K_occ = K_T,A/N_c + (1 − 1/N_c) K_T,A = K_T,A   (mean-field, by construction)');
say('   Γ_self band = [1 + Δ_A/N_c², 1 + Δ_A/N_c]  (full … no reservoir exchange during a period; kinetic share only)');
say('   c_B/c_A = √(Γ_self/Γ_A)  if K_B = K_T,A;   collisionless kinetic allowance ≤ n_p kT/K_B = 1/(N_c K_T,A/(nkT))');
say('   N_c   Z_B/Z_A  occ.share  P_B/(n_p kT)   Γ_self band          c_B/c_A band        allowance');
for (const Nc of NC) {
  const p = meanFieldPressure(Nc, ref);
  const b = soundBand(Nc, ref);
  say(
    `   ${String(Nc).padStart(3)} ${f(p.ZratioBA, 4).padStart(8)} ${f(p.occupancyShare, 3).padStart(9)} ${f(p.total, 3).padStart(12)}   [${f(b.Gamma[0])}, ${f(b.Gamma[1])}]   [${f(b.cRatio[0])}, ${f(b.cRatio[1])}]   ${f(b.collisionlessAllowance, 4)}`,
  );
  put(`mf.Zratio.${Nc}`, p.ZratioBA);
  put(`mf.occShare.${Nc}`, p.occupancyShare);
  put(`mf.PB.${Nc}`, p.total);
  put(`mf.GammaLo.${Nc}`, b.Gamma[0]);
  put(`mf.GammaHi.${Nc}`, b.Gamma[1]);
  put(`mf.cLo.${Nc}`, b.cRatio[0]);
  put(`mf.cHi.${Nc}`, b.cRatio[1]);
  put(`mf.allow.${Nc}`, b.collisionlessAllowance);
}
put('mf.KTpressureRatio', ref.KTred.value / (2 * ref.Z.value));
say(`   K_T,A/(2 n kT Z) = ${f(ref.KTred.value / (2 * ref.Z.value))}  (the fraction of the internal-dof pressure the single-constant law reproduces)`);
say('   Finite-k occupancy response W̃(kh) at the longitudinal-wave box L = 160 D (exact for the Lucy kernel):');
for (const Nc of NC) {
  const h = 2 * Math.sqrt(Nc);
  const w = lucyHat((2 * Math.PI) / 160, h);
  put(`mf.What160.${Nc}`, w);
  say(`     N_c = ${Nc}: kh = ${f((2 * Math.PI * h) / 160, 4)}, W̃ = ${f(w, 5)}`);
}
say();

// ─────────── 3. contact theorem ───────────
say('3. WALL CONTACT DENSITY (mechanics: exact identity n_contact kT = P_wall = P_bulk; value uses the MF bulk pressure)');
put('wall.contactA', ref.Z.value);
say(`   Universe A: n_contact/n = Z = ${f(ref.Z.value, 3)}`);
for (const Nc of NC) {
  const p = meanFieldPressure(Nc, ref);
  put(`wall.contact.${Nc}`, p.total);
  say(`   N_c = ${Nc}: n_contact/n_p = P_B/(n_p kT) = ${f(p.total, 3)}`);
}
say();

// ─────────── 4. coupling ───────────
say('4. COUPLING (RPA estimates, parcel units D = kT = 1; S_hc taken as S_A(0))');
say('   N_nb = n_p π h²;  Γ_c = k_s a W(0)/kT;  u(D) = k_s a W(D)/kT;');
say('   ⟨δψ²⟩ = ∫d²k/(2π)² n û² S;  ⟨δF_x²⟩ = ∫d²k/(2π)² (k²/2) n û² S;  1/S = 1/S_A(0) + n û/kT');
say('   N_c  c_h   h/D    N_nb    1/N_nb   Γ_c     u(D)    rms ψ   rms F·D');
const couplings = [
  ...NC.map((Nc) => coupling(Nc, 2, ref)),
  coupling(4, 4, ref),
  coupling(2, 2, ref),
  coupling(256, 2, ref),
];
for (const c of couplings) {
  say(
    `   ${String(c.Nc).padStart(3)} ${String(c.ch).padStart(4)} ${f(c.hOverD, 2).padStart(6)} ${f(c.Nnb, 1).padStart(7)} ${f(c.invNnb, 4).padStart(8)} ${f(c.GammaC, 3).padStart(7)} ${f(c.uAtD, 3).padStart(7)} ${f(c.rmsPsi, 3).padStart(7)} ${f(c.rmsForceD, 3).padStart(8)}`,
  );
  const k = `${c.Nc}.${c.ch}`;
  put(`cp.Nnb.${k}`, c.Nnb);
  put(`cp.invNnb.${k}`, c.invNnb);
  put(`cp.GammaC.${k}`, c.GammaC);
  put(`cp.uD.${k}`, c.uAtD);
  put(`cp.psi.${k}`, c.rmsPsi);
  put(`cp.F.${k}`, c.rmsForceD);
}
say();

// ─────────── 5. wall profiles ───────────
say('5. NEAR-WALL PROFILE (mean-field occupancy + hard-core functional; parcel units D = 1)');
say('   ln n + βμ_ex[n] + β k_s a ∫W₁(y−y′) n(y′)dy′ = βμ;  LDA: βμ_ex = βf_ex(φ) + Z(φ) − 1 (Henderson);');
say('   SDA: Nordholm smoothed density with a uniform disk weight of radius D (a weighted-density functional; NOT fundamental-measure theory)');
const wallCases: [number, number][] = [[4, 2], [16, 2], [64, 2], [4, 4]];
const wallRuns: Record<string, WallProfile> = {};
const wallLine = (tag: string, w: WallProfile) =>
  say(
    `   ${tag.padEnd(26)} conv=${w.converged ? 'yes' : 'NO '} it=${String(w.iterations).padStart(6)}  φ_contact=${f(w.phiContact, 3)}  φ(h/4)=${f(w.phiAt.hQuarter, 3)}  φ(h/2)=${f(w.phiAt.hHalf, 3)}  φ(h)=${f(w.phiAt.h, 3)}  φ_min=${f(w.phiMin, 3)}@${f(w.yMinOverH, 2)}h  φ_core=${f(w.phiCore, 4)}  excess[0,1.5h]/(n_b h)=${f(w.excessOverH15, 4)}  half-box=${f(w.excessHalfBox, 4)}`,
  );
say('   (a) review method: grand canonical, LDA, box 8h');
for (const [Nc, ch] of wallCases) {
  const w = wallProfile({ Nc, ch, functional: 'LDA', ensemble: 'grand', HoverH: 8 }, ref);
  wallRuns[`GC-LDA-${Nc}-${ch}`] = w;
  wallLine(`N_c=${Nc} c_h=${ch} GC-LDA`, w);
  put(`wallGC.phiC.${Nc}.${ch}`, w.phiContact);
  put(`wallGC.phiHalf.${Nc}.${ch}`, w.phiAt.hHalf);
  put(`wallGC.phiQuarter.${Nc}.${ch}`, w.phiAt.hQuarter);
  put(`wallGC.excess.${Nc}.${ch}`, w.excessHalfBox);
}
put('wallGC.armRatio', flat['wallGC.excess.4.4'] / flat['wallGC.excess.4.2'] * 2);
say(`   excess ratio c_h 4 / c_h 2 at N_c = 4 (absolute, n_b·D units): ${f(flat['wallGC.armRatio'], 3)}`);
say('   (b) run geometry: canonical, box H = 10h, ∫n dy = n_b H');
for (const fn of ['LDA', 'SDA'] as const) {
  for (const [Nc, ch] of wallCases) {
    const w = wallProfile({ Nc, ch, functional: fn, ensemble: 'canonical', HoverH: 10 }, ref);
    wallRuns[`C-${fn}-${Nc}-${ch}`] = w;
    wallLine(`N_c=${Nc} c_h=${ch} canonical-${fn}`, w);
    put(`wallC.${fn}.excess.${Nc}.${ch}`, w.excessOverH15);
    put(`wallC.${fn}.phiC.${Nc}.${ch}`, w.phiContact);
  }
}
say('   INCONCLUSIVE-THEORY check (design §9.3): |excess_SDA/excess_LDA − 1| over [D/2, D/2 + 1.5h], canonical H = 10h:');
let theoryInconclusive = false;
for (const [Nc, ch] of wallCases) {
  const l = flat[`wallC.LDA.excess.${Nc}.${ch}`];
  const s = flat[`wallC.SDA.excess.${Nc}.${ch}`];
  const d = Math.abs(s / l - 1);
  const judged = (Nc === 4 || Nc === 16) && ch === 2;
  if (judged && d > 0.2) theoryInconclusive = true;
  say(`     N_c=${Nc} c_h=${ch}: LDA ${f(l)}  SDA ${f(s)}  difference ${f(100 * d, 1)} %${judged ? (d > 0.2 ? '  > 20 % → INCONCLUSIVE-THEORY' : '  ≤ 20 %') : '  (not a judged wall case)'}`);
}
put('wall.theoryInconclusive', theoryInconclusive ? 1 : 0);
say('   Functional check against the exact contact theorem (contact value of the centre density, as φ-equivalent n_c·πD²/4):');
say('   exact: n_contact/n_p = P/(n_p kT) (§3); the functionals report their first grid point (y = D/2 + dy/2, dy = 0.05 D)');
{
  const plain = (fn: 'LDA' | 'SDA') => wallProfile({ Nc: 1, ch: 2, functional: fn, ensemble: 'grand', HoverH: 8 }, ref);
  const l1 = plain('LDA');
  const s1 = plain('SDA');
  put('fcheck.exact.1', ref.Z.value * UB0_PHI);
  put('fcheck.LDA.1', l1.phiContact);
  put('fcheck.SDA.1', s1.phiContact);
  say(`     N_c = 1 (plain hard wall, k_s = 0): exact ${f(ref.Z.value * UB0_PHI, 3)}  LDA ${f(l1.phiContact, 3)}  SDA ${f(s1.phiContact, 3)}`);
  for (const [Nc, ch] of wallCases) {
    const ex = meanFieldPressure(Nc, ref).total * UB0_PHI;
    const l = wallRuns[`C-LDA-${Nc}-${ch}`].phiContact;
    const sd = wallRuns[`C-SDA-${Nc}-${ch}`].phiContact;
    put(`fcheck.exact.${Nc}.${ch}`, ex);
    say(`     N_c = ${Nc}, c_h = ${ch} (canonical): exact (MF pressure) ${f(ex, 3)}  LDA ${f(l, 3)}  SDA ${f(sd, 3)}`);
  }
  say('   Reading: LDA cannot represent the hard-core contact layer (it gives φ_b at a plain hard wall); the SDA nearly');
  say('   satisfies the contact theorem there. Most of the LDA–SDA difference in the excess comes from the contact layer.');
}
say();

// ─────────── 6. planned configurations and windows ───────────
say('6. PLANNED CONFIGURATIONS AND VALIDITY WINDOWS');
say('   shear wave u_x = U₀ sin(2πy/L), U₀ = σ_v: Kn = kλ_p, ε_p = γ̇λ_p/σ_v = kλ_p, Re_k = U₀/(νk), τ = 1/(νk²) [D/σ_v]');
say('   design: per-seed relative ν error ≈ √(2/N)·σ_v/U₀ (ESTIMATE); heating ΔT/T = ¼(U₀/σ_v)²/C, C = 1 (A) or N_c (B, exchange)');
for (const [Nc, L] of [[1, 80], [1, 160], [4, 80], [16, 80], [64, 160]] as [number, number][]) {
  const w = shearWaveConditions(Nc, L, ref);
  say(
    `   N_c=${String(Nc).padStart(2)} L=${L}D N=${w.parcels} Kn=ε=${f(w.Kn, 4)} Re_k=${f(w.Re, 2)} τ=${f(w.decayTime, 1)} collisions/τ=${f(w.collisionsPerDecay, 0)} Ma=[${f(w.machBand[0], 3)}, ${f(w.machBand[1], 3)}] ΔT/T=${f(100 * w.heatingFraction, 1)}% per-seed ν error=${f(100 * w.perSeedNuError, 2)}%`,
  );
  const k = `${Nc}.${L}`;
  put(`wave.Kn.${k}`, w.Kn);
  put(`wave.Re.${k}`, w.Re);
  put(`wave.tau.${k}`, w.decayTime);
  put(`wave.coll.${k}`, w.collisionsPerDecay);
  put(`wave.MaLo.${k}`, w.machBand[0]);
  put(`wave.MaHi.${k}`, w.machBand[1]);
  put(`wave.heat.${k}`, w.heatingFraction);
  put(`wave.err.${k}`, w.perSeedNuError);
}
const e80 = flat['wave.err.4.80'];
const e160 = flat['wave.err.64.160'];
put('ci.nu.4', ratioHalfWidth(e80, 48, e80, 48));
put('ci.nu.64', ratioHalfWidth(e160, 12, e160, 6));
put('ci.6a', ratioHalfWidth(e80, 48, 2 * e80, 96));
put('ci.6b', ratioHalfWidth(e80, 48, e80, 48));
put('ci.6c', ratioHalfWidth(e80, 48, e80, 24));
put('ci.7d', ratioHalfWidth(e80, 48, e80, 48));
say(
  `   expected 95 % CI half-widths (design, Welch): PQ1 N_c 4/16 ±${f(100 * flat['ci.nu.4'], 2)}%, N_c 64 ±${f(100 * flat['ci.nu.64'], 2)}%; PQ6a ±${f(100 * flat['ci.6a'], 2)}%; PQ6b ±${f(100 * flat['ci.6b'], 2)}%; PQ6c ±${f(100 * flat['ci.6c'], 2)}%; PQ7d ±${f(100 * flat['ci.7d'], 2)}%`,
);
say('   standing sound wave L = 160 D: ωτ_c = c_B k/(collision rate)');
for (const Nc of [1, ...NC]) {
  const w = soundOmegaTau(Nc, 160, ref);
  put(`snd.wt.${Nc}`, w[1]);
  say(`     N_c=${Nc}: ωτ_c ∈ [${f(w[0], 3)}, ${f(w[1], 3)}]`);
}
const bound170 = localEquilibriumBound(170, 0.3, ref);
const bound1000 = localEquilibriumBound(1000, 0.3, ref);
put('le.bound170', bound170);
put('le.bound1000', bound1000);
put('le.minRe.4', minReDelta(4, 0.3, ref));
put('le.minRe.16', minReDelta(16, 0.3, ref));
put('le.hTarget', 4 * Math.sqrt(60));
say(`   local equilibrium (ε_p ≤ 0.1): N_c ≲ ε a Re_δ/(Ma c_A)², a = ν/λ = ${f(ref.nu.value / ref.lambda.value, 3)}`);
say(`     Re_δ = 170, Ma 0.3: N_c ≲ ${f(bound170, 1)};  Re_δ = 1000: ${f(bound1000, 0)};  min Re_δ at Ma 0.3: N_c = 4 → ${f(flat['le.minRe.4'], 1)}, N_c = 16 → ${f(flat['le.minRe.16'], 1)}`);
say(`     kernel at the bridging target (N_c = 60, c_h = 4): h = ${f(flat['le.hTarget'], 1)} D`);
say('   window verdicts per N_c (c_h = 2): bulk needs ε_p ≤ 0.1, L/h ≥ 10, 1/N_nb ≤ 0.1 (closure error within PQ2 margin),');
say('   rms F·D ≤ 0.8 kT and N_nb ≥ 12 (line L4); wall needs a fluid contact layer (canonical-LDA φ_contact < 0.70, hard-disk freezing 0.70–0.72)');
for (const Nc of [2, 4, 16, 64, 256]) {
  const c = coupling(Nc, 2, ref);
  const L = Nc <= 16 ? 80 : 160;
  const LoverH = L / c.hOverD;
  const eps = (2 * Math.PI * ref.lambda.value) / L;
  const wl = wallRuns[`C-LDA-${Nc}-2`];
  const bulkOK = eps <= 0.1 && LoverH >= 10 && c.invNnb <= 0.1 && c.rmsForceD <= 0.8 && c.Nnb >= 12;
  const reasons = [
    eps > 0.1 ? 'ε_p > 0.1' : '',
    LoverH < 10 ? `L/h = ${f(LoverH, 1)} < 10 at L = ${L} D` : '',
    c.invNnb > 0.1 ? `1/N_nb = ${f(c.invNnb, 3)} > 0.1` : '',
    c.rmsForceD > 0.8 ? `rms F·D = ${f(c.rmsForceD, 2)} > 0.8` : '',
    c.Nnb < 12 ? `N_nb = ${f(c.Nnb, 1)} < 12` : '',
  ].filter(Boolean);
  const wall = wl ? (wl.phiContact < 0.7 ? `fluid (φ_contact ${f(wl.phiContact, 3)})` : `OUTSIDE (φ_contact ${f(wl.phiContact, 3)} ≥ 0.70)`) : 'not computed';
  say(`     N_c=${String(Nc).padStart(3)}: bulk ${bulkOK ? 'inside' : 'OUTSIDE'}${reasons.length ? ` (${reasons.join('; ')})` : ''}; wall ${wall}`);
}
say();

// ─────────── 6b. wall regime and the W-MF functional (amendment A1 §2.4–§2.5) ───────────
say('6b. WALL REGIME AND THE W-MF FUNCTIONAL (design amendment A1)');
say('   Contact-layer core stress = P_B exactly (occupancy stress vanishes at the wall). In parcel units');
say('   βP_B D² = (P_B/(n_p kT))·n_p D², n_p D² = φ/(π/4). EXTERNAL comparison: hard-disk liquid–hexatic');
say('   transition pressure βPσ² ≈ 9.2 (Bernard & Krauth 2011). Above it the contact layer is expected to order.');
const MELT = 9.2;
for (const Nc of NC) {
  const v = meanFieldPressure(Nc, ref).total * (UB0_PHI / (Math.PI / 4));
  put(`regime.betaPD2.${Nc}`, v);
  say(`     N_c = ${String(Nc).padStart(2)}: βP_B D² = ${f(v, 3)}  ${v < MELT ? '< 9.2: fluid contact layer expected' : '> 9.2: above melting — wall test ill-posed (excluded)'}  (factor ${f(v / MELT, 2)})`);
}
say('   W-MF functional check: P_MF[n](y₀) = Σ_{y_j<y₀<y_l} λ_j λ_l g(y_l − y_j) for a uniform density should equal');
say('   ½ k_s a n² (the bulk mean-field closure). Bins of D/4, plane in the middle of a 20h slab (molecular units):');
for (const Nc of NC) {
  const q = mapQuantities(Nc, 2, E, ref);
  const ksA = q.ks * q.parcelArea;
  const D = q.diameter;
  const n = q.numberDensity;
  const span = 20 * q.h;
  const dy = D / 4;
  const nb = Math.round(span / dy);
  const bins = { y: Array.from({ length: nb }, (_, i) => (i + 0.5) * dy), width: Array(nb).fill(dy), n: Array(nb).fill(n) };
  const pmf = occupancyStressMF(bins, [Math.round(nb / 2) * dy], q.h, ksA)[0];
  const exact = 0.5 * ksA * n * n;
  put(`wmf.bulk.${Nc}`, pmf / exact);
  say(`     N_c = ${String(Nc).padStart(2)}: P_MF/(½ k_s a n²) = ${f(pmf / exact, 5)}`);
}
say();

// ─────────── 7. review check ───────────
interface Check {
  key: string;
  review: number;
  decimals: number;
  where: string;
}
const checks: Check[] = [
  ['map.np.4', 0.0637, 4, '§2.1'], ['map.np.16', 0.0159, 4, '§2.1'], ['map.np.64', 0.004, 4, '§2.1'],
  ['map.sigmaV.4', 0.5, 3, '§2.1'], ['map.sigmaV.16', 0.25, 3, '§2.1'], ['map.sigmaV.64', 0.125, 3, '§2.1'],
  ['map.Pkin.4', 0.25, 4, '§2.1'], ['map.Pkin.16', 0.0625, 4, '§2.1'], ['map.Pkin.64', 0.0156, 4, '§2.1'],
  ['map.rate.4', 0.32, 2, '§2.1'], ['map.rate.16', 0.081, 3, '§2.1'], ['map.rate.64', 0.02, 3, '§2.1'],
  ['map.lambda.4', 1.9, 1, '§2.1'], ['map.lambda.16', 3.8, 1, '§2.1'], ['map.lambda.64', 7.7, 1, '§2.1'],
  ['map.Eint.4', 3, 0, '§2.1'], ['map.Eint.16', 15, 0, '§2.1'], ['map.Eint.64', 63, 0, '§2.1'],
  ['map.rhoRel.4', 0.0317, 4, '§2.1'], ['map.rhoRel.16', 0.00633, 5, '§2.1'], ['map.rhoRel.64', 0.00151, 5, '§2.1'],
  ['map.hD.4', 4, 0, '§2.1'], ['map.hD.16', 8, 0, '§2.1'], ['map.hD.64', 16, 0, '§2.1'],
  ['map.hd.4', 8, 0, '§2.1'], ['map.hd.16', 32, 0, '§2.1'], ['map.hd.64', 128, 0, '§2.1'],
  ['map.Nnb.4', 12.8, 1, '§2.1'], ['map.Nnb.16', 51, 0, '§2.1'], ['map.Nnb.64', 205, 0, '§2.1'],
  ['map.ks.4', 35.6, 1, '§2.1'], ['map.ks.16', 178, 0, '§2.1'], ['map.ks.64', 747, 0, '§2.1'],
  ['map.ksPerNcMinus1', 11.86, 2, '§2.3'], ['KTred', 2.371, 3, '§2.3'],
  ['map.S0.4', 0.105, 3, '§2.1'], ['map.S0.16', 0.026, 3, '§2.1'], ['map.S0.64', 0.0066, 4, '§2.1'],
  ['mf.Zratio.4', 0.816, 3, '§2.1'], ['mf.Zratio.16', 0.77, 3, '§2.1'], ['mf.Zratio.64', 0.759, 3, '§2.1'],
  ['mf.KTpressureRatio', 0.755, 3, '§2.3'],
  ['mf.occShare.4', 0.69, 2, '§2.1'], ['mf.occShare.16', 0.92, 2, '§2.1'], ['mf.occShare.64', 0.98, 2, '§2.1'],
  ['GammaA', 1.99, 2, '§6.2'], ['deltaA', 0.986, 3, '§2.1'],
  ['mf.GammaLo.4', 1.062, 3, '§2.1'], ['mf.GammaHi.4', 1.247, 3, '§2.1'],
  ['mf.GammaLo.16', 1.004, 3, '§2.1'], ['mf.GammaHi.16', 1.062, 3, '§2.1'],
  ['mf.GammaLo.64', 1.0, 3, '§2.1'], ['mf.GammaHi.64', 1.015, 3, '§2.1'],
  ['mf.cLo.4', 0.731, 3, '§2.1'], ['mf.cHi.4', 0.792, 3, '§2.1'],
  ['mf.cLo.16', 0.711, 3, '§2.1'], ['mf.cHi.16', 0.731, 3, '§2.1'],
  ['mf.cLo.64', 0.71, 3, '§2.1'], ['mf.cHi.64', 0.715, 3, '§2.1'],
  ['mf.allow.4', 0.105, 3, '§5'], ['mf.allow.16', 0.026, 3, '§5'], ['mf.allow.64', 0.0066, 4, '§5'],
  ['mf.What160.4', 0.9989, 4, '§8.1'], ['mf.What160.16', 0.9956, 4, '§8.1'], ['mf.What160.64', 0.9824, 4, '§8.1'],
  ['wall.contactA', 1.57, 2, '§9.1'], ['wall.contact.4', 5.13, 2, '§9.1'], ['wall.contact.16', 19.4, 1, '§9.1'], ['wall.contact.64', 76.3, 1, '§9.1'],
  ['cp.Nnb.4.2', 12.8, 1, '§2.4'], ['cp.Nnb.16.2', 51, 0, '§2.4'], ['cp.Nnb.64.2', 205, 0, '§2.4'], ['cp.Nnb.4.4', 51, 0, '§2.4'],
  ['cp.GammaC.4.2', 2.8, 1, '§2.4'], ['cp.GammaC.16.2', 3.5, 1, '§2.4'], ['cp.GammaC.64.2', 3.7, 1, '§2.4'], ['cp.GammaC.4.4', 0.69, 2, '§2.4'],
  ['cp.uD.4.2', 2.0, 1, '§2.4'], ['cp.uD.16.2', 3.2, 1, '§2.4'], ['cp.uD.64.2', 3.6, 1, '§2.4'], ['cp.uD.4.4', 0.64, 2, '§2.4'],
  ['cp.psi.4.2', 1.2, 1, '§2.4'], ['cp.psi.16.2', 1.7, 1, '§2.4'], ['cp.psi.64.2', 1.8, 1, '§2.4'], ['cp.psi.4.4', 0.62, 2, '§2.4'],
  ['cp.F.4.2', 0.78, 2, '§2.4'], ['cp.F.16.2', 0.58, 2, '§2.4'], ['cp.F.64.2', 0.33, 2, '§2.4'], ['cp.F.4.4', 0.19, 2, '§2.4'],
  ['cp.invNnb.4.2', 0.078, 3, '§2.4'], ['cp.invNnb.16.2', 0.02, 3, '§2.4'], ['cp.invNnb.64.2', 0.005, 3, '§2.4'], ['cp.invNnb.4.4', 0.02, 3, '§2.4'],
  ['cp.invNnb.2.2', 0.16, 2, '§5 (N_c = 2 rejected)'],
  ['wallGC.phiC.4.2', 0.38, 2, '§9.2'], ['wallGC.phiC.16.2', 0.6, 2, '§9.2'], ['wallGC.phiC.64.2', 0.77, 2, '§9.2'], ['wallGC.phiC.4.4', 0.38, 2, '§9.2'],
  ['wallGC.phiHalf.4.2', 0.19, 2, '§9.2'], ['wallGC.phiHalf.16.2', 0.15, 2, '§9.2'], ['wallGC.phiHalf.64.2', 0.13, 2, '§9.2'], ['wallGC.phiHalf.4.4', 0.19, 2, '§9.2'],
  ['wallGC.phiQuarter.64.2', 0.08, 2, '§9.2'],
  ['wallGC.excess.4.2', 0.13, 2, '§9.2'], ['wallGC.excess.16.2', 0.2, 2, '§9.2'], ['wallGC.excess.64.2', 0.24, 2, '§9.2'], ['wallGC.excess.4.4', 0.13, 2, '§9.2'],
  ['wallGC.armRatio', 2.0, 1, '§9.2'],
  ['wave.Kn.4.80', 0.075, 3, '§5'], ['wave.Kn.64.160', 0.038, 3, '§5'],
  ['wave.Re.4.80', 9.2, 1, '§5'], ['wave.Re.64.160', 18.5, 1, '§5'],
  ['wave.MaLo.1.80', 0.46, 2, '§5'], ['wave.MaLo.4.80', 0.29, 2, '§5'], ['wave.MaHi.4.80', 0.32, 2, '§5'],
  ['wave.MaLo.16.80', 0.16, 2, '§5'], ['wave.MaHi.16.80', 0.16, 2, '§5'], ['wave.MaLo.64.160', 0.08, 2, '§5'], ['wave.MaHi.64.160', 0.08, 2, '§5'],
  ['wave.coll.4.80', 152, 0, '§5'], ['wave.coll.64.160', 607, 0, '§5'],
  ['wave.heat.1.80', 0.25, 2, '§5'], ['wave.heat.4.80', 0.06, 2, '§5'], ['wave.heat.16.80', 0.016, 3, '§5'], ['wave.heat.64.160', 0.004, 3, '§5'],
  ['wave.err.4.80', 0.035, 3, '§5/§11.3'], ['wave.err.64.160', 0.0175, 4, '§5/§11.3'],
  ['ci.nu.4', 0.014, 3, '§5/§6.2'], ['ci.nu.64', 0.019, 3, '§5/§6.2'], ['ci.6a', 0.017, 3, '§6.2'], ['ci.6b', 0.014, 3, '§6.2'],
  ['ci.6c', 0.018, 3, '§6.2'], ['ci.7d', 0.014, 3, '§6.2'],
  ['snd.wt.1', 0.07, 2, '§5'], ['snd.wt.4', 0.1, 2, '§5'], ['snd.wt.16', 0.19, 2, '§5'], ['snd.wt.64', 0.38, 2, '§5'],
  ['le.bound170', 60, -1, 'previous review §5 ("≈ 60")'], ['le.bound1000', 340, -1, 'previous review §5 ("≈ 340")'],
  ['le.minRe.4', 12, 0, '§13'], ['le.minRe.16', 48, 0, '§13'], ['le.hTarget', 31, 0, '§7 F7(a)'],
].map(([key, review, decimals, where]) => ({ key, review, decimals, where }) as Check);

interface CheckResult extends Check {
  recomputed: number;
  verdict: 'agree' | 'rounding' | 'ERRATUM (A1)' | 'DISCREPANCY';
  relDiff: number;
}
const results: CheckResult[] = [];
if (checkAgainstReview) {
  say('7. CHECK AGAINST THE DESIGN REVIEW (docs/REVIEW_UB0_PREREGISTRATION_DESIGN.md, d068755)');
  say('   agree       = rounds to the printed value');
  say('   rounding    = does not round to it but differs by ≤ 1 % (input rounding, e.g. 1.29 vs 1.287 collisions)');
  say('   ERRATUM (A1) = a discrepancy acknowledged in docs/UB0_DESIGN_AMENDMENT_1.md §1.1 (the computed value is authoritative)');
  say('   DISCREPANCY = anything else');
  for (const c of checks) {
    const v = flat[c.key];
    const scale = 10 ** c.decimals;
    const rounded = Math.round(v * scale) / scale;
    const relDiff = c.review !== 0 ? (v - c.review) / Math.abs(c.review) : v;
    const errata = new Set(['cp.GammaC.64.2', 'cp.uD.4.2', 'le.minRe.16']);
    const verdict: CheckResult['verdict'] =
      Math.abs(rounded - c.review) < 1e-9
        ? 'agree'
        : Math.abs(relDiff) <= 0.01
          ? 'rounding'
          : errata.has(c.key)
            ? 'ERRATUM (A1)'
            : 'DISCREPANCY';
    results.push({ ...c, recomputed: v, verdict, relDiff });
  }
  for (const r of results.filter((x) => x.verdict !== 'agree')) {
    say(`   ${r.verdict.padEnd(13)} ${r.key.padEnd(24)} review ${r.review}  recomputed ${f(r.recomputed, 5)}  (${f(100 * r.relDiff, 2)} %)  ${r.where}`);
  }
  const nAgree = results.filter((x) => x.verdict === 'agree').length;
  const nRound = results.filter((x) => x.verdict === 'rounding').length;
  const nErr = results.filter((x) => x.verdict === 'ERRATUM (A1)').length;
  const nDisc = results.filter((x) => x.verdict === 'DISCREPANCY').length;
  say(`   ${results.length} values checked: ${nAgree} agree, ${nRound} rounding-level, ${nErr} acknowledged errata (A1), ${nDisc} DISCREPANCY`);
  say();
}
say(`runtime ${((Date.now() - t0) / 1000).toFixed(1)} s`);

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `predictions_${label}`);
writeFileSync(`${base}.txt`, lines.join('\n') + '\n');
const profiles = Object.fromEntries(
  Object.entries(wallRuns).map(([k, w]) => [
    k,
    { ...w, y: w.y.filter((_, i) => i % 4 === 0), phi: w.phi.filter((_, i) => i % 4 === 0), note: 'every 4th grid point' },
  ]),
);
writeFileSync(
  `${base}.json`,
  JSON.stringify({ label, commit, generated: new Date().toISOString(), reference: ref, values: flat, reviewCheck: results, wallProfiles: profiles, hendersonCheck: { Z: henderson.Z(UB0_PHI), KTred: henderson.KTred(UB0_PHI) } }, null, 1),
);
console.log(lines.join('\n'));
console.log(`\nwrote ${base}.txt and ${base}.json`);
if (results.some((r) => r.verdict === 'DISCREPANCY')) process.exit(2);
