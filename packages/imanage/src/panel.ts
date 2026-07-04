// Browser-side panel helpers — PURE where it counts (launch-context parsing +
// proxy-request shaping), so the impure DOM wiring in app.ts stays thin and the
// logic is unit-tested. The panel reaches iManage ONLY through the server proxy
// (same-origin /proxy/*), which injects the OAuth token (X-Auth-Token) and
// refreshes it; the browser never holds an iManage token.
//
// The customer + library scope lives in the PATH the browser builds (iManage's
// paths are /customers/{cid}/libraries/{lib}/...), so the proxy simply prepends the
// Work API base and forwards. libBase + enc are reused from imanage-api so the
// panel and the server-side wrappers build the exact same relative paths.

import {
  parseWorkspaces,
  parseWorkspaceDetail,
  parseFolderChildren,
  parseDocument,
  parseSearchResults,
  parsePaging,
  pageParams,
  libBase,
  enc,
  type Workspace,
  type DocumentEntry,
  type FolderChildren,
  type Paging,
  type Page,
} from './imanage-api.js';
import { extractText, type ExtractedText } from './documents.js';

// The iManage launch context: when a linked/embedded app opens from Work it can
// pass the customer, library, and (optionally) a workspace or document in the URL
// query. The panel reads them so it opens already scoped. All optional — without
// them the user enters the customer/library and picks from the workspace list.
export interface LaunchContext {
  customerId: string;
  libraryId: string;
  workspaceId: string;
  documentId: string;
}

// parseLaunchContext reads the scope ids from a location search string, accepting
// snake_case and camelCase keys. Pure — unit-tested with plain strings.
export function parseLaunchContext(search: string): LaunchContext {
  const q = new URLSearchParams(search);
  const get = (a: string, b: string) => q.get(a) ?? q.get(b) ?? '';
  return {
    customerId: get('customer_id', 'customerId'),
    libraryId: get('library_id', 'libraryId'),
    workspaceId: get('workspace_id', 'workspaceId'),
    documentId: get('document_id', 'documentId'),
  };
}

// The panel's iManage client: reads through the same-origin server proxy. Every
// call builds a customer/library-scoped path and rides the session cookie
// (credentials: 'include'). Pure over an injected fetch + base, so request shaping
// is unit-testable.
export interface ProxyClient {
  listWorkspaces(page?: Page): Promise<{ items: Workspace[]; paging: Paging }>;
  getWorkspace(workspaceId: string): Promise<Workspace>;
  listFolderChildren(folderId: string, page?: Page): Promise<{ items: FolderChildren; paging: Paging }>;
  getDocument(documentId: string): Promise<DocumentEntry>;
  getDocumentContent(documentId: string): Promise<ExtractedText>;
  search(query: string, page?: Page): Promise<{ items: DocumentEntry[]; paging: Paging }>;
  updateDocumentProfile(documentId: string, patch: Record<string, unknown>): Promise<void>;
}

export interface ProxyClientOptions {
  /** Customer + library scope — woven into every request path. */
  customerId: string;
  libraryId: string;
  /** Proxy base (defaults to same-origin ''). The REST path is appended after /proxy. */
  base?: string;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
}

// proxyUrl builds a same-origin proxy URL for a REST path + query. Normalizes the
// base (drops a trailing slash) so this is the ONE place base+path joining happens.
// Kept small and pure so tests assert the exact shape
// (…/proxy/customers/1/libraries/ACTIVE_US/workspaces?limit=…).
export function proxyUrl(base: string, restPath: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, v);
  const qs = q.toString();
  return `${base.replace(/\/+$/, '')}/proxy${restPath}${qs ? `?${qs}` : ''}`;
}

// createProxyClient returns a ProxyClient bound to a customer/library scope. The
// cookie credentials are attached once here so every method stays a one-liner and
// the scoping is impossible to forget.
export function createProxyClient(opts: ProxyClientOptions): ProxyClient {
  const base = opts.base ?? ''; // proxyUrl normalizes the trailing slash
  const doFetch = opts.fetch ?? fetch;
  const scope = { customerId: opts.customerId, libraryId: opts.libraryId };
  const lib = libBase(scope); // /customers/{cid}/libraries/{lib}

  async function getJson(
    restPath: string,
    query: Record<string, string>,
    offset = 0,
  ): Promise<{ data: any; paging: Paging }> {
    const resp = await doFetch(proxyUrl(base, restPath, query), { credentials: 'include' });
    if (!resp.ok) throw new Error(await proxyError(resp));
    const body = await resp.json();
    const returned = Array.isArray(body?.data) ? body.data.length : Array.isArray(body) ? body.length : 0;
    return { data: body, paging: parsePaging(body, returned, offset) };
  }

  return {
    async listWorkspaces(page?: Page) {
      const { data, paging } = await getJson(`${lib}/workspaces`, pageParams(page), page?.offset ?? 0);
      return { items: parseWorkspaces(data), paging };
    },
    async getWorkspace(workspaceId: string) {
      const { data } = await getJson(`${lib}/workspaces/${enc(workspaceId)}`, {});
      return parseWorkspaceDetail(data);
    },
    async listFolderChildren(folderId: string, page?: Page) {
      const { data, paging } = await getJson(
        `${lib}/folders/${enc(folderId)}/children`,
        pageParams(page),
        page?.offset ?? 0,
      );
      return { items: parseFolderChildren(data), paging };
    },
    async getDocument(documentId: string) {
      const { data } = await getJson(`${lib}/documents/${enc(documentId)}`, {});
      return parseDocument(data);
    },
    async getDocumentContent(documentId: string) {
      const resp = await doFetch(proxyUrl(base, `${lib}/documents/${enc(documentId)}/download`), {
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(await proxyError(resp));
      return extractText(await resp.text());
    },
    async search(query: string, page?: Page) {
      const { data, paging } = await getJson(
        `${lib}/documents/search`,
        { q: query, ...pageParams(page) },
        page?.offset ?? 0,
      );
      return { items: parseSearchResults(data), paging };
    },
    async updateDocumentProfile(documentId: string, patch: Record<string, unknown>) {
      const resp = await doFetch(proxyUrl(base, `${lib}/documents/${enc(documentId)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ data: patch }),
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
    return `iManage proxy ${resp.status}: ${j?.error || j?.message || text.slice(0, 200)}`;
  } catch {
    return `iManage proxy ${resp.status}: ${text.slice(0, 200) || 'request failed'}`;
  }
}
