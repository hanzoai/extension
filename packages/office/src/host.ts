// The Office.js host glue: read the user's selection and insert AI output, one
// path per host (Word / Excel / PowerPoint). The Office-calling functions are
// intentionally thin; the shaping helpers (excelValuesToText, splitLines) are
// pure and unit-tested.

/* global Office, Word, Excel, PowerPoint */

export type HostKind = 'word' | 'excel' | 'powerpoint' | 'unknown';
export type InsertMode = 'replace' | 'after';

// hostKind maps the Office host enum to our small union. Pure given the enum.
export function hostKind(host: Office.HostType | undefined): HostKind {
  switch (host) {
    case Office.HostType.Word:
      return 'word';
    case Office.HostType.Excel:
      return 'excel';
    case Office.HostType.PowerPoint:
      return 'powerpoint';
    default:
      return 'unknown';
  }
}

// excelValuesToText flattens a selected range's 2-D values into TSV-ish text the
// model can read: rows joined by newline, cells by tab, nulls as empty. Pure.
export function excelValuesToText(values: unknown[][]): string {
  if (!values || values.length === 0) return '';
  return values
    .map((row) => row.map((c) => (c === null || c === undefined ? '' : String(c))).join('\t'))
    .join('\n');
}

// splitLines turns model output back into a 1-column, N-row 2-D array for
// writing into Excel (one line per cell down a column). Pure. Trailing blank
// lines are dropped so a stray newline doesn't clear a cell.
export function splitLines(text: string): string[][] {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines.map((l) => [l]);
}

// currentHost reads the live Office host.
export function currentHost(): HostKind {
  return hostKind(Office.context?.host);
}

// readSelection returns the user's current selection as plain text, per host.
export async function readSelection(): Promise<string> {
  switch (currentHost()) {
    case 'word':
      return await new Promise<string>((resolve, reject) => {
        Word.run(async (ctx) => {
          const sel = ctx.document.getSelection();
          sel.load('text');
          await ctx.sync();
          resolve(sel.text || '');
        }).catch(reject);
      });
    case 'excel':
      return await new Promise<string>((resolve, reject) => {
        Excel.run(async (ctx) => {
          const range = ctx.workbook.getSelectedRange();
          range.load('values');
          await ctx.sync();
          resolve(excelValuesToText(range.values as unknown[][]));
        }).catch(reject);
      });
    case 'powerpoint':
      return await new Promise<string>((resolve) => {
        Office.context.document.getSelectedDataAsync(Office.CoercionType.Text, (r) => {
          resolve(r.status === Office.AsyncResultStatus.Succeeded ? String(r.value || '') : '');
        });
      });
    default:
      return '';
  }
}

// insertResult writes the AI output back into the document. `mode` chooses
// replace-the-selection vs insert-after; Excel always writes down the current
// column from the selection's top-left (a spreadsheet has no "after cursor").
export async function insertResult(text: string, mode: InsertMode): Promise<void> {
  switch (currentHost()) {
    case 'word':
      await Word.run(async (ctx) => {
        const sel = ctx.document.getSelection();
        const loc = mode === 'replace' ? Word.InsertLocation.replace : Word.InsertLocation.after;
        sel.insertText(text, loc);
        await ctx.sync();
      });
      return;
    case 'excel':
      await Excel.run(async (ctx) => {
        const start = ctx.workbook.getSelectedRange().getCell(0, 0);
        const rows = splitLines(text);
        const target = start.getResizedRange(rows.length - 1, 0);
        target.values = rows;
        await ctx.sync();
      });
      return;
    case 'powerpoint':
      await new Promise<void>((resolve, reject) => {
        Office.context.document.setSelectedDataAsync(text, (r) => {
          r.status === Office.AsyncResultStatus.Succeeded
            ? resolve()
            : reject(new Error(r.error?.message || 'insert failed'));
        });
      });
      return;
    default:
      throw new Error('Unsupported Office host');
  }
}
