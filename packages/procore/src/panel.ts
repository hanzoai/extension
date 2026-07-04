// Browser-side panel helpers — PURE where it counts (launch-context parsing +
// proxy-request shaping), so the impure DOM wiring in app.ts stays thin and the
// logic is unit-tested. The panel reaches Procore ONLY through the server proxy
// (config: same-origin /proxy/*), which injects the OAuth Bearer + refreshes it;
// the browser never holds a Procore token.

import {
  parseProjects,
  parseRFIs,
  parseRFI,
  parseDocuments,
  parseSubmittals,
  parseObservations,
  parseDailyLogs,
  parseTotal,
  pageParams,
  type ProjectSummary,
  type Rfi,
  type DocumentEntry,
  type Submittal,
  type Observation,
  type DailyLogNote,
  type Page,
} from './procore-api.js';

// The Procore launch context: when Procore opens an embedded/linked app it passes
// the company and (for a project-tool app) the project in the URL query. The
// panel reads them so it opens already scoped. Both are optional — without them
// the user picks from the project list.
export interface LaunchContext {
  companyId: string;
  projectId: string;
}

// parseLaunchContext reads company_id / project_id from a location search string.
// Accepts Procore's snake_case keys. Pure — unit-tested with plain strings.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  return {
    companyId: q.get('company_id') ?? q.get('companyId') ?? '',
    projectId: q.get('project_id') ?? q.get('projectId') ?? '',
  };
}

// The panel's Procore client: reads through the same-origin server proxy. Every
// call carries the company id in the `Procore-Company-Id` header (the proxy
// forwards it to Procore) and rides the session cookie (credentials: 'include').
// Pure over an injected fetch + base, so request shaping is unit-testable.
export interface ProxyClient {
  listProjects(page?: Page): Promise<{ items: ProjectSummary[]; total: number }>;
  listRFIs(projectId: number | string, page?: Page): Promise<{ items: Rfi[]; total: number }>;
  getRFI(projectId: number | string, rfiId: number | string): Promise<Rfi>;
  listSubmittals(projectId: number | string, page?: Page): Promise<{ items: Submittal[]; total: number }>;
  listDocuments(projectId: number | string, page?: Page): Promise<{ items: DocumentEntry[]; total: number }>;
  listObservations(projectId: number | string, page?: Page): Promise<{ items: Observation[]; total: number }>;
  listDailyLogs(projectId: number | string, logDate: string, page?: Page): Promise<{ items: DailyLogNote[]; total: number }>;
  createReply(projectId: number | string, rfiId: number | string, body: string): Promise<void>;
}

export interface ProxyClientOptions {
  /** Company scope — sent as the Procore-Company-Id header on every request. */
  companyId: string;
  /** Proxy base (defaults to same-origin ''). The REST path is appended after /proxy. */
  base?: string;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

// proxyUrl builds a same-origin proxy URL for a REST path + query. Normalizes the
// base (drops a trailing slash) so this is the ONE place base+path joining
// happens. Kept small and pure so tests assert the exact shape
// (…/proxy/projects?company_id=…&page=…).
export function proxyUrl(base: string, restPath: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `${base.replace(/\/+$/, '')}/proxy${restPath}${qs ? `?${qs}` : ''}`;
}

// createProxyClient returns a ProxyClient bound to a company scope. The company
// header and cookie credentials are attached once here so every method stays a
// one-liner and the scoping is impossible to forget.
export function createProxyClient(opts: ProxyClientOptions): ProxyClient {
  const base = opts.base ?? ''; // proxyUrl normalizes the trailing slash
  const doFetch = opts.fetch ?? fetch;
  const companyId = opts.companyId;
  const commonHeaders = { 'Procore-Company-Id': companyId };

  async function getJson(restPath: string, query: Record<string, string>): Promise<{ data: any; total: number }> {
    const resp = await doFetch(proxyUrl(base, restPath, query), {
      headers: commonHeaders,
      credentials: 'include',
    });
    if (!resp.ok) throw new Error(await proxyError(resp));
    return { data: await resp.json(), total: parseTotal(resp.headers) };
  }

  return {
    async listProjects(page?: Page) {
      const { data, total } = await getJson('/projects', { company_id: companyId, ...pageParams(page) });
      return { items: parseProjects(data), total };
    },
    async listRFIs(projectId, page?) {
      const { data, total } = await getJson(`/projects/${enc(projectId)}/rfis`, pageParams(page));
      return { items: parseRFIs(data), total };
    },
    async getRFI(projectId, rfiId) {
      const { data } = await getJson(`/projects/${enc(projectId)}/rfis/${enc(rfiId)}`, {});
      return parseRFI(data);
    },
    async listSubmittals(projectId, page?) {
      const { data, total } = await getJson(`/projects/${enc(projectId)}/submittals`, pageParams(page));
      return { items: parseSubmittals(data), total };
    },
    async listDocuments(projectId, page?) {
      const { data, total } = await getJson('/folders_and_files', {
        project_id: String(projectId),
        ...pageParams(page),
      });
      return { items: parseDocuments(data), total };
    },
    async listObservations(projectId, page?) {
      const { data, total } = await getJson('/observations/items', {
        project_id: String(projectId),
        ...pageParams(page),
      });
      return { items: parseObservations(data), total };
    },
    async listDailyLogs(projectId, logDate, page?) {
      const { data, total } = await getJson(`/projects/${enc(projectId)}/daily_logs/notes_logs`, {
        log_date: logDate,
        ...pageParams(page),
      });
      return { items: parseDailyLogs(data), total };
    },
    async createReply(projectId, rfiId, body) {
      const resp = await doFetch(proxyUrl(base, `/projects/${enc(projectId)}/rfis/${enc(rfiId)}/replies`), {
        method: 'POST',
        headers: { ...commonHeaders, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rfi_reply: { body } }),
      });
      if (!resp.ok) throw new Error(await proxyError(resp));
    },
  };
}

// proxyError extracts a readable message from a non-2xx proxy response.
async function proxyError(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  try {
    const j = JSON.parse(text);
    return `Procore proxy ${resp.status}: ${j?.error || j?.message || text.slice(0, 200)}`;
  } catch {
    return `Procore proxy ${resp.status}: ${text.slice(0, 200) || 'request failed'}`;
  }
}

function enc(segment: number | string): string {
  return encodeURIComponent(String(segment));
}
