// Build the Notion integration into dist/: bundle the SPA (app.ts, browser) and
// the OAuth + proxy service (server.ts, node), copy the static HTML/CSS/assets.
//
//   node build.js                                             → production (base https://notion.hanzo.ai)
//   HANZO_NOTION_BASE=http://localhost:8788 node build.js     → local dev
//
// The Notion public integration's PUBLIC client_id + redirect are stamped into
// the SPA via esbuild `define` (the client_id is public; the SECRET is read from
// the environment by the running server, never bundled). One place, one source.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.HANZO_NOTION_BASE || 'https://notion.hanzo.ai').replace(/\/+$/, '');
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID || '';
const NOTION_REDIRECT_URI = process.env.NOTION_REDIRECT_URI || `${BASE}/oauth/callback`;
const watch = process.argv.includes('--watch');

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // The browser SPA — client_id/redirect stamped via define. Secrets are NOT
  // define-able here; server.ts reads NOTION_CLIENT_SECRET from process.env.
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
      NOTION_CLIENT_ID: JSON.stringify(NOTION_CLIENT_ID),
      NOTION_REDIRECT_URI: JSON.stringify(NOTION_REDIRECT_URI),
    },
    logLevel: 'info',
  });
  await spa.rebuild();

  // The OAuth + Notion-proxy service — a Node ESM bundle. No secrets baked in;
  // it reads NOTION_CLIENT_SECRET etc. from the environment when it runs.
  const server = await esbuild.context({
    entryPoints: [path.join(src, 'server.ts')],
    outfile: path.join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    banner: { js: '// Hanzo Notion OAuth + proxy service — run: node server.js' },
    logLevel: 'info',
  });
  await server.rebuild();

  // Static files.
  for (const f of ['index.html', 'styles.css']) {
    fs.copyFileSync(path.join(src, f), path.join(dist, f));
  }

  // assets/ (icons) — create the dir even if empty so index.html's <img> resolves.
  const assetsSrc = path.join(root, 'assets');
  const assetsDst = path.join(dist, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  if (fs.existsSync(assetsSrc)) {
    for (const f of fs.readdirSync(assetsSrc)) {
      fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDst, f));
    }
  }

  console.log(`✅ Notion integration built → dist/  (base ${BASE})`);
  console.log('   Serve dist/{index.html,app.js,styles.css,assets} as static; run dist/server.js for /oauth/* + /notion/* proxy.');
  if (!NOTION_CLIENT_ID) {
    console.log('   ⚠ NOTION_CLIENT_ID not set — set it (and NOTION_CLIENT_SECRET on the server) before deploy.');
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
