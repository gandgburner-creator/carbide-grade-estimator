import type { WakeAnalysis } from '../measurements/WakeVoid';
import type { GeometryVersion } from './History';
import { planPointerStep, radiusOf, type PlateSpec, type PointerStep, type PointerStepConfig } from './Pointer';
import type { Side } from './SurfaceGeometry';

/**
 * The measured gap between the surface and the particle cloud (wake-void/0) as a function of plate-frame x, for the pointer
 * rule: linear between station centres, zero where the particles touch the surface or nothing is known.
 */
export function wakeGapAt(w: WakeAnalysis, plate: PlateSpec): (x: number) => number {
  const r = radiusOf(plate);
  const pts = w.stations.map((s) => ({ x: s.x - r, gap: s.known && s.unwetted ? s.gap : 0 }));
  return (x) => {
    if (!pts.length) return 0;
    if (x <= pts[0].x) return pts[0].gap;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (x <= b.x) return a.gap + ((x - a.x) / (b.x - a.x || 1)) * (b.gap - a.gap);
    }
    return pts[pts.length - 1].gap;
  };
}

export type MeasuredStep = { ok: true; st: PointerStep; summary: string } | { ok: false; done: boolean; reason: string };

/**
 * The next pointer step that the particle measurements of version `v` decide (planPointerStep on its wake-void gap), with a
 * one-sentence statement of what was measured. `done` is true when the pointer is already at the anchor.
 */
export function measuredPointerStep(v: GeometryVersion, side: Side, cfg: PointerStepConfig): MeasuredStep {
  const sh = v.shape;
  if (!sh) return { ok: false, done: false, reason: `${v.id} was not drawn with the pointer` };
  const w = v.run?.wake?.[side];
  if (!w) return { ok: false, done: false, reason: `${v.id} has no wake-void measurement: simulate it first` };
  const st = planPointerStep(sh.plate, sh.paths, side, wakeGapAt(w, sh.plate), cfg);
  if (!st) return { ok: false, done: true, reason: 'the pointer is already at the anchor' };
  const r = radiusOf(sh.plate);
  const summary = `Wake void of ${v.id} (wake-void/0, experimental): ${w.separation ? `the particles stop touching the ${side} surface from x = ${(w.separation.x - r).toFixed(1)} d on, standing off it by ${w.meanGap.toFixed(1)} d on average over that stretch` : `the particles touch the whole ${side} surface`}.`;
  return { ok: true, st, summary };
}

/** The minimal station data the CFD pointer rule needs (see cfd/CfdRun.ts CfdStationResult). */
export interface CfdGapStation {
  x: number;
  h: { mean: number } | null;
  hShare: number;
}

/**
 * The gap the pointer rule responds to in the CFD workspace: the height of the dividing streamline of the time-mean flow above the
 * surface (the height of the region of reversed flow beside it), where at least half of the time blocks found one; zero elsewhere.
 * Linear between station centres; `x` is the plate frame.
 */
export function cfdGapAt(stations: CfdGapStation[], plate: PlateSpec): (x: number) => number {
  const r = radiusOf(plate);
  const pts = stations.map((s) => ({ x: s.x - r, gap: s.h && s.hShare >= 0.5 && Number.isFinite(s.h.mean) ? s.h.mean : 0 }));
  return (x) => {
    if (!pts.length) return 0;
    if (x <= pts[0].x) return pts[0].gap;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (x <= b.x) return a.gap + ((x - a.x) / (b.x - a.x || 1)) * (b.gap - a.gap);
    }
    return pts[pts.length - 1].gap;
  };
}

export type CfdMeasuredStep = { ok: true; st: PointerStep; summary: string } | { ok: false; done: boolean; reason: string };

/** The next pointer step that the CFD result of a version decides (planPointerStep on the dividing-streamline height). */
export function measuredCfdStep(v: { id: string; shape: { plate: PlateSpec; paths: import('./Pointer').PointerPaths }; run: { result: { stations: Record<Side, CfdGapStation[]> } } | null }, side: Side, cfg: PointerStepConfig): CfdMeasuredStep {
  if (!v.run) return { ok: false, done: false, reason: `${v.id} has no CFD result: simulate it first` };
  const st = planPointerStep(v.shape.plate, v.shape.paths, side, cfdGapAt(v.run.result.stations[side], v.shape.plate), cfg);
  if (!st) return { ok: false, done: true, reason: 'the pointer is already at the anchor' };
  const tall = v.run.result.stations[side].filter((s) => s.h && s.hShare >= 0.5);
  const summary = tall.length
    ? `CFD of ${v.id}: the time-mean flow beside the ${side} surface is reversed over ${tall.length} of ${v.run.result.stations[side].length} stations, and the dividing streamline stands off the surface by up to ${Math.max(...tall.map((s) => s.h!.mean)).toFixed(1)} d.`
    : `CFD of ${v.id}: the time-mean flow beside the ${side} surface is not reversed anywhere (no dividing streamline).`;
  return { ok: true, st, summary };
}
