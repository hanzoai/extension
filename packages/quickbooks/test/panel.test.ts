import { describe, it, expect } from 'vitest';
import { parseLaunchContext, panelTitle, buildContextFromPaste } from '../src/panel';
import { PROFIT_AND_LOSS, INVOICE_QUERY } from './fixtures';

describe('parseLaunchContext / panelTitle', () => {
  it('reads company, realmId, and report from the launch query', () => {
    const ctx = parseLaunchContext('?company=Acme+LLC&realmId=123&report=ProfitAndLoss');
    expect(ctx).toEqual({ company: 'Acme LLC', realmId: '123', report: 'ProfitAndLoss' });
    expect(panelTitle(ctx)).toBe('Acme LLC');
  });
  it('defaults to a generic title with no company', () => {
    expect(panelTitle(parseLaunchContext(''))).toBe('QuickBooks Online');
  });
});

describe('buildContextFromPaste (the one place the panel interprets pasted data)', () => {
  it('renders a pasted QBO report JSON as a statement', () => {
    const ctx = buildContextFromPaste(JSON.stringify(PROFIT_AND_LOSS));
    expect(ctx.label).toBe('ProfitAndLoss (2026-01-01 to 2026-06-30)');
    expect(ctx.text).toContain('Net Income: 37000.00 | 31000.00');
  });

  it('renders a pasted QBO query response as entity blocks, detecting the entity', () => {
    const ctx = buildContextFromPaste(JSON.stringify(INVOICE_QUERY));
    expect(ctx.label).toBe('Invoice query — 3 Invoice records');
    expect(ctx.text).toContain('[Invoice 1]');
    expect(ctx.text).toContain('Acme Co');
  });

  it('treats non-JSON as plain financial text', () => {
    const ctx = buildContextFromPaste('Revenue 100\nCosts 60\nProfit 40');
    expect(ctx.label).toBe('Pasted financial data');
    expect(ctx.text).toContain('Profit 40');
    expect(ctx.truncated).toBe(false);
  });

  it('caps oversized plain text to the budget and flags truncation', () => {
    const big = 'x'.repeat(500);
    const ctx = buildContextFromPaste(big, 100);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(100);
  });

  it('is empty for empty input', () => {
    expect(buildContextFromPaste('   ')).toEqual({ text: '', label: '', truncated: false });
  });

  it('stringifies valid JSON of an unknown shape rather than dropping it', () => {
    const ctx = buildContextFromPaste(JSON.stringify({ hello: 'world', n: 3 }));
    expect(ctx.label).toBe('Pasted JSON data');
    expect(ctx.text).toContain('hello');
  });
});
