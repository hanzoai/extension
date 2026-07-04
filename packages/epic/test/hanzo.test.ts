import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams } from '@hanzo/ai';
import {
  CLINICAL_SYSTEM_PROMPT,
  ACTIONS,
  isActionId,
  actionTask,
  buildMessages,
  extractContent,
  ask,
  runAction,
  listModels,
} from '../src/hanzo.js';
import { DEFAULT_MODEL } from '../src/config.js';

// A fake @hanzo/ai client that records the create() params and returns a canned
// completion, so we assert request shaping with zero network.
function fakeClient(text = 'AI OUTPUT') {
  const create = vi.fn(
    async (
      _params: ChatCompletionCreateParams,
      _options?: { signal?: AbortSignal },
    ): Promise<ChatCompletion> => ({
      id: 'x',
      object: 'chat.completion',
      created: 0,
      model: 'zen5',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    }),
  );
  const list = vi.fn(async (_options?: { signal?: AbortSignal }) => [
    { id: 'zen5', object: 'model' as const },
    { id: 'zen-eco', object: 'model' as const },
  ]);
  const client = {
    chat: { completions: { create } },
    models: { list },
  } as unknown as AiClient;
  return { client, create, list };
}

describe('system prompt', () => {
  it('grounds in the chart, forbids fabrication, and disclaims diagnosis', () => {
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/SMART on FHIR/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/not a diagnosis/i);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/clinician reviews/i);
  });
});

describe('action catalog', () => {
  it('exposes the four actions with prompt flags', () => {
    expect(ACTIONS.map((a) => a.id)).toEqual(['summarize', 'note', 'extract', 'ask']);
    expect(ACTIONS.find((a) => a.id === 'note')!.needsPrompt).toBe(true);
    expect(ACTIONS.find((a) => a.id === 'ask')!.needsPrompt).toBe(true);
    expect(ACTIONS.find((a) => a.id === 'summarize')!.needsPrompt).toBe(false);
    expect(ACTIONS.find((a) => a.id === 'extract')!.needsPrompt).toBe(false);
  });
  it('isActionId is a strict boundary guard', () => {
    expect(isActionId('summarize')).toBe(true);
    expect(isActionId('delete')).toBe(false);
    expect(isActionId('')).toBe(false);
  });
});

describe('action prompt builders', () => {
  it('summarize covers problems/meds/allergies/labs and forbids invention', () => {
    const t = actionTask('summarize');
    expect(t).toMatch(/active problems/i);
    expect(t).toMatch(/medications/i);
    expect(t).toMatch(/allergies/i);
    expect(t).toMatch(/labs\/vitals/i);
    expect(t).toMatch(/not in the chart/i);
  });

  it('note asks for SOAP and folds in the reason-for-visit', () => {
    const t = actionTask('note', '72yo HTN follow-up');
    expect(t).toMatch(/SOAP/);
    expect(t).toMatch(/Subjective, Objective, Assessment, Plan/);
    expect(t).toContain('72yo HTN follow-up');
    // Without detail it still asks for SOAP but omits the input clause.
    const bare = actionTask('note');
    expect(bare).toMatch(/SOAP/);
    expect(bare).not.toMatch(/clinician input:/);
  });

  it('extract asks for two structured lists (problems + meds)', () => {
    const t = actionTask('extract');
    expect(t).toMatch(/active problems/i);
    expect(t).toMatch(/current medications/i);
    expect(t).toMatch(/structured lists/i);
  });

  it('ask uses the question, or a sensible default', () => {
    expect(actionTask('ask', 'Any drug interactions?')).toBe('Any drug interactions?');
    expect(actionTask('ask')).toMatch(/most important thing/i);
  });
});

describe('message assembly', () => {
  it('fences the chart as data with a system + user turn', () => {
    const msgs = buildMessages('SUMMARIZE', 'CHART TEXT');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: 'system', content: CLINICAL_SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    const content = msgs[1].content as string;
    expect(content).toContain('---- patient chart ----');
    expect(content).toContain('CHART TEXT');
    expect(content).toContain('---- end patient chart ----');
    expect(content).toContain('---- task ----');
    expect(content).toContain('SUMMARIZE');
  });

  it('with no chart, sends just the task', () => {
    const content = buildMessages('ASK', '')[1].content as string;
    expect(content).toBe('ASK');
  });

  it('honors a custom system prompt', () => {
    expect(buildMessages('t', 'c', 'SYS')[0].content).toBe('SYS');
  });
});

describe('extractContent', () => {
  it('pulls the assistant message text', () => {
    expect(
      extractContent({
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      }),
    ).toBe('hi');
  });
  it('throws on empty content', () => {
    expect(() =>
      extractContent({
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      }),
    ).toThrow(/no content/);
  });
});

describe('ask over the SDK client', () => {
  it('sends model + fenced messages, non-streaming, and returns the text', async () => {
    const { client, create } = fakeClient('SUMMARY');
    const out = await ask('SUMMARIZE', 'CHART', { client });
    expect(out).toBe('SUMMARY');
    const params = create.mock.calls[0][0];
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(params.stream).toBe(false);
    expect(params.messages[0].role).toBe('system');
    expect((params.messages[1].content as string)).toContain('CHART');
  });

  it('passes a model override + temperature + abort signal', async () => {
    const { client, create } = fakeClient();
    const signal = new AbortController().signal;
    await ask('t', 'c', { client, model: 'zen-eco', temperature: 0.2, signal });
    expect(create.mock.calls[0][0].model).toBe('zen-eco');
    expect(create.mock.calls[0][0].temperature).toBe(0.2);
    expect(create.mock.calls[0][1]).toEqual({ signal });
  });

  it('omits temperature from the wire when unset', async () => {
    const { client, create } = fakeClient();
    await ask('t', 'c', { client });
    expect('temperature' in create.mock.calls[0][0]).toBe(false);
  });
});

describe('runAction', () => {
  it('forms the action task and asks over the chart', async () => {
    const { client, create } = fakeClient('NOTE');
    const out = await runAction({ id: 'note', detail: 'HTN f/u', chartContext: 'CHART', opts: { client } });
    expect(out).toBe('NOTE');
    const userMsg = create.mock.calls[0][0].messages[1].content as string;
    expect(userMsg).toContain('SOAP');
    expect(userMsg).toContain('HTN f/u');
    expect(userMsg).toContain('CHART');
  });
});

describe('listModels', () => {
  it('returns model ids from the SDK', async () => {
    const { client, list } = fakeClient();
    expect(await listModels({ client })).toEqual(['zen5', 'zen-eco']);
    expect(list).toHaveBeenCalled();
  });
});
