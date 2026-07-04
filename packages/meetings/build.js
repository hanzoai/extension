// Build @hanzo/meetings into dist/: bundle the two web panels (Zoom + Meet) as
// ESM, bundle the Zoom install/webhook server for Node, copy the shared panel
// HTML once per surface (with its entry script stamped), and copy assets.
//
//   node build.js                                             → production
//   HANZO_MEET_GCP_PROJECT=123456789012 node build.js         → stamp the Meet GCP project number
//   HANZO_MEETINGS_BASE=https://localhost:8443 node build.js  → local dev base (informational)
//   node build.js --watch                                     → rebuild on change
//
// Output layout:
//   dist/zoom/index.html      dist/zoom/zoom.js       (Zoom App panel)
//   dist/meet/index.html      dist/meet/meet.js       (Meet add-on panel)
//   dist/zoom/assets/…        dist/meet/assets/…      (icons, per surface)
//   dist/server.js                                    (Zoom OAuth + webhook service)
//
// The two panels are HOSTED over hanzoai/static behind hanzoai/ingress (e.g.
// meetings.hanzo.ai/zoom, meetings.hanzo.ai/meet); the server runs as a small
// service. All model calls go to api.hanzo.ai regardless of the host base. No
// framework — esbuild + Node stdlib only.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.HANZO_MEETINGS_BASE || 'https://meetings.hanzo.ai').replace(/\/+$/, '');
// The Meet add-on needs the add-on's Google Cloud project number at build time.
// Stamped as a define; empty in a plain build (the panel still runs with a
// pasted key outside Meet, and a real deploy sets this).
const MEET_GCP_PROJECT = process.env.HANZO_MEET_GCP_PROJECT || '';
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');
const assetsSrc = join(__dirname, 'assets');

// The two panel surfaces: entry TS + output subdir. Each gets a copy of the
// shared panel.html with __ENTRY__ pointing at its bundle.
const PANELS = [
  { name: 'zoom', entry: join(src, 'zoom', 'main.ts'), out: 'zoom' },
  { name: 'meet', entry: join(src, 'meet', 'main.ts'), out: 'meet' },
];

function copyAssets(dir) {
  const dst = join(dir, 'assets');
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(assetsSrc)) copyFileSync(join(assetsSrc, f), join(dst, f));
}

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle each panel as ESM into dist/<out>/<out>.js.
  const panelCtx = await esbuild.context({
    entryPoints: Object.fromEntries(PANELS.map((p) => [`${p.out}/${p.out}`, p.entry])),
    outdir: dist,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'firefox90', 'safari15'],
    sourcemap: true,
    minify: !watch,
    define: { HANZO_MEET_GCP_PROJECT: JSON.stringify(MEET_GCP_PROJECT) },
    logLevel: 'info',
  });
  await panelCtx.rebuild();

  // Copy the shared panel.html per surface, stamping __ENTRY__ and the base.
  const panelHtml = readFileSync(join(src, 'panel', 'panel.html'), 'utf8');
  for (const p of PANELS) {
    const outDir = join(dist, p.out);
    mkdirSync(outDir, { recursive: true });
    const html = panelHtml
      .split('__ENTRY__').join(`${p.out}.js`)
      .replace('</head>', `  <meta name="hanzo:base" content="${BASE}" />\n</head>`);
    writeFileSync(join(outDir, 'index.html'), html);
    copyAssets(outDir);
  }

  // Bundle the Zoom server as a Node ESM binary. External nothing — it uses only
  // Node stdlib + our pure modules, so a single file drops into a container.
  const serverCtx = await esbuild.context({
    entryPoints: [join(src, 'zoom', 'server.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  await serverCtx.rebuild();

  console.log(`Hanzo Meetings built -> dist/  (base ${BASE}${MEET_GCP_PROJECT ? `, meet gcp ${MEET_GCP_PROJECT}` : ''})`);
  console.log('   Panels: dist/zoom/index.html, dist/meet/index.html  ·  Server: dist/server.js');

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
