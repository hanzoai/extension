import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: false, // Temporarily disable type generation - needs fixing
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react'],
})