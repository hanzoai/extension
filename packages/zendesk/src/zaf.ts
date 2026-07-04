// The ZAF adapter — the ONE impure boundary that talks to the Zendesk host.
// Everything Zendesk-specific lives here: init, reading ticket context, writing
// back into the reply editor, and turning the SECURE Hanzo key into a `fetch`
// that @hanzo/ai can use without the key ever reaching the browser.
//
// ZAFClient is a global injected by the CDN script in iframe.html; we declare it
// rather than bundle it (Zendesk hosts the SDK). This module is thin: no message
// shaping, no model logic — that is hanzo.ts (pure) and ticket.ts (pure).

import { API_BASE_URL, APIKEY_SETTING, MODEL_SETTING, DEFAULT_MODEL } from './config.js';
import type { TicketComment, TicketInput } from './ticket.js';

/** The subset of the ZAF client we use. Promise-based, per ZAF v2. */
export interface ZafClient {
  get(paths: string | string[]): Promise<Record<string, unknown>>;
  set(path: string, value: unknown): Promise<unknown>;
  invoke(name: string, ...args: unknown[]): Promise<unknown>;
  metadata(): Promise<{ settings?: Record<string, unknown> } & Record<string, unknown>>;
  request(options: ZafRequestOptions): Promise<unknown>;
}

/** Options for ZAF `client.request` — a host-proxied HTTP call. `secure: true`
 *  makes the host substitute `{{setting.NAME}}` placeholders server-side. */
export interface ZafRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  data?: string;
  contentType?: string;
  secure?: boolean;
  httpCompleteResponse?: boolean;
}

/** The ZAFClient global from the Zendesk-hosted SDK (loaded in iframe.html). */
declare const ZAFClient: { init(): ZafClient };

/** Initialize the ZAF client for this iframe. */
export function initZaf(): ZafClient {
  return ZAFClient.init();
}

/** Coerce an unknown ZAF value to a trimmed string. */
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Normalize the raw `ticket.comments` array into typed {@link TicketComment}s.
 *  Exported so its mapping is unit-testable without a live ZAF host. */
export function normalizeComments(raw: unknown): TicketComment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const author = (o.author ?? null) as { name?: unknown } | null;
    return {
      value: typeof o.value === 'string' ? o.value : '',
      author: author && typeof author.name === 'string' ? { name: author.name } : null,
      public: typeof o.public === 'boolean' ? o.public : true,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : undefined,
    };
  });
}

/** Read the current ticket's subject, requester name, and comments in ONE round
 *  trip. Returns the pure {@link TicketInput} that ticket.buildContext windows. */
export async function getTicketContext(client: ZafClient): Promise<TicketInput> {
  const data = await client.get(['ticket.subject', 'ticket.requester.name', 'ticket.comments']);
  return {
    subject: str(data['ticket.subject']),
    requesterName: str(data['ticket.requester.name']),
    comments: normalizeComments(data['ticket.comments']),
  };
}

/** Append text into the current comment editor as plain text (does not replace
 *  what the agent already typed). This is the reply write-back. */
export function appendReply(client: ZafClient, text: string): Promise<unknown> {
  return client.invoke('ticket.comment.appendText', text);
}

/** Switch the editor between a public reply and an internal note before/after a
 *  write-back, so a summary can land as a note while a draft lands as a reply. */
export function setCommentType(client: ZafClient, type: 'publicReply' | 'internalNote'): Promise<unknown> {
  return client.set('ticket.comment.type', type);
}

/** Read the installer's chosen model (a non-secure setting), falling back to the
 *  default. The Hanzo KEY is secure and deliberately NOT read here — it never
 *  reaches the browser (see {@link secureFetch}). */
export async function getModel(client: ZafClient): Promise<string> {
  try {
    const meta = await client.metadata();
    return str(meta.settings?.[MODEL_SETTING]) || DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/** True when the app has a Hanzo key configured. The secure value itself is not
 *  readable, but the host reports whether a secure setting is SET via a boolean
 *  in `metadata().settings` (the key name with no value). Used to prompt the
 *  installer if it's missing. */
export async function hasApiKey(client: ZafClient): Promise<boolean> {
  try {
    const meta = await client.metadata();
    return APIKEY_SETTING in (meta.settings ?? {});
  } catch {
    return false;
  }
}

/**
 * A `fetch` implementation backed by ZAF `client.request`, so @hanzo/ai talks to
 * api.hanzo.ai through the Zendesk proxy. The Hanzo key is injected server-side
 * via the `{{setting.hanzo_api_key}}` placeholder with `secure: true` — the real
 * key never reaches the browser or this code. This is what lets us USE the
 * published headless client while keeping the secret in ZAF secure settings.
 *
 * Only the subset of the Fetch contract @hanzo/ai relies on is implemented:
 * a POST/GET with JSON body and a Response exposing `ok`, `status`, `text()`,
 * `json()`, and (for streaming) `body`. Streaming is not proxiable through
 * `client.request`, so the client is used in non-streaming mode over this fetch.
 */
export function secureFetch(client: ZafClient): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (init?.method || 'GET').toUpperCase();
    const headers = normalizeHeaders(init?.headers);
    // Inject the secure Hanzo key placeholder; the host substitutes it.
    headers['Authorization'] = `Bearer {{setting.${APIKEY_SETTING}}}`;

    const res = (await client.request({
      url,
      method,
      headers,
      contentType: 'application/json',
      data: typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : undefined,
      secure: true,
      httpCompleteResponse: true,
    })) as { status?: number; responseText?: string; responseJSON?: unknown };

    const status = res.status ?? 200;
    const bodyText = res.responseText ?? (res.responseJSON !== undefined ? JSON.stringify(res.responseJSON) : '');
    return new Response(bodyText, { status, headers: { 'Content-Type': 'application/json' } });
  };
  return impl as typeof fetch;
}

/** Flatten a HeadersInit into a plain record (ZAF request wants a plain object). */
function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else {
    Object.assign(out, h);
  }
  return out;
}

/** The gateway base @hanzo/ai should target through {@link secureFetch}. */
export const GATEWAY_BASE_URL = API_BASE_URL;
