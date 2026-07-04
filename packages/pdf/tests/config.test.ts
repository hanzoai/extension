import { describe, it, expect } from 'vitest';
import {
  chatCompletionsURL, modelsURL, API_BASE_URL, pickBearer,
  buildContext, contextNote, CONTEXT_CHAR_BUDGET,
  type PageText,
} from '../src/config';

describe('model gateway endpoints', () => {
  it('chat + models go through api.hanzo.ai/v1 (no /api/ prefix)', () => {
    expect(chatCompletionsURL()).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(modelsURL()).toBe('https://api.hanzo.ai/v1/models');
    expect(API_BASE_URL).toBe('https://api.hanzo.ai');
    expect(chatCompletionsURL()).not.toContain('/api/');
  });
});

describe('pickBearer', () => {
  it('API key wins over the OAuth token', () => {
    expect(pickBearer('hk-abc', 'jwt-xyz')).toBe('hk-abc');
  });
  it('falls back to the OAuth token when no key', () => {
    expect(pickBearer('', 'jwt-xyz')).toBe('jwt-xyz');
    expect(pickBearer('   ', 'jwt-xyz')).toBe('jwt-xyz');
  });
  it('empty when neither is present (anonymous)', () => {
    expect(pickBearer('', '')).toBe('');
  });
});

// Helper: N pages of `perPage` chars each.
function pages(n: number, perPage: number): PageText[] {
  return Array.from({ length: n }, (_, i) => ({ page: i + 1, text: 'x'.repeat(perPage) }));
}

describe('buildContext (large-PDF windowing)', () => {
  it('empty document → empty, not truncated', () => {
    const ctx = buildContext([]);
    expect(ctx).toEqual({ text: '', firstPage: 0, lastPage: 0, totalPages: 0, truncated: false });
  });

  it('small document fits whole → not truncated, covers every page', () => {
    const ctx = buildContext(pages(3, 100), 10_000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.firstPage).toBe(1);
    expect(ctx.lastPage).toBe(3);
    expect(ctx.totalPages).toBe(3);
    expect(ctx.text).toContain('===== Page 2 =====');
    expect(ctx.text).toContain('===== Page 3 =====');
  });

  it('stops before exceeding the budget and marks truncated', () => {
    // 10 pages × 1000 chars, budget 3500 → only the first few pages fit.
    const ctx = buildContext(pages(10, 1000), 3500);
    expect(ctx.truncated).toBe(true);
    expect(ctx.firstPage).toBe(1);
    expect(ctx.lastPage).toBeLessThan(10);
    expect(ctx.text.length).toBeLessThanOrEqual(3500);
  });

  it('windows from a start page and truncates on both ends', () => {
    const ctx = buildContext(pages(10, 1000), 2500, 5);
    expect(ctx.firstPage).toBe(5);
    expect(ctx.truncated).toBe(true); // dropped pages 1–4 (before) and some after
    expect(ctx.text).toContain('x'); // has the start page's body
  });

  it('always includes at least the start page, hard-cutting an oversized one', () => {
    const ctx = buildContext(pages(3, 5000), 1000); // page 1 alone (5000) > budget
    expect(ctx.firstPage).toBe(1);
    expect(ctx.lastPage).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(1000); // hard-cut to the budget
  });

  it('clamps an out-of-range start page into the document', () => {
    const ctx = buildContext(pages(3, 100), 10_000, 99);
    expect(ctx.firstPage).toBe(3); // clamped to the last page
    expect(ctx.lastPage).toBe(3);
    expect(ctx.truncated).toBe(true); // pages 1–2 were before the start
  });

  it('uses CONTEXT_CHAR_BUDGET by default', () => {
    const ctx = buildContext(pages(1, CONTEXT_CHAR_BUDGET + 5000));
    expect(ctx.text.length).toBe(CONTEXT_CHAR_BUDGET);
    expect(ctx.truncated).toBe(true);
  });
});

describe('contextNote (honest scope)', () => {
  it('says full document when nothing was dropped', () => {
    const note = contextNote(buildContext(pages(2, 50), 10_000));
    expect(note.toLowerCase()).toContain('full document');
    expect(note).toContain('2 pages');
  });
  it('names the exact truncated range and warns', () => {
    const note = contextNote(buildContext(pages(10, 1000), 3500));
    expect(note.toLowerCase()).toContain('truncated');
    expect(note).toMatch(/pages \d+–\d+ of 10/);
  });
  it('flags a scanned/empty PDF', () => {
    const note = contextNote(buildContext([]));
    expect(note.toLowerCase()).toContain('no selectable text');
  });
  it('singular "page N" for a single-page context', () => {
    const note = contextNote(buildContext(pages(1, 50), 10_000));
    expect(note).toContain('1 page');
    expect(note).not.toContain('pages');
  });
});
