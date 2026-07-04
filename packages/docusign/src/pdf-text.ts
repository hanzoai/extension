// PDF text extraction for an envelope's documents. DocuSign returns agreement
// documents as PDF bytes (getDocument); the AI actions run over their text. The
// pure text-assembly helper (itemsToText) is isolated from pdf.js and the DOM so
// it is unit-testable; extractPdfText is the thin wrapper that drives pdf.js over
// bytes. Both the server (webhook) and the browser panel use this module — one
// extraction path, no duplication.
//
// pdfjs-dist runs in both Node and the browser. In Node it needs no DOM canvas
// for TEXT extraction (getTextContent is text-only), so the same call works
// server-side. The panel bundle points GlobalWorkerOptions at the emitted
// worker (build.js copies pdf.worker.mjs); the server runs pdf.js on the main
// thread via the legacy build, which needs no worker.

import type { PageTextItem } from './hanzo.js';

// A pdf.js text item is either a real text run (has `str`) or a marked-content
// marker (no `str`). We only want the runs. Kept as a narrow structural type so
// itemsToText is testable with plain objects — no pdf.js import needed to test.
export interface TextRun {
  str?: string;
  hasEOL?: boolean;
}

// itemsToText flattens one page's text items into a single string. pdf.js yields
// positioned runs with a `hasEOL` flag at line ends; we join runs with a space
// and break the line on hasEOL, then collapse the runs of spaces a PDF's
// glyph-by-glyph layout tends to produce. Pure and total. (Identical algorithm
// to @hanzo/pdf — one way to turn PDF runs into text.)
export function itemsToText(items: TextRun[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue; // marked-content marker — skip
    out += it.str;
    if (it.hasEOL) out += '\n';
    else if (it.str && !it.str.endsWith(' ')) out += ' ';
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// extractPdfText loads a PDF from bytes and returns one PageTextItem per page,
// in order. `loadDocument` is injected so tests drive it with a fake pdf.js
// document (no real parser needed) and so the server and browser can each pass
// their own configured getDocument. The default resolves pdfjs-dist lazily —
// only a real call pulls the (large) parser in.
export async function extractPdfText(
  data: ArrayBuffer,
  loadDocument: PdfLoader = defaultLoader,
): Promise<PageTextItem[]> {
  const doc = await loadDocument(data);
  const pages: PageTextItem[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push({ page: n, text: itemsToText(content.items as TextRun[]) });
  }
  return pages;
}

// The minimal pdf.js surface extractPdfText drives. A test supplies a stub with
// this shape; the real loader adapts pdfjs-dist to it.
export interface PdfPage {
  getTextContent(): Promise<{ items: TextRun[] }>;
}
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
export type PdfLoader = (data: ArrayBuffer) => Promise<PdfDoc>;

// defaultLoader lazily imports pdfjs-dist and opens the document. pdf.js takes
// ownership of the Uint8Array it's handed (it detaches the buffer), so we copy
// first. Kept out of the pure surface so the bundle only pulls pdf.js when text
// is actually extracted.
const defaultLoader: PdfLoader = async (data: ArrayBuffer): Promise<PdfDoc> => {
  const pdfjs: any = await import('pdfjs-dist');
  const bytes = new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    getPage: (n: number) => doc.getPage(n),
  };
};
