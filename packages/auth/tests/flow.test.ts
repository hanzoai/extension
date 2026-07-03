import { describe, it, expect, vi, afterEach } from 'vitest';
import { login, getValidToken, logout, isExpired, currentUser } from '../src/flow';
import type { TokenStore, TokenSet, Opener } from '../src/types';
import { authClientFor } from '../src/index';

// memStore is the fake per-surface TokenStore — the same seam browser/office/
// vscode/cli implement over their real storage.
function memStore(initial: TokenSet | null = null): TokenStore & { value: TokenSet | null } {
  return {
    value: initial,
    async get() { return this.value; },
    async set(t) { this.value = t; },
    async clear() { this.value = null; },
  };
}

// fakeOpener returns a canned redirect URL (what IAM would land on).
function fakeOpener(redirectUrl: (authorizeUrl: string) => string): Opener {
  return { async open(authorizeUrl) { return redirectUrl(authorizeUrl); } };
}

const client = authClientFor('office');

describe('login', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('runs PKCE → authorize → exchange → store', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) } as any)));
    const store = memStore();
    // Echo the state from the authorize URL back in the redirect so it matches.
    const opener = fakeOpener((authUrl) => {
      const state = new URL(authUrl).searchParams.get('state');
      return `https://office.hanzo.ai/auth-callback.html?code=CODE&state=${state}`;
    });
    const tokens = await login(client, store, opener);
    expect(tokens.accessToken).toBe('AT');
    expect(store.value?.accessToken).toBe('AT');
  });

  it('rejects a state mismatch (CSRF guard)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const store = memStore();
    const opener = fakeOpener(() => 'https://office.hanzo.ai/auth-callback.html?code=CODE&state=WRONG');
    await expect(login(client, store, opener)).rejects.toThrow(/state mismatch/);
    expect(store.value).toBeNull();
  });

  it('surfaces an IAM error param', async () => {
    const store = memStore();
    const opener = fakeOpener(() => 'https://office.hanzo.ai/auth-callback.html?error=access_denied');
    await expect(login(client, store, opener)).rejects.toThrow(/access_denied/);
  });
});

describe('isExpired', () => {
  it('null / past-deadline is expired; no-deadline is not', () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired({ accessToken: 'a' })).toBe(false);
    expect(isExpired({ accessToken: 'a', expiresAt: 1000 }, 999_999)).toBe(true);
    expect(isExpired({ accessToken: 'a', expiresAt: 10_000_000 }, 1000)).toBe(false);
  });
});

describe('getValidToken', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the token when fresh (no network)', async () => {
    const store = memStore({ accessToken: 'FRESH', expiresAt: Date.now() + 3600_000 });
    expect(await getValidToken(client, store)).toBe('FRESH');
  });

  it('refreshes transparently when expired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'NEW', expires_in: 3600 }) } as any)));
    const store = memStore({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: Date.now() - 1 });
    expect(await getValidToken(client, store)).toBe('NEW');
    expect(store.value?.accessToken).toBe('NEW');
    expect(store.value?.refreshToken).toBe('RT'); // reused
  });

  it('returns empty when refresh fails (revoked) so the surface re-prompts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'invalid_grant' } as any)));
    const store = memStore({ accessToken: 'OLD', refreshToken: 'RT', expiresAt: Date.now() - 1 });
    expect(await getValidToken(client, store)).toBe('');
  });

  it('returns empty when never signed in', async () => {
    expect(await getValidToken(client, memStore())).toBe('');
  });
});

describe('logout + currentUser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('logout clears the store', async () => {
    const store = memStore({ accessToken: 'a' });
    await logout(store);
    expect(store.value).toBeNull();
  });

  it('currentUser returns null with no session, identity with one', async () => {
    expect(await currentUser(client, memStore())).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sub: 'u1', email: 'z@hanzo.ai' }) } as any)));
    const u = await currentUser(client, memStore({ accessToken: 'AT', expiresAt: Date.now() + 3600_000 }));
    expect(u?.email).toBe('z@hanzo.ai');
  });
});
