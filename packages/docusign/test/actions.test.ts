import { describe, it, expect } from 'vitest';
import { ACTIONS, isActionId, actionPrompt, actionList, runAction } from '../src/actions';
import { buildDocumentContext } from '../src/hanzo';
import type { AiClient } from '../src/client';

describe('the four actions', () => {
  it('are exactly summarize, extractTerms, riskFlags, draftMemo', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(['draftMemo', 'extractTerms', 'riskFlags', 'summarize']);
  });
  it('each has a non-trivial prompt and a label', () => {
    for (const [, a] of Object.entries(ACTIONS)) {
      expect(a.prompt.length).toBeGreaterThan(40);
      expect(a.label.length).toBeGreaterThan(0);
    }
  });
  it('extractTerms asks for parties, dates, payment, obligations, governing law', () => {
    const p = ACTIONS.extractTerms.prompt.toLowerCase();
    for (const term of ['parties', 'date', 'payment', 'obligation', 'governing law']) {
      expect(p).toContain(term);
    }
  });
});

describe('isActionId / actionPrompt / actionList', () => {
  it('narrows known ids only', () => {
    expect(isActionId('summarize')).toBe(true);
    expect(isActionId('nope')).toBe(false);
  });
  it('resolves a prompt and throws on an unknown id', () => {
    expect(actionPrompt('riskFlags')).toBe(ACTIONS.riskFlags.prompt);
    expect(() => actionPrompt('bogus')).toThrow(/Unknown action/);
  });
  it('lists id+label in catalog order', () => {
    expect(actionList().map((a) => a.id)).toEqual(['summarize', 'extractTerms', 'riskFlags', 'draftMemo']);
  });
});

describe('runAction (single path to the model)', () => {
  it('sends the action prompt as the task over the windowed agreement', async () => {
    let sentTask = '';
    const client: AiClient = {
      chat: {
        completions: {
          async create(params) {
            sentTask = (params.messages[1] as { content: string }).content;
            return { choices: [{ message: { role: 'assistant', content: 'RESULT' } }] };
          },
        },
      },
      models: { async list() { return []; } },
    };
    const ctx = buildDocumentContext([{ page: 1, text: 'The parties agree to pay $100.' }]);
    const out = await runAction('summarize', ctx, { title: 'MSA' }, { client });
    expect(out).toBe('RESULT');
    expect(sentTask).toContain(ACTIONS.summarize.prompt);
    expect(sentTask).toContain('The parties agree to pay $100.');
  });

  it('throws on an unknown action before any call', async () => {
    await expect(runAction('bogus', buildDocumentContext([]), undefined, {})).rejects.toThrow(/Unknown action/);
  });
});
