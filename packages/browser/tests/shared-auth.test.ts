import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getValidAccessToken } from '../src/shared/auth';
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
