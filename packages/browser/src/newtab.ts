// Hanzo Answer Engine — new-tab landing + omnibox / address-bar search target.
// Mounts the shared AnswerEngine React surface; talks to api.hanzo.ai ONLY,
// through the @hanzo/ai `search` primitive. Auth is brokered by the background
// (same bridge the popup/sidebar use) so the token never lives in the page.
//
// The page's one stylesheet is @hanzo/ui's theme.css (design's tokens for both
// themes, and the composer's paint: its ground, its one edge, its focus) with
// this page's own rules after it. esbuild writes the two as newtab.css.
import '@hanzo/ui/theme.css';
import './newtab.css';
import 'webextension-polyfill';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { GuiProvider } from '@hanzo/gui';
import { apply, current, useScheme } from '@hanzo/appearance';
import guiConfig from '@hanzo/ui/gui-config';
import { AnswerEngine } from './answer/AnswerEngine.js';
import type { RailUser } from './answer/Rail.js';
import { API_BASE_URL, STORAGE_KEYS } from './shared/config.js';

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

/** The theme follows the device unless the person chose one (@hanzo/appearance,
 *  the same reader hanzo.ai uses): `apply` writes `t_light`/`t_dark` on <html>
 *  and keeps following the device while the theme is `system`, and gui's
 *  provider takes the scheme the document shows. */
function Root(props: React.ComponentProps<typeof AnswerEngine>) {
  return React.createElement(
    GuiProvider,
    { config: guiConfig, defaultTheme: useScheme() },
    React.createElement(AnswerEngine, props),
  );
}

function boot() {
  apply(current({ install: { theme: 'system' } }).pref);

  const params = new URLSearchParams(location.search);
  const initialQuery = params.get('q') ?? undefined;

  const el = document.getElementById('root');
  if (!el) return;

  const root = createRoot(el);
  let currentUser: RailUser | null = null;

  function render() {
    // Every @hanzo/ui component must sit under GuiProvider — a gui component
    // mounted outside it throws on first paint and takes the whole page with it.
    root.render(
      React.createElement(Root, {
        apiBase: API_BASE_URL,
        getToken,
        signIn,
        signOut,
        user: currentUser,
        ...(initialQuery ? { initialQuery } : {}),
      }),
    );
  }

  async function refreshAuthStatus(): Promise<void> {
    try {
      const resp: any = await runtime.runtime.sendMessage({ action: 'auth.status' });
      const nextUser: RailUser | null = resp?.authenticated
        ? (resp.user || { name: 'Signed in' })
        : null;
      if (JSON.stringify(nextUser) !== JSON.stringify(currentUser)) {
        currentUser = nextUser;
        render();
      }
    } catch {
      // Ignore transient messaging errors
    }
  }

  async function signIn(): Promise<void> {
    try {
      const resp: any = await runtime.runtime.sendMessage({ action: 'auth.login' });
      if (resp?.success) {
        currentUser = resp.user || { name: 'Signed in' };
        render();
      }
    } catch {
      // Ignore cancellation / errors
    } finally {
      await refreshAuthStatus();
    }
  }

  async function signOut(): Promise<void> {
    try {
      await runtime.runtime.sendMessage({ action: 'auth.logout' });
    } catch {}
    currentUser = null;
    render();
  }

  render();
  void refreshAuthStatus();

  try {
    runtime.storage?.onChanged?.addListener((changes, area) => {
      if (area && area !== 'local') return;
      if (STORAGE_KEYS.accessToken in changes || STORAGE_KEYS.user in changes) {
        void refreshAuthStatus();
      }
    });
  } catch {}

  window.addEventListener('focus', () => {
    void refreshAuthStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshAuthStatus();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
