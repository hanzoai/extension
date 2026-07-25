/**
 * Realtime news / world feed for the Hanzo answer engine.
 *
 * ONE provider interface, two implementations:
 *   - `hanzo`  — the Hanzo cloud feed (api.hanzo.ai). This is the intended
 *     source; the cloud endpoint does not exist yet (see the Scira→clients/ai
 *     capability-port plan), so it is the clearly-marked SEAM. When cloud ships
 *     a news endpoint, set DEFAULT_FEED = 'hanzo' and nothing else changes.
 *   - `hackernews` — a real, keyless, CORS-open live feed (Hacker News via the
 *     Algolia API). The working default today. NOT a fabricated feed.
 */

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  points?: number;
  comments?: number;
  author?: string;
}

export interface FeedProvider {
  id: string;
  label: string;
  fetch(signal?: AbortSignal): Promise<NewsItem[]>;
}

/** Real live feed — Hacker News front page (keyless, `access-control-allow-origin: *`). */
const hackerNews: FeedProvider = {
  id: "hackernews",
  label: "Top stories",
  async fetch(signal) {
    const res = await fetch(
      "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12",
      signal ? { signal } : {},
    );
    if (!res.ok) throw new Error(`news ${res.status}`);
    const data = (await res.json()) as { hits?: Array<Record<string, unknown>> };
    return (data.hits ?? [])
      .map((h) => ({
        title: String(h.title ?? ""),
        url: String(h.url ?? ""),
        source: "Hacker News",
        points: typeof h.points === "number" ? h.points : undefined,
        comments: typeof h.num_comments === "number" ? h.num_comments : undefined,
        author: typeof h.author === "string" ? h.author : undefined,
      }))
      .filter((n) => n.title && n.url);
  },
};

/**
 * The Hanzo cloud feed SEAM. Wire to `GET api.hanzo.ai/v1/news` once the cloud
 * capability port lands; until then it throws so callers fall back to the real
 * feed above. Kept here so the swap is one line (DEFAULT_FEED = 'hanzo').
 */
export function hanzoFeed(apiBase: string, getToken: () => Promise<string | null>): FeedProvider {
  return {
    id: "hanzo",
    label: "Hanzo News",
    async fetch(signal) {
      const token = await getToken();
      const res = await fetch(`${apiBase}/v1/news`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new Error(`hanzo news ${res.status}`);
      const data = (await res.json()) as { items?: NewsItem[] };
      return data.items ?? [];
    },
  };
}

/** Active feed. Flip to 'hanzo' when the cloud news endpoint ships. */
export const DEFAULT_FEED = "hackernews";

export async function fetchNews(signal?: AbortSignal): Promise<NewsItem[]> {
  try {
    return await hackerNews.fetch(signal);
  } catch {
    return [];
  }
}
