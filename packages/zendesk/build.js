// Build the Zendesk app into dist/ as a ZAF v2 app bundle that `zcli` can
// validate / package / upload:
//
//   dist/
//   ├── manifest.json            (app root — location url is assets/iframe.html)
//   ├── translations/en.json
//   └── assets/
//       ├── iframe.html          (the ticket_sidebar page; built from src/panel.html)
//       ├── panel.js             (bundled from src/panel.ts, ESM)
//       ├── styles.css
//       ├── logo.png             (128px Marketplace icon)
//       └── logo-small.png       (in-app icon)
//
//   node build.js            → production bundle
//   node build.js --watch    → rebuild on change
//
// @hanzo/ai is bundled in (it's a browser-safe headless client over fetch); the
// ZAF SDK is NOT bundled — Zendesk hosts it and iframe.html loads it from the
// CDN. No framework — esbuild + Node stdlib only.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');
const assets = join(dist, 'assets');

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });
  mkdirSync(join(dist, 'translations'), { recursive: true });

  // Bundle panel.ts → assets/panel.js (ESM, browser). @hanzo/ai is bundled.
  const ctx = await esbuild.context({
    entryPoints: [join(src, 'panel.ts')],
    outfile: join(assets, 'panel.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'firefox90', 'safari15'],
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
  });
  await ctx.rebuild();

  // The ticket_sidebar page. src/panel.html → assets/iframe.html (the manifest
  // location url). Its <script src="panel.js"> and styles.css sit beside it.
  copyFileSync(join(src, 'panel.html'), join(assets, 'iframe.html'));
  copyFileSync(join(src, 'styles.css'), join(assets, 'styles.css'));

  // App icons. logo.png is the Marketplace icon; logo-small.png is used in-panel.
  copyFileSync(join(__dirname, 'assets', 'logo.png'), join(assets, 'logo.png'));
  copyFileSync(join(__dirname, 'assets', 'logo-small.png'), join(assets, 'logo-small.png'));

  // Manifest + translations at the bundle root, verbatim (they are the source of
  // truth; build only relocates them next to assets/).
  copyManifest();
  copyFileSync(join(__dirname, 'translations', 'en.json'), join(dist, 'translations', 'en.json'));

  console.log('Hanzo AI Zendesk app built -> dist/  (zcli apps:validate dist)');

  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.dispose();
  }
}

// Copy manifest.json, asserting it is valid JSON with the location zcli expects.
// A broken manifest is caught here rather than at upload time.
function copyManifest() {
  const raw = readFileSync(join(__dirname, 'manifest.json'), 'utf8');
  const m = JSON.parse(raw); // throws on malformed JSON
  const url = m?.location?.support?.ticket_sidebar?.url;
  if (url !== 'assets/iframe.html') {
    throw new Error(`manifest location url must be "assets/iframe.html", got ${JSON.stringify(url)}`);
  }
  writeFileSync(join(dist, 'manifest.json'), raw);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
