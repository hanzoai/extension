import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildMessages, requestBody, extractContent, ask, askStream, streamDelta, listModels,
  SYSTEM_PROMPT,
} from '../src/chat';
import { DEFAULT_MODEL, buildContext, type PageText, type DocumentContext } from '../src/config';

function ctxOf(text: string, opts: Partial<DocumentContext> = {}): DocumentContext {
  return { text, firstPage: 1, lastPage: 1, totalPages: 1, truncated: false, ...opts };
}
function pages(n: number, per: number): PageText[] {
  return Array.from({ length: n }, (_, i) => ({ page: i + 1, text: 'y'.repeat(per) }));
}

describe('SYSTEM_PROMPT (legal analyst grounding)', () => {
  it('demands page citations and forbids guessing', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('page number');
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('only from the document');
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('not legal advice');
  });
});

describe('buildMessages', () => {
  it('fences the document text and prepends the context note', () => {
    const ctx = buildContext(pages(2, 20), 10_000);
    const m = buildMessages('Summarize this', ctx);
    expect(m[0].role).toBe('system');
    expect(m[0].content).toBe(SYSTEM_PROMPT);
    expect(m[1].role).toBe('user');
    expect(m[1].content).toContain('---- document text ----');
    expect(m[1].content).toContain('---- task ----');
    expect(m[1].content).toContain('Summarize this');
    expect(m[1].content.toLowerCase()).toContain('full document'); // the note
  });

  it('includes a highlighted selection block when a selection is given', () => {
    const m = buildMessages('Explain this', ctxOf('doc body'), 'the indemnification clause');
    expect(m[1].content).toContain('---- highlighted selection ----');
    expect(m[1].content).toContain('the indemnification clause');
  });

  it('omits the selection block when there is no selection', () => {
    const m = buildMessages('Summarize', ctxOf('doc body'));
    expect(m[1].content).not.toContain('highlighted selection');
  });

  it('carries the truncation warning into the prompt when windowed', () => {
    const ctx = buildContext(pages(10, 1000), 3500);
    const m = buildMessages('Summarize', ctx);
    expect(m[1].content.toLowerCase()).toContain('truncated');
  });
});

describe('requestBody', () => {
  it('defaults the model and disables streaming', () => {
    const b = requestBody(buildMessages('x', ctxOf('d')));
    expect(b.model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('zen5');
    expect(b.stream).toBe(false);
    expect(Array.isArray(b.messages)).toBe(true);
  });
  it('passes an explicit model + temperature through', () => {
    const b = requestBody(buildMessages('x', ctxOf('d')), { model: 'zen5-pro', temperature: 0.1 });
    expect(b.model).toBe('zen5-pro');
    expect(b.temperature).toBe(0.1);
  });
  it('enables streaming only when opts.stream is true', () => {
    expect(requestBody(buildMessages('x', ctxOf('d')), { stream: true }).stream).toBe(true);
    expect(requestBody(buildMessages('x', ctxOf('d')), { stream: false }).stream).toBe(false);
  });
});

describe('streamDelta', () => {
  it('reads choices[0].delta.content from an SSE frame', () => {
    expect(streamDelta(JSON.stringify({ choices: [{ delta: { content: 'Par' } }] }))).toBe('Par');
  });
  it('returns empty string for a role-only / empty delta', () => {
    expect(streamDelta(JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] }))).toBe('');
    expect(streamDelta(JSON.stringify({ choices: [{}] }))).toBe('');
  });
});

describe('extractContent', () => {
  it('reads OpenAI choices[0].message.content', () => {
    expect(extractContent({ choices: [{ message: { content: 'answer' } }] })).toBe('answer');
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

  it('POSTs to the gateway with the bearer, context, and selection', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer sk-tok');
      expect(body.messages[1].content).toContain('the arbitration clause'); // selection
      expect(body.messages[1].content).toContain('DOC BODY'); // context
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'grounded answer (p. 1)' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ask('Explain', ctxOf('DOC BODY'), 'sk-tok', 'the arbitration clause');
    expect(out).toBe('grounded answer (p. 1)');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/chat/completions');
  });

  it('omits Authorization when token is empty', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: 'ok' }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await ask('hi', ctxOf('d'), '')).toBe('ok');
  });

  it('surfaces a structured gateway error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 429,
      text: async () => JSON.stringify({ error: { message: 'too many requests' } }),
    } as any)));
    await expect(ask('x', ctxOf('d'), 't')).rejects.toThrow(/too many requests/);
  });
});

describe('askStream', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('concatenates deltas and reports each chunk', async () => {
    const frames = [
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: ' world' } }] }) + '\n\n',
      'data: [DONE]\n\n',
    ];
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body: stream } as any)));
    const chunks: string[] = [];
    const full = await askStream('Summarize', ctxOf('d'), 'sk-1', (c) => chunks.push(c));
    expect(full).toBe('Hello world');
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('throws on a non-2xx stream response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' } as any)));
    await expect(askStream('x', ctxOf('d'), 't', () => {})).rejects.toThrow(/500/);
  });
});

describe('listModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns ids from the /v1/models data array with the bearer', async () => {
    const fetchMock = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.hanzo.ai/v1/models');
      expect(init.headers.Authorization).toBe('Bearer t');
      return { ok: true, json: async () => ({ data: [{ id: 'zen5' }, { id: 'zen5-pro' }] }) } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('t')).toEqual(['zen5', 'zen5-pro']);
  });

  it('tolerates a bare string array and omits the bearer when unauthenticated', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, json: async () => ['a', 'b'] } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await listModels('')).toEqual(['a', 'b']);
  });

  it('throws on a failed model list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 } as any)));
    await expect(listModels('bad')).rejects.toThrow(/401/);
  });
});
