/**
 * executeScript pattern coverage.
 *
 * The pre-1.9.0 bug was: `chrome.scripting.executeScript({ func: new Function(...) })`
 * silently lost async results because:
 *   - Default world is ISOLATED, which can't see the page's globals
 *     (window.fetch in some sandboxes, framework instances, etc).
 *   - The MV3 API doesn't await Promises returned by `func`.
 *   - When the user's IIFE returned `undefined`, that JSON-encoded as `{}`
 *     and the caller couldn't tell success from failure.
 *
 * The 1.9.0 fix mirrors the Firefox pattern:
 *   - `world: 'MAIN'` so the page's own globals are visible.
 *   - A `Function(codeStr)()` trampoline so dynamic code strings still work.
 *   - Empty-{} detection that re-runs wrapped in `Promise.resolve(...)` to
 *     capture the resolved value.
 *
 * These tests exercise the helpers in isolation. End-to-end coverage
 * lives in the e2e specs (Playwright with extension loaded).
 */

import { describe, it, expect } from 'vitest';
import { unwrapEvaluateResult, parseTabId, tabTarget } from '../src/shared/tab-id.js';

describe('Empty-{} Promise drop detection (the 1.8.x regression)', () => {
  it('unwrapEvaluateResult({}) returns undefined (sentinel for "Promise was dropped")', () => {
    expect(unwrapEvaluateResult({})).toBeUndefined();
  });

  it('non-empty object that has none of the known keys is preserved', () => {
    const x = { foo: 1 };
    expect(unwrapEvaluateResult(x)).toEqual(x);
  });

  it('arrays are preserved (NOT collapsed to undefined)', () => {
    expect(unwrapEvaluateResult([])).toEqual([]);
    expect(unwrapEvaluateResult([1, 2])).toEqual([1, 2]);
  });
});

describe('parseTabId security and parity', () => {
  it('rejects URL-embedded tab-N (security: prevents tabId injection)', () => {
    expect(parseTabId('https://x.com/?tab-123')).toBeNull();
    expect(parseTabId('javascript:alert(tab-1)')).toBeNull();
    expect(parseTabId('data:tab-1,foo')).toBeNull();
  });

  it('accepts the bare wire formats Target.getTargets returns', () => {
    expect(parseTabId('tab-1')).toBe(1);
    expect(parseTabId('tab-1888868904')).toBe(1888868904);
    expect(parseTabId('1888868904')).toBe(1888868904);
  });

  it('returns null on every invalid input (no exceptions, no NaN)', () => {
    expect(parseTabId(undefined)).toBeNull();
    expect(parseTabId(null)).toBeNull();
    expect(parseTabId('')).toBeNull();
    expect(parseTabId('NaN')).toBeNull();
    expect(parseTabId('Infinity')).toBeNull();
    expect(parseTabId({ tabId: 1 })).toBeNull();
    expect(parseTabId(true)).toBeNull();
  });

  it('the 1.8.4 anchored-regex hardening is in place', () => {
    // `1.5e10abc` and `123abc` were the cases the 1.8.4 hardening fixed.
    expect(parseTabId('1.5e10abc')).toBeNull();
    expect(parseTabId('123abc')).toBeNull();
    expect(parseTabId('abc123')).toBeNull();
  });
});

describe('tabTarget composes cleanly', () => {
  it('empty source returns empty (or extra-only) object', () => {
    expect(tabTarget(undefined)).toEqual({});
    expect(tabTarget(undefined, { url: 'x' })).toEqual({ url: 'x' });
  });

  it('tabId wins over targetId', () => {
    expect(tabTarget({ tabId: 5, targetId: 'tab-9' })).toEqual({ tabId: 5 });
  });

  it('targetId is fallback when tabId absent', () => {
    expect(tabTarget({ targetId: 'tab-9' })).toEqual({ tabId: 'tab-9' });
  });

  it('null fields are dropped (so they do not collide with extras)', () => {
    expect(tabTarget({ tabId: null, targetId: null } as any)).toEqual({});
  });

  it('preserves tabIndex when only that is provided', () => {
    expect(tabTarget({ tabIndex: 3 })).toEqual({ tabIndex: 3 });
  });
});
