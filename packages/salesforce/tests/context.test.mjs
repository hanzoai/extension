import { describe, it, expect } from 'vitest';
import { truncate, MAX_CONTEXT_CHARS } from '../src/context.js';

describe('truncate', () => {
  it('passes text within the budget through unchanged', () => {
    expect(truncate('short', 100)).toBe('short');
    expect(truncate('exactly-five', 12)).toBe('exactly-five');
  });

  it('returns empty string for null/undefined (matches Apex)', () => {
    expect(truncate(null, 100)).toBe('');
    expect(truncate(undefined, 100)).toBe('');
  });

  it('truncates to exactly maxChars and appends the marker', () => {
    const big = 'x'.repeat(MAX_CONTEXT_CHARS + 500);
    const cut = truncate(big, MAX_CONTEXT_CHARS);
    expect(cut.length).toBe(MAX_CONTEXT_CHARS);
    expect(cut.endsWith('[truncated]')).toBe(true);
  });

  it('defaults to MAX_CONTEXT_CHARS when no budget given', () => {
    const big = 'y'.repeat(MAX_CONTEXT_CHARS + 1);
    expect(truncate(big).length).toBe(MAX_CONTEXT_CHARS);
  });

  it('a budget smaller than the marker keeps no head, just the marker (no negative slice)', () => {
    // keep = max(0, 3 - markerLen) = 0, so the result is the marker alone.
    // Both this and Apex HanzoContext.truncate agree: never a negative substring.
    const cut = truncate('abcdefghij', 3);
    expect(cut).toBe('\n… [truncated]');
  });
});
