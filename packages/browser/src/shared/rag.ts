/**
 * RAG (Retrieval-Augmented Generation) — shared across all browser targets.
 */

import type { RagSnippet, RagQueryParams } from './types.js';

const DEFAULT_RAG_TOP_K = 5;

/** Load RAG config from extension storage */
export async function getRagConfig(storage: typeof chrome.storage.local): Promise<{
  endpoint: string;
  apiKey: string;
  knowledgeBase: string;
  topK: number;
  includeTabContext: boolean;
}> {
  return new Promise((resolve) => {
    storage.get([
      'hanzo_rag_endpoint',
      'hanzo_rag_api_key',
      'hanzo_rag_kb',
      'hanzo_rag_top_k',
      'hanzo_rag_include_tab_context',
    ], (result: any) => {
      const parsedTopK = Number.parseInt(String(result.hanzo_rag_top_k ?? DEFAULT_RAG_TOP_K), 10);
      resolve({
        endpoint: String(result.hanzo_rag_endpoint || '').trim(),
        apiKey: String(result.hanzo_rag_api_key || '').trim(),
        knowledgeBase: String(result.hanzo_rag_kb || '').trim(),
        topK: Number.isFinite(parsedTopK) ? Math.max(1, Math.min(parsedTopK, 20)) : DEFAULT_RAG_TOP_K,
        includeTabContext: result.hanzo_rag_include_tab_context !== false,
      });
    });
  });
}

/** Normalize RAG snippets from various response formats */
export function normalizeRagSnippets(raw: any): RagSnippet[] {
  if (!raw) return [];

  const candidates: any[] = [];
  if (Array.isArray(raw)) candidates.push(...raw);
  if (Array.isArray(raw?.snippets)) candidates.push(...raw.snippets);
  if (Array.isArray(raw?.documents)) candidates.push(...raw.documents);
  if (Array.isArray(raw?.items)) candidates.push(...raw.items);
  if (Array.isArray(raw?.results)) candidates.push(...raw.results);
  if (Array.isArray(raw?.memories)) candidates.push(...raw.memories);
  if (Array.isArray(raw?.matches)) candidates.push(...raw.matches);

  if (!candidates.length && typeof raw?.content === 'string') {
    candidates.push({ content: raw.content, source: raw.source || 'memory' });
  }

  const snippets = candidates
    .map((item) => {
      const content = String(
        item?.content ??
        item?.text ??
        item?.snippet ??
        item?.body ??
        item?.value ??
        '',
      ).trim();
      if (!content) return null;

      return {
        content,
        title: item?.title ? String(item.title) : undefined,
        source: item?.source ? String(item.source) : undefined,
        score: typeof item?.score === 'number' ? item.score : undefined,
        url: item?.url ? String(item.url) : undefined,
      } as RagSnippet;
    })
    .filter((item): item is RagSnippet => !!item);

  return snippets.slice(0, 20);
}

/** Query RAG from HTTP endpoint */
export async function queryRagFromEndpoint(params: RagQueryParams): Promise<RagSnippet[]> {
  if (!params.endpoint) return [];

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (params.apiKey) {
    headers.Authorization = `Bearer ${params.apiKey}`;
  }

  const response = await fetch(params.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: params.query,
      top_k: params.topK,
      knowledge_base: params.knowledgeBase || undefined,
      page_context: params.includeTabContext ? params.pageContext : undefined,
      source: 'hanzo-browser-extension',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`RAG endpoint error ${response.status}: ${text || 'Unknown error'}`);
  }

  const raw = await response.json();
  return normalizeRagSnippets(raw).map((snippet) => ({
    ...snippet,
    source: snippet.source || 'rag-endpoint',
  }));
}
