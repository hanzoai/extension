// Build the Office add-in into dist/: bundle the TS entry points, copy the
// static HTML + assets, and stamp the hosting base URL into a manifest.xml the
// user can sideload or submit to AppSource.
//
//   node src/build.js                     → production (HANZO_OFFICE_BASE=https://office.hanzo.ai)
//   HANZO_OFFICE_BASE=https://localhost:3000 node src/build.js   → dev sideload
//
// The base URL is where the task pane is HOSTED. Office add-ins load the pane
// from an HTTPS origin declared in the manifest; the same origin serves
// auth-callback.html (the IAM redirect target registered on the hanzo-office
// client). One string, stamped everywhere, so the manifest and the served
// files never disagree.

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const BASE = (process.env.HANZO_OFFICE_BASE || 'https://office.hanzo.ai').replace(/\/+$/, '');
const watch = process.argv.includes('--watch');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const entries = ['taskpane', 'commands'];

async function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // Bundle each entry to dist/<name>.js.
  const ctx = await esbuild.context({
    entryPoints: entries.map((e) => path.join(__dirname, `${e}.ts`)),
    outdir: dist,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome90', 'edge90', 'safari15'],
    sourcemap: true,
    minify: !watch,
    logLevel: 'info',
  });
  await ctx.rebuild();

  // Copy static HTML (taskpane, commands, auth-callback).
  for (const f of ['taskpane.html', 'commands.html', 'auth-callback.html']) {
    fs.copyFileSync(path.join(__dirname, f), path.join(dist, f));
  }

  // Copy the local-test kit (self-contained HTTPS server + Windows guide) so a
  // downloaded localhost build is runnable as-is.
  for (const f of ['serve.mjs', 'SIDELOAD-WINDOWS.md']) {
    fs.copyFileSync(path.join(root, f), path.join(dist, f));
  }

  // Copy assets/ (icons).
  const assetsSrc = path.join(root, 'assets');
  const assetsDst = path.join(dist, 'assets');
  fs.mkdirSync(assetsDst, { recursive: true });
  for (const f of fs.readdirSync(assetsSrc)) {
    fs.copyFileSync(path.join(assetsSrc, f), path.join(assetsDst, f));
  }

  // Stamp the base URL into the manifest and write it into dist/.
  const manifest = fs.readFileSync(path.join(root, 'manifest.xml'), 'utf8');
  const stamped = manifest.split('__HANZO_OFFICE_BASE__').join(BASE);
  if (stamped.includes('__HANZO_OFFICE_BASE__')) {
    throw new Error('manifest still has an unstamped __HANZO_OFFICE_BASE__ placeholder');
  }
  fs.writeFileSync(path.join(dist, 'manifest.xml'), stamped);

  console.log(`✅ Office add-in built → dist/  (base ${BASE})`);
  console.log('   Sideload dist/manifest.xml; serve dist/ at that base over HTTPS.');

  if (watch) {
    await ctx.watch();
    console.log('👀 watching…');
  } else {
    await ctx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
