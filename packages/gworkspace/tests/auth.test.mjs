import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authorizeURL, tokenURL, DEFAULT_SCOPES } from '@hanzo/auth';
import { loadGs } from './loadGs.mjs';

// stubs stands in for the Apps Script services auth.gs reaches. The OAuth2
// service records every setter it is configured with and loses access once
// reset; the authorization exception records what the prompt was built from
// and throws it.
function stubs({ access }) {
  const calls = {};
  const service = new Proxy(
    {},
    {
      get(_, name) {
        if (name === 'hasAccess') return () => access && !calls.reset;
        if (name === 'getAccessToken') return () => 'iam-access-token';
        if (name === 'getAuthorizationUrl') return () => 'https://hanzo.id/v1/iam/oauth/authorize?state=s';
        if (name === 'reset') return () => (calls.reset = true);
        return (...args) => {
          calls[name] = args;
          return service;
        };
      },
    }
  );
  const prompt = {};
  const exception = new Proxy(
    {},
    {
      get(_, name) {
        return (arg) => {
          if (name === 'throwException') throw Object.assign(new Error('sign-in'), { prompt });
          prompt[name] = arg;
          return exception;
        };
      },
    }
  );
  return {
    calls,
    globals: {
      OAuth2: { createService: (name) => ((calls.createService = [name]), service) },
      Utilities: { getUuid: () => randomUUID() },
      PropertiesService: { getUserProperties: () => 'user-properties' },
      CacheService: { getUserCache: () => 'user-cache' },
      LockService: { getUserLock: () => 'user-lock' },
      CardService: { newAuthorizationException: () => exception },
    },
  };
}

describe('Hanzo IAM client', () => {
  const auth = loadGs('src/auth.gs');

  it('is hanzo-gworkspace on the same HIP-0111 endpoints as @hanzo/auth', () => {
    expect(auth.IAM_CLIENT_ID).toBe('hanzo-gworkspace');
    expect(auth.IAM_AUTHORIZE_URL).toBe(authorizeURL());
    expect(auth.IAM_TOKEN_URL).toBe(tokenURL());
    expect(auth.IAM_SCOPES).toBe(DEFAULT_SCOPES);
  });

  it('configures the OAuth2 service as a public PKCE client', () => {
    const { calls, globals } = stubs({ access: true });
    loadGs('src/auth.gs', globals).hanzoService_();
    expect(calls.createService).toEqual(['hanzo']);
    expect(calls.setClientId).toEqual(['hanzo-gworkspace']);
    expect(calls.setAuthorizationBaseUrl).toEqual(['https://hanzo.id/v1/iam/oauth/authorize']);
    expect(calls.setTokenUrl).toEqual(['https://api.hanzo.ai/v1/iam/oauth/token']);
    expect(calls.setScope).toEqual(['openid profile email offline_access']);
    expect(calls.setCallbackFunction).toEqual(['authCallback']);
    expect(calls.setPropertyStore).toEqual(['user-properties']);
    expect(calls.setCache).toEqual(['user-cache']);
    expect(calls.setLock).toEqual(['user-lock']);
    expect(calls.setClientSecret).toBeUndefined();
  });

  it('sets an RFC 7636 verifier drawn from getUuid, fresh per service', () => {
    const a = stubs({ access: true });
    loadGs('src/auth.gs', a.globals).hanzoService_();
    const b = stubs({ access: true });
    loadGs('src/auth.gs', b.globals).hanzoService_();
    const [verifier] = a.calls.setCodeVerififer;
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(b.calls.setCodeVerififer[0]).not.toBe(verifier);
  });

  it('sends no client_secret on a token request', () => {
    const { calls, globals } = stubs({ access: true });
    loadGs('src/auth.gs', globals).hanzoService_();
    const [handler] = calls.setTokenPayloadHandler;
    expect(handler({ code: 'c', client_id: 'hanzo-gworkspace', client_secret: undefined })).toEqual({
      code: 'c',
      client_id: 'hanzo-gworkspace',
    });
  });

  it('returns the access token when signed in', () => {
    const { globals } = stubs({ access: true });
    expect(loadGs('src/auth.gs', globals).accessToken()).toBe('iam-access-token');
  });

  it('throws the custom sign-in prompt when signed out', () => {
    const { globals } = stubs({ access: false });
    const err = (() => {
      try {
        loadGs('src/auth.gs', globals).accessToken();
      } catch (e) {
        return e;
      }
    })();
    expect(err.prompt).toEqual({
      setAuthorizationUrl: 'https://hanzo.id/v1/iam/oauth/authorize?state=s',
      setResourceDisplayName: 'Hanzo',
      setCustomUiCallback: 'onSignInCard',
    });
  });

  it('signOut drops the session, then prompts', () => {
    const { calls, globals } = stubs({ access: true });
    expect(() => loadGs('src/auth.gs', globals).signOut()).toThrow('sign-in');
    expect(calls.reset).toBe(true);
  });
});

describe('one credential', () => {
  it('no API key path is left in the add-on', () => {
    const src = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    for (const f of readdirSync(src)) {
      expect(readFileSync(resolve(src, f), 'utf8'), f).not.toMatch(/api[-_ ]?key|\bsk-/i);
    }
  });
});
