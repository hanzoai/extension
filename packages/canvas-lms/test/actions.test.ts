import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams } from '@hanzo/ai';
import { ACTIONS, actionList, actionPrompt, isActionId, runAction } from '../src/actions.js';
import { buildCourseContext } from '../src/course.js';

const ctx = buildCourseContext([{ title: 'Assignments', blocks: ['Assignment: Lab Report 1'] }]);

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
      ['draftAnnouncement', 'draftFeedback', 'generateQuestions', 'summarizeCourse', 'summarizeSubmissions'].sort(),
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
    expect(list[0]).toEqual({ id: 'summarizeCourse', label: ACTIONS.summarizeCourse.label });
  });
});

describe('actions: prompt intent', () => {
  it('summarizeCourse grounds on the syllabus and modules', () => {
    const p = actionPrompt('summarizeCourse');
    expect(p).toMatch(/syllabus/i);
    expect(p).toMatch(/module/i);
  });
  it('draftFeedback stays grounded and returns paste-ready comment text', () => {
    const p = actionPrompt('draftFeedback');
    expect(p).toMatch(/do not invent/i);
    expect(p).toMatch(/submission comment/i);
  });
  it('generateQuestions asks for quiz questions and discussion prompts', () => {
    const p = actionPrompt('generateQuestions');
    expect(p).toMatch(/quiz questions/i);
    expect(p).toMatch(/discussion prompts/i);
  });
  it('summarizeSubmissions asks for submitted/missing/late and scores', () => {
    const p = actionPrompt('summarizeSubmissions');
    expect(p).toMatch(/missing or late/i);
    expect(p).toMatch(/scores or grades/i);
  });
  it('draftAnnouncement asks for a subject line and stays grounded on dates', () => {
    const p = actionPrompt('draftAnnouncement');
    expect(p).toMatch(/subject line/i);
    expect(p).toMatch(/do not invent dates/i);
  });
});

describe('actions: isActionId / actionPrompt guards', () => {
  it('narrows known ids and rejects unknown', () => {
    expect(isActionId('summarizeCourse')).toBe(true);
    expect(isActionId('nope')).toBe(false);
  });
  it('actionPrompt throws on an unknown id', () => {
    expect(() => actionPrompt('nope')).toThrow(/Unknown action/);
  });
});

describe('actions: runAction', () => {
  it('routes the resolved prompt through ask (one code path to the model)', async () => {
    const { client, create } = mockClient('overview');
    const out = await runAction('summarizeCourse', ctx, { name: 'BIO-101' }, { client });
    expect(out).toBe('overview');
    const user = String(create.mock.calls[0][0].messages[1].content);
    expect(user).toContain(ACTIONS.summarizeCourse.prompt);
    expect(user).toContain('Assignment: Lab Report 1');
  });

  it('rejects (not synchronously throws) on an unknown id', async () => {
    await expect(runAction('nope', ctx)).rejects.toThrow(/Unknown action/);
  });
});
