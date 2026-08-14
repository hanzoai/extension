import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildMessages,
  requestBody,
  extractContent,
  streamDelta,
  ask,
  askStream,
  listModels,
  summarizeTranscript,
  SYSTEM_PROMPT,
  QUICK_ACTIONS,
  buildTranscriptContext,
  type TranscriptContext,
} from '../src/hanzo';
import { DEFAULT_MODEL } from '../src/config';

function ctxOf(text: string, opts: Partial<TranscriptContext> = {}): TranscriptContext {
  return { text, totalSegments: 1, includedSegments: 1, truncated: false, ...opts };
}

describe('SYSTEM_PROMPT (transcript grounding)', () => {
  it('forbids inventing statements and asks for attribution', () => {
    const p = SYSTEM_PROMPT.toLowerCase();
    expect(p).toContain('only from the meeting transcript');
    expect(p).toContain('never invent');
    expect(p).toContain('attribute');
  });
});

describe('buildMessages (summary-prompt assembly)', () => {
  it('fences the transcript, carries the honest note, and appends the task', () => {
    const m = buildMessages('Summarize this', ctxOf('Ana: hi'));
    expect(m[0].role).toBe('system');
    expect(m[0].content).toBe(SYSTEM_PROMPT);
    expect(m[1].role).toBe('user');
    expect(m[1].content).toContain('---- meeting transcript ----');
    expect(m[1].content).toContain('Ana: hi');
    expect(m[1].content).toContain('---- task ----');
    expect(m[1].content).toContain('Summarize this');
    expect(m[1].content.toLowerCase()).toContain('full meeting'); // context note
  });

  it('includes a meeting header (topic + participants) when metadata is given', () => {
    const m = buildMessages('Recap', ctxOf('body'), {
      topic: 'Q3 Planning',
      participants: ['Ana', 'Bob'],
      meetingId: 'abc',
    });
    expect(m[1].content).toContain('Meeting: Q3 Planning');
    expect(m[1].content).toContain('Participants: Ana, Bob');
  });

  it('omits the header when no metadata is given', () => {
    const m = buildMessages('Recap', ctxOf('body'));
    expect(m[1].content).not.toContain('Meeting:');
    expect(m[1].content).not.toContain('Participants:');
  });

  it('carries the truncation warning into the prompt when windowed', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ text: 'z'.repeat(200), speaker: `S${i}` }));
    const m = buildMessages('Summarize', buildTranscriptContext(big, 400));
    expect(m[1].content.toLowerCase()).toContain('truncated');
  });
});

describe('QUICK_ACTIONS (panel/webhook parity)', () => {
  it('names the three actions with distinct intents', () => {
    expect(QUICK_ACTIONS.summary.toLowerCase()).toContain('summary');
    expect(QUICK_ACTIONS.actionItems.toLowerCase()).toContain('action items');
    expect(QUICK_ACTIONS.followupEmail.toLowerCase()).toContain('follow-up email');
  });
});

describe('requestBody', () => {
  it('defaults the model and disables streaming', () => {
    const b = requestBody(buildMessages('x', ctxOf('d')));
    expect(b.model).toBe(DEFAULT_MODEL);
    expect(b.stream).toBe(false);
    expect(Array.isArray(b.messages)).toBe(true);
  });
  it('passes an explicit model + temperature through', () => {
    const b = requestBody(buildMessages('x', ctxOf('d')), { model: 'zen-pro', temperature: 0.1 });
    expect(b.model).toBe('zen-pro');
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

describe('ask (request shaping over mock fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs to the gateway /v1 with the bearer, transcript and task', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer sk-tok');
      expect(body.messages[1].content).toContain('DECISION: ship friday'); // transcript
      expect(body.messages[1].content).toContain('What did we decide?'); // task
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'We decided to ship Friday.' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await ask('What did we decide?', ctxOf('DECISION: ship friday'), 'sk-tok');
    expect(out).toBe('We decided to ship Friday.');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.hanzo.ai/v1/chat/completions');
  });

  it('omits Authorization when the token is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, status: 200, text: async () => JSON.stringify({ content: 'ok' }) } as any;
    }));
    expect(await ask('hi', ctxOf('d'), '')).toBe('ok');
  });

  it('surfaces a structured gateway error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
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
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      expect(JSON.parse(init.body).stream).toBe(true); // askStream forces stream
      return { ok: true, body: stream } as any;
    }));
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

describe('summarizeTranscript (server one-shot)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('windows the segments and sends the Summarize action with the bearer', async () => {
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe('Bearer sk-srv');
      expect(body.messages[1].content).toContain(QUICK_ACTIONS.summary);
      expect(body.messages[1].content).toContain('Ana: kickoff'); // rendered segment
      expect(body.messages[1].content).toContain('Meeting: Sprint Review'); // meta header
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: 'Summary text.' } }] }),
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await summarizeTranscript(
      [{ speaker: 'Ana', text: 'kickoff' }, { speaker: 'Bob', text: 'agenda' }],
      'sk-srv',
      { topic: 'Sprint Review' },
    );
    expect(out).toBe('Summary text.');
  });
});

describe('listModels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns ids from /v1/models with the bearer', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.hanzo.ai/v1/models');
      expect(init.headers.Authorization).toBe('Bearer t');
      return { ok: true, json: async () => ({ data: [{ id: 'zen-1' }, { id: 'zen-pro' }] }) } as any;
    }));
    expect(await listModels('t')).toEqual(['zen-1', 'zen-pro']);
  });

  it('tolerates a bare array and omits the bearer when unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return { ok: true, json: async () => ['a', 'b'] } as any;
    }));
    expect(await listModels('')).toEqual(['a', 'b']);
  });

  it('throws on a failed model list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 } as any)));
    await expect(listModels('bad')).rejects.toThrow(/401/);
  });
});
