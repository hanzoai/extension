import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000
  },
  resolve: {
    alias: {
      // must be absolute — vitest 3 no longer resolves relative aliases
      'vscode': path.resolve(__dirname, 'test/mocks/vscode.ts')
    }
  }
});