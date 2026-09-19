import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @hanzo/cards resolves to its built dist/, which a fresh install does not
    // have. The tests read its source instead, so they need no build first.
    alias: { '@hanzo/cards': fileURLToPath(new URL('../cards/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
