import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards of the CFD workspace (flow-guided geometry B): it is conventional CFD, kept apart from the particle research. It must
 * not import the particle engine or the benchmarks, and the code that solves and decides must not contain a Kutta condition, a
 * classical aerodynamic method or an airfoil family: the physics is the Navier–Stokes equations on the lattice and nothing else.
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

const cfdFiles = [
  ...files(join(root, 'cfd')),
  join(root, 'ui', 'CfdGeometry.tsx'),
  join(root, 'ui', 'flow', 'CfdView.tsx'),
  join(root, 'ui', 'flow', 'CfdPanels.tsx'),
  join(root, 'ui', 'flow', 'useCfd.ts'),
  join(root, 'workers', 'cfd.worker.ts'),
  join(root, 'workers', 'cfdProtocol.ts'),
  join(root, 'app', 'cfdProjectStore.ts'),
  join(root, 'experiments', 'CfdScenario.ts'),
];

describe('the CFD workspace is separate from the particle engine', () => {
  it('the solver never imports the particle engine, its gas, walls or occupancy models, or any benchmark', () => {
    for (const f of files(join(root, 'cfd'))) {
      const src = readFileSync(f, 'utf8');
      // type-only imports are erased when compiling and carry no code across
      for (const m of src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
        const target = m[1];
        expect(target, `${f} imports ${target}`).not.toMatch(/\/(core|gas|walls|occupancy|benchmarks|validation|app|experiments)(\/|$)/);
      }
    }
  });

  it('only the plain-unit scenario module (experiments/CfdScenario.ts) imports the air reference, and the worker and store import no benchmark', () => {
    for (const f of cfdFiles) {
      const src = readFileSync(f, 'utf8');
      if (f.endsWith('CfdScenario.ts')) continue;
      expect(src, f).not.toMatch(/from\s+['"][^'"]*benchmarks[^'"]*['"]/);
    }
  });
});

describe('the CFD code imposes no classical aerodynamic theory', () => {
  it('no Kutta condition, panel or potential-flow method, thin-airfoil theory, Joukowski map, airfoil family or XFOIL in the code', () => {
    for (const f of cfdFiles) {
      const code = stripStrings(stripComments(readFileSync(f, 'utf8')));
      for (const term of [/kutta/i, /bernoulli/i, /xfoil/i, /naca/i, /joukowski/i, /thin[- ]airfoil/i, /potential[- ]flow/i, /panel[- ]method/i, /\bcl\b/i, /\bcd\b/i]) expect(code, `${f}: ${term}`).not.toMatch(term);
    }
  });

  it('no user-visible text calls anything optimised, optimal or best, except to deny it', () => {
    for (const f of cfdFiles) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const m = line.match(/(optimi[sz]ed|optimal|optimum|best (shape|geometry|airfoil))/i);
        if (!m) return;
        expect(line, `${f}:${i + 1}`).toMatch(/not|never|no |nothing|isn[’']t|without|neither|unless/i);
      });
    }
  });

  it('says in the workspace itself that it is conventional CFD and not the particle model', () => {
    const ui = readFileSync(join(root, 'ui', 'CfdGeometry.tsx'), 'utf8');
    expect(ui).toMatch(/NOT THE PARTICLE MODEL/);
    expect(ui).toMatch(/no particles, no model units, no Universe A or B/);
    const scenario = readFileSync(join(root, 'experiments', 'CfdScenario.ts'), 'utf8');
    expect(scenario).toMatch(/No Kutta condition, no circulation and no separation point are imposed/);
  });
});
