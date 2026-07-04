// DocuSign eSignature REST API — pure request shaping + response parsing. Every
// function returns a PreparedRequest (url + headers) or parses a response body;
// none opens a socket, so the whole API surface is unit-testable without a
// network. server.ts / app.ts are the thin glue that fetch these shapes with a
// Bearer access token.
//
// The REST root is `${base_uri}/restapi/v2.1` (see docusign-oauth.apiBaseUrl),
// where base_uri comes from /oauth/userinfo for the signed-in account. All paths
// below are relative to that root. Docs:
// developers.docusign.com/docs/esign-rest-api/reference/envelopes/.

// A prepared GET: the url + headers a single fetch needs. Bearer-only — the
// eSignature API is authorized by the OAuth access token.
export interface PreparedGet {
  url: string;
  headers: Record<string, string>;
}

// bearer builds the Authorization header for an eSignature request.
function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// The special documentId keyword that returns ALL documents in an envelope
// merged into one PDF (plus the Certificate of Completion when the account
// enables it). We summarize the whole agreement, so this is the default target.
export const COMBINED_DOCUMENT_ID = 'combined';

// getEnvelope — envelope metadata (status, subject, dates, sender). Used to
// title the summary and to confirm an envelope is complete before acting.
export function getEnvelope(apiBase: string, accountId: string, envelopeId: string, accessToken: string): PreparedGet {
  return {
    url: `${apiBase}/accounts/${enc(accountId)}/envelopes/${enc(envelopeId)}`,
    headers: bearer(accessToken),
  };
}

// listDocuments — the documents in an envelope (id, name, type, order). The
// panel shows this list; the webhook uses it to know what it's summarizing.
export function listDocuments(apiBase: string, accountId: string, envelopeId: string, accessToken: string): PreparedGet {
  return {
    url: `${apiBase}/accounts/${enc(accountId)}/envelopes/${enc(envelopeId)}/documents`,
    headers: bearer(accessToken),
  };
}

// getDocument — the PDF bytes for one document, or the special keywords
// (`combined`, `archive`, `certificate`). Returns application/pdf; the caller
// reads the body as an ArrayBuffer and extracts text. documentId defaults to
// `combined` (the whole agreement as one PDF).
export function getDocument(
  apiBase: string,
  accountId: string,
  envelopeId: string,
  accessToken: string,
  documentId: string = COMBINED_DOCUMENT_ID,
): PreparedGet {
  return {
    url: `${apiBase}/accounts/${enc(accountId)}/envelopes/${enc(envelopeId)}/documents/${enc(documentId)}`,
    headers: { ...bearer(accessToken), Accept: 'application/pdf' },
  };
}

// listEnvelopes — envelopes changed since a date (ISO 8601). The panel's picker
// uses this to let a user choose which agreement to run against when it wasn't
// launched with an envelope in context. from_date is required by DocuSign when
// no explicit envelope/folder filter is given.
export function listEnvelopes(
  apiBase: string,
  accountId: string,
  accessToken: string,
  fromDate: string,
): PreparedGet {
  const q = new URLSearchParams({ from_date: fromDate }).toString();
  return {
    url: `${apiBase}/accounts/${enc(accountId)}/envelopes?${q}`,
    headers: bearer(accessToken),
  };
}

// ---- Response parsing -----------------------------------------------------

// One document as it appears in a listDocuments response.
export interface EnvelopeDocument {
  documentId: string;
  name: string;
  type: string;
  order: number;
}

// parseDocuments reads a listDocuments body into a typed list, sorted by the
// `order` field DocuSign supplies (the display order in the envelope). The
// Certificate of Completion arrives with documentId "certificate"; we keep it
// (it carries the audit trail) but it sorts last by its non-numeric order.
// Pure — unit-tested with plain objects.
export function parseDocuments(data: any): EnvelopeDocument[] {
  const rawDocs = Array.isArray(data?.envelopeDocuments) ? data.envelopeDocuments : [];
  const docs: EnvelopeDocument[] = rawDocs.map((d: any) => ({
    documentId: String(d?.documentId ?? ''),
    name: String(d?.name ?? ''),
    type: String(d?.type ?? ''),
    order: Number.parseInt(String(d?.order ?? ''), 10) || 0,
  }));
  return docs
    .filter((d) => d.documentId.length > 0)
    .sort((a, b) => a.order - b.order);
}

// Envelope metadata we surface.
export interface EnvelopeInfo {
  envelopeId: string;
  status: string;
  emailSubject: string;
  sentDateTime: string;
  completedDateTime: string;
}

// parseEnvelope reads a getEnvelope body into a typed summary. Missing fields
// become '' rather than undefined so the UI/prompt renders predictably.
export function parseEnvelope(data: any): EnvelopeInfo {
  return {
    envelopeId: String(data?.envelopeId ?? ''),
    status: String(data?.status ?? ''),
    emailSubject: String(data?.emailSubject ?? ''),
    sentDateTime: String(data?.sentDateTime ?? ''),
    completedDateTime: String(data?.completedDateTime ?? ''),
  };
}

// enc encodes a single path segment. Account/envelope/document ids are GUIDs or
// short keywords, but we encode defensively at this boundary so a stray
// character can never break the path (or worse, traverse it).
function enc(segment: string): string {
  return encodeURIComponent(segment);
}
