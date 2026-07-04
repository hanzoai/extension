import { describe, it, expect, beforeEach, vi } from 'vitest';

// A minimal localStorage stub so the browser-only auth module is testable in
// node. Installed before importing the module under test.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  vi.resetModules();
});

describe('auth: pasted Hanzo key (NOT the FHIR/PHI token)', () => {
  it('stores, reads, and clears the key', async () => {
    const { getApiKey, setApiKey, hasApiKey, bearer } = await import('../src/auth.js');
    expect(getApiKey()).toBe('');
    expect(hasApiKey()).toBe(false);
    setApiKey('  hk-abc  ');
    expect(getApiKey()).toBe('hk-abc'); // trimmed
    expect(hasApiKey()).toBe(true);
    expect(bearer()).toBe('hk-abc');
    setApiKey('');
    expect(getApiKey()).toBe('');
    expect(hasApiKey()).toBe(false);
  });

  it('validateKey rejects an empty key before any network call', async () => {
    const { validateKey } = await import('../src/auth.js');
    await expect(validateKey('   ')).rejects.toThrow(/Hanzo API key/);
  });

  it('does not touch the FHIR/PHI storage — only the Hanzo gateway key', async () => {
    const { setApiKey } = await import('../src/auth.js');
    const { APIKEY_STORAGE_KEY } = await import('../src/config.js');
    setApiKey('hk-x');
    // The one and only key it writes is the Hanzo gateway key.
    expect(localStorage.getItem(APIKEY_STORAGE_KEY)).toBe('hk-x');
  });
});
