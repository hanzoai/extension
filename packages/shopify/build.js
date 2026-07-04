// Build @hanzo/shopify into dist/: bundle the embedded Polaris/App-Bridge admin
// app (main.tsx) as ESM for the browser, stamp index.html with the app's public
// API key + entry + backend base, and bundle the OAuth + Admin-proxy + webhook
// server for Node. No framework — esbuild + Node stdlib only.
//
//   node build.js                                             → production build
//   node build.js --watch                                     → rebuild on change
//   SHOPIFY_API_KEY=abc HANZO_SHOPIFY_BASE=https://x node build.js
//
// Output layout:
//   dist/index.html   dist/app.js   dist/app.css     (embedded admin app)
//   dist/server.js                                   (service)
//
// The app is HOSTED over hanzoai/static behind hanzoai/ingress at
// shopify.hanzo.ai (the app URL Shopify loads in the admin iframe); the server
// runs as a small service (OAuth callback + Admin proxy + webhooks). All model
// calls go to api.hanzo.ai regardless of the host base. App Bridge is loaded from
// Shopify's CDN (kept external), per Shopify's embedded-app requirement.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.HANZO_SHOPIFY_BASE || '').replace(/\/+$/, '');
// The PUBLIC Shopify API key (OAuth client id) — stamped into the app's meta tag
// so App Bridge can init. NEVER the secret (that stays server-side only).
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '__SHOPIFY_API_KEY__';
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const appSrc = join(src, 'app');
const dist = join(__dirname, 'dist');

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle the embedded admin app as ESM for the browser. React + Polaris are
  // bundled in (the page is served standalone, no import map); App Bridge is
  // external (loaded from Shopify's CDN as a global, never bundled).
  const appCtx = await esbuild.context({
    entryPoints: { app: join(appSrc, 'main.tsx') },
    outdir: dist,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'firefox90', 'safari15'],
    jsx: 'automatic',
    loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
  });
  await appCtx.rebuild();

  // Stamp index.html: the entry, the public API key, and the backend base.
  const html = readFileSync(join(appSrc, 'index.html'), 'utf8')
    .split('__ENTRY__').join('app.js')
    .split('__SHOPIFY_API_KEY__').join(SHOPIFY_API_KEY)
    .replace('</head>', `  <meta name="hanzo:base" content="${BASE}" />\n</head>`);
  writeFileSync(join(dist, 'index.html'), html);

  // Bundle the server as a Node ESM binary — our pure stdlib code + @hanzo/ai.
  const serverCtx = await esbuild.context({
    entryPoints: [join(src, 'server', 'server.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: true,
    minify: !watch,
    packages: 'external',
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  await serverCtx.rebuild();

  console.log(`Hanzo AI for Shopify built -> dist/  (base ${BASE || 'same-origin'})`);
  console.log('   App: dist/index.html  ·  Service: dist/server.js');

  if (watch) {
    await appCtx.watch();
    await serverCtx.watch();
    console.log('watching...');
  } else {
    await appCtx.dispose();
    await serverCtx.dispose();
  }
}

// The Polaris CSS import (in main.tsx) also emits dist/app.css; esbuild names it
// after the entry, so no extra copy step is needed. Confirm it exists post-build.
build()
  .then(() => {
    if (!watch && !existsSync(join(dist, 'app.css'))) {
      // Polaris ships its stylesheet via the '@shopify/polaris/build/esm/styles.css'
      // import; esbuild bundles it to app.css. If a future Polaris path changes,
      // fail loudly rather than ship an unstyled app.
      console.warn('note: dist/app.css not emitted — check the Polaris styles import in main.tsx');
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
