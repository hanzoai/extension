// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The in-page assistant's model picker, from the real content script.
 *
 * It offers Auto and the Zen chat rows of GET /v1/models, which it reads the
 * way the sidebar does (`chat.listModels`), and Auto resolves the way the
 * sidebar's does. Nothing in it is a model name the extension typed itself.
 */

vi.mock('webextension-polyfill', () => ({}));

/** Rows in the shape api.hanzo.ai/v1/models answers. */
const rows = [
  { id: 'aion-labs/aion-2.0', owned_by: 'aion-labs' },
  { id: 'enso', owned_by: 'hanzo' },
  { id: 'zen5', owned_by: 'zenlm', name: 'Zen5' },
  { id: 'zen-embedding', owned_by: 'zenlm' },
  { id: 'zen-guard', owned_by: 'zenlm' },
  { id: 'zen5-flash', owned_by: 'zenlm' },
  { id: 'openai/gpt-oss-120b', owned_by: 'openai' },
];

const sent: Array<Record<string, unknown>> = [];
const listeners: Array<(request: unknown, sender: unknown, respond: (r: unknown) => void) => unknown> = [];

beforeAll(async () => {
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      id: 'test',
      getURL: (p: string) => p,
      onMessage: { addListener: (fn: (typeof listeners)[number]) => listeners.push(fn) },
      sendMessage: async (message: Record<string, unknown>) => {
        sent.push(message);
        if (message.action === 'chat.listModels') return { success: true, models: rows };
        if (message.action === 'auth.getToken') return { success: true, token: 't' };
        if (message.action === 'chat.complete') return { success: true, content: 'ok' };
        return { success: true };
      },
    },
    storage: {
      local: { get: async () => ({}) },
      sync: { get: async () => ({}), set: () => {} },
      onChanged: { addListener: () => {} },
    },
  };
  await import('../src/content-script');
});

const select = () => document.querySelector<HTMLSelectElement>('#hanzo-page-overlay-root select[data-role="model"]')!;
const offered = () => Array.from(select().options, (o) => [o.value, o.textContent]);

describe('page assistant models', () => {
  it('offers Auto, then the Zen chat models of /v1/models, with Auto selected', async () => {
    expect(offered()).toEqual([['auto', 'Auto']]);
    for (const fn of listeners) fn({ action: 'page.overlay.show' }, {}, () => {});
    await vi.waitFor(() => expect(offered().length).toBe(3));
    expect(offered()).toEqual([['auto', 'Auto'], ['zen5', 'Zen5'], ['zen5-flash', 'zen5-flash']]);
    expect(select().value).toBe('auto');
  });

  it('sends Auto as the sidebar does: zen5-flash for a short question', async () => {
    const input = document.querySelector<HTMLTextAreaElement>('#hanzo-page-overlay-root [data-role="input"]')!;
    input.value = 'What is this page?';
    document.querySelector<HTMLButtonElement>('#hanzo-page-overlay-root [data-role="send"]')!.click();
    await vi.waitFor(() => expect(sent.some((m) => m.action === 'chat.complete')).toBe(true));
    expect(sent.find((m) => m.action === 'chat.complete')!.model).toBe('zen5-flash');
  });
});
