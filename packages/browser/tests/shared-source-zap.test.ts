import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { Storage } from '../src/shared/source.js';
import {
  SOURCE_CAPS,
  USAGE_CACHE_KEY,
  providerAccounts,
  rememberUsage,
  toSnapshot,
  usageReport,
  withSourceMethods,
} from '../src/shared/source-zap.js';
import type { ProviderUsage } from '../src/shared/usage.js';

function memory(): Storage & { m: Record<string, any> } {
  const m: Record<string, any> = {};
  return {
    m,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in m).map((k) => [k, m[k]])),
    set: async (items) => void Object.assign(m, items),
    remove: async (keys) => void keys.forEach((k) => delete m[k]),
  };
}

const AT = new Date('2026-11-22T10:00:00.000Z');

const claude: ProviderUsage = {
  providerId: 'claude',
  displayName: 'Claude',
  snapshot: {
    providerId: 'claude',
    primary: { usedPercent: 40, windowMinutes: 300, resetsAt: '2026-11-22T12:00:00Z' },
    secondary: { usedPercent: 120, windowMinutes: 10080 },
    identity: { providerId: 'claude', plan: 'max', accountEmail: 'someone@example.com', accountOrganization: 'Org' },
    dataConfidence: 'percentOnly',
    updatedAt: '2026-11-22T09:59:00.000Z',
  },
};
const codexSignedOut: ProviderUsage = { providerId: 'codex', displayName: 'Codex', error: 'Open chatgpt.com to sign in' };

/** The shapes Hanzo Dev decodes (hanzoai/dev BrowserSourceProvider and @hanzodev/usage ProviderSnapshot). */
const WINDOW_KINDS = ['session', 'daily', 'weekly', 'monthly', 'credits', 'other'];
const SNAPSHOT_KEYS = ['provider', 'fetchedAt', 'source', 'plan', 'windows', 'error'];
function devAccepts(snapshot: any) {
  expect(Object.keys(snapshot).every((k) => SNAPSHOT_KEYS.includes(k))).toBe(true);
  expect(snapshot.provider).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  expect(['oauth', 'api', 'local', 'cookies', 'none']).toContain(snapshot.source);
  for (const w of snapshot.windows) {
    expect(WINDOW_KINDS).toContain(w.kind);
    expect(typeof w.label).toBe('string');
    expect(w.usedPercent).toBeGreaterThanOrEqual(0);
    expect(w.usedPercent).toBeLessThanOrEqual(100);
  }
  if (snapshot.error !== undefined) expect(snapshot.error).toMatch(/^[a-z0-9_.-]{1,64}$/);
}

describe('usage.report', () => {
  it('maps a usage reading to a metadata snapshot with no account', () => {
    const s = toSnapshot(claude, AT.toISOString());
    expect(s).toEqual({
      provider: 'claude',
      fetchedAt: '2026-11-22T09:59:00.000Z',
      source: 'cookies',
      plan: 'max',
      windows: [
        { kind: 'session', label: '5h', usedPercent: 40, windowMinutes: 300, resetsAt: '2026-11-22T12:00:00Z' },
        { kind: 'weekly', label: '7d', usedPercent: 100, windowMinutes: 10080 },
      ],
    });
    expect(JSON.stringify(s)).not.toContain('example.com');
    expect(JSON.stringify(s)).not.toContain('Org');
    devAccepts(s);
  });

  it('turns a failed reading into a short code, never the message', () => {
    expect(toSnapshot(codexSignedOut, AT.toISOString())).toEqual({
      provider: 'codex', fetchedAt: AT.toISOString(), source: 'cookies', windows: [], error: 'needs_login',
    });
    const other = toSnapshot({ providerId: 'claude', displayName: 'Claude', error: 'TypeError: <html>…' }, AT.toISOString());
    expect(other.error).toBe('fetch_failed');
  });

  it('answers with the last reading the usage panel kept, and empty before any', async () => {
    const storage = memory();
    expect(await usageReport(storage)).toEqual({ snapshots: [] });
    await rememberUsage(storage, [claude, codexSignedOut], AT);
    const { snapshots } = await usageReport(storage);
    expect(snapshots.map((s) => s.provider)).toEqual(['claude', 'codex']);
    snapshots.forEach(devAccepts);
    expect(storage.m[USAGE_CACHE_KEY]).toHaveLength(2);
  });
});

describe('provider.accounts', () => {
  const has = (signedIn: string[]) => async (url: string) => signedIn.some((h) => url.includes(h));

  it('lists signed-in products as ready, with the plan the last reading saw', async () => {
    const storage = memory();
    await rememberUsage(storage, [claude], AT);
    const reply = await providerAccounts(has(['claude.ai', 'grok.com']), storage);
    expect(reply).toEqual({
      accounts: [
        { provider: 'claude', plan: 'max', state: 'ready' },
        { provider: 'grok', state: 'ready' },
      ],
    });
  });

  it('marks a product whose last reading asked for sign-in and shows no session as needs_login', async () => {
    const storage = memory();
    await rememberUsage(storage, [codexSignedOut], AT);
    expect(await providerAccounts(has([]), storage)).toEqual({ accounts: [{ provider: 'chatgpt', state: 'needs_login' }] });
  });

  it('is empty when nothing is signed in', async () => {
    expect(await providerAccounts(has([]), memory())).toEqual({ accounts: [] });
  });
});

describe('ZAP wiring', () => {
  it('answers the two methods itself and hands every other method on', async () => {
    const calls: string[] = [];
    const dispatch = withSourceMethods({ has: async () => false, storage: memory() }, async (m) => {
      calls.push(m);
      return { passed: m };
    });
    expect(await dispatch('provider.accounts', {})).toEqual({ accounts: [] });
    expect(await dispatch('usage.report', {})).toEqual({ snapshots: [] });
    expect(await dispatch('hanzo.listTabs', {})).toEqual({ passed: 'hanzo.listTabs' });
    expect(calls).toEqual(['hanzo.listTabs']);
  });

  it('is advertised by both the Chrome and the Firefox background', () => {
    expect(SOURCE_CAPS).toEqual(['provider.accounts', 'usage.report']);
    for (const f of ['background.ts', 'background-firefox.ts']) {
      const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
      expect(src).toMatch(/BROWSER_CAPS = \[[^\]]*\.\.\.SOURCE_CAPS/);
      expect(src).toContain('withSourceMethods(');
    }
  });
});
