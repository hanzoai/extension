import { describe, it, expect } from 'vitest';
import { analyzeReport, analyzeQuery } from '../src/qbo-analysis';
import type { AiClient } from '@hanzo/ai';
import { REPORTS } from '../src/qbo-api';
import { QBO_MINOR_VERSION } from '../src/config';
import { PROFIT_AND_LOSS, INVOICE_QUERY, FAULT } from './fixtures';

// A stub AiClient that captures the messages it was asked to complete and
// returns a canned answer — so the pipeline is exercised without a network.
function stubClient(capture: { messages?: any }): AiClient {
  return {
    chat: {
      completions: {
        async create(params: any) {
          capture.messages = params.messages;
          return {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: params.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'FINANCIAL SUMMARY' }, finish_reason: 'stop' }],
          };
        },
      },
    },
    models: { async list() { return []; } },
  } as unknown as AiClient;
}

// jsonResponse builds a minimal Response-like object for the injected fetch.
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

describe('analyzeReport — the summarize-financials flow (fetch P&L → render → summarize)', () => {
  it('fetches the P&L at the right URL and summarizes it via the action', async () => {
    const seen: { url?: string } = {};
    const cap: { messages?: any } = {};
    const fakeFetch = (async (url: any) => {
      seen.url = String(url);
      return jsonResponse(200, PROFIT_AND_LOSS);
    }) as typeof fetch;

    const out = await analyzeReport({
      env: 'sandbox',
      realmId: '123456789',
      accessToken: 'AT',
      name: REPORTS.profitAndLoss,
      params: { start_date: '2026-01-01', end_date: '2026-06-30' },
      actionId: 'summarizeFinancials',
      fetch: fakeFetch,
      ask: { client: stubClient(cap) },
    });

    // hit the correct company-scoped report endpoint with the pinned minorversion
    const u = new URL(seen.url!);
    expect(u.pathname).toBe('/v3/company/123456789/reports/ProfitAndLoss');
    expect(u.searchParams.get('start_date')).toBe('2026-01-01');
    expect(u.searchParams.get('minorversion')).toBe(QBO_MINOR_VERSION);

    // the rendered statement (with Net Income) reached the model
    expect(cap.messages[1].content).toContain('Net Income: 37000.00 | 31000.00');
    // the result carries the AI answer + the report label
    expect(out.result).toBe('FINANCIAL SUMMARY');
    expect(out.label).toBe('ProfitAndLoss (2026-01-01 to 2026-06-30)');
    expect(out.truncated).toBe(false);
  });

  it('supports a freeform task instead of a named action', async () => {
    const cap: { messages?: any } = {};
    const out = await analyzeReport({
      env: 'sandbox',
      realmId: '1',
      accessToken: 'AT',
      name: REPORTS.profitAndLoss,
      task: 'What was net income?',
      fetch: (async () => jsonResponse(200, PROFIT_AND_LOSS)) as typeof fetch,
      ask: { client: stubClient(cap) },
    });
    expect(cap.messages[1].content).toContain('---- task ----\nWhat was net income?');
    expect(out.result).toBe('FINANCIAL SUMMARY');
  });

  it('throws with the QBO Fault message on a non-2xx report fetch', async () => {
    await expect(
      analyzeReport({
        env: 'sandbox',
        realmId: '1',
        accessToken: 'AT',
        name: REPORTS.balanceSheet,
        actionId: 'summarizeFinancials',
        fetch: (async () => jsonResponse(400, FAULT)) as typeof fetch,
        ask: { client: stubClient({}) },
      }),
    ).rejects.toThrow(/Invalid query|QuickBooks API 400/);
  });

  it('rejects when neither an actionId nor a task is given', async () => {
    await expect(
      analyzeReport({
        env: 'sandbox',
        realmId: '1',
        accessToken: 'AT',
        name: REPORTS.profitAndLoss,
        fetch: (async () => jsonResponse(200, PROFIT_AND_LOSS)) as typeof fetch,
        ask: { client: stubClient({}) },
      }),
    ).rejects.toThrow(/actionId or a task/);
  });
});

describe('analyzeQuery — entity analysis', () => {
  it('runs the query, renders the invoices, and analyzes them', async () => {
    const seen: { url?: string } = {};
    const cap: { messages?: any } = {};
    const out = await analyzeQuery({
      env: 'sandbox',
      realmId: '123',
      accessToken: 'AT',
      statement: 'SELECT * FROM Invoice',
      entity: 'Invoice',
      actionId: 'categorizeTransactions',
      fetch: (async (url: any) => {
        seen.url = String(url);
        return jsonResponse(200, INVOICE_QUERY);
      }) as typeof fetch,
      ask: { client: stubClient(cap) },
    });

    const u = new URL(seen.url!);
    expect(u.pathname).toBe('/v3/company/123/query');
    expect(u.searchParams.get('query')).toBe('SELECT * FROM Invoice');
    expect(cap.messages[1].content).toContain('[Invoice 1]');
    expect(cap.messages[1].content).toContain('Acme Co');
    expect(out.result).toBe('FINANCIAL SUMMARY');
    expect(out.label).toBe('Invoice query — 3 Invoice records');
  });
});
