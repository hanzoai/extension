#!/usr/bin/env node
//
// A browser extension has a hard bundle budget, so growth is a build failure,
// not a review comment. Budgets are a ratchet: each ceiling sits just above the
// bundle's measured size, so new weight has to be argued for by raising the
// number here — deliberately, in a diff — instead of arriving unnoticed.
//
// The output root is the extension repo root's dist/ (src/build.js OUT), one
// directory per engine. Every engine is checked: a bundle can blow up on one
// of them alone.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const BROWSER = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.resolve(BROWSER, '..', '..', 'dist');
const ENGINES = ['chrome', 'firefox', 'safari'];

// KB ceilings keyed by bundle name. Raw bytes — what a store weighs and what
// the engine parses. Comments are the measurement these were re-ratcheted to.
//
// RE-RATCHETED at 1.9.49, because the numbers below had stopped measuring
// anything. The 1.9.39 ceilings were set against UNMINIFIED output: nine of the
// twelve esbuild calls in src/build.js did not minify, and three embedded a
// base64 sourcemap in the shipped file. Minifying all of them cut popup 415.8 ->
// 49.0 and content-script 391.8 -> 55.4, which left a 340KB ceiling sitting over
// a 55KB bundle — a gate that could not fail. A budget five times the artifact
// is not a lenient budget, it is an absent one.
//
// So each ceiling is back to just above its measured size, and the ratchet
// works again.
const BUDGETS = {
  // 262.9 — RAISED from 222 (217.7) for sovereign KMS vault autofill & egress
  // (shared/vault.ts + shared/kms.ts), LastPass vault/icon automation
  // (shared/lastpass.ts), WebMCP discovery, delta caps, detached jobs &
  // provenance boundaries (shared/webmcp.ts), and MAIN-world React input sync.
  'background.js': 266,
  'content-script.js': 62, // 57.0
  // 29.7 — RAISED from 29 (28.1) for closed Shadow-DOM `>>>` selector piercing
  // (`deepQuerySelector`), ShadowRoot/SVG hit-testing (`sameHitTarget`), and
  // password-masked MAIN-world input sync tokens.
  'page.js': 31,
  // 1079.6 — RAISED from 765 with newtab.js below, for the same reason: both
  // draw the one composer of @hanzo/ui 8.29.40.
  'sidebar.js': 1085,
  'popup.js': 65, // 59.2
  // 1084.3 — RAISED from 760 at 1.9.71: the new tab draws the one composer
  // every Hanzo surface draws (@hanzo/ui 8.27.0 -> 8.29.40, its `mind`, `mode`
  // and `chips`). By esbuild metafile against 756.7: @hanzo/ui +69.5KB (the
  // composer, its Tune, the lazy ModelPicker), and what `@hanzo/ui/chat`
  // reaches through @hanzo/gui whatever the page draws — @hanzogui/sheet
  // +30.2, create-menu +26.3, select +19.2, toast +14.0, floating +11.6,
  // slider +9.5, dialog +7.8, context-menu +7.5, menu +7.2 — plus
  // react-native-web +11.2, lucide +13.7, @hanzo/design +13.7 (via
  // @hanzo/appearance) and @hanzo/i18n +10.6. Importing only Thread from
  // `@hanzo/ui/chat` already pulls the gui half, so the lever is that
  // package's barrel, not this page.
  'newtab.js': 1090,
  // 65.3 — @hanzo/ui's theme.css (design's tokens for both themes and the
  // composer's paint) and the page's own rules, bundled by newtab.ts. It was
  // 366.8 while the page imported the `@hanzo/ui` root, whose root.js imports
  // the 355KB styles.css; the page imports `@hanzo/ui/primitives` instead, and
  // this ceiling is what keeps that sheet from coming back unnoticed.
  'newtab.css': 70,
  'onboarding.js': 35, // 31.0
};

const kb = (bytes) => (bytes / 1024).toFixed(1);

if (!fs.existsSync(path.join(DIST, 'chrome'))) {
  console.log('No build found; building once...');
  execFileSync('node', ['src/build.js'], { cwd: BROWSER, stdio: 'inherit' });
}

let over = 0;
let stale = 0;

for (const engine of ENGINES) {
  const dir = path.join(DIST, engine);
  if (!fs.existsSync(dir)) continue;
  for (const [name, limitKb] of Object.entries(BUDGETS)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const raw = fs.statSync(file).size;
    const gzip = zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
    const ok = raw <= limitKb * 1024;
    if (!ok) over++;
    console.log(
      `${ok ? 'OK  ' : 'OVER'} ${engine}/${name} ${kb(raw)}KB / ${limitKb}.0KB  (${kb(gzip)}KB gzip)`,
    );
  }
}

// A budget naming a bundle no engine produces is a budget measuring nothing —
// the silent pass this script shipped with once its output root moved.
for (const name of Object.keys(BUDGETS)) {
  if (!ENGINES.some((e) => fs.existsSync(path.join(DIST, e, name)))) {
    console.error(`STALE budget: no engine produces ${name}`);
    stale++;
  }
}

if (over || stale) {
  console.error(`\n${over} bundle(s) over budget, ${stale} stale budget(s).`);
  process.exit(1);
}
console.log('\nEvery bundle within budget.');
