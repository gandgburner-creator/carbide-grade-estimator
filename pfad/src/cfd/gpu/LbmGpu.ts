import { fillInitialPopulations, type LbmConfig } from '../Lbm';

/**
 * THE LATTICE BOLTZMANN SOLVER ON THE GRAPHICS CARD (WebGPU compute shaders).
 *
 * The same numerical scheme as the CPU solver of Lbm.ts, line for line: D2Q9, two-relaxation-time collision (Λ = 3/16), optional
 * Smagorinsky sub-grid viscosity, a smooth absorbing layer in front of the outflow, Bouzidi–Firdaouss–Lallemand interpolated
 * bounce-back at the walls, Zou–He velocity inflow, zero-gradient outflow, slip or periodic top and bottom, a constant body force
 * (Guo), and the force on the body from the momentum exchanged through the wall links. It adds nothing to the physics: it is the
 * same equations on the same lattice, run by thousands of threads instead of one.
 *
 * What differs from the CPU solver is only the arithmetic: populations are 32-bit floats here (64-bit on the CPU), and sums that are
 * taken by many threads at once (the force, the in- and outflow of mass) are accumulated as fixed-point integers, which are exact and
 * independent of the order the threads finish in. tests and the in-app GPU self-test compare the two solvers on a channel with a known
 * exact solution and on a body in a stream.
 *
 * One step is three compute dispatches over the nodes, in one compute pass:
 *   collide   in place on the current populations
 *   stream    from the current into the next buffer, with the walls, the force and the inflow
 *   outflow   the zero-gradient copy of the last column and the step counter
 * and the buffers swap roles after each step. Time averages of the density and velocity, and the monitors of a run, are accumulated on
 * the card every `sampleEvery` steps and read back once per time block.
 */

/** fixed-point scales of the integer accumulators (a sum of many threads is exact in integers) */
const FORCE_SCALE = 65536;
const FLUX_SCALE = 8192;
const PROBE_SCALE = 1048576;

export const WGSL = /* wgsl */ `
struct Params {
  nx: u32, ny: u32, n: u32, ramp: u32,
  uIn: f32, cs2: f32, tau0: f32, magic: f32,
  gx: f32, gy: f32, flags: u32, probe: u32,
};
struct SnapParams { kind: u32, stride: u32, gw: u32, gh: u32, rhoInf: f32, U: f32, cells: f32, pad: f32 };

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> solid: array<u32>;
@group(0) @binding(2) var<storage, read> wallQ: array<f32>;
@group(0) @binding(3) var<storage, read> omega: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> fCur: array<f32>;
@group(0) @binding(5) var<storage, read_write> fNext: array<f32>;
@group(0) @binding(6) var<storage, read_write> force: array<atomic<i32>, 2>;
@group(0) @binding(7) var<storage, read_write> counter: array<u32, 1>;
@group(0) @binding(8) var<storage, read_write> acc: array<f32>;
@group(0) @binding(9) var<storage, read_write> stats: array<atomic<u32>, 8>;
@group(0) @binding(10) var<storage, read_write> snapOut: array<f32>;
@group(0) @binding(11) var<uniform> S: SnapParams;
@group(0) @binding(12) var<storage, read_write> series: array<i32>;

const FORCE_SCALE: f32 = ${FORCE_SCALE}.0;
const FLUX_SCALE: f32 = ${FLUX_SCALE}.0;
const PROBE_SCALE: f32 = ${PROBE_SCALE}.0;

fn nodeOf(gid: vec3<u32>, nwg: vec3<u32>) -> u32 {
  return gid.x + gid.y * nwg.x * 128u;
}

fn addGuo(n: u32, k: u32, cx: f32, cy: f32, w: f32, ux: f32, uy: f32, omP: f32, omM: f32) {
  let cg = cx * P.gx + cy * P.gy;
  let cu = cx * ux + cy * uy;
  let ug = ux * P.gx + uy * P.gy;
  let cm = 1.0 - 0.5 * omM;
  let cp = 1.0 - 0.5 * omP;
  fCur[k * P.n + n] = fCur[k * P.n + n] + w * (cm * 3.0 * cg + cp * (9.0 * cu * cg - 3.0 * ug));
}

@compute @workgroup_size(128)
fn collide(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let n = nodeOf(gid, nwg);
  let N = P.n;
  if (n >= N) { return; }
  if (solid[n] != 0u) { return; }
  let col = n % P.nx;
  let f0 = fCur[n];
  let f1 = fCur[N + n];
  let f2 = fCur[2u * N + n];
  let f3 = fCur[3u * N + n];
  let f4 = fCur[4u * N + n];
  let f5 = fCur[5u * N + n];
  let f6 = fCur[6u * N + n];
  let f7 = fCur[7u * N + n];
  let f8 = fCur[8u * N + n];
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  let ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho + 0.5 * P.gx;
  let uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho + 0.5 * P.gy;
  let usq = 1.5 * (ux * ux + uy * uy);
  let e0 = (4.0 / 9.0) * rho * (1.0 - usq);
  let w1 = rho / 9.0;
  let w5 = rho / 36.0;
  let e1 = w1 * (1.0 + 3.0 * ux + 4.5 * ux * ux - usq);
  let e3 = w1 * (1.0 - 3.0 * ux + 4.5 * ux * ux - usq);
  let e2 = w1 * (1.0 + 3.0 * uy + 4.5 * uy * uy - usq);
  let e4 = w1 * (1.0 - 3.0 * uy + 4.5 * uy * uy - usq);
  let c5 = ux + uy;
  let c6 = -ux + uy;
  let e5 = w5 * (1.0 + 3.0 * c5 + 4.5 * c5 * c5 - usq);
  let e7 = w5 * (1.0 - 3.0 * c5 + 4.5 * c5 * c5 - usq);
  let e6 = w5 * (1.0 + 3.0 * c6 + 4.5 * c6 * c6 - usq);
  let e8 = w5 * (1.0 - 3.0 * c6 + 4.5 * c6 * c6 - usq);
  var omP = omega[col].x;
  var omM = omega[col].y;
  if (P.cs2 > 0.0) {
    let pxx = f1 + f3 + f5 + f6 + f7 + f8 - (e1 + e3 + e5 + e6 + e7 + e8);
    let pyy = f2 + f4 + f5 + f6 + f7 + f8 - (e2 + e4 + e5 + e6 + e7 + e8);
    let pxy = f5 - f6 + f7 - f8 - (e5 - e6 + e7 - e8);
    let q = sqrt(pxx * pxx + pyy * pyy + 2.0 * pxy * pxy);
    let tauT = 0.5 * (P.tau0 + sqrt(P.tau0 * P.tau0 + (18.0 * 1.4142135623730951 * P.cs2 * q) / rho));
    omP = 1.0 / tauT;
    omM = 1.0 / (P.magic / (tauT - 0.5) + 0.5);
  }
  fCur[n] = f0 - omP * (f0 - e0);
  var sp = 0.5 * (f1 + f3 - e1 - e3);
  var sm = 0.5 * (f1 - f3 - e1 + e3);
  fCur[N + n] = f1 - omP * sp - omM * sm;
  fCur[3u * N + n] = f3 - omP * sp + omM * sm;
  sp = 0.5 * (f2 + f4 - e2 - e4);
  sm = 0.5 * (f2 - f4 - e2 + e4);
  fCur[2u * N + n] = f2 - omP * sp - omM * sm;
  fCur[4u * N + n] = f4 - omP * sp + omM * sm;
  sp = 0.5 * (f5 + f7 - e5 - e7);
  sm = 0.5 * (f5 - f7 - e5 + e7);
  fCur[5u * N + n] = f5 - omP * sp - omM * sm;
  fCur[7u * N + n] = f7 - omP * sp + omM * sm;
  sp = 0.5 * (f6 + f8 - e6 - e8);
  sm = 0.5 * (f6 - f8 - e6 + e8);
  fCur[6u * N + n] = f6 - omP * sp - omM * sm;
  fCur[8u * N + n] = f8 - omP * sp + omM * sm;
  if (P.gx != 0.0 || P.gy != 0.0) {
    addGuo(n, 0u, 0.0, 0.0, 4.0 / 9.0, ux, uy, omP, omM);
    addGuo(n, 1u, 1.0, 0.0, 1.0 / 9.0, ux, uy, omP, omM);
    addGuo(n, 2u, 0.0, 1.0, 1.0 / 9.0, ux, uy, omP, omM);
    addGuo(n, 3u, -1.0, 0.0, 1.0 / 9.0, ux, uy, omP, omM);
    addGuo(n, 4u, 0.0, -1.0, 1.0 / 9.0, ux, uy, omP, omM);
    addGuo(n, 5u, 1.0, 1.0, 1.0 / 36.0, ux, uy, omP, omM);
    addGuo(n, 6u, -1.0, 1.0, 1.0 / 36.0, ux, uy, omP, omM);
    addGuo(n, 7u, -1.0, -1.0, 1.0 / 36.0, ux, uy, omP, omM);
    addGuo(n, 8u, 1.0, -1.0, 1.0 / 36.0, ux, uy, omP, omM);
  }
}

// streaming of one direction k into node n; returns the momentum handed to the wall through this link
fn dirStream(n: u32, i: i32, j: i32, k: u32, cx: i32, cy: i32, kb: u32, kf: u32) -> vec2<f32> {
  let N = P.n;
  let nx = i32(P.nx);
  let ny = i32(P.ny);
  var si = i - cx;
  var sj = j - cy;
  var outside = false;
  if (si < 0 || si >= nx) {
    if ((P.flags & 1u) != 0u) { si = (si + nx) % nx; } else { outside = true; }
  }
  if (sj < 0 || sj >= ny) {
    if ((P.flags & 2u) != 0u) { sj = (sj + ny) % ny; } else { outside = true; }
  }
  if (outside) {
    if (si >= 0 && si < nx) { fNext[k * N + n] = fCur[kf * N + n]; } else { fNext[k * N + n] = fCur[k * N + n]; }
    return vec2<f32>(0.0, 0.0);
  }
  let s = u32(sj) * P.nx + u32(si);
  if (solid[s] == 0u) {
    fNext[k * N + n] = fCur[k * N + s];
    return vec2<f32>(0.0, 0.0);
  }
  var q = wallQ[kb * N + n];
  if (!(q > 0.0)) { q = 0.5; }
  let own = fCur[kb * N + n];
  var v = own;
  if (q < 0.5) {
    let bi = i + cx;
    let bj = j + cy;
    if (bi >= 0 && bi < nx && bj >= 0 && bj < ny) {
      let bn = u32(bj) * P.nx + u32(bi);
      if (solid[bn] == 0u) {
        v = 2.0 * q * own + (1.0 - 2.0 * q) * fCur[kb * N + bn];
      }
    }
  } else {
    v = own / (2.0 * q) + ((2.0 * q - 1.0) / (2.0 * q)) * fCur[k * N + n];
  }
  fNext[k * N + n] = v;
  let m = own + v;
  return vec2<f32>(f32(-cx) * m, f32(-cy) * m);
}

@compute @workgroup_size(128)
fn stream(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let n = nodeOf(gid, nwg);
  let N = P.n;
  if (n >= N) { return; }
  if (solid[n] != 0u) { return; }
  let i = i32(n % P.nx);
  let j = i32(n / P.nx);
  fNext[n] = fCur[n];
  var fv = vec2<f32>(0.0, 0.0);
  fv = fv + dirStream(n, i, j, 1u, 1, 0, 3u, 1u);
  fv = fv + dirStream(n, i, j, 2u, 0, 1, 4u, 4u);
  fv = fv + dirStream(n, i, j, 3u, -1, 0, 1u, 3u);
  fv = fv + dirStream(n, i, j, 4u, 0, -1, 2u, 2u);
  fv = fv + dirStream(n, i, j, 5u, 1, 1, 7u, 8u);
  fv = fv + dirStream(n, i, j, 6u, -1, 1, 8u, 7u);
  fv = fv + dirStream(n, i, j, 7u, -1, -1, 5u, 6u);
  fv = fv + dirStream(n, i, j, 8u, 1, -1, 6u, 5u);
  if ((P.flags & 1u) == 0u && i == 0) {
    var r = 1.0;
    if (P.ramp > 0u) { r = min(1.0, f32(counter[0]) / f32(P.ramp)); }
    let u = P.uIn * r * r * (3.0 - 2.0 * r);
    let f0 = fNext[n];
    let f2 = fNext[2u * N + n];
    let f4 = fNext[4u * N + n];
    let f3 = fNext[3u * N + n];
    let f6 = fNext[6u * N + n];
    let f7 = fNext[7u * N + n];
    let rho = (f0 + f2 + f4 + 2.0 * (f3 + f6 + f7)) / (1.0 - u);
    fNext[N + n] = f3 + (2.0 / 3.0) * rho * u;
    fNext[5u * N + n] = f7 - 0.5 * (f2 - f4) + (1.0 / 6.0) * rho * u;
    fNext[8u * N + n] = f6 + 0.5 * (f2 - f4) + (1.0 / 6.0) * rho * u;
  }
  if (fv.x != 0.0 || fv.y != 0.0) {
    atomicAdd(&force[0], i32(round(fv.x * FORCE_SCALE)));
    atomicAdd(&force[1], i32(round(fv.y * FORCE_SCALE)));
  }
}

@compute @workgroup_size(64)
fn outflow(@builtin(global_invocation_id) gid: vec3<u32>) {
  let j = gid.x;
  if (j == 0u) { counter[0] = counter[0] + 1u; }
  if (j >= P.ny) { return; }
  if ((P.flags & 1u) != 0u) { return; }
  let N = P.n;
  let r = j * P.nx + P.nx - 1u;
  if (solid[r] != 0u) { return; }
  for (var k = 0u; k < 9u; k = k + 1u) {
    fNext[k * N + r] = fNext[k * N + r - 1u];
  }
}

// density and velocity at a node of the current populations (a solid node reads as rho = 1, u = 0, as in the CPU solver)
fn macroAt(n: u32) -> vec3<f32> {
  if (solid[n] != 0u) { return vec3<f32>(1.0, 0.0, 0.0); }
  let N = P.n;
  let f0 = fCur[n];
  let f1 = fCur[N + n];
  let f2 = fCur[2u * N + n];
  let f3 = fCur[3u * N + n];
  let f4 = fCur[4u * N + n];
  let f5 = fCur[5u * N + n];
  let f6 = fCur[6u * N + n];
  let f7 = fCur[7u * N + n];
  let f8 = fCur[8u * N + n];
  let r = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  return vec3<f32>(r, (f1 - f3 + f5 - f6 - f7 + f8) / r + 0.5 * P.gx, (f2 - f4 + f5 + f6 - f7 - f8) / r + 0.5 * P.gy);
}

@compute @workgroup_size(128)
fn accumulate(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let n = nodeOf(gid, nwg);
  let N = P.n;
  if (n >= N) { return; }
  if (n == 0u) {
    // the force summed so far, kept at every sample: the lift and drag as a time series (differences of these, per step, are the forces)
    let idx = atomicAdd(&stats[6], 1u);
    series[2u * idx] = atomicLoad(&force[0]);
    series[2u * idx + 1u] = atomicLoad(&force[1]);
  }
  if (solid[n] != 0u) { return; }
  let m = macroAt(n);
  // the density is accumulated as its difference from 1 (a sum of values near 1 would lose its low digits in 32 bits); the host adds the samples back
  acc[n] = acc[n] + (m.x - 1.0);
  acc[N + n] = acc[N + n] + m.y;
  acc[2u * N + n] = acc[2u * N + n] + m.z;
  let col = n % P.nx;
  let sp = sqrt(m.y * m.y + m.z * m.z);
  atomicMax(&stats[2], bitcast<u32>(sp));
  atomicMin(&stats[3], bitcast<u32>(m.x));
  atomicMax(&stats[4], bitcast<u32>(m.x));
  if (col == 4u) { atomicAdd(&stats[0], bitcast<u32>(i32(round(m.x * m.y * FLUX_SCALE)))); }
  if (col == P.nx - 6u) { atomicAdd(&stats[1], bitcast<u32>(i32(round(m.x * m.y * FLUX_SCALE)))); }
  if (n == P.probe) { atomicAdd(&stats[5], bitcast<u32>(i32(round(m.x * PROBE_SCALE)))); }
}

@compute @workgroup_size(64)
fn snapshot(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let idx = gid.x + gid.y * nwg.x * 64u;
  if (idx >= S.gw * S.gh) { return; }
  let gi = idx % S.gw;
  let gj = idx / S.gw;
  let x = min(P.nx - 2u, max(1u, gi * S.stride));
  let y = min(P.ny - 2u, max(1u, gj * S.stride));
  let n = y * P.nx + x;
  if (solid[n] != 0u) { snapOut[idx] = 1.0e30; return; }
  let m = macroAt(n);
  let cp = (m.x - 1.0) / 3.0 / (0.5 * S.U * S.U * S.rhoInf);
  let s = sqrt(m.y * m.y + m.z * m.z) / S.U;
  var v = 0.0;
  if (S.kind == 0u) { v = s; }
  else if (S.kind == 1u) { v = m.y / S.U; }
  else if (S.kind == 2u) { v = m.z / S.U; }
  else if (S.kind == 3u) { v = cp; }
  else if (S.kind == 4u) { v = cp + s * s - 1.0; }
  else {
    let a = macroAt(n + 1u);
    let b = macroAt(n - 1u);
    let c = macroAt(n + P.nx);
    let d = macroAt(n - P.nx);
    v = (((a.z - b.z) / 2.0 - (c.y - d.y) / 2.0) * S.cells) / S.U;
  }
  snapOut[idx] = v;
}
`;

export const SNAPSHOT_KIND = { speed: 0, ux: 1, uy: 2, pressure: 3, total: 4, vorticity: 5 } as const;
export type GpuSnapshotKind = keyof typeof SNAPSHOT_KIND;

export interface GpuLbmConfig extends LbmConfig {
  /** how many samples of the force a block can hold (the cumulative force is kept at every sample); default 4096 */
  seriesCapacity?: number;
  /** lattice node of the density probe (the upstream reference density of a run); default: the middle row, 40 % of the way along the first 48 cells */
  probe?: number;
}

export interface GpuInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  /** the largest storage buffer the card allows [bytes] */
  maxStorageBufferBindingSize: number;
  maxBufferSize: number;
  /** a software implementation of WebGPU (no graphics card): works, but slowly */
  software: boolean;
  /** the graphics of the processor (Intel gen / Xe / Iris / UHD) rather than a separate card: a computer that also has a separate card may be giving the browser this one */
  integrated: boolean;
}

export interface GpuSummary {
  /** the mean force per step over each sampling interval of the block (lattice units), in the order the samples were taken, with the step numbers they ended at */
  series: { steps: number[]; fx: number[]; fy: number[] };
  samples: number;
  /** steps since the last reset */
  steps: number;
  /** the mean force on the body per step over the block, in lattice units */
  fx: number;
  fy: number;
  /** the sums over the samples of the mass flux across the columns 4 and nx − 6, and of the density probe */
  fluxIn: number;
  fluxOut: number;
  probe: number;
  maxSpeed: number;
  rhoMin: number;
  rhoMax: number;
}

export interface GpuBlock extends GpuSummary {
  /** sums over the samples of the block, node by node */
  rho: Float64Array;
  ux: Float32Array;
  uy: Float32Array;
}

/** Ask the browser for a WebGPU device with the largest buffers the card allows (the default limit of 128 MiB is too small for a fine lattice). */
export async function openGpu(): Promise<{ device: GPUDevice; info: GpuInfo } | null> {
  const nav = (globalThis as unknown as { navigator?: { gpu?: GPU } }).navigator;
  if (!nav?.gpu) return null;
  const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const want: Record<string, number> = {};
  for (const key of ['maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupsPerDimension'] as const) want[key] = adapter.limits[key];
  const device = await adapter.requestDevice({ requiredLimits: want });
  const info = describeAdapter(adapter);
  return { device, info };
}

/** Is there a WebGPU adapter, and which? (No device is opened.) */
export async function probeGpu(): Promise<GpuInfo | null> {
  const nav = (globalThis as unknown as { navigator?: { gpu?: GPU } }).navigator;
  if (!nav?.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return adapter ? describeAdapter(adapter) : null;
  } catch {
    return null;
  }
}

function describeAdapter(adapter: GPUAdapter): GpuInfo {
  const raw = (adapter as unknown as { info?: Partial<GpuInfo> }).info ?? {};
  return {
    vendor: String(raw.vendor ?? ''),
    architecture: String(raw.architecture ?? ''),
    device: String(raw.device ?? ''),
    description: String(raw.description ?? ''),
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    software: /swiftshader|llvmpipe|software|basic render/i.test(`${raw.vendor ?? ''} ${raw.architecture ?? ''} ${raw.device ?? ''} ${raw.description ?? ''}`),
    integrated: isIntegrated(raw),
  };
}

/** Intel graphics other than the separate Arc cards (architecture xe-hpg), by what the adapter reports. */
export function isIntegrated(raw: Partial<Pick<GpuInfo, 'vendor' | 'architecture' | 'device' | 'description'>>): boolean {
  const vendor = String(raw.vendor ?? '');
  const text = `${raw.architecture ?? ''} ${raw.device ?? ''} ${raw.description ?? ''}`;
  if (/intel/i.test(vendor) || /intel/i.test(text)) return !/hpg|arc\b/i.test(text);
  return false;
}

/** Bytes of device memory a lattice of nx × ny nodes needs. */
export function gpuBytes(nx: number, ny: number): number {
  const N = nx * ny;
  // two population buffers (36 N each), the wall fractions (36 N), the solid mask (4 N), the accumulators (12 N) and their read-back copy (12 N)
  return 36 * N * 3 + 4 * N + 24 * N;
}

export class GpuLbm {
  readonly nx: number;
  readonly ny: number;
  readonly N: number;
  readonly tau: number;
  steps = 0;
  /** accumulation samples taken since the last read-back */
  samples = 0;
  private readonly device: GPUDevice;
  private readonly bufs: Record<string, GPUBuffer> = {};
  private readonly pipes: Record<string, GPUComputePipeline> = {};
  private readonly groups: Record<string, GPUBindGroup[]> = {};
  private readonly params: ArrayBuffer;
  private readonly wgx: number;
  private readonly wgy: number;
  private orient = 0;
  private readonly staging: Record<string, GPUBuffer> = {};
  private snapBuf: { out: GPUBuffer; read: GPUBuffer; cap: number } | null = null;
  private readonly cfg: GpuLbmConfig;
  private lost: string | null = null;
  private seriesCap = 4096;
  /** the step number at each sample of this block, and the step at which the block (force sums) started */
  private sampleSteps: number[] = [];
  private blockStart = 0;

  private constructor(device: GPUDevice, c: GpuLbmConfig) {
    this.device = device;
    this.cfg = c;
    this.nx = c.nx;
    this.ny = c.ny;
    this.N = c.nx * c.ny;
    this.tau = c.tau;
    const need = Math.ceil(this.N / 128);
    this.wgx = Math.min(need, 32768);
    this.wgy = Math.ceil(need / this.wgx);
    this.params = new ArrayBuffer(48);
    void device.lost.then((i) => {
      this.lost = `${i.reason}: ${i.message}`;
    });
  }

  static async create(device: GPUDevice, c: GpuLbmConfig): Promise<GpuLbm> {
    const g = new GpuLbm(device, c);
    await g.init();
    return g;
  }

  private buffer(name: string, size: number, usage: number): GPUBuffer {
    const b = this.device.createBuffer({ label: name, size: Math.max(16, Math.ceil(size / 4) * 4), usage });
    this.bufs[name] = b;
    return b;
  }

  private async init() {
    const { device, N, nx, ny } = this;
    const c = this.cfg;
    const lim = device.limits;
    const need = 36 * N;
    if (need > lim.maxStorageBufferBindingSize || need > lim.maxBufferSize) throw new Error(`the lattice (${nx} × ${ny} nodes) needs a ${(need / 1048576).toFixed(0)} MiB buffer; this graphics card allows ${(Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize) / 1048576).toFixed(0)} MiB: use a coarser resolution`);
    const S = GPUBufferUsage.STORAGE;
    const COPY_SRC = GPUBufferUsage.COPY_SRC;
    const COPY_DST = GPUBufferUsage.COPY_DST;
    device.pushErrorScope('out-of-memory');
    this.buffer('params', 48, GPUBufferUsage.UNIFORM | COPY_DST);
    this.buffer('snapParams', 32, GPUBufferUsage.UNIFORM | COPY_DST);
    const solid = c.solid ?? new Uint8Array(N);
    const solid32 = new Uint32Array(N);
    for (let n = 0; n < N; n++) solid32[n] = solid[n] ? 1 : 0;
    this.buffer('solid', 4 * N, S | COPY_DST);
    device.queue.writeBuffer(this.bufs.solid, 0, solid32);
    this.buffer('wallQ', 36 * N, S | COPY_DST);
    if (c.wallQ) device.queue.writeBuffer(this.bufs.wallQ, 0, c.wallQ.buffer as ArrayBuffer, c.wallQ.byteOffset, c.wallQ.byteLength);
    // the relaxation rates of every column: the bulk value, and the absorbing layer in front of the outflow
    const magic = c.magic ?? 3 / 16;
    const om = new Float32Array(2 * nx);
    for (let i = 0; i < nx; i++) {
      let tau = c.tau;
      if (c.sponge && c.sponge.cells > 0) {
        const f = (i - (nx - c.sponge.cells)) / c.sponge.cells;
        if (f > 0) tau = c.tau + (c.sponge.tau - c.tau) * f * f;
      }
      om[2 * i] = 1 / tau;
      om[2 * i + 1] = 1 / (magic / (tau - 0.5) + 0.5);
    }
    this.buffer('omega', 8 * nx, S | COPY_DST);
    device.queue.writeBuffer(this.bufs.omega, 0, om);
    // the starting populations (the same function as the CPU solver, in 32 bits), uploaded in slices of 64 MiB
    this.buffer('fA', 36 * N, S | COPY_DST | COPY_SRC);
    this.buffer('fB', 36 * N, S | COPY_DST | COPY_SRC);
    const f0 = new Float32Array(9 * N);
    fillInitialPopulations(c, solid, f0);
    const slice = 16 * 1048576;
    for (let at = 0; at < f0.length; at += slice) device.queue.writeBuffer(this.bufs.fA, at * 4, f0.subarray(at, Math.min(f0.length, at + slice)));
    this.buffer('force', 8, S | COPY_DST | COPY_SRC);
    this.buffer('counter', 4, S | COPY_DST | COPY_SRC);
    this.buffer('acc', 12 * N, S | COPY_DST | COPY_SRC);
    this.buffer('stats', 32, S | COPY_DST | COPY_SRC);
    this.buffer('snapOut', 16, S | COPY_SRC);
    this.seriesCap = c.seriesCapacity ?? 4096;
    this.buffer('series', 8 * this.seriesCap, S | COPY_SRC | COPY_DST);
    const oom = await device.popErrorScope();
    if (oom) throw new Error(`the graphics card ran out of memory for a lattice of ${nx} × ${ny} nodes (${(gpuBytes(nx, ny) / 1048576).toFixed(0)} MiB): use a coarser resolution`);
    this.writeParams();
    this.resetAccumulators();
    const module = device.createShaderModule({ label: 'lbm', code: WGSL });
    const info = await module.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length) throw new Error(`WGSL: ${errs.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
    device.pushErrorScope('validation');
    for (const entry of ['collide', 'stream', 'outflow', 'accumulate', 'snapshot']) this.pipes[entry] = device.createComputePipeline({ label: entry, layout: 'auto', compute: { module, entryPoint: entry } });
    const err = await device.popErrorScope();
    if (err) throw new Error(`WebGPU pipeline error: ${err.message}`);
    // bind groups: for every pipeline, one per orientation of the ping-pong (current = A or B)
    const b = this.bufs;
    const make = (entry: string, entries: (cur: GPUBuffer, next: GPUBuffer) => Record<number, GPUBuffer>) => {
      this.groups[entry] = [0, 1].map((o) => {
        const cur = o === 0 ? b.fA : b.fB;
        const next = o === 0 ? b.fB : b.fA;
        const e = entries(cur, next);
        return device.createBindGroup({ layout: this.pipes[entry].getBindGroupLayout(0), entries: Object.entries(e).map(([binding, buffer]) => ({ binding: Number(binding), resource: { buffer } })) });
      });
    };
    make('collide', (cur) => ({ 0: b.params, 1: b.solid, 3: b.omega, 4: cur }));
    make('stream', (cur, next) => ({ 0: b.params, 1: b.solid, 2: b.wallQ, 4: cur, 5: next, 6: b.force, 7: b.counter }));
    make('outflow', (_cur, next) => ({ 0: b.params, 1: b.solid, 5: next, 7: b.counter }));
    make('accumulate', (cur) => ({ 0: b.params, 1: b.solid, 4: cur, 6: b.force, 8: b.acc, 9: b.stats, 12: b.series }));
  }

  private writeParams() {
    const c = this.cfg;
    const u = new Uint32Array(this.params);
    const f = new Float32Array(this.params);
    u[0] = this.nx;
    u[1] = this.ny;
    u[2] = this.N;
    u[3] = c.rampSteps ?? 0;
    f[4] = c.uIn;
    f[5] = (c.smagorinsky ?? 0) ** 2;
    f[6] = c.tau;
    f[7] = c.magic ?? 3 / 16;
    f[8] = c.bodyForce?.[0] ?? 0;
    f[9] = c.bodyForce?.[1] ?? 0;
    u[10] = (c.xMode === 'periodic' ? 1 : 0) | (c.yMode === 'periodic' ? 2 : 0);
    u[11] = c.probe ?? (this.ny >> 1) * this.nx + (this.nx >> 2);
    this.device.queue.writeBuffer(this.bufs.params, 0, this.params);
  }

  /** Where the density probe sits (a lattice node); a run sets it to the upstream reference point. */
  setProbe(node: number) {
    new Uint32Array(this.params)[11] = node;
    this.device.queue.writeBuffer(this.bufs.params, 0, this.params);
  }

  /** Zero the time averages, the force and the monitors; start a new time block. */
  resetAccumulators() {
    this.device.queue.writeBuffer(this.bufs.acc, 0, new Float32Array(3 * this.N));
    this.resetSummary();
  }

  /** Zero the force and the monitors (not the time averages of the fields). */
  resetSummary() {
    const d = this.device;
    d.queue.writeBuffer(this.bufs.force, 0, new Int32Array(2));
    // stats: flux in, flux out, max speed, min density (starts at a large float), max density, probe sum
    const s = new Uint32Array(8);
    new Float32Array(s.buffer)[3] = 1e30;
    d.queue.writeBuffer(this.bufs.stats, 0, s);
    this.samples = 0;
    this.blockSteps = 0;
    this.sampleSteps = [];
    this.blockStart = this.steps;
  }
  private blockSteps = 0;

  /**
   * Advance `count` steps. A sample (time-average accumulation and monitors) is taken after every step whose number t satisfies
   * t > sampleAfter and (t − sampleAfter) mod sampleEvery = 0. Resolves when the card has finished.
   */
  async advance(count: number, sampleEvery = 0, sampleAfter = 0): Promise<void> {
    if (this.lost) throw new Error(`the graphics device was lost (${this.lost})`);
    const d = this.device;
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    const nodes: [number, number] = [this.wgx, this.wgy];
    const rows = Math.ceil(this.ny / 64);
    for (let s = 0; s < count; s++) {
      const o = this.orient;
      pass.setPipeline(this.pipes.collide);
      pass.setBindGroup(0, this.groups.collide[o]);
      pass.dispatchWorkgroups(...nodes);
      pass.setPipeline(this.pipes.stream);
      pass.setBindGroup(0, this.groups.stream[o]);
      pass.dispatchWorkgroups(...nodes);
      pass.setPipeline(this.pipes.outflow);
      pass.setBindGroup(0, this.groups.outflow[o]);
      pass.dispatchWorkgroups(rows);
      this.orient = 1 - o;
      this.steps++;
      this.blockSteps++;
      const t = this.steps;
      if (sampleEvery > 0 && t > sampleAfter && (t - sampleAfter) % sampleEvery === 0) {
        pass.setPipeline(this.pipes.accumulate);
        pass.setBindGroup(0, this.groups.accumulate[this.orient]);
        pass.dispatchWorkgroups(...nodes);
        this.samples++;
        this.sampleSteps.push(t);
      }
    }
    pass.end();
    d.pushErrorScope('validation');
    d.queue.submit([enc.finish()]);
    const err = await d.popErrorScope();
    if (err) throw new Error(`WebGPU error: ${err.message}`);
    await d.queue.onSubmittedWorkDone();
  }

  private stage(name: string, size: number): GPUBuffer {
    let b = this.staging[name];
    if (!b || b.size < size) {
      b?.destroy();
      b = this.device.createBuffer({ label: `read-${name}`, size: Math.max(16, Math.ceil(size / 4) * 4), usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.staging[name] = b;
    }
    return b;
  }

  /** Read the force and the monitors back (not the fields), and, if `reset`, zero them for the next stretch of steps. */
  async readSummary(reset = true): Promise<GpuSummary> {
    const d = this.device;
    const stR = this.stage('stats', 32);
    const fR = this.stage('force', 8);
    const nS = Math.min(this.sampleSteps.length, this.seriesCap);
    const sR = this.stage('series', Math.max(8, 8 * nS));
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufs.stats, 0, stR, 0, 32);
    enc.copyBufferToBuffer(this.bufs.force, 0, fR, 0, 8);
    if (nS > 0) enc.copyBufferToBuffer(this.bufs.series, 0, sR, 0, 8 * nS);
    d.queue.submit([enc.finish()]);
    await Promise.all([stR.mapAsync(GPUMapMode.READ, 0, 32), fR.mapAsync(GPUMapMode.READ, 0, 8), ...(nS > 0 ? [sR.mapAsync(GPUMapMode.READ, 0, 8 * nS)] : [])]);
    const st = new Uint32Array(stR.getMappedRange(0, 32).slice(0));
    const fo = new Int32Array(fR.getMappedRange(0, 8).slice(0));
    const cum = nS > 0 ? new Int32Array(sR.getMappedRange(0, 8 * nS).slice(0)) : new Int32Array(0);
    stR.unmap();
    fR.unmap();
    if (nS > 0) sR.unmap();
    // the mean force per step over each interval between two samples (the first interval starts with the block)
    const series = { steps: this.sampleSteps.slice(0, nS), fx: [] as number[], fy: [] as number[] };
    let prevStep = this.blockStart;
    let px = 0;
    let py = 0;
    for (let k = 0; k < nS; k++) {
      const dt = Math.max(1, series.steps[k] - prevStep);
      series.fx.push((cum[2 * k] - px) / FORCE_SCALE / dt);
      series.fy.push((cum[2 * k + 1] - py) / FORCE_SCALE / dt);
      px = cum[2 * k];
      py = cum[2 * k + 1];
      prevStep = series.steps[k];
    }
    const si = new Int32Array(st.buffer);
    const sf = new Float32Array(st.buffer);
    const steps = Math.max(1, this.blockSteps);
    const out: GpuSummary = {
      series,
      samples: this.samples,
      steps: this.blockSteps,
      fx: fo[0] / FORCE_SCALE / steps,
      fy: fo[1] / FORCE_SCALE / steps,
      fluxIn: si[0] / FLUX_SCALE,
      fluxOut: si[1] / FLUX_SCALE,
      probe: si[5] / PROBE_SCALE,
      maxSpeed: sf[2],
      rhoMin: sf[3],
      rhoMax: sf[4],
    };
    if (reset) this.resetSummary();
    return out;
  }

  /** Read the accumulated block back (and, if `reset`, start the next block). */
  async readBlock(reset = true): Promise<GpuBlock> {
    const { N } = this;
    const d = this.device;
    const accR = this.stage('acc', 12 * N);
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufs.acc, 0, accR, 0, 12 * N);
    d.queue.submit([enc.finish()]);
    const [summary] = await Promise.all([this.readSummary(false), accR.mapAsync(GPUMapMode.READ, 0, 12 * N)]);
    const acc = new Float32Array(accR.getMappedRange(0, 12 * N).slice(0));
    accR.unmap();
    const rho = new Float64Array(N);
    for (let i = 0; i < N; i++) rho[i] = acc[i] + summary.samples;
    const out: GpuBlock = { ...summary, rho, ux: acc.subarray(N, 2 * N), uy: acc.subarray(2 * N, 3 * N) };
    if (reset) this.resetAccumulators();
    return out;
  }

  /** A decimated field for the picture, computed on the card (NaN inside the body). */
  async snapshot(kind: GpuSnapshotKind, stride: number, rhoInf: number, uRef: number, cells: number): Promise<{ nx: number; ny: number; values: Float32Array }> {
    const d = this.device;
    const gw = Math.ceil(this.nx / stride);
    const gh = Math.ceil(this.ny / stride);
    const size = gw * gh * 4;
    if (!this.snapBuf || this.snapBuf.cap < size) {
      this.snapBuf?.out.destroy();
      this.snapBuf?.read.destroy();
      const out = d.createBuffer({ label: 'snapOut', size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = d.createBuffer({ label: 'snapRead', size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.snapBuf = { out, read, cap: size };
    }
    const sp = new ArrayBuffer(32);
    const u = new Uint32Array(sp);
    const f = new Float32Array(sp);
    u[0] = SNAPSHOT_KIND[kind];
    u[1] = stride;
    u[2] = gw;
    u[3] = gh;
    f[4] = rhoInf;
    f[5] = uRef;
    f[6] = cells;
    d.queue.writeBuffer(this.bufs.snapParams, 0, sp);
    const b = this.bufs;
    const state = this.orient === 0 ? b.fA : b.fB;
    const group = d.createBindGroup({
      layout: this.pipes.snapshot.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: b.params } },
        { binding: 1, resource: { buffer: b.solid } },
        { binding: 4, resource: { buffer: state } },
        { binding: 10, resource: { buffer: this.snapBuf.out } },
        { binding: 11, resource: { buffer: b.snapParams } },
      ],
    });
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.snapshot);
    pass.setBindGroup(0, group);
    const wg = Math.ceil((gw * gh) / 64);
    pass.dispatchWorkgroups(Math.min(wg, 32768), Math.ceil(wg / 32768));
    pass.end();
    enc.copyBufferToBuffer(this.snapBuf.out, 0, this.snapBuf.read, 0, size);
    d.queue.submit([enc.finish()]);
    await this.snapBuf.read.mapAsync(GPUMapMode.READ, 0, size);
    const values = new Float32Array(this.snapBuf.read.getMappedRange(0, size).slice(0));
    this.snapBuf.read.unmap();
    for (let i = 0; i < values.length; i++) if (values[i] > 1e29) values[i] = Number.NaN;
    return { nx: gw, ny: gh, values };
  }

  /** Density and velocity of every node (for tests and for the self-test; a big copy). */
  async fields(): Promise<{ rho: Float64Array; ux: Float32Array; uy: Float32Array }> {
    // accumulate once into a cleared accumulator, read it back, and restore nothing: only used where no block is in progress
    this.resetAccumulators();
    const d = this.device;
    const enc = d.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.accumulate);
    pass.setBindGroup(0, this.groups.accumulate[this.orient]);
    pass.dispatchWorkgroups(this.wgx, this.wgy);
    pass.end();
    d.queue.submit([enc.finish()]);
    this.samples = 1;
    const b = await this.readBlock(true);
    return { rho: b.rho, ux: b.ux, uy: b.uy };
  }

  /** Release the card's memory; `closeDevice` also closes the device (when this solver was the only user of it). */
  destroy(closeDevice = false) {
    for (const b of Object.values(this.bufs)) b.destroy();
    for (const b of Object.values(this.staging)) b.destroy();
    this.snapBuf?.out.destroy();
    this.snapBuf?.read.destroy();
    if (closeDevice) this.device.destroy();
  }
}
