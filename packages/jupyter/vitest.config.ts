import { defineConfig } from 'vitest/config';

// Only the pure modules are unit-tested (notebook.ts, hanzo.ts prompt/shaping,
// config.ts, and the stripFences helper from index.ts). The JupyterLab widget
// layer (panel.tsx / the plugin's activate) is integration-tested by running
// JupyterLab, not here — vitest runs in a plain node environment with no DOM
// and no @jupyterlab runtime.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
