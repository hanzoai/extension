import { describe, it, expect } from 'vitest';
import {
  chatRequestBody,
  extractContent,
  parseModels,
  createAiClient,
} from '../src/client';

describe('chatRequestBody', () => {
  it('always sets stream:false and includes model+messages', () => {
    const body = chatRequestBody({ model: 'zen5', messages: [{ role: 'user', content: 'hi' }] });
    expect(body).toMatchObject({ model: 'zen5', stream: false });
    expect(body.messages).toHaveLength(1);
    expect('temperature' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
  });
  it('includes temperature/max_tokens only when provided', () => {
    const body = chatRequestBody({ model: 'zen5', messages: [], temperature: 0.2, max_tokens: 500 });
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(500);
  });
});

describe('extractContent', () => {
  it('reads choices[].message.content', () => {
    expect(extractContent({ choices: [{ message: { role: 'assistant', content: 'hello' } }] })).toBe('hello');
  });
  it('falls back to choices[].text and top-level content', () => {
    expect(extractContent({ choices: [{ text: 'legacy' }] })).toBe('legacy');
    expect(extractContent({ content: 'top' })).toBe('top');
  });
  it('throws the gateway error message', () => {
    expect(() => extractContent({ error: { message: 'rate limited' } })).toThrow(/rate limited/);
    expect(() => extractContent({ error: 'bad key' })).toThrow(/bad key/);
  });
  it('throws on empty content', () => {
    expect(() => extractContent({ choices: [{ message: { role: 'assistant', content: '' } }] })).toThrow(/no content/);
  });
});

describe('parseModels', () => {
  it('reads data[] of objects, models[], or a bare array of strings', () => {
    expect(parseModels({ data: [{ id: 'zen5' }, { id: 'zen-coder' }] }).map((m) => m.id)).toEqual(['zen5', 'zen-coder']);
    expect(parseModels({ models: [{ id: 'a' }] }).map((m) => m.id)).toEqual(['a']);
    expect(parseModels(['x', 'y']).map((m) => m.id)).toEqual(['x', 'y']);
  });
  it('drops entries without an id', () => {
    expect(parseModels({ data: [{ id: '' }, { foo: 1 }, { id: 'ok' }] }).map((m) => m.id)).toEqual(['ok']);
  });
});

describe('createAiClient (injected fetch — no network)', () => {
  it('POSTs /v1/chat/completions with the bearer and returns the completion', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: any, init: any) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const ai = createAiClient({ token: 'hk-1', baseURL: 'https://api.hanzo.ai', fetch: fakeFetch });
    const res = await ai.chat.completions.create({ model: 'zen5', messages: [{ role: 'user', content: 'hi' }] });
    expect(extractContent(res)).toBe('ok');
    expect(seen!.url).toBe('https://api.hanzo.ai/v1/chat/completions');
    expect((seen!.init.headers as any).Authorization).toBe('Bearer hk-1');
    const sent = JSON.parse(seen!.init.body as string);
    expect(sent).toMatchObject({ model: 'zen5', stream: false });
  });

  it('omits Authorization when the token is empty (anonymous)', async () => {
    let headers: any;
    const fakeFetch = (async (_url: any, init: any) => {
      headers = init.headers;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ai = createAiClient({ fetch: fakeFetch });
    await ai.chat.completions.create({ model: 'zen5', messages: [] });
    expect('Authorization' in headers).toBe(false);
  });

  it('surfaces a non-2xx gateway error', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 401 })) as unknown as typeof fetch;
    const ai = createAiClient({ fetch: fakeFetch });
    await expect(ai.chat.completions.create({ model: 'zen5', messages: [] })).rejects.toThrow(/nope/);
  });

  it('lists models from /v1/models', async () => {
    const fakeFetch = (async (url: any) => {
      expect(String(url)).toBe('https://api.hanzo.ai/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'zen5' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const ai = createAiClient({ fetch: fakeFetch });
    expect((await ai.models.list()).map((m) => m.id)).toEqual(['zen5']);
  });
});
