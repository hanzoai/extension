// PDF.js binding: load a PDF from bytes, render a page to a canvas, and extract
// selectable text per page. The pure text-assembly helpers (itemsToText) live at
// the top, isolated from pdf.js and the DOM so they are unit-testable; the
// PdfDocument class is the thin stateful wrapper the UI drives.

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageText } from './config.js';

// The worker is bundled alongside the app (build.js emits pdf.worker.mjs) and
// pointed at by URL. pdf.js MUST run its parser in a worker; without this the
// getDocument call throws "No GlobalWorkerOptions.workerSrc specified".
export function configureWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

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
// glyph-by-glyph layout tends to produce. Pure and total.
export function itemsToText(items: TextRun[]): string {
  let out = '';
  for (const it of items) {
    if (typeof it.str !== 'string') continue; // marked-content marker — skip
    out += it.str;
    if (it.hasEOL) out += '\n';
    else if (it.str && !it.str.endsWith(' ')) out += ' ';
  }
  // Collapse 2+ spaces to one, trim trailing space before newlines, and cap
  // runs of blank lines — a PDF's positioning noise, not real content.
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// PdfDocument wraps a loaded pdf.js document: page count, per-page render, and
// per-page / whole-document text extraction. One instance per opened file;
// destroy() releases the worker-side document.
export class PdfDocument {
  private constructor(private readonly doc: PDFDocumentProxy) {}

  static async open(data: ArrayBuffer): Promise<PdfDocument> {
    // Copy into a Uint8Array pdf.js takes ownership of (it detaches the buffer).
    const bytes = new Uint8Array(data.slice(0));
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    return new PdfDocument(doc);
  }

  get numPages(): number {
    return this.doc.numPages;
  }

  private page(n: number): Promise<PDFPageProxy> {
    return this.doc.getPage(n);
  }

  // Render page `n` (1-based) into `canvas`, fitting `containerWidth` CSS px.
  // Returns the RenderTask so the caller can cancel a stale render when the user
  // pages quickly. Scales for devicePixelRatio so text is crisp on HiDPI.
  async render(n: number, canvas: HTMLCanvasElement, containerWidth: number): Promise<void> {
    const page = await this.page(n);
    const unscaled = page.getViewport({ scale: 1 });
    const cssScale = containerWidth / unscaled.width;
    const dpr = (globalThis.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: cssScale * dpr });

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D context unavailable');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    await page.render({ canvasContext: ctx, viewport } as any).promise;
  }

  // Extract text from page `n` (1-based).
  async pageText(n: number): Promise<string> {
    const page = await this.page(n);
    const content = await page.getTextContent();
    return itemsToText(content.items as TextRun[]);
  }

  // Extract every page's text, in order. `onProgress(done, total)` lets the UI
  // show a bar for a big filing (extraction of 500 pages is not instant).
  async allText(onProgress?: (done: number, total: number) => void): Promise<PageText[]> {
    const out: PageText[] = [];
    for (let n = 1; n <= this.numPages; n++) {
      out.push({ page: n, text: await this.pageText(n) });
      onProgress?.(n, this.numPages);
    }
    return out;
  }

  destroy(): void {
    void this.doc.destroy();
  }
}
