import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reservedSeedErrors } from '../src/app/seeds';
import { FLOW_GEOMETRY_EXTENDED, FLOW_GEOMETRY_QUICK, FLOW_GEOMETRY_REFERENCE } from '../src/experiments/FlowGeometryExperiment';
import { DETECTOR_SPEC } from '../src/measurements/SeparationDetector';

/**
 * Guards of the flow-guided geometry feature: it never touches seeds reserved by the UB-0
 * protocol, it keeps the classical-aerodynamics terms and hard-coded separation conventions out of
 * the code that decides things, and it never calls a geometry optimised.
 */
const root = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const stripStrings = (s: string) => s.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

describe('flow-guided geometry: reserved seeds', () => {
  it('refuses any seed in a UB-0 protocol range and accepts the workspace defaults', () => {
    expect(reservedSeedErrors([301, 302, 303])).toEqual([]);
    for (const s of [9001, 9750, 10500, 11001, 12999, 20001, 29999]) {
      const e = reservedSeedErrors([s]);
      expect(e, `seed ${s}`).toHaveLength(1);
      expect(e[0]).toMatch(/reserved by the UB-0 protocol/);
    }
    expect(reservedSeedErrors([301, 20005, 9600])).toHaveLength(2);
  });

  it('the presets use seeds outside every reserved range', () => {
    for (const p of [FLOW_GEOMETRY_QUICK, FLOW_GEOMETRY_EXTENDED, FLOW_GEOMETRY_REFERENCE]) expect(reservedSeedErrors(p.seeds)).toEqual([]);
  });
});

describe('flow-guided geometry: no hidden physics, no hard-coded separation or optimum', () => {
  const dirs = ['geometry', 'measurements'].flatMap((d) => files(join(root, d)));
  const uiFiles = [...files(join(root, 'ui', 'flow')), join(root, 'ui', 'FlowGeometry.tsx'), join(root, 'app', 'projectStore.ts'), join(root, 'experiments', 'FlowGeometryExperiment.ts')];

  it('the geometry and measurement code never imports a benchmark', () => {
    for (const f of [...dirs, ...uiFiles]) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from\s+['"][^'"]*benchmarks[^'"]*['"]/);
  });

  it('decision code contains no Kutta condition, classical aerodynamic method or airfoil family', () => {
    for (const f of [...dirs, ...uiFiles]) {
      const code = stripStrings(stripComments(readFileSync(f, 'utf8')));
      for (const term of [/kutta/i, /bernoulli/i, /navier/i, /xfoil/i, /naca/i, /joukowski/i, /thin[- ]airfoil/i, /potential[- ]flow/i, /panel[- ]method/i, /lift[- ]?coefficient/i, /\bcl\b/i, /\bcd\b/i]) expect(code, `${f}: ${term}`).not.toMatch(term);
    }
  });

  it('no user-visible text calls anything optimised, optimal or best, except to deny it', () => {
    for (const f of uiFiles) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const m = line.match(/(optimi[sz]ed|optimal|optimum|best (shape|geometry|airfoil))/i);
        if (!m) return;
        expect(line, `${f}:${i + 1}`).toMatch(/not|never|no |nothing|isn[’']t|without|neither|unless/i);
      });
    }
  });
});

describe('flow-guided geometry: the detector is declared experimental', () => {
  it('every analysis carries the experimental label and the spec id', () => {
    expect(DETECTOR_SPEC.id).toBe('wall-flux-detector/0');
    expect(readFileSync(join(root, 'measurements', 'SeparationDetector.ts'), 'utf8')).toMatch(/EXPERIMENTAL — an operational definition, not validated/);
  });
});
