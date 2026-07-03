import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildMessages, requestBody, extractContent, ask } from '../src/chat';
import { DEFAULT_MODEL } from '../src/config';

describe('buildMessages', () => {
  it('pure generation when no selection', () => {
    const m = buildMessages('draft an NDA clause', '');
    expect(m[0].role).toBe('system');
    expect(m[1].role).toBe('user');
    expect(m[1].content).toBe('draft an NDA clause');
  });

  it('fences the selection as data when present', () => {
    const m = buildMessages('rewrite formally', 'hey wanna sign this');
    expect(m[1].content).toContain('rewrite formally');
    expect(m[1].content).toContain('---- selected text ----');
    expect(m[1].content).toContain('hey wanna sign this');
  });

  it('system prompt forbids markdown fences / preamble', () => {
    const m = buildMessages('x', '');
    expect(m[0].content.toLowerCase()).toContain('only the text');
  });
});

describe('requestBody', () => {
  it('defaults the model and disables streaming', () => {
    const b = requestBody(buildMessages('x', ''));
    expect(b.model).toBe(DEFAULT_MODEL);
    expect(b.stream).toBe(false);
    expect(Array.isArray(b.messages)).toBe(true);
  });
  it('passes an explicit model + temperature through', () => {
    const b = requestBody(buildMessages('x', ''), { model: 'zen-pro', temperature: 0.2 });
    expect(b.model).toBe('zen-pro');
    expect(b.temperature).toBe(0.2);
  });
});

describe('extractContent', () => {
  it('reads OpenAI choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
  });
  it('tolerates choices[0].text and bare content', () => {
    expect(extractContent({ choices: [{ text: 'a' }] })).toBe('a');
    expect(extractContent({ content: 'b' })).toBe('b');
  });
  it('throws on an error payload', () => {
    expect(() => extractContent({ error: { message: 'rate limited' } })).toThrow(/rate limited/);
  });
  it('throws when there is no content', () => {
    expect(() => extractContent({ choices: [{}] })).toThrow(/no content/);
  });
});

describe('ask', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to the gateway with the bearer and returns the content', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer tok123');
      expect(body.messages[1].content).toContain('summarize');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'summary text' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ask('summarize', 'the rows', 'tok123');
    expect(out).toBe('summary text');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/chat/completions');
  });

  it('omits Authorization when token is empty', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: 'ok' }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ask('hi', '', '')).toBe('ok');
  });

  it('surfaces a structured gateway error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'too many requests' } }),
    } as any)));
    await expect(ask('x', '', 't')).rejects.toThrow(/too many requests/);
  });
});
