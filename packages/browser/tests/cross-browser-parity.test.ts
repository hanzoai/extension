/**
 * Cross-browser parity contracts.
 *
 * These tests assert that the things which were broken in 1.8.x stay
 * fixed in 1.9.0 and beyond. They probe BOTH the Chrome (background.ts +
 * browser-dispatch.ts) and Firefox (background-firefox.ts) source files
 * for the structural patterns that distinguish a working build from a
 * regressed one.
 *
 * Note: the WebSocket CDP bridge (cdp-bridge.ts / cdp-bridge-server.ts)
 * was deleted in the native-ZAP migration. The chrome.debugger actuation
 * it used to own (Runtime.evaluate / awaitPromise / parseTabId) now lives
 * in browser-dispatch.ts, so those contracts probe that file.
 *
 * Why string-search instead of behavior tests? The actual page execution
 * path requires a real browser. These contracts run as `vitest run` in
 * CI without a browser, so they're a fast lint-class signal that no
 * future PR silently re-introduces the bug.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function read(p: string): string {
  return fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
}

const chromeBg = read('src/background.ts');
const firefoxBg = read('src/background-firefox.ts');
const browserDispatch = read('src/browser-dispatch.ts');
const browserControl = read('src/browser-control.ts');
const popupTs = read('src/popup.ts');
const contentScript = read('src/content-script.ts');
const sharedAuth = read('src/shared/auth.ts');
const sharedConfig = read('src/shared/config.ts');
const manifestChrome = read('src/manifest.json');
const manifestFirefox = read('src/manifest-firefox.json');

describe('IAM URL conventions', () => {
  it('IAM_API_PATH is /v1/iam (NOT /api/, NOT bare /oauth)', () => {
    expect(sharedConfig).toContain("IAM_API_PATH = '/v1/iam'");
  });

  it('shared auth uses the canonical HIP-0111 token endpoint /v1/iam/oauth/token', () => {
    // HIP-0111: token exchange hits `${iamApiUrl}${IAM_API_PATH}/oauth/token`
    // (= /v1/iam/oauth/token). The pre-1.8.7 bare /oauth/token 404'd and the
    // legacy /login/oauth/access_token path is gone — forward-only.
    expect(sharedAuth).toContain('${IAM_API_PATH}/oauth/token');
    expect(sharedAuth).not.toContain('/login/oauth/access_token');
  });

  it('token exchange uses application/x-www-form-urlencoded (RFC 6749)', () => {
    // application/json was the bug pre-1.8.7. Verify the body shape at the
    // canonical token endpoint.
    const tokenBlock = sharedAuth.slice(
      sharedAuth.indexOf('${IAM_API_PATH}/oauth/token'),
      sharedAuth.indexOf('${IAM_API_PATH}/oauth/token') + 1500,
    );
    expect(tokenBlock).toContain('application/x-www-form-urlencoded');
    expect(tokenBlock).toContain('URLSearchParams');
  });

  it('Chrome background uses ${IAM_V1} for IAM URLs (no /api/ prefix)', () => {
    // Find the IAM_V1 declaration and assert it.
    expect(chromeBg).toContain('const IAM_V1 = `${IAM_API_URL}${IAM_API_PATH}`');
    // No raw /api/login or /api/get-account anywhere in chrome bg.
    expect(chromeBg).not.toMatch(/iam\.hanzo\.ai\/api\//);
  });

  it('Firefox background uses ${IAM_V1} for IAM URLs', () => {
    expect(firefoxBg).toContain('const IAM_V1 = `${IAM_API}${IAM_API_PATH}`');
    expect(firefoxBg).not.toMatch(/iam\.hanzo\.ai\/api\//);
  });
});

describe('parseTabId centralization', () => {
  it('browser-dispatch.ts imports parseTabId from shared/tab-id', () => {
    expect(browserDispatch).toMatch(/import\s+\{[^}]*parseTabId[^}]*\}\s+from\s+['"]\.\/shared\/tab-id\.js['"]/);
  });

  it('browser-dispatch.ts no longer defines its own parseTabId', () => {
    // The dispatcher imports the shared helper; it must not re-declare a
    // private copy (the duplicate that existed on the old bridge pre-1.9.0).
    expect(browserDispatch).not.toMatch(/private\s+parseTabId\s*\(/);
  });

  it('background-firefox.ts imports parseTabId from shared/tab-id', () => {
    expect(firefoxBg).toMatch(/import\s+\{[^}]*parseTabId[^}]*\}\s+from\s+['"]\.\/shared\/tab-id\.js['"]/);
  });

  it('background-firefox.ts no longer defines its own parseTabId', () => {
    expect(firefoxBg).not.toMatch(/private\s+parseTabId\s*\(/);
  });

  it('background-firefox.ts uses parseTabId in Target.closeTarget (not parseInt fallback)', () => {
    // The pre-1.9.0 code did `parseInt((params.targetId).replace('tab-',''),10)`.
    // That was lossy on non-numeric strings and missed the anchored regex
    // protection of parseTabId.
    expect(firefoxBg).not.toMatch(/parseInt\(\(params\.targetId\b/);
  });
});

describe('awaitPromise propagation', () => {
  it('browser-dispatch.ts Runtime.evaluate dispatch sets awaitPromise: true', () => {
    // The chrome.debugger actuator's Runtime.evaluate path — inherited from
    // the old bridge's handleBridgeMessage.
    const evalSection = browserDispatch.slice(
      browserDispatch.indexOf("case 'Runtime.evaluate':"),
      browserDispatch.indexOf("case 'Runtime.evaluate':") + 500,
    );
    expect(evalSection).toContain('awaitPromise: true');
  });

  it('browser-dispatch.ts evaluate() helper uses awaitPromise: true + unwrapEvaluateResult', () => {
    // The local `evaluate(tabId, expression)` method was the one missed
    // before 1.9.0 — it must await async IIFEs and normalise the result
    // the same way the message-dispatch path does.
    const helperSection = browserDispatch.slice(
      browserDispatch.indexOf('async evaluate(tabId: number'),
      browserDispatch.indexOf('async evaluate(tabId: number') + 600,
    );
    expect(helperSection).toContain('awaitPromise: true');
    expect(helperSection).toContain('unwrapEvaluateResult');
  });
});

describe('executeScript MV3 contract', () => {
  it('background-firefox.ts uses scripting.executeScript with world: MAIN', () => {
    // The Firefox path has used the MV3 scripting API since 1.8.6.
    expect(firefoxBg).toMatch(/scripting\.executeScript/);
    expect(firefoxBg).toMatch(/world:\s*['"]MAIN['"]/);
  });

  it('browser-control.ts uses scripting.executeScript with world: MAIN', () => {
    // The big regression in 1.8.x: browser-control still used `func: new Function(...)`
    // without the MAIN world hint, so async results were silently lost. 1.9.0
    // mirrors the Firefox pattern.
    expect(browserControl).toMatch(/scripting\.executeScript/);
    expect(browserControl).toMatch(/world:\s*['"]MAIN['"]/);
    expect(browserControl).toContain('Function(codeStr)()');
  });

  it('browser-control.ts handles the empty-{} promise drop', () => {
    // Detect the looksEmpty / Promise.resolve fallback pattern.
    expect(browserControl).toMatch(/Promise\.resolve\(/);
    expect(browserControl).toMatch(/__hanzo_error/);
  });

  it('shipping code does NOT call the removed MV2 tabs.executeScript directly', () => {
    // Allowed: reference inside the MV2 fallback branch (gated by `if`).
    // Forbidden: as the primary call path. Probe that any such reference
    // is wrapped behind a "legacy" / fallback comment.
    const usages = [
      ...chromeBg.matchAll(/\btabs\.executeScript\b/g),
      ...firefoxBg.matchAll(/\btabs\.executeScript\b/g),
      ...browserControl.matchAll(/\btabs\.executeScript\b/g),
    ];
    // Each remaining match must be in a fallback context (not the primary
    // path). Heuristic: surrounding 200 chars include the words 'fallback'
    // or 'legacy' or 'MV2'.
    for (const m of usages) {
      const idx = m.index!;
      const file = m.input!;
      const ctx = file.slice(Math.max(0, idx - 200), idx + 200);
      expect(ctx).toMatch(/fallback|legacy|MV2/i);
    }
  });
});

describe('Sidebar / chat-panel surface', () => {
  it('Chrome manifest does NOT declare side_panel', () => {
    const m = JSON.parse(manifestChrome);
    expect(m.side_panel).toBeUndefined();
    expect(m.permissions).not.toContain('sidePanel');
  });

  it('Firefox manifest sidebar_action panel points at sidebar.html (Firefox-only fallback)', () => {
    // Firefox has no chrome.sidePanel API, so a manifest sidebar_action
    // is the only native sidebar entrypoint. Chrome MV3 must NOT have
    // either side_panel or sidePanel permission — the Chrome chat
    // surface is the page-overlay content-script.
    const m = JSON.parse(manifestFirefox);
    if (m.sidebar_action) {
      expect(m.sidebar_action.default_panel).toBe('sidebar.html');
    }
  });

  it('background.ts does NOT call chrome.sidePanel.setOptions', () => {
    expect(chromeBg).not.toMatch(/chrome\.sidePanel\.setOptions/);
  });

  it('content-script chat overlay anchors to the right edge (not left)', () => {
    // The right-anchor is the user's hard requirement. The chat panel
    // is the #hanzo-page-overlay-root element. It anchors with
    // `right: 0` (flush) by default and flips to `left: 0` only when
    // [data-side="left"] is set explicitly.
    const overlayBlock = contentScript.slice(
      contentScript.indexOf('#hanzo-page-overlay-root {'),
      contentScript.indexOf('#hanzo-page-overlay-root {') + 400,
    );
    expect(overlayBlock).toMatch(/right:\s*0/);
    // The default (no data-side) block must NOT have a `left:` declaration.
    expect(overlayBlock).not.toMatch(/^\s*left:\s/m);
  });

  it('popup.ts routes "Open Chat Panel" via page.overlay.show (NOT chrome.sidePanel.open)', () => {
    expect(popupTs).toContain("action: 'page.overlay.show'");
    // Double-check no leftover sidepanel call paths.
    expect(popupTs).not.toMatch(/chrome\.sidePanel\.(open|toggle)/);
    expect(popupTs).not.toMatch(/sidebarAction\.(open|toggle)/);
  });
});

describe('Inspect-modifier shortcut', () => {
  it('default is Ctrl alone (NOT Alt — Alt collides with macOS)', () => {
    const shortcut = read('src/shared/shortcut.ts');
    const block = shortcut.slice(
      shortcut.indexOf('DEFAULT_INSPECT_SHORTCUT'),
      shortcut.indexOf('DEFAULT_INSPECT_SHORTCUT') + 400,
    );
    expect(block).toMatch(/ctrl:\s*true/);
    expect(block).toMatch(/alt:\s*false/);
  });

  it('content-script reloads shortcut on storage change (no page reload needed)', () => {
    expect(contentScript).toMatch(/storage\.onChanged\.addListener/);
    expect(contentScript).toMatch(/STORAGE_KEY_INSPECT/);
  });
});

describe('OAuth client ID convention', () => {
  it('client ID is `hanzo-browser` (registered IAM <org>-<app> client)', () => {
    // hanzo-browser is the IAM application seeded for the extension, with
    // redirectUris including https://hanzo.ai/callback. The earlier value
    // `app-hanzo` was unregistered → token exchange returned invalid_client.
    expect(sharedConfig).toContain("DEFAULT_CLIENT_ID = 'hanzo-browser'");
  });
});

describe('webextension-polyfill integration', () => {
  it('polyfill is the FIRST import in every entrypoint', () => {
    // Order matters: the polyfill must define globalThis.browser before
    // any other import reads it. ESBuild preserves import order during
    // bundling, so the source order is what ships.
    const entrypoints = [
      ['background.ts', chromeBg],
      ['background-firefox.ts', firefoxBg],
      ['content-script.ts', contentScript],
      ['popup.ts', popupTs],
    ];
    for (const [name, src] of entrypoints) {
      const polyfillIdx = src.indexOf("import 'webextension-polyfill'");
      expect(polyfillIdx, `${name} missing polyfill import`).toBeGreaterThanOrEqual(0);
      // No other `import` line should come before it.
      const before = src.slice(0, polyfillIdx);
      expect(before, `${name} has imports before the polyfill`)
        .not.toMatch(/^\s*import\s/m);
    }
  });

  it('shared/auth.ts exports a unified webExtensionAdapter', () => {
    expect(sharedAuth).toMatch(/export\s+function\s+webExtensionAdapter\s*\(/);
  });

  it('chromeAdapter and firefoxAdapter still exist as compatibility aliases', () => {
    // We cannot break callers that imported them.
    expect(sharedAuth).toMatch(/export\s+function\s+chromeAdapter\s*\(/);
    expect(sharedAuth).toMatch(/export\s+function\s+firefoxAdapter\s*\(/);
  });
});

describe('Firefox register identity', () => {
  it('Firefox sends `browser: BROWSER_NAME` so multi-browser routing works', () => {
    // Pre-1.9.0 the register payload omitted `browser`, so the bridge
    // server stored the client as 'unknown' and the user couldn't route
    // commands by browser name. Verify the field is present.
    const registerBlock = firefoxBg.slice(
      firefoxBg.indexOf('private register():'),
      firefoxBg.indexOf('private register():') + 1500,
    );
    expect(registerBlock).toMatch(/browser:\s*BROWSER_NAME/);
  });
});
