// Build the Clio integration into dist/: bundle the SPA (app.ts, browser) and
// the token-exchange service (server.ts, node), copy the static HTML/CSS/assets.
//
//   node build.js                          → production (base https://clio.hanzo.ai)
//   HANZO_CLIO_BASE=http://localhost:8787 node build.js   → local dev
//
// The Clio Developer App's PUBLIC client_id + redirect + region are stamped into
// the SPA via esbuild `define` (the client_id is public; the SECRET is read from
// the environment by the running server, never bundled). One place, one source.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.HANZO_CLIO_BASE || 'https://clio.hanzo.ai').replace(/\/+$/, '');
const CLIO_CLIENT_ID = process.env.CLIO_CLIENT_ID || '';
const CLIO_REDIRECT_URI = process.env.CLIO_REDIRECT_URI || `${BASE}/oauth/callback`;
const CLIO_REGION = process.env.CLIO_REGION || 'us';
const watch = process.argv.includes('--watch');

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // The browser SPA — client_id/redirect/region stamped via define. Secrets are
  // NOT define-able here; server.ts reads them from process.env at runtime.
  const spa = await esbuild.context({
    entryPoints: [path.join(src, 'app.ts')],
    outfile: path.join(dist, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'safari15', 'firefox90'],
    sourcemap: true,
    minify: !watch,
    define: {
      CLIO_CLIENT_ID: JSON.stringify(CLIO_CLIENT_ID),
      CLIO_REDIRECT_URI: JSON.stringify(CLIO_REDIRECT_URI),
      CLIO_REGION: JSON.stringify(CLIO_REGION),
    },
    logLevel: 'info',
  });
  await spa.rebuild();

  // The token-exchange service — a Node ESM bundle. No secrets baked in; it
  // reads CLIO_CLIENT_SECRET etc. from the environment when it runs.
  const server = await esbuild.context({
    entryPoints: [path.join(src, 'server.ts')],
    outfile: path.join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    banner: { js: '// Hanzo Clio token-exchange service — run: node server.js' },
    logLevel: 'info',
  });
  await server.rebuild();

  // Static files.
  for (const f of ['index.html', 'styles.css']) {
    fs.copyFileSync(path.join(src, f), path.join(dist, f));
  }

  // assets/ (icons) — mirror office; create the dir even if empty.
  const assetsSrc = path.join(root, 'assets');
  const assetsDst = path.join(dist, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  if (fs.existsSync(assetsSrc)) {
    for (const f of fs.readdirSync(assetsSrc)) {
      fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDst, f));
    }
  }

  console.log(`✅ Clio integration built → dist/  (base ${BASE}, region ${CLIO_REGION})`);
  console.log('   Serve dist/{index.html,app.js,styles.css,assets} as static; run dist/server.js for /oauth/*.');
  if (!CLIO_CLIENT_ID) {
    console.log('   ⚠ CLIO_CLIENT_ID not set — set it (and CLIO_CLIENT_SECRET on the server) before deploy.');
  }

  if (watch) {
    await spa.watch();
    await server.watch();
    console.log('👀 watching…');
  } else {
    await spa.dispose();
    await server.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
