// Build @hanzo/canvas-lms into dist/: bundle the web panel (app.ts) as ESM for the
// browser, copy index.html (with its entry script stamped) + styles.css, and bundle
// the OAuth + API-proxy server for Node. No framework — esbuild + Node stdlib only.
// @hanzo/ai is bundled into both outputs (it is the headless client the panel and
// server both call).
//
//   node build.js                                         → production build
//   node build.js --watch                                 → rebuild on change
//   HANZO_CANVAS_BASE=https://localhost:8443 node build.js → dev base (informational)
//
// Output layout:
//   dist/index.html   dist/app.js   dist/styles.css   (panel)
//   dist/server.js                                    (service)
//
// The panel is HOSTED over hanzoai/static behind hanzoai/ingress at canvas.hanzo.ai;
// the server runs as a small service (OAuth callback + API proxy). All model calls go
// to api.hanzo.ai regardless of the host base.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.HANZO_CANVAS_BASE || 'https://canvas.hanzo.ai').replace(/\/+$/, '');
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
    sourcemap: watch,
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

  // Bundle the server as a Node ESM binary — our pure stdlib code + @hanzo/ai.
  const serverCtx = await esbuild.context({
    entryPoints: [join(src, 'server.ts')],
    outfile: join(dist, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    sourcemap: watch,
    minify: !watch,
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    logLevel: 'info',
  });
  await serverCtx.rebuild();

  console.log(`Hanzo AI for Canvas built -> dist/  (base ${BASE})`);
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
