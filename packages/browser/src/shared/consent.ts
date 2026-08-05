// consent.ts — ONE data-consent value, one source of truth.
//
// The user's data-sharing consent lives on their Hanzo ACCOUNT (asked at
// hanzo.id signup, editable in the extension + on hanzo.ai). This module keeps
// the extension in lockstep with that one value:
//   • Signed in  → the account is canonical. getConsent() reads it from
//     GET /v1/iam/consent; setConsent() writes it with PUT /v1/iam/consent.
//     The local copy is just a cache so the UI paints instantly.
//   • Signed out → the local copy (from onboarding) is used, and is pushed to
//     the account on next sign-in so nothing is lost or duplicated.
//
// TWO switches:
//   • insights (default ON)      — anonymous product events. No query/answer
//     text, no PII: only which surface fired, under a random per-install id.
//   • shareTraining (OPT-IN)     — contribute the user's OWN searches + answers
//     to train Hanzo's open models. Asked explicitly at signup/onboarding.
//
// Everything is fail-soft: a network error NEVER breaks a user action, and
// nothing is sent for a switch that is off.
//
// The SEND is `@hanzo/event` — the ONE Hanzo telemetry client, posting to
// `POST /v1/event`. This module used to hand-roll its own wire
// (`POST /v1/insights` with `{event, props, anon_id, ts, source}`) and its own
// anonymous id, which made the extension a second telemetry protocol behind a
// second door: the events landed in a store none of the cloud lenses
// (analytics/insights/sentry) read, so the surface was dark in every dashboard
// while looking instrumented from here. One wire, one door, one client.
import { createAnalytics, type Analytics } from '@hanzo/event';
import { API_BASE_URL, EVENT_INGEST_KEY } from './config.js';

const KEYS = {
  insights: 'hanzo_insights_enabled',
  training: 'hanzo_share_training',
  onboarded: 'hanzo_onboarded',
} as const;

export interface Consent {
  insights: boolean;
  shareTraining: boolean;
}

const runtime: typeof chrome | undefined =
  (globalThis as any).browser ?? (globalThis as any).chrome;

function area(): chrome.storage.StorageArea | undefined {
  return (globalThis as any).chrome?.storage?.local ?? (globalThis as any).browser?.storage?.local;
}

function getLocal(keys: string[]): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const s = area();
    if (!s) return resolve({});
    try {
      s.get(keys, (v) => resolve(v || {}));
    } catch {
      resolve({});
    }
  });
}

function setLocal(obj: Record<string, any>): Promise<void> {
  return new Promise((resolve) => {
    const s = area();
    if (!s) return resolve();
    try {
      s.set(obj, () => resolve());
    } catch {
      resolve();
    }
  });
}

/** Bearer for the signed-in user, brokered by the background (null when out). */
async function token(): Promise<string | null> {
  try {
    const resp: any = await runtime?.runtime?.sendMessage?.({ action: 'auth.getToken' });
    return resp?.token ?? null;
  } catch {
    return null;
  }
}

function localConsent(v: Record<string, any>): Consent {
  return { insights: v[KEYS.insights] !== false, shareTraining: v[KEYS.training] === true };
}

/** Read consent: the account is canonical when signed in; local otherwise. */
export async function getConsent(): Promise<Consent> {
  const local = localConsent(await getLocal([KEYS.insights, KEYS.training]));
  const tok = await token();
  if (!tok) return local;
  try {
    const res = await fetch(`${API_BASE_URL}/v1/iam/consent`, {
      headers: { authorization: `Bearer ${tok}` },
    });
    if (res.ok) {
      const a = await res.json();
      const acct: Consent = { insights: a.insights !== false, shareTraining: a.shareTraining === true };
      // Cache so the UI paints instantly next time, keeping one value in sync.
      await setLocal({ [KEYS.insights]: acct.insights, [KEYS.training]: acct.shareTraining });
      return acct;
    }
  } catch {
    /* fall through to local */
  }
  return local;
}

/** Write consent: local cache + the account (when signed in) — one value. */
export async function setConsent(c: Partial<Consent>): Promise<void> {
  const cur = localConsent(await getLocal([KEYS.insights, KEYS.training]));
  const next: Consent = {
    insights: c.insights ?? cur.insights,
    shareTraining: c.shareTraining ?? cur.shareTraining,
  };
  await setLocal({ [KEYS.insights]: next.insights, [KEYS.training]: next.shareTraining });
  const tok = await token();
  if (!tok) return;
  try {
    await fetch(`${API_BASE_URL}/v1/iam/consent`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify(next),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fail-soft */
  }
}

export async function isOnboarded(): Promise<boolean> {
  const v = await getLocal([KEYS.onboarded]);
  return v[KEYS.onboarded] === true;
}
export async function markOnboarded(): Promise<void> {
  await setLocal({ [KEYS.onboarded]: true });
}

/**
 * Browser-level opt-out. Do Not Track and Global Privacy Control sit ABOVE the
 * account switch: a user who set either has already answered, and the SDK reads
 * neither, so every surface applies them itself.
 *
 * Guarded on `navigator` because this module is also reachable from the
 * background service worker, whose WorkerNavigator carries none of these.
 */
function privacySignalsAllow(): boolean {
  // `typeof`, not a bare read: the identifier may be undeclared entirely, and
  // typeof is the only safe operator on an undeclared name.
  if (typeof navigator === 'undefined') return true;
  const n = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean };
  const dnt = n.doNotTrack ?? n.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return false;
  if (n.globalPrivacyControl) return false;
  return true;
}

/**
 * The ONE telemetry client, built lazily so it is never constructed for a user
 * who has not consented — construction is what would install the SDK's global
 * hooks, and a disabled client that exists is a claim waiting to be forgotten.
 *
 * No `getToken`. The SDK's is synchronous and this extension's bearer is only
 * reachable by an async round-trip to the background broker, so these events ride
 * the anonymous lane on the publishable `pk-` key — which is exactly what the
 * previous hand-rolled send did, and what the `insights` consent describes.
 *
 * `captureErrors: false` on purpose. The consent the user actually gave covers
 * "anonymous product events … only which surface fired". Stack traces are not
 * that, and quietly widening what is collected under an unchanged consent string
 * is a privacy regression, not a feature. Turning it on means changing the ask.
 */
let client: Analytics | null = null;
function events(): Analytics {
  if (!client) {
    client = createAnalytics({
      product: 'extension',
      host: API_BASE_URL,
      ingestKey: EVENT_INGEST_KEY,
      captureErrors: false,
    });
  }
  return client;
}

/** Anonymous product-usage event. No query/answer text, no PII. No-op when
 *  insights is off or the browser signals opt-out. Never throws. */
export async function capture(event: string, props?: Record<string, unknown>): Promise<void> {
  try {
    if (!privacySignalsAllow()) return;
    const c = await getConsent();
    if (!c.insights) return;
    const a = events();
    a.capture(event, props);
    // Flush NOW, on a beacon. Every call site here fires as its surface is going
    // away — `popup_opened` races the popup closing, `onboarding_complete` closes
    // its own tab on the next line — and a batched event on a torn-down page is
    // an event that never shipped. This is what the previous `keepalive: true`
    // bought, kept.
    a.flush(true);
  } catch {
    /* fail-soft */
  }
}

/** Contribute one search+answer sample to train Hanzo's open models. No-op
 *  unless the user opted in. Sent with the IAM bearer so it's the user's own,
 *  attributable data. Never throws. */
export async function contributeTrainingSample(sample: {
  query: string;
  answer: string;
  model?: string;
  sources?: string[];
}): Promise<void> {
  try {
    const c = await getConsent();
    if (!c.shareTraining) return;
    if (!sample.query || !sample.answer) return;
    const tok = await token();
    await fetch(`${API_BASE_URL}/v1/training/contributions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(tok ? { authorization: `Bearer ${tok}` } : {}),
      },
      body: JSON.stringify({ ...sample, source: 'extension:answer-engine', ts: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* fail-soft */
  }
}
