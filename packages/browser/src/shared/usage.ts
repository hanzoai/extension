// Usage engine bridge — runs the @hanzo/usage providers inside the extension
// background context, where host permissions let fetch() attach the user's
// claude.ai / chatgpt.com session cookies (credentials: 'include') and bypass
// CORS. There is no filesystem in a browser, so file ops are no-ops and the
// OAuth/CLI strategies simply report "unavailable": the web strategy carries
// Claude, and a small local fetch carries Codex (whose provider only ships an
// auth.json OAuth lane, unusable without disk access).

import {
  runPipeline,
  claudeProvider,
  codexProvider,
  type UsageHost,
  type HttpRequest,
  type HttpResponse,
  type UsageSnapshot,
  type RateWindow,
  type ProviderFetchOutcome,
} from '@hanzo/usage';

/** Serialisable per-provider result sent to the popup. */
export interface ProviderUsage {
  providerId: string;
  displayName: string;
  color?: string;
  dashboardUrl?: string;
  snapshot?: UsageSnapshot;
  /** User-facing failure reason (e.g. "Open chatgpt.com to sign in"). */
  error?: string;
}

const http = async (req: HttpRequest): Promise<HttpResponse> => {
  const controller = new AbortController();
  const timeout = req.timeoutMs
    ? setTimeout(() => controller.abort(), req.timeoutMs)
    : undefined;
  try {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
      credentials: 'include',
      signal: controller.signal,
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { status: res.status, headers, text: await res.text() };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/** Browser host: network only; no fs, env, or home directory in an extension. */
const browserHost: UsageHost = {
  readTextFile: async () => undefined,
  listDir: async () => [],
  writeTextFile: async () => {},
  http,
  env: () => undefined,
  homeDir: () => '',
  now: () => new Date(),
};

const isAuthError = (text: string): boolean => /\b(401|403)\b/.test(text);

const outcomeError = (providerHost: string, outcome: ProviderFetchOutcome): string => {
  const attempt = [...outcome.attempts].reverse().find((a) => a.error);
  const detail = attempt?.error ?? 'no data';
  return isAuthError(detail) ? `Open ${providerHost} to sign in` : detail;
};

const fetchClaude = async (): Promise<ProviderUsage> => {
  const { displayName, color, dashboardUrl } = claudeProvider.metadata;
  const base: ProviderUsage = { providerId: 'claude', displayName, color, dashboardUrl };
  try {
    // Empty cookieHeader passes the web strategy's `typeof === 'string'` gate;
    // the real session cookie is attached by credentials: 'include'.
    const outcome = await runPipeline(claudeProvider, {
      host: browserHost,
      sourceMode: 'web',
      settings: { cookieHeader: '' },
    });
    if (outcome.result) return { ...base, snapshot: outcome.result.usage };
    return { ...base, error: outcomeError('claude.ai', outcome) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
};

// Codex wire shape (chatgpt.com/backend-api/wham/usage) — mirrors the private
// interface in @hanzo/usage's codex provider, mapped onto the package's public
// UsageSnapshot / RateWindow types.
interface CodexWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}
interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: { primary_window?: CodexWindow; secondary_window?: CodexWindow };
}

const toWindow = (w: CodexWindow | undefined): RateWindow | undefined => {
  if (!w || typeof w.used_percent !== 'number') return undefined;
  return {
    usedPercent: w.used_percent,
    windowMinutes: w.limit_window_seconds ? Math.round(w.limit_window_seconds / 60) : undefined,
    resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : undefined,
  };
};

const fetchCodex = async (): Promise<ProviderUsage> => {
  const { displayName, color, dashboardUrl } = codexProvider.metadata;
  const base: ProviderUsage = { providerId: 'codex', displayName, color, dashboardUrl };
  try {
    const res = await http({
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: { Accept: 'application/json' },
      timeoutMs: 30_000,
    });
    if (res.status !== 200) {
      return {
        ...base,
        error: isAuthError(String(res.status))
          ? 'Open chatgpt.com to sign in'
          : `HTTP ${res.status}`,
      };
    }
    const body = JSON.parse(res.text) as CodexUsageResponse;
    const snapshot: UsageSnapshot = {
      providerId: 'codex',
      primary: toWindow(body.rate_limit?.primary_window),
      secondary: toWindow(body.rate_limit?.secondary_window),
      identity: { providerId: 'codex', plan: body.plan_type, loginMethod: 'web' },
      dataConfidence: 'percentOnly',
      updatedAt: browserHost.now().toISOString(),
    };
    return { ...base, snapshot };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
};

/** Fetch Claude + Codex usage in parallel from the current browser session. */
export const fetchAllUsage = async (): Promise<ProviderUsage[]> =>
  Promise.all([fetchClaude(), fetchCodex()]);
