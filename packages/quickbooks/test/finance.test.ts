import { describe, it, expect } from 'vitest';
import {
  renderReport,
  reportLabel,
  buildReportContext,
  truncateToBudget,
  renderEntity,
  buildEntitiesContext,
  contextNote,
  type QboReport,
} from '../src/finance';
import { PROFIT_AND_LOSS, INVOICE_QUERY } from './fixtures';

describe('renderReport (P&L → readable statement)', () => {
  const text = renderReport(PROFIT_AND_LOSS as QboReport);

  it('renders the metadata header (name, period, basis, currency, columns)', () => {
    expect(text).toContain('Report: ProfitAndLoss');
    expect(text).toContain('Period: 2026-01-01 to 2026-06-30');
    expect(text).toContain('Basis: Accrual');
    expect(text).toContain('Currency: USD');
    expect(text).toContain('Columns: Jan - Jun 2026 | Jan - Jun 2025');
  });

  it('renders section headers, indented line items, and section subtotals', () => {
    expect(text).toContain('Income');
    // a leaf line is indented and carries both period columns
    expect(text).toContain('  Services: 120000.00 | 90000.00');
    expect(text).toContain('  Product Sales: 48000.00 | 52000.00');
    expect(text).toContain('Total Income: 168000.00 | 142000.00');
    expect(text).toContain('  Payroll: 95000.00 | 80000.00');
    expect(text).toContain('Total Expenses: 131000.00 | 111000.00');
  });

  it('renders the top-level Net Income summary row', () => {
    expect(text).toContain('Net Income: 37000.00 | 31000.00');
  });

  it('keeps rows in statement order (Income before Expenses before Net Income)', () => {
    expect(text.indexOf('Income')).toBeLessThan(text.indexOf('Expenses'));
    expect(text.indexOf('Total Expenses')).toBeLessThan(text.indexOf('Net Income'));
  });
});

describe('reportLabel', () => {
  it('is the report name plus the period', () => {
    expect(reportLabel(PROFIT_AND_LOSS as QboReport)).toBe('ProfitAndLoss (2026-01-01 to 2026-06-30)');
  });
  it('degrades gracefully with no header', () => {
    expect(reportLabel({} as QboReport)).toBe('Report');
  });
});

describe('truncateToBudget', () => {
  it('returns text unchanged and not truncated when under budget', () => {
    const r = truncateToBudget('short', 100);
    expect(r).toEqual({ text: 'short', truncated: false });
  });
  it('cuts on a line boundary and appends a marker when over budget', () => {
    const long = Array.from({ length: 50 }, (_, i) => `line ${i} value 1000.00`).join('\n');
    const r = truncateToBudget(long, 200);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(200);
    expect(r.text).toMatch(/truncated to fit/);
    // never cuts mid-line: everything before the marker ends on a full line
    const beforeMarker = r.text.split('\n…')[0];
    expect(long.startsWith(beforeMarker)).toBe(true);
  });
});

describe('buildReportContext', () => {
  it('assembles the full P&L context, labeled, not truncated under a generous budget', () => {
    const ctx = buildReportContext(PROFIT_AND_LOSS as QboReport, 100_000);
    expect(ctx.label).toBe('ProfitAndLoss (2026-01-01 to 2026-06-30)');
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('Net Income: 37000.00 | 31000.00');
  });
  it('truncates a large report to the budget and flags it, keeping the label', () => {
    const ctx = buildReportContext(PROFIT_AND_LOSS as QboReport, 120);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(120);
    expect(ctx.label).toBe('ProfitAndLoss (2026-01-01 to 2026-06-30)');
  });
});

describe('renderEntity', () => {
  it('projects an Invoice to its accounting-relevant fields via dotted paths', () => {
    const inv = INVOICE_QUERY.QueryResponse.Invoice[0];
    const text = renderEntity('Invoice', inv as any);
    expect(text).toContain('Invoice #: 1001');
    expect(text).toContain('Customer: Acme Co'); // CustomerRef.name
    expect(text).toContain('Total: 5000');
    expect(text).toContain('Currency: USD'); // CurrencyRef.value
    // nested Line array is not dumped
    expect(text).not.toContain('Line');
  });
  it('falls back to a shallow scalar dump for an unknown entity, skipping nested objects', () => {
    const text = renderEntity('Widget', { Id: '7', Name: 'W', Meta: { x: 1 }, Active: true } as any);
    expect(text).toContain('Id: 7');
    expect(text).toContain('Name: W');
    expect(text).toContain('Active: true');
    expect(text).not.toContain('Meta');
  });
});

describe('buildEntitiesContext', () => {
  const invoices = INVOICE_QUERY.QueryResponse.Invoice as any[];

  it('renders numbered entity blocks and labels the full count', () => {
    const ctx = buildEntitiesContext('Invoice', invoices, 'Invoice query', 100_000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('[Invoice 1]');
    expect(ctx.text).toContain('[Invoice 3]');
    expect(ctx.text).toContain('Globex');
    expect(ctx.label).toBe('Invoice query — 3 Invoice records');
  });

  it('stops at the budget and reports "N of M" when truncated', () => {
    const ctx = buildEntitiesContext('Invoice', invoices, 'Invoice query', 120);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('[Invoice 1]');
    expect(ctx.label).toMatch(/of 3 Invoice records \(truncated to fit\)/);
  });

  it('handles an empty result', () => {
    const ctx = buildEntitiesContext('Invoice', [], 'Invoice query');
    expect(ctx.text).toBe('');
    expect(ctx.truncated).toBe(false);
    expect(ctx.label).toBe('Invoice query — 0 Invoice records');
  });
});

describe('contextNote', () => {
  it('is honest about empty vs full vs truncated', () => {
    expect(contextNote({ text: '', label: '', truncated: false })).toMatch(/No financial data/);
    expect(contextNote({ text: 'x', label: 'P&L', truncated: false })).toBe('P&L');
    expect(contextNote({ text: 'x', label: 'P&L', truncated: true })).toMatch(/truncated to fit/);
  });
});
