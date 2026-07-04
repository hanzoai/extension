import { describe, it, expect } from 'vitest';
import { isUiToMain, isMainToUi } from '../src/messaging';

describe('messaging boundary guards', () => {
  it('accepts well-formed messages with a string type', () => {
    expect(isUiToMain({ type: 'ui-ready' })).toBe(true);
    expect(isUiToMain({ type: 'apply-edits', edits: [] })).toBe(true);
    expect(isMainToUi({ type: 'selection', snapshot: {} })).toBe(true);
  });

  it('rejects non-objects and missing/non-string type', () => {
    for (const guard of [isUiToMain, isMainToUi]) {
      expect(guard(null)).toBe(false);
      expect(guard(undefined)).toBe(false);
      expect(guard('str')).toBe(false);
      expect(guard(42)).toBe(false);
      expect(guard({})).toBe(false);
      expect(guard({ type: 7 })).toBe(false);
    }
  });
});
