// FHIR R4 client. Every wrapper is PURE request-shaping — it returns the
// { url, method, headers } a caller will fetch, so the wire contract (path,
// `patient=` scoping, `_count`, category filters) is unit-testable without a
// network. `fhirFetch` at the bottom is the one thin place that actually hits
// the FHIR server; `bundleEntries` / `nextPageUrl` are the pure Bundle helpers
// that drive pagination.
//
// FHIR R4 conventions this encodes:
//  - Bearer token auth; Accept: application/fhir+json.
//  - A patient-context read scopes EVERY search with `patient=<id>` so the app
//    can only ever see the launched patient (defence-in-depth over the
//    `patient/*.read` scope — the server enforces it too).
//  - A search returns a `Bundle`; its resources are `entry[].resource`, and the
//    NEXT page is the `link` whose `relation` is `next` (a full, absolute URL).
//  - `_count` caps page size; we never over-fetch.

import { FHIR_RESOURCES, normalizeBase, type FhirResourceType } from './config.js';

export interface FhirRequest {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
}

// baseHeaders — auth + the FHIR JSON accept on every read. Reads only, so no
// content-type. Pure.
function baseHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/fhir+json',
  };
}

// buildQuery renders a query string from a params object, dropping undefined /
// empty values and joining array-valued params with commas (the form FHIR wants
// for multi-valued search params like `category`). Deterministic key order for
// stable tests. Pure.
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

// resourceUrl builds `<base>/<ResourceType>` (a search root) or, with an id,
// `<base>/<ResourceType>/<id>` (a single-resource read). Pure.
export function resourceUrl(base: string, type: FhirResourceType, id?: string): string {
  const root = `${normalizeBase(base)}/${FHIR_RESOURCES[type]}`;
  return id ? `${root}/${encodeURIComponent(id)}` : root;
}

// A sensible default page size. The chart-review actions want breadth, not
// depth; a page of 50 with pagination covers a real patient without a giant
// single response.
export const DEFAULT_COUNT = 50;

// ── Single-patient read ────────────────────────────────────────────────────

// getPatient reads the launched patient by id — `Patient/<id>`. The one FHIR
// read that is NOT a search (it targets the resource directly). Pure.
export function getPatient(base: string, token: string, patientId: string): FhirRequest {
  return {
    url: resourceUrl(base, 'Patient', patientId),
    method: 'GET',
    headers: baseHeaders(token),
  };
}

// ── Patient-scoped searches ────────────────────────────────────────────────

export interface SearchParams {
  base: string;
  token: string;
  patientId: string;
  count?: number;
  // A cursor: the full `next` URL from a previous Bundle. When present it is
  // used VERBATIM (it already carries the server's opaque paging state) and the
  // other params are ignored — that is how FHIR pagination works.
  pageUrl?: string;
  // Optional resource-specific filters (e.g. Observation category). Merged into
  // the query. Values are strings or string[] (comma-joined).
  extra?: Record<string, string | string[] | undefined>;
}

// searchRequest is the shared shaper for every patient-scoped search: either the
// verbatim `pageUrl` (pagination) or `<base>/<Type>?patient=<id>&_count=…&…`.
// Every search is scoped by `patient=` — the app cannot search across patients.
// Pure.
function searchRequest(type: FhirResourceType, p: SearchParams): FhirRequest {
  if (p.pageUrl) {
    return { url: p.pageUrl, method: 'GET', headers: baseHeaders(p.token) };
  }
  const query = buildQuery({
    patient: p.patientId,
    _count: p.count ?? DEFAULT_COUNT,
    ...(p.extra ?? {}),
  });
  return {
    url: `${resourceUrl(p.base, type)}${query}`,
    method: 'GET',
    headers: baseHeaders(p.token),
  };
}

// searchConditions reads the patient's problem list (Condition). Pure.
export function searchConditions(p: SearchParams): FhirRequest {
  return searchRequest('Condition', p);
}

// searchMedicationRequests reads the patient's medications (MedicationRequest).
// Pure.
export function searchMedicationRequests(p: SearchParams): FhirRequest {
  return searchRequest('MedicationRequest', p);
}

// searchAllergyIntolerances reads the patient's allergies (AllergyIntolerance).
// Pure.
export function searchAllergyIntolerances(p: SearchParams): FhirRequest {
  return searchRequest('AllergyIntolerance', p);
}

// searchObservations reads the patient's Observations (labs/vitals). `category`
// (e.g. 'laboratory', 'vital-signs') narrows the set — Epic wants a category on
// an Observation search, so it defaults to laboratory+vital-signs unless the
// caller overrides. Pure.
export function searchObservations(
  p: SearchParams & { category?: string | string[] },
): FhirRequest {
  const category = p.category ?? ['laboratory', 'vital-signs'];
  return searchRequest('Observation', {
    ...p,
    extra: { ...(p.extra ?? {}), category },
  });
}

// searchDocumentReferences reads the patient's clinical notes (DocumentReference).
// Pure.
export function searchDocumentReferences(p: SearchParams): FhirRequest {
  return searchRequest('DocumentReference', p);
}

// ── Bundle helpers (pure) ──────────────────────────────────────────────────

// A minimal FHIR R4 resource — everything carries `resourceType`; the rest is
// resource-specific and read by chart.ts.
export interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

// A FHIR searchset Bundle (only the fields we read).
export interface FhirBundle {
  resourceType: 'Bundle';
  type?: string;
  total?: number;
  entry?: Array<{ resource?: FhirResource; fullUrl?: string }>;
  link?: Array<{ relation?: string; url?: string }>;
}

// isOperationOutcome reports whether a payload is a FHIR error (OperationOutcome)
// rather than the expected resource/Bundle. Used to surface the server's real
// diagnostics. Pure.
export function isOperationOutcome(payload: unknown): boolean {
  return (payload as { resourceType?: string })?.resourceType === 'OperationOutcome';
}

// operationOutcomeMessage renders an OperationOutcome's issues into one line so a
// failure is diagnosable. Pure.
export function operationOutcomeMessage(payload: unknown): string {
  const issues = (payload as { issue?: Array<{ diagnostics?: string; details?: { text?: string }; code?: string }> })
    ?.issue;
  if (!Array.isArray(issues) || issues.length === 0) return 'FHIR OperationOutcome';
  return issues
    .map((i) => i.diagnostics || i.details?.text || i.code || 'issue')
    .join('; ');
}

// bundleEntries pulls the resources out of a searchset Bundle's `entry[]`,
// dropping entries without a resource. Returns [] for a non-Bundle (e.g. a
// single-resource read passes through unchanged via readResource, not here).
// Pure.
export function bundleEntries(bundle: unknown): FhirResource[] {
  const b = bundle as FhirBundle;
  if (!Array.isArray(b?.entry)) return [];
  return b.entry
    .map((e) => e.resource)
    .filter((r): r is FhirResource => !!r && typeof r.resourceType === 'string');
}

// nextPageUrl returns the absolute URL of the Bundle's next page — the `link`
// whose relation is `next` — or '' when this is the last page. This is the ONLY
// correct pagination cursor in FHIR (never construct it by hand). Pure.
export function nextPageUrl(bundle: unknown): string {
  const links = (bundle as FhirBundle)?.link;
  if (!Array.isArray(links)) return '';
  const next = links.find((l) => l?.relation === 'next');
  return typeof next?.url === 'string' ? next.url : '';
}

// ── The one thin network place ─────────────────────────────────────────────

// fhirFetch executes a shaped FhirRequest and returns the parsed JSON (a Bundle
// or a resource). Throws on an OperationOutcome or a non-2xx with the server's
// diagnostics, so failures are diagnosable — WITHOUT logging the body (it is
// PHI). `doFetch` is injectable (tests / non-global-fetch runtimes). NEVER logs
// the response.
export async function fhirFetch(req: FhirRequest, doFetch: typeof fetch = fetch): Promise<unknown> {
  const resp = await doFetch(req.url, { method: req.method, headers: req.headers });
  const text = await resp.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Do NOT echo the body — it may be PHI. Status + a length hint only.
    throw new Error(`FHIR ${resp.status}: non-JSON response (${text.length} bytes)`);
  }
  if (isOperationOutcome(data)) {
    throw new Error(`FHIR ${resp.status}: ${operationOutcomeMessage(data)}`);
  }
  if (!resp.ok) {
    throw new Error(`FHIR ${resp.status}: request failed`);
  }
  return data;
}

// fetchAllPages walks a patient-scoped search to completion, following the
// Bundle `next` links, and returns the flattened resources. `firstRequest` is
// the initial FhirRequest (from a search* wrapper); each subsequent page reuses
// the same bearer via `token`. A `maxPages` guard (default 20) bounds a runaway
// or hostile server. `doFetch` is injectable. Returns resources only — the
// caller never touches Bundle plumbing.
export async function fetchAllPages(
  firstRequest: FhirRequest,
  token: string,
  opts: { maxPages?: number; doFetch?: typeof fetch } = {},
): Promise<FhirResource[]> {
  const maxPages = opts.maxPages ?? 20;
  const doFetch = opts.doFetch ?? fetch;
  const out: FhirResource[] = [];
  let req: FhirRequest | null = firstRequest;
  for (let page = 0; page < maxPages && req; page++) {
    const bundle = await fhirFetch(req, doFetch);
    for (const r of bundleEntries(bundle)) out.push(r);
    const next = nextPageUrl(bundle);
    req = next ? { url: next, method: 'GET', headers: baseHeaders(token) } : null;
  }
  return out;
}
