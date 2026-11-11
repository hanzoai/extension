/**
 * WebMCP (Chrome `navigator.modelContext` + declarative `<form toolname="...">`
 * + `<script type="application/mcp+json">` + `window.__hanzoWebMCP`) discovery,
 * delta-only summary diffing, detached invocation tracking, and provenance framing.
 *
 * Shared across the browser extension (`browser-dispatch.ts`, `background.ts`,
 * `background-firefox.ts`), `@hanzo/browser` headless/headed CDP driver, and
 * `hanzo-mcp`.
 */

export interface WebMCPToolSummary {
  name: string;
  description: string;
  origin: string;
  frameId: string;
}

export interface WebMCPToolSchema extends WebMCPToolSummary {
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  declarative?: boolean;
}

export interface WebMCPSummaryPayload {
  experimental: true;
  untrusted: true;
  status: 'ready' | 'unavailable';
  available: boolean;
  toolCount: number;
  tools: WebMCPToolSummary[];
  truncated: boolean;
}

export interface WebMCPFrameSnapshot {
  frameId: string | number;
  origin: string;
  tools: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    declarative?: boolean;
  }>;
}

export const WEBMCP_METHODS = new Set([
  'webmcp.list',
  'webmcp.invoke',
  'webmcp.call',
  'webmcp.result',
  'webmcp.cancel',
  'hanzo.webmcp.list',
  'hanzo.webmcp.invoke',
  'hanzo.webmcp.call',
  'hanzo.webmcp.result',
  'hanzo.webmcp.cancel',
]);

const MAX_SUMMARY_TOOLS = 16;
const MAX_SUMMARY_BYTES = 4096;
const MAX_DESC_BYTES = 160;

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return utf8Encoder.encode(s).byteLength;
}

/**
 * Truncate description to at most `maxBytes` UTF-8 bytes without splitting surrogate
 * pairs, appending `…` and returning `{ text, truncated }` when shortened.
 */
export function truncateUtf8Description(raw: unknown, maxBytes = MAX_DESC_BYTES): { text: string; truncated: boolean } {
  const clean = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (utf8ByteLength(clean) <= maxBytes) {
    return { text: clean, truncated: false };
  }
  let acc = '';
  let bytes = 0;
  for (const ch of clean) {
    const chBytes = utf8ByteLength(ch);
    if (bytes + chBytes > maxBytes) break;
    acc += ch;
    bytes += chBytes;
  }
  return { text: `${acc.trimEnd()}…`, truncated: true };
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Generate a random nonce for untrusted content boundary tags. */
export function makeProvenanceNonce(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Wrap untrusted page-provided WebMCP metadata or tool output in nonce-bearing boundaries. */
export function delimitUntrusted(content: string, nonce = makeProvenanceNonce()): string {
  const safe = String(content ?? '').split(nonce).join('[redacted-nonce]');
  return `<<<UNTRUSTED_PAGE_METADATA_${nonce}>>>\n${safe}\n<<<END_UNTRUSTED_PAGE_METADATA_${nonce}>>>`;
}

/** Format a WebMCP summary payload for CLI / MCP text responses with nonce-bearing provenance boundaries. */
export function formatWebMcpSummaryText(summary: WebMCPSummaryPayload, nonce = makeProvenanceNonce()): string {
  const header = `[webmcp status=${summary.status} available=${summary.available} toolCount=${summary.toolCount} truncated=${summary.truncated} untrusted=true]`;
  if (summary.tools.length === 0) return header;
  const lines = summary.tools.map(
    (t) => `- ${t.name} (frame=${t.frameId}, origin=${t.origin}): ${t.description}`,
  );
  return `${header}\n${delimitUntrusted(lines.join('\n'), nonce)}`;
}

/** True when WebMCP is disabled via HANZO_BROWSER_NO_WEBMCP=1 or AGENT_BROWSER_NO_WEBMCP=1. */
export function isWebMCPDisabled(
  env?: Record<string, string | undefined>,
  explicitOptOut?: boolean,
): boolean {
  if (explicitOptOut) return true;
  if ((globalThis as any).__HANZO_NO_WEBMCP === true) return true;
  const e = env ?? (typeof process !== 'undefined' && process?.env ? process.env : undefined);
  if (!e) return false;
  const off = (v: string | undefined) => v === '1' || /^true$/i.test(v || '');
  return off(e.HANZO_BROWSER_NO_WEBMCP) || off(e.AGENT_BROWSER_NO_WEBMCP);
}

/**
 * Build a spec-compliant `WebMCPSummaryPayload` capped to:
 * - <= 16 tools
 * - <= 4 KiB (4096 UTF-8 bytes) of JSON
 * - descriptions shortened to <= 160 UTF-8 bytes + `…`
 * - names and frameIds NEVER cut into unusable identifiers; oversized records are omitted.
 */
export function buildWebMcpSummary(
  rawTools: Array<{ name: string; description?: unknown; frameId: string | number; origin: string }>,
  status: 'ready' | 'unavailable' = 'ready',
): WebMCPSummaryPayload {
  if (status === 'unavailable') {
    return {
      experimental: true,
      untrusted: true,
      status: 'unavailable',
      available: false,
      toolCount: 0,
      tools: [],
      truncated: false,
    };
  }

  let truncated = false;
  const accepted: WebMCPToolSummary[] = [];

  for (let i = 0; i < rawTools.length; i++) {
    if (accepted.length >= MAX_SUMMARY_TOOLS) {
      truncated = true;
      break;
    }
    const item = rawTools[i];
    const name = String(item?.name ?? '').trim();
    const frameId = String(item?.frameId ?? '0');
    const origin = String(item?.origin ?? 'null');
    if (!name) continue;

    const desc = truncateUtf8Description(item.description, MAX_DESC_BYTES);
    if (desc.truncated) truncated = true;

    const candidate: WebMCPToolSummary = {
      name,
      description: desc.text,
      frameId,
      origin,
    };

    const probe: WebMCPSummaryPayload = {
      experimental: true,
      untrusted: true,
      status: 'ready',
      available: true,
      toolCount: rawTools.length,
      tools: [...accepted, candidate],
      truncated: truncated || i < rawTools.length - 1,
    };

    if (utf8ByteLength(JSON.stringify(probe)) > MAX_SUMMARY_BYTES) {
      truncated = true;
      continue;
    }
    accepted.push(candidate);
  }

  return {
    experimental: true,
    untrusted: true,
    status: 'ready',
    available: true,
    toolCount: rawTools.length,
    tools: accepted,
    truncated,
  };
}

/**
 * Tracks discovered WebMCP tool catalogs per `tabId` (and per frame) by full-record hash
 * (including `inputSchema` and `annotations` so schema-only changes emit an update!).
 *
 * Emits:
 * - `undefined` on pages without tools or when the full catalog hash is unchanged
 * - `status: "ready"` summary on first non-empty discovery or any catalog/schema change
 * - a one-time `status: "ready", tools: []` when previously advertised tools clear
 * - a one-time `status: "unavailable", available: false, tools: []` if observation fails
 *   while tools were previously advertised
 */
export class WebMCPCatalogTracker {
  private tabFullHash = new Map<number, string>();
  private tabHadTools = new Map<number, boolean>();

  clearTab(tabId: number): void {
    this.tabFullHash.delete(tabId);
    this.tabHadTools.delete(tabId);
  }

  markUnavailable(tabId: number): WebMCPSummaryPayload | undefined {
    const had = this.tabHadTools.get(tabId) ?? false;
    this.tabFullHash.set(tabId, 'unavailable');
    this.tabHadTools.set(tabId, false);
    if (!had) return undefined;
    return buildWebMcpSummary([], 'unavailable');
  }

  updateTab(tabId: number, snapshots: WebMCPFrameSnapshot[]): WebMCPSummaryPayload | undefined {
    const sortedFrames = [...snapshots].sort((a, b) =>
      String(a.frameId).localeCompare(String(b.frameId), undefined, { numeric: true }),
    );

    const flatFull: Array<{
      frameId: string;
      origin: string;
      name: string;
      description: string;
      inputSchema: unknown;
      annotations: unknown;
    }> = [];

    for (const snap of sortedFrames) {
      const frameId = String(snap.frameId ?? '0');
      const origin = String(snap.origin || 'null');
      const tools = [...(snap.tools || [])]
        .filter((t) => t && typeof t.name === 'string' && t.name.trim() !== '')
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const t of tools) {
        flatFull.push({
          frameId,
          origin,
          name: t.name.trim(),
          description: String(t.description ?? ''),
          inputSchema: t.inputSchema ?? null,
          annotations: t.annotations ?? null,
        });
      }
    }

    const nextHash = flatFull.length === 0 ? 'empty' : fnv1a(JSON.stringify(flatFull));
    const prevHash = this.tabFullHash.get(tabId);
    const hadTools = this.tabHadTools.get(tabId) ?? false;

    this.tabFullHash.set(tabId, nextHash);
    this.tabHadTools.set(tabId, flatFull.length > 0);

    if (flatFull.length === 0) {
      if (hadTools) {
        // One-time status: "ready" update with tools: [] clears previously advertised tools
        return buildWebMcpSummary([], 'ready');
      }
      return undefined;
    }

    if (prevHash === nextHash) {
      return undefined;
    }

    return buildWebMcpSummary(flatFull, 'ready');
  }
}

export const defaultWebMCPTracker = new WebMCPCatalogTracker();

export function forgetTabWebMcp(tabId: number): void {
  defaultWebMCPTracker.clearTab(tabId);
}

/**
 * Self-contained MAIN-world function: installs `navigator.modelContext` wrapper
 * + `window.__hanzoWebMCP` registry and reads/invokes imperative tools,
 * declarative `<form toolname="..." tooldescription="...">` forms, and
 * `<script type="application/mcp+json">` manifests, plus detached invocations.
 *
 * Zero closure dependencies so `chrome.scripting.executeScript` and CDP
 * `Runtime.evaluate` can serialize `installOrRunWebMCPInPage`.
 */
export async function installOrRunWebMCPInPage(
  op: 'install' | 'list' | 'call' | 'detach' | 'result' | 'cancel',
  payload?: { tool?: string; args?: any; invocationId?: string },
): Promise<any> {
  const g = globalThis as any;
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;

  if (!g.__hanzoWebMCP || !g.__hanzoWebMCP.__installed) {
    const preExisting = Array.isArray(g.__hanzoWebMCP?.tools) ? g.__hanzoWebMCP.tools : [];
    const registered = new Map<string, any>();
    const contextTools = new Map<string, any>();
    const jobs = new Map<string, {
      id: string;
      tool: string;
      status: 'running' | 'completed' | 'failed' | 'canceled';
      result?: any;
      error?: string;
      controller: AbortController;
      startedAt: number;
    }>();

    const normalizeTool = (t: any) => {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) return null;
      return {
        name: t.name.trim(),
        description: String(t.description ?? ''),
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object'
          ? t.inputSchema
          : { type: 'object', properties: {} },
        annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : undefined,
        execute: typeof t.execute === 'function' ? t.execute : (typeof t.handler === 'function' ? t.handler : undefined),
      };
    };

    for (const item of preExisting) {
      const norm = normalizeTool(item);
      if (norm) registered.set(norm.name, norm);
    }

    const nativeMC = nav?.modelContext;
    const origRegister = typeof nativeMC?.registerTool === 'function' ? nativeMC.registerTool.bind(nativeMC) : null;
    const origUnregister = typeof nativeMC?.unregisterTool === 'function' ? nativeMC.unregisterTool.bind(nativeMC) : null;
    const origProvide = typeof nativeMC?.provideContext === 'function' ? nativeMC.provideContext.bind(nativeMC) : null;
    const origClear = typeof nativeMC?.clearContext === 'function' ? nativeMC.clearContext.bind(nativeMC) : null;

    const api = {
      __installed: true,
      _jobs: jobs,
      registerTool(tool: any, options?: any) {
        const norm = normalizeTool(tool);
        if (norm) registered.set(norm.name, norm);
        if (origRegister) {
          try { return origRegister(tool, options); } catch { /* ignore duplicate native error */ }
        }
        return { unregister: () => api.unregisterTool(norm?.name || '') };
      },
      unregisterTool(name: string) {
        registered.delete(String(name));
        contextTools.delete(String(name));
        if (origUnregister) {
          try { return origUnregister(name); } catch { /* ignore */ }
        }
      },
      provideContext(ctx?: { tools?: any[] }) {
        contextTools.clear();
        if (Array.isArray(ctx?.tools)) {
          for (const t of ctx!.tools) {
            const norm = normalizeTool(t);
            if (norm) contextTools.set(norm.name, norm);
          }
        }
        if (origProvide) {
          try { return origProvide(ctx); } catch { /* ignore */ }
        }
      },
      clearContext() {
        registered.clear();
        contextTools.clear();
        if (origClear) {
          try { return origClear(); } catch { /* ignore */ }
        }
      },
      _getImperative(): Map<string, any> {
        const merged = new Map<string, any>();
        for (const [k, v] of contextTools) merged.set(k, v);
        for (const [k, v] of registered) merged.set(k, v);
        if (Array.isArray(g.__hanzoWebMCP?.tools)) {
          for (const t of g.__hanzoWebMCP.tools) {
            const norm = normalizeTool(t);
            if (norm && !merged.has(norm.name)) merged.set(norm.name, norm);
          }
        }
        const testing = nav?.modelContextTesting;
        if (typeof testing?.listTools === 'function') {
          try {
            const nativeList = testing.listTools() || [];
            for (const nt of nativeList) {
              if (nt?.name && !merged.has(nt.name)) {
                let schema: any = { type: 'object', properties: {} };
                if (typeof nt.inputSchema === 'string') {
                  try { schema = JSON.parse(nt.inputSchema); } catch { /* keep default */ }
                } else if (nt.inputSchema && typeof nt.inputSchema === 'object') {
                  schema = nt.inputSchema;
                }
                merged.set(nt.name, {
                  name: String(nt.name),
                  description: String(nt.description ?? ''),
                  inputSchema: schema,
                  annotations: nt.annotations,
                  _nativeTesting: true,
                });
              }
            }
          } catch { /* ignore */ }
        }
        return merged;
      },
    };

    if (nav) {
      if (nativeMC && typeof nativeMC === 'object') {
        try {
          nativeMC.registerTool = api.registerTool;
          nativeMC.unregisterTool = api.unregisterTool;
          nativeMC.provideContext = api.provideContext;
          nativeMC.clearContext = api.clearContext;
        } catch { /* read-only methods */ }
      } else {
        try {
          Object.defineProperty(nav, 'modelContext', {
            value: {
              registerTool: api.registerTool,
              unregisterTool: api.unregisterTool,
              provideContext: api.provideContext,
              clearContext: api.clearContext,
            },
            configurable: true,
            writable: true,
          });
        } catch { /* navigator locked */ }
      }
    }

    g.__hanzoWebMCP = api;
  }

  const scanDeclarative = (): Map<string, { schema: any; form?: HTMLFormElement; actionUrl?: string; method?: string }> => {
    const out = new Map<string, { schema: any; form?: HTMLFormElement; actionUrl?: string; method?: string }>();
    if (typeof document === 'undefined' || !document.querySelectorAll) return out;

    // 1. <form toolname="..."> / <form data-toolname="...">
    const forms = Array.from(document.querySelectorAll('form[toolname], form[data-toolname]')) as HTMLFormElement[];
    for (const form of forms) {
      const name = (form.getAttribute('toolname') || form.getAttribute('data-toolname') || '').trim();
      if (!name) continue;
      const description = (
        form.getAttribute('tooldescription') ||
        form.getAttribute('data-tooldescription') ||
        form.getAttribute('aria-label') ||
        ''
      ).trim();
      const properties: Record<string, any> = {};
      const required: string[] = [];
      const controls = Array.from(form.querySelectorAll('input, select, textarea')) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
      for (const ctrl of controls) {
        if (ctrl.getAttribute('toolparamignore') === 'true') continue;
        const fieldName = (ctrl.getAttribute('name') || '').trim();
        if (!fieldName) continue;
        const tag = ctrl.tagName.toLowerCase();
        const inputType = tag === 'input' ? ((ctrl as HTMLInputElement).type || 'text').toLowerCase() : tag;
        if (['submit', 'button', 'reset', 'image'].includes(inputType)) continue;

        const labelText = Array.from((ctrl as HTMLInputElement).labels || [])
          .map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ');
        const paramDesc = (
          ctrl.getAttribute('toolparamdescription') ||
          ctrl.getAttribute('aria-label') ||
          labelText ||
          ctrl.getAttribute('placeholder') ||
          ''
        ).trim();

        if (inputType === 'radio') {
          if (!properties[fieldName]) {
            properties[fieldName] = { type: 'string', enum: [] as string[] };
            if (paramDesc) properties[fieldName].description = paramDesc;
          }
          if ((ctrl as HTMLInputElement).value && !properties[fieldName].enum.includes((ctrl as HTMLInputElement).value)) {
            properties[fieldName].enum.push((ctrl as HTMLInputElement).value);
          }
        } else if (tag === 'select') {
          const opts = Array.from((ctrl as HTMLSelectElement).options).map((o) => o.value);
          properties[fieldName] = { type: 'string', enum: opts };
          if (paramDesc) properties[fieldName].description = paramDesc;
        } else if (inputType === 'checkbox') {
          properties[fieldName] = { type: 'boolean' };
          if (paramDesc) properties[fieldName].description = paramDesc;
        } else if (inputType === 'number' || inputType === 'range') {
          properties[fieldName] = { type: 'number' };
          if (paramDesc) properties[fieldName].description = paramDesc;
        } else {
          properties[fieldName] = { type: 'string' };
          if (paramDesc) properties[fieldName].description = paramDesc;
        }

        if ((ctrl.required || ctrl.getAttribute('aria-required') === 'true') && !required.includes(fieldName)) {
          required.push(fieldName);
        }
      }
      const inputSchema: Record<string, unknown> = { type: 'object', properties };
      if (required.length > 0) inputSchema.required = required;
      out.set(name, {
        form,
        schema: {
          name,
          description,
          inputSchema,
          declarative: true,
        },
      });
    }

    // 2. <script type="application/mcp+json">
    const scripts = Array.from(document.querySelectorAll('script[type="application/mcp+json"]'));
    for (const s of scripts) {
      try {
        const parsed = JSON.parse(s.textContent || '{}');
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.tools) ? parsed.tools : []);
        for (const item of list) {
          const name = String(item?.name || '').trim();
          if (!name || out.has(name)) continue;
          out.set(name, {
            actionUrl: typeof item.endpoint === 'string' ? item.endpoint : (typeof item.url === 'string' ? item.url : undefined),
            method: typeof item.method === 'string' ? item.method.toUpperCase() : 'POST',
            schema: {
              name,
              description: String(item.description ?? ''),
              inputSchema: item.inputSchema && typeof item.inputSchema === 'object'
                ? item.inputSchema
                : { type: 'object', properties: {} },
              annotations: item.annotations && typeof item.annotations === 'object' ? item.annotations : undefined,
              declarative: true,
            },
          });
        }
      } catch { /* ignore malformed script json */ }
    }

    return out;
  };

  const origin = typeof location !== 'undefined' ? (location.origin || location.href || 'null') : 'null';

  if (op === 'install') {
    return { installed: true, origin };
  }

  const jobs = g.__hanzoWebMCP._jobs as Map<string, any>;

  if (op === 'result') {
    const id = String(payload?.invocationId || '');
    const job = jobs.get(id);
    if (!job) return { found: false, origin };
    return {
      found: true,
      origin,
      invocationId: job.id,
      tool: job.tool,
      status: job.status,
      ...(job.status === 'completed' ? { result: job.result } : {}),
      ...(job.status === 'failed' || job.status === 'canceled' ? { error: job.error } : {}),
    };
  }

  if (op === 'cancel') {
    const id = String(payload?.invocationId || '');
    const job = jobs.get(id);
    if (!job) return { found: false, origin };
    if (job.status === 'running') {
      job.status = 'canceled';
      job.error = 'Invocation canceled';
      try { job.controller.abort(); } catch {}
    }
    return { found: true, origin, invocationId: job.id, status: job.status, canceled: true };
  }

  const imperative: Map<string, any> = g.__hanzoWebMCP._getImperative();
  const declarative = scanDeclarative();

  if (op === 'list') {
    const tools: any[] = [];
    for (const [, t] of imperative) {
      tools.push({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
        annotations: t.annotations,
        declarative: false,
      });
    }
    for (const [name, d] of declarative) {
      if (!imperative.has(name)) tools.push(d.schema);
    }
    return { origin, tools };
  }

  const executeOne = async (toolName: string, args: any, signal?: AbortSignal): Promise<{ found: boolean; result?: any }> => {
    const imp = imperative.get(toolName);
    if (imp) {
      if (typeof imp.execute === 'function') {
        const res = await imp.execute(args, { agentInvoked: true, signal });
        return { found: true, result: res === undefined ? null : res };
      }
      if (imp._nativeTesting && typeof nav?.modelContextTesting?.executeTool === 'function') {
        const raw = await nav.modelContextTesting.executeTool(toolName, JSON.stringify(args));
        let parsed = raw;
        if (typeof raw === 'string') {
          try { parsed = JSON.parse(raw); } catch { /* keep string */ }
        }
        return { found: true, result: parsed };
      }
    }
    const decl = declarative.get(toolName);
    if (decl) {
      if (decl.form) {
        const form = decl.form;
        const filled: string[] = [];
        for (const [k, v] of Object.entries(args)) {
          if (k === '__submit') continue;
          const matching = Array.from(form.querySelectorAll('input, select, textarea')).filter(
            (el) => el.getAttribute('name') === k,
          ) as Array<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
          if (!matching.length) continue;
          const first = matching[0];
          const tag = first.tagName.toLowerCase();
          const type = tag === 'input' ? ((first as HTMLInputElement).type || 'text').toLowerCase() : tag;
          if (type === 'radio') {
            const target = matching.find((m) => (m as HTMLInputElement).value === String(v)) as HTMLInputElement | undefined;
            if (target) {
              target.checked = true;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              filled.push(k);
            }
          } else if (type === 'checkbox') {
            const cb = first as HTMLInputElement;
            cb.checked = Boolean(v);
            cb.dispatchEvent(new Event('input', { bubbles: true }));
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push(k);
          } else {
            const tracker = (first as any)._valueTracker;
            if (tracker && typeof tracker.setValue === 'function') tracker.setValue('__webmcp_prev__');
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(first), 'value')?.set;
            if (setter) setter.call(first, String(v ?? ''));
            else first.value = String(v ?? '');
            first.dispatchEvent(new Event('input', { bubbles: true }));
            first.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push(k);
          }
        }
        let responseValue: any;
        let submitted = false;
        if (args.__submit !== false) {
          let responded = false;
          const submitEv = new Event('submit', { bubbles: true, cancelable: true }) as any;
          submitEv.agentInvoked = true;
          submitEv.respondWith = (p: any) => {
            responded = true;
            responseValue = p;
          };
          submitted = true;
          form.dispatchEvent(submitEv);
          if (responded) {
            const resolved = await responseValue;
            return { found: true, result: resolved };
          }
        }
        return { found: true, result: { submitted, filled } };
      }
      if (decl.actionUrl) {
        const method = decl.method || 'POST';
        const urlObj = new URL(decl.actionUrl, location.href);
        const init: RequestInit = { method, signal, credentials: 'same-origin' };
        if (method === 'GET') {
          for (const [k, v] of Object.entries(args)) urlObj.searchParams.set(k, String(v ?? ''));
        } else {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(args);
        }
        const resp = await fetch(urlObj.toString(), init);
        const text = await resp.text();
        try { return { found: true, result: JSON.parse(text) }; } catch { return { found: true, result: text }; }
      }
    }
    return { found: false };
  };

  if (op === 'call') {
    const toolName = String(payload?.tool || '').trim();
    const args = payload?.args && typeof payload.args === 'object' ? payload.args : {};
    const out = await executeOne(toolName, args);
    return out.found ? { found: true, origin, result: out.result } : { found: false, origin };
  }

  if (op === 'detach') {
    const toolName = String(payload?.tool || '').trim();
    const args = payload?.args && typeof payload.args === 'object' ? payload.args : {};
    if (!imperative.has(toolName) && !declarative.has(toolName)) {
      return { found: false, origin };
    }
    const id = String(payload?.invocationId || `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
    const controller = new AbortController();
    const entry: any = {
      id,
      tool: toolName,
      status: 'running',
      controller,
      startedAt: Date.now(),
    };
    jobs.set(id, entry);
    void executeOne(toolName, args, controller.signal).then(
      (res) => {
        if (entry.status === 'running') {
          entry.status = 'completed';
          entry.result = res.result;
        }
      },
      (err) => {
        if (entry.status === 'running') {
          entry.status = 'failed';
          entry.error = err instanceof Error ? err.message : String(err);
        }
      },
    );
    return { found: true, origin, invocationId: id, status: 'running' };
  }

  return { origin, tools: [] };
}

async function getTabFrameIds(api: any, tabId: number, requestedFrameId?: number): Promise<number[]> {
  if (requestedFrameId !== undefined && Number.isFinite(requestedFrameId)) {
    return [requestedFrameId];
  }
  if (typeof api?.webNavigation?.getAllFrames === 'function') {
    try {
      const frames = await api.webNavigation.getAllFrames({ tabId });
      if (Array.isArray(frames) && frames.length > 0) {
        return frames
          .filter((f: any) => !f.errorOccurred && typeof f.frameId === 'number')
          .map((f: any) => f.frameId)
          .sort((a: number, b: number) => a - b);
      }
    } catch { /* fall through */ }
  }
  return [0];
}

async function execFrameWebMCP(
  api: any,
  tabId: number,
  frameId: number,
  op: 'install' | 'list' | 'call' | 'detach' | 'result' | 'cancel',
  payload?: { tool?: string; args?: any; invocationId?: string },
): Promise<any | null> {
  if (!api?.scripting?.executeScript) return null;
  const target: any = { tabId, frameIds: [frameId] };
  try {
    const res = await api.scripting.executeScript({
      target,
      world: 'MAIN',
      func: installOrRunWebMCPInPage,
      args: [op, payload ?? {}],
    });
    return res?.[0]?.result ?? null;
  } catch {
    if (frameId === 0) {
      try {
        const res = await api.scripting.executeScript({
          target: { tabId },
          func: installOrRunWebMCPInPage,
          args: [op, payload ?? {}],
        });
        return res?.[0]?.result ?? null;
      } catch { /* unscriptable page */ }
    }
    return null;
  }
}

/** Inject the WebMCP `navigator.modelContext` hook early on navigation commit. */
export async function injectWebMCPOnCommitted(api: any, tabId: number, frameId: number): Promise<void> {
  if (isWebMCPDisabled() || !api?.scripting?.executeScript) return;
  try {
    await api.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: installOrRunWebMCPInPage,
      args: ['install', {}],
    });
  } catch { /* chrome:// or restricted frame */ }
}

/**
 * Observe WebMCP tools across frames in `tabId` and emit a spec-compliant
 * `WebMCPSummaryPayload` ONLY when the catalog changes (or clears / becomes unavailable).
 */
export async function observeWebMcpDelta(
  api: any,
  tabId: number,
  opts: { noWebmcp?: boolean; tracker?: WebMCPCatalogTracker } = {},
): Promise<WebMCPSummaryPayload | undefined> {
  if (isWebMCPDisabled(undefined, opts.noWebmcp)) return undefined;
  if (!api?.scripting?.executeScript) return undefined;
  if (!api?.webNavigation && !api?.__enableWebMCP) return undefined;
  const tracker = opts.tracker ?? defaultWebMCPTracker;

  const frameIds = await getTabFrameIds(api, tabId);
  const snapshots: WebMCPFrameSnapshot[] = [];
  let anySucceeded = false;
  for (const frameId of frameIds) {
    const out = await execFrameWebMCP(api, tabId, frameId, 'list');
    if (out && Array.isArray(out.tools)) {
      anySucceeded = true;
      snapshots.push({
        frameId: String(frameId),
        origin: String(out.origin || 'null'),
        tools: out.tools,
      });
    }
  }
  if (!anySucceeded) {
    return tracker.markUnavailable(tabId);
  }
  return tracker.updateTab(tabId, snapshots);
}

/** Alias retained for callers importing `discoverTabWebMCP`. */
export const discoverTabWebMCP = (api: any, tabId: number, tracker?: WebMCPCatalogTracker) =>
  observeWebMcpDelta(api, tabId, { tracker });

function parseFrameId(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (/^frame-(\d+)$/i.test(s)) return Number(s.slice(6));
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    throw new Error('WebMCP tool params must be a JSON object');
  }
  return {};
}

// Track detached invocations across tabs/frames so `webmcp.result <id>` and `webmcp.cancel <id>`
// know which tab & frame own the invocation.
const detachedRegistry = new Map<string, { tabId: number; frameId: number; tool: string }>();

/**
 * `webmcp.list`: full catalog when no tool is given, or full JSON schema + annotations
 * for a single selected `tool` (scoped by `--frame <frame-id>` when requested).
 */
export async function webMcpList(
  api: any,
  tabId: number,
  params: { tool?: unknown; name?: unknown; frameId?: unknown; frame?: unknown; noWebmcp?: unknown } = {},
): Promise<{ experimental: true; untrusted: true; tools?: WebMCPToolSchema[]; tool?: WebMCPToolSchema }> {
  const optOut = params.noWebmcp === true || params.noWebmcp === 'true' || params.noWebmcp === '1';
  if (isWebMCPDisabled(undefined, optOut)) {
    return { experimental: true, untrusted: true, tools: [] };
  }
  const wantedTool = String(params.tool ?? params.name ?? '').trim() || undefined;
  const requestedFrame = parseFrameId(params.frameId ?? params.frame);
  const frameIds = await getTabFrameIds(api, tabId, requestedFrame);

  const all: WebMCPToolSchema[] = [];
  for (const frameId of frameIds) {
    const out = await execFrameWebMCP(api, tabId, frameId, 'list');
    if (!out || !Array.isArray(out.tools)) continue;
    const origin = String(out.origin || 'null');
    for (const t of out.tools) {
      all.push({
        name: String(t.name),
        description: String(t.description ?? ''),
        origin,
        frameId: String(frameId),
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object'
          ? t.inputSchema
          : { type: 'object', properties: {} },
        ...(t.annotations ? { annotations: t.annotations } : {}),
        ...(t.declarative ? { declarative: true } : {}),
      });
    }
  }

  if (wantedTool) {
    const matches = all.filter((t) => t.name === wantedTool);
    if (matches.length === 0) {
      throw new Error(
        `WebMCP tool ${JSON.stringify(wantedTool)} not found${requestedFrame !== undefined ? ` in frame ${requestedFrame}` : ''}`,
      );
    }
    if (matches.length > 1 && requestedFrame === undefined) {
      throw new Error(
        `Multiple frames register WebMCP tool ${JSON.stringify(wantedTool)} (${matches.map((m) => m.frameId).join(', ')}); pass --frame <frame-id>`,
      );
    }
    return { experimental: true, untrusted: true, tool: matches[0] };
  }

  return { experimental: true, untrusted: true, tools: all };
}

export const webmcpList = webMcpList;

/**
 * `webmcp.invoke` / `webmcp.call`: invoke `<tool>` with `params` / `args` in `tabId`
 * (optionally scoped to `frameId` and optionally detached via `detach: true`).
 */
export async function webMcpInvoke(
  api: any,
  tabId: number,
  params: {
    tool?: unknown;
    name?: unknown;
    params?: unknown;
    args?: unknown;
    arguments?: unknown;
    frameId?: unknown;
    frame?: unknown;
    detach?: unknown;
    noWebmcp?: unknown;
  } = {},
): Promise<Record<string, unknown>> {
  const optOut = params.noWebmcp === true || params.noWebmcp === 'true' || params.noWebmcp === '1';
  if (isWebMCPDisabled(undefined, optOut)) {
    throw new Error('webmcp_unsupported: WebMCP is disabled (--no-webmcp / AGENT_BROWSER_NO_WEBMCP=1)');
  }
  const tool = String(params.tool ?? params.name ?? '').trim();
  if (!tool) throw new Error('WebMCP tool name required');
  const args = parseArgs(params.params ?? params.args ?? params.arguments);
  const requestedFrame = parseFrameId(params.frameId ?? params.frame);
  const detach = params.detach === true || params.detach === 'true' || params.detach === '1';
  const frameIds = await getTabFrameIds(api, tabId, requestedFrame);

  // If multiple frames register the same tool and no --frame was provided, require disambiguation!
  if (requestedFrame === undefined && frameIds.length > 1) {
    const matchingFrames: number[] = [];
    for (const fid of frameIds) {
      const listed = await execFrameWebMCP(api, tabId, fid, 'list');
      if (listed?.tools?.some((t: any) => t?.name === tool)) matchingFrames.push(fid);
    }
    if (matchingFrames.length > 1) {
      throw new Error(
        `Multiple frames register WebMCP tool ${JSON.stringify(tool)} (${matchingFrames.join(', ')}); pass --frame <frame-id>`,
      );
    }
  }

  if (detach) {
    const invocationId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    for (const frameId of frameIds) {
      const out = await execFrameWebMCP(api, tabId, frameId, 'detach', { tool, args, invocationId });
      if (out?.found) {
        detachedRegistry.set(invocationId, { tabId, frameId, tool });
        return {
          experimental: true,
          untrusted: true,
          detached: true,
          invocationId,
          status: 'running',
          tool,
          frameId: String(frameId),
          origin: String(out.origin || 'null'),
        };
      }
    }
    throw new Error(`WebMCP tool ${JSON.stringify(tool)} not found`);
  }

  for (const frameId of frameIds) {
    const out = await execFrameWebMCP(api, tabId, frameId, 'call', { tool, args });
    if (out?.found) {
      return {
        experimental: true,
        untrusted: true,
        tool,
        frameId: String(frameId),
        origin: String(out.origin || 'null'),
        result: out.result,
      };
    }
  }

  throw new Error(
    `WebMCP tool ${JSON.stringify(tool)} not found${requestedFrame !== undefined ? ` in frame ${requestedFrame}` : ''}`,
  );
}

export const webmcpCall = webMcpInvoke;

/** `webmcp.result`: poll or retrieve a detached WebMCP tool invocation's status/output. */
export async function webMcpResult(
  api: any,
  tabId: number,
  params: { invocationId?: unknown; id?: unknown } = {},
): Promise<Record<string, unknown>> {
  const invocationId = String(params.invocationId ?? params.id ?? '').trim();
  if (!invocationId) throw new Error('invocationId required');
  const loc = detachedRegistry.get(invocationId);
  const targetTab = loc?.tabId ?? tabId;
  const frameIds = loc ? [loc.frameId] : await getTabFrameIds(api, targetTab);

  for (const frameId of frameIds) {
    const out = await execFrameWebMCP(api, targetTab, frameId, 'result', { invocationId });
    if (out?.found) {
      if (out.status !== 'running') detachedRegistry.delete(invocationId);
      return {
        experimental: true,
        untrusted: true,
        invocationId,
        tool: out.tool,
        frameId: String(frameId),
        origin: String(out.origin || 'null'),
        status: out.status,
        ...(out.result !== undefined ? { result: out.result } : {}),
        ...(out.error !== undefined ? { error: out.error } : {}),
      };
    }
  }
  throw new Error(`WebMCP invocation ${JSON.stringify(invocationId)} not found`);
}

/** `webmcp.cancel`: cancel a running detached WebMCP invocation. */
export async function webMcpCancel(
  api: any,
  tabId: number,
  params: { invocationId?: unknown; id?: unknown } = {},
): Promise<Record<string, unknown>> {
  const invocationId = String(params.invocationId ?? params.id ?? '').trim();
  if (!invocationId) throw new Error('invocationId required');
  const loc = detachedRegistry.get(invocationId);
  const targetTab = loc?.tabId ?? tabId;
  const frameIds = loc ? [loc.frameId] : await getTabFrameIds(api, targetTab);

  for (const frameId of frameIds) {
    const out = await execFrameWebMCP(api, targetTab, frameId, 'cancel', { invocationId });
    if (out?.found) {
      detachedRegistry.delete(invocationId);
      return {
        experimental: true,
        untrusted: true,
        invocationId,
        frameId: String(frameId),
        origin: String(out.origin || 'null'),
        status: out.status,
        canceled: true,
      };
    }
  }
  throw new Error(`WebMCP invocation ${JSON.stringify(invocationId)} not found`);
}
