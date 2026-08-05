/**
 * The EXTERNAL search fallback.
 *
 * Hanzo's own answer engine requires an IAM identity and a funded account — /v1/ask
 * answers 401 "sign in to ask" to anyone else. That is correct for a metered
 * product and wrong as the whole behaviour of a NEW TAB: the extension replaces the
 * browser's search surface, so a signed-out user typing a query and getting a
 * sign-in card has been handed a broken address bar, not a paywall.
 *
 * So a query always resolves. Signed in, it goes to Hanzo. Otherwise it goes to the
 * configured provider. Nothing about the fallback is a Hanzo call: no token, no
 * telemetry, no proxy — the query goes straight from the user's browser to the
 * engine they chose, exactly as it would with no extension installed.
 */

export interface SearchProvider {
  id: string;
  label: string;
  /** Builds the provider's results URL for a raw (unencoded) query. */
  url(query: string): string;
}

/**
 * DuckDuckGo is the DEFAULT deliberately: the fallback runs for people who are NOT
 * signed in, so it is the one path where we hand a query to a third party on behalf
 * of someone who has no account with us. The default should therefore be the engine
 * that profiles them least, not the one with the largest share. Every other engine
 * here is one setting away.
 */
export const PROVIDERS: readonly SearchProvider[] = [
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'google',
    label: 'Google',
    url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'brave',
    label: 'Brave Search',
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'startpage',
    label: 'Startpage',
    url: (q) => `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
  },
  {
    id: 'bing',
    label: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
] as const;

export const DEFAULT_PROVIDER_ID = 'duckduckgo';

/** Storage key for the user's chosen fallback engine. */
export const PROVIDER_STORAGE_KEY = 'hanzo_config_fallback_search';

export function providerById(id: string | null | undefined): SearchProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

/**
 * The URL a query falls back to. An empty/whitespace query returns the empty string
 * rather than a provider URL for "" — navigating to a bare results page for nothing
 * is worse than staying put.
 */
export function fallbackUrl(providerId: string | null | undefined, query: string): string {
  const q = query.trim();
  if (!q) return '';
  return providerById(providerId).url(q);
}

/**
 * Reads the configured provider id from extension storage. Any failure — no storage,
 * a rejected read, a value naming an engine we do not ship — resolves to the default
 * rather than throwing: this sits directly in the path of "the user pressed enter",
 * and that must never end in an exception.
 */
export async function loadProviderId(storage?: {
  get(keys: string[]): Promise<Record<string, unknown>>;
}): Promise<string> {
  try {
    const s =
      storage ??
      ((globalThis as any).browser?.storage?.local ?? (globalThis as any).chrome?.storage?.local);
    if (!s) return DEFAULT_PROVIDER_ID;
    const got = await s.get([PROVIDER_STORAGE_KEY]);
    const raw = got?.[PROVIDER_STORAGE_KEY];
    return typeof raw === 'string' && PROVIDERS.some((p) => p.id === raw)
      ? raw
      : DEFAULT_PROVIDER_ID;
  } catch {
    return DEFAULT_PROVIDER_ID;
  }
}
