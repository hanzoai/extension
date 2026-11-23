/**
 * What this browser tells Hanzo Dev over ZAP about the AI accounts it holds
 * (HIP-1350, Browser sources). Two read-only methods, the same in every build:
 *
 *   provider.accounts → { accounts: [{ provider, plan?, state: ready | needs_login }] }
 *   usage.report      → { snapshots: [ProviderSnapshot] }
 *
 * Both answer from what the extension already holds. `provider.accounts` asks
 * only whether a product's session cookie exists (shared/source.ts); its value
 * is never read. `usage.report` returns the last reading the person's own usage
 * panel made, reduced to the HIP's metadata snapshot: plan, limit windows and a
 * short error code, never an account, a cookie or page content. A ZAP call
 * never makes the extension contact a provider.
 */

import { detectProviders, type HasCookie, type Storage } from './source.js';
import type { RateWindow } from '@hanzo/usage';
import type { ProviderUsage } from './usage.js';

export const ACCOUNTS_METHOD = 'provider.accounts';
export const USAGE_METHOD = 'usage.report';
/** What both builds advertise for these methods. */
export const SOURCE_CAPS = [ACCOUNTS_METHOD, USAGE_METHOD];

export const USAGE_CACHE_KEY = 'hanzo_usage_snapshots';

export type WindowKind = 'session' | 'daily' | 'weekly' | 'monthly' | 'credits' | 'other';

/** HIP-1350 UsageWindow (@hanzodev/usage). */
export interface UsageWindow {
  kind: WindowKind;
  label: string;
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: string;
}

/** HIP-1350 ProviderSnapshot at level metadata: no `account`. */
export interface ProviderSnapshot {
  provider: string;
  fetchedAt: string;
  source: 'cookies';
  plan?: string;
  windows: UsageWindow[];
  /** A short code, `^[a-z0-9_.-]{1,64}$`. */
  error?: string;
}

export interface ProviderAccount {
  provider: string;
  plan?: string;
  state: 'ready' | 'needs_login';
}

/** The usage panel's provider id → the signed-in product it reads. */
const PRODUCT_OF: Record<string, string> = { claude: 'claude', codex: 'chatgpt' };

const AUTH = /sign in|\b(401|403)\b/i;
const PLAN = /^[\w .+-]{1,40}$/;

function kindOf(minutes: number | undefined): WindowKind {
  if (!minutes) return 'other';
  if (minutes < 1440) return 'session';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'weekly';
  if (minutes >= 40320 && minutes <= 44640) return 'monthly';
  return 'other';
}

function labelOf(minutes: number | undefined, fallback: string): string {
  if (!minutes) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** One usage-panel reading as the HIP's metadata snapshot. */
export function toSnapshot(u: ProviderUsage, fetchedAt: string): ProviderSnapshot {
  const s = u.snapshot;
  const windows: UsageWindow[] = [];
  const lanes: [RateWindow | undefined, string][] = [
    [s?.primary, 'Session'],
    [s?.secondary, 'Weekly'],
    [s?.tertiary, 'Other'],
  ];
  for (const [w, fallback] of lanes) {
    if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) continue;
    windows.push({
      kind: kindOf(w.windowMinutes),
      label: labelOf(w.windowMinutes, fallback),
      usedPercent: clamp(w.usedPercent),
      ...(w.windowMinutes ? { windowMinutes: w.windowMinutes } : {}),
      ...(typeof w.resetsAt === 'string' ? { resetsAt: w.resetsAt } : {}),
    });
  }
  const plan = s?.identity?.plan;
  const out: ProviderSnapshot = {
    provider: u.providerId,
    fetchedAt: s?.updatedAt ?? fetchedAt,
    source: 'cookies',
    windows,
  };
  if (typeof plan === 'string' && PLAN.test(plan)) out.plan = plan;
  if (u.error) out.error = AUTH.test(u.error) ? 'needs_login' : 'fetch_failed';
  return out;
}

/** Keep the usage panel's last reading, as snapshots, for `usage.report`. */
export async function rememberUsage(storage: Storage, usage: ProviderUsage[], at: Date = new Date()): Promise<void> {
  const fetchedAt = at.toISOString();
  await storage.set({ [USAGE_CACHE_KEY]: usage.map((u) => toSnapshot(u, fetchedAt)) });
}

export async function usageReport(storage: Storage): Promise<{ snapshots: ProviderSnapshot[] }> {
  const kept = (await storage.get([USAGE_CACHE_KEY]))[USAGE_CACHE_KEY];
  return { snapshots: Array.isArray(kept) ? kept : [] };
}

/**
 * The products this browser is signed in to (ready), plus those whose last
 * usage reading asked for a sign-in and that show no session now (needs_login).
 * The plan comes from that reading. None when none.
 */
export async function providerAccounts(has: HasCookie, storage: Storage): Promise<{ accounts: ProviderAccount[] }> {
  const [signedIn, { snapshots }] = await Promise.all([detectProviders(has), usageReport(storage)]);
  const reading = new Map<string, ProviderSnapshot>();
  for (const s of snapshots) {
    const product = PRODUCT_OF[s.provider];
    if (product) reading.set(product, s);
  }
  const accounts: ProviderAccount[] = signedIn.map(({ provider }) => {
    const plan = reading.get(provider)?.plan;
    return plan ? { provider, plan, state: 'ready' } : { provider, state: 'ready' };
  });
  for (const [provider, s] of reading) {
    if (s.error === 'needs_login' && !accounts.some((a) => a.provider === provider)) {
      accounts.push({ provider, state: 'needs_login' });
    }
  }
  return { accounts };
}

/**
 * Wrap a background's ZAP dispatcher so it answers these two methods itself and
 * hands every other method on.
 */
export function withSourceMethods(
  deps: { has: HasCookie; storage: Storage },
  next: (method: string, params: any) => Promise<any>,
): (method: string, params: any) => Promise<any> {
  return (method, params) => {
    if (method === ACCOUNTS_METHOD) return providerAccounts(deps.has, deps.storage);
    if (method === USAGE_METHOD) return usageReport(deps.storage);
    return next(method, params);
  };
}
