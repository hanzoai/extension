// Procore REST API v1.0 — pure request shaping + response parsing. Every function
// returns a PreparedRequest (url + headers [+ body]) or parses a response body;
// none opens a socket, so the whole API surface is unit-testable without a
// network. server.ts is the thin glue that fetches these shapes with the OAuth
// Bearer access token.
//
// The REST root is `${api}/rest/v1.0` (see config.apiBaseUrl). All Procore reads
// and writes are scoped two ways:
//   • Company scope — the `Procore-Company-Id` header, REQUIRED on every request.
//   • Project scope — the project id in the path (…/projects/{id}/…) or a
//     `project_id` query param, depending on the resource.
// Docs: developers.procore.com/reference/rest/rfis and .../submittals,
// .../project-documents, .../observations, .../daily-logs.

// A prepared GET: url + headers a single fetch needs. Bearer + company scope.
export interface PreparedGet {
  url: string;
  headers: Record<string, string>;
}

// A prepared write (POST/PATCH): adds the JSON body and Content-Type.
export interface PreparedWrite extends PreparedGet {
  method: 'POST' | 'PATCH';
  body: string;
}

// The company-scope header name — REQUIRED by Procore on every REST v1.0 call.
export const COMPANY_HEADER = 'Procore-Company-Id';

// headers builds the auth + company-scope header set common to every request.
// The company id is a number in Procore; we stringify it at this one boundary.
function headers(accessToken: string, companyId: number | string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    [COMPANY_HEADER]: String(companyId),
  };
}

// jsonHeaders adds Content-Type for a write body on top of the auth/company set.
function jsonHeaders(accessToken: string, companyId: number | string): Record<string, string> {
  return { ...headers(accessToken, companyId), 'Content-Type': 'application/json' };
}

// The common scope every request carries: which company, and (for project-scoped
// resources) which project. Grouping them keeps every wrapper's signature small
// and makes the two-level scoping impossible to forget.
export interface Scope {
  apiBase: string;
  accessToken: string;
  companyId: number | string;
}

// Pagination controls. Procore paginates with page (1-based) + per_page and
// returns the total count in the `Total` response header (parsed by the caller
// with parseTotal). We attach these as query params on list endpoints.
export interface Page {
  page?: number;
  perPage?: number;
}

// DEFAULT_PER_PAGE is Procore's practical page size; 100 is the documented max
// for most list endpoints, so we default to it to minimise round-trips.
export const DEFAULT_PER_PAGE = 100;

// pageParams renders pagination into query pairs, clamping per_page to the
// documented maximum. Only emits params that are set, so an unpaginated call
// stays clean. Pure — unit-tested.
export function pageParams(page: Page | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!page) return out;
  if (typeof page.page === 'number' && page.page > 0) out.page = String(Math.floor(page.page));
  if (typeof page.perPage === 'number' && page.perPage > 0) {
    out.per_page = String(Math.min(Math.floor(page.perPage), DEFAULT_PER_PAGE));
  }
  return out;
}

// buildUrl joins the REST root + path and appends a query string, dropping
// undefined/empty values. One place builds every URL so scoping/pagination
// params are applied consistently. Pure.
function buildUrl(apiBase: string, path: string, query: Record<string, string> = {}): string {
  const base = `${apiBase.replace(/\/+$/, '')}${path}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

// enc encodes a single path segment (ids are integers, but we encode defensively
// so a stray value can never break — or traverse — the path).
function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}

// ---- Projects -------------------------------------------------------------

// listProjects — the projects the caller can see within the company. Company
// scope only (no project in the path). The panel's picker uses this to choose
// which project to run against.
export function listProjects(scope: Scope, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, '/projects', {
      company_id: String(scope.companyId),
      ...pageParams(page),
    }),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// ---- RFIs -----------------------------------------------------------------

// listRFIs — the RFIs on a project. Project-scoped path. The core construction
// question artefact: a request for information, its answer, and its status.
export function listRFIs(scope: Scope, projectId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/projects/${enc(projectId)}/rfis`, pageParams(page)),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// getRFI — one RFI in full (question, all replies, references, status, ball-in-
// court). This is what the summarize/respond actions run over.
export function getRFI(scope: Scope, projectId: number | string, rfiId: number | string): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/projects/${enc(projectId)}/rfis/${enc(rfiId)}`),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// createReply — post a reply to an RFI. This is the ONE write path, behind an
// explicit action. Procore nests the reply under an `rfi_reply` key with a
// `body` (rich text). Returns a PreparedWrite (POST + JSON body).
export function createReply(
  scope: Scope,
  projectId: number | string,
  rfiId: number | string,
  body: string,
): PreparedWrite {
  return {
    method: 'POST',
    url: buildUrl(scope.apiBase, `/projects/${enc(projectId)}/rfis/${enc(rfiId)}/replies`),
    headers: jsonHeaders(scope.accessToken, scope.companyId),
    body: JSON.stringify({ rfi_reply: { body } }),
  };
}

// ---- Submittals -----------------------------------------------------------

// listSubmittals — the submittals on a project (shop drawings, product data,
// samples awaiting review). Project-scoped path.
export function listSubmittals(scope: Scope, projectId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/projects/${enc(projectId)}/submittals`, pageParams(page)),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// ---- Documents (project files) --------------------------------------------

// listDocuments — the files/folders in a project's Documents tool. Procore's
// project-documents endpoint is company-scoped in the path with the project as a
// required query param. Returns folder + file entries.
export function listDocuments(scope: Scope, projectId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, '/folders_and_files', {
      project_id: String(projectId),
      ...pageParams(page),
    }),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// ---- Observations ---------------------------------------------------------

// listObservations — quality/safety observation items on a project.
export function listObservations(scope: Scope, projectId: number | string, page?: Page): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/observations/items`, {
      project_id: String(projectId),
      ...pageParams(page),
    }),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// ---- Daily logs -----------------------------------------------------------

// listDailyLogs — the daily-log notes for a project on a given date (Procore's
// notes_logs endpoint; `log_date` in YYYY-MM-DD). Daily logs are the field
// record the action-item/risk extraction reads.
export function listDailyLogs(
  scope: Scope,
  projectId: number | string,
  logDate: string,
  page?: Page,
): PreparedGet {
  return {
    url: buildUrl(scope.apiBase, `/projects/${enc(projectId)}/daily_logs/notes_logs`, {
      log_date: logDate,
      ...pageParams(page),
    }),
    headers: headers(scope.accessToken, scope.companyId),
  };
}

// ---- Pagination header ----------------------------------------------------

// parseTotal reads the `Total` response header Procore returns on list endpoints
// into the total record count (for computing "page N of M"). Returns 0 for a
// missing/unparseable header. Accepts a Headers instance or a plain header map
// so it works against fetch Responses and test fixtures alike. Pure.
export function parseTotal(h: Headers | Record<string, string | string[] | undefined>): number {
  const raw =
    typeof (h as Headers)?.get === 'function'
      ? (h as Headers).get('Total') ?? (h as Headers).get('total')
      : (h as Record<string, string | string[] | undefined>).Total ??
        (h as Record<string, string | string[] | undefined>).total;
  const val = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(String(val ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---- Response parsing -----------------------------------------------------
//
// Procore list endpoints return a bare JSON array of records. We normalize the
// snake_case wire fields we surface into small typed shapes at this boundary so
// nothing downstream touches the wire.

// One project as it appears in listProjects.
export interface ProjectSummary {
  id: number;
  name: string;
  displayName: string;
  active: boolean;
}

export function parseProjects(data: any): ProjectSummary[] {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.projects) ? data.projects : [];
  return rows
    .map((p: any) => ({
      id: Number(p?.id ?? 0),
      name: String(p?.name ?? ''),
      displayName: String(p?.display_name ?? p?.name ?? ''),
      active: p?.active === true,
    }))
    .filter((p: ProjectSummary) => p.id > 0);
}

// One reply within an RFI's question thread.
export interface RfiReply {
  id: number;
  body: string;
  createdBy: string;
  createdAt: string;
}

// The question sub-object of an RFI (its body + the reply thread).
export interface RfiQuestion {
  body: string;
  replies: RfiReply[];
}

// One RFI in full. Procore nests the question + replies under `question`.
export interface Rfi {
  id: number;
  number: string;
  subject: string;
  status: string;
  question: RfiQuestion;
  ballInCourt: string;
  dueDate: string;
  createdAt: string;
}

function parseReply(r: any): RfiReply {
  return {
    id: Number(r?.id ?? 0),
    body: String(r?.body ?? r?.plain_text_body ?? ''),
    createdBy: personName(r?.created_by),
    createdAt: String(r?.created_at ?? ''),
  };
}

// personName renders a Procore person sub-object (or bare string) to a display
// name. Procore returns { id, name, login } for people; we take name.
function personName(p: any): string {
  if (!p) return '';
  if (typeof p === 'string') return p;
  return String(p?.name ?? p?.login ?? '');
}

// parseRFI reads a getRFI body into a typed RFI. Missing fields become '' / []
// so the UI/prompt renders predictably. The question body lives at
// `question.body`; replies at `question.rfi_replies` (Procore's key). Pure.
export function parseRFI(data: any): Rfi {
  const q = data?.question ?? {};
  const rawReplies = Array.isArray(q?.rfi_replies)
    ? q.rfi_replies
    : Array.isArray(data?.rfi_replies)
      ? data.rfi_replies
      : [];
  return {
    id: Number(data?.id ?? 0),
    number: String(data?.number ?? ''),
    subject: String(data?.subject ?? ''),
    status: String(data?.status ?? ''),
    question: {
      body: String(q?.body ?? q?.plain_text_body ?? ''),
      replies: rawReplies.map(parseReply),
    },
    ballInCourt: personName(data?.ball_in_court),
    dueDate: String(data?.due_date ?? ''),
    createdAt: String(data?.created_at ?? ''),
  };
}

// parseRFIs reads a listRFIs body into typed RFIs. The list endpoint returns the
// same shape as the detail endpoint (with the question thread), so we reuse
// parseRFI per row. Pure.
export function parseRFIs(data: any): Rfi[] {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.rfis) ? data.rfis : [];
  return rows.map(parseRFI).filter((r: Rfi) => r.id > 0);
}

// One submittal as surfaced from listSubmittals.
export interface Submittal {
  id: number;
  number: string;
  title: string;
  status: string;
  type: string;
  dueDate: string;
}

export function parseSubmittals(data: any): Submittal[] {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.submittals) ? data.submittals : [];
  return rows
    .map((s: any) => ({
      id: Number(s?.id ?? 0),
      number: String(s?.number ?? s?.formatted_number ?? ''),
      title: String(s?.title ?? ''),
      status: String(s?.status?.name ?? s?.status ?? ''),
      type: String(s?.type?.name ?? s?.type ?? ''),
      dueDate: String(s?.due_date ?? ''),
    }))
    .filter((s: Submittal) => s.id > 0);
}

// One document/folder entry from listDocuments (folders_and_files). Procore
// returns folders and files in one payload; we flatten both into a common shape
// with `isFolder` so the context assembly can list them uniformly.
export interface DocumentEntry {
  id: number;
  name: string;
  isFolder: boolean;
  updatedAt: string;
}

export function parseDocuments(data: any): DocumentEntry[] {
  const folders = Array.isArray(data?.folders) ? data.folders : [];
  const files = Array.isArray(data?.files) ? data.files : [];
  const bare = Array.isArray(data) ? data : [];
  const map =
    (isFolder: boolean) =>
    (d: any): DocumentEntry => ({
      id: Number(d?.id ?? 0),
      name: String(d?.name ?? ''),
      isFolder,
      updatedAt: String(d?.updated_at ?? ''),
    });
  return [...folders.map(map(true)), ...files.map(map(false)), ...bare.map(map(false))].filter(
    (d) => d.id > 0 && d.name.length > 0,
  );
}

// One observation item from listObservations.
export interface Observation {
  id: number;
  name: string;
  status: string;
  priority: string;
  description: string;
}

export function parseObservations(data: any): Observation[] {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.observations) ? data.observations : [];
  return rows
    .map((o: any) => ({
      id: Number(o?.id ?? 0),
      name: String(o?.name ?? ''),
      status: String(o?.status ?? ''),
      priority: String(o?.priority ?? ''),
      description: String(o?.description ?? ''),
    }))
    .filter((o: Observation) => o.id > 0);
}

// One daily-log note from listDailyLogs.
export interface DailyLogNote {
  id: number;
  date: string;
  comment: string;
  createdBy: string;
}

export function parseDailyLogs(data: any): DailyLogNote[] {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.notes_logs) ? data.notes_logs : [];
  return rows
    .map((n: any) => ({
      id: Number(n?.id ?? 0),
      date: String(n?.date ?? n?.log_date ?? ''),
      comment: String(n?.comment ?? ''),
      createdBy: personName(n?.created_by),
    }))
    .filter((n: DailyLogNote) => n.id > 0);
}
