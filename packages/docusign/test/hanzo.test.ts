import { describe, it, expect } from 'vitest';
import {
  renderPage,
  buildDocumentContext,
  contextNote,
  buildMessages,
  ask,
  listModels,
  SYSTEM_PROMPT,
  type PageTextItem,
} from '../src/hanzo';
import type { AiClient } from '../src/client';

const pages = (n: number, per: number): PageTextItem[] =>
  Array.from({ length: n }, (_, i) => ({ page: i + 1, text: 'x'.repeat(per) }));

describe('renderPage', () => {
  it('labels a page and keeps its text', () => {
    expect(renderPage({ page: 3, text: '  hello  ' })).toBe('[Page 3]\nhello');
  });
  it('renders a header-only block for an empty page', () => {
    expect(renderPage({ page: 2, text: '   ' })).toBe('[Page 2]');
  });
});

describe('buildDocumentContext (windowing / truncation)', () => {
  it('includes every page when under budget and reports not truncated', () => {
    const ctx = buildDocumentContext(pages(3, 50), 10_000);
    expect(ctx.totalPages).toBe(3);
    expect(ctx.includedPages).toBe(3);
    expect(ctx.truncated).toBe(false);
  });

  it('truncates in order and flags it when over budget', () => {
    // each rendered page ~ "[Page N]\n" + 500 chars; budget fits ~2 pages
    const ctx = buildDocumentContext(pages(10, 500), 1100);
    expect(ctx.totalPages).toBe(10);
    expect(ctx.includedPages).toBeGreaterThanOrEqual(1);
    expect(ctx.includedPages).toBeLessThan(10);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBeLessThanOrEqual(1100);
  });

  it('hard-cuts a single oversized first page to the budget, always returning something', () => {
    const ctx = buildDocumentContext(pages(1, 5000), 1000);
    expect(ctx.includedPages).toBe(1);
    expect(ctx.truncated).toBe(true);
    expect(ctx.text.length).toBe(1000);
  });

  it('handles an empty document', () => {
    const ctx = buildDocumentContext([], 1000);
    expect(ctx).toEqual({ text: '', totalPages: 0, includedPages: 0, truncated: false });
  });

  it('never reorders pages', () => {
    const ctx = buildDocumentContext([{ page: 1, text: 'AAA' }, { page: 2, text: 'BBB' }], 10_000);
    expect(ctx.text.indexOf('AAA')).toBeLessThan(ctx.text.indexOf('BBB'));
  });
});

describe('contextNote', () => {
  it('is honest about full vs truncated vs empty', () => {
    expect(contextNote({ text: '', totalPages: 0, includedPages: 0, truncated: false })).toMatch(/No agreement text/);
    expect(contextNote({ text: 'x', totalPages: 5, includedPages: 5, truncated: false })).toMatch(/full document \(5 pages\)/);
    expect(contextNote({ text: 'x', totalPages: 10, includedPages: 3, truncated: true })).toMatch(/3 of 10 pages/);
  });
});

describe('buildMessages', () => {
  const ctx = buildDocumentContext([{ page: 1, text: 'The parties agree.' }]);
  it('sets the grounded system prompt and fences the agreement as data', () => {
    const msgs = buildMessages('Summarize.', ctx, { title: 'MSA', status: 'completed' });
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('---- agreement ----');
    expect(msgs[1].content).toContain('The parties agree.');
    expect(msgs[1].content).toContain('Agreement: MSA');
    expect(msgs[1].content).toContain('Status: completed');
    expect(msgs[1].content).toContain('---- task ----\nSummarize.');
  });
  it('states it is not legal advice', () => {
    expect(SYSTEM_PROMPT).toMatch(/not legal advice/i);
  });
});

// A stub AiClient records the request and returns a canned completion.
function stubClient(capture: { model?: string; messages?: unknown }): AiClient {
  return {
    chat: {
      completions: {
        async create(params) {
          capture.model = params.model;
          capture.messages = params.messages;
          return { choices: [{ message: { role: 'assistant', content: 'ANSWER' } }] };
        },
      },
    },
    models: { async list() { return [{ id: 'zen5' }, { id: 'zen-coder' }]; } },
  };
}

describe('ask (single call path, injected client)', () => {
  it('routes the default model and returns the assistant text', async () => {
    const cap: { model?: string } = {};
    const out = await ask('Summarize.', buildDocumentContext([{ page: 1, text: 'x' }]), undefined, { client: stubClient(cap) });
    expect(out).toBe('ANSWER');
    expect(cap.model).toBe('zen5');
  });
  it('honors an explicit model', async () => {
    const cap: { model?: string } = {};
    await ask('t', buildDocumentContext([{ page: 1, text: 'x' }]), undefined, { client: stubClient(cap), model: 'zen-coder' });
    expect(cap.model).toBe('zen-coder');
  });
});

describe('listModels (injected client)', () => {
  it('returns the model ids', async () => {
    expect(await listModels({ client: stubClient({}) })).toEqual(['zen5', 'zen-coder']);
  });
});
