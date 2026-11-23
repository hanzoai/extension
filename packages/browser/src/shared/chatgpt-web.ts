/**
 * ChatGPT sign-in state and plan for the popup's own account panel.
 *
 * Nothing here submits a prompt to chatgpt.com, and nothing here is reachable
 * over ZAP: HIP-1350 keeps browser logins view-only.
 */

export interface ChatGptSession {
  authenticated: boolean;
  user?: {
    id?: string;
    name?: string;
    email?: string;
    image?: string;
  };
  accessToken?: string;
  expires?: string;
  planType?: string;
  error?: string;
}

export interface ChatGptUsageInfo {
  planType?: string;
  primaryWindow?: {
    usedPercent: number;
    resetsAt?: string;
    windowMinutes?: number;
  };
  secondaryWindow?: {
    usedPercent: number;
    resetsAt?: string;
    windowMinutes?: number;
  };
}

/** Check if user has an active session on chatgpt.com */
export async function getChatGptSession(): Promise<ChatGptSession> {
  try {
    // Check if any chatgpt tab is open first
    const tabs = await chrome.tabs.query({ url: '*://chatgpt.com/*' });
    if (tabs.length > 0 && tabs[0].id) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: async () => {
          try {
            const res = await fetch('/api/auth/session');
            if (!res.ok) return null;
            return await res.json();
          } catch {
            return null;
          }
        },
      });
      const data = results?.[0]?.result;
      if (data?.accessToken) {
        return {
          authenticated: true,
          user: data.user ? {
            id: data.user.id || '',
            name: data.user.name || '',
            email: data.user.email || '',
            image: data.user.image || data.user.picture,
          } : undefined,
          accessToken: data.accessToken,
          expires: data.expires,
          planType: 'plus',
        };
      }
    }

    // Direct background fetch fallback
    const res = await fetch('https://chatgpt.com/api/auth/session', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    if (!res.ok) {
      return {
        authenticated: false,
        error: res.status === 401 || res.status === 403
          ? 'Not signed in to chatgpt.com'
          : `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    if (!data?.accessToken) {
      return { authenticated: false, error: 'No active session token on chatgpt.com' };
    }

    return {
      authenticated: true,
      user: data.user ? {
        id: data.user.id || '',
        name: data.user.name || '',
        email: data.user.email || '',
        image: data.user.image || data.user.picture,
      } : undefined,
      accessToken: data.accessToken,
      expires: data.expires,
      planType: 'plus',
    };
  } catch (err: any) {
    return {
      authenticated: false,
      error: err?.message || 'Failed to reach chatgpt.com',
    };
  }
}

/** Fetch detailed usage and rate limits from ChatGPT backend */
export async function getChatGptUsage(): Promise<ChatGptUsageInfo | null> {
  try {
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = await res.json();

    const toWindow = (w?: any) => {
      if (!w || typeof w.used_percent !== 'number') return undefined;
      return {
        usedPercent: Math.round(w.used_percent),
        windowMinutes: w.limit_window_seconds ? Math.round(w.limit_window_seconds / 60) : undefined,
        resetsAt: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : undefined,
      };
    };

    return {
      planType: body.plan_type || 'plus',
      primaryWindow: toWindow(body.rate_limit?.primary_window),
      secondaryWindow: toWindow(body.rate_limit?.secondary_window),
    };
  } catch {
    return null;
  }
}
