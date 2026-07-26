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
import { API_BASE_URL } from './config.js';

const KEYS = {
  insights: 'hanzo_insights_enabled',
  training: 'hanzo_share_training',
  onboarded: 'hanzo_onboarded',
  anonId: 'hanzo_anon_id',
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

async function anonId(): Promise<string> {
  const v = await getLocal([KEYS.anonId]);
  if (typeof v[KEYS.anonId] === 'string') return v[KEYS.anonId];
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await setLocal({ [KEYS.anonId]: id });
  return id;
}

/** Anonymous product-usage event. No query/answer text, no PII. No-op when
 *  insights is off. Never throws. */
export async function capture(event: string, props?: Record<string, unknown>): Promise<void> {
  try {
    const c = await getConsent();
    if (!c.insights) return;
    const anon_id = await anonId();
    await fetch(`${API_BASE_URL}/v1/insights`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, props: props ?? {}, anon_id, ts: Date.now(), source: 'extension' }),
      keepalive: true,
    }).catch(() => {});
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
