import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  API_URL, CLIENT_ID, LOGIN_URL, SECRET, Canceled, Rejected, Session,
  authorizeUrl, challenge, decode, encode, exchange, expired, login, refresh, revoke, userinfo, verifier,
  type Secrets,
} from '../../auth/iam';

/** IAM's authorize, token, revoke and userinfo endpoints, as far as a public PKCE client sees them. */
class FakeIam {
  base = '';
  state?: string;
  error?: string;
  revoked?: string;
  refreshes = 0;
  private challenge = '';
  private redirect = '';
  private server = http.createServer((req, res) => this.handle(req, res));

  async start() {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    this.server.close();
    this.server.closeAllConnections();
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url!, this.base);
    let body = '';
    for await (const chunk of req) {body += chunk;}
    const form = Object.fromEntries(new URLSearchParams(body));
    const json = (status: number, o: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(o));
    };

    switch (url.pathname) {
      case '/v1/iam/oauth/authorize': {
        const q = url.searchParams;
        if (q.get('client_id') !== 'hanzo-vscode' || q.get('code_challenge_method') !== 'S256' ||
            !/^http:\/\/127\.0\.0\.1:\d+\/callback$/.test(q.get('redirect_uri') ?? '')) {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('authorization error: invalid redirect_uri');
          return;
        }
        this.challenge = q.get('code_challenge')!;
        this.redirect = q.get('redirect_uri')!;
        const back = new URL(this.redirect);
        back.searchParams.set('state', this.state ?? q.get('state')!);
        if (this.error) {
          back.searchParams.set('error', this.error);
          back.searchParams.set('error_description', 'the person said no');
        } else {
          back.searchParams.set('code', 'C1');
        }
        res.writeHead(302, { Location: back.toString() }).end();
        return;
      }
      case '/v1/iam/oauth/token': {
        if (form.client_id !== 'hanzo-vscode') {return json(400, { error: 'invalid_client' });}
        if (form.grant_type === 'authorization_code') {
          const ok = form.code === 'C1' && form.redirect_uri === this.redirect && challenge(form.code_verifier ?? '') === this.challenge;
          return ok
            ? json(200, { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, token_type: 'Bearer' })
            : json(400, { error: 'invalid_grant' });
        }
        if (form.grant_type === 'refresh_token') {
          this.refreshes++;
          if (form.refresh_token === 'flaky') {return json(503, { error: 'unavailable' });}
          if (form.refresh_token !== 'R1') {return json(400, { error: 'invalid_grant' });}
          // Answer on the next turn, so two callers that raced both wait on one refresh.
          await new Promise(r => setTimeout(r, 20));
          return json(200, { access_token: 'A2', expires_in: 3600 });
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      case '/v1/iam/oauth/revoke':
        this.revoked = form.token;
        return json(200, {});
      case '/v1/iam/oauth/userinfo':
        return req.headers.authorization === 'Bearer A1'
          ? json(200, { sub: 'u1', email: 'person@hanzo.ai' })
          : json(401, { error: 'invalid_token' });
      case '/html/v1/iam/oauth/token':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><html></html>');
        return;
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  }
}

/** What the browser does: GET the authorize page and follow IAM's redirect to the loopback. */
const browse = async (url: string) => {
  await (await fetch(url)).text();
};

class MemorySecrets implements Secrets {
  values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async store(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

let iam: FakeIam;
beforeEach(async () => {
  iam = new FakeIam();
  await iam.start();
});
afterEach(() => iam.stop());

describe('the authorize URL', () => {
  it('names hanzo.id for the person, api.hanzo.ai for the API, and the hanzo-vscode client', () => {
    expect(LOGIN_URL).toBe('https://hanzo.id');
    expect(API_URL).toBe('https://api.hanzo.ai');
    expect(CLIENT_ID).toBe('hanzo-vscode');
  });

  it('computes the RFC 7636 appendix B challenge', () => {
    expect(challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(verifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('carries the PKCE code request, with spaces as %20', () => {
    const raw = authorizeUrl('CH', 'ST', 'http://127.0.0.1:5555/callback');
    const url = new URL(raw);
    expect(url.origin + url.pathname).toBe('https://hanzo.id/v1/iam/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'hanzo-vscode',
      redirect_uri: 'http://127.0.0.1:5555/callback',
      scope: 'openid profile email offline_access',
      state: 'ST',
      code_challenge: 'CH',
      code_challenge_method: 'S256',
    });
    expect(raw).toContain('scope=openid%20profile%20email%20offline_access');
    expect(raw).not.toContain('+');
  });
});

describe('login', () => {
  it('trades the loopback code for tokens', async () => {
    const before = Date.now();
    const tokens = await login(browse, { api: iam.base, login: iam.base });
    expect(tokens.access).toBe('A1');
    expect(tokens.refresh).toBe('R1');
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expired(tokens)).toBe(false);
    expect((await userinfo(tokens.access, iam.base)).email).toBe('person@hanzo.ai');
  });

  it('refuses a callback carrying another state', async () => {
    iam.state = 'forged';
    await expect(login(browse, { api: iam.base, login: iam.base })).rejects.toThrow('sign-in callback carried the wrong state');
  });

  it('reports the error IAM redirects with', async () => {
    iam.error = 'access_denied';
    await expect(login(browse, { api: iam.base, login: iam.base })).rejects.toThrow('IAM refused sign-in: the person said no');
  });

  it('stops when canceled or out of time', async () => {
    const abort = new AbortController();
    const pending = login(() => abort.abort(), { api: iam.base, login: iam.base, signal: abort.signal });
    await expect(pending).rejects.toBeInstanceOf(Canceled);
    await expect(login(() => undefined, { api: iam.base, login: iam.base, timeoutMs: 300 })).rejects.toThrow('sign-in timed out');
  });
});

describe('the token endpoint', () => {
  it('treats an HTML answer as an error, not a token', async () => {
    await expect(exchange('C1', 'v', 'r', `${iam.base}/html`)).rejects.toThrow(/answered text\/html.*not JSON/);
  });

  it('refresh keeps the refresh token IAM did not rotate', async () => {
    const tokens = await refresh('R1', iam.base);
    expect(tokens).toMatchObject({ access: 'A2', refresh: 'R1' });
    const refused = await refresh('revoked', iam.base).catch(e => e);
    expect(refused).toBeInstanceOf(Rejected);
    expect(refused.status).toBe(400);
  });

  it('revoke posts the refresh token', async () => {
    await revoke('R1', iam.base);
    expect(iam.revoked).toBe('R1');
  });
});

describe('stored tokens', () => {
  it('round trip, and anything else reads as signed out', () => {
    const tokens = { access: 'A', refresh: 'R', expiresAt: 42 };
    expect(decode(encode(tokens))).toEqual(tokens);
    expect(decode(encode({ access: 'A' }))).toEqual({ access: 'A' });
    expect(decode('eyJhbGciOiJSUzI1NiJ9.e30.sig')).toBeUndefined();
    expect(decode('{"access_token":""}')).toBeUndefined();
    expect(decode('')).toBeUndefined();
  });

  it('expire a minute early, and never without a lifetime', () => {
    expect(expired({ access: 'A' })).toBe(false);
    expect(expired({ access: 'A', expiresAt: 200_000 }, 139_999)).toBe(false);
    expect(expired({ access: 'A', expiresAt: 200_000 }, 140_000)).toBe(true);
  });
});

describe('Session', () => {
  let secrets: MemorySecrets;
  let session: Session;
  const put = (tokens: object) => secrets.values.set(SECRET, encode(tokens as never));
  beforeEach(() => {
    secrets = new MemorySecrets();
    session = new Session(secrets, { api: iam.base, login: iam.base });
  });

  it('signs in, stores the tokens, and returns the email', async () => {
    expect(await session.signIn(browse)).toBe('person@hanzo.ai');
    expect(decode(secrets.values.get(SECRET)!)).toMatchObject({ access: 'A1', refresh: 'R1' });
    expect(await session.token()).toBe('A1');
  });

  it('refreshes a token within a minute of expiry, once for callers that race', async () => {
    put({ access: 'A1', refresh: 'R1', expiresAt: Date.now() + 30_000 });
    expect(await Promise.all([session.token(), session.token()])).toEqual(['A2', 'A2']);
    expect(iam.refreshes).toBe(1);
    const stored = decode(secrets.values.get(SECRET)!)!;
    expect(stored).toMatchObject({ access: 'A2', refresh: 'R1' });
    expect(expired(stored)).toBe(false);
  });

  it('signs out when IAM refuses the refresh token', async () => {
    put({ access: 'A1', refresh: 'revoked', expiresAt: Date.now() - 1 });
    expect(await session.token()).toBeUndefined();
    expect(await session.tokens()).toBeUndefined();
  });

  it('keeps the tokens when IAM is unavailable', async () => {
    put({ access: 'A1', refresh: 'flaky', expiresAt: Date.now() - 1 });
    await expect(session.token()).rejects.toBeInstanceOf(Rejected);
    expect(await session.tokens()).toMatchObject({ refresh: 'flaky' });
  });

  it('signs out here first, then revokes the refresh token', async () => {
    put({ access: 'A1', refresh: 'R1' });
    await session.signOut();
    expect(await session.tokens()).toBeUndefined();
    expect(iam.revoked).toBe('R1');
  });
});
