import { describe, it, expect, vi } from 'vitest';
import {
  chatRequestBody,
  extractContent,
  parseModels,
  createAiClient,
} from '../src/client';

describe('chatRequestBody', () => {
  it('always sets stream:false and passes model + messages', () => {
    const body = chatRequestBody({ model: 'zen5', messages: [{ role: 'user', content: 'hi' }] });
    expect(body).toEqual({
      model: 'zen5',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
  });

  it('includes temperature/max_tokens only when defined', () => {
    expect(chatRequestBody({ model: 'm', messages: [], temperature: 0.2, max_tokens: 100 })).toMatchObject({
      temperature: 0.2,
      max_tokens: 100,
    });
    expect(chatRequestBody({ model: 'm', messages: [] })).not.toHaveProperty('temperature');
  });
});

describe('extractContent', () => {
  it('reads choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { role: 'assistant', content: 'answer' } }] })).toBe('answer');
  });
  it('falls back to choices[0].text and top-level content', () => {
    expect(extractContent({ choices: [{ text: 'legacy' }] })).toBe('legacy');
    expect(extractContent({ content: 'flat' })).toBe('flat');
  });
  it('throws on an error payload', () => {
    expect(() => extractContent({ error: { message: 'rate limited' } })).toThrow(/rate limited/);
    expect(() => extractContent({ error: 'boom' })).toThrow(/boom/);
  });
  it('throws on empty content', () => {
    expect(() => extractContent({ choices: [{ message: { role: 'assistant', content: '' } }] })).toThrow(
      /no content/,
    );
  });
});

describe('parseModels', () => {
  it('reads OpenAI-style data[]', () => {
    expect(parseModels({ data: [{ id: 'zen5' }, { id: 'zen5-pro', fullName: 'Zen 5 Pro' }] })).toEqual([
      { id: 'zen5', fullName: undefined, owned_by: undefined },
      { id: 'zen5-pro', fullName: 'Zen 5 Pro', owned_by: undefined },
    ]);
  });
  it('accepts models[] and bare arrays and string entries', () => {
    expect(parseModels({ models: ['a'] })).toEqual([{ id: 'a' }]);
    expect(parseModels(['b'])).toEqual([{ id: 'b' }]);
  });
  it('drops entries without a string id', () => {
    expect(parseModels({ data: [{ id: '' }, { name: 'x' }, { id: 'ok' }] })).toEqual([
      { id: 'ok', fullName: undefined, owned_by: undefined },
    ]);
  });
});

describe('createAiClient', () => {
  function ok(body: unknown): Response {
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as any;
  }

  it('POSTs to /v1/chat/completions with the bearer + shaped body', async () => {
    const doFetch = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: 'ok' } }] }));
    const ai = createAiClient({ token: 'sk-123', fetch: doFetch as any });
    const res = await ai.chat.completions.create({ model: 'zen5', messages: [{ role: 'user', content: 'q' }] });
    expect(res.choices[0].message!.content).toBe('ok');
    const [url, init] = doFetch.mock.calls[0];
    expect(url).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-123');
    expect(JSON.parse(init.body).stream).toBe(false);
  });

  it('omits the Authorization header when anonymous', async () => {
    const doFetch = vi.fn().mockResolvedValue(ok({ choices: [{ message: { content: 'x' } }] }));
    const ai = createAiClient({ fetch: doFetch as any });
    await ai.chat.completions.create({ model: 'm', messages: [] });
    expect(doFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('lists models from /v1/models', async () => {
    const doFetch = vi.fn().mockResolvedValue(ok({ data: [{ id: 'zen5' }] }));
    const ai = createAiClient({ fetch: doFetch as any });
    expect(await ai.models.list()).toEqual([{ id: 'zen5', fullName: undefined, owned_by: undefined }]);
    expect(doFetch.mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/models');
  });

  it('surfaces a gateway error on a non-ok completion', async () => {
    const bad = { ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) } as any;
    const doFetch = vi.fn().mockResolvedValue(bad);
    const ai = createAiClient({ token: 'x', fetch: doFetch as any });
    await expect(ai.chat.completions.create({ model: 'm', messages: [] })).rejects.toThrow(
      /Hanzo API 401: bad key/,
    );
  });
});
