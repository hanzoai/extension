export interface ChatLikeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MessageBudgetOptions {
  maxMessages?: number;
  maxInputTokens?: number;
}

export interface MessageBudgetResult {
  messages: ChatLikeMessage[];
  inputTokens: number;
  droppedMessages: number;
}

export interface UsageMetrics {
  periodStart: number;
  lastUpdated: number;
  chatRequests: number;
  dedupeHits: number;
  canceledRequests: number;
  inputTokens: number;
  outputTokens: number;
  errors: number;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_MAX_INPUT_TOKENS = 6000;
const USAGE_METRICS_KEY = 'hanzo_usage_metrics_v1';
const METRIC_PERIOD_MS = 60 * 60 * 1000;

let debugEnabled = false;
let queuedDelta: Partial<Omit<UsageMetrics, 'periodStart' | 'lastUpdated'>> = {};
let flushTimer: number | null = null;

export const CHAT_BUDGETS = {
  maxMessages: DEFAULT_MAX_MESSAGES,
  maxInputTokens: DEFAULT_MAX_INPUT_TOKENS,
  maxOutputTokens: 1200,
  duplicateWindowMs: 4000,
};

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(messages: ChatLikeMessage[]): number {
  return (messages || []).reduce((sum, message) => sum + estimateTextTokens(message?.content || ''), 0);
}

export function trimMessagesToBudget(
  inputMessages: ChatLikeMessage[],
  options: MessageBudgetOptions = {},
): MessageBudgetResult {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxInputTokens = options.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;

  const normalized = (inputMessages || [])
    .filter((msg) => msg && typeof msg.role === 'string' && typeof msg.content === 'string')
    .map((msg) => ({
      role: msg.role === 'system' || msg.role === 'assistant' ? msg.role : 'user',
      content: String(msg.content),
    }))
    .slice(-maxMessages);

  const keptReversed: ChatLikeMessage[] = [];
  let inputTokens = 0;
  let droppedMessages = 0;

  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    const message = normalized[i];
    const messageTokens = estimateTextTokens(message.content);
    const isNewestMessage = i === normalized.length - 1;
    const wouldOverflow = inputTokens + messageTokens > maxInputTokens;

    if (wouldOverflow && !isNewestMessage) {
      droppedMessages += 1;
      continue;
    }

    keptReversed.push(message);
    inputTokens += messageTokens;
  }

  const messages = keptReversed.reverse();
  return {
    messages,
    inputTokens,
    droppedMessages,
  };
}

export function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function makeChatRequestKey(
  model: string,
  messages: ChatLikeMessage[],
  temperature?: number,
  maxTokens?: number,
): string {
  const normalized = (messages || [])
    .map((msg) => `${msg.role}:${msg.content.replace(/\s+/g, ' ').trim()}`)
    .join('|');
  return stableHash(`${model}|${temperature ?? ''}|${maxTokens ?? ''}|${normalized}`);
}

export class InFlightRequestDeduper<T> {
  private inFlight = new Map<string, Promise<T>>();

  getOrCreate(key: string, factory: () => Promise<T>): { promise: Promise<T>; deduped: boolean } {
    const existing = this.inFlight.get(key);
    if (existing) {
      return { promise: existing, deduped: true };
    }

    const promise = factory().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return { promise, deduped: false };
  }
}

export class ActionRateLimiter {
  private lastActionAt = new Map<string, number>();

  allow(key: string, intervalMs: number): boolean {
    const now = Date.now();
    const last = this.lastActionAt.get(key) || 0;
    if (now - last < intervalMs) {
      return false;
    }
    this.lastActionAt.set(key, now);
    return true;
  }
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): (...args: Parameters<T>) => void {
  let timer: number | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
}

export async function loadDebugFlagFromStorage(): Promise<boolean> {
  if (!hasChromeStorage()) {
    return debugEnabled;
  }

  return new Promise((resolve) => {
    chrome.storage.local.get(['hanzo_debug'], (result) => {
      debugEnabled = !!result?.hanzo_debug;
      resolve(debugEnabled);
    });
  });
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    console.log(...args);
  }
}

function emptyUsageMetrics(now = Date.now()): UsageMetrics {
  return {
    periodStart: now,
    lastUpdated: now,
    chatRequests: 0,
    dedupeHits: 0,
    canceledRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    errors: 0,
  };
}

function mergeUsage(base: UsageMetrics, delta: Partial<Omit<UsageMetrics, 'periodStart' | 'lastUpdated'>>): UsageMetrics {
  const now = Date.now();
  const reset = now - base.periodStart > METRIC_PERIOD_MS ? emptyUsageMetrics(now) : base;
  return {
    ...reset,
    lastUpdated: now,
    chatRequests: reset.chatRequests + (delta.chatRequests || 0),
    dedupeHits: reset.dedupeHits + (delta.dedupeHits || 0),
    canceledRequests: reset.canceledRequests + (delta.canceledRequests || 0),
    inputTokens: reset.inputTokens + (delta.inputTokens || 0),
    outputTokens: reset.outputTokens + (delta.outputTokens || 0),
    errors: reset.errors + (delta.errors || 0),
  };
}

export async function readUsageMetrics(): Promise<UsageMetrics> {
  if (!hasChromeStorage()) {
    return emptyUsageMetrics();
  }

  return new Promise((resolve) => {
    chrome.storage.local.get([USAGE_METRICS_KEY], (result) => {
      const stored = result?.[USAGE_METRICS_KEY];
      if (!stored || typeof stored !== 'object') {
        resolve(emptyUsageMetrics());
        return;
      }
      resolve({
        ...emptyUsageMetrics(),
        ...stored,
      });
    });
  });
}

async function flushUsageDelta(): Promise<void> {
  if (!hasChromeStorage()) return;
  const delta = queuedDelta;
  queuedDelta = {};
  flushTimer = null;

  const current = await readUsageMetrics();
  const merged = mergeUsage(current, delta);
  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [USAGE_METRICS_KEY]: merged }, () => resolve());
  });
}

export async function recordUsageDelta(
  delta: Partial<Omit<UsageMetrics, 'periodStart' | 'lastUpdated'>>,
): Promise<void> {
  queuedDelta = {
    chatRequests: (queuedDelta.chatRequests || 0) + (delta.chatRequests || 0),
    dedupeHits: (queuedDelta.dedupeHits || 0) + (delta.dedupeHits || 0),
    canceledRequests: (queuedDelta.canceledRequests || 0) + (delta.canceledRequests || 0),
    inputTokens: (queuedDelta.inputTokens || 0) + (delta.inputTokens || 0),
    outputTokens: (queuedDelta.outputTokens || 0) + (delta.outputTokens || 0),
    errors: (queuedDelta.errors || 0) + (delta.errors || 0),
  };

  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    void flushUsageDelta();
  }, 1000) as unknown as number;
}

export function pickModelForTokenBudget(
  requestedModel: string,
  availableModels: string[],
  inputTokens: number,
): string {
  if (requestedModel && requestedModel !== 'auto') {
    return requestedModel;
  }

  const smallModelOrder = [
    'zen-coder-flash',
    'gpt-4o-mini',
    'claude-3-5-haiku-latest',
    'claude-3-5-haiku',
    'gemini-2.0-flash',
  ];
  const largeModelOrder = [
    'gpt-4o',
    'claude-sonnet-4-20250514',
    'claude-opus-4-20250514',
    'zen-max',
  ];

  const pickFirstExisting = (names: string[]) => names.find((name) => availableModels.includes(name));

  if (inputTokens <= 900) {
    return pickFirstExisting(smallModelOrder) || availableModels[0] || 'gpt-4o-mini';
  }

  return pickFirstExisting(largeModelOrder) || availableModels[0] || 'gpt-4o';
}
