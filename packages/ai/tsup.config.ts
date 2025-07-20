import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: false, // Disable type generation for now
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react'],
})