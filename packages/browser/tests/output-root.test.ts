import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * src/build.js has ONE output root: the extension repo root's dist/, one
 * directory per engine. It used to sit under packages/browser, and when it
 * moved, six consumers were left pointing at the old path — every one of them
 * failing silently:
 *
 *   scripts/check-bundle-budgets.mjs  measured a build four days stale
 *   .hanzo/workflows/ci.yml           ran that check under continue-on-error
 *   e2e/playwright.config.ts          loaded a stale extension
 *   e2e/fixtures.ts                   same
 *   e2e/cross-platform.config.ts      same
 *   .hanzo/workflows/publish.yml      packaged the stores from a missing dir
 *   tests/webextension-polyfill.test.ts  `return`ed when the path was absent
 *
 * Nothing said a word. This is the thing that says it.
 */

const REPO = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(REPO, 'dist');

describe('the build output root is the one every consumer names', () => {
  it('is written by src/build.js, one directory per engine', () => {
    // The build is a fixture (tests/built-dist.ts), not something this test
    // runs. It used to run it here, gated on the DIRECTORY existing, while
    // another suite ran the same build gated on a FILE — so this one saw the
    // directory appear under the other's build and asserted against a tree
    // still being written.
    for (const engine of ['chrome', 'firefox', 'safari']) {
      expect(fs.existsSync(path.join(DIST, engine, 'manifest.json')) ||
             fs.existsSync(path.join(DIST, engine, 'Info.plist')), engine).toBe(true);
    }
  });

  it('leaves no tracked file naming the abandoned root', () => {
    // Assembled, never spelled — otherwise this file is its own violation.
    const abandoned = ['dist', 'browser-extension'].join('/');
    let hits = '';
    try {
      hits = execFileSync('git', ['grep', '-l', abandoned], { cwd: REPO, encoding: 'utf8' }).trim();
    } catch {
      // git grep exits 1 when nothing matches — the passing case.
    }
    expect(hits).toBe('');
  });
});
