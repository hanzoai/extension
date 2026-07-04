import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readEnv, verifyNonce } from '../src/server';

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

describe('verifyNonce', () => {
  const secret = 'super-secret';
  const signed = '42https://app.clio.com/api/v4/matters/321.json';
  const good = createHmac('sha256', secret).update(signed).digest('hex');

  it('accepts a correctly-signed nonce', () => {
    expect(verifyNonce(signed, good, secret)).toBe(true);
  });
  it('rejects a tampered nonce', () => {
    expect(verifyNonce(signed, good.replace(/.$/, '0'), secret)).toBe(false);
  });
  it('rejects a nonce signed with the wrong secret', () => {
    const wrong = createHmac('sha256', 'other').update(signed).digest('hex');
    expect(verifyNonce(signed, wrong, secret)).toBe(false);
  });
  it('rejects a length-mismatched nonce without throwing', () => {
    expect(verifyNonce(signed, 'short', secret)).toBe(false);
  });
});
