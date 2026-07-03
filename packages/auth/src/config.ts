// The ONE definition of Hanzo IAM endpoints and the per-surface OAuth client
// registry. Every Hanzo extension (browser, office, vscode, cli, mcp) resolves
// its auth URLs HERE — so a path can never drift between five hand-rolled
// copies again (the vscode add-in shipped `hanzo.id/oauth/authorize`, missing
// the /v1/iam prefix, for exactly that reason).
//
// HIP-0111: the canonical OAuth2/OIDC surface is `${issuer}/v1/iam/oauth/*`.
// The login UI (authorize) lives on hanzo.id; the token/userinfo API on
// iam.hanzo.ai. Both carry the SAME /v1/iam prefix — that is the whole point.

export const IAM_LOGIN_URL = 'https://hanzo.id';
export const IAM_API_URL = 'https://iam.hanzo.ai';
export const IAM_API_PATH = '/v1/iam';
export const DEFAULT_SCOPES = 'openid profile email offline_access';

// SurfaceClient is one registered IAM OAuth client — one per product surface, so
// tokens, redirect URIs, and audit trails are attributable to the surface that
// minted them. redirectUri is where IAM sends the code back; it must be
// registered on the IAM client of the same id. Adding a surface is ONE entry
// here, never a new copy of the flow.
export interface SurfaceClient {
  id: string;
  redirectUri: string;
}

// CLIENTS is the registry. The ids match the applications seeded in Hanzo IAM
// (<org>-<app> convention). redirectUris match what those clients allow.
export const CLIENTS = {
  browser: { id: 'hanzo-browser', redirectUri: 'https://hanzo.ai/callback' },
  office: { id: 'hanzo-office', redirectUri: 'https://office.hanzo.ai/auth-callback.html' },
  vscode: { id: 'hanzo-vscode', redirectUri: 'https://hanzo.ai/callback' },
  cli: { id: 'hanzo-cli', redirectUri: 'http://127.0.0.1/callback' },
} as const satisfies Record<string, SurfaceClient>;

export type SurfaceName = keyof typeof CLIENTS;

// URL builders — the only place these paths are assembled. issuer defaults to
// the login host for authorize and the API host for token/userinfo, but both
// are overridable (self-hosted brands, tests) via the opts.

export function authorizeURL(issuer: string = IAM_LOGIN_URL): string {
  return `${trimEnd(issuer)}${IAM_API_PATH}/oauth/authorize`;
}
export function tokenURL(issuer: string = IAM_API_URL): string {
  return `${trimEnd(issuer)}${IAM_API_PATH}/oauth/token`;
}
export function userinfoURL(issuer: string = IAM_API_URL): string {
  return `${trimEnd(issuer)}${IAM_API_PATH}/oauth/userinfo`;
}

function trimEnd(s: string): string {
  return s.replace(/\/+$/, '');
}
