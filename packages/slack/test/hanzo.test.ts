import { describe, it, expect, vi } from 'vitest';
import {
  buildMessages,
  quickActionPrompt,
  isQuickActionId,
  complete,
  QUICK_ACTIONS,
} from '../src/hanzo.js';
import type { AiClient, ChatCompletionParams } from '../src/client.js';

describe('buildMessages', () => {
  it('always leads with a system prompt', () => {
    const msgs = buildMessages('hello', '');
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toMatch(/Hanzo AI/);
  });

  it('sends a bare prompt when there is no context', () => {
    const msgs = buildMessages('what is 2+2?', '   ');
    expect(msgs[1]).toEqual({ role: 'user', content: 'what is 2+2?' });
  });

  it('fences the Slack context as data when present', () => {
    const msgs = buildMessages('summarize', 'U1: hi\nU2: yo');
    expect(msgs[1]?.content).toContain('---- Slack conversation ----');
    expect(msgs[1]?.content).toContain('U1: hi');
    expect(msgs[1]?.content).toContain('---- end ----');
    expect(msgs[1]?.content).toMatch(/^summarize/);
  });
});

describe('quickActionPrompt / isQuickActionId', () => {
  it('resolves every catalog id to its prompt', () => {
    for (const id of Object.keys(QUICK_ACTIONS)) {
      expect(isQuickActionId(id)).toBe(true);
      expect(quickActionPrompt(id)).toBe(QUICK_ACTIONS[id as keyof typeof QUICK_ACTIONS].prompt);
    }
  });

  it('rejects unknown ids', () => {
    expect(isQuickActionId('nope')).toBe(false);
    expect(() => quickActionPrompt('nope')).toThrow(/Unknown quick action/);
  });
});

describe('complete (injected client)', () => {
  it('shapes the request and returns extracted content', async () => {
    const create = vi.fn(async (_params: ChatCompletionParams) => ({
      choices: [{ message: { role: 'assistant', content: 'summary text' } }],
    }));
    const client: AiClient = {
      chat: { completions: { create } },
      models: { list: async () => [] },
    };
    const out = await complete({
      prompt: QUICK_ACTIONS.summarize.prompt,
      context: 'U1: hello',
      model: 'zen5',
      token: 'sk-x',
      baseURL: 'https://api.hanzo.ai',
      client,
    });
    expect(out).toBe('summary text');
    const arg = create.mock.calls[0]![0];
    expect(arg.model).toBe('zen5');
    expect(arg.messages[0]?.content).toMatch(/Hanzo AI/); // system
    expect(arg.messages[1]?.content).toContain('U1: hello'); // fenced context
  });

  it('propagates a gateway error from an empty completion', async () => {
    const client: AiClient = {
      chat: { completions: { create: async () => ({ choices: [] }) } },
      models: { list: async () => [] },
    };
    await expect(
      complete({ prompt: 'x', context: '', model: 'zen5', token: '', baseURL: 'https://api.hanzo.ai', client }),
    ).rejects.toThrow(/no content/);
  });
});
