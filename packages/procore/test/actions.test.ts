import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams } from '@hanzo/ai';
import { ACTIONS, actionList, actionPrompt, isActionId, runAction } from '../src/actions.js';
import { buildProjectContext } from '../src/project.js';

const ctx = buildProjectContext([{ title: 'RFIs', blocks: ['RFI 042: base plate conflict'] }]);

function mockClient(text: string) {
  const reply: ChatCompletion = {
    id: 'c', object: 'chat.completion', created: 0, model: 'zen5',
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
  const create = vi.fn(async (_p: ChatCompletionCreateParams) => reply);
  return { client: { chat: { completions: { create } }, models: { list: vi.fn() } } as unknown as AiClient, create };
}

describe('actions: catalog', () => {
  it('exposes exactly the four documented actions', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(
      ['draftRfiResponse', 'extractActionItems', 'projectStatus', 'summarizeRfi'].sort(),
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
    expect(list[0]).toEqual({ id: 'summarizeRfi', label: ACTIONS.summarizeRfi.label });
  });
});

describe('actions: prompt intent', () => {
  it('draftRfiResponse tells the model not to invent an answer it lacks', () => {
    expect(actionPrompt('draftRfiResponse')).toMatch(/still needed|inventing/i);
    expect(actionPrompt('draftRfiResponse')).toMatch(/RFI reply/i);
  });
  it('extractActionItems asks for owners and severity-ordered risks', () => {
    const p = actionPrompt('extractActionItems');
    expect(p).toMatch(/action items/i);
    expect(p).toMatch(/risks/i);
    expect(p).toMatch(/severity/i);
  });
  it('projectStatus asks for overdue RFIs/submittals', () => {
    expect(actionPrompt('projectStatus')).toMatch(/overdue/i);
  });
});

describe('actions: isActionId / actionPrompt guards', () => {
  it('narrows known ids and rejects unknown', () => {
    expect(isActionId('summarizeRfi')).toBe(true);
    expect(isActionId('nope')).toBe(false);
  });
  it('actionPrompt throws on an unknown id', () => {
    expect(() => actionPrompt('nope')).toThrow(/Unknown action/);
  });
});

describe('actions: runAction', () => {
  it('routes the resolved prompt through ask (one code path to the model)', async () => {
    const { client, create } = mockClient('summary');
    const out = await runAction('summarizeRfi', ctx, { name: 'Tower A' }, { client });
    expect(out).toBe('summary');
    const user = String(create.mock.calls[0][0].messages[1].content);
    expect(user).toContain(ACTIONS.summarizeRfi.prompt);
    expect(user).toContain('RFI 042');
  });

  it('rejects (not synchronously throws) on an unknown id', async () => {
    await expect(runAction('nope', ctx)).rejects.toThrow(/Unknown action/);
  });
});
