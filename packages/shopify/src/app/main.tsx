// The embedded-app browser entry point — the one impure, browser-only module. It
// reads the launch context, builds the App Bridge authenticated fetch, wires the
// backend Api, and mounts the Polaris React app. Everything logic-heavy it uses
// (context parsing, request shaping, session-token fetch) is a pure, tested
// module; this file is the DOM glue.
//
// App Bridge (window.shopify) is loaded by the CDN script tag in index.html with
// the app's api-key meta, per Shopify's embedded-app requirement. We read the
// session token through it on every request (session-fetch) so the server can
// trust which shop is calling.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shopify/polaris/build/esm/styles.css';
import { App } from './App';
import { createApi } from './api';
import { parseLaunchContext } from './context';
import { authenticatedFetch } from './session-fetch';

// The App Bridge global the CDN script registers. idToken() returns a fresh
// session-token JWT. Typed minimally — we use only idToken.
declare global {
  interface Window {
    shopify?: { idToken(): Promise<string> };
  }
}

// The backend base is stamped into the page as <meta name="hanzo:base"> at build
// time (build.js). Empty means same-origin (the app and the API served together).
function backendBase(): string {
  const meta = document.querySelector('meta[name="hanzo:base"]');
  return (meta?.getAttribute('content') ?? '').replace(/\/+$/, '');
}

function boot(): void {
  const ctx = parseLaunchContext(window.location.search);
  const getIdToken: () => Promise<string> = () =>
    window.shopify ? window.shopify.idToken() : Promise.resolve('');
  const fetchImpl = authenticatedFetch(fetch.bind(window), getIdToken);
  const api = createApi({ baseUrl: backendBase(), shop: ctx.shop, fetch: fetchImpl });

  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <App api={api} ctx={ctx} />
    </StrictMode>,
  );
}

boot();
