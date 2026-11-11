/**
 * Spec-compliant WebMCP summary & provenance helpers for `@hanzo/browser`.
 *
 * Implements:
 * - Automatic delta summaries (`data.webmcp`) capped to <= 16 tools, <= 4 KiB JSON,
 *   and <= 160 UTF-8 byte descriptions
 * - One-time `status: "ready", tools: []` clear & `status: "unavailable"` invalidation
 * - Nonce-delimited untrusted provenance framing (`delimitUntrusted`, `formatWebMcpSummaryText`)
 * - In-page runtime installer & invoker for raw CDP sessions (`WEBMCP_PAGE_BOOTSTRAP`)
 */

import crypto from 'node:crypto';

export interface WebMCPToolSummary {
  name: string;
  description: string;
  frameId: string;
  origin: string;
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
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: Record<string, unknown>;
    declarative?: boolean;
  }>;
}

const MAX_SUMMARY_TOOLS = 16;
const MAX_SUMMARY_BYTES = 4096;
const MAX_DESC_BYTES = 160;

export function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

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

export function isWebMCPDisabled(explicitOptOut?: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (explicitOptOut) return true;
  const off = (v: string | undefined) => v === '1' || /^true$/i.test(v || '');
  return off(env.AGENT_BROWSER_NO_WEBMCP) || off(env.HANZO_BROWSER_NO_WEBMCP);
}

export function makeProvenanceNonce(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function delimitUntrusted(content: string, nonce = makeProvenanceNonce()): string {
  const safe = String(content ?? '').split(nonce).join('[redacted-nonce]');
  return `<<<UNTRUSTED_PAGE_METADATA_${nonce}>>>\n${safe}\n<<<END_UNTRUSTED_PAGE_METADATA_${nonce}>>>`;
}

export function formatWebMcpSummaryText(summary: WebMCPSummaryPayload, nonce = makeProvenanceNonce()): string {
  const header = `[webmcp status=${summary.status} available=${summary.available} toolCount=${summary.toolCount} truncated=${summary.truncated} untrusted=true]`;
  if (summary.tools.length === 0) return header;
  const lines = summary.tools.map(
    (t) => `- ${t.name} (frame=${t.frameId}, origin=${t.origin}): ${t.description}`,
  );
  return `${header}\n${delimitUntrusted(lines.join('\n'), nonce)}`;
}

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

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class WebMCPCatalogTracker {
  private lastHash: string | undefined;
  private hadTools = false;

  reset(): void {
    this.lastHash = undefined;
    this.hadTools = false;
  }

  markUnavailable(): WebMCPSummaryPayload | undefined {
    const prevHad = this.hadTools;
    this.lastHash = 'unavailable';
    this.hadTools = false;
    return prevHad ? buildWebMcpSummary([], 'unavailable') : undefined;
  }

  update(snapshots: WebMCPFrameSnapshot[]): WebMCPSummaryPayload | undefined {
    const sorted = [...snapshots].sort((a, b) =>
      String(a.frameId).localeCompare(String(b.frameId), undefined, { numeric: true }),
    );
    const flat: Array<{
      frameId: string;
      origin: string;
      name: string;
      description: string;
      inputSchema: unknown;
      annotations: unknown;
    }> = [];

    for (const s of sorted) {
      const fid = String(s.frameId ?? '0');
      const origin = String(s.origin || 'null');
      const tools = [...(s.tools || [])]
        .filter((t) => t && typeof t.name === 'string' && t.name.trim() !== '')
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const t of tools) {
        flat.push({
          frameId: fid,
          origin,
          name: t.name.trim(),
          description: String(t.description ?? ''),
          inputSchema: t.inputSchema ?? null,
          annotations: t.annotations ?? null,
        });
      }
    }

    const nextHash = flat.length === 0 ? 'empty' : fnv1a(JSON.stringify(flat));
    const prevHash = this.lastHash;
    const prevHad = this.hadTools;

    this.lastHash = nextHash;
    this.hadTools = flat.length > 0;

    if (flat.length === 0) {
      return prevHad ? buildWebMcpSummary([], 'ready') : undefined;
    }
    if (prevHash === nextHash) return undefined;
    return buildWebMcpSummary(flat, 'ready');
  }
}

/**
 * Self-contained page bootstrap evaluated via `Page.addScriptToEvaluateOnNewDocument`
 * and `Runtime.evaluate` in raw CDP sessions so `navigator.modelContext`,
 * `<form toolname="...">`, and `<script type="application/mcp+json">` work out of the box.
 */
export const WEBMCP_PAGE_BOOTSTRAP = `
(() => {
  const g = globalThis;
  if (g.__hanzoWebMCP && g.__hanzoWebMCP.__installed) return;
  const registered = new Map();
  const contextTools = new Map();
  const jobs = new Map();
  const norm = (t) => {
    if (!t || typeof t.name !== 'string' || !t.name.trim()) return null;
    return {
      name: t.name.trim(),
      description: String(t.description ?? ''),
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} },
      annotations: t.annotations && typeof t.annotations === 'object' ? t.annotations : undefined,
      execute: typeof t.execute === 'function' ? t.execute : (typeof t.handler === 'function' ? t.handler : undefined),
    };
  };
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const nativeMC = nav && nav.modelContext;
  const origReg = nativeMC && typeof nativeMC.registerTool === 'function' ? nativeMC.registerTool.bind(nativeMC) : null;
  const origUnreg = nativeMC && typeof nativeMC.unregisterTool === 'function' ? nativeMC.unregisterTool.bind(nativeMC) : null;
  const origProvide = nativeMC && typeof nativeMC.provideContext === 'function' ? nativeMC.provideContext.bind(nativeMC) : null;
  const origClear = nativeMC && typeof nativeMC.clearContext === 'function' ? nativeMC.clearContext.bind(nativeMC) : null;

  const api = {
    __installed: true,
    _jobs: jobs,
    registerTool(tool, opts) {
      const n = norm(tool);
      if (n) registered.set(n.name, n);
      if (origReg) { try { return origReg(tool, opts); } catch {} }
      return { unregister: () => api.unregisterTool(n ? n.name : '') };
    },
    unregisterTool(name) {
      registered.delete(String(name));
      contextTools.delete(String(name));
      if (origUnreg) { try { return origUnreg(name); } catch {} }
    },
    provideContext(ctx) {
      contextTools.clear();
      if (ctx && Array.isArray(ctx.tools)) {
        for (const t of ctx.tools) {
          const n = norm(t);
          if (n) contextTools.set(n.name, n);
        }
      }
      if (origProvide) { try { return origProvide(ctx); } catch {} }
    },
    clearContext() {
      registered.clear();
      contextTools.clear();
      if (origClear) { try { return origClear(); } catch {} }
    },
    _scanDeclarative() {
      const out = new Map();
      if (typeof document === 'undefined') return out;
      for (const form of Array.from(document.querySelectorAll('form[toolname], form[data-toolname]'))) {
        const name = (form.getAttribute('toolname') || form.getAttribute('data-toolname') || '').trim();
        if (!name) continue;
        const description = (form.getAttribute('tooldescription') || form.getAttribute('data-tooldescription') || form.getAttribute('aria-label') || '').trim();
        const properties = {};
        const required = [];
        for (const ctrl of Array.from(form.querySelectorAll('input, select, textarea'))) {
          const fn = (ctrl.getAttribute('name') || '').trim();
          if (!fn || ctrl.getAttribute('toolparamignore') === 'true') continue;
          const tag = ctrl.tagName.toLowerCase();
          const type = tag === 'input' ? (ctrl.type || 'text').toLowerCase() : tag;
          if (['submit', 'button', 'reset', 'image'].includes(type)) continue;
          properties[fn] = type === 'checkbox' ? { type: 'boolean' } : (type === 'number' || type === 'range' ? { type: 'number' } : { type: 'string' });
          if (ctrl.required && !required.includes(fn)) required.push(fn);
        }
        out.set(name, { form, schema: { name, description, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) }, declarative: true } });
      }
      for (const s of Array.from(document.querySelectorAll('script[type="application/mcp+json"]'))) {
        try {
          const parsed = JSON.parse(s.textContent || '{}');
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.tools) ? parsed.tools : []);
          for (const item of arr) {
            const name = String(item?.name || '').trim();
            if (!name || out.has(name)) continue;
            out.set(name, {
              actionUrl: item.endpoint || item.url,
              method: (item.method || 'POST').toUpperCase(),
              schema: { name, description: String(item.description ?? ''), inputSchema: item.inputSchema || { type: 'object', properties: {} }, annotations: item.annotations, declarative: true },
            });
          }
        } catch {}
      }
      return out;
    },
    list() {
      const origin = typeof location !== 'undefined' ? (location.origin || location.href || 'null') : 'null';
      const tools = [];
      const seen = new Set();
      for (const [, t] of contextTools) { seen.add(t.name); tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, declarative: false }); }
      for (const [, t] of registered) { if (!seen.has(t.name)) { seen.add(t.name); tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, declarative: false }); } }
      for (const [name, d] of api._scanDeclarative()) { if (!seen.has(name)) tools.push(d.schema); }
      return { origin, tools };
    },
    async invoke(toolName, args, detach, invocationId) {
      const origin = typeof location !== 'undefined' ? (location.origin || location.href || 'null') : 'null';
      const imp = registered.get(toolName) || contextTools.get(toolName);
      const decl = api._scanDeclarative().get(toolName);
      if (!imp && !decl) return { found: false, origin };
      const run = async (signal) => {
        if (imp && typeof imp.execute === 'function') return await imp.execute(args || {}, { agentInvoked: true, signal });
        if (decl && decl.form) {
          for (const [k, v] of Object.entries(args || {})) {
            const el = decl.form.querySelector('[name="' + CSS.escape(k) + '"]');
            if (!el) continue;
            if (el.type === 'checkbox') el.checked = Boolean(v);
            else el.value = String(v ?? '');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          let responded = false, respVal;
          const ev = new Event('submit', { bubbles: true, cancelable: true });
          ev.agentInvoked = true;
          ev.respondWith = (p) => { responded = true; respVal = p; };
          decl.form.dispatchEvent(ev);
          return responded ? await respVal : { submitted: true };
        }
        return null;
      };
      if (detach) {
        const id = invocationId || ('inv_' + Date.now().toString(36));
        const controller = new AbortController();
        const job = { id, tool: toolName, status: 'running', controller };
        jobs.set(id, job);
        run(controller.signal).then(
          (res) => { if (job.status === 'running') { job.status = 'completed'; job.result = res; } },
          (err) => { if (job.status === 'running') { job.status = 'failed'; job.error = String(err?.message || err); } },
        );
        return { found: true, origin, invocationId: id, status: 'running' };
      }
      return { found: true, origin, result: await run(undefined) };
    },
    result(id) {
      const origin = typeof location !== 'undefined' ? (location.origin || location.href || 'null') : 'null';
      const job = jobs.get(id);
      if (!job) return { found: false, origin };
      return { found: true, origin, invocationId: id, tool: job.tool, status: job.status, result: job.result, error: job.error };
    },
    cancel(id) {
      const origin = typeof location !== 'undefined' ? (location.origin || location.href || 'null') : 'null';
      const job = jobs.get(id);
      if (!job) return { found: false, origin };
      if (job.status === 'running') { job.status = 'canceled'; job.error = 'Invocation canceled'; try { job.controller.abort(); } catch {} }
      return { found: true, origin, invocationId: id, status: job.status, canceled: true };
    },
  };

  if (nav) {
    if (nativeMC && typeof nativeMC === 'object') {
      try {
        nativeMC.registerTool = api.registerTool;
        nativeMC.unregisterTool = api.unregisterTool;
        nativeMC.provideContext = api.provideContext;
        nativeMC.clearContext = api.clearContext;
      } catch {}
    } else {
      try {
        Object.defineProperty(nav, 'modelContext', {
          value: { registerTool: api.registerTool, unregisterTool: api.unregisterTool, provideContext: api.provideContext, clearContext: api.clearContext },
          configurable: true,
          writable: true,
        });
      } catch {}
    }
  }
  g.__hanzoWebMCP = api;
})();
`;
