import { describe, it, expect } from 'vitest';
import {
  parseTabId,
  tabTarget,
  unwrapEvaluateResult,
} from '../src/shared/tab-id.js';

describe('parseTabId', () => {
  it('accepts a finite positive number', () => {
    expect(parseTabId(123)).toBe(123);
    expect(parseTabId(0)).toBe(0);
    expect(parseTabId(1888868904)).toBe(1888868904);
  });

  it('accepts negative numbers (some test fixtures use them)', () => {
    expect(parseTabId(-7)).toBe(-7);
  });

  it('rejects non-finite numbers (NaN / Infinity)', () => {
    expect(parseTabId(NaN)).toBeNull();
    expect(parseTabId(Infinity)).toBeNull();
    expect(parseTabId(-Infinity)).toBeNull();
  });

  it('parses "tab-NNN" format from Target.getTargets', () => {
    expect(parseTabId('tab-1888868904')).toBe(1888868904);
    expect(parseTabId('tab-0')).toBe(0);
    expect(parseTabId('tab-42')).toBe(42);
  });

  it('parses bare numeric strings', () => {
    expect(parseTabId('123')).toBe(123);
    expect(parseTabId('0')).toBe(0);
    expect(parseTabId('1888868904')).toBe(1888868904);
  });

  it('returns null for malformed strings', () => {
    expect(parseTabId('')).toBeNull();
    expect(parseTabId('abc')).toBeNull();
    expect(parseTabId('tab-')).toBeNull();
    expect(parseTabId('tab-abc')).toBeNull();
    expect(parseTabId('foo-123')).toBeNull();        // not "tab-" prefix
    expect(parseTabId('123abc')).toBeNull();
    expect(parseTabId('1.5e10abc')).toBeNull();
  });

  it('returns null for null / undefined / non-string non-number', () => {
    expect(parseTabId(null)).toBeNull();
    expect(parseTabId(undefined)).toBeNull();
    expect(parseTabId({})).toBeNull();
    expect(parseTabId([])).toBeNull();
    expect(parseTabId(true)).toBeNull();
  });

  it('does NOT match "tab-NN" embedded mid-string (security)', () => {
    // The regex anchors on (start | "tab-") and \d+$, so something like
    // "https://x.com/?tab-123" must NOT be parsed as tabId 123.
    expect(parseTabId('https://x.com/?tab-123')).toBeNull();
    // But pure "tab-123" still works.
    expect(parseTabId('tab-123')).toBe(123);
  });
});

describe('tabTarget', () => {
  it('returns empty object when nothing supplied', () => {
    expect(tabTarget(undefined)).toEqual({});
    expect(tabTarget({})).toEqual({});
  });

  it('forwards extra params unchanged', () => {
    expect(tabTarget({}, { url: 'https://example.com' }))
      .toEqual({ url: 'https://example.com' });
  });

  it('forwards tabId when present', () => {
    expect(tabTarget({ tabId: 42 })).toEqual({ tabId: 42 });
    expect(tabTarget({ tabId: 'tab-42' })).toEqual({ tabId: 'tab-42' });
  });

  it('forwards tabIndex when present', () => {
    expect(tabTarget({ tabIndex: 0 })).toEqual({ tabIndex: 0 });
    expect(tabTarget({ tabIndex: 3 })).toEqual({ tabIndex: 3 });
  });

  it('forwards both tabId and tabIndex', () => {
    expect(tabTarget({ tabId: 5, tabIndex: 2 }))
      .toEqual({ tabId: 5, tabIndex: 2 });
  });

  it('falls back to targetId when tabId absent', () => {
    expect(tabTarget({ targetId: 'tab-99' }))
      .toEqual({ tabId: 'tab-99' });
  });

  it('prefers tabId over targetId when both present', () => {
    expect(tabTarget({ tabId: 1, targetId: 'tab-2' }))
      .toEqual({ tabId: 1 });
  });

  it('does NOT forward null / undefined fields', () => {
    expect(tabTarget({ tabId: null, tabIndex: undefined } as any))
      .toEqual({});
  });

  it('extra params merged with tab fields, tab fields win on key collision', () => {
    const out = tabTarget({ tabId: 7 }, { tabId: 99, url: 'x' });
    // tabTarget assigns from `extra` first, then overlays the resolved
    // tab targeting — caller's tab id is authoritative.
    expect(out.tabId).toBe(7);
    expect(out.url).toBe('x');
  });
});

describe('unwrapEvaluateResult', () => {
  it('returns null/undefined unchanged', () => {
    expect(unwrapEvaluateResult(null)).toBeNull();
    expect(unwrapEvaluateResult(undefined)).toBeUndefined();
  });

  it('passes through bare primitives', () => {
    expect(unwrapEvaluateResult(42)).toBe(42);
    expect(unwrapEvaluateResult('hello')).toBe('hello');
    expect(unwrapEvaluateResult(true)).toBe(true);
    expect(unwrapEvaluateResult(false)).toBe(false);
    expect(unwrapEvaluateResult(0)).toBe(0);
  });

  it('unwraps the standard Chrome / CDP shape {result: {value: X}}', () => {
    expect(unwrapEvaluateResult({ result: { value: 2 } })).toBe(2);
    expect(unwrapEvaluateResult({ result: { value: 'ok' } })).toBe('ok');
    expect(unwrapEvaluateResult({ result: { value: null } })).toBeNull();
    expect(unwrapEvaluateResult({ result: { value: 0 } })).toBe(0);
  });

  it('unwraps full-CDP shape {result: {value, type}}', () => {
    expect(unwrapEvaluateResult({ result: { value: 'hi', type: 'string' } }))
      .toBe('hi');
  });

  it('unwraps legacy {result: bare} shape', () => {
    expect(unwrapEvaluateResult({ result: 7 })).toBe(7);
  });

  it('unwraps hanzo-tools {value: bare} shape', () => {
    expect(unwrapEvaluateResult({ value: 5 })).toBe(5);
  });

  it('returns undefined for empty {} (MV3 Promise drop)', () => {
    // The exact bug 1.8.3 fixes: executeScript serializes a Promise as {}
    // and the caller saw "result: {}" with no way to tell whether the
    // page returned an actual empty object or the bridge swallowed a
    // Promise. Empty plain-object → undefined sentinel.
    expect(unwrapEvaluateResult({})).toBeUndefined();
  });

  it('preserves a non-empty object that has none of the known keys', () => {
    const arbitrary = { foo: 1, bar: 2 };
    expect(unwrapEvaluateResult(arbitrary)).toEqual(arbitrary);
  });

  it('does NOT collapse arrays to undefined', () => {
    expect(unwrapEvaluateResult([])).toEqual([]);
    expect(unwrapEvaluateResult([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('handles deeply-nested shape: {result: {value: {result: {value: X}}}}', () => {
    // Only unwraps ONE layer — recursive unwrap would be wrong because
    // the page might legitimately have evaluated to {result: {value: X}}.
    expect(unwrapEvaluateResult({ result: { value: { result: { value: 9 } } } }))
      .toEqual({ result: { value: 9 } });
  });

  it('regression: 1+1 case (the bug from 1.8.1)', () => {
    // Sanity: the path that broke in 1.8.1 (returned {}) now returns 2.
    expect(unwrapEvaluateResult({ result: { value: 2 } })).toBe(2);
  });
});
