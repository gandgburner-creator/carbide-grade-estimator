import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Master prompt §2 / Bible §3: classical relations may exist only in
 * src/benchmarks and must never enter the discovery loop. Solver and
 * measurement layers therefore may not import benchmarks, and the benchmark
 * module may not be imported by anything the simulation itself runs.
 */
const SOLVER_DIRS = ['core', 'gas', 'occupancy', 'walls', 'measurements', 'geometry'];
const FORBIDDEN_TERMS = [/bernoulli/i, /navier/i, /xfoil/i, /naca/i, /thin[- ]airfoil/i, /potential[- ]flow/i];

function files(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(files(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('architecture: benchmarks are isolated from the solver', () => {
  const root = join(__dirname, '..', 'src');
  for (const d of SOLVER_DIRS) {
    for (const f of files(join(root, d))) {
      it(`${f.slice(root.length + 1)} does not import benchmarks`, () => {
        const src = readFileSync(f, 'utf8');
        expect(src).not.toMatch(/from\s+['"][^'"]*benchmarks[^'"]*['"]/);
      });
    }
  }

  it('no solver file mentions a classical aerodynamic method except in comments forbidding it', () => {
    for (const d of SOLVER_DIRS) {
      for (const f of files(join(root, d))) {
        const code = readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        for (const term of FORBIDDEN_TERMS) expect(code, `${f} contains ${term}`).not.toMatch(term);
      }
    }
  });
});
