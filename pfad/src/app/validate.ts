import { reservedOwner } from './seeds';

/**
 * Configuration validation for the laboratory UI. The experiment's documented
 * defaults define the parameter set: a key that is not in the defaults is not a
 * parameter of that experiment and is rejected (unimplemented parameters are
 * never exposed), and every value must have the type of its default.
 */
export interface Issue {
  path: string;
  message: string;
}

export interface Validation {
  errors: Issue[];
  warnings: Issue[];
  /** paths whose value differs from the default (the user's changes) */
  changed: string[];
}

type Json = unknown;

const POSITIVE = /^(count|radius|length|height|width|chord|thickness|duration|L|prep|measure|sample|courant|measurementTime|startupTime|cellX|cellY|wallBinWidth|perCell|heightIn|blocks|measurementCollisions|equilibrationCollisions)$/;
const UNIT_INTERVAL = /^(accommodation|accommodations|restitution|restitutions|e)$/;
const FRACTION = /^(phi|areaFraction|areaFractions|packingFraction)$/;
const INTEGER = /^(count|seed|seeds|blocks|bins|Nc)$/;

function leafName(path: string): string {
  const parts = path.split('.').filter((p) => !/^\d+$/.test(p) && !/^\[\d+\]$/.test(p));
  return (parts[parts.length - 1] ?? '').replace(/\[\d+\]$/, '');
}

function checkNumber(path: string, v: number, out: Validation) {
  const k = leafName(path);
  if (!Number.isFinite(v)) {
    out.errors.push({ path, message: 'must be a finite number' });
    return;
  }
  if (INTEGER.test(k) && !Number.isInteger(v)) out.errors.push({ path, message: 'must be an integer' });
  if (POSITIVE.test(k) && !(v > 0)) out.errors.push({ path, message: 'must be > 0' });
  if (UNIT_INTERVAL.test(k) && !(v >= 0 && v <= 1)) out.errors.push({ path, message: 'must lie in [0, 1]' });
  if (FRACTION.test(k) && !(v > 0 && v < 0.75)) out.errors.push({ path, message: 'area fraction must lie in (0, 0.75)' });
}

function walk(path: string, value: Json, def: Json, out: Validation) {
  if (def === undefined) {
    out.errors.push({ path, message: 'not a parameter of this experiment' });
    return;
  }
  if (typeof def === 'number') {
    if (typeof value !== 'number') out.errors.push({ path, message: `must be a number (got ${typeof value})` });
    else {
      checkNumber(path, value, out);
      if (value !== def) out.changed.push(path);
    }
    return;
  }
  if (typeof def === 'string' || typeof def === 'boolean') {
    if (typeof value !== typeof def) out.errors.push({ path, message: `must be a ${typeof def} (got ${typeof value})` });
    else if (value !== def) out.changed.push(path);
    return;
  }
  if (def === null) {
    if (value !== null && typeof value !== 'number' && typeof value !== 'string') out.errors.push({ path, message: 'unexpected value' });
    return;
  }
  if (Array.isArray(def)) {
    if (!Array.isArray(value)) {
      out.errors.push({ path, message: 'must be a list' });
      return;
    }
    if (value.length === 0 && def.length > 0) out.errors.push({ path, message: 'must not be empty' });
    // every element is checked against the first default element (lists are homogeneous)
    const proto = def[0];
    if (JSON.stringify(value) !== JSON.stringify(def)) out.changed.push(path);
    if (proto === undefined) return;
    value.forEach((v, i) => {
      const p = `${path}[${i}]`;
      if (typeof proto === 'object' && proto !== null && !Array.isArray(proto) && typeof v === 'object' && v !== null && !Array.isArray(v)) {
        // objects in a list may carry optional keys that only some defaults have
        const keys = new Set(def.flatMap((d) => (d && typeof d === 'object' ? Object.keys(d as object) : [])));
        for (const k of Object.keys(v as object)) {
          if (!keys.has(k)) out.errors.push({ path: `${p}.${k}`, message: 'not a parameter of this experiment' });
          else {
            const withKey = def.find((d) => d && typeof d === 'object' && k in (d as object)) as Record<string, Json>;
            walkSilently(`${p}.${k}`, (v as Record<string, Json>)[k], withKey[k], out);
          }
        }
      } else walkSilently(p, v, proto, out);
    });
    return;
  }
  if (typeof def === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      out.errors.push({ path, message: 'must be an object' });
      return;
    }
    const d = def as Record<string, Json>;
    const v = value as Record<string, Json>;
    for (const k of Object.keys(v)) walk(path ? `${path}.${k}` : k, v[k], d[k], out);
    for (const k of Object.keys(d)) if (!(k in v)) out.errors.push({ path: path ? `${path}.${k}` : k, message: 'missing' });
  }
}

/** like walk, but list elements do not report "changed" individually */
function walkSilently(path: string, value: Json, def: Json, out: Validation) {
  const scratch: Validation = { errors: [], warnings: [], changed: [] };
  walk(path, value, def, scratch);
  out.errors.push(...scratch.errors);
  out.warnings.push(...scratch.warnings);
}

export interface ValidateOptions {
  /** reject seeds in the UB-0 protocol ranges (the UB-0 instrument) */
  protocolSeeds?: boolean;
  /** particle count above which the browser will be slow */
  slowParticles?: number;
}

export function validateParams(params: Record<string, Json>, defaults: Record<string, Json>, opts: ValidateOptions = {}): Validation {
  const out: Validation = { errors: [], warnings: [], changed: [] };
  walk('', params, defaults, out);
  const seeds = params.seeds;
  if (Array.isArray(seeds)) {
    if (seeds.length === 0) out.errors.push({ path: 'seeds', message: 'at least one seed is needed' });
    if (new Set(seeds).size !== seeds.length) out.errors.push({ path: 'seeds', message: 'seeds must be distinct (independent samples)' });
    for (const s of seeds) {
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 1 || s > 2 ** 31 - 1) out.errors.push({ path: 'seeds', message: `seed ${String(s)} must be an integer in [1, 2³¹ − 1]` });
      else if (opts.protocolSeeds) {
        const r = reservedOwner(s);
        if (r) out.errors.push({ path: 'seeds', message: `seed ${s} belongs to ${r.owner} (${r.from}–${r.to})` });
      }
    }
  }
  const count = typeof params.count === 'number' ? params.count : null;
  const slow = opts.slowParticles ?? 20000;
  if (count !== null && count > slow) out.warnings.push({ path: 'count', message: `${count} particles: expect a slow browser run; use the CLI for large configurations` });
  return out;
}
