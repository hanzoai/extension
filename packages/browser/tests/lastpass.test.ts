// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LASTPASS_EXTENSION_ID, LASTPASS_METHODS, handleLastPass } from '../src/shared/lastpass.js';
import '../src/page.js';

describe('Native LastPass extension automation (src/shared/lastpass.ts)', () => {
  const SENTINEL_COOKIE_SECRET = 'SUPER_SECRET_COOKIE_VALUE_DO_NOT_LEAK_991';
  const SENTINEL_VAULT_PASSWORD = 'ULTRA_SECRET_VAULT_PASSWORD_NEVER_OVER_ZAP_772';

  it('registers all four ZAP LastPass methods', () => {
    expect([...LASTPASS_METHODS]).toEqual([
      'lastpass.status',
      'lastpass.openIcon',
      'lastpass.accounts',
      'lastpass.fill',
    ]);
  });

  it('lastpass.status reports extension presence, vault tab, and cookie NAMES only (never values)', async () => {
    const fakeApi = {
      tabs: {
        query: async () => [
          { id: 10, url: 'https://x.com/i/flow/login', status: 'complete' },
          { id: 20, url: 'https://lastpass.com/?ac=1', status: 'complete' },
        ],
      },
      management: {
        get: async (id: string) => ({ id, enabled: id === LASTPASS_EXTENSION_ID }),
      },
      cookies: {
        getAll: async () => [
          { name: 'PHPSESSID', value: SENTINEL_COOKIE_SECRET, domain: '.lastpass.com' },
          { name: 'LPMS', value: SENTINEL_COOKIE_SECRET, domain: 'lastpass.com' },
        ],
      },
      scripting: {
        executeScript: async () => [{ result: true }],
      },
    };

    const res = await handleLastPass(fakeApi, 'lastpass.status', { tabId: 10 });
    expect(res).toEqual({
      extensionId: LASTPASS_EXTENSION_ID,
      extensionDetected: true,
      iconDetectedOnTab: true,
      vaultTabOpen: true,
      vaultTabId: 20,
      vaultSignedIn: true,
      cookieNames: ['PHPSESSID', 'LPMS'],
    });
    expect(JSON.stringify(res)).not.toContain(SENTINEL_COOKIE_SECRET);
  });

  it('lastpass.accounts extracts LPProxy/g_sites metadata and NEVER returns passwords', async () => {
    let openedUrls: string[] = [];
    const fakeApi = {
      tabs: {
        query: async () => [],
        create: async ({ url }: { url: string }) => {
          openedUrls.push(url);
          return { id: 33, url, status: 'complete' };
        },
        get: async (id: number) => ({ id, url: 'https://lastpass.com/?ac=1', status: 'complete' }),
      },
      scripting: {
        executeScript: async ({ func, args }: any) => {
          const prevLP = (globalThis as any).LPProxy;
          (globalThis as any).LPProxy = {
            getSites: () => [
              {
                aid: 'acc-1',
                name: 'Twitter',
                username: 'hanzoai',
                url: 'https://twitter.com/login',
                group: 'Social',
                password: SENTINEL_VAULT_PASSWORD,
              },
              {
                aid: 'acc-2',
                name: 'GitHub',
                username: 'hanzo-bot',
                url: 'https://github.com/login',
                group: 'Engineering',
                password: SENTINEL_VAULT_PASSWORD,
              },
            ],
          };
          try {
            return [{ result: func(...(args || [])) }];
          } finally {
            (globalThis as any).LPProxy = prevLP;
          }
        },
      },
    };

    const res = await handleLastPass(fakeApi, 'lastpass.accounts', {
      url: 'https://x.com/i/flow/login',
      username: 'hanzoai',
      openVaultIfNeeded: true,
    });

    expect(openedUrls).toEqual(['https://lastpass.com/?ac=1']);
    expect(res).toEqual({
      vaultTabOpen: true,
      vaultTabId: 33,
      accounts: [
        {
          id: 'acc-1',
          name: 'Twitter',
          username: 'hanzoai',
          url: 'https://twitter.com/login',
          group: 'Social',
        },
      ],
    });
    expect(JSON.stringify(res)).not.toContain(SENTINEL_VAULT_PASSWORD);
  });

  it('lastpass.openIcon locates [data-lastpass-icon-root] shadow svg and clicks cleanly', async () => {
    document.body.innerHTML = `<input name="text"><div data-lastpass-icon-root="true" id="lp-root"></div>`;
    const host = document.getElementById('lp-root')!;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = `<svg id="lp-svg"></svg><rect id="lp-rect"></rect>`;
    const svg = sr.getElementById('lp-svg')!;
    const rect = sr.getElementById('lp-rect')!;

    for (const el of [host, svg, rect]) {
      el.getBoundingClientRect = () => ({
        x: 100, y: 100, left: 100, top: 100, width: 16, height: 16, right: 116, bottom: 116, toJSON() {},
      }) as DOMRect;
    }
    (document as any).elementFromPoint = () => host;
    (sr as any).elementFromPoint = () => rect;
    Element.prototype.scrollIntoView = () => {};

    let iconClicked = false;
    sr.addEventListener('click', () => { iconClicked = true; });

    const fakeApi = {
      tabs: {
        get: async (id: number) => ({ id, url: 'https://x.com/i/flow/login', status: 'complete' }),
      },
      scripting: {
        executeScript: async ({ func, args }: any) => {
          if (typeof func === 'function') {
            return [{ result: func(...(args || [])) }];
          }
          return [{ result: null }];
        },
      },
    };

    try {
      const out = await handleLastPass(fakeApi, 'lastpass.openIcon', { tabId: 5 });
      expect(out.success).toBe(true);
      expect(out.selector).toBe('[data-hanzo-lp-icon="1"] >>> svg');
      expect(iconClicked).toBe(true);
      expect(host.hasAttribute('data-hanzo-lp-icon')).toBe(false);
    } finally {
      delete (document as any).elementFromPoint;
      delete (sr as any).elementFromPoint;
      document.body.innerHTML = '';
    }
  });

  it('lastpass.fill fills username + password inside background worker without leaking password in response', async () => {
    document.body.innerHTML = `
      <form>
        <input id="login-user" name="username" type="text" />
        <input id="login-pass" name="password" type="password" />
      </form>
    `;
    const userInp = document.getElementById('login-user') as HTMLInputElement;
    const passInp = document.getElementById('login-pass') as HTMLInputElement;
    for (const el of [userInp, passInp]) {
      el.getBoundingClientRect = () => ({
        x: 10, y: 10, left: 10, top: 10, width: 200, height: 30, right: 210, bottom: 40, toJSON() {},
      }) as DOMRect;
    }

    const fakeApi = {
      tabs: {
        query: async () => [
          { id: 11, url: 'https://x.com/login', active: true, status: 'complete' },
          { id: 22, url: 'https://lastpass.com/vault', active: false, status: 'complete' },
        ],
        get: async (id: number) => ({
          id,
          url: id === 22 ? 'https://lastpass.com/vault' : 'https://x.com/login',
          status: 'complete',
        }),
      },
      scripting: {
        executeScript: async ({ target, func, args }: any) => {
          if (target.tabId === 22) {
            const prevG = (globalThis as any).g_sites;
            (globalThis as any).g_sites = [
              {
                aid: 'site-x',
                name: 'X',
                un: 'hanzoai',
                url: 'https://x.com',
                group: 'Social',
                pw: SENTINEL_VAULT_PASSWORD,
              },
            ];
            try {
              return [{ result: func(...(args || [])) }];
            } finally {
              (globalThis as any).g_sites = prevG;
            }
          }
          if (typeof func === 'function') {
            return [{ result: func(...(args || [])) }];
          }
          return [{ result: null }];
        },
      },
    };

    try {
      const res = await handleLastPass(fakeApi, 'lastpass.fill', {
        tabId: 11,
        username: 'hanzoai',
      });

      expect(userInp.value).toBe('hanzoai');
      expect(passInp.value).toBe(SENTINEL_VAULT_PASSWORD);
      expect(res).toEqual({
        success: true,
        tabId: 11,
        matched: {
          id: 'site-x',
          name: 'X',
          username: 'hanzoai',
          url: 'https://x.com',
          group: 'Social',
        },
        filledUsername: true,
        filledPassword: true,
      });
      // Zero password ever crosses ZAP!
      expect(JSON.stringify(res)).not.toContain(SENTINEL_VAULT_PASSWORD);
    } finally {
      document.body.innerHTML = '';
    }
  });
});
