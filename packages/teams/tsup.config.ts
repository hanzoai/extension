import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` is the library entry; `server` is the runnable messaging endpoint
  // (`node dist/server.js` / the `hanzo-teams` bin).
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
