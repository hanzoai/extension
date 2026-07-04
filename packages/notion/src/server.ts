// The OAuth + Notion-proxy service. This is the ONLY place the Notion
// client_secret AND the workspace bot token exist — both stay server-side, never
// reaching the browser. The client app (app.ts) talks to THIS service for the
// OAuth code→token exchange (which returns an opaque SESSION id, not the bot
// token) and then proxies every Notion API call through it, presenting the
// session id. So a Notion token never leaves the server.
//
// It is a dependency-free Node http handler built on the pure modules
// (notion-oauth, notion-api) so it is deployable behind hanzoai/ingress as a
// small service at notion.hanzo.ai. The pure logic it wraps is what the tests
// cover (an http server is an integration concern, not a unit).
//
//   node dist/server.js    (after build.js bundles it)
//
// Required environment:
//   NOTION_CLIENT_ID       — the public integration's OAuth client id
//   NOTION_CLIENT_SECRET   — the integration's OAuth secret   (SERVER ONLY)
//   NOTION_REDIRECT_URI    — e.g. https://notion.hanzo.ai/oauth/callback
//   PORT                   — listen port                       (default 8788)

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { tokenExchange, parseTokenResponse, type TokenSet } from './notion-oauth.js';
import { notionApiRoot, NOTION_VERSION } from './config.js';

interface Env {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  port: number;
}

// readEnv fails fast (throws) if a required secret is missing — a server that
// can't exchange tokens must not pretend to start. No default for the secret.
export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const clientId = env.NOTION_CLIENT_ID;
  const clientSecret = env.NOTION_CLIENT_SECRET;
  const redirectUri = env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('NOTION_CLIENT_ID, NOTION_CLIENT_SECRET and NOTION_REDIRECT_URI are required');
  }
  return { clientId, clientSecret, redirectUri, port: Number(env.PORT) || 8788 };
}

/**
 * The server-side session store. Maps an opaque session id → the workspace's
 * Notion TokenSet. In-memory here (single-instance dev); a production multi-
 * instance deploy backs this with hanzoai/kv (Valkey) — the interface is the
 * two methods, so swapping the store is orthogonal to the handlers.
 */
export interface SessionStore {
  put(session: string, tokens: TokenSet): void;
  get(session: string): TokenSet | undefined;
}

export function memoryStore(): SessionStore {
  const m = new Map<string, TokenSet>();
  return {
    put: (s, t) => void m.set(s, t),
    get: (s) => m.get(s),
  };
}

// newSessionId mints an unguessable opaque session id handed to the browser in
// place of the bot token. 32 random bytes, hex — not a JWT, carries no data.
export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

/**
 * proxyPathAllowed guards the Notion-proxy: only the exact Notion v1 subpaths
 * this app uses are forwardable, so the session id can never be turned into a
 * general Notion credential. Pure — unit-tested.
 */
export function proxyPathAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  // GET reads: a page, a database schema, a block's children.
  if (m === 'GET') {
    return (
      /^\/pages\/[^/]+$/.test(path) ||
      /^\/databases\/[^/]+$/.test(path) ||
      /^\/blocks\/[^/]+\/children$/.test(path)
    );
  }
  // POST: search, database query, create page.
  if (m === 'POST') {
    return (
      path === '/search' ||
      path === '/pages' ||
      /^\/databases\/[^/]+\/query$/.test(path)
    );
  }
  // PATCH: append block children (write-back).
  if (m === 'PATCH') {
    return /^\/blocks\/[^/]+\/children$/.test(path);
  }
  return false;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// POST /oauth/callback  { code } → exchanges for a bot token (secret stays here),
// stores it under a fresh session id, and returns { session, workspace } to the
// app. The app never sees the bot token or the client_secret.
async function handleCallback(
  env: Env,
  store: SessionStore,
  res: ServerResponse,
  body: string,
): Promise<void> {
  const { code } = JSON.parse(body || '{}');
  if (!code) return json(res, 400, { error: 'missing code' });
  const reqShape = tokenExchange({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    code,
  });
  const notionResp = await fetch(reqShape.url, {
    method: 'POST',
    headers: reqShape.headers,
    body: reqShape.body,
  });
  const data = await notionResp.json().catch(() => ({}));
  let tokens: TokenSet;
  try {
    tokens = parseTokenResponse(data);
  } catch (e: any) {
    return json(res, 400, { error: e?.message || 'token exchange failed' });
  }
  const session = newSessionId();
  store.put(session, tokens);
  // Return only non-secret workspace metadata + the opaque session handle.
  return json(res, 200, {
    session,
    workspace: {
      id: tokens.workspaceId,
      name: tokens.workspaceName,
      icon: tokens.workspaceIcon,
    },
  });
}

// ANY /notion/{v1-subpath} with header `x-hanzo-session` → forwards to Notion
// with the stored bot token, adding Authorization + Notion-Version server-side.
// Only allow-listed subpaths pass (proxyPathAllowed); everything else 404s.
async function handleProxy(
  store: SessionStore,
  req: IncomingMessage,
  res: ServerResponse,
  subPath: string,
  body: string,
): Promise<void> {
  const session = String(req.headers['x-hanzo-session'] || '');
  const tokens = session ? store.get(session) : undefined;
  if (!tokens) return json(res, 401, { error: 'no session' });
  const method = req.method || 'GET';
  const path = subPath.replace(/\?.*$/, '');
  if (!proxyPathAllowed(method, path)) return json(res, 404, { error: 'path not allowed' });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${tokens.accessToken}`,
    'Notion-Version': NOTION_VERSION,
    Accept: 'application/json',
  };
  const hasBody = method === 'POST' || method === 'PATCH';
  if (hasBody) headers['Content-Type'] = 'application/json';

  const notionResp = await fetch(`${notionApiRoot()}${subPath}`, {
    method,
    headers,
    body: hasBody ? body : undefined,
  });
  const text = await notionResp.text();
  res.writeHead(notionResp.status, { 'Content-Type': 'application/json' });
  res.end(text);
}

// The request router. Everything is a small handler over the pure modules.
export function createHandler(env: Env, store: SessionStore = memoryStore()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', `http://localhost:${env.port}`);
    try {
      if (req.method === 'POST' && url.pathname === '/oauth/callback') {
        return await handleCallback(env, store, res, await readBody(req));
      }
      if (url.pathname.startsWith('/notion/')) {
        const subPath = url.pathname.slice('/notion'.length) + url.search;
        const body = req.method === 'GET' ? '' : await readBody(req);
        return await handleProxy(store, req, res, subPath, body);
      }
      if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
        return json(res, 200, { status: 'ok' });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e: any) {
      return json(res, 500, { error: e?.message || 'internal error' });
    }
  };
}

// main boots the http server when run directly. Import-safe: only the direct
// entry starts listening, so tests can import readEnv/proxyPathAllowed/etc.
// without opening a port.
export function main(): void {
  const env = readEnv();
  const server = createServer(createHandler(env));
  server.listen(env.port, () => {
    console.log(JSON.stringify({ msg: 'hanzo-notion service up', port: env.port }));
  });
}

// ESM entry check: run main() only when this file is the process entry. Kept
// tolerant of the bundled filename so `node dist/server.js` starts the server.
if (process.argv[1] && /server\.js$/.test(process.argv[1])) {
  main();
}
