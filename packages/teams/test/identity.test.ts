import { describe, it, expect } from 'vitest';
import {
  parseSub,
  identityFromClaims,
  anonymous,
  tenantIdentity,
} from '../src/identity';

describe('parseSub', () => {
  it('splits org/username', () => {
    expect(parseSub('acme/alice')).toEqual({ org: 'acme', username: 'alice' });
  });

  it('treats a value with no slash as a bare username', () => {
    expect(parseSub('alice')).toEqual({ username: 'alice' });
  });

  it('splits on the first slash without leaking the separator', () => {
    expect(parseSub('acme/')).toEqual({ org: 'acme' });
    expect(parseSub('/alice')).toEqual({ username: 'alice' });
    expect(parseSub('acme/team/alice')).toEqual({ org: 'acme', username: 'team/alice' });
  });

  it('returns empty for undefined', () => {
    expect(parseSub(undefined)).toEqual({});
  });
});

describe('identityFromClaims', () => {
  it('builds a signed-in identity from org/username + email', () => {
    expect(identityFromClaims({ sub: 'acme/bob', email: 'bob@acme.com' })).toEqual({
      signedIn: true,
      org: 'acme',
      username: 'bob',
      email: 'bob@acme.com',
    });
  });

  it('omits absent fields', () => {
    expect(identityFromClaims({ sub: 'solo' })).toEqual({
      signedIn: true,
      username: 'solo',
    });
  });
});

describe('tenantIdentity / anonymous', () => {
  it('is signed in when a tenant key exists', () => {
    expect(tenantIdentity(true)).toEqual({ signedIn: true });
  });
  it('is signed out with no key', () => {
    expect(tenantIdentity(false)).toEqual({ signedIn: false });
    expect(anonymous()).toEqual({ signedIn: false });
  });
});
