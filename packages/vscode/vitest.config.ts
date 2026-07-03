import { defineConfig } from 'vitest/config';
import path from 'path';

// Two harnesses live in this package: the mocha/vscode-test extension-host
// suites (src/test/**, compiled via tsconfig.test.json, run by `npm test`)
// and plain-node vitest suites. Each owns exactly one directory — vitest
// files go in src/test/vitest/ and are excluded from the mocha compile.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/vitest/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
