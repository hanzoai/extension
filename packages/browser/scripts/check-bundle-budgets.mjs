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
  'background.js': 200, // 180.5
  'content-script.js': 62, // 55.4
  'sidebar.js': 66, // 59.3
  'popup.js': 55, // 49.0
  // 549.2 — RAISED from 500, deliberately and with the reason, which is what
  // this file asks of anyone adding weight.
  //
  // The answer surface renders through the REAL @hanzo/ui on @hanzo/gui — the
  // one substrate shared with web/desktop/mobile — and the gui runtime is the
  // bulk of it. 485.9 at 1.9.39, 503.7 before the dependency sweep, 549.2 after
  // @hanzo/gui 7.3.0 -> 8.1.1 crossed a major.
  //
  // The weight is REAL and was measured rather than assumed: react-dom 177KB,
  // @hanzogui/themes 82KB, @hanzogui/web 80KB, react-native-web 49KB. The
  // obvious lever — 240 of the 390 themes are chromatic and this page renders
  // none of them — does NOT work: @hanzogui/themes v5 is already a compressed
  // encoding (one shared colour table plus index pairs expanded by a five-line
  // function), so re-emitting a 150-theme subset as literals is LARGER than the
  // 82KB it would replace. @hanzo/ui 8.0.64 exports a `monochrome` config that
  // filters at runtime; it is correct, and it saves nothing here, because both
  // configs still import the full table. A build-time subset would have to
  // re-encode in the same compact form.
  'newtab.js': 570,
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
