import { describe, it, expect, vi } from 'vitest';
import { ActionId } from '@hanzo/cards';
import {
  registerHandlers,
  extractPromptValue,
  stripMention,
  type AppDeps,
} from '../src/app.js';
import type { App } from '@slack/bolt';
import { HanzoFileInstallationStore } from '../src/install.js';
import { loadConfig } from '../src/config.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('extractPromptValue', () => {
  it('finds the hanzo_prompt field value across blocks', () => {
    const values = {
      hanzo_prompt_block: { hanzo_prompt: { value: '  draft an NDA  ' } },
    };
    expect(extractPromptValue(values)).toBe('draft an NDA');
  });

  it('returns empty when absent', () => {
    expect(extractPromptValue(undefined)).toBe('');
    expect(extractPromptValue({ other: { field: { value: 'x' } } })).toBe('');
  });
});

describe('stripMention', () => {
  it('removes a leading bot mention', () => {
    expect(stripMention('<@U123> summarize this')).toBe('summarize this');
  });

  it('leaves un-mentioned text alone', () => {
    expect(stripMention('just text')).toBe('just text');
  });
});

describe('registerHandlers wiring', () => {
  function fakeApp() {
    const commands = new Map<string, unknown>();
    const actions: Array<{ matcher: unknown; fn: unknown }> = [];
    const events = new Map<string, unknown>();
    const shortcuts = new Map<string, unknown>();
    const app = {
      command: (name: string, fn: unknown) => commands.set(name, fn),
      action: (matcher: unknown, fn: unknown) => actions.push({ matcher, fn }),
      event: (name: string, fn: unknown) => events.set(name, fn),
      shortcut: (name: string, fn: unknown) => shortcuts.set(name, fn),
    } as unknown as App;
    return { app, commands, actions, events, shortcuts };
  }

  function deps(): AppDeps {
    const config = loadConfig({ SLACK_SIGNING_SECRET: 's', SLACK_BOT_TOKEN: 'xoxb-1' });
    // A path that does not exist: the store treats a missing file as empty.
    const path = join(tmpdir(), `hanzo-slack-app-${Math.random().toString(36).slice(2)}.json`);
    return { config, store: new HanzoFileInstallationStore(path) };
  }

  it('registers the slash command, home/mention events, shortcut, and all card actions', () => {
    const f = fakeApp();
    registerHandlers(f.app, deps());

    expect(f.commands.has('/hanzo')).toBe(true);
    expect(f.events.has('app_home_opened')).toBe(true);
    expect(f.events.has('app_mention')).toBe(true);
    expect(f.shortcuts.has('hanzo_ask')).toBe(true);

    const matchers = f.actions.map((a) => a.matcher);
    expect(matchers).toContain(ActionId.ModelSelect);
    expect(matchers).toContain(ActionId.PromptSubmit);
    expect(matchers).toContain(ActionId.SignIn);
    // The quick-action handler is registered by regex.
    expect(matchers.some((m) => m instanceof RegExp && m.source.includes('hanzo_quick_action'))).toBe(
      true,
    );
  });

  it('slash /hanzo acks then replies (offline, stubbed fetch)', async () => {
    const f = fakeApp();
    // Stub global fetch so listModels() stays offline and deterministic.
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'zen5' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    try {
      registerHandlers(f.app, deps());
      const handler = f.commands.get('/hanzo') as (a: unknown) => Promise<void>;
      const ack = vi.fn(async () => {});
      const respond = vi.fn(async (_arg: { blocks?: unknown[]; text?: string }) => {});
      // Empty prompt → the handler lists models and replies with guidance,
      // never touching the completion endpoint. It always acks first.
      await handler({
        command: { text: '', user_id: 'U1', team_id: 'T1' },
        ack,
        respond,
        client: {},
      });
      expect(ack).toHaveBeenCalledOnce();
      expect(respond).toHaveBeenCalledOnce();
      const arg = respond.mock.calls[0]![0];
      expect(Array.isArray(arg.blocks)).toBe(true);
    } finally {
      fetchStub.mockRestore();
    }
  });
});
