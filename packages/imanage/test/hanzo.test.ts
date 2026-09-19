import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion, ChatCompletionCreateParams, Model } from '@hanzo/ai';
import {
  SYSTEM_PROMPT,
  buildMessages,
  extractContent,
  ask,
  listModels,
  type MatterMeta,
} from '../src/hanzo.js';
import { buildContext, type DocumentContext } from '../src/documents.js';

const ctx: DocumentContext = buildContext([{ title: 'Document', blocks: ['Document: NDA — mutual'] }]);
const meta: MatterMeta = { workspaceName: 'Acme / Falcon', matterNumber: '2026-0042', client: 'Acme Corp' };

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
function mockClient(reply: ChatCompletion, models: Model[] = []) {
  const create = vi.fn(async (_p: ChatCompletionCreateParams, _o?: { signal?: AbortSignal }) => reply);
  const list = vi.fn(async (_o?: { signal?: AbortSignal }) => models);
  const client = { chat: { completions: { create } }, models: { list } } as unknown as AiClient;
  return { client, create, list };
}

describe('hanzo: buildMessages', () => {
  it('produces a grounded system prompt + a fenced user turn with matter meta + context note', () => {
    const msgs = buildMessages('Does this NDA survive termination?', ctx, meta);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    const user = String(msgs[1].content);
    expect(user).toContain('Workspace: Acme / Falcon');
    expect(user).toContain('Matter #: 2026-0042');
    expect(user).toContain('Client: Acme Corp');
    expect(user).toContain('---- document records ----');
    expect(user).toContain('Document: NDA — mutual');
    expect(user).toContain('---- task ----');
    expect(user).toContain('Does this NDA survive termination?');
  });

  it('omits the header block entirely when meta is undefined', () => {
    const user = String(buildMessages('q', ctx)[1].content);
    expect(user).not.toContain('Workspace:');
    expect(user).not.toContain('Matter #:');
    expect(user).toContain('---- task ----');
  });

  it('SYSTEM_PROMPT forbids inventing terms and disclaims legal advice + affirms confidentiality', () => {
    expect(SYSTEM_PROMPT).toMatch(/never invent/i);
    expect(SYSTEM_PROMPT).toMatch(/not legal advice/i);
    expect(SYSTEM_PROMPT).toMatch(/confidential/i);
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
    const { client, create } = mockClient(completion('the NDA survives for 3 years'));
    const out = await ask('Does this NDA survive termination?', ctx, meta, { client, model: 'zen5', temperature: 0.2 });
    expect(out).toBe('the NDA survives for 3 years');
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
