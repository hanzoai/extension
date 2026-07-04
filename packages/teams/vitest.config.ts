import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      // The server opens a socket and the bot wires botbuilder at runtime; the
      // pure logic they compose (dispatch/panels/context/hanzo/config/identity)
      // is what we assert.
      exclude: ['**/*.d.ts', '**/*.config.*', 'src/server.ts', 'src/index.ts'],
    },
  },
});
