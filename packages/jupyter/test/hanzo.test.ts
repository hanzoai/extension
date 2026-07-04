import { describe, it, expect, vi } from 'vitest';
import type { AiClient } from '@hanzo/ai';
import {
  SYSTEM_PROMPT,
  buildMessages,
  actionTask,
  actionMessages,
  actionReturnsCode,
  actionNeedsOutputs,
  chatMessages,
  completionParams,
  extractContent,
  runAction,
  streamChat,
  type ActionId,
} from '../src/hanzo';
import type { CellData } from '../src/notebook';

const codeCell: CellData = { type: 'code', source: 'df.groupby("k").sum()' };
const errCell: CellData = {
  type: 'code',
  source: 'df.groupby("k").sum()',
  outputs: [
    { kind: 'error', ename: 'KeyError', evalue: "'k'", text: 'KeyError: k' },
  ],
};

const ALL: ActionId[] = ['explain', 'fix', 'document', 'optimize', 'generate'];

// ── message shaping ──────────────────────────────────────────────────────────

describe('buildMessages', () => {
  it('leads with the Hanzo system frame', () => {
    const msgs = buildMessages('do a thing', 'ctx');
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
  });
  it('fences the context as data (injection boundary)', () => {
    const msgs = buildMessages('T', 'CONTEXT');
    const user = msgs[1].content as string;
    expect(user).toContain('T');
    expect(user).toContain('---- notebook context ----');
    expect(user).toContain('CONTEXT');
    expect(user).toContain('---- end ----');
  });
  it('omits the context block when context is empty', () => {
    const msgs = buildMessages('just the task', '');
    expect(msgs[1].content).toBe('just the task');
  });
});

// ── action catalog ───────────────────────────────────────────────────────────

describe('actionTask', () => {
  it('produces a non-empty task string for every action', () => {
    for (const id of ALL) expect(actionTask(id).length).toBeGreaterThan(10);
  });
  it('embeds the user detail into the generate task', () => {
    expect(actionTask('generate', 'plot a histogram of ages')).toContain(
      'plot a histogram of ages',
    );
  });
  it('the fix task references the error below the source', () => {
    expect(actionTask('fix').toLowerCase()).toContain('error');
  });
  it('code-returning actions ask for no code fences', () => {
    for (const id of ['fix', 'document', 'optimize', 'generate'] as ActionId[]) {
      expect(actionTask(id).toLowerCase()).toContain('no code fences');
    }
  });
});

describe('action metadata', () => {
  it('classifies which actions return code vs prose', () => {
    expect(actionReturnsCode('explain')).toBe(false);
    expect(actionReturnsCode('fix')).toBe(true);
    expect(actionReturnsCode('document')).toBe(true);
    expect(actionReturnsCode('optimize')).toBe(true);
    expect(actionReturnsCode('generate')).toBe(true);
  });
  it('only the fix action needs cell outputs', () => {
    expect(actionNeedsOutputs('fix')).toBe(true);
    for (const id of ['explain', 'document', 'optimize', 'generate'] as ActionId[]) {
      expect(actionNeedsOutputs(id)).toBe(false);
    }
  });
});

describe('actionMessages', () => {
  it('includes the cell source in the context', () => {
    const msgs = actionMessages('explain', codeCell);
    expect(msgs[1].content).toContain('df.groupby');
    expect(msgs[1].content).toContain('```python');
  });
  it('the fix action attaches the error output; others do not', () => {
    const fix = actionMessages('fix', errCell)[1].content as string;
    expect(fix).toContain('KeyError');
    const explain = actionMessages('explain', errCell)[1].content as string;
    expect(explain).not.toContain('KeyError');
  });
  it('generate with no cell yields task-only messages', () => {
    const msgs = actionMessages('generate', undefined, 'load a CSV');
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toContain('load a CSV');
    expect(msgs[1].content).not.toContain('notebook context');
  });
});

describe('chatMessages', () => {
  it('wraps a bare prompt with the system frame and no context', () => {
    const msgs = chatMessages('what does this do?');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toBe('what does this do?');
  });
  it('attaches an explicit context block when provided', () => {
    const msgs = chatMessages('summarize', 'Cell [1]: x=1');
    expect(msgs[1].content).toContain('Cell [1]: x=1');
  });
});

// ── request shaping ──────────────────────────────────────────────────────────

describe('completionParams', () => {
  it('shapes the exact wire body', () => {
    const msgs = buildMessages('t', 'c');
    expect(completionParams(msgs, 'zen5', false)).toEqual({
      model: 'zen5',
      messages: msgs,
      stream: false,
      temperature: 0.2,
    });
  });
  it('sets stream:true for streaming calls', () => {
    expect(completionParams([], 'zen5', true).stream).toBe(true);
  });
});

// ── response extraction ──────────────────────────────────────────────────────

describe('extractContent', () => {
  it('pulls the assistant content', () => {
    expect(
      extractContent({ choices: [{ message: { content: 'hello' } }] }),
    ).toBe('hello');
  });
  it('throws on empty / missing content', () => {
    expect(() => extractContent({ choices: [] })).toThrow(/no content/i);
    expect(() =>
      extractContent({ choices: [{ message: { content: '   ' } }] }),
    ).toThrow(/no content/i);
  });
});

// ── async edges over a mocked @hanzo/ai client ───────────────────────────────

/** A mock AiClient that records the last completion request and replies fixed. */
function mockClient(reply: string): {
  client: AiClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (params: { stream?: boolean }) => {
    if (params.stream) {
      const words = reply.split(' ');
      return (async function* () {
        for (const w of words) {
          yield { choices: [{ delta: { content: w + ' ' } }] };
        }
      })();
    }
    return { choices: [{ message: { content: reply } }] };
  });
  const client = { chat: { completions: { create } } } as unknown as AiClient;
  return { client, create };
}

describe('runAction (mocked SDK)', () => {
  it('sends the shaped, non-streaming request and returns the content', async () => {
    const { client, create } = mockClient('corrected code');
    const out = await runAction('fix', { cell: errCell }, client, { model: 'zen5' });
    expect(out).toBe('corrected code');
    const [params] = create.mock.calls[0];
    expect(params.model).toBe('zen5');
    expect(params.stream).toBe(false);
    expect(params.temperature).toBe(0.2);
    // the fix request carries the error traceback
    expect(JSON.stringify(params.messages)).toContain('KeyError');
  });

  it('passes the abort signal through as the options arg', async () => {
    const { client, create } = mockClient('x');
    const ctrl = new AbortController();
    await runAction('explain', { cell: codeCell }, client, { model: 'm' }, ctrl.signal);
    const [, options] = create.mock.calls[0];
    expect(options).toEqual({ signal: ctrl.signal });
  });
});

describe('streamChat (mocked SDK)', () => {
  it('yields text deltas from the streaming generator', async () => {
    const { client, create } = mockClient('one two three');
    const chunks: string[] = [];
    for await (const d of streamChat(
      chatMessages('go'),
      client,
      { model: 'zen5' },
    )) {
      chunks.push(d);
    }
    expect(chunks.join('')).toBe('one two three ');
    expect(create.mock.calls[0][0].stream).toBe(true);
  });

  it('drops empty deltas', async () => {
    const create = vi.fn(async () =>
      (async function* () {
        yield { choices: [{ delta: { content: '' } }] };
        yield { choices: [{ delta: {} }] };
        yield { choices: [{ delta: { content: 'kept' } }] };
      })(),
    );
    const client = { chat: { completions: { create } } } as unknown as AiClient;
    const out: string[] = [];
    for await (const d of streamChat([], client, { model: 'm' })) out.push(d);
    expect(out).toEqual(['kept']);
  });
});
