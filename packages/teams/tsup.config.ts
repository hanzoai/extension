import { defineConfig } from 'tsup';

// Declarations come from `tsc -p tsconfig.build.json`, as in @hanzo/cards: tsup's
// dts step sets `baseUrl`, which TypeScript 6 rejects (TS5101).
export default defineConfig({
  // `index` is the library entry; `server` is the runnable messaging endpoint
  // (`node dist/server.js` / the `hanzo-teams` bin).
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['cjs', 'esm'],
  splitting: false,
  sourcemap: true,
  clean: true,
});
