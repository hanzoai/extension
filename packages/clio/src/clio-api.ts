// Clio REST API v4 client. Every wrapper is PURE request-shaping — it returns
// the { url, method, headers, body } a caller will fetch, so the wire contract
// (path, fields selection, pagination, JSON envelope) is unit-testable without
// a network. `clioFetch` at the bottom is the one thin place that actually
// hits the network and unwraps Clio's `{ data }` / `{ data, meta }` envelope.
//
// Clio conventions this encodes:
//  - Bearer token auth; X-API-Version pins the response shape.
//  - `fields` query param selects returned attributes (Clio returns only id by
//    default) — always request the fields an action needs, no over-fetching.
//  - List responses paginate via `?limit=&page_token=`; the next token is in
//    `meta.paging.next` (a full URL). extractNextPageToken pulls it out.
//  - Writes (POST) wrap the record under a top-level `data` key.

import { clioApiRoot, CLIO_API_VERSION } from './config.js';

export interface ClioRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

// baseHeaders — auth + version on every call. JSON content-type is added only
// for writes (a GET has no body).
function baseHeaders(token: string, json = false): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'X-API-Version': CLIO_API_VERSION,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// buildQuery renders a query string from a params object, dropping undefined /
// empty values and joining array-valued params (e.g. fields) with commas — the
// form Clio expects for `fields`. Deterministic key order for stable tests.
function buildQuery(params: Record<string, string | number | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (v === undefined || v === '') continue;
    q.set(key, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ── Matters ───────────────────────────────────────────────────────────────

export interface ListMattersParams {
  token: string;
  base: string; // regional Clio origin
  // Clio filters: status (open/closed/pending), a text query, the owning
  // client contact, and a page size / cursor for pagination.
  query?: string;
  status?: 'open' | 'closed' | 'pending';
  clientId?: number;
  limit?: number;
  pageToken?: string;
  // Fields to return; sensible default covers what the matter list UI shows.
  fields?: string[];
}

const MATTER_LIST_FIELDS = ['id', 'display_number', 'description', 'status', 'client{id,name}'];
const MATTER_FIELDS = [
  'id',
  'display_number',
  'description',
  'status',
  'open_date',
  'client{id,name}',
  'practice_area{id,name}',
  'responsible_attorney{id,name}',
];

export function listMatters(p: ListMattersParams): ClioRequest {
  const query = buildQuery({
    query: p.query,
    status: p.status,
    client_id: p.clientId,
    limit: p.limit,
    page_token: p.pageToken,
    fields: p.fields ?? MATTER_LIST_FIELDS,
  });
  return {
    url: `${clioApiRoot(p.base)}/matters${query}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

// getMatter fetches one matter. `nonce` (optional) is a Clio Custom Action
// single-use code: when present it is replayed as `custom_action_nonce` so this
// authenticated call doubles as Clio's server-side validation of the click
// (Clio 403s a bad/stale nonce). This is Clio's documented validation path — a
// nonce is NOT verified locally.
export function getMatter(
  token: string,
  base: string,
  id: number,
  fields: string[] = MATTER_FIELDS,
  nonce = '',
): ClioRequest {
  const query = buildQuery({ fields, custom_action_nonce: nonce });
  return {
    url: `${clioApiRoot(base)}/matters/${id}${query}`,
    method: 'GET',
    headers: baseHeaders(token),
  };
}

// ── Documents ─────────────────────────────────────────────────────────────

export interface ListDocumentsParams {
  token: string;
  base: string;
  matterId?: number; // scope to one matter's documents
  limit?: number;
  pageToken?: string;
  fields?: string[];
}

const DOCUMENT_FIELDS = ['id', 'name', 'content_type', 'size', 'created_at', 'document_category{id,name}'];

export function listDocuments(p: ListDocumentsParams): ClioRequest {
  const query = buildQuery({
    matter_id: p.matterId,
    limit: p.limit,
    page_token: p.pageToken,
    fields: p.fields ?? DOCUMENT_FIELDS,
  });
  return {
    url: `${clioApiRoot(p.base)}/documents${query}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

// downloadDocument hits the binary download sub-resource. No JSON Accept — the
// response is the file bytes, so the caller reads it as text/blob, not `.data`.
export function downloadDocument(token: string, base: string, id: number): ClioRequest {
  return {
    url: `${clioApiRoot(base)}/documents/${id}/download`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-API-Version': CLIO_API_VERSION,
    },
  };
}

// ── Contacts ──────────────────────────────────────────────────────────────

const CONTACT_FIELDS = ['id', 'name', 'type', 'primary_email_address', 'primary_phone_number'];

export function listContacts(
  token: string,
  base: string,
  opts: { query?: string; limit?: number; pageToken?: string; fields?: string[] } = {},
): ClioRequest {
  const query = buildQuery({
    query: opts.query,
    limit: opts.limit,
    page_token: opts.pageToken,
    fields: opts.fields ?? CONTACT_FIELDS,
  });
  return {
    url: `${clioApiRoot(base)}/contacts${query}`,
    method: 'GET',
    headers: baseHeaders(token),
  };
}

// ── Write-back: Notes & Activities ────────────────────────────────────────

export interface CreateNoteParams {
  token: string;
  base: string;
  matterId: number;
  subject: string;
  detail: string; // the AI output body
}

// createNote posts a Note pinned to a matter. Clio wraps the record under a
// top-level `data` key; a matter note sets type='Matter' and the matter ref.
export function createNote(p: CreateNoteParams): ClioRequest {
  const data = {
    subject: p.subject,
    detail: p.detail,
    type: 'Matter',
    matter: { id: p.matterId },
  };
  return {
    url: `${clioApiRoot(p.base)}/notes`,
    method: 'POST',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify({ data }),
  };
}

export interface CreateActivityParams {
  token: string;
  base: string;
  matterId: number;
  note: string; // description logged on the activity
  // Clio activities are time or expense entries; a note-style log uses a
  // TimeEntry with a quantity (seconds). Default 0 → a non-billable log entry.
  quantitySeconds?: number;
  date?: string; // ISO date; defaults to Clio's server date when omitted
}

// createActivity logs an Activity (TimeEntry) against a matter — the audit-trail
// way to record that Hanzo produced work product on the matter. quantity is in
// seconds per Clio's schema.
export function createActivity(p: CreateActivityParams): ClioRequest {
  const data: Record<string, unknown> = {
    type: 'TimeEntry',
    matter: { id: p.matterId },
    note: p.note,
    quantity: p.quantitySeconds ?? 0,
  };
  if (p.date) data.date = p.date;
  return {
    url: `${clioApiRoot(p.base)}/activities`,
    method: 'POST',
    headers: baseHeaders(p.token, true),
    body: JSON.stringify({ data }),
  };
}

// ── Response unwrapping (pure) ────────────────────────────────────────────

// unwrapData pulls the record(s) out of Clio's `{ data }` envelope and throws
// on Clio's `{ error }` / `{ errors }` shapes so callers surface the real message.
export function unwrapData<T = any>(payload: any): T {
  if (payload && (payload.error || payload.errors)) {
    const err = payload.error?.message || payload.error || JSON.stringify(payload.errors);
    throw new Error(`Clio API error: ${err}`);
  }
  if (payload && 'data' in payload) return payload.data as T;
  return payload as T;
}

// extractNextPageToken reads Clio's cursor from meta.paging.next (a full URL)
// and returns just the page_token query value, or '' when there is no next page.
export function extractNextPageToken(payload: any): string {
  const next: unknown = payload?.meta?.paging?.next;
  if (typeof next !== 'string' || !next) return '';
  try {
    return new URL(next).searchParams.get('page_token') ?? '';
  } catch {
    // Clio gave a token, not a full URL — take it verbatim.
    const m = /[?&]page_token=([^&]+)/.exec(next);
    return m ? decodeURIComponent(m[1]) : '';
  }
}

// ── The one thin network place ────────────────────────────────────────────

// clioFetch executes a shaped ClioRequest and returns the parsed JSON envelope
// (NOT unwrapped — the caller chooses unwrapData vs. reading meta for paging).
// Errors carry Clio's status + body so failures are diagnosable.
export async function clioFetch(req: ClioRequest): Promise<any> {
  const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await resp.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Clio API ${resp.status}: ${text.slice(0, 200)}`);
  }
  if (!resp.ok) {
    const msg = data?.error?.message || data?.error || JSON.stringify(data?.errors) || `HTTP ${resp.status}`;
    throw new Error(`Clio API ${resp.status}: ${msg}`);
  }
  return data;
}

// clioDownload executes a download request and returns the raw text of the file
// (Clio serves the document body). Kept separate from clioFetch because the
// response is NOT the JSON envelope.
export async function clioDownload(req: ClioRequest): Promise<string> {
  const resp = await fetch(req.url, { method: req.method, headers: req.headers });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Clio download ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return resp.text();
}
