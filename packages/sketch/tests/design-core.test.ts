import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletion } from '@hanzo/ai';
import {
  truncate,
  assembleContext,
  buildMessages,
  actionTask,
  isPerLayer,
  runAction,
  parseLayerEdits,
  resultNote,
  noteHeading,
  extractContent,
  ACTIONS,
  MAX_CONTEXT_CHARS,
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  type Selection,
  type TextLayer,
  type ActionId,
} from '../src/design-core';

// A completion factory matching @hanzo/ai's ChatCompletion shape.
function completion(content: ChatCompletion['choices'][0]['message']['content']): ChatCompletion {
  return {
    id: 'c1',
    object: 'chat.completion',
    created: 0,
    model: 'zen5',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

// A mock AiClient whose completions.create is a spy returning a fixed response.
function mockClient(res: ChatCompletion): { client: AiClient; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(res);
  const client = { chat: { completions: { create } } } as unknown as AiClient;
  return { client, create };
}

const sel = (layers: TextLayer[], totalCount = layers.length): Selection => ({ layers, totalCount });

describe('truncate', () => {
  it('leaves short text intact', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });
  it('cuts to max and marks the elision with the dropped count', () => {
    const out = truncate('abcdefghij', 4);
    expect(out.startsWith('abcd')).toBe(true);
    expect(out).toContain('truncated 6 chars');
  });
});

describe('assembleContext', () => {
  it('numbers layers and quotes their names', () => {
    const out = assembleContext(
      sel([
        { id: 'a', name: 'Title', text: 'Welcome' },
        { id: 'b', name: 'CTA', text: 'Sign up' },
      ]),
    );
    expect(out).toBe('[1] "Title": Welcome\n[2] "CTA": Sign up');
  });
  it('labels unnamed layers', () => {
    expect(assembleContext(sel([{ id: 'a', name: '', text: 'hi' }]))).toBe('[1] (unnamed): hi');
  });
  it('appends a count of non-text layers', () => {
    const out = assembleContext(sel([{ id: 'a', name: 'T', text: 'x' }], 3));
    expect(out).toContain('+ 2 non-text layers selected');
  });
  it('uses the singular for exactly one non-text layer', () => {
    const out = assembleContext(sel([{ id: 'a', name: 'T', text: 'x' }], 2));
    expect(out).toContain('+ 1 non-text layer selected');
  });
  it('caps the whole assembly at maxChars', () => {
    const out = assembleContext(sel([{ id: 'a', name: 'N', text: 'x'.repeat(MAX_CONTEXT_CHARS + 100) }]), 50);
    expect(out.length).toBeLessThan(MAX_CONTEXT_CHARS);
    expect(out).toContain('truncated');
  });
  it('is empty for an empty selection', () => {
    expect(assembleContext(sel([]))).toBe('');
  });
});

describe('buildMessages', () => {
  it('fences the selection as data under the system frame', () => {
    const msgs = buildMessages('Critique.', 'SELECTION TEXT');
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    const content = msgs[1].content as string;
    expect(content).toContain('---- design selection ----');
    expect(content).toContain('SELECTION TEXT');
    expect(content.startsWith('Critique.')).toBe(true);
  });
  it('sends only the task when context is empty', () => {
    expect(buildMessages('Just ask', '   ')[1].content).toBe('Just ask');
  });
});

describe('actionTask', () => {
  it('critique is a fixed instruction', () => {
    expect(actionTask('critique')).toMatch(/critique this design selection/i);
    expect(actionTask('critique')).toMatch(/hierarchy/i);
  });
  it('rewrite uses the detail, or a sensible default, and asks for a JSON array', () => {
    expect(actionTask('rewrite', 'make it punchier')).toContain('make it punchier');
    expect(actionTask('rewrite')).toMatch(/clearer, tighter/i);
    expect(actionTask('rewrite')).toMatch(/JSON array of strings/);
  });
  it('translate targets the language (default Spanish) and asks for a JSON array', () => {
    expect(actionTask('translate', 'Japanese')).toContain('Japanese');
    expect(actionTask('translate')).toContain('Spanish');
    expect(actionTask('translate')).toMatch(/JSON array of strings/);
  });
  it('contentfill is fixed and asks for a JSON array', () => {
    expect(actionTask('contentfill')).toMatch(/placeholder copy/i);
    expect(actionTask('contentfill')).toMatch(/JSON array of strings/);
  });
  it('ask returns the question, or a default', () => {
    expect(actionTask('ask', 'What is the CTA?')).toBe('What is the CTA?');
    expect(actionTask('ask')).toMatch(/what would you improve/i);
  });
  it('per-layer tasks all share the identical positional-alignment rule', () => {
    const rule = 'in the same order';
    for (const id of ['rewrite', 'translate', 'contentfill'] as ActionId[]) {
      expect(actionTask(id)).toContain(rule);
    }
  });
});

describe('isPerLayer / ACTIONS', () => {
  it('rewrite, translate, contentfill are per-layer; critique, ask are not', () => {
    expect(isPerLayer('rewrite')).toBe(true);
    expect(isPerLayer('translate')).toBe(true);
    expect(isPerLayer('contentfill')).toBe(true);
    expect(isPerLayer('critique')).toBe(false);
    expect(isPerLayer('ask')).toBe(false);
  });
  it('ACTIONS is the full catalog in menu order', () => {
    expect(ACTIONS).toEqual(['critique', 'rewrite', 'translate', 'contentfill', 'ask']);
  });
});

describe('extractContent', () => {
  it('reads a plain string content', () => {
    expect(extractContent(completion('the answer'))).toBe('the answer');
  });
  it('joins text parts from an array content, ignoring images', () => {
    const res = completion([
      { type: 'text', text: 'a ' },
      { type: 'image_url', image_url: { url: 'x' } },
      { type: 'text', text: 'b' },
    ]);
    expect(extractContent(res)).toBe('a b');
  });
  it('throws when content is empty', () => {
    expect(() => extractContent(completion(''))).toThrow(/no content/i);
  });
  it('throws when content is whitespace', () => {
    expect(() => extractContent(completion('   '))).toThrow(/no content/i);
  });
});

describe('runAction (through a mocked AiClient)', () => {
  const one = sel([{ id: 'a', name: 'Title', text: 'Welcome' }]);

  it('assembles context, forms the task, and returns the model text', async () => {
    const { client, create } = mockClient(completion('CRITIQUE'));
    const out = await runAction({ id: 'critique', selection: one, hanzoToken: 'sk-x', client });
    expect(out).toBe('CRITIQUE');
    expect(create).toHaveBeenCalledOnce();
    const [params, opts] = create.mock.calls[0];
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(params.stream).toBe(false);
    expect(params.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(params.messages[1].content).toContain('Welcome');
    expect(opts).toBeUndefined();
  });

  it('honors an explicit model and passes the detail into the task', async () => {
    const { client, create } = mockClient(completion('["Bienvenido"]'));
    await runAction({ id: 'translate', detail: 'Spanish', selection: one, hanzoToken: 'sk-x', model: 'zen5-pro', client });
    const [params] = create.mock.calls[0];
    expect(params.model).toBe('zen5-pro');
    expect(params.messages[1].content).toContain('Spanish');
  });

  it('forwards the abort signal', async () => {
    const { client, create } = mockClient(completion('ok'));
    const controller = new AbortController();
    await runAction({ id: 'ask', selection: one, hanzoToken: 'sk-x', client, signal: controller.signal });
    const [, opts] = create.mock.calls[0];
    expect(opts).toEqual({ signal: controller.signal });
  });

  it('propagates a gateway error', async () => {
    const create = vi.fn().mockRejectedValue(new Error('HTTP 401: bad key'));
    const client = { chat: { completions: { create } } } as unknown as AiClient;
    await expect(runAction({ id: 'ask', selection: one, hanzoToken: 'bad', client })).rejects.toThrow(/401/);
  });
});

describe('parseLayerEdits', () => {
  const layers: TextLayer[] = [
    { id: 'a', name: 'Title', text: 'Welcome' },
    { id: 'b', name: 'CTA', text: 'Sign up' },
  ];

  it('pairs each result positionally with the input layer id/name', () => {
    const edits = parseLayerEdits('["Hola", "Regístrate"]', layers);
    expect(edits).toEqual([
      { id: 'a', name: 'Title', text: 'Hola' },
      { id: 'b', name: 'CTA', text: 'Regístrate' },
    ]);
  });
  it('tolerates a ```json fence and surrounding prose', () => {
    const raw = 'Sure!\n```json\n["A", "B"]\n```\nDone.';
    expect(parseLayerEdits(raw, layers).map((e) => e.text)).toEqual(['A', 'B']);
  });
  it('drops extra results beyond the layer count', () => {
    expect(parseLayerEdits('["A", "B", "C"]', layers)).toHaveLength(2);
  });
  it('leaves trailing layers untouched when the model returns too few', () => {
    const edits = parseLayerEdits('["Only one"]', layers);
    expect(edits).toEqual([{ id: 'a', name: 'Title', text: 'Only one' }]);
  });
  it('coerces non-string elements to strings', () => {
    const edits = parseLayerEdits('[42, null]', layers);
    expect(edits.map((e) => e.text)).toEqual(['42', '']);
  });
  it('throws when no array is present', () => {
    expect(() => parseLayerEdits('sorry, I cannot', layers)).toThrow(/no layer-edit array/i);
  });
  it('throws on malformed JSON inside the brackets', () => {
    expect(() => parseLayerEdits('["a", "b"', layers)).toThrow(/no layer-edit array/i);
  });
  it('throws when the JSON is not an array', () => {
    expect(() => parseLayerEdits('{"a":1}', [])).toThrow(/no layer-edit array/i);
  });
});

describe('resultNote / noteHeading', () => {
  it('labels every action distinctly', () => {
    const headings = ACTIONS.map(noteHeading);
    expect(new Set(headings).size).toBe(ACTIONS.length);
    expect(noteHeading('critique')).toBe('Hanzo AI — Critique');
    expect(noteHeading('ask')).toBe('Hanzo AI — Answer');
  });
  it('builds a trimmed heading+body note', () => {
    expect(resultNote('critique', '  the take  ')).toEqual({
      heading: 'Hanzo AI — Critique',
      body: 'the take',
    });
  });
});
