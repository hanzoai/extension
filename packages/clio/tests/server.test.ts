import { describe, it, expect } from 'vitest';
import { readEnv, customActionRedirect } from '../src/server';

describe('readEnv', () => {
  const good = {
    CLIO_CLIENT_ID: 'CID',
    CLIO_CLIENT_SECRET: 'SECRET',
    CLIO_REDIRECT_URI: 'https://clio.hanzo.ai/oauth/callback',
  };

  it('reads a complete environment with region + port defaults', () => {
    const env = readEnv(good as any);
    expect(env.clientId).toBe('CID');
    expect(env.clientSecret).toBe('SECRET');
    expect(env.redirectUri).toBe('https://clio.hanzo.ai/oauth/callback');
    expect(env.region).toBe('us');
    expect(env.port).toBe(8787);
  });

  it('honors CLIO_REGION and PORT overrides', () => {
    const env = readEnv({ ...good, CLIO_REGION: 'eu', PORT: '9000' } as any);
    expect(env.region).toBe('eu');
    expect(env.port).toBe(9000);
  });

  it('throws fast when a required secret is missing (no silent default)', () => {
    expect(() => readEnv({ CLIO_CLIENT_ID: 'x' } as any)).toThrow(/required/);
    expect(() => readEnv({ CLIO_CLIENT_ID: 'x', CLIO_CLIENT_SECRET: 'y' } as any)).toThrow(/required/);
  });
});

describe('customActionRedirect', () => {
  it('redirects a matter deep-link to the SPA carrying matter_id + nonce', () => {
    const search = new URLSearchParams({
      custom_action_id: '7',
      user_id: '42',
      subject_url: encodeURIComponent('/api/v4/matters/321'),
      custom_action_nonce: 'NONCE1',
    });
    const dest = customActionRedirect(search);
    const u = new URL(dest, 'https://clio.hanzo.ai');
    expect(u.pathname).toBe('/index.html');
    expect(u.searchParams.get('matter_id')).toBe('321');
    expect(u.searchParams.get('custom_action_nonce')).toBe('NONCE1');
  });

  it('omits the nonce param when Clio sent none', () => {
    const search = new URLSearchParams({ subject_url: '/api/v4/matters/9' });
    const u = new URL(customActionRedirect(search), 'https://clio.hanzo.ai');
    expect(u.searchParams.get('matter_id')).toBe('9');
    expect(u.searchParams.has('custom_action_nonce')).toBe(false);
  });

  it('returns empty for a non-matter deep-link (nothing to open)', () => {
    expect(customActionRedirect(new URLSearchParams({ subject_url: '/api/v4/contacts/9' }))).toBe('');
    expect(customActionRedirect(new URLSearchParams())).toBe('');
  });
});
