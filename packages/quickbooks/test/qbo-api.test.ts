import { describe, it, expect } from 'vitest';
import {
  companyBase,
  report,
  query,
  get,
  create,
  parseQueryResponse,
  parseEntityResponse,
  parseFault,
  REPORTS,
} from '../src/qbo-api';
import { QBO_MINOR_VERSION } from '../src/config';
import { INVOICE_QUERY, FAULT } from './fixtures';

const REALM = '123456789';
const TOK = 'AT-abc';

describe('companyBase', () => {
  it('builds /v3/company/{realmId} on the sandbox host', () => {
    expect(companyBase('sandbox', REALM)).toBe(
      `https://sandbox-quickbooks.api.intuit.com/v3/company/${REALM}`,
    );
  });
  it('uses the production host for env=production', () => {
    expect(companyBase('production', REALM)).toBe(
      `https://quickbooks.api.intuit.com/v3/company/${REALM}`,
    );
  });
  it('encodes the realmId defensively', () => {
    expect(companyBase('sandbox', 'a/b')).toContain('/company/a%2Fb');
  });
});

describe('report', () => {
  it('shapes a P&L GET at /reports/ProfitAndLoss with a Bearer, JSON Accept, and the pinned minorversion', () => {
    const r = report('sandbox', REALM, TOK, REPORTS.profitAndLoss);
    const u = new URL(r.url);
    expect(u.pathname).toBe(`/v3/company/${REALM}/reports/ProfitAndLoss`);
    expect(u.searchParams.get('minorversion')).toBe(QBO_MINOR_VERSION);
    expect(r.method).toBe('GET');
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
    expect(r.headers.Accept).toBe('application/json');
  });

  it('passes report params (start_date/end_date) through as query and still carries minorversion', () => {
    const r = report('sandbox', REALM, TOK, REPORTS.profitAndLoss, {
      start_date: '2026-01-01',
      end_date: '2026-06-30',
    });
    const u = new URL(r.url);
    expect(u.searchParams.get('start_date')).toBe('2026-01-01');
    expect(u.searchParams.get('end_date')).toBe('2026-06-30');
    expect(u.searchParams.get('minorversion')).toBe(QBO_MINOR_VERSION);
  });

  it('exposes ProfitAndLoss and BalanceSheet as the two core report names', () => {
    expect(REPORTS.profitAndLoss).toBe('ProfitAndLoss');
    expect(REPORTS.balanceSheet).toBe('BalanceSheet');
  });
});

describe('query', () => {
  it('URL-encodes the statement into the query param on /query', () => {
    const r = query('sandbox', REALM, TOK, "SELECT * FROM Invoice WHERE TxnDate > '2026-01-01'");
    const u = new URL(r.url);
    expect(u.pathname).toBe(`/v3/company/${REALM}/query`);
    expect(u.searchParams.get('query')).toBe("SELECT * FROM Invoice WHERE TxnDate > '2026-01-01'");
    expect(u.searchParams.get('minorversion')).toBe(QBO_MINOR_VERSION);
    expect(r.method).toBe('GET');
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
  });
});

describe('get', () => {
  it('shapes a single-entity read at /{entity}/{id} (entity lowercased)', () => {
    const r = get('sandbox', REALM, TOK, 'Invoice', '101');
    const u = new URL(r.url);
    expect(u.pathname).toBe(`/v3/company/${REALM}/invoice/101`);
    expect(r.method).toBe('GET');
  });
});

describe('create', () => {
  it('shapes a POST to /{entity} with a JSON body, Content-Type, and the entity payload', () => {
    const payload = { Line: [{ Amount: 100 }], CustomerRef: { value: '55' } };
    const r = create('sandbox', REALM, TOK, 'Invoice', payload);
    const u = new URL(r.url);
    expect(u.pathname).toBe(`/v3/company/${REALM}/invoice`);
    expect(r.method).toBe('POST');
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.headers.Authorization).toBe('Bearer AT-abc');
    expect(JSON.parse(r.body!)).toEqual(payload);
  });
});

describe('parseQueryResponse', () => {
  it('reads the entity array under QueryResponse[<Entity>]', () => {
    const invoices = parseQueryResponse(INVOICE_QUERY, 'Invoice');
    expect(invoices).toHaveLength(3);
    expect((invoices[0] as any).DocNumber).toBe('1001');
  });
  it('returns [] when the entity key is absent or the body is empty', () => {
    expect(parseQueryResponse(INVOICE_QUERY, 'Bill')).toEqual([]);
    expect(parseQueryResponse({}, 'Invoice')).toEqual([]);
    expect(parseQueryResponse(null, 'Invoice')).toEqual([]);
  });
});

describe('parseEntityResponse', () => {
  it('reads a single record under its entity key', () => {
    const rec = parseEntityResponse({ Invoice: { Id: '9', DocNumber: 'X' } }, 'Invoice');
    expect(rec).toEqual({ Id: '9', DocNumber: 'X' });
  });
  it('returns undefined when the entity is absent', () => {
    expect(parseEntityResponse({ Bill: {} }, 'Invoice')).toBeUndefined();
    expect(parseEntityResponse(null, 'Invoice')).toBeUndefined();
  });
});

describe('parseFault', () => {
  it('joins QBO Fault errors into a single message', () => {
    const msg = parseFault(FAULT);
    expect(msg).toMatch(/Invalid query/);
    expect(msg).toMatch(/QueryParserError/);
  });
  it('is empty when there is no fault', () => {
    expect(parseFault({})).toBe('');
    expect(parseFault(INVOICE_QUERY)).toBe('');
  });
});
