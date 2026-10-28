/**
 * ChatGPT Web bridge & invisible temporary chat executor.
 *
 * Re-uses the user's paid ChatGPT Plus browser session for inference,
 * local Hanzo Bot, and Hanzo Dev without leaving any chat history or
 * cluttering the user's ChatGPT sidebar (?temporary-chat=true).
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

/**
 * Execute completion via ChatGPT invisible temporary chat.
 * Opens an inactive temporary-chat tab, sends the prompt, extracts the response,
 * and closes the tab — keeping history and sidebar clean.
 */
export async function executeInvisibleChatGpt(
  prompt: string,
  messages: Array<{ role: string; content: string }> = []
): Promise<string> {
  if (!prompt.trim()) throw new Error('Prompt cannot be empty');

  // Format context if conversation history provided
  let fullPrompt = prompt;
  if (messages.length > 1) {
    const history = messages
      .slice(0, -1)
      .filter((m) => m && m.content)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    fullPrompt = `${history}\n\nUSER: ${prompt}`;
  }

  // Create an inactive tab with temporary chat enabled
  const tab = await chrome.tabs.create({
    url: 'https://chatgpt.com/?temporary-chat=true',
    active: false,
  });

  if (!tab.id) throw new Error('Could not create background ChatGPT tab');
  const tabId = tab.id;

  try {
    // Wait for page to finish loading
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Timeout waiting for ChatGPT to load'));
      }, 15000);

      const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
        if (updatedId === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Small delay for React mounting
    await new Promise((r) => setTimeout(r, 1200));

    // Execute input and submission inside the tab
    const sendResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (textToSend: string) => {
        // Find input textarea or contenteditable
        const el = document.querySelector('p[data-placeholder="Ask ChatGPT"]') ||
          document.querySelector('#prompt-textarea') ||
          document.querySelector('div[contenteditable="true"]');
        if (!el) return { success: false, error: 'Could not find prompt input on ChatGPT' };

        // Focus and set text
        el.textContent = textToSend;
        el.dispatchEvent(new Event('input', { bubbles: true }));

        // Trigger Enter key
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }));

        // Also attempt to click send button if available
        setTimeout(() => {
          const sendBtn = document.querySelector('button[data-testid="send-button"]') as HTMLButtonElement;
          if (sendBtn && !sendBtn.disabled) sendBtn.click();
        }, 150);

        return { success: true };
      },
      args: [fullPrompt],
    });

    if (!sendResult?.[0]?.result?.success) {
      throw new Error(sendResult?.[0]?.result?.error || 'Failed to submit prompt to ChatGPT');
    }

    // Poll for the response to complete
    const startTime = Date.now();
    let finalAnswer = '';

    while (Date.now() - startTime < 45000) {
      await new Promise((r) => setTimeout(r, 1000));

      const pollResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Look for assistant response elements
          const articles = document.querySelectorAll('article');
          if (articles.length >= 2) {
            const assistantArticle = articles[articles.length - 1];
            // Check if generation is still streaming (stop button visible vs copy button visible)
            const stopBtn = document.querySelector('button[data-testid="stop-button"]');
            const copyBtn = assistantArticle.querySelector('button[aria-label="Copy"]');
            const text = assistantArticle.innerText || assistantArticle.textContent || '';

            if (text.trim() && (!stopBtn || copyBtn)) {
              return { done: true, text: text.trim() };
            }
          }
          return { done: false };
        },
      });

      const res = pollResult?.[0]?.result;
      if (res?.done && res.text) {
        finalAnswer = res.text;
        break;
      }
    }

    if (!finalAnswer) {
      throw new Error('ChatGPT generation timed out or produced no output.');
    }

    // Clean formatting if header was captured
    const cleanAnswer = finalAnswer
      .replace(/^ChatGPT said:\s*/i, '')
      .replace(/ChatGPT can make mistakes\. Check important info\..*$/s, '')
      .trim();

    return cleanAnswer || finalAnswer;
  } finally {
    // Close the background tab so user is completely unaffected
    try {
      await chrome.tabs.remove(tabId);
    } catch { /* already closed */ }
  }
}
