import { defineConfig } from 'vitest/config';

/**
 * The answer surface mounts REAL @hanzo/ui (on @hanzo/gui), so the runner needs
 * the same web resolution the build uses — react-native → react-native-web,
 * react-native-svg stubbed (its CommonJS re-requires ESM, which Node refuses),
 * and the @hanzogui/* family inlined so the provider and the components share
 * ONE theme module instance. Same recipe as @hanzo/ui's own render suites.
 */
export default defineConfig({
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: [
      { find: /^react-native-svg(\/.*)?$/, replacement: new URL('./tests/react-native-svg.stub.ts', import.meta.url).pathname },
      { find: /^react-native$/, replacement: 'react-native-web' },
    ],
  },
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
    setupFiles: ['./tests/vitest.setup.ts'],
    // The bundle suites need a built dist/. Once, here, before the files run in
    // parallel — two of them used to build it themselves and raced. See
    // tests/built-dist.ts.
    globalSetup: ['./tests/built-dist.ts'],
    server: { deps: { inline: [/@hanzogui\//, /@hanzo\/gui/, /@hanzo\/ui/, /react-native/] } },
  },
});
