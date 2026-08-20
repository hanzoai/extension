/**
 * Shared types for Chrome/Firefox/Safari background scripts.
 */

export interface ControlSession {
  active: boolean;
  tabId: number | null;
  task: string | null;
  startedAt: number | null;
}

export interface RagSnippet {
  content: string;
  title?: string;
  source?: string;
  score?: number;
  url?: string;
}

export interface RagQueryParams {
  query: string;
  topK: number;
  knowledgeBase: string;
  includeTabContext: boolean;
  endpoint: string;
  apiKey: string;
  pageContext?: {
    url?: string;
    title?: string;
  };
}
