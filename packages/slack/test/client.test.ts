import { describe, it, expect, vi } from 'vitest';
import {
  chatRequestBody,
  extractContent,
  parseModels,
  createAiClient,
} from '../src/client.js';

describe('chatRequestBody', () => {
  it('always sends non-streaming with model + messages', () => {
    const body = chatRequestBody({ model: 'zen5', messages: [{ role: 'user', content: 'hi' }] });
    expect(body).toEqual({
      model: 'zen5',
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    });
  });

  it('includes temperature and max_tokens only when set', () => {
    const withOpts = chatRequestBody({
      model: 'zen5',
      messages: [],
      temperature: 0.2,
      max_tokens: 100,
    });
    expect(withOpts.temperature).toBe(0.2);
    expect(withOpts.max_tokens).toBe(100);
    const without = chatRequestBody({ model: 'zen5', messages: [] });
    expect('temperature' in without).toBe(false);
    expect('max_tokens' in without).toBe(false);
  });
});

describe('extractContent', () => {
  it('reads choices[0].message.content', () => {
    expect(
      extractContent({ choices: [{ message: { role: 'assistant', content: 'hello' } }] }),
    ).toBe('hello');
  });

  it('falls back to choices[0].text then top-level content', () => {
    expect(extractContent({ choices: [{ text: 'legacy' }] })).toBe('legacy');
    expect(extractContent({ content: 'bare' })).toBe('bare');
  });

  it('throws on an error payload with the gateway message', () => {
    expect(() => extractContent({ error: { message: 'rate limited' } })).toThrow(
      /rate limited/,
    );
    expect(() => extractContent({ error: 'boom' })).toThrow(/boom/);
  });

  it('throws on empty content', () => {
    expect(() => extractContent({ choices: [{ message: { role: 'a', content: '' } }] })).toThrow(
      /no content/,
    );
    expect(() => extractContent({})).toThrow(/no content/);
  });
});

describe('parseModels', () => {
  it('parses OpenAI data[] with fullName labels', () => {
    const models = parseModels({
      object: 'list',
      data: [
        { id: 'zen5', fullName: 'Zen 5', owned_by: 'hanzo' },
        { id: 'zen3-omni', fullName: 'Zen3 Omni' },
      ],
    });
    expect(models).toEqual([
      { id: 'zen5', fullName: 'Zen 5', owned_by: 'hanzo' },
      { id: 'zen3-omni', fullName: 'Zen3 Omni', owned_by: undefined },
    ]);
  });

  it('accepts models[] and bare string arrays', () => {
    expect(parseModels({ models: ['a', { id: 'b' }] })).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(parseModels(['x', 'y'])).toEqual([{ id: 'x' }, { id: 'y' }]);
  });

  it('drops entries without a string id', () => {
    expect(parseModels({ data: [{ id: '' }, { foo: 1 }, { id: 'ok' }] })).toEqual([
      { id: 'ok', fullName: undefined, owned_by: undefined },
    ]);
  });

  it('returns [] for unexpected shapes', () => {
    expect(parseModels(null)).toEqual([]);
    expect(parseModels({ nope: true })).toEqual([]);
  });
});

describe('createAiClient (mocked fetch)', () => {
  function mockFetch(status: number, json: unknown) {
    return vi.fn(async () =>
      new Response(JSON.stringify(json), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
  }

  it('POSTs /v1/chat/completions with bearer + json body to the base URL', async () => {
    const fetchMock = mockFetch(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });
    const ai = createAiClient({ token: 'sk-abc', baseURL: 'https://api.hanzo.ai', fetch: fetchMock });
    const res = await ai.chat.completions.create({
      model: 'zen5',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.choices[0]?.message?.content).toBe('ok');
    const call = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe('https://api.hanzo.ai/v1/chat/completions');
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'zen5', stream: false });
  });

  it('omits Authorization when no token (anonymous)', async () => {
    const fetchMock = mockFetch(200, { choices: [{ message: { role: 'a', content: 'x' } }] });
    const ai = createAiClient({ fetch: fetchMock });
    await ai.chat.completions.create({ model: 'zen5', messages: [] });
    const init = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('throws a readable error on non-2xx', async () => {
    const fetchMock = mockFetch(429, { error: { message: 'slow down' } });
    const ai = createAiClient({ fetch: fetchMock });
    await expect(
      ai.chat.completions.create({ model: 'zen5', messages: [] }),
    ).rejects.toThrow(/429: slow down/);
  });

  it('lists models from /v1/models', async () => {
    const fetchMock = mockFetch(200, { data: [{ id: 'zen5', fullName: 'Zen 5' }] });
    const ai = createAiClient({ token: 't', baseURL: 'https://api.hanzo.ai/', fetch: fetchMock });
    const models = await ai.models.list();
    expect(models).toEqual([{ id: 'zen5', fullName: 'Zen 5', owned_by: undefined }]);
    // trailing slash on baseURL is normalized
    expect((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe(
      'https://api.hanzo.ai/v1/models',
    );
  });
});
