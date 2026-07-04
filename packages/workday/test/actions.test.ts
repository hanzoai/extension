import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams } from '@hanzo/ai';
import { ACTIONS, actionList, actionPrompt, isActionId, runAction } from '../src/actions.js';
import { buildPeopleContext } from '../src/people.js';

const ctx = buildPeopleContext([{ title: 'Workers', blocks: ['Logan McNeil — VP, HR'] }]);

function mockClient(text: string) {
  const reply: ChatCompletion = {
    id: 'c', object: 'chat.completion', created: 0, model: 'zen5',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
  const create = vi.fn(async (_p: ChatCompletionCreateParams) => reply);
  return { client: { chat: { completions: { create } }, models: { list: vi.fn() } } as unknown as AiClient, create };
}

describe('actions: catalog', () => {
  it('exposes exactly the five documented actions', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(
      ['answerHrQuestion', 'draftJobDescription', 'draftReviewFeedback', 'summarizeOrg', 'summarizeWorker'].sort(),
    );
  });

  it('every action has a non-empty label and prompt', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      expect(a.label.length, id).toBeGreaterThan(0);
      expect(a.prompt.length, id).toBeGreaterThan(20);
    }
  });

  it('actionList mirrors the catalog order and shape', () => {
    const list = actionList();
    expect(list.map((a) => a.id)).toEqual(Object.keys(ACTIONS));
    expect(list[0]).toEqual({ id: 'summarizeWorker', label: ACTIONS.summarizeWorker.label });
  });
});

describe('actions: prompt intent + HR guardrails', () => {
  it('summarizeWorker forbids inferring compensation or protected characteristics', () => {
    const p = actionPrompt('summarizeWorker');
    expect(p).toMatch(/compensation/i);
    expect(p).toMatch(/protected characteristic/i);
  });
  it('draftJobDescription asks for inclusive, bias-free language', () => {
    const p = actionPrompt('draftJobDescription');
    expect(p).toMatch(/inclusive|bias-free/i);
    expect(p).toMatch(/requisition/i);
  });
  it('summarizeOrg asks for headcount and open requisitions', () => {
    const p = actionPrompt('summarizeOrg');
    expect(p).toMatch(/headcount/i);
    expect(p).toMatch(/requisition/i);
  });
  it('answerHrQuestion says the answer is informational and may need review', () => {
    expect(actionPrompt('answerHrQuestion')).toMatch(/informational/i);
    expect(actionPrompt('answerHrQuestion')).toMatch(/review/i);
  });
  it('draftReviewFeedback notes the records lack performance ratings', () => {
    expect(actionPrompt('draftReviewFeedback')).toMatch(/performance rating/i);
  });
});

describe('actions: isActionId / actionPrompt guards', () => {
  it('narrows known ids and rejects unknown', () => {
    expect(isActionId('summarizeWorker')).toBe(true);
    expect(isActionId('nope')).toBe(false);
  });
  it('actionPrompt throws on an unknown id', () => {
    expect(() => actionPrompt('nope')).toThrow(/Unknown action/);
  });
});

describe('actions: runAction', () => {
  it('routes the resolved prompt through ask (one code path to the model)', async () => {
    const { client, create } = mockClient('summary');
    const out = await runAction('summarizeWorker', ctx, { subject: 'Logan McNeil' }, { client });
    expect(out).toBe('summary');
    const user = String(create.mock.calls[0][0].messages[1].content);
    expect(user).toContain(ACTIONS.summarizeWorker.prompt);
    expect(user).toContain('Logan McNeil');
  });

  it('rejects (not synchronously throws) on an unknown id', async () => {
    await expect(runAction('nope', ctx)).rejects.toThrow(/Unknown action/);
  });
});
