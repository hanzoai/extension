import { describe, expect, it, vi } from 'vitest';
import {
  getVaultStatus,
  fillFieldFromKms,
  vaultEgressFetch,
} from '../src/shared/vault.js';

describe('Unified Password & KMS Vault', () => {
  it('detects LastPass and 1Password extensions and redacts login field values', async () => {
    const fakeApi = {
      management: {
        getAll: (cb: any) => cb([
          { id: 'hdokiejnpimakedhajhdlcegeplioahd', name: 'LastPass', enabled: true, version: '4.157.0' },
          { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password', enabled: true, version: '8.11.0' },
        ]),
      },
      scripting: {
        executeScript: async () => [{
          result: {
            lastpassDetected: true,
            onepasswordDetected: false,
            hasUsernameField: true,
            usernameFilled: true,
            hasPasswordField: true,
            passwordFilled: true,
          },
        }],
      },
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/v1/kms/health')) {
        return new Response(JSON.stringify({ ready: true }), { status: 200 });
      }
      if (String(url).includes('/v1/kms/secrets')) {
        return new Response(JSON.stringify({ names: ['X_API_KEY', 'POST_TOKEN'] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      const status: any = await getVaultStatus(fakeApi, {
        tabId: 10,
        getToken: async () => 'iam-tok',
        org: 'hanzo',
      });
      expect(status.managers).toHaveLength(2);
      expect(status.managers[0]).toMatchObject({ id: 'lastpass', installed: true, enabled: true, detectedOnPage: true });
      expect(status.managers[1]).toMatchObject({ id: '1password', installed: true, enabled: true });
      expect(status.kms).toMatchObject({ ready: true, authenticated: true, secretCount: 2 });
      expect(status.pageLogin).toMatchObject({ usernameFilled: true, passwordFilled: true });
      expect(JSON.stringify(status)).not.toContain('iam-tok');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('fills DOM inputs from Hanzo KMS without returning secret plaintext and scrubs egress responses', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const u = String(url);
      if (u.includes('/v1/kms/secrets/social/X_BEARER')) {
        return new Response(JSON.stringify({ value: 'super_secret_token_999' }), { status: 200 });
      }
      if (u === 'https://api.example.com/echo') {
        return new Response(JSON.stringify({ authSeen: init?.headers?.Authorization }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    try {
      let injectedArgs: any[] = [];
      const fakeApi = {
        scripting: {
          executeScript: async ({ args }: any) => {
            injectedArgs = args;
            return [{ result: { ok: true, tagName: 'input' } }];
          },
        },
      };

      const filled = await fillFieldFromKms(fakeApi, 42, 'iam-jwt', {
        selector: '#api-key',
        path: 'social',
        name: 'X_BEARER',
      });
      expect(injectedArgs).toEqual(['#api-key', 'super_secret_token_999']);
      expect(filled).toEqual({
        filled: true,
        selector: '#api-key',
        secret: 'social/X_BEARER',
        env: 'default',
        redacted: true,
      });
      expect(JSON.stringify(filled)).not.toContain('super_secret_token_999');

      const egress = await vaultEgressFetch('iam-jwt', {
        url: 'https://api.example.com/echo',
        headers: { Authorization: 'Bearer {{kms:social/X_BEARER}}' },
      });
      expect(egress.ok).toBe(true);
      expect(egress.injectedSecrets).toEqual(['social/X_BEARER']);
      expect(String(egress.body)).toContain('[REDACTED_KMS_SECRET]');
      expect(String(egress.body)).not.toContain('super_secret_token_999');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
