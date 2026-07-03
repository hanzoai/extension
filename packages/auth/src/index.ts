// @hanzo/auth — the ONE Hanzo IAM auth core. Every extension (browser, office,
// vscode, cli, mcp) imports from here: canonical HIP-0111 endpoints, PKCE, the
// OAuth2 authorization-code + PKCE flow, refresh, and userinfo. A surface
// supplies only a TokenStore (persistence) and an Opener (the interactive leg);
// the flow itself lives once, in flow.ts.

export * from './config.js';
export * from './pkce.js';
export * from './oauth.js';
export * from './flow.js';
export type { TokenSet, TokenStore, Opener } from './types.js';

// Convenience: resolve a surface's AuthClient from the CLIENTS registry so a
// caller writes `authClientFor('office')` instead of assembling ids/redirects.
import { CLIENTS, type SurfaceName } from './config.js';
import type { AuthClient } from './flow.js';

export function authClientFor(surface: SurfaceName, overrides: Partial<AuthClient> = {}): AuthClient {
  const c = CLIENTS[surface];
  return { clientId: c.id, redirectUri: c.redirectUri, ...overrides };
}
