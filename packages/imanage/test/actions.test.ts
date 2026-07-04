import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams } from '@hanzo/ai';
import { ACTIONS, actionList, actionPrompt, isActionId, runAction } from '../src/actions.js';
import { buildContext } from '../src/documents.js';

const ctx = buildContext([{ title: 'Document', blocks: ['Document: NDA — mutual, 3-year term'] }]);

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
      ['compareDocuments', 'extractClauses', 'summarizeDocument', 'synthesizeMatter'].sort(),
    );
  });

  it('every action has a non-empty label and a substantial prompt', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      expect(a.label.length, id).toBeGreaterThan(0);
      expect(a.prompt.length, id).toBeGreaterThan(20);
    }
  });

  it('actionList mirrors the catalog order and shape', () => {
    const list = actionList();
    expect(list.map((a) => a.id)).toEqual(Object.keys(ACTIONS));
    expect(list[0]).toEqual({ id: 'summarizeDocument', label: ACTIONS.summarizeDocument.label });
  });
});

describe('actions: prompt intent', () => {
  it('summarizeDocument grounds in the text and handles profile-only', () => {
    const p = actionPrompt('summarizeDocument');
    expect(p).toMatch(/summar/i);
    expect(p).toMatch(/parties|obligations|terms/i);
    expect(p).toMatch(/metadata|profile/i);
  });
  it('extractClauses asks for parties, dates, clauses (contract review)', () => {
    const p = actionPrompt('extractClauses');
    expect(p).toMatch(/parties/i);
    expect(p).toMatch(/dates/i);
    expect(p).toMatch(/clauses/i);
    expect(p).toMatch(/governing law|indemnity|termination/i);
    expect(p).toMatch(/never infer|None found/i);
  });
  it('synthesizeMatter synthesizes across a set and attributes by document', () => {
    const p = actionPrompt('synthesizeMatter');
    expect(p).toMatch(/synthesize/i);
    expect(p).toMatch(/attribute|by name or number/i);
  });
  it('compareDocuments compares differences side by side', () => {
    const p = actionPrompt('compareDocuments');
    expect(p).toMatch(/compare/i);
    expect(p).toMatch(/difference/i);
  });
});

describe('actions: isActionId / actionPrompt guards', () => {
  it('narrows known ids and rejects unknown', () => {
    expect(isActionId('summarizeDocument')).toBe(true);
    expect(isActionId('nope')).toBe(false);
  });
  it('actionPrompt throws on an unknown id', () => {
    expect(() => actionPrompt('nope')).toThrow(/Unknown action/);
  });
});

describe('actions: runAction', () => {
  it('routes the resolved prompt through ask (one code path to the model)', async () => {
    const { client, create } = mockClient('clauses extracted');
    const out = await runAction('extractClauses', ctx, { workspaceName: 'Acme' }, { client });
    expect(out).toBe('clauses extracted');
    const user = String(create.mock.calls[0][0].messages[1].content);
    expect(user).toContain(ACTIONS.extractClauses.prompt);
    expect(user).toContain('Document: NDA');
  });

  it('rejects (not synchronously throws) on an unknown id', async () => {
    await expect(runAction('nope', ctx)).rejects.toThrow(/Unknown action/);
  });
});
