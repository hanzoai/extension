/**
 * Social & Business App Web Session Discovery & Browser-Driven Publishing via ZAP
 *
 * Uses the signed-in browser's native cookie jar (chrome.cookies) and tab execution
 * so agents can check session state (`social.sessions`), sync accounts to Hanzo Social /
 * Hanzo Post (`social.sync`), and publish posts (`social.post`) without ever exporting
 * plaintext credentials or cookie values to disk or wire output.
 */

export interface SocialSessionStatus {
  provider: string;
  domain: string;
  authenticated: boolean;
  cookieNames?: string[];
  handle?: string;
}

interface SessionDomainSpec {
  provider: string;
  domain: string;
  domains?: string[];
  authCookies: string[];
  composeUrl: string;
}

const GOOGLE_AUTH_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID', '__Secure-3PAPISID'];

export const SOCIAL_DOMAINS: SessionDomainSpec[] = [
  // Social & Developer Publishing Channels
  { provider: 'x', domain: 'x.com', domains: ['x.com', 'twitter.com'], authCookies: ['auth_token', 'ct0'], composeUrl: 'https://x.com/compose/post' },
  { provider: 'linkedin', domain: 'linkedin.com', authCookies: ['li_at'], composeUrl: 'https://www.linkedin.com/feed/?shareActive=true' },
  { provider: 'youtube', domain: 'youtube.com', domains: ['youtube.com', 'google.com'], authCookies: ['SAPISID', '__Secure-3PAPISID'], composeUrl: 'https://studio.youtube.com' },
  { provider: 'instagram', domain: 'instagram.com', authCookies: ['sessionid'], composeUrl: 'https://www.instagram.com/' },
  { provider: 'threads', domain: 'threads.com', domains: ['threads.com', 'threads.net'], authCookies: ['sessionid'], composeUrl: 'https://www.threads.com/intent/post' },
  { provider: 'tiktok', domain: 'tiktok.com', authCookies: ['sessionid', 'sessionid_ss'], composeUrl: 'https://www.tiktok.com/tiktokstudio/upload' },
  { provider: 'reddit', domain: 'reddit.com', authCookies: ['reddit_session', 'token_v2'], composeUrl: 'https://www.reddit.com/submit' },
  { provider: 'facebook', domain: 'facebook.com', authCookies: ['c_user', 'xs'], composeUrl: 'https://www.facebook.com/' },
  { provider: 'github', domain: 'github.com', authCookies: ['user_session', '__Host-user_session_same_site'], composeUrl: 'https://github.com/' },
  { provider: 'devto', domain: 'dev.to', authCookies: ['remember_user_token', '_Devto_Forem_Session'], composeUrl: 'https://dev.to/new' },
  { provider: 'medium', domain: 'medium.com', authCookies: ['uid', 'sid'], composeUrl: 'https://medium.com/new-story' },
  { provider: 'hashnode', domain: 'hashnode.com', authCookies: ['token', '__Secure-next-auth.session-token'], composeUrl: 'https://hashnode.com/draft' },

  // Vault & Compatible Business Apps
  { provider: 'lastpass', domain: 'lastpass.com', authCookies: ['PHPSESSID', 'lpsession', 'LPMS'], composeUrl: 'https://lastpass.com/?ac=1' },
  { provider: 'gmail', domain: 'mail.google.com', domains: ['mail.google.com', 'google.com'], authCookies: [...GOOGLE_AUTH_COOKIES, 'OSID'], composeUrl: 'https://mail.google.com/mail/u/0/' },
  { provider: 'google_calendar', domain: 'calendar.google.com', domains: ['calendar.google.com', 'google.com'], authCookies: GOOGLE_AUTH_COOKIES, composeUrl: 'https://calendar.google.com/' },
  { provider: 'google_drive', domain: 'drive.google.com', domains: ['drive.google.com', 'google.com'], authCookies: GOOGLE_AUTH_COOKIES, composeUrl: 'https://drive.google.com/drive/my-drive' },
  { provider: 'salesforce', domain: 'salesforce.com', domains: ['salesforce.com', 'force.com'], authCookies: ['sid'], composeUrl: 'https://login.salesforce.com/' },
  { provider: 'microsoft_teams', domain: 'teams.microsoft.com', domains: ['teams.microsoft.com', 'cloud.microsoft', 'login.microsoftonline.com'], authCookies: ['ESTSAUTHPERSISTENT', 'ESTSAUTH', 'skypetoken_asm', 'TSAUTHCOOKIE'], composeUrl: 'https://teams.microsoft.com/v2/' },
  { provider: 'google_forms', domain: 'docs.google.com', domains: ['docs.google.com', 'google.com'], authCookies: GOOGLE_AUTH_COOKIES, composeUrl: 'https://docs.google.com/forms/' },
  { provider: 'woocommerce', domain: 'woocommerce.com', domains: ['woocommerce.com', 'wordpress.com'], authCookies: ['wordpress_logged_in_*', 'wp_woocommerce_session_*'], composeUrl: 'https://woocommerce.com/my-dashboard/' },
  { provider: 'intercom', domain: 'app.intercom.com', domains: ['app.intercom.com', 'intercom.com', 'intercom.io'], authCookies: ['_intercom_session', 'intercom_session'], composeUrl: 'https://app.intercom.com/' },
  { provider: 'facebook_lead_ads', domain: 'business.facebook.com', domains: ['business.facebook.com', 'facebook.com'], authCookies: ['c_user', 'xs'], composeUrl: 'https://business.facebook.com/latest/instant_forms' },
  { provider: 'docusign', domain: 'docusign.com', domains: ['apps.docusign.com', 'docusign.com', 'docusign.net'], authCookies: ['DSAuth', 'DSID', '.ASPXAUTH', 'ds_session'], composeUrl: 'https://apps.docusign.com/send/home' },
  { provider: 'google_ads', domain: 'ads.google.com', domains: ['ads.google.com', 'google.com'], authCookies: GOOGLE_AUTH_COOKIES, composeUrl: 'https://ads.google.com/aw/overview' },
  { provider: 'klaviyo', domain: 'klaviyo.com', authCookies: ['kl_sessionid', 'sessionid', '__Secure-kl_session'], composeUrl: 'https://www.klaviyo.com/dashboard' },
  { provider: 'quickbooks', domain: 'qbo.intuit.com', domains: ['qbo.intuit.com', 'intuit.com'], authCookies: ['qbn.ticket', 'qbo.ticket', 'ius_session', 'intuit_icket'], composeUrl: 'https://app.qbo.intuit.com/app/homepage' },
  { provider: 'google_analytics', domain: 'analytics.google.com', domains: ['analytics.google.com', 'google.com'], authCookies: GOOGLE_AUTH_COOKIES, composeUrl: 'https://analytics.google.com/analytics/web/' },
];

function matchAuthCookieNames(presentNames: Set<string>, patterns: string[]): string[] {
  const matched: string[] = [];
  for (const pat of patterns) {
    if (pat.endsWith('*')) {
      const prefix = pat.slice(0, -1);
      for (const name of presentNames) {
        if (name.startsWith(prefix) && !matched.includes(name)) matched.push(name);
      }
    } else if (presentNames.has(pat) && !matched.includes(pat)) {
      matched.push(pat);
    }
  }
  return matched;
}

export async function getSocialSessions(): Promise<SocialSessionStatus[]> {
  if (typeof chrome === 'undefined' || !chrome.cookies) {
    return [];
  }

  const results: SocialSessionStatus[] = [];
  for (const net of SOCIAL_DOMAINS) {
    try {
      const checkDomains = net.domains && net.domains.length > 0 ? net.domains : [net.domain];
      const names = new Set<string>();
      for (const domain of checkDomains) {
        const cookies = await chrome.cookies.getAll({ domain });
        for (const c of cookies) {
          if (c?.name) names.add(c.name);
        }
      }
      const matched = matchAuthCookieNames(names, net.authCookies);
      results.push({
        provider: net.provider,
        domain: net.domain,
        authenticated: matched.length > 0,
        cookieNames: matched,
      });
    } catch {
      results.push({
        provider: net.provider,
        domain: net.domain,
        authenticated: false,
        cookieNames: [],
      });
    }
  }
  return results;
}

export async function syncSocialAccounts(params?: {
  apiEndpoint?: string;
  token?: string;
}): Promise<{ synced: number; sessions: SocialSessionStatus[] }> {
  const sessions = await getSocialSessions();
  const endpoint = (params?.apiEndpoint || 'https://api.hanzo.ai').replace(/\/+$/, '');
  const token = params?.token;
  let synced = 0;

  if (token) {
    for (const s of sessions) {
      if (!s.authenticated) continue;
      try {
        const res = await fetch(`${endpoint}/v1/social/accounts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            provider: s.provider,
            handle: s.handle || `@hanzoai`,
            status: 'connected',
          }),
        });
        if (res.ok) synced++;
      } catch {
        // ignore network errors for unsupported provider identifiers
      }
    }
  }

  return { synced, sessions };
}

export async function executeSocialPost(params: {
  provider: string;
  content: string;
  title?: string;
  dryRun?: boolean;
}): Promise<{ success: boolean; provider: string; tabId?: number; url?: string }> {
  const target = SOCIAL_DOMAINS.find((d) => d.provider === params.provider);
  if (!target) {
    throw new Error(`Unsupported social provider: ${params.provider}`);
  }

  let composeUrl = target.composeUrl;
  if (params.provider === 'x') {
    composeUrl = `https://x.com/intent/post?text=${encodeURIComponent(params.content)}`;
  } else if (params.provider === 'threads') {
    composeUrl = `https://www.threads.com/intent/post?text=${encodeURIComponent(params.content)}`;
  } else if (params.provider === 'reddit' && params.title) {
    composeUrl = `https://www.reddit.com/submit?title=${encodeURIComponent(params.title)}&text=${encodeURIComponent(params.content)}`;
  }

  const tab = await chrome.tabs.create({ url: composeUrl, active: !params.dryRun });
  return {
    success: true,
    provider: params.provider,
    tabId: tab.id,
    url: composeUrl,
  };
}
