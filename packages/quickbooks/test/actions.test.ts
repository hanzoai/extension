import { describe, it, expect } from 'vitest';
import { ACTIONS, isActionId, actionPrompt, actionList, runAction } from '../src/actions';
import type { AiClient } from '@hanzo/ai';
import type { FinanceContext } from '../src/finance';

const ctx: FinanceContext = { text: 'Net Income: 37000.00', label: 'P&L', truncated: false };

describe('the action catalog', () => {
  it('has the four books actions with stable ids and labels', () => {
    expect(Object.keys(ACTIONS)).toEqual([
      'summarizeFinancials',
      'explainReport',
      'draftLineDescriptions',
      'categorizeTransactions',
    ]);
    expect(ACTIONS.summarizeFinancials.label).toBe('Summarize financials');
  });

  it('every prompt forbids inventing data (grounding is baked into each action)', () => {
    for (const a of Object.values(ACTIONS)) {
      expect(a.prompt.length).toBeGreaterThan(40);
      expect(a.prompt).toMatch(/do not invent|not invent|instead of inventing|say (so|what is needed)/i);
    }
  });
});

describe('isActionId', () => {
  it('narrows only known ids', () => {
    expect(isActionId('summarizeFinancials')).toBe(true);
    expect(isActionId('explainReport')).toBe(true);
    expect(isActionId('nope')).toBe(false);
    expect(isActionId('__proto__')).toBe(false);
  });
});

describe('actionPrompt', () => {
  it('resolves a known id to its prompt', () => {
    expect(actionPrompt('summarizeFinancials')).toBe(ACTIONS.summarizeFinancials.prompt);
  });
  it('throws on an unknown id', () => {
    expect(() => actionPrompt('bogus')).toThrow(/Unknown action/);
  });
});

describe('actionList', () => {
  it('derives the ordered id+label list from the catalog', () => {
    const list = actionList();
    expect(list.map((a) => a.id)).toEqual(Object.keys(ACTIONS));
    expect(list[0]).toEqual({ id: 'summarizeFinancials', label: 'Summarize financials' });
  });
});

function stubClient(capture: { messages?: any }): AiClient {
  return {
    chat: {
      completions: {
        async create(params: any) {
          capture.messages = params.messages;
          return {
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: params.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'SUMMARY' }, finish_reason: 'stop' }],
          };
        },
      },
    },
    models: { async list() { return []; } },
  } as unknown as AiClient;
}

describe('runAction (one path from id to the model)', () => {
  it('runs the resolved action prompt over the context and returns the model text', async () => {
    const cap: { messages?: any } = {};
    const out = await runAction('summarizeFinancials', ctx, { client: stubClient(cap) });
    expect(out).toBe('SUMMARY');
    // the task in the user turn is the action's prompt
    expect(cap.messages[1].content).toContain(ACTIONS.summarizeFinancials.prompt);
  });
  it('rejects (does not throw synchronously) on an unknown id', async () => {
    await expect(runAction('bogus', ctx, { client: stubClient({}) })).rejects.toThrow(/Unknown action/);
  });
});
