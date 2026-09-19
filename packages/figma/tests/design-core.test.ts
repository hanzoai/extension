import { describe, it, expect, vi } from 'vitest';
import type { AiClient, ChatCompletionCreateParams, Model } from '@hanzo/ai';
import {
  ACTIONS,
  getAction,
  isActionId,
  buildMessages,
  buildSelectionContext,
  contextNote,
  parseEditMap,
  parseVariants,
  parseResult,
  textIds,
  allIds,
  stream,
  complete,
  messageText,
  validateKey,
  listModels,
  type RunInput,
} from '../src/design-core';
import { CONTEXT_CHAR_BUDGET } from '../src/config';
import type { SelectionSnapshot } from '../src/messaging';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

function snapshot(over: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    rootCount: 1,
    texts: [
      { id: '1:1', name: 'Heading', characters: 'Welcome back', depth: 1, color: '#111111' },
      { id: '1:2', name: 'Body', characters: 'Lorem ipsum dolor sit amet.', depth: 1, color: '#eeeeee' },
    ],
    nodes: [{ id: '1:0', type: 'FRAME', name: 'Card', depth: 0, color: '#ffffff' }],
    truncated: false,
    editorType: 'figma',
    ...over,
  };
}

const EMPTY: SelectionSnapshot = {
  rootCount: 0,
  texts: [],
  nodes: [],
  truncated: false,
  editorType: 'figma',
};

// ---------------------------------------------------------------------------
// Action catalog.
// ---------------------------------------------------------------------------

describe('action catalog', () => {
  it('exposes the six design actions with labels, hints, and prompt builders', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(
      ['critique', 'fill', 'rename', 'rewrite', 'translate', 'variants'].sort(),
    );
    for (const a of Object.values(ACTIONS)) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.hint.length).toBeGreaterThan(0);
      expect(typeof a.system).toBe('function');
      expect(typeof a.user).toBe('function');
    }
  });

  it('marks which actions require text nodes', () => {
    expect(ACTIONS.rewrite.needsText).toBe(true);
    expect(ACTIONS.translate.needsText).toBe(true);
    expect(ACTIONS.fill.needsText).toBe(true);
    expect(ACTIONS.rename.needsText).toBe(false);
    expect(ACTIONS.critique.needsText).toBe(false);
    expect(ACTIONS.variants.needsText).toBe(false);
  });

  it('maps each action to the right apply mode', () => {
    expect(ACTIONS.rewrite.apply).toBe('rewrite');
    expect(ACTIONS.translate.apply).toBe('rewrite');
    expect(ACTIONS.fill.apply).toBe('rewrite');
    expect(ACTIONS.rename.apply).toBe('rename');
    expect(ACTIONS.critique.apply).toBe('readonly');
    expect(ACTIONS.variants.apply).toBe('insert');
  });

  it('isActionId guards the boundary, prototype keys excluded', () => {
    expect(isActionId('rewrite')).toBe(true);
    expect(isActionId('nope')).toBe(false);
    expect(isActionId('toString')).toBe(false);
  });

  it('getAction resolves known ids and throws on unknown', () => {
    expect(getAction('critique')).toBe(ACTIONS.critique);
    expect(() => getAction('bogus')).toThrow(/Unknown design action/);
  });
});

// ---------------------------------------------------------------------------
// Prompt builders per action.
// ---------------------------------------------------------------------------

describe('prompt builders', () => {
  it('write-back actions demand a strict JSON id→value map (parser contract)', () => {
    const s = snapshot();
    for (const id of ['rewrite', 'translate', 'fill'] as const) {
      const sys = getAction(id).system(s);
      expect(sys.toLowerCase()).toContain('json object');
      expect(sys).toContain('id');
      expect(sys.toLowerCase()).toContain('new text');
    }
    const rename = getAction('rename').system(s);
    expect(rename.toLowerCase()).toContain('new name');
  });

  it('translate carries the target language from the note into the task', () => {
    const user = getAction('translate').user(snapshot(), 'Japanese');
    expect(user).toContain('Target language: Japanese');
  });

  it('translate prompts to preserve placeholders', () => {
    const sys = getAction('translate').system(snapshot());
    expect(sys.toLowerCase()).toContain('placeholder');
  });

  it('critique asks for an accessibility section referencing the given hex colors', () => {
    const sys = getAction('critique').system(snapshot());
    expect(sys.toLowerCase()).toContain('accessibility');
    expect(sys.toLowerCase()).toContain('contrast');
    expect(sys).toContain('WCAG');
    const user = getAction('critique').user(snapshot(), '');
    expect(user).toContain('#111111');
    expect(user).toContain('#eeeeee');
  });

  it('variants defaults to 3 options and echoes an explicit request', () => {
    expect(getAction('variants').user(snapshot(), '')).toContain('3 options');
    expect(getAction('variants').user(snapshot(), '5 dark-mode CTAs')).toContain('5 dark-mode CTAs');
    expect(getAction('variants').system(snapshot()).toLowerCase()).toContain('own line');
  });
});

// ---------------------------------------------------------------------------
// buildMessages (request shaping).
// ---------------------------------------------------------------------------

describe('buildMessages', () => {
  it('is a system + single user message', () => {
    const msgs = buildMessages('rewrite', snapshot(), '');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe(getAction('rewrite').system(snapshot()));
    expect(msgs[1].role).toBe('user');
  });

  it('fences the selection with node ids and appends the task', () => {
    const user = buildMessages('rewrite', snapshot(), '')[1].content as string;
    expect(user).toContain('---- selection ----');
    expect(user).toContain('id=1:1');
    expect(user).toContain('Welcome back');
    expect(user).toContain('---- task ----');
  });

  it('leads with the honest context note', () => {
    const user = buildMessages('rewrite', snapshot(), '')[1].content as string;
    expect(user.startsWith('Context:')).toBe(true);
  });

  it('throws on an unknown action id', () => {
    expect(() => buildMessages('bogus', snapshot(), '')).toThrow(/Unknown design action/);
  });
});

// ---------------------------------------------------------------------------
// contextNote.
// ---------------------------------------------------------------------------

describe('contextNote', () => {
  it('prompts to select when nothing is selected', () => {
    expect(contextNote(EMPTY)).toMatch(/select/i);
  });

  it('describes counts for the full selection', () => {
    const note = contextNote(snapshot());
    expect(note).toContain('1 selected root');
    expect(note).toContain('2 text layers');
    expect(note).toContain('1 other node');
    expect(note).toContain('full selection');
  });

  it('flags truncation honestly', () => {
    expect(contextNote(snapshot({ truncated: true }))).toMatch(/truncated/);
  });

  it('singularizes correctly', () => {
    const one = contextNote(snapshot({ rootCount: 1, texts: [snapshot().texts[0]], nodes: [] }));
    expect(one).toContain('1 selected root');
    expect(one).toContain('1 text layer');
    expect(one).not.toContain('text layers');
  });
});

// ---------------------------------------------------------------------------
// buildSelectionContext (assembly + budget truncation).
// ---------------------------------------------------------------------------

describe('buildSelectionContext', () => {
  it('serializes text nodes first, then structural nodes, with ids and colors', () => {
    const { block, truncated } = buildSelectionContext(snapshot());
    expect(truncated).toBe(false);
    expect(block).toContain('[text id=1:1 name="Heading" color=#111111]');
    expect(block).toContain('[FRAME id=1:0 name="Card" color=#ffffff]');
    // Text lines come before structural lines.
    expect(block.indexOf('id=1:1')).toBeLessThan(block.indexOf('FRAME'));
  });

  it('handles an empty selection with a placeholder line', () => {
    const { block } = buildSelectionContext(EMPTY);
    expect(block).toContain('no visible layers');
  });

  it('truncates to the character budget and reports it', () => {
    const many = Array.from({ length: 500 }, (_v, i) => ({
      id: `t:${i}`,
      name: `Layer ${i}`,
      characters: 'x'.repeat(200),
      depth: 1,
    }));
    const { block, truncated } = buildSelectionContext(snapshot({ texts: many, nodes: [] }), 2_000);
    expect(truncated).toBe(true);
    expect(block.length).toBeLessThanOrEqual(2_000);
    // At least the first line survives.
    expect(block).toContain('id=t:0');
    expect(block).not.toContain('id=t:499');
  });

  it('always keeps the first line even when it alone exceeds the budget (hard cut)', () => {
    const huge = { id: 't:big', name: 'Big', characters: 'y'.repeat(5_000), depth: 0 };
    const { block, truncated } = buildSelectionContext(snapshot({ texts: [huge], nodes: [] }), 1_000);
    expect(block.length).toBeLessThanOrEqual(1_000);
    expect(block).toContain('t:big');
    expect(truncated).toBe(true);
  });

  it('propagates a snapshot that was already truncated by the node walk', () => {
    const { truncated } = buildSelectionContext(snapshot({ truncated: true }));
    expect(truncated).toBe(true);
  });

  it('defaults to CONTEXT_CHAR_BUDGET', () => {
    // Sanity: the exported default is a positive number the assembly uses.
    expect(CONTEXT_CHAR_BUDGET).toBeGreaterThan(0);
    const { truncated } = buildSelectionContext(snapshot());
    expect(truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseEditMap.
// ---------------------------------------------------------------------------

describe('parseEditMap', () => {
  const ids = new Set(['1:1', '1:2']);

  it('parses a JSON id→text map into TextEdits, keyed as characters', () => {
    const edits = parseEditMap('{"1:1":"Hello again","1:2":"Real body copy."}', 'characters', ids);
    expect(edits).toEqual([
      { id: '1:1', characters: 'Hello again' },
      { id: '1:2', characters: 'Real body copy.' },
    ]);
  });

  it('parses into name for the rename field', () => {
    const edits = parseEditMap('{"1:1":"Heading / Welcome"}', 'name', ids);
    expect(edits).toEqual([{ id: '1:1', name: 'Heading / Welcome' }]);
  });

  it('drops ids not in the valid set (model cannot invent nodes to mutate)', () => {
    const edits = parseEditMap('{"1:1":"ok","9:9":"forged"}', 'characters', ids);
    expect(edits).toEqual([{ id: '1:1', characters: 'ok' }]);
  });

  it('drops non-string values', () => {
    const edits = parseEditMap('{"1:1":42,"1:2":"ok"}', 'characters', ids);
    expect(edits).toEqual([{ id: '1:2', characters: 'ok' }]);
  });

  it('tolerates a ```json fence the model added despite instructions', () => {
    const edits = parseEditMap('```json\n{"1:1":"fenced"}\n```', 'characters', ids);
    expect(edits).toEqual([{ id: '1:1', characters: 'fenced' }]);
  });

  it('throws when the payload is not a JSON object', () => {
    expect(() => parseEditMap('not json', 'characters', ids)).toThrow(/JSON edit map/);
    expect(() => parseEditMap('[1,2,3]', 'characters', ids)).toThrow(/JSON edit map/);
    expect(() => parseEditMap('"a string"', 'characters', ids)).toThrow(/JSON edit map/);
  });

  it('returns [] for an empty object', () => {
    expect(parseEditMap('{}', 'characters', ids)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseVariants.
// ---------------------------------------------------------------------------

describe('parseVariants', () => {
  it('splits a numbered list, stripping the numbering', () => {
    expect(parseVariants('1. First\n2. Second\n3. Third')).toEqual(['First', 'Second', 'Third']);
  });

  it('accepts ) numbering and bullet markers', () => {
    expect(parseVariants('1) One\n- Two\n* Three\n• Four')).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('drops blank lines', () => {
    expect(parseVariants('1. A\n\n\n2. B')).toEqual(['A', 'B']);
  });

  it('keeps unprefixed lines verbatim', () => {
    expect(parseVariants('Just one line')).toEqual(['Just one line']);
  });

  it('is empty for empty input', () => {
    expect(parseVariants('')).toEqual([]);
    expect(parseVariants('\n \n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// id sets + parseResult dispatch.
// ---------------------------------------------------------------------------

describe('id sets', () => {
  it('textIds is only the text nodes', () => {
    expect([...textIds(snapshot())].sort()).toEqual(['1:1', '1:2']);
  });
  it('allIds is text nodes plus structural nodes', () => {
    expect([...allIds(snapshot())].sort()).toEqual(['1:0', '1:1', '1:2']);
  });
});

describe('parseResult (ApplyMode dispatch)', () => {
  it('rewrite → edits keyed to text ids only', () => {
    const r = parseResult('rewrite', snapshot(), '{"1:1":"new","1:0":"nope"}');
    expect(r.edits).toEqual([{ id: '1:1', characters: 'new' }]);
    expect(r.variants).toBeUndefined();
  });

  it('rename → edits that may target structural nodes too', () => {
    const r = parseResult('rename', snapshot(), '{"1:0":"Product card"}');
    expect(r.edits).toEqual([{ id: '1:0', name: 'Product card' }]);
  });

  it('variants → a parsed list, no edits', () => {
    const r = parseResult('variants', snapshot(), '1. A\n2. B');
    expect(r.variants).toEqual(['A', 'B']);
    expect(r.edits).toBeUndefined();
  });

  it('critique (readonly) → neither edits nor variants (the prose is the result)', () => {
    const r = parseResult('critique', snapshot(), 'The hierarchy is unclear...');
    expect(r.edits).toBeUndefined();
    expect(r.variants).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// @hanzo/ai request shaping over a mocked client.
// ---------------------------------------------------------------------------

/** A fake AiClient matching the @hanzo/ai surface design-core uses: it captures
 *  the params and returns a scripted stream / completion / model list. */
function fakeClient(opts: {
  chunks?: string[];
  content?: string;
  models?: string[];
  capture?: (p: ChatCompletionCreateParams) => void;
  modelsThrows?: boolean;
}): AiClient {
  const create = vi.fn(async (params: ChatCompletionCreateParams) => {
    opts.capture?.(params);
    if (params.stream) {
      async function* gen() {
        for (const c of opts.chunks ?? []) {
          yield {
            id: 'x',
            object: 'chat.completion.chunk' as const,
            created: 0,
            model: params.model,
            choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
          };
        }
      }
      return gen();
    }
    return {
      id: 'x',
      object: 'chat.completion' as const,
      created: 0,
      model: params.model,
      choices: [
        { index: 0, message: { role: 'assistant' as const, content: opts.content ?? '' }, finish_reason: 'stop' },
      ],
    };
  });
  const list = vi.fn(async (): Promise<Model[]> => {
    if (opts.modelsThrows) throw new Error('bad key');
    return (opts.models ?? []).map((id) => ({ id, object: 'model' as const }));
  });
  return { chat: { completions: { create } }, models: { list } } as unknown as AiClient;
}

function runInput(over: Partial<RunInput> = {}): RunInput {
  return { actionId: 'rewrite', snapshot: snapshot(), note: '', token: 'sk-test', ...over };
}

describe('stream', () => {
  it('concatenates deltas and streams each chunk', async () => {
    const seen: string[] = [];
    const client = fakeClient({ chunks: ['{"1:1":', '"Hi"}'] });
    const full = await stream(runInput({ client }), (d) => seen.push(d));
    expect(full).toBe('{"1:1":"Hi"}');
    expect(seen).toEqual(['{"1:1":', '"Hi"}']);
  });

  it('sends the chosen model, stream=true, and the shaped messages', async () => {
    let captured: ChatCompletionCreateParams | undefined;
    const client = fakeClient({ chunks: ['ok'], capture: (p) => (captured = p) });
    await stream(runInput({ client, model: 'zen-custom' }), () => {});
    expect(captured?.model).toBe('zen-custom');
    expect(captured?.stream).toBe(true);
    expect(captured?.messages[0].role).toBe('system');
    expect(captured?.messages[1].content).toContain('Welcome back');
  });

  it('defaults the model to zen5 when none is given', async () => {
    let captured: ChatCompletionCreateParams | undefined;
    const client = fakeClient({ chunks: ['ok'], capture: (p) => (captured = p) });
    await stream(runInput({ client, model: undefined }), () => {});
    expect(captured?.model).toBe('zen5');
  });

  it('ignores empty deltas', async () => {
    const seen: string[] = [];
    const client = fakeClient({ chunks: ['a', '', 'b'] });
    const full = await stream(runInput({ client }), (d) => seen.push(d));
    expect(full).toBe('ab');
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('complete', () => {
  it('returns the assistant message content', async () => {
    const client = fakeClient({ content: '{"1:1":"done"}' });
    const out = await complete(runInput({ client }));
    expect(out).toBe('{"1:1":"done"}');
  });
});

describe('messageText', () => {
  it('returns a string as-is', () => {
    expect(messageText('hello')).toBe('hello');
  });
  it('concatenates the text parts of array content', () => {
    expect(
      messageText([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: 'x' } },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
  });
  it('is empty for undefined', () => {
    expect(messageText(undefined)).toBe('');
  });
});

describe('validateKey / listModels', () => {
  it('validateKey returns the model ids on success', async () => {
    const client = fakeClient({ models: ['zen5', 'zen-coder'] });
    expect(await validateKey('sk-x', client)).toEqual(['zen5', 'zen-coder']);
  });

  it('validateKey rejects an empty key before any call', async () => {
    await expect(validateKey('   ')).rejects.toThrow(/Hanzo API key/);
  });

  it('listModels returns [] on failure instead of throwing', async () => {
    const client = fakeClient({ modelsThrows: true });
    expect(await listModels('sk-x', client)).toEqual([]);
  });

  it('listModels returns the ids on success', async () => {
    const client = fakeClient({ models: ['zen5'] });
    expect(await listModels('sk-x', client)).toEqual(['zen5']);
  });
});
