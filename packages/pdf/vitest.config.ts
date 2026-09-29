import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The modern pdf.js build calls Uint8Array.prototype.toHex, which browsers
  // have and Node 24 does not; the legacy build is pdf.js's build for Node.
  resolve: {
    alias: { 'pdfjs-dist': 'pdfjs-dist/legacy/build/pdf.mjs' },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
