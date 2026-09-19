import { describe, it, expect } from 'vitest';
import { itemsToText, PdfDocument, type TextRun } from '../src/pdf-view';

describe('itemsToText (pdf.js text-item flattening)', () => {
  it('joins runs on a line with single spaces', () => {
    const items: TextRun[] = [{ str: 'The' }, { str: 'quick' }, { str: 'brown' }];
    expect(itemsToText(items)).toBe('The quick brown');
  });

  it('breaks the line on hasEOL', () => {
    const items: TextRun[] = [
      { str: 'Line one', hasEOL: true },
      { str: 'Line two', hasEOL: true },
    ];
    expect(itemsToText(items)).toBe('Line one\nLine two');
  });

  it('skips marked-content markers (no str)', () => {
    const items: TextRun[] = [{ str: 'A' }, {} as TextRun, { str: 'B' }];
    expect(itemsToText(items)).toBe('A B');
  });

  it('collapses positioning noise: multiple spaces, trailing space before newline', () => {
    const items: TextRun[] = [
      { str: 'WHEREAS  ' },
      { str: 'the  parties' , hasEOL: true },
      { str: 'agree' },
    ];
    const out = itemsToText(items);
    expect(out).not.toMatch(/ {2,}/); // no double spaces
    expect(out).not.toMatch(/ \n/); // no space before newline
    expect(out).toContain('WHEREAS');
    expect(out).toContain('agree');
  });

  it('caps runs of blank lines at one blank line', () => {
    const items: TextRun[] = [
      { str: 'Para 1', hasEOL: true },
      { str: '', hasEOL: true },
      { str: '', hasEOL: true },
      { str: '', hasEOL: true },
      { str: 'Para 2' },
    ];
    expect(itemsToText(items)).toBe('Para 1\n\nPara 2');
  });

  it('does not double-space a run that already ends in a space', () => {
    const items: TextRun[] = [{ str: 'foo ' }, { str: 'bar' }];
    expect(itemsToText(items)).toBe('foo bar');
  });

  it('empty items → empty string', () => {
    expect(itemsToText([])).toBe('');
  });
});

// One blank page, the least a PDF can be. pdf.js rebuilds the missing xref.
const BLANK = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj
trailer << /Root 1 0 R >>
%%EOF`;

describe('PdfDocument', () => {
  it('releases the document on destroy, which opening the next file does first', async () => {
    const doc = await PdfDocument.open(new TextEncoder().encode(BLANK).buffer);
    expect(doc.numPages).toBe(1);
    expect(await doc.pageText(1)).toBe('');

    // pdf.js 6 moved destroy from the document to its loading task. Calling
    // it on the document threw, and the app calls it before every new file.
    doc.destroy();
    await expect(doc.pageText(1)).rejects.toThrow();
  });
});
