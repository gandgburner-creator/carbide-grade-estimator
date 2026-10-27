import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Git commit of the working tree ("<sha>" or "<sha>-dirty"), stamped into result provenance. */
function codeVersion(): string {
  try {
    const git = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const sha = git('git rev-parse HEAD');
    return git('git status --porcelain --untracked-files=no') ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  define: { __PFAD_CODE_VERSION__: JSON.stringify(codeVersion()) },
});
