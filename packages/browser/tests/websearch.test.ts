import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  fallbackUrl,
  loadProviderId,
  providerById,
} from '../src/answer/websearch.js';

describe('external search fallback', () => {
  it('sends a signed-out query straight to the engine, not through Hanzo', () => {
    for (const p of PROVIDERS) {
      const url = fallbackUrl(p.id, 'what is a raft consensus');
      // The whole point: no api.hanzo.ai in the path. A "fallback" that proxied the
      // query would still need the identity we just established the user lacks.
      expect(url).not.toContain('hanzo');
      expect(url.startsWith('https://')).toBe(true);
      expect(url).toContain('what+is+a+raft+consensus'.replace(/\+/g, '%20'));
    }
  });

  it('encodes a query that would otherwise break the URL', () => {
    const url = fallbackUrl('duckduckgo', 'a&b=c #d ?e');
    expect(url).toBe('https://duckduckgo.com/?q=a%26b%3Dc%20%23d%20%3Fe');
    // Exactly one `?` — the query's own must not open a second parameter section.
    expect(url.split('?').length).toBe(2);
  });

  it('returns nothing for an empty query rather than a bare results page', () => {
    // Navigating to a provider's results for "" is worse than staying put: the user
    // loses the tab they were typing in and gets nothing for it.
    expect(fallbackUrl('google', '')).toBe('');
    expect(fallbackUrl('google', '   ')).toBe('');
  });

  it('falls back to the default engine for an unknown or absent id', () => {
    expect(providerById('not-an-engine').id).toBe(DEFAULT_PROVIDER_ID);
    expect(providerById(null).id).toBe(DEFAULT_PROVIDER_ID);
    expect(providerById(undefined).id).toBe(DEFAULT_PROVIDER_ID);
  });

  it('defaults to the engine that profiles a signed-out user least', () => {
    // This default is a deliberate choice, not an accident of ordering: the
    // fallback runs for people with no Hanzo account, so it is the one path where
    // we hand a stranger's query to a third party on their behalf.
    expect(DEFAULT_PROVIDER_ID).toBe('duckduckgo');
    expect(PROVIDERS[0]!.id).toBe(DEFAULT_PROVIDER_ID);
  });

  it('never throws on the enter-key path, whatever storage does', async () => {
    // loadProviderId sits directly under "the user pressed enter". An exception
    // there strands the query, which is the exact failure the fallback exists to
    // prevent — so every storage failure resolves to the default instead.
    const rejects = { get: () => Promise.reject(new Error('storage is gone')) };
    await expect(loadProviderId(rejects)).resolves.toBe(DEFAULT_PROVIDER_ID);

    const junk = { get: async () => ({ hanzo_config_fallback_search: 42 }) };
    await expect(loadProviderId(junk as never)).resolves.toBe(DEFAULT_PROVIDER_ID);

    const unknown = { get: async () => ({ hanzo_config_fallback_search: 'altavista' }) };
    await expect(loadProviderId(unknown)).resolves.toBe(DEFAULT_PROVIDER_ID);
  });

  it('honours a configured engine', async () => {
    const chosen = { get: async () => ({ hanzo_config_fallback_search: 'brave' }) };
    await expect(loadProviderId(chosen)).resolves.toBe('brave');
  });
});
