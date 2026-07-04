// Assemble the .sketchplugin bundle into dist/. A Sketch plugin is a macOS
// bundle laid out as:
//
//   Hanzo AI.sketchplugin/
//     Contents/
//       Sketch/
//         manifest.json          ← commands + menu
//         command.js             ← plugin entry (CommonJS, CocoaScript runtime)
//       Resources/
//         webview.html           ← the assistant panel
//         app.js                 ← the WebView bundle (browser, @hanzo/ai)
//         icon.png
//
//   node build.js            → production build
//   node build.js --watch    → rebuild on change
//
// Two esbuild passes because the two runtimes differ: command.js runs on
// Sketch's JavaScriptCore/CocoaScript (CommonJS, `require('sketch/*')` external),
// and the WebView bundle runs in a real WebView (browser, `fetch` available, so
// @hanzo/ai is bundled in).

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const bundle = path.join(dist, 'Hanzo AI.sketchplugin');
const sketchDir = path.join(bundle, 'Contents', 'Sketch');
const resDir = path.join(bundle, 'Contents', 'Resources');

// The `sketch` runtime modules are provided by the Sketch app — never bundled.
const SKETCH_EXTERNALS = [
  'sketch',
  'sketch/dom',
  'sketch/ui',
  'sketch/settings',
  'sketch-module-web-view',
];

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(sketchDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  // 1) The plugin entry — CommonJS for CocoaScript. sketch-bridge + design-core
  //    (its pure exports) are bundled in; the sketch/* runtime stays external.
  //    design-core imports @hanzo/ai, but command.js never calls runAction (the
  //    model call is in the WebView), so tree-shaking drops @hanzo/ai here.
  const commandCtx = await esbuild.context({
    entryPoints: [path.join(src, 'command.cjs')],
    outfile: path.join(sketchDir, 'command.js'),
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: ['es2017'],
    external: SKETCH_EXTERNALS,
    sourcemap: false,
    minify: !watch,
    logLevel: 'info',
  });
  await commandCtx.rebuild();

  // 2) The WebView bundle — browser IIFE, @hanzo/ai bundled in (it needs fetch,
  //    which the WebView has). design-core rides along.
  const webCtx = await esbuild.context({
    entryPoints: [path.join(src, 'webview', 'app.ts')],
    outfile: path.join(resDir, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['safari14'],
    sourcemap: false,
    minify: !watch,
    logLevel: 'info',
  });
  await webCtx.rebuild();

  // 3) Static: manifest → Sketch/, webview HTML + icon → Resources/.
  fs.copyFileSync(path.join(src, 'manifest.json'), path.join(sketchDir, 'manifest.json'));
  fs.copyFileSync(path.join(src, 'webview', 'index.html'), path.join(resDir, 'webview.html'));

  const icon = path.join(root, 'assets', 'icon.png');
  if (fs.existsSync(icon)) {
    fs.copyFileSync(icon, path.join(resDir, 'icon.png'));
  } else {
    console.log('   ⚠ assets/icon.png missing — bundle builds, but add an icon before publishing.');
  }

  console.log(`✅ Built ${path.relative(root, bundle)}`);
  console.log('   Install: double-click the .sketchplugin, or copy it into');
  console.log('   ~/Library/Application Support/com.bohemiancoding.sketch3/Plugins/');

  if (watch) {
    await commandCtx.watch();
    await webCtx.watch();
    console.log('👀 watching…');
  } else {
    await commandCtx.dispose();
    await webCtx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
