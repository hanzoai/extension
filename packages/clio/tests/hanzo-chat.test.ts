import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildMessages,
  requestBody,
  extractContent,
  ask,
  streamDelta,
  listModels,
  LEGAL_SYSTEM_PROMPT,
} from '../src/hanzo-chat';
import { DEFAULT_MODEL } from '../src/config';

describe('buildMessages', () => {
  it('uses the legal system prompt and passes a bare task with no context', () => {
    const m = buildMessages('summarize this matter', '');
    expect(m[0].role).toBe('system');
    expect(m[0].content).toBe(LEGAL_SYSTEM_PROMPT);
    expect(m[1].role).toBe('user');
    expect(m[1].content).toBe('summarize this matter');
  });

  it('fences the matter context as data when present', () => {
    const m = buildMessages('extract dates', 'Matter: 0001\nDescription: Estate of X');
    expect(m[1].content).toContain('extract dates');
    expect(m[1].content).toContain('---- matter context ----');
    expect(m[1].content).toContain('Estate of X');
  });

  it('accepts a custom system prompt override', () => {
    const m = buildMessages('x', '', 'CUSTOM');
    expect(m[0].content).toBe('CUSTOM');
  });

  it('legal system prompt forbids markdown fences and hallucination', () => {
    expect(LEGAL_SYSTEM_PROMPT.toLowerCase()).toContain('no markdown');
    expect(LEGAL_SYSTEM_PROMPT.toLowerCase()).toContain('never invent facts');
  });
});

describe('requestBody', () => {
  it('defaults the model and disables streaming', () => {
    const b = requestBody(buildMessages('x', ''));
    expect(b.model).toBe(DEFAULT_MODEL);
    expect(b.stream).toBe(false);
    expect(Array.isArray(b.messages)).toBe(true);
  });
  it('passes explicit model + temperature through', () => {
    const b = requestBody(buildMessages('x', ''), { model: 'zen-pro', temperature: 0.2 });
    expect(b.model).toBe('zen-pro');
    expect(b.temperature).toBe(0.2);
  });
  it('enables streaming only when opts.stream is true', () => {
    expect(requestBody(buildMessages('x', ''), { stream: true }).stream).toBe(true);
    expect(requestBody(buildMessages('x', ''), { stream: false }).stream).toBe(false);
  });
});

describe('streamDelta', () => {
  it('reads choices[0].delta.content from an SSE frame', () => {
    expect(streamDelta(JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }))).toBe('Hel');
  });
  it('returns empty for a role-only / empty delta', () => {
    expect(streamDelta(JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }))).toBe('');
    expect(streamDelta(JSON.stringify({ choices: [{}] }))).toBe('');
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
      expect(init.headers.Authorization).toBe('Bearer sk-abc');
      expect(body.messages[0].content).toBe(LEGAL_SYSTEM_PROMPT);
      expect(body.messages[1].content).toContain('summarize');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'a summary' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ask('summarize', 'Matter: 1', 'sk-abc');
    expect(out).toBe('a summary');
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: 'too many requests' } }),
      } as any)),
    );
    await expect(ask('x', '', 't')).rejects.toThrow(/too many requests/);
  });
});

describe('listModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns ids from the /v1/models data array with the bearer', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.hanzo.ai/v1/models');
      expect(init.headers.Authorization).toBe('Bearer t');
      return { ok: true, json: async () => ({ data: [{ id: 'zen-1' }, { id: 'zen-pro' }] }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('t')).toEqual(['zen-1', 'zen-pro']);
  });

  it('tolerates a bare string array and omits the bearer when unauthenticated', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, json: async () => ['a', 'b'] } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('')).toEqual(['a', 'b']);
  });
});
