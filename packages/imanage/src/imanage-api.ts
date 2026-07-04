// iManage Work API v2 — pure request shaping + response parsing. Every function
// returns a PreparedRequest (url + headers [+ body]) or parses a response body;
// none opens a socket, so the whole API surface is unit-testable without a
// network. server.ts is the thin glue that fetches these shapes with the OAuth
// access token.
//
// The Work API root is `${api}/api/v2` (see config.apiBaseUrl). Everything is
// scoped by a CUSTOMER and a LIBRARY in the path:
//   /customers/{customer_id}/libraries/{library_id}/...
// (customer = the iManage account/tenant; library = a document database, e.g.
// `ACTIVE_US`). Document ids are opaque strings, typically `{library}!{num}.{ver}`
// e.g. `ACTIVE_US!4567.1`.
//
// Auth: the OAuth access token is sent as the `X-Auth-Token` header — iManage's
// Work API convention (NOT `Authorization: Bearer`). We keep that in ONE place.
//
// Docs: docs.imanage.com — Work API v2 (workspaces, folders, documents, search).

// A prepared GET: url + headers a single fetch needs.
export interface PreparedGet {
  url: string;
  headers: Record<string, string>;
}

// A prepared write (POST/PATCH): adds the JSON body and Content-Type.
export interface PreparedWrite extends PreparedGet {
  method: 'POST' | 'PATCH';
  body: string;
}

// The auth header name iManage's Work API expects the access token in.
export const AUTH_HEADER = 'X-Auth-Token';

// headers builds the auth header set common to every request. iManage takes the
// OAuth access token in X-Auth-Token; the customer/library scope is in the PATH,
// not a header, so nothing else is common.
function headers(accessToken: string): Record<string, string> {
  return { [AUTH_HEADER]: accessToken };
}

// jsonHeaders adds Content-Type for a write body on top of the auth header.
function jsonHeaders(accessToken: string): Record<string, string> {
  return { ...headers(accessToken), 'Content-Type': 'application/json' };
}

// The scope every request carries: the Work API root, the access token, and which
// customer + library. Grouping them keeps every wrapper's signature small and
// makes the two-level scoping impossible to forget.
export interface Scope {
  apiBase: string;
  accessToken: string;
  customerId: string | number;
  libraryId: string;
}

// Pagination controls. iManage's Work API paginates with `offset` + `limit` query
// params and reports total/overflow in the response BODY (not a header) — see
// parsePaging. We attach these on list/search endpoints.
export interface Page {
  offset?: number;
  limit?: number;
}

// DEFAULT_LIMIT is iManage's practical page size; the Work API caps a page, so we
// clamp to a documented-safe maximum to minimise round-trips without over-asking.
export const DEFAULT_LIMIT = 100;

// pageParams renders pagination into query pairs, clamping `limit` to the maximum
// and dropping non-positive values. Only emits params that are set, so an
// unpaginated call stays clean. Pure — unit-tested.
export function pageParams(page: Page | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!page) return out;
  if (typeof page.offset === 'number' && page.offset > 0) out.offset = String(Math.floor(page.offset));
  if (typeof page.limit === 'number' && page.limit > 0) {
    out.limit = String(Math.min(Math.floor(page.limit), DEFAULT_LIMIT));
  }
  return out;
}

// buildUrl joins the Work API root + a customer/library-scoped path and appends a
// query string, dropping undefined/empty values. One place builds every URL so
// scoping/pagination params are applied consistently. Pure.
function buildUrl(scope: Scope, path: string, query: Record<string, string> = {}): string {
  const base = `${scope.apiBase.replace(/\/+$/, '')}${libBase(scope)}${path}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

// libBase is the customer/library path prefix every scoped resource hangs off.
// Exported so the panel's proxy client builds the exact same relative paths.
export function libBase(scope: Pick<Scope, 'customerId' | 'libraryId'>): string {
  return `/customers/${enc(scope.customerId)}/libraries/${enc(scope.libraryId)}`;
}

// enc encodes a single path segment. iManage document ids carry `!` and `.`
// (`ACTIVE_US!4567.1`); we encode defensively so a stray value can never break —
// or traverse — the path.
export function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}

// ---- Libraries ------------------------------------------------------------

// listLibraries — the document libraries the customer exposes. Customer-scoped
// (no library in the path). Used to discover a library id when one is not fixed.
export function listLibraries(scope: Scope): PreparedGet {
  return {
    url: `${scope.apiBase.replace(/\/+$/, '')}/customers/${enc(scope.customerId)}/libraries`,
    headers: headers(scope.accessToken),
  };
}

// ---- Workspaces -----------------------------------------------------------

// listWorkspaces — the workspaces (matters / client-matter containers) in the
// library the caller can see. The panel's picker uses this to choose which
// workspace to run against.
export function listWorkspaces(scope: Scope, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope, '/workspaces', pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// getWorkspace — one workspace's profile (name, client, matter, description).
export function getWorkspace(scope: Scope, workspaceId: string): PreparedGet {
  return {
    url: buildUrl(scope, `/workspaces/${enc(workspaceId)}`),
    headers: headers(scope.accessToken),
  };
}

// ---- Folders + documents (browse) -----------------------------------------

// listFolderChildren — the contents of a container (a workspace or a folder): its
// subfolders AND its documents, in one paginated call. iManage's `/children`
// endpoint returns a mixed collection with a `type`/`wstype` discriminator per
// entry; parseFolderChildren splits it into folders + documents. This is the ONE
// browse endpoint (a workspace id is a valid container id here).
export function listFolderChildren(scope: Scope, folderId: string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope, `/folders/${enc(folderId)}/children`, pageParams(page)),
    headers: headers(scope.accessToken),
  };
}

// ---- Documents ------------------------------------------------------------

// getDocument — one document's full profile (metadata): name, extension, size,
// author/operator, class/type, doc number, version, dates, comment, and the
// workspace/database it lives in. This is what summarize / extract-clauses read
// alongside the extracted content.
export function getDocument(scope: Scope, documentId: string): PreparedGet {
  return {
    url: buildUrl(scope, `/documents/${enc(documentId)}`),
    headers: headers(scope.accessToken),
  };
}

// getDocumentContent — the document's content bytes for text extraction. iManage's
// `/download` returns the stored file; we assume text or exported text (binary /
// OCR is out of scope, handled honestly in documents.extractText). Returns a
// PreparedGet whose response the caller reads as text.
export function getDocumentContent(scope: Scope, documentId: string): PreparedGet {
  return {
    url: buildUrl(scope, `/documents/${enc(documentId)}/download`),
    headers: headers(scope.accessToken),
  };
}

// updateDocumentProfile — the ONE write path (behind an explicit, gated action):
// PATCH a document's profile fields (e.g. write an AI summary into `comment`).
// Never touches content. iManage nests the profile under a `data` key.
export function updateDocumentProfile(
  scope: Scope,
  documentId: string,
  patch: Record<string, unknown>,
): PreparedWrite {
  return {
    method: 'PATCH',
    url: buildUrl(scope, `/documents/${enc(documentId)}`),
    headers: jsonHeaders(scope.accessToken),
    body: JSON.stringify({ data: patch }),
  };
}

// ---- Search ---------------------------------------------------------------

// search — full-text / profile search for documents across the library. iManage's
// document search takes the query as `q` (anywhere) plus pagination; parseSearch
// reads the result set (same document shape as a folder listing). Project-wide
// find used by the search-and-synthesize action.
export function search(scope: Scope, query: string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope, '/documents/search', { q: query, ...pageParams(page) }),
    headers: headers(scope.accessToken),
  };
}

// ---- Response envelope + paging -------------------------------------------
//
// iManage Work API v2 wraps its payload under a top-level `data` key and reports
// paging in the body (`total_count`/`count` + an `overflow` flag or a `next`
// cursor). We normalize both at this boundary so nothing downstream touches the
// wire, and tolerate bare/undecorated shapes defensively.

// unwrap returns the `data` payload of an iManage envelope, or the value itself
// when it is already unwrapped. Pure.
export function unwrap(body: any): any {
  if (body && typeof body === 'object' && 'data' in body) return body.data;
  return body;
}

// asArray coerces an unwrapped payload to an array (iManage list responses are
// `{ data: [...] }`; a stray object or null becomes []).
function asArray(body: any): any[] {
  const d = unwrap(body);
  return Array.isArray(d) ? d : [];
}

// The parsed paging state of a list/search response: the total available (when the
// server reports it), and whether more pages exist. `hasMore` reads iManage's
// `overflow`/`next` signal, falling back to offset+returned<total.
export interface Paging {
  total: number;
  hasMore: boolean;
}

export function parsePaging(body: any, returned: number, offset = 0): Paging {
  const totalRaw = body?.total_count ?? body?.count ?? body?.total;
  const total = Number.isFinite(Number(totalRaw)) && Number(totalRaw) >= 0 ? Number(totalRaw) : 0;
  const overflow = body?.overflow === true || body?.data?.overflow === true;
  const hasNext = typeof body?.next === 'string' && body.next.length > 0;
  const hasMore = overflow || hasNext || (total > 0 && offset + returned < total);
  return { total, hasMore };
}

// ---- Typed records --------------------------------------------------------

// One library as it appears in listLibraries.
export interface Library {
  id: string;
  name: string;
}

export function parseLibraries(data: any): Library[] {
  return asArray(data)
    .map((l: any) => ({ id: String(l?.id ?? ''), name: String(l?.name ?? l?.id ?? '') }))
    .filter((l: Library) => l.id.length > 0);
}

// One workspace (matter container) profile.
export interface Workspace {
  id: string;
  name: string;
  description: string;
  client: string;
  matter: string;
  database: string;
}

function parseWorkspace(w: any): Workspace {
  return {
    id: String(w?.id ?? ''),
    name: String(w?.name ?? ''),
    description: String(w?.description ?? ''),
    client: String(w?.client ?? w?.custom1 ?? ''),
    matter: String(w?.matter ?? w?.custom2 ?? ''),
    database: String(w?.database ?? w?.wsdb ?? ''),
  };
}

export function parseWorkspaces(data: any): Workspace[] {
  return asArray(data).map(parseWorkspace).filter((w: Workspace) => w.id.length > 0);
}

export function parseWorkspaceDetail(data: any): Workspace {
  return parseWorkspace(unwrap(data) ?? {});
}

// One document entry as surfaced from a listing/search/profile — the metadata we
// render into context. `id` is iManage's opaque document id.
export interface DocumentEntry {
  id: string;
  name: string;
  extension: string;
  size: number;
  author: string;
  class: string;
  type: string;
  version: string | number;
  editDate: string;
  comment: string;
}

// isDocumentRow decides whether a `/children` row is a document (vs a folder).
// iManage marks folders with wstype/type `folder`/`workspace`; a document is marked
// `document` or (untyped) carries an extension / nested document object. An untyped
// row with neither is treated as a folder (a container), never guessed as a doc.
function isDocumentRow(r: any): boolean {
  const t = String(r?.type ?? r?.wstype ?? '').toLowerCase();
  if (t === 'document') return true;
  if (t === 'folder' || t === 'workspace') return false;
  return r?.extension !== undefined || (r?.document && typeof r.document === 'object');
}

function parseDocumentRow(r: any): DocumentEntry {
  const d = r?.document && typeof r.document === 'object' ? r.document : r;
  return {
    id: String(d?.id ?? ''),
    name: String(d?.name ?? d?.document_name ?? ''),
    extension: String(d?.extension ?? '').toLowerCase(),
    size: Number(d?.size ?? d?.file_size ?? 0) || 0,
    author: String(d?.author_description ?? d?.author ?? ''),
    class: String(d?.class_description ?? d?.class ?? ''),
    // `type_description` only: the raw `type` in a /children row is the folder-vs-
    // document discriminator (isDocumentRow), NOT the document's profile type.
    type: String(d?.type_description ?? ''),
    version: d?.version ?? '',
    editDate: String(d?.edit_date ?? d?.edit_profile_date ?? d?.update_date ?? ''),
    comment: String(d?.comment ?? ''),
  };
}

// parseDocument reads a getDocument body (envelope-wrapped) into a DocumentEntry.
export function parseDocument(data: any): DocumentEntry {
  return parseDocumentRow(unwrap(data) ?? {});
}

// One folder entry from a `/children` listing.
export interface FolderEntry {
  id: string;
  name: string;
}

function parseFolderRow(r: any): FolderEntry {
  return { id: String(r?.id ?? ''), name: String(r?.name ?? '') };
}

// The split contents of a container: its subfolders and its documents. iManage's
// `/children` returns both in one mixed array; we separate them so the context
// assembly and the picker treat each uniformly.
export interface FolderChildren {
  folders: FolderEntry[];
  documents: DocumentEntry[];
}

export function parseFolderChildren(data: any): FolderChildren {
  const rows = asArray(data);
  const folders: FolderEntry[] = [];
  const documents: DocumentEntry[] = [];
  for (const r of rows) {
    if (isDocumentRow(r)) {
      const d = parseDocumentRow(r);
      if (d.id.length > 0) documents.push(d);
    } else {
      const f = parseFolderRow(r);
      if (f.id.length > 0) folders.push(f);
    }
  }
  return { folders, documents };
}

// parseSearchResults reads a document-search body into DocumentEntry rows (the
// search result set is the same document shape as a listing).
export function parseSearchResults(data: any): DocumentEntry[] {
  return asArray(data)
    .map(parseDocumentRow)
    .filter((d: DocumentEntry) => d.id.length > 0);
}
