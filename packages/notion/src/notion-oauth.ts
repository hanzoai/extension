// Notion OAuth2 (authorization code grant, public integration). PURE request
// shaping only — the authorize URL a browser is redirected to, and the
// token-exchange request shape (URL + headers + JSON body). The client_secret
// is a caller-supplied value that ONLY server.ts holds (from the environment);
// this module never sources it, so it stays trivially unit-testable and free of
// secrets.
//
// Notion specifics that this encodes (and where it diverges from OAuth defaults):
//  - authorize: `https://api.notion.com/v1/oauth/authorize` with
//    response_type=code, client_id, redirect_uri, state, owner=user.
//  - token: `https://api.notion.com/v1/oauth/token`, a JSON POST (NOT
//    form-urlencoded), authenticated with HTTP BASIC — `Authorization: Basic
//    base64(client_id:client_secret)` — NOT client_id/secret in the body.
//  - Notion does NOT issue refresh tokens for public integrations: the
//    access_token does not expire, so there is no refresh flow to model.

import { notionAuthorizeURL, notionTokenURL, NOTION_VERSION } from './config.js';

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  /** CSRF state the caller mints and later verifies on the callback. */
  state: string;
  /**
   * Notion's `owner` param. `user` triggers the standard consent screen where
   * the user picks which pages to share. Notion only accepts `user` here.
   */
  owner?: 'user';
  /** Notion API origin override (tests / self-host). Defaults to the global base. */
  base?: string;
}

/**
 * oauthAuthorizeUrl builds the exact URL to redirect the user's browser to.
 * Notion's authorize endpoint takes response_type=code, client_id, redirect_uri,
 * owner=user, and state. Pure.
 */
export function oauthAuthorizeUrl(p: AuthorizeParams): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    owner: p.owner ?? 'user',
    redirect_uri: p.redirectUri,
    state: p.state,
  });
  return `${notionAuthorizeURL(p.base)}?${params.toString()}`;
}

/**
 * basicAuthHeader builds the `Basic base64(id:secret)` value Notion's token
 * endpoint requires. Pure and side-effect-free; the secret is passed in by the
 * server, never sourced here. Uses Buffer (Node) or btoa (browser) — but this
 * only ever runs server-side, so Buffer is the path.
 */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  const raw = `${clientId}:${clientSecret}`;
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(raw, 'utf8').toString('base64')
      : btoa(raw);
  return `Basic ${b64}`;
}

/** The shape of the request server.ts will POST — separated from fetch so a
 * test asserts the URL, headers, and JSON body without a network call. */
export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string; // JSON
}

export interface ExchangeParams {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string; // the authorization code from the callback
  base?: string;
}

/**
 * tokenExchange shapes the code→token POST. Notion: grant_type=authorization_code
 * with the code and redirect_uri in a JSON body, HTTP-Basic-authenticated with
 * the client id/secret, and the Notion-Version header. Pure.
 */
export function tokenExchange(p: ExchangeParams): TokenRequest {
  return {
    url: notionTokenURL(p.base),
    headers: {
      Authorization: basicAuthHeader(p.clientId, p.clientSecret),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: p.redirectUri,
    }),
  };
}

/**
 * The parsed token grant. Notion returns the bot token plus workspace metadata
 * (which workspace and which bot the integration is installed as). We keep the
 * fields the app uses to label the connection; the bot's granted-page access is
 * enforced by Notion on every call.
 */
export interface TokenSet {
  accessToken: string;
  tokenType: string;
  botId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceIcon: string;
}

/**
 * parseTokenResponse turns Notion's JSON token payload into a TokenSet. Throws
 * on an OAuth error payload so the caller surfaces Notion's real reason. Notion
 * public integrations do NOT return a refresh_token or expires_in — the token is
 * long-lived — so there is nothing time-based to derive here. Pure.
 */
export function parseTokenResponse(data: any): TokenSet {
  if (data && data.error) {
    const desc = data.error_description || data.error;
    throw new Error(`Notion OAuth error: ${desc}`);
  }
  const accessToken = data?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Notion OAuth: no access_token in response');
  }
  return {
    accessToken,
    tokenType: typeof data?.token_type === 'string' ? data.token_type : 'bearer',
    botId: typeof data?.bot_id === 'string' ? data.bot_id : '',
    workspaceId: typeof data?.workspace_id === 'string' ? data.workspace_id : '',
    workspaceName: typeof data?.workspace_name === 'string' ? data.workspace_name : '',
    workspaceIcon: typeof data?.workspace_icon === 'string' ? data.workspace_icon : '',
  };
}
