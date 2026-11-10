import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getValidAccessToken,
  login,
  completePendingAuthCallback,
  syncWebSession,
  getMagicLinkRedirectUrl,
  isOAuthRedirectUrl,
  parseJwtUserInfo,
  PENDING_PKCE_KEY,
  LOGGED_OUT_KEY,
} from '../src/shared/auth';
import { STORAGE_KEYS } from '../src/shared/config';

/**
 * A token read answers ONE question: is there a token this client may use right
 * now? Anything else — expired, unrefreshable — is "no", and the caller signs in.
 * The surfaces are built on that answer: the answer engine treats a non-null
 * token as signed in, so a stale one turns a signed-out session into a search
 * that fails with a 401 the user cannot act on.
 */

const HOUR = 3_600_000;

/** A storage double over a plain record — the same shape BrowserStorage exposes. */
function storageOf(seed: Record<string, unknown>) {
  const data = { ...seed };
  return {
    data,
    async get(keys: string[]) {
      return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(next: Record<string, unknown>) {
      Object.assign(data, next);
    },
    async remove(keys: string[]) {
      for (const k of keys) delete data[k];
    },
  };
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => mockFetch.mockReset());

describe('getValidAccessToken', () => {
  it('returns a token that has not expired', async () => {
    const storage = storageOf({
      [STORAGE_KEYS.accessToken]: 'fresh',
      [STORAGE_KEYS.expiresAt]: Date.now() + HOUR,
    });
    expect(await getValidAccessToken(storage as any)).toBe('fresh');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses an expired token that cannot be refreshed, and clears the session', async () => {
    const storage = storageOf({
      [STORAGE_KEYS.accessToken]: 'stale',
      [STORAGE_KEYS.expiresAt]: Date.now() - HOUR,
    });
    expect(await getValidAccessToken(storage as any)).toBeNull();
    // Nothing left to make a later read believe it is still signed in.
    expect(storage.data[STORAGE_KEYS.accessToken]).toBeUndefined();
  });

  it('treats a token inside the last minute of its life as expired', async () => {
    const storage = storageOf({
      [STORAGE_KEYS.accessToken]: 'about-to-die',
      [STORAGE_KEYS.expiresAt]: Date.now() + 30_000,
    });
    expect(await getValidAccessToken(storage as any)).toBeNull();
  });

  it('refreshes an expired token when a refresh token is stored', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'minted', token_type: 'Bearer', expires_in: 3600 }),
    });
    const storage = storageOf({
      [STORAGE_KEYS.accessToken]: 'stale',
      [STORAGE_KEYS.refreshToken]: 'refresh-me',
      [STORAGE_KEYS.expiresAt]: Date.now() - HOUR,
    });
    expect(await getValidAccessToken(storage as any)).toBe('minted');
    expect(storage.data[STORAGE_KEYS.accessToken]).toBe('minted');
  });

  it('clears the session when the refresh is rejected', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const storage = storageOf({
      [STORAGE_KEYS.accessToken]: 'stale',
      [STORAGE_KEYS.refreshToken]: 'revoked',
      [STORAGE_KEYS.expiresAt]: Date.now() - HOUR,
    });
    expect(await getValidAccessToken(storage as any)).toBeNull();
    expect(storage.data[STORAGE_KEYS.refreshToken]).toBeUndefined();
  });

  it('keeps a token whose expiry was never recorded', async () => {
    // The direct-token login path stores no expires_in, so an absent expiry is
    // not evidence of staleness.
    const storage = storageOf({ [STORAGE_KEYS.accessToken]: 'no-expiry-known' });
    expect(await getValidAccessToken(storage as any)).toBe('no-expiry-known');
  });

  it('is null when nothing is stored', async () => {
    expect(await getValidAccessToken(storageOf({}) as any)).toBeNull();
  });
});

describe('OAuth callback & web session sync', () => {
  it('completes login when Chrome fires tabs.onUpdated with changeInfo.url undefined and tab.url set (same-origin redirect)', async () => {
    const storage = storageOf({});
    const updatedListeners: Array<(tabId: number, changeInfo: any, tab?: any) => void> = [];
    const removedTabs: number[] = [];

    const tabs = {
      onUpdated: {
        addListener(fn: any) {
          updatedListeners.push(fn);
        },
        removeListener(fn: any) {
          const idx = updatedListeners.indexOf(fn);
          if (idx >= 0) updatedListeners.splice(idx, 1);
        },
      },
      onRemoved: {
        addListener() {},
        removeListener() {},
      },
      async create({ url }: { url: string }) {
        const state = new URL(url).searchParams.get('state')!;
        setTimeout(() => {
          for (const listener of [...updatedListeners]) {
            // Simulate Chrome same-origin redirect where changeInfo.url is omitted
            listener(
              42,
              { status: 'loading' },
              {
                id: 42,
                url: `https://hanzo.ai/callback?code=oauth_code_123&state=${encodeURIComponent(state)}`,
              },
            );
          }
        }, 5);
        return { id: 42, url };
      },
      async remove(tabId: number) {
        removedTabs.push(tabId);
      },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'tok_from_same_origin_redirect',
          refresh_token: 'ref_1',
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sub: 'u_1',
          name: 'Antje Worring',
          email: 'antje@hanzo.ai',
        }),
      });

    const user = await login({ storage: storage as any, tabs: tabs as any });
    expect(user.email).toBe('antje@hanzo.ai');
    expect(storage.data[STORAGE_KEYS.accessToken]).toBe('tok_from_same_origin_redirect');
    expect(removedTabs).toContain(42);
  });

  it('redirects IAM magic-link /callback#email=...&code=... URLs to /auth/callback instead of treating them as OAuth code callbacks', () => {
    const magicUrl = 'https://hanzo.ai/callback#email=antje%40hanzo.ai&code=819204&mode=signin';
    expect(getMagicLinkRedirectUrl(magicUrl, 'https://hanzo.ai/callback')).toBe(
      'https://hanzo.ai/auth/callback#email=antje%40hanzo.ai&code=819204&mode=signin',
    );
    expect(isOAuthRedirectUrl(magicUrl, 'https://hanzo.ai/callback', 'state_1', true)).toBe(false);
  });

  it('completes a pending PKCE callback stored before an MV3 service worker restart', async () => {
    const storage = storageOf({
      [PENDING_PKCE_KEY]: {
        state: 'persisted_state_abc',
        codeVerifier: 'verifier_xyz',
        redirectUri: 'https://hanzo.ai/callback',
        createdAt: Date.now(),
      },
    });
    const removedTabs: number[] = [];
    const tabs = {
      onUpdated: { addListener() {}, removeListener() {} },
      onRemoved: { addListener() {}, removeListener() {} },
      async create() {
        return { id: 1 };
      },
      async remove(tabId: number) {
        removedTabs.push(tabId);
      },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'recovered_access_token',
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sub: 'u_2',
          name: 'Zach Kelling',
          email: 'zach@hanzo.ai',
        }),
      });

    const user = await completePendingAuthCallback(
      { storage: storage as any, tabs: tabs as any },
      'https://hanzo.ai/callback?code=code_after_sw_wake&state=persisted_state_abc',
      77,
    );
    expect(user?.email).toBe('zach@hanzo.ai');
    expect(storage.data[STORAGE_KEYS.accessToken]).toBe('recovered_access_token');
    expect(storage.data[PENDING_PKCE_KEY]).toBeUndefined();
    expect(removedTabs).toContain(77);
  });

  it('syncs a valid Hanzo web session into extension storage and respects explicit sign-out unless forced', async () => {
    const payload = btoa(JSON.stringify({ sub: 'u_web', name: 'Antje', email: 'antje@hanzo.ai' }));
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    expect(parseJwtUserInfo(jwt)?.email).toBe('antje@hanzo.ai');

    const storage = storageOf({});
    const synced = await syncWebSession(storage as any, {
      accessToken: jwt,
      expiresAt: Date.now() + HOUR,
      user: { sub: 'u_web', name: 'Antje', email: 'antje@hanzo.ai' },
    });
    expect(synced?.email).toBe('antje@hanzo.ai');
    expect(storage.data[STORAGE_KEYS.accessToken]).toBe(jwt);

    // If user explicitly logged out of the extension, background passive sync should not override it
    const loggedOutStorage = storageOf({ [LOGGED_OUT_KEY]: true });
    expect(
      await syncWebSession(loggedOutStorage as any, {
        accessToken: jwt,
        expiresAt: Date.now() + HOUR,
      }),
    ).toBeNull();

    // Explicit Sign In click ({ force: true }) adopts the web session and clears LOGGED_OUT_KEY
    const forced = await syncWebSession(
      loggedOutStorage as any,
      {
        accessToken: jwt,
        expiresAt: Date.now() + HOUR,
        user: { sub: 'u_web', name: 'Antje', email: 'antje@hanzo.ai' },
      },
      { force: true },
    );
    expect(forced?.email).toBe('antje@hanzo.ai');
    expect(loggedOutStorage.data[LOGGED_OUT_KEY]).toBeUndefined();
  });
});
