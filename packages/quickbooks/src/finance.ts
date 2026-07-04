// The accounting-aware core: turn a QuickBooks Online report or entity JSON into
// compact, readable analysis-context TEXT, windowed to a character budget. PURE
// and host-agnostic — no QBO SDK, no DOM, no network. The panel and the server
// proxy read QBO JSON and hand it here; the AI actions (hanzo.ts) then run over
// the assembled text.
//
// Why flatten to text at all: a QBO report is a deeply nested Header/Columns/
// Rows tree (sections, subtotals, a Summary per section). A model reasons far
// better over a clean indented statement than over that raw JSON, and the JSON
// is several times larger for the same information. We render the statement the
// way an accountant reads it — labels left, amounts right, sections indented —
// and truncate visibly at the budget so we never silently drop the bottom of a
// P&L.

import { CONTEXT_CHAR_BUDGET } from './config.js';

// ---- QBO report shape (only the fields we read) ---------------------------
//
// developer.intuit.com/app/developer/qbo/docs/api/accounting/report-entities/profitandloss
// A report is: Header (metadata), Columns (the value columns), Rows (a tree).
// Each Row is one of: a data row (ColData[]), a Section (Header + nested Rows +
// Summary), or a summary row. type/group tag the row kind.

export interface ReportColData {
  value?: string;
  id?: string;
}
export interface ReportRow {
  Header?: { ColData?: ReportColData[] };
  Rows?: { Row?: ReportRow[] };
  Summary?: { ColData?: ReportColData[] };
  ColData?: ReportColData[];
  type?: string;
  group?: string;
}
export interface QboReport {
  Header?: {
    ReportName?: string;
    StartPeriod?: string;
    EndPeriod?: string;
    Currency?: string;
    ReportBasis?: string;
  };
  Columns?: { Column?: Array<{ ColTitle?: string; ColType?: string }> };
  Rows?: { Row?: ReportRow[] };
}

// The result of assembling context: the rendered text, a short label for the
// source, and whether anything was dropped (so the prompt and UI can say so
// honestly). Mirrors @hanzo/docusign's DocumentContext contract.
export interface FinanceContext {
  text: string;
  /** Human label for the source, e.g. "Profit and Loss (2026-01-01 to 2026-06-30)". */
  label: string;
  truncated: boolean;
}

// ---- Report rendering -----------------------------------------------------

// colLabel is the leftmost cell of a row — the account/line label.
function colLabel(cols: ReportColData[] | undefined): string {
  return (cols?.[0]?.value ?? '').trim();
}

// colValues are the numeric/amount cells to the right of the label (every column
// after the first). Empty cells are kept as '' so alignment across columns is
// preserved.
function colValues(cols: ReportColData[] | undefined): string[] {
  if (!cols || cols.length <= 1) return [];
  return cols.slice(1).map((c) => (c.value ?? '').trim());
}

// renderRowLine renders one label + its amounts as a single indented line:
// `  Label: 1,000.00 | 2,000.00`. A label with no amounts (a bare heading) omits
// the colon. Pure and total.
function renderRowLine(label: string, values: string[], depth: number): string {
  const indent = '  '.repeat(depth);
  const amounts = values.filter((v) => v.length > 0);
  if (amounts.length === 0) return `${indent}${label}`;
  return `${indent}${label}: ${amounts.join(' | ')}`;
}

// walkRows renders the row tree depth-first into indented lines. A Section
// renders its Header line, then its child rows one level deeper, then its
// Summary line (the section subtotal). A data row renders its ColData. Rows with
// neither a label nor amounts are skipped. Pure — the exact rendering is what we
// also measure against the budget.
function walkRows(rows: ReportRow[] | undefined, depth: number, out: string[]): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const headerCols = row.Header?.ColData;
    const summaryCols = row.Summary?.ColData;
    const isSection = !!row.Rows?.Row || !!row.Header || !!row.Summary;

    if (isSection) {
      const hLabel = colLabel(headerCols);
      if (hLabel) out.push(renderRowLine(hLabel, colValues(headerCols), depth));
      walkRows(row.Rows?.Row, depth + 1, out);
      const sLabel = colLabel(summaryCols);
      if (sLabel) out.push(renderRowLine(sLabel, colValues(summaryCols), depth));
      continue;
    }

    const label = colLabel(row.ColData);
    if (label || colValues(row.ColData).some((v) => v.length > 0)) {
      out.push(renderRowLine(label || '—', colValues(row.ColData), depth));
    }
  }
}

// reportLabel is the human title for a report from its Header — the report name
// plus the period. Used as the FinanceContext label and echoed to the user.
export function reportLabel(report: QboReport): string {
  const h = report.Header ?? {};
  const name = (h.ReportName ?? 'Report').trim();
  const period =
    h.StartPeriod && h.EndPeriod ? ` (${h.StartPeriod} to ${h.EndPeriod})` : '';
  return `${name}${period}`;
}

// renderReport turns a QBO report into a plain-text statement: a metadata header
// (name, period, basis, currency, column titles) followed by the indented row
// tree. This is the readable form the model reasons over. Pure — no truncation
// here; buildReportContext applies the budget.
export function renderReport(report: QboReport): string {
  const h = report.Header ?? {};
  const meta: string[] = [];
  if (h.ReportName) meta.push(`Report: ${h.ReportName}`);
  if (h.StartPeriod && h.EndPeriod) meta.push(`Period: ${h.StartPeriod} to ${h.EndPeriod}`);
  if (h.ReportBasis) meta.push(`Basis: ${h.ReportBasis}`);
  if (h.Currency) meta.push(`Currency: ${h.Currency}`);

  const colTitles = (report.Columns?.Column ?? [])
    .map((c) => (c.ColTitle ?? '').trim())
    .filter(Boolean);
  if (colTitles.length > 0) meta.push(`Columns: ${colTitles.join(' | ')}`);

  const lines: string[] = [];
  walkRows(report.Rows?.Row, 0, lines);

  return [...meta, '', ...lines].join('\n');
}

// truncateToBudget caps text at `budget` characters on a line boundary (so we
// never cut a number in half), appending an explicit marker. Returns the text
// and whether it was cut. Pure and total. Shared by every context builder so
// "fit rendered text to a budget" has exactly one implementation.
export function truncateToBudget(
  text: string,
  budget: number = CONTEXT_CHAR_BUDGET,
): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false };
  const marker = '\n… [truncated to fit — figures below this point were omitted]';
  const room = Math.max(0, budget - marker.length);
  const slice = text.slice(0, room);
  const lastNl = slice.lastIndexOf('\n');
  const cut = lastNl > room * 0.5 ? slice.slice(0, lastNl) : slice;
  return { text: cut + marker, truncated: true };
}

// buildReportContext is the one call for a report: render it, then window it to
// the budget. Pure and total. The label is always the report's title even when
// truncated. Mirrors @hanzo/docusign's buildDocumentContext contract.
export function buildReportContext(
  report: QboReport,
  budget: number = CONTEXT_CHAR_BUDGET,
): FinanceContext {
  const rendered = renderReport(report);
  const { text, truncated } = truncateToBudget(rendered, budget);
  return { text, label: reportLabel(report), truncated };
}

// ---- Entity rendering -----------------------------------------------------
//
// The AI actions also run over lists/records of entities (Invoices, Bills,
// Transactions, Customers, Accounts). Rather than send raw QBO JSON — which is
// verbose and full of link/metadata noise — we render a compact "field: value"
// block per record, keyed to what an accountant cares about. Unknown entity
// shapes fall back to a shallow key/value dump so nothing is ever lost silently.

// A picked field: the label shown and the dotted path into the record.
interface FieldSpec {
  label: string;
  path: string;
}

// ENTITY_FIELDS is the per-entity projection — the fields worth attaching, in
// reading order. An entity not listed here renders via the generic fallback.
const ENTITY_FIELDS: Record<string, FieldSpec[]> = {
  Invoice: [
    { label: 'Invoice #', path: 'DocNumber' },
    { label: 'Date', path: 'TxnDate' },
    { label: 'Due', path: 'DueDate' },
    { label: 'Customer', path: 'CustomerRef.name' },
    { label: 'Total', path: 'TotalAmt' },
    { label: 'Balance', path: 'Balance' },
    { label: 'Currency', path: 'CurrencyRef.value' },
  ],
  Bill: [
    { label: 'Bill #', path: 'DocNumber' },
    { label: 'Date', path: 'TxnDate' },
    { label: 'Due', path: 'DueDate' },
    { label: 'Vendor', path: 'VendorRef.name' },
    { label: 'Total', path: 'TotalAmt' },
    { label: 'Balance', path: 'Balance' },
  ],
  Customer: [
    { label: 'Name', path: 'DisplayName' },
    { label: 'Company', path: 'CompanyName' },
    { label: 'Balance', path: 'Balance' },
    { label: 'Email', path: 'PrimaryEmailAddr.Address' },
    { label: 'Active', path: 'Active' },
  ],
  Account: [
    { label: 'Name', path: 'Name' },
    { label: 'Type', path: 'AccountType' },
    { label: 'Subtype', path: 'AccountSubType' },
    { label: 'Balance', path: 'CurrentBalance' },
    { label: 'Active', path: 'Active' },
  ],
  Purchase: [
    { label: 'Date', path: 'TxnDate' },
    { label: 'Payee', path: 'EntityRef.name' },
    { label: 'Account', path: 'AccountRef.name' },
    { label: 'Payment', path: 'PaymentType' },
    { label: 'Total', path: 'TotalAmt' },
  ],
};

// dig reads a dotted path out of a record, returning '' when any segment is
// missing. Values are coerced to string. Pure.
function dig(record: Record<string, unknown>, path: string): string {
  let cur: unknown = record;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur == null) return '';
  return String(cur);
}

// renderEntity renders one record as a compact "Label: value" block using the
// entity's projection, or a generic shallow dump of scalar fields when the
// entity is unknown. Empty fields are skipped. Pure.
export function renderEntity(entity: string, record: Record<string, unknown>): string {
  const specs = ENTITY_FIELDS[entity];
  const lines: string[] = [];
  if (specs) {
    for (const s of specs) {
      const v = dig(record, s.path);
      if (v) lines.push(`${s.label}: ${v}`);
    }
  } else {
    for (const [k, v] of Object.entries(record)) {
      if (v == null) continue;
      if (typeof v === 'object') continue; // skip nested link/metadata objects
      lines.push(`${k}: ${String(v)}`);
    }
  }
  return lines.join('\n');
}

// buildEntitiesContext renders a list of records into a numbered set of blocks,
// windowed to the budget. It stops adding records once the budget is reached and
// flags truncation, so a 10,000-invoice pull attaches a meaningful prefix rather
// than blowing the window. Pure and total. `label` describes the set for the UI
// and prompt.
export function buildEntitiesContext(
  entity: string,
  records: Array<Record<string, unknown>>,
  label: string,
  budget: number = CONTEXT_CHAR_BUDGET,
): FinanceContext {
  const blocks: string[] = [];
  let used = 0;
  let truncated = false;

  for (let i = 0; i < records.length; i++) {
    const body = renderEntity(entity, records[i]);
    const block = `[${entity} ${i + 1}]\n${body}`;
    const addition = (blocks.length === 0 ? '' : '\n\n') + block;
    if (used + addition.length > budget) {
      truncated = true;
      break;
    }
    blocks.push(addition);
    used += addition.length;
  }

  const included = blocks.length;
  const fullLabel =
    records.length > included
      ? `${label} — ${included} of ${records.length} ${entity} records (truncated to fit)`
      : `${label} — ${records.length} ${entity} record${records.length === 1 ? '' : 's'}`;

  return { text: blocks.join(''), label: fullLabel, truncated };
}

// contextNote is the one honest sentence prepended to the financial data so the
// model (and, echoed in the panel, the user) knows the scope of what it sees.
// Never claim the whole dataset was sent when it wasn't. Mirrors
// @hanzo/docusign's contextNote.
export function contextNote(ctx: FinanceContext): string {
  if (ctx.text.length === 0) return 'No financial data was available.';
  return ctx.truncated
    ? `${ctx.label} — truncated to fit; answer only from what is shown and say so if the omitted part is needed.`
    : ctx.label;
}
