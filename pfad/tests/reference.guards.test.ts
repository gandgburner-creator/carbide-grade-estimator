import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The reference airfoils are data a person chooses: the solver and every decision of the workspaces know none of them. Only the user
 * interface (src/ui) may import src/reference, and src/reference itself imports no benchmark, no particle engine and no worker.
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
const importsOf = (src: string) => [...src.matchAll(/^(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

describe('reference airfoils are isolated', () => {
  it('nothing but the user interface imports them', () => {
    for (const d of ['core', 'gas', 'walls', 'occupancy', 'measurements', 'geometry', 'cfd', 'app', 'workers', 'experiments', 'benchmarks', 'validation']) {
      for (const f of files(join(root, d))) for (const target of importsOf(readFileSync(f, 'utf8'))) expect(target, `${f} imports ${target}`).not.toMatch(/(^|\/)reference(\/|$)/);
    }
  });

  it('they import only the body representation and the types of a run', () => {
    for (const f of files(join(root, 'reference'))) {
      for (const target of importsOf(readFileSync(f, 'utf8'))) {
        if (target.startsWith('.') && !/\/(geometry\/SurfaceGeometry|cfd\/CfdRun)$/.test(target) && !/^\.\/[A-Za-z]+$/.test(target)) throw new Error(`${f} imports ${target}`);
      }
      // type-only imports of the CFD run
      for (const m of readFileSync(f, 'utf8').matchAll(/^import\s+(?!type\b)[^;]*from\s+['"]\.\.\/cfd\/[^'"]+['"]/gm)) throw new Error(`${f}: ${m[0]} is not type-only`);
    }
  });

  it('nothing in them calls a section best or optimal, except to say it is not', () => {
    for (const f of files(join(root, 'reference'))) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          const m = line.match(/(optimi[sz]ed|optimal|optimum|\bbest\b)/i);
          if (m) expect(line, `${f}:${i + 1}`).toMatch(/not|never|no |nothing|isn[’']t|without|neither|unless/i);
        });
    }
  });
});
