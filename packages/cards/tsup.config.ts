import { defineConfig } from 'tsup';

// Declarations come from `tsc -p tsconfig.build.json`, not tsup: tsup's dts step
// sets `baseUrl`, which TypeScript 6 rejects (TS5101), so it wrote no types.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs', 'esm'],
  splitting: false,
  sourcemap: false,
  clean: true,
});
