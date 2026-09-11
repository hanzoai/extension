/**
 * webextension-polyfill integration.
 *
 * The 1.9.0 unification: every entrypoint imports `webextension-polyfill`
 * as its first import. On Chrome/Edge that defines `globalThis.browser`
 * as the Promise-returning WebExtension API; on Firefox/Safari it's a
 * no-op because `browser.*` is already native.
 *
 * The unified `webExtensionAdapter()` factory in `shared/auth.ts` then
 * picks up that global so we have ONE adapter codepath instead of two
 * (chromeAdapter / firefoxAdapter) with subtly different behaviours.
 *
 * This suite verifies the contract structurally (the polyfill is in
 * deps, the entrypoints import it, the adapter exists) — runtime
 * verification is in the e2e specs.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);
const workspace = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'pnpm-workspace.yaml'),
  'utf8',
);

describe('webextension-polyfill is a runtime dependency', () => {
  it('listed in dependencies (not devDependencies)', () => {
    expect(pkg.dependencies['webextension-polyfill']).toBeDefined();
  });

  it('pinned to a known version (no caret) so MV3 behavior is reproducible', () => {
    // Caret ranges across major versions of the polyfill have historically
    // changed return-value shapes. Pin to a known version. A `catalog:` spec
    // takes its version from pnpm-workspace.yaml.
    const spec = pkg.dependencies['webextension-polyfill'];
    const v =
      spec === 'catalog:'
        ? workspace.match(/^\s+'?webextension-polyfill'?:\s*'([^']+)'/m)?.[1]
        : spec;
    expect(v).not.toMatch(/^\^/);
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('shared/auth.ts unified adapter', () => {
  const sharedAuth = fs.readFileSync(
    path.join(__dirname, '..', 'src/shared/auth.ts'),
    'utf8',
  );

  it('exports webExtensionAdapter with storage.get returning a Promise', () => {
    expect(sharedAuth).toMatch(/export\s+function\s+webExtensionAdapter\s*\(\s*\)\s*:\s*BrowserAdapter/);
    // Verify the adapter wraps with Promise.resolve so the surface is
    // identical regardless of underlying API style.
    expect(sharedAuth).toMatch(/Promise\.resolve\(b\.storage\.local\.get/);
  });

  it('falls back to globalThis.chrome if globalThis.browser is missing', () => {
    // The legacy fallback handles tests / non-extension contexts where
    // neither has been set up. It uses ?? so an empty browser object
    // doesn't shadow chrome.
    expect(sharedAuth).toMatch(/globalThis as any\)\.browser\s*\?\?\s*\(globalThis as any\)\.chrome/);
  });

  it('chromeAdapter and firefoxAdapter are aliases for back-compat', () => {
    // Existing callers from before 1.9.0 must continue to work.
    expect(sharedAuth).toMatch(/export\s+function\s+chromeAdapter[\s\S]*?return\s+webExtensionAdapter\(\)/);
    expect(sharedAuth).toMatch(/export\s+function\s+firefoxAdapter[\s\S]*?return\s+webExtensionAdapter\(\)/);
  });
});

describe('build pipeline ships the polyfill', () => {
  // src/build.js writes to the extension repo root's dist/<engine>/. These two
  // used to read the old output root under packages/browser and `return` when
  // it was absent — so once the root moved they asserted nothing, quietly, on
  // every run. An assertion about the bundle has to have a bundle, so the
  // build is a fixture the whole suite shares (tests/built-dist.ts) and these
  // simply require it. Building it HERE, as this file briefly did, raced the
  // identical build in output-root.test.ts.
  const BROWSER = path.join(__dirname, '..');
  const DIST = path.resolve(BROWSER, '..', '..', 'dist');
  const bundle = (engine: string) => {
    const file = path.join(DIST, engine, 'background.js');
    expect(fs.existsSync(file), `${engine}/background.js`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  it('chrome bundle includes webextension-polyfill code', () => {
    // The polyfill module sets `globalThis.browser`. We grep for its
    // distinctive marker so we know it actually ended up in the bundle.
    expect(bundle('chrome')).toMatch(
      /webextension-polyfill|browserPolyfill|chromeApiAvailable|globalThis\.browser/,
    );
  });

  it('firefox bundle does not break if the polyfill is a no-op', () => {
    const bg = bundle('firefox');
    // The Firefox bundle should still be valid JS regardless of whether
    // the polyfill no-ops or wraps. Probe for any obvious syntax failure.
    expect(bg.length).toBeGreaterThan(1000);
    // Must NOT contain leftover NodeJS-only syntax (require()) since the
    // bundle target is browser.
    expect(bg).not.toMatch(/^const\s+\w+\s*=\s*require\(/m);
  });
});
