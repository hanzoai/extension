import { describe, it, expect, vi } from 'vitest';
import type { AiClient } from '@hanzo/ai';
import {
  renderProperties,
  assembleRecordContext,
  contextNote,
  buildMessages,
  extractContent,
  complete,
  listModels,
  actionTask,
  SYSTEM_PROMPT,
  type ContextBlock,
} from '../src/hanzo.js';

describe('renderProperties', () => {
  it('renders sorted key: value lines, dropping empties', () => {
    const s = renderProperties({ email: 'a@b.com', firstname: 'Ada', middlename: '', lastname: 'L' });
    expect(s).toBe('email: a@b.com\nfirstname: Ada\nlastname: L');
  });
  it('is deterministic regardless of key insertion order', () => {
    const a = renderProperties({ b: '2', a: '1' });
    const b = renderProperties({ a: '1', b: '2' });
    expect(a).toBe(b);
  });
});

describe('assembleRecordContext', () => {
  const blocks: ContextBlock[] = [
    { label: 'Contact', text: 'firstname: Ada' },
    { label: 'Associated Deals', text: 'dealname: Big' },
  ];

  it('renders all blocks under a budget, not truncated', () => {
    const ctx = assembleRecordContext(blocks, 10_000);
    expect(ctx.truncated).toBe(false);
    expect(ctx.text).toContain('### Contact');
    expect(ctx.text).toContain('### Associated Deals');
  });

  it('preserves block order', () => {
    const ctx = assembleRecordContext(blocks, 10_000);
    expect(ctx.text.indexOf('### Contact')).toBeLessThan(ctx.text.indexOf('### Associated Deals'));
  });

  it('drops later blocks past the budget and marks truncated', () => {
    // Budget fits the first block but not the second.
    const ctx = assembleRecordContext(blocks, 25);
    expect(ctx.text).toContain('### Contact');
    expect(ctx.text).not.toContain('### Associated Deals');
    expect(ctx.truncated).toBe(true);
  });

  it('always includes at least the first block, hard-cut if it alone is over', () => {
    const big: ContextBlock[] = [{ label: 'X', text: 'y'.repeat(1000) }];
    const ctx = assembleRecordContext(big, 50);
    expect(ctx.text.length).toBe(50);
    expect(ctx.truncated).toBe(true);
  });

  it('returns empty, not-truncated for no blocks', () => {
    expect(assembleRecordContext([])).toEqual({ text: '', truncated: false });
  });
});

describe('contextNote', () => {
  it('reports complete vs truncated vs empty honestly', () => {
    expect(contextNote({ text: 'x', truncated: false })).toMatch(/complete/);
    expect(contextNote({ text: 'x', truncated: true })).toMatch(/truncated/);
    expect(contextNote({ text: '', truncated: false })).toMatch(/No record data/);
  });
});

describe('buildMessages', () => {
  it('produces a system + user pair with the record fenced as data', () => {
    const msgs = buildMessages('Summarize', { text: 'firstname: Ada', truncated: false });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    const content = msgs[1].content as string;
    expect(content).toContain('---- record ----');
    expect(content).toContain('firstname: Ada');
    expect(content).toContain('---- task ----');
    expect(content).toContain('Summarize');
  });
});

describe('extractContent', () => {
  it('pulls choices[0].message.content', () => {
    expect(
      extractContent({ choices: [{ message: { content: 'the answer' } }] }),
    ).toBe('the answer');
  });
  it('throws on empty content', () => {
    expect(() => extractContent({ choices: [{ message: { content: '' } }] })).toThrow(/no content/);
  });
  it('throws on a missing choices array', () => {
    expect(() => extractContent({})).toThrow(/no content/);
  });
});

describe('actionTask', () => {
  it('is fixed for summarize / nextSteps', () => {
    expect(actionTask('summarize')).toMatch(/Summarize this record/);
    expect(actionTask('nextSteps')).toMatch(/next steps/i);
  });
  it('folds the user detail into draft and ask', () => {
    expect(actionTask('draft', 'the renewal')).toContain('the renewal');
    expect(actionTask('ask', 'who is the decision maker?')).toBe('who is the decision maker?');
  });
  it('has sensible defaults when detail is blank', () => {
    expect(actionTask('draft', '')).toMatch(/follow-up/i);
    expect(actionTask('ask', '   ')).toMatch(/before reaching out/i);
  });
});

// A stub matching the published @hanzo/ai AiClient surface for the two methods
// the app uses, so request shaping is asserted without a network.
function stubClient(over: Partial<{
  completion: unknown;
  models: Array<{ id: string }>;
  onCreate: (params: unknown, options: unknown) => void;
}> = {}): AiClient {
  const create = vi.fn(async (params: unknown, options: unknown) => {
    over.onCreate?.(params, options);
    return (over.completion ?? { choices: [{ message: { content: 'ok' } }] }) as never;
  });
  const list = vi.fn(async () => (over.models ?? [{ id: 'zen5' }, { id: 'zen5-pro' }]) as never);
  return {
    chat: { completions: { create } },
    models: { list },
  } as unknown as AiClient;
}

describe('complete (over injected @hanzo/ai client)', () => {
  it('sends model + non-streaming messages and returns the content', async () => {
    let seen: any;
    const client = stubClient({
      completion: { choices: [{ message: { content: 'summary text' } }] },
      onCreate: (params) => (seen = params),
    });
    const out = await complete(
      'Summarize',
      { text: 'firstname: Ada', truncated: false },
      { client, model: 'zen5-pro', temperature: 0.2 },
    );
    expect(out).toBe('summary text');
    expect(seen.model).toBe('zen5-pro');
    expect(seen.stream).toBe(false);
    expect(seen.temperature).toBe(0.2);
    expect(seen.messages[0].role).toBe('system');
    expect(seen.messages[1].content).toContain('firstname: Ada');
  });

  it('defaults the model when none is passed', async () => {
    let seen: any;
    const client = stubClient({ onCreate: (p) => (seen = p) });
    await complete('t', { text: 'x', truncated: false }, { client });
    expect(seen.model).toBe('zen5');
  });

  it('forwards the abort signal in the options arg', async () => {
    let opts: any;
    const controller = new AbortController();
    const client = stubClient({ onCreate: (_p, o) => (opts = o) });
    await complete('t', { text: 'x', truncated: false }, { client, signal: controller.signal });
    expect(opts.signal).toBe(controller.signal);
  });
});

describe('listModels (over injected @hanzo/ai client)', () => {
  it('maps the catalog to ids', async () => {
    const client = stubClient({ models: [{ id: 'zen5' }, { id: 'zen5-coder' }] });
    expect(await listModels({ client })).toEqual(['zen5', 'zen5-coder']);
  });
});
