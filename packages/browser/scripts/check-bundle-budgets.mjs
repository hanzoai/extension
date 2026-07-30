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
// the engine parses. Comments are the measurement at 1.9.39.
const BUDGETS = {
  'background.js': 360, // 314.6
  'content-script.js': 340, // 303.9
  'sidebar.js': 400, // 361.5
  'popup.js': 280, // 240.0
  // 485.9 — the answer surface now renders through the REAL @hanzo/ui on
  // @hanzo/gui (the one substrate shared with web/desktop/mobile) instead of
  // raw DOM elements; the gui runtime is the +310KB (151.9KB gzip). Local
  // file, no network fetch — the cost is parse, paid for one component system
  // across every Hanzo surface.
  'newtab.js': 500,
  'onboarding.js': 40, // 12.8
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
