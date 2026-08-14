// Build @hanzo/canva into dist/: bundle the App UI Kit side-panel app
// (src/index.tsx) as ESM for the browser and stamp index.html with the entry. No
// framework — esbuild + Node stdlib only, mirroring @hanzo/shopify's build. The
// Canva CLI (`canva apps preview`) serves this dist/ (or points at its own dev
// server); either way the app is a static bundle Canva loads in the app iframe.
// Every model call goes to api.hanzo.ai via @hanzo/ai; the app holds no secret —
// the user pastes their own sk- key.
//
//   node build.js            → production build  (dist/index.html, dist/app.js, dist/app.css)
//   node build.js --watch    → rebuild on change

import esbuild from 'esbuild';
import { rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle the panel as ESM for the browser. React + App UI Kit are bundled in
  // (the page is served standalone, no import map); the App UI Kit stylesheet
  // import emits dist/app.css.
  const ctx = await esbuild.context({
    entryPoints: { app: join(src, 'index.tsx') },
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
  await ctx.rebuild();

  // Stamp index.html with the entry.
  const html = readFileSync(join(src, 'index.html'), 'utf8').split('__ENTRY__').join('app.js');
  writeFileSync(join(dist, 'index.html'), html);

  console.log('Hanzo AI for Canva built -> dist/  (App: dist/index.html)');

  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.dispose();
  }
}

build()
  .then(() => {
    if (!watch && !existsSync(join(dist, 'app.css'))) {
      // The App UI Kit ships its stylesheet via '@canva/app-ui-kit/styles.css'
      // (imported in index.tsx); esbuild bundles it to app.css. If a future path
      // changes, warn rather than ship an unstyled app.
      console.warn('note: dist/app.css not emitted — check the App UI Kit styles import in index.tsx');
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
