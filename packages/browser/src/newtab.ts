// Hanzo Answer Engine — new-tab landing + omnibox / address-bar search target.
// Mounts the shared AnswerEngine React surface; talks to api.hanzo.ai ONLY,
// through the @hanzo/ai `search` primitive. Auth is brokered by the background
// (same bridge the popup/sidebar use) so the token never lives in the page.
import 'webextension-polyfill';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnswerEngine } from './answer/AnswerEngine.js';
import { API_BASE_URL } from './shared/config.js';

declare const browser: typeof chrome;
const runtime: typeof chrome = (globalThis as any).browser ?? (globalThis as any).chrome;

/** Resolve the IAM bearer via the background broker (null when signed out). */
async function getToken(): Promise<string | null> {
  try {
    const resp: any = await runtime.runtime.sendMessage({ action: 'auth.getToken' });
    return resp?.token ?? null;
  } catch {
    return null;
  }
}

function signIn(): void {
  runtime.runtime.sendMessage({ action: 'auth.login' }).catch(() => {});
}

function boot() {
  const params = new URLSearchParams(location.search);
  const initialQuery = params.get('q') ?? undefined;

  const el = document.getElementById('root');
  if (!el) return;
  createRoot(el).render(
    React.createElement(AnswerEngine, {
      apiBase: API_BASE_URL,
      getToken,
      signIn,
      ...(initialQuery ? { initialQuery } : {}),
    }),
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
