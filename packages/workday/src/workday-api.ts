// Workday REST + RaaS — pure request shaping + response parsing. Every function
// returns a PreparedGet (url + headers) or parses a response body; none opens a
// socket, so the whole API surface is unit-testable without a network. server.ts
// is the thin glue that fetches these shapes with the OAuth Bearer access token.
//
// Two read surfaces, one bearer:
//   • REST — `${host}/ccx/api/{service}/{version}/{tenant}/…` (Staffing, Recruiting,
//     Absence). List endpoints paginate with `limit` + `offset` and return a
//     `{ total, data: [...] }` envelope (parsed by parseTotal / parseRestData).
//   • RaaS — `${host}/ccx/service/customreport2/{tenant}/{owner}/{report}?format=json`,
//     a customer-defined report returning `{ Report_Entry: [...] }` rows.
// Docs: developer.workday.com (REST API reference) + Workday RaaS.
//
// v1 is READ-ONLY: Workday writes (e.g. requestTimeOff, business-process
// submissions) are heavy, kick off approval workflows, and are the system of
// record — so this module exposes reads only. A gated write-back is a documented,
// deliberate future addition, not an oversight (see README).

import {
  restUrl,
  raasUrl,
  STAFFING,
  RECRUITING,
  ABSENCE,
  type WorkdayService,
} from './config.js';

// A prepared GET: url + headers a single fetch needs. Bearer + JSON accept.
export interface PreparedGet {
  url: string;
  headers: Record<string, string>;
}

// The scope every request carries: which tenant (host + name) and the bearer.
// Grouping them keeps every wrapper's signature small and the scoping impossible
// to forget.
export interface Scope {
  host: string;
  tenant: string;
  accessToken: string;
}

// headers builds the auth + accept header set common to every request.
function headers(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
}

// ---- Pagination -----------------------------------------------------------

// Workday REST paginates with `limit` (page size) + `offset` (0-based row index)
// and returns the total in the body. MAX_LIMIT is Workday's documented ceiling.
export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 100;

export interface Page {
  limit?: number;
  offset?: number;
}

// pageParams renders pagination into query pairs, clamping limit to the
// documented maximum and dropping a zero/absent offset (0 is the default). Only
// emits params that are set, so an unpaginated call stays clean. Pure.
export function pageParams(page: Page | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!page) return out;
  if (typeof page.limit === 'number' && page.limit > 0) {
    out.limit = String(Math.min(Math.floor(page.limit), MAX_LIMIT));
  }
  if (typeof page.offset === 'number' && page.offset > 0) {
    out.offset = String(Math.floor(page.offset));
  }
  return out;
}

// withQuery appends a query string to a full URL, dropping undefined/empty
// values. One place appends every query so shaping stays consistent. Pure.
function withQuery(url: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${url}?${qs}` : url;
}

// enc encodes a single path segment (Workday IDs are opaque WID hex strings, but
// we encode defensively so a stray value can never break — or traverse — the path).
function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}

// ---- REST + RaaS request builders -----------------------------------------

// restGet shapes a GET against a REST service + sub-path with the Bearer header.
export function restGet(
  scope: Scope,
  service: WorkdayService,
  sub: string,
  query: Record<string, string> = {},
): PreparedGet {
  return {
    url: withQuery(restUrl(scope.host, scope.tenant, service, sub), query),
    headers: headers(scope.accessToken),
  };
}

// raasGet shapes a GET against a custom report, forcing `format=json` so we always
// parse the Report_Entry JSON shape (never the default XML). Extra report prompt
// params (e.g. an as-of date) merge in.
export function raasGet(
  scope: Scope,
  owner: string,
  report: string,
  query: Record<string, string> = {},
): PreparedGet {
  return {
    url: withQuery(raasUrl(scope.host, scope.tenant, owner, report), { format: 'json', ...query }),
    headers: headers(scope.accessToken),
  };
}

// ---- Workers (Staffing) ---------------------------------------------------

// listWorkers — the workers in the tenant the client can see. The panel's picker
// uses this to choose which worker to run against.
export function listWorkers(scope: Scope, page?: Page): PreparedGet {
  return restGet(scope, STAFFING, '/workers', pageParams(page));
}

// getWorker — one worker's full profile (name, business title, org, job, manager).
// This is what summarize-worker / draft-review run over.
export function getWorker(scope: Scope, workerId: number | string): PreparedGet {
  return restGet(scope, STAFFING, `/workers/${enc(workerId)}`);
}

// listDirectReports — the workers who report to a given worker (team roster).
export function listDirectReports(scope: Scope, workerId: number | string, page?: Page): PreparedGet {
  return restGet(scope, STAFFING, `/workers/${enc(workerId)}/directReports`, pageParams(page));
}

// ---- Organizations (Staffing) ---------------------------------------------

// listSupervisoryOrganizations — the supervisory orgs (the manager→team tree).
export function listSupervisoryOrganizations(scope: Scope, page?: Page): PreparedGet {
  return restGet(scope, STAFFING, '/supervisoryOrganizations', pageParams(page));
}

// getSupervisoryOrganization — one org in full (manager, code, type).
export function getSupervisoryOrganization(scope: Scope, orgId: number | string): PreparedGet {
  return restGet(scope, STAFFING, `/supervisoryOrganizations/${enc(orgId)}`);
}

// ---- Job requisitions (Recruiting) ----------------------------------------

// listJobRequisitions — the open/closed requisitions (headcount demand).
export function listJobRequisitions(scope: Scope, page?: Page): PreparedGet {
  return restGet(scope, RECRUITING, '/jobRequisitions', pageParams(page));
}

// getJobRequisition — one requisition in full.
export function getJobRequisition(scope: Scope, reqId: number | string): PreparedGet {
  return restGet(scope, RECRUITING, `/jobRequisitions/${enc(reqId)}`);
}

// ---- Time off / absence (Absence Management) ------------------------------

// listEligibleAbsenceTypes — the absence/time-off types a worker is eligible for
// (the REST view of time off). Richer time-off history is typically pulled via a
// RaaS report (timeOffReport) since it is customer-configured.
export function listEligibleAbsenceTypes(
  scope: Scope,
  workerId: number | string,
  page?: Page,
): PreparedGet {
  return restGet(scope, ABSENCE, `/workers/${enc(workerId)}/eligibleAbsenceTypes`, pageParams(page));
}

// timeOffReport — a customer-defined time-off report via RaaS. `owner` is the
// report owner's username, `report` the report name; extra prompt params pass
// through (e.g. an as-of date). Returns Report_Entry rows (parseReportEntries).
export function timeOffReport(
  scope: Scope,
  owner: string,
  report: string,
  params: Record<string, string> = {},
): PreparedGet {
  return raasGet(scope, owner, report, params);
}

// ---- Response parsing -----------------------------------------------------
//
// Workday REST responses use `descriptor` for the human label and `id` for the
// WID, with nested references as `{ id, descriptor }`. We normalize the fields we
// surface into small typed shapes at this one boundary so nothing downstream
// touches the wire.

// ref renders a Workday reference (or bare string) to its display label.
function ref(x: any): string {
  if (!x) return '';
  if (typeof x === 'string') return x;
  return String(x.descriptor ?? x.name ?? '');
}

// parseTotal reads the `total` count Workday returns in a list envelope body.
// Returns 0 for a missing/unparseable value. Pure.
export function parseTotal(data: any): number {
  const n = Number(data?.total);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// parseRestData reads the `data` array from a `{ total, data }` envelope, also
// tolerating a bare array. Pure.
export function parseRestData(data: any): any[] {
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

// One worker as surfaced from getWorker / listWorkers.
export interface Worker {
  id: string;
  name: string;
  businessTitle: string;
  email: string;
  isManager: boolean;
  jobTitle: string;
  organization: string;
  location: string;
  managerName: string;
}

export function parseWorker(d: any): Worker {
  const primaryJob = d?.primaryJob ?? {};
  return {
    id: String(d?.id ?? ''),
    name: ref(d),
    businessTitle: String(d?.businessTitle ?? ''),
    email: String(d?.primaryWorkEmail ?? ''),
    isManager: d?.isManager === true,
    jobTitle: ref(primaryJob?.jobProfile) || ref(primaryJob),
    organization: ref(d?.primarySupervisoryOrganization) || ref(d?.supervisoryOrganization),
    location: ref(primaryJob?.location) || ref(d?.location),
    managerName: ref(primaryJob?.manager) || ref(d?.manager),
  };
}

export function parseWorkers(data: any): Worker[] {
  return parseRestData(data)
    .map(parseWorker)
    .filter((w: Worker) => w.id.length > 0);
}

// One supervisory organization.
export interface Organization {
  id: string;
  name: string;
  code: string;
  type: string;
  managerName: string;
}

export function parseOrganization(d: any): Organization {
  return {
    id: String(d?.id ?? ''),
    name: ref(d),
    code: String(d?.code ?? d?.organizationCode ?? d?.referenceID ?? ''),
    type: ref(d?.organizationType) || String(d?.type ?? ''),
    managerName: ref(d?.manager),
  };
}

export function parseOrganizations(data: any): Organization[] {
  return parseRestData(data)
    .map(parseOrganization)
    .filter((o: Organization) => o.id.length > 0);
}

// One job requisition.
export interface JobRequisition {
  id: string;
  name: string;
  title: string;
  status: string;
  openings: number;
  location: string;
  startDate: string;
}

export function parseJobRequisition(d: any): JobRequisition {
  return {
    id: String(d?.id ?? ''),
    name: ref(d),
    title: String(d?.jobPostingTitle ?? d?.title ?? ''),
    status: ref(d?.jobRequisitionStatus) || String(d?.status ?? ''),
    openings: Number(d?.numberOfOpenings ?? 0) || 0,
    location: ref(d?.primaryLocation) || ref(d?.location),
    startDate: String(d?.recruitingStartDate ?? ''),
  };
}

export function parseJobRequisitions(data: any): JobRequisition[] {
  return parseRestData(data)
    .map(parseJobRequisition)
    .filter((r: JobRequisition) => r.id.length > 0);
}

// One eligible absence/time-off type.
export interface AbsenceType {
  id: string;
  name: string;
}

export function parseAbsenceTypes(data: any): AbsenceType[] {
  return parseRestData(data)
    .map((d: any) => ({ id: String(d?.id ?? ''), name: ref(d) }))
    .filter((a: AbsenceType) => a.name.length > 0 || a.id.length > 0);
}

// ---- RaaS Report_Entry ----------------------------------------------------

// A report row: a flat map of column label → string value. RaaS columns are
// report-defined, so rows are generic rather than typed.
export type ReportRow = Record<string, string>;

// stringifyCell renders one RaaS cell to a string, taking the Descriptor/ID off a
// nested reference object and joining arrays. Pure.
function stringifyCell(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(stringifyCell).filter((s) => s.length > 0).join(', ');
  if (typeof v === 'object') {
    return String(v.Descriptor ?? v.descriptor ?? v.ID ?? v.id ?? v.value ?? JSON.stringify(v));
  }
  return String(v);
}

// flattenEntry turns one Report_Entry object into a flat ReportRow. Pure.
export function flattenEntry(row: any): ReportRow {
  const out: ReportRow = {};
  if (!row || typeof row !== 'object') return out;
  for (const [k, v] of Object.entries(row)) out[k] = stringifyCell(v);
  return out;
}

// parseReportEntries reads a RaaS `{ Report_Entry: [...] }` body (or a bare array)
// into flat rows. Pure.
export function parseReportEntries(data: any): ReportRow[] {
  const rows = Array.isArray(data?.Report_Entry)
    ? data.Report_Entry
    : Array.isArray(data)
      ? data
      : [];
  return rows.map(flattenEntry);
}
