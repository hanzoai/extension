// Build the PDF workspace into dist/: bundle app.ts (ESM, so pdf.js's
// `new URL('./pdf.worker.mjs', import.meta.url)` resolves next to app.js at
// runtime), copy pdf.js's worker beside it, copy the static HTML/CSS/assets, and
// stamp the hosting base into index.html.
//
//   node build.js                                      → production
//   HANZO_PDF_BASE=https://localhost:8080 node build.js → local dev
//   node build.js --watch                               → rebuild on change
//
// The base URL is where the app is HOSTED (e.g. pdf.hanzo.ai over
// hanzoai/static). It is only informational metadata in the page; all API calls
// go to api.hanzo.ai regardless. No framework — esbuild + Node stdlib only.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const BASE = (process.env.HANZO_PDF_BASE || 'https://pdf.hanzo.ai').replace(/\/+$/, '');
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');

// pdf.js ships its worker as build/pdf.worker.mjs in the pdfjs-dist package; we
// resolve it via require.resolve so a version bump can't silently stale the
// path. We ship the minified worker to keep dist small.
const workerSrc = join(dirname(require.resolve('pdfjs-dist/package.json')), 'build', 'pdf.worker.min.mjs');

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, 'assets'), { recursive: true });

  // Bundle app.ts → dist/app.js as ESM. `new URL(..., import.meta.url)` in
  // pdf-view.ts must survive the bundle so the browser fetches the worker
  // relative to app.js; esbuild preserves it under format:'esm'.
  const ctx = await esbuild.context({
    entryPoints: [join(src, 'app.ts')],
    outfile: join(dist, 'app.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'firefox90', 'safari15'],
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
  });
  await ctx.rebuild();

  // Copy pdf.js's worker next to app.js (the URL app.js resolves at runtime).
  copyFileSync(workerSrc, join(dist, 'pdf.worker.mjs'));

  // Copy the static shell.
  copyFileSync(join(src, 'styles.css'), join(dist, 'styles.css'));

  // Copy assets/ (icons).
  const assetsSrc = join(__dirname, 'assets');
  for (const f of readdirSync(assetsSrc)) copyFileSync(join(assetsSrc, f), join(dist, 'assets', f));

  // Stamp the base URL into index.html and write it.
  const html = readFileSync(join(src, 'index.html'), 'utf8').replace('</head>', `  <meta name="hanzo:base" content="${BASE}" />\n</head>`);
  writeFileSync(join(dist, 'index.html'), html);

  console.log(`Hanzo PDF workspace built -> dist/  (base ${BASE})`);
  console.log('   Serve dist/ over HTTPS; index.html is the entry.');

  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
