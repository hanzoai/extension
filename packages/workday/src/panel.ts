// Browser-side panel helpers — PURE where it counts (launch-context parsing +
// proxy-request shaping), so the impure DOM wiring in app.ts stays thin and the
// logic is unit-tested. The panel reaches Workday ONLY through the server proxy
// (same-origin semantic routes under /proxy/*), which injects the OAuth Bearer +
// refreshes it and owns the tenant/host; the browser never holds a Workday token
// and never needs to know the tenant name.
//
// The proxy exposes RESOURCE routes (/proxy/workers, /proxy/organizations, …), not
// raw Workday paths, so the tenant address stays server-side. This module maps
// each resource route to its response parser.

import {
  parseWorkers,
  parseWorker,
  parseOrganizations,
  parseOrganization,
  parseJobRequisitions,
  parseAbsenceTypes,
  parseReportEntries,
  parseTotal,
  pageParams,
  type Worker,
  type Organization,
  type JobRequisition,
  type AbsenceType,
  type ReportRow,
  type Page,
} from './workday-api.js';

// The panel launch context: an optional deep-link to a worker or organization in
// the URL query. Both are optional — without them the user picks from the list.
export interface LaunchContext {
  workerId: string;
  organizationId: string;
}

// parseLaunchContext reads worker_id / organization_id from a location search
// string, accepting camelCase fallbacks. Pure — unit-tested with plain strings.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  return {
    workerId: q.get('worker_id') ?? q.get('workerId') ?? '',
    organizationId: q.get('organization_id') ?? q.get('organizationId') ?? '',
  };
}

// The panel's Workday client: reads through the same-origin server proxy. Each
// call rides the session cookie (credentials: 'include'); the proxy injects the
// Bearer + the tenant address. Pure over an injected fetch + base, so request
// shaping is unit-testable.
export interface ProxyClient {
  listWorkers(page?: Page): Promise<{ items: Worker[]; total: number }>;
  getWorker(workerId: number | string): Promise<Worker>;
  listDirectReports(workerId: number | string, page?: Page): Promise<{ items: Worker[]; total: number }>;
  listOrganizations(page?: Page): Promise<{ items: Organization[]; total: number }>;
  getOrganization(orgId: number | string): Promise<Organization>;
  listRequisitions(page?: Page): Promise<{ items: JobRequisition[]; total: number }>;
  listAbsenceTypes(workerId: number | string, page?: Page): Promise<{ items: AbsenceType[]; total: number }>;
  report(owner: string, name: string, params?: Record<string, string>): Promise<ReportRow[]>;
}

export interface ProxyClientOptions {
  /** Proxy base (defaults to same-origin ''). The resource route is appended after /proxy. */
  base?: string;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

// proxyUrl builds a same-origin proxy URL for a resource route + query. Normalizes
// the base (drops a trailing slash) so this is the ONE place base+route joining
// happens. Kept small and pure so tests assert the exact shape
// (…/proxy/workers?limit=…&offset=…).
export function proxyUrl(base: string, route: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `${base.replace(/\/+$/, '')}/proxy${route}${qs ? `?${qs}` : ''}`;
}

// createProxyClient returns a ProxyClient over the same-origin proxy. The cookie
// credentials are attached once here so every method stays a one-liner.
export function createProxyClient(opts: ProxyClientOptions = {}): ProxyClient {
  const base = opts.base ?? ''; // proxyUrl normalizes the trailing slash
  const doFetch = opts.fetch ?? fetch;

  async function getJson(route: string, query: Record<string, string>): Promise<any> {
    const resp = await doFetch(proxyUrl(base, route, query), { credentials: 'include' });
    if (!resp.ok) throw new Error(await proxyError(resp));
    return resp.json();
  }

  return {
    async listWorkers(page?) {
      const data = await getJson('/workers', pageParams(page));
      return { items: parseWorkers(data), total: parseTotal(data) };
    },
    async getWorker(workerId) {
      return parseWorker(await getJson(`/workers/${enc(workerId)}`, {}));
    },
    async listDirectReports(workerId, page?) {
      const data = await getJson(`/workers/${enc(workerId)}/directReports`, pageParams(page));
      return { items: parseWorkers(data), total: parseTotal(data) };
    },
    async listOrganizations(page?) {
      const data = await getJson('/organizations', pageParams(page));
      return { items: parseOrganizations(data), total: parseTotal(data) };
    },
    async getOrganization(orgId) {
      return parseOrganization(await getJson(`/organizations/${enc(orgId)}`, {}));
    },
    async listRequisitions(page?) {
      const data = await getJson('/requisitions', pageParams(page));
      return { items: parseJobRequisitions(data), total: parseTotal(data) };
    },
    async listAbsenceTypes(workerId, page?) {
      const data = await getJson(`/workers/${enc(workerId)}/absenceTypes`, pageParams(page));
      return { items: parseAbsenceTypes(data), total: parseTotal(data) };
    },
    async report(owner, name, params = {}) {
      return parseReportEntries(await getJson(`/report/${enc(owner)}/${enc(name)}`, params));
    },
  };
}

// proxyError extracts a readable message from a non-2xx proxy response.
async function proxyError(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return `Workday proxy ${resp.status}: ${j?.error || j?.message || text.slice(0, 200)}`;
  } catch {
    return `Workday proxy ${resp.status}: ${text.slice(0, 200) || 'request failed'}`;
  }
}

function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}
