import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Build the extension ONCE, before any test file runs.
 *
 * Two suites assert against `dist/<engine>/` and each used to run `src/build.js`
 * itself, guarded by a different sentinel — output-root.test.ts checked for the
 * DIRECTORY, webextension-polyfill.test.ts checked for a FILE inside it. Vitest
 * runs files in parallel, and the directory appears the moment the slower
 * suite's build starts, so the faster one saw `dist/chrome/` already there,
 * skipped its own build, and asserted against a tree that was still being
 * written. It failed on `chrome: expected false to be true` in 12ms — too fast
 * to have built anything, which is the tell.
 *
 * That is a race between two copies of one step, so the fix is to stop having
 * two: the build is a fixture the suite needs, not something a test conjures.
 * Here it happens once, before parallelism starts, and the assertions become
 * assertions again.
 */
const BROWSER = path.resolve(__dirname, '..');
const DIST = path.resolve(BROWSER, '..', '..', 'dist');

/** Every artifact a suite reads. Present ⇒ a real build has completed. */
const artifacts = [
  path.join(DIST, 'chrome', 'manifest.json'),
  path.join(DIST, 'firefox', 'manifest.json'),
  path.join(DIST, 'chrome', 'background.js'),
];

export function setup() {
  // A half-written tree is NOT a build. Requiring every artifact means an
  // interrupted run rebuilds rather than being mistaken for a finished one —
  // the same confusion between "started" and "done" that caused the race.
  if (artifacts.every((f) => fs.existsSync(f))) return;
  execFileSync('node', ['src/build.js'], { cwd: BROWSER, stdio: 'inherit' });
  const missing = artifacts.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    throw new Error(
      `src/build.js exited 0 but did not write:\n  ${missing.join('\n  ')}\n` +
        'A suite that asserts about the bundle must have the bundle.',
    );
  }
}
