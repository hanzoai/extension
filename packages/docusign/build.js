// Build @hanzo/docusign into dist/: bundle the web panel (app.ts) as ESM for the
// browser, copy index.html (with its entry script stamped) + styles.css, emit
// the pdf.js worker the panel needs, and bundle the OAuth + Connect webhook
// server for Node. No framework — esbuild + Node stdlib only.
//
//   node build.js                                     → production build
//   node build.js --watch                             → rebuild on change
//   HANZO_DOCUSIGN_BASE=https://localhost:8443 node build.js  → dev base (informational)
//
// Output layout:
//   dist/index.html   dist/app.js   dist/styles.css   dist/pdf.worker.mjs   (panel)
//   dist/server.js                                                          (service)
//
// The panel is HOSTED over hanzoai/static behind hanzoai/ingress at
// docusign.hanzo.ai; the server runs as a small service (OAuth callback +
// Connect webhook). All model calls go to api.hanzo.ai regardless of the host
// base.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BASE = (process.env.HANZO_DOCUSIGN_BASE || 'https://docusign.hanzo.ai').replace(/\/+$/, '');
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle the panel as ESM for the browser.
  const panelCtx = await esbuild.context({
    entryPoints: { app: join(src, 'app.ts') },
    outdir: dist,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'firefox90', 'safari15'],
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
  });
  await panelCtx.rebuild();

  // Copy index.html (stamp __ENTRY__ + base) and styles.css.
  const html = readFileSync(join(src, 'index.html'), 'utf8')
    .split('__ENTRY__').join('app.js')
    .replace('</head>', `  <meta name="hanzo:base" content="${BASE}" />\n</head>`);
  writeFileSync(join(dist, 'index.html'), html);
  copyFileSync(join(src, 'styles.css'), join(dist, 'styles.css'));

  // Emit the pdf.js worker the panel loads (pdf-text points import.meta.url at
  // ./pdf.worker.mjs when it configures the worker in-browser).
  const worker = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
  copyFileSync(worker, join(dist, 'pdf.worker.mjs'));

  // Bundle the server as a Node ESM binary. pdfjs-dist is left external so the
  // server loads the installed package at runtime (it is large and pulls native
  // paths esbuild should not inline); everything else is our pure stdlib code.
  const serverCtx = await esbuild.context({
    entryPoints: [join(src, 'server.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    external: ['pdfjs-dist'],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  await serverCtx.rebuild();

  console.log(`Hanzo AI for DocuSign built -> dist/  (base ${BASE})`);
  console.log('   Panel: dist/index.html  ·  Service: dist/server.js');

  if (watch) {
    await panelCtx.watch();
    await serverCtx.watch();
    console.log('watching...');
  } else {
    await panelCtx.dispose();
    await serverCtx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
