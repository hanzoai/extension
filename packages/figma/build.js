// Build the Figma plugin into dist/. A Figma plugin is exactly three files:
//
//   dist/code.js     — the MAIN thread bundle (figma.* only, no DOM/network).
//                      Bundled as an IIFE: Figma's main-thread sandbox is a
//                      single non-module script, so all imports (@hanzo/ai lives
//                      only in the UI bundle) must be inlined and there can be no
//                      top-level `import`/`export`.
//   dist/ui.html     — the iframe UI: ui.ts (bundled, WITH @hanzo/ai) inlined
//                      into ui.html, plus ui.css inlined. Figma loads ONE html
//                      file for the UI and sandboxes it, so nothing external may
//                      be referenced — everything is inlined.
//   dist/manifest.json — points at code.js + ui.html, copied verbatim.
//
//   node build.js          → production (minified)
//   node build.js --watch   → rebuild on change
//
// No framework — esbuild + Node stdlib only.

import esbuild from 'esbuild';
import { rmSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const src = join(__dirname, 'src');
const dist = join(__dirname, 'dist');

const shared = {
  bundle: true,
  target: ['chrome90', 'firefox90', 'safari15'],
  logLevel: 'info',
  minify: !watch,
};

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Main thread: IIFE so the output is a plain script with no imports/exports.
  const codeCtx = await esbuild.context({
    ...shared,
    entryPoints: [join(src, 'code.ts')],
    outfile: join(dist, 'code.js'),
    format: 'iife',
    platform: 'browser',
  });

  // UI: bundle to an in-memory string (IIFE), then inline into ui.html with the
  // CSS. `write:false` returns the bytes so we can splice them into the shell.
  async function buildUi() {
    const result = await esbuild.build({
      ...shared,
      entryPoints: [join(src, 'ui.ts')],
      format: 'iife',
      platform: 'browser',
      write: false,
    });
    const js = result.outputFiles[0].text;
    const css = readFileSync(join(src, 'ui.css'), 'utf8');
    // replaceAll (function replacer, so `$` in the bundle is not treated as a
    // replacement pattern) — robust even if a token appears more than once.
    const html = readFileSync(join(src, 'ui.html'), 'utf8')
      .replaceAll('__HANZO_UI_CSS__', () => css)
      .replaceAll('__HANZO_UI_JS__', () => js);
    writeFileSync(join(dist, 'ui.html'), html);
  }

  await codeCtx.rebuild();
  await buildUi();
  copyFileSync(join(__dirname, 'manifest.json'), join(dist, 'manifest.json'));

  console.log('Hanzo AI for Figma built -> dist/ (code.js + ui.html + manifest.json)');
  console.log('   Import dist/manifest.json in Figma: Plugins → Development → Import plugin from manifest.');

  if (watch) {
    await codeCtx.watch();
    // Rebuild the UI on any src change too (esbuild's watch only tracks code.ts).
    const { watch: fsWatch } = await import('node:fs');
    fsWatch(src, { recursive: true }, (_e, file) => {
      if (file && /ui\.(ts|css|html)$/.test(file)) buildUi().catch(console.error);
    });
    console.log('watching...');
  } else {
    await codeCtx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
