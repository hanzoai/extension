import { describe, it, expect } from 'vitest';
import { buildMessages, extractContent, complete } from '../src/hanzo.js';
import type { AiClient, ChatCompletion } from '@hanzo/ai';

describe('buildMessages', () => {
  it('produces a system+user pair in order', () => {
    const msgs = buildMessages('SYS', 'USER');
    expect(msgs).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
  });
});

describe('extractContent', () => {
  it('reads a string content body', () => {
    expect(extractContent({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
  });

  it('joins text content parts', () => {
    const res = {
      choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }],
    };
    expect(extractContent(res)).toBe('ab');
  });

  it('throws on empty content', () => {
    expect(() => extractContent({ choices: [{ message: { content: '' } }] })).toThrow(/no content/);
    expect(() => extractContent({ choices: [] })).toThrow(/no content/);
  });
});

describe('complete (request shaping via mock client)', () => {
  it('shapes model + messages, non-stream, and returns assistant text', async () => {
    const seen: unknown[] = [];
    const fake: AiClient = {
      chat: {
        completions: {
          async create(params: unknown) {
            seen.push(params);
            return {
              id: 'x',
              object: 'chat.completion',
              created: 0,
              model: 'zen5',
              choices: [{ index: 0, message: { role: 'assistant', content: 'REVIEW' }, finish_reason: 'stop' }],
            } as ChatCompletion;
          },
        },
      },
    } as unknown as AiClient;

    const out = await complete({
      system: 'SYS',
      user: 'USER',
      model: 'zen5',
      token: 'sk-abc',
      baseURL: 'https://api.hanzo.ai',
      client: fake,
    });

    expect(out).toBe('REVIEW');
    expect(seen).toHaveLength(1);
    const params = seen[0] as { model: string; messages: unknown[]; stream: boolean };
    expect(params.model).toBe('zen5');
    expect(params.stream).toBe(false);
    expect(params.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
  });

  it('propagates a gateway error', async () => {
    const fake = {
      chat: { completions: { async create() { throw new Error('HTTP 500'); } } },
    } as unknown as AiClient;
    await expect(
      complete({ system: 's', user: 'u', model: 'm', token: '', baseURL: 'x', client: fake }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
