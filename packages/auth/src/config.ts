// The per-surface OAuth client registry, and the surface's view of Hanzo IAM.
//
// The PATHS are not defined here. `@hanzo/iam` already declares them
// (OIDC_PATHS) and it is the package the other twenty-odd extension packages
// already depend on, so restating `/v1/iam/oauth/*` here made a third copy of
// one fact — with the vscode add-in's hand-written constant as a fourth, kept
// in step by a comment asking the next reader to check. The add-in had already
// shipped `hanzo.id/oauth/authorize` (no /v1/iam) once; a comment is not a
// mechanism.
//
// So this file derives every path from @hanzo/iam and keeps only what is
// genuinely its own: the two hosts, which OAuth client each surface is, and
// the headless flow that @hanzo/iam's browser SDK cannot serve (an Office
// add-in and a VS Code extension have no popup to open).

import { iamUrl } from '@hanzo/iam/paths';

// A person authorizes at the login UI on hanzo.id; the surface then calls the
// IAM API through the unified gateway, api.hanzo.ai. Both carry /v1/iam.
// @hanzo/iam's BRAND_SERVER_URLS names a brand's IAM origin, not the gateway,
// so the API host is stated here.
export const IAM_LOGIN_URL = 'https://hanzo.id';
export const IAM_API_URL = 'https://api.hanzo.ai';
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

// URL builders. The issuer differs per endpoint (login UI vs API) and is
// overridable for self-hosted brands and tests; the PATH is never a choice this
// package gets to make, so it comes from @hanzo/iam every time.

export function authorizeURL(issuer: string = IAM_LOGIN_URL): string {
  return iamUrl(issuer, 'authorize');
}
export function tokenURL(issuer: string = IAM_API_URL): string {
  return iamUrl(issuer, 'token');
}
export function userinfoURL(issuer: string = IAM_API_URL): string {
  return iamUrl(issuer, 'userinfo');
}
