import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams, Model } from '@hanzo/ai';
import {
  SYSTEM_PROMPT,
  buildMessages,
  extractContent,
  ask,
  listModels,
  type ProjectMeta,
} from '../src/hanzo.js';
import { buildProjectContext, type ProjectContext } from '../src/project.js';

const ctx: ProjectContext = buildProjectContext([{ title: 'RFIs', blocks: ['RFI 042: base plate conflict'] }]);
const meta: ProjectMeta = { name: 'Tower A', projectNumber: 'P-100', companyName: 'BuildCo' };

// completion builds a minimal @hanzo/ai ChatCompletion with the given content.
function completion(content: ChatCompletion['choices'][number]['message']['content']): ChatCompletion {
  return {
    id: 'c1',
    object: 'chat.completion',
    created: 0,
    model: 'zen5',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

// mockClient captures the params the code sends and returns a canned completion.
// The create mock takes both the params and the options arg the source passes.
function mockClient(reply: ChatCompletion, models: Model[] = []) {
  const create = vi.fn(async (_p: ChatCompletionCreateParams, _o?: { signal?: AbortSignal }) => reply);
  const list = vi.fn(async (_o?: { signal?: AbortSignal }) => models);
  const client = { chat: { completions: { create } }, models: { list } } as unknown as AiClient;
  return { client, create, list };
}

describe('hanzo: buildMessages', () => {
  it('produces a grounded system prompt + a fenced user turn with meta + context note', () => {
    const msgs = buildMessages('What is overdue?', ctx, meta);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    const user = String(msgs[1].content);
    expect(user).toContain('Project: Tower A');
    expect(user).toContain('Project #: P-100');
    expect(user).toContain('Company: BuildCo');
    expect(user).toContain('---- project records ----');
    expect(user).toContain('RFI 042: base plate conflict');
    expect(user).toContain('---- task ----');
    expect(user).toContain('What is overdue?');
  });

  it('omits the header block entirely when meta is undefined', () => {
    const user = String(buildMessages('q', ctx).at(1)!.content);
    expect(user).not.toContain('Project:');
    expect(user).toContain('---- task ----');
  });

  it('SYSTEM_PROMPT forbids inventing records and disclaims directives', () => {
    expect(SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(SYSTEM_PROMPT).toMatch(/not.*directives/i);
  });
});

describe('hanzo: extractContent', () => {
  it('reads a plain string content', () => {
    expect(extractContent(completion('hello'))).toBe('hello');
  });
  it('concatenates text parts of an array content', () => {
    const parts = [
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'x' } },
      { type: 'text', text: 'b' },
    ] as any;
    expect(extractContent(completion(parts))).toBe('ab');
  });
  it('throws on empty content', () => {
    expect(() => extractContent(completion(''))).toThrow(/no content/);
    expect(() => extractContent(completion(undefined))).toThrow(/no content/);
  });
});

describe('hanzo: ask', () => {
  it('sends model + messages non-streaming through the injected client and returns the text', async () => {
    const { client, create } = mockClient(completion('overdue: RFI 042'));
    const out = await ask('What is overdue?', ctx, meta, { client, model: 'zen5', temperature: 0.2 });
    expect(out).toBe('overdue: RFI 042');
    expect(create).toHaveBeenCalledOnce();
    const [params, options] = create.mock.calls[0];
    expect(params.model).toBe('zen5');
    expect(params.stream).toBe(false);
    expect(params.temperature).toBe(0.2);
    expect(params.messages[0].role).toBe('system');
    expect(options).toBeDefined();
  });

  it('omits temperature from the wire when not provided', async () => {
    const { client, create } = mockClient(completion('ok'));
    await ask('q', ctx, undefined, { client });
    expect('temperature' in create.mock.calls[0][0]).toBe(false);
  });

  it('defaults the model to zen5', async () => {
    const { client, create } = mockClient(completion('ok'));
    await ask('q', ctx, undefined, { client });
    expect(create.mock.calls[0][0].model).toBe('zen5');
  });

  it('propagates an abort signal to the client', async () => {
    const { client, create } = mockClient(completion('ok'));
    const controller = new AbortController();
    await ask('q', ctx, undefined, { client, signal: controller.signal });
    expect(create.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe('hanzo: listModels', () => {
  it('maps the model catalog to ids', async () => {
    const models: Model[] = [
      { id: 'zen5', object: 'model' },
      { id: 'zen5-pro', object: 'model' },
    ];
    const { client } = mockClient(completion('x'), models);
    expect(await listModels({ client })).toEqual(['zen5', 'zen5-pro']);
  });
});
