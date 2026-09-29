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
  'background.js': 200, // 176.5
  'content-script.js': 62, // 55.4
  // 26.7 — the snapshot → ref engine (shared/snapshot.ts + shared/read.ts):
  // role/name computation, flat-tree walk, covered-click hit test, key default
  // actions, DOM → markdown. Injected on first use per document, not per page load.
  'page.js': 28,
  // 761.6 — the ceiling is 765, not the 780 it was first raised to. A second
  // copy of @hanzo/event weighs 17.8KB (see newtab.js), and 780 had room for it.
  //
  // 761.5 — RAISED from 760. The page did not change; its dependencies did.
  // Against the 739.9 build, by esbuild metafile: @hanzo/ui 8.1.2 -> 8.27.0
  // +17.2KB (dist/tw.js, imported by its sx, box and css modules), @hanzo/event
  // +3.5KB and the @hanzo/events names it now pulls in +2.9KB, @hanzogui/web
  // +0.9KB, @hanzogui/telemetry -3.9KB.
  //
  // 739.9 — RAISED from 66, which is the largest single jump this file has ever
  // taken, so here is what bought it.
  //
  // Chat in the sidebar was hand-written: its own composer markup in
  // sidebar.html, its own five-regex markdown, its own scroll-to-bottom, its own
  // typing dots — about 40KB of surface that had already drifted from the new
  // tab's (that markdown turned every newline into a <br> and never made a
  // list). It is now @hanzo/ui/chat, the same shell, so the gui runtime arrives
  // on a page that had none of it.
  //
  // What arrives is the RUNTIME, not the components. Measured by esbuild
  // metafile: react-dom 177KB + @hanzogui/themes 82KB + @hanzogui/web 80KB +
  // react-native-web 73KB + react-native-svg 28KB, against @hanzo/ui's own
  // 22KB. Tree-shaking is working; a component system costs what it costs, and
  // the newtab note below records why the themes table cannot be trimmed.
  //
  // Nothing is shared between the two: they are separate documents loading
  // separate bundles, so each pays the runtime once. The cost is parse, from a
  // local file, on a panel the user opened deliberately.
  'sidebar.js': 765,
  'popup.js': 55, // 48.5
  // 755.4 — RAISED from 740. Against the 716.3 build, by esbuild metafile:
  // @hanzo/ui 8.1.2 -> 8.27.0 +17.6KB (dist/tw.js), @hanzo/ai 0.3.1 -> 0.6.7
  // +11.2KB, the answer mark from @hanzo/logo +6.2KB, @hanzo/event and the
  // @hanzo/events names +6.4KB, @hanzogui/web +0.9KB, @hanzogui/telemetry
  // -3.9KB.
  //
  // It measured 773.2 until @hanzo/event moved to 0.3.41. The page imported
  // 0.3.37 itself while @hanzogui/telemetry asked for ^0.3.40, and both copies
  // shipped. One version is one copy. The ceiling is 760, not the 775 it was
  // first raised to, because 775 passed the 773.2 build: a second copy has to
  // fail here.
  //
  // 716.3 — RAISED from 570. The +167 is @hanzo/ui/chat plus the shared model
  // picker, which is a Popover + Command combobox (gui floating 14KB, popover
  // 12KB, Command) where this surface used to draw a plain filtered div menu.
  // The local composer, model menu and citation chip are deleted, so the trade
  // is one picker's machinery for three hand-rolled components.
  //
  // The gui runtime below is the rest, and was already here.
  //
  // 549.2 was itself RAISED from 500, deliberately and with the reason, which is
  // what this file asks of anyone adding weight.
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
  'newtab.js': 760,
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
