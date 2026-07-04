// QuickBooks Online Accounting API v3 — pure request shaping + response parsing.
// Every function returns a PreparedApiRequest (url + headers [+ body]); none opens
// a socket, so the whole API surface is unit-testable without a network.
// server.ts / app.ts are the thin glue that fetch these shapes with a Bearer
// access token.
//
// The REST root is `${host}/v3/company/${realmId}` (see config.qboApiHost +
// QBO_API_VERSION), where realmId (the company id) comes from the OAuth callback
// and host is sandbox vs production. Every path below is built on that root and
// carries the pinned minorversion. Docs:
// developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities

import { qboApiHost, QBO_API_VERSION, QBO_MINOR_VERSION, type QboEnv } from './config.js';

// A prepared GET/POST: the url + headers (+ body for writes) a single fetch
// needs. Bearer-only — the Accounting API is authorized by the OAuth access
// token. `method` and `body` are present only for writes.
export interface PreparedApiRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

// companyBase builds the per-company REST root: `${host}/v3/company/${realmId}`.
// Every request is built on top of this. Pure — the wrappers below take env +
// realmId and derive it once.
export function companyBase(env: QboEnv, realmId: string): string {
  return `${qboApiHost(env)}/${QBO_API_VERSION}/company/${enc(realmId)}`;
}

// bearer builds the JSON read headers for an Accounting API request. QBO returns
// JSON when asked; without Accept it defaults to XML.
function readHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

// writeHeaders adds Content-Type for a JSON write body.
function writeHeaders(accessToken: string): Record<string, string> {
  return { ...readHeaders(accessToken), 'Content-Type': 'application/json' };
}

// withMinor appends the pinned minorversion query param, preserving any existing
// query. Every Accounting API call carries it so the schema can't drift.
function withMinor(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}minorversion=${QBO_MINOR_VERSION}`;
}

// The reports we surface. `ProfitAndLoss` and `BalanceSheet` are the two core
// financial statements; the others are common SMB reads. The name is a path
// segment on /reports/{name}.
export const REPORTS = {
  profitAndLoss: 'ProfitAndLoss',
  balanceSheet: 'BalanceSheet',
  cashFlow: 'CashFlow',
  agedReceivables: 'AgedReceivables',
  agedPayables: 'AgedPayables',
} as const;

export type ReportName = (typeof REPORTS)[keyof typeof REPORTS];

// report — a financial report (P&L, Balance Sheet, …). Optional params
// (start_date, end_date, accounting_method, summarize_column_by, …) ride as the
// query. QBO returns a nested Row/Column report structure that finance.ts
// flattens. Docs: developer.intuit.com/app/developer/qbo/docs/api/accounting/
// report-entities/profitandloss
export function report(
  env: QboEnv,
  realmId: string,
  accessToken: string,
  name: ReportName,
  params: Record<string, string> = {},
): PreparedApiRequest {
  const q = new URLSearchParams(params).toString();
  const path = `${companyBase(env, realmId)}/reports/${enc(name)}${q ? `?${q}` : ''}`;
  return { url: withMinor(path), method: 'GET', headers: readHeaders(accessToken) };
}

// query — a read via the QBO SQL-like query language against the /query endpoint
// (e.g. `SELECT * FROM Invoice WHERE TxnDate > '2026-01-01'`). This is the one
// way to read lists of entities (Invoices, Bills, Customers, Accounts,
// Transactions via a Purchase/JournalEntry query). The statement is URL-encoded
// into the `query` param. Docs: developer.intuit.com/app/developer/qbo/docs/
// api/accounting/all-entities/query
export function query(
  env: QboEnv,
  realmId: string,
  accessToken: string,
  statement: string,
): PreparedApiRequest {
  const q = new URLSearchParams({ query: statement }).toString();
  const path = `${companyBase(env, realmId)}/query?${q}`;
  return { url: withMinor(path), method: 'GET', headers: readHeaders(accessToken) };
}

// get — a single entity by id (e.g. `Invoice`/`123`). Used to fetch one record
// for explain/analysis. Docs: .../all-entities/invoice#read-an-invoice
export function get(
  env: QboEnv,
  realmId: string,
  accessToken: string,
  entity: string,
  id: string,
): PreparedApiRequest {
  const path = `${companyBase(env, realmId)}/${enc(entity.toLowerCase())}/${enc(id)}`;
  return { url: withMinor(path), method: 'GET', headers: readHeaders(accessToken) };
}

// create — a POST to /{entity} that creates (or, with a sparse+Id body, updates)
// a record. The single write path: the light write-back actions (create an
// invoice, add a memo) build the entity JSON and hand it here. Gated behind an
// explicit action upstream; this wrapper only shapes the request. Docs:
// .../all-entities/invoice#create-an-invoice
export function create(
  env: QboEnv,
  realmId: string,
  accessToken: string,
  entity: string,
  payload: unknown,
): PreparedApiRequest {
  const path = `${companyBase(env, realmId)}/${enc(entity.toLowerCase())}`;
  return {
    url: withMinor(path),
    method: 'POST',
    headers: writeHeaders(accessToken),
    body: JSON.stringify(payload),
  };
}

// ---- Response parsing -----------------------------------------------------

// parseQueryResponse reads a /query response into the entity array for a given
// entity name. QBO wraps results under `QueryResponse[<Entity>]` (e.g.
// QueryResponse.Invoice). Returns [] when the entity key is absent (a valid
// empty result). Pure — unit-tested with plain objects.
export function parseQueryResponse<T = Record<string, unknown>>(data: any, entity: string): T[] {
  const qr = data?.QueryResponse;
  if (!qr || typeof qr !== 'object') return [];
  const arr = qr[entity];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

// parseEntityResponse reads a single-entity read/create response. QBO returns
// the record under its entity key at the top level (e.g. { Invoice: {…} }).
// Returns undefined when absent so the caller can surface a not-found. Pure.
export function parseEntityResponse<T = Record<string, unknown>>(data: any, entity: string): T | undefined {
  const v = data?.[entity];
  return v && typeof v === 'object' ? (v as T) : undefined;
}

// parseFault reads QBO's error envelope (`Fault.Error[]`) into a single message,
// or '' when there is no fault. QBO returns HTTP 400 with a Fault body on a bad
// query/write; the server uses this to surface the real reason. Pure.
export function parseFault(data: any): string {
  const errors = data?.Fault?.Error;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return errors
    .map((e: any) => {
      const msg = String(e?.Message ?? '').trim();
      const detail = String(e?.Detail ?? '').trim();
      return detail && detail !== msg ? `${msg}: ${detail}` : msg;
    })
    .filter(Boolean)
    .join('; ');
}

// enc encodes a single path segment. realmId is numeric and entity ids are short
// tokens, but we encode defensively at this boundary so a stray character can
// never break the path (or worse, traverse it).
function enc(segment: string): string {
  return encodeURIComponent(segment);
}
