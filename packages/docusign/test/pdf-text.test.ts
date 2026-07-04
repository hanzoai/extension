import { describe, it, expect } from 'vitest';
import { itemsToText, extractPdfText, type PdfDoc, type TextRun } from '../src/pdf-text';

describe('itemsToText', () => {
  it('joins runs with spaces and breaks lines on hasEOL', () => {
    const runs: TextRun[] = [
      { str: 'This' }, { str: 'Agreement' }, { str: 'is' }, { str: 'made', hasEOL: true },
      { str: 'between' }, { str: 'the' }, { str: 'parties.', hasEOL: true },
    ];
    expect(itemsToText(runs)).toBe('This Agreement is made\nbetween the parties.');
  });

  it('skips marked-content markers (no str)', () => {
    expect(itemsToText([{ str: 'a' }, {}, { str: 'b' }])).toBe('a b');
  });

  it('collapses runs of spaces and blank lines', () => {
    const runs: TextRun[] = [{ str: 'a' }, { str: '   ' }, { str: 'b', hasEOL: true }, { hasEOL: true }, { hasEOL: true }, { hasEOL: true }, { str: 'c' }];
    const out = itemsToText(runs);
    expect(out).not.toMatch(/ {2,}/);
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain('a');
    expect(out).toContain('c');
  });

  it('is total on empty input', () => {
    expect(itemsToText([])).toBe('');
  });
});

describe('extractPdfText (injected loader — no real parser)', () => {
  // A fake pdf.js document: two pages of text runs.
  const fakeDoc: PdfDoc = {
    numPages: 2,
    async getPage(n: number) {
      const map: Record<number, TextRun[]> = {
        1: [{ str: 'Page' }, { str: 'one', hasEOL: true }],
        2: [{ str: 'Page' }, { str: 'two', hasEOL: true }],
      };
      return { async getTextContent() { return { items: map[n] }; } };
    },
  };

  it('extracts one PageTextItem per page, in order', async () => {
    const pages = await extractPdfText(new ArrayBuffer(8), async () => fakeDoc);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ page: 1, text: 'Page one' });
    expect(pages[1]).toEqual({ page: 2, text: 'Page two' });
  });

  it('handles a zero-page document', async () => {
    const empty: PdfDoc = { numPages: 0, async getPage() { throw new Error('no pages'); } };
    expect(await extractPdfText(new ArrayBuffer(0), async () => empty)).toEqual([]);
  });
});
