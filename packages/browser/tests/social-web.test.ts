import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SOCIAL_DOMAINS, getSocialSessions } from '../src/shared/social-web';

describe('social-web session discovery', () => {
  const prevChrome = (globalThis as any).chrome;

  beforeEach(() => {
    const cookieJar: Record<string, Array<{ name: string; value: string }>> = {
      'threads.com': [{ name: 'sessionid', value: 'SECRET_THREADS_COOKIE' }],
      'dev.to': [{ name: '_Devto_Forem_Session', value: 'SECRET_DEVTO_COOKIE' }],
      'google.com': [{ name: 'SID', value: 'SECRET_GOOGLE_COOKIE' }],
      'force.com': [{ name: 'sid', value: 'SECRET_SFDC_COOKIE' }],
      'lastpass.com': [{ name: 'lpsession', value: 'SECRET_LP_COOKIE' }],
      'wordpress.com': [{ name: 'wordpress_logged_in_99abc', value: 'SECRET_WP_COOKIE' }],
    };

    (globalThis as any).chrome = {
      cookies: {
        getAll: async ({ domain }: { domain: string }) => cookieJar[domain] || [],
      },
    };
  });

  afterEach(() => {
    (globalThis as any).chrome = prevChrome;
  });

  it('includes lastpass, socials, and all 16 compatible business apps', () => {
    const providers = new Set(SOCIAL_DOMAINS.map((d) => d.provider));
    const expected = [
      'lastpass',
      'gmail',
      'google_calendar',
      'google_drive',
      'salesforce',
      'microsoft_teams',
      'github',
      'google_forms',
      'woocommerce',
      'intercom',
      'facebook_lead_ads',
      'docusign',
      'google_ads',
      'klaviyo',
      'linkedin',
      'quickbooks',
      'google_analytics',
      'x',
      'youtube',
      'instagram',
      'threads',
      'tiktok',
      'reddit',
      'facebook',
      'devto',
      'medium',
      'hashnode',
    ];
    for (const id of expected) {
      expect(providers.has(id)).toBe(true);
    }
  });

  it('checks both threads.com and threads.net, devto _Devto_Forem_Session, and never leaks cookie values', async () => {
    const sessions = await getSocialSessions();
    const rawJson = JSON.stringify(sessions);
    expect(rawJson).not.toContain('SECRET_');

    const byProvider = new Map(sessions.map((s) => [s.provider, s]));
    expect(byProvider.get('threads')?.authenticated).toBe(true);
    expect(byProvider.get('devto')?.authenticated).toBe(true);
    expect(byProvider.get('devto')?.cookieNames).toEqual(['_Devto_Forem_Session']);
    expect(byProvider.get('gmail')?.authenticated).toBe(true);
    expect(byProvider.get('salesforce')?.authenticated).toBe(true);
    expect(byProvider.get('lastpass')?.authenticated).toBe(true);
    expect(byProvider.get('woocommerce')?.authenticated).toBe(true);
    expect(byProvider.get('klaviyo')?.authenticated).toBe(false);
  });
});
