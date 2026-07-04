import { describe, it, expect } from 'vitest';
import type { AiClient } from '@hanzo/ai';
import { runChat, listModels } from '../src/hanzo';
import type { ChatMessage } from '../src/design-core';

// A fake AiClient capturing the params passed to chat.completions.create and
// models.list. This is how we assert request shaping without a network.
function fakeClient(reply: string, models: string[] = ['zen5', 'zen5-mini']): {
  client: AiClient;
  calls: { params: any; options: any }[];
} {
  const calls: { params: any; options: any }[] = [];
  const client = {
    chat: {
      completions: {
        create: async (params: any, options: any) => {
          calls.push({ params, options });
          return {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: params.model,
            choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          };
        },
      },
    },
    models: {
      list: async () => models.map((id) => ({ id, object: 'model' })),
    },
  } as unknown as AiClient;
  return { client, calls };
}

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
];

describe('runChat (request shaping over @hanzo/ai)', () => {
  it('sends model + messages, stream:false, temperature, and returns the content', async () => {
    const f = fakeClient('Generated copy.');
    const out = await runChat(MESSAGES, { client: f.client, model: 'zen5-mini', temperature: 0.4 });
    expect(out).toBe('Generated copy.');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].params.model).toBe('zen5-mini');
    expect(f.calls[0].params.stream).toBe(false);
    expect(f.calls[0].params.temperature).toBe(0.4);
    expect(f.calls[0].params.messages).toEqual(MESSAGES);
  });

  it('defaults the model to zen5 when none is given', async () => {
    const f = fakeClient('x');
    await runChat(MESSAGES, { client: f.client });
    expect(f.calls[0].params.model).toBe('zen5');
  });

  it('throws when the model returns empty content', async () => {
    const f = fakeClient('');
    await expect(runChat(MESSAGES, { client: f.client })).rejects.toThrow(/no content/);
  });

  it('forwards the abort signal in options', async () => {
    const f = fakeClient('x');
    const controller = new AbortController();
    await runChat(MESSAGES, { client: f.client, signal: controller.signal });
    expect(f.calls[0].options.signal).toBe(controller.signal);
  });
});

describe('listModels', () => {
  it('returns the model ids from the client', async () => {
    const f = fakeClient('x', ['zen5', 'zen5-mini', 'zen5-coder']);
    expect(await listModels({ client: f.client })).toEqual(['zen5', 'zen5-mini', 'zen5-coder']);
  });
});
