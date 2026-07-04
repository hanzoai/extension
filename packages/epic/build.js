// Build the Epic SMART-on-FHIR app into dist/: bundle the SPA (app.ts, browser)
// and the OAuth + FHIR-proxy service (server.ts, node), copy the static
// HTML/CSS/assets.
//
//   node build.js                                   → production (base https://epic.hanzo.ai)
//   HANZO_EPIC_BASE=http://localhost:8791 node build.js   → local dev
//
// The SMART app's PUBLIC client_id + redirect + a default FHIR base (for
// standalone launch) are stamped into the SPA via esbuild `define`. The
// client_id is public; the SECRET (confidential apps) is read from the
// environment by the running server, NEVER bundled — a bundled secret would ship
// to every browser.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.HANZO_EPIC_BASE || 'https://epic.hanzo.ai').replace(/\/+$/, '');
const SMART_CLIENT_ID = process.env.SMART_CLIENT_ID || '';
const SMART_REDIRECT_URI = process.env.SMART_REDIRECT_URI || `${BASE}/oauth/callback`;
// Optional default FHIR base for STANDALONE launch (e.g. Epic's public sandbox).
// In an EHR launch the real `iss` arrives in the URL and overrides this.
const SMART_DEFAULT_ISS = process.env.SMART_DEFAULT_ISS || '';
const watch = process.argv.includes('--watch');

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // The browser SPA — public client_id/redirect/default-iss stamped via define.
  // Secrets are NOT define-able here; server.ts reads them from process.env.
  const spa = await esbuild.context({
    entryPoints: [path.join(src, 'app.ts')],
    outfile: path.join(dist, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'safari14', 'firefox90'],
    sourcemap: true,
    minify: !watch,
    define: {
      SMART_CLIENT_ID: JSON.stringify(SMART_CLIENT_ID),
      SMART_REDIRECT_URI: JSON.stringify(SMART_REDIRECT_URI),
      SMART_DEFAULT_ISS: JSON.stringify(SMART_DEFAULT_ISS),
    },
    logLevel: 'info',
  });
  await spa.rebuild();

  // The OAuth + FHIR-proxy service — a Node ESM bundle. No secrets baked in; it
  // reads SMART_CLIENT_SECRET etc. from the environment when it runs.
  const server = await esbuild.context({
    entryPoints: [path.join(src, 'server.ts')],
    outfile: path.join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    banner: { js: '// Hanzo Epic SMART-on-FHIR service — run: node server.js' },
    logLevel: 'info',
  });
  await server.rebuild();

  // Static files.
  for (const f of ['index.html', 'styles.css']) {
    fs.copyFileSync(path.join(src, f), path.join(dist, f));
  }

  // assets/ (icons) — create the dir even if empty.
  const assetsSrc = path.join(root, 'assets');
  const assetsDst = path.join(dist, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  if (fs.existsSync(assetsSrc)) {
    for (const f of fs.readdirSync(assetsSrc)) {
      fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDst, f));
    }
  }

  console.log(`✅ Epic SMART-on-FHIR app built → dist/  (base ${BASE})`);
  console.log('   Serve dist/{index.html,app.js,styles.css,assets} as static; run dist/server.js for /oauth/* + /fhir.');
  if (!SMART_CLIENT_ID) {
    console.log('   ⚠ SMART_CLIENT_ID not set — set it (and SMART_CLIENT_SECRET on the server for a confidential app) before deploy.');
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
