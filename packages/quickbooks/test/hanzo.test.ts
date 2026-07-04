import { describe, it, expect } from 'vitest';
import { buildMessages, extractContent, ask, listModels, SYSTEM_PROMPT } from '../src/hanzo';
import type { AiClient } from '@hanzo/ai';
import type { FinanceContext } from '../src/finance';

const ctx: FinanceContext = { text: 'Net Income: 37000.00', label: 'ProfitAndLoss (H1)', truncated: false };
const truncCtx: FinanceContext = { text: 'partial', label: 'P&L', truncated: true };

describe('SYSTEM_PROMPT', () => {
  it('grounds answers in the data and disclaims advice', () => {
    expect(SYSTEM_PROMPT).toMatch(/QuickBooks/);
    expect(SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(SYSTEM_PROMPT).toMatch(/not tax, audit, or accounting advice/i);
  });
});

describe('buildMessages', () => {
  it('sets the grounded system prompt and fences the financial data', () => {
    const msgs = buildMessages('Summarize.', ctx);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('---- financial data ----');
    expect(msgs[1].content).toContain('Net Income: 37000.00');
    expect(msgs[1].content).toContain('ProfitAndLoss (H1)'); // the context note (label)
    expect(msgs[1].content).toContain('---- task ----\nSummarize.');
  });
  it('carries the truncation note into the user turn when truncated', () => {
    expect(buildMessages('t', truncCtx)[1].content).toMatch(/truncated to fit/);
  });
});

describe('extractContent', () => {
  it('returns the assistant text of the first choice', () => {
    const out = extractContent({
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'zen5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ANSWER' }, finish_reason: 'stop' }],
    } as any);
    expect(out).toBe('ANSWER');
  });
  it('throws on an empty content body', () => {
    expect(() => extractContent({ choices: [{ message: { role: 'assistant', content: '' } }] } as any)).toThrow(/no content/);
    expect(() => extractContent({ choices: [] } as any)).toThrow(/no content/);
  });
});

// A stub AiClient records the request and returns a canned completion. Typed to
// the SDK's AiClient so the shapes are checked against the real contract.
function stubClient(capture: { model?: string; messages?: unknown; signal?: unknown }): AiClient {
  return {
    chat: {
      completions: {
        async create(params: any, options: any) {
          capture.model = params.model;
          capture.messages = params.messages;
          capture.signal = options?.signal;
          return {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: params.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'ANSWER' }, finish_reason: 'stop' }],
          };
        },
      },
    },
    models: {
      async list() {
        return [
          { id: 'zen5', object: 'model' },
          { id: 'zen-coder', object: 'model' },
        ];
      },
    },
  } as unknown as AiClient;
}

describe('ask (single call path, injected client)', () => {
  it('routes the default model, sends the fenced messages, and returns the assistant text', async () => {
    const cap: { model?: string; messages?: any } = {};
    const out = await ask('Summarize.', ctx, { client: stubClient(cap) });
    expect(out).toBe('ANSWER');
    expect(cap.model).toBe('zen5');
    expect(cap.messages[0].role).toBe('system');
    expect(cap.messages[1].content).toContain('Net Income: 37000.00');
  });
  it('honors an explicit model', async () => {
    const cap: { model?: string } = {};
    await ask('t', ctx, { client: stubClient(cap), model: 'zen-coder' });
    expect(cap.model).toBe('zen-coder');
  });
  it('forwards the abort signal to the client', async () => {
    const cap: { signal?: unknown } = {};
    const c = new AbortController();
    await ask('t', ctx, { client: stubClient(cap), signal: c.signal });
    expect(cap.signal).toBe(c.signal);
  });
});

describe('listModels (injected client)', () => {
  it('returns the model ids', async () => {
    expect(await listModels({ client: stubClient({}) })).toEqual(['zen5', 'zen-coder']);
  });
});
