import { describe, it, expect } from 'vitest';
import { authorizeURL, tokenURL, userinfoURL, CLIENTS } from '../src/config';
import { authClientFor } from '../src/index';

describe('canonical HIP-0111 endpoints — the drift guard', () => {
  it('authorize/token/userinfo ALL carry the /v1/iam prefix', () => {
    // This is the exact bug that shipped in vscode: hanzo.id/oauth/authorize,
    // missing /v1/iam. Pin every path so it can never regress.
    expect(authorizeURL()).toBe('https://hanzo.id/v1/iam/oauth/authorize');
    expect(tokenURL()).toBe('https://api.hanzo.ai/v1/iam/oauth/token');
    expect(userinfoURL()).toBe('https://api.hanzo.ai/v1/iam/oauth/userinfo');
    // The prefix used to be asserted a second time as a bare IAM_API_PATH
    // constant. That constant is gone — the paths come from @hanzo/iam now, so
    // there is nothing local left to drift, and these three URLs already pin
    // the prefix they are actually built from.
  });

  it('a custom issuer keeps the /v1/iam prefix', () => {
    expect(authorizeURL('https://id.acme.test')).toBe('https://id.acme.test/v1/iam/oauth/authorize');
    expect(tokenURL('https://iam.acme.test/')).toBe('https://iam.acme.test/v1/iam/oauth/token');
  });
});

describe('surface client registry — one client per surface', () => {
  it('every surface has a distinct hanzo-<surface> id', () => {
    expect(CLIENTS.browser.id).toBe('hanzo-browser');
    expect(CLIENTS.office.id).toBe('hanzo-office');
    expect(CLIENTS.vscode.id).toBe('hanzo-vscode');
    expect(CLIENTS.cli.id).toBe('hanzo-cli');
    const ids = Object.values(CLIENTS).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('authClientFor resolves id + redirect and honors overrides', () => {
    const c = authClientFor('office');
    expect(c.clientId).toBe('hanzo-office');
    expect(c.redirectUri).toBe('https://office.hanzo.ai/auth-callback.html');
    expect(authClientFor('office', { redirectUri: 'https://localhost:3000/cb' }).redirectUri).toBe(
      'https://localhost:3000/cb',
    );
  });
});
