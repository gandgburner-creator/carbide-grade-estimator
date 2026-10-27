import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

function codeVersion(): string {
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 300_000,
  },
  define: { __PFAD_CODE_VERSION__: JSON.stringify(codeVersion()) },
});
