import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  actionList,
  actionTask,
  buildActionMessages,
  buildContext,
  buildMessages,
  isActionId,
  parseResult,
  SYSTEM_PROMPT,
  type ActionContext,
  type ActionId,
} from '../src/actions';

// ---- The action catalog ---------------------------------------------------

describe('action catalog', () => {
  it('exposes the six quick actions', () => {
    expect(Object.keys(ACTIONS).sort()).toEqual(
      ['ask', 'explain', 'fixGrammar', 'rewrite', 'summarize', 'translate'].sort(),
    );
  });

  it('isActionId narrows known ids and rejects unknown', () => {
    expect(isActionId('summarize')).toBe(true);
    expect(isActionId('translate')).toBe(true);
    expect(isActionId('nope')).toBe(false);
    expect(isActionId('')).toBe(false);
    expect(isActionId('constructor')).toBe(false); // not a real action id
  });

  it('actionList derives label + needs flags from the catalog, in order', () => {
    const list = actionList();
    expect(list.map((a) => a.id)).toEqual([
      'summarize',
      'explain',
      'rewrite',
      'translate',
      'fixGrammar',
      'ask',
    ]);
    const ask = list.find((a) => a.id === 'ask')!;
    expect(ask).toEqual({ id: 'ask', label: 'Ask', needsText: false, needsInstruction: true });
    const summarize = list.find((a) => a.id === 'summarize')!;
    expect(summarize.needsText).toBe(true);
    expect(summarize.needsInstruction).toBe(false);
  });

  it('every action but ask requires captured text; only ask requires an instruction', () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      if (id === 'ask') {
        expect(a.needsText).toBe(false);
        expect(a.needsInstruction).toBe(true);
      } else {
        expect(a.needsText).toBe(true);
        expect(a.needsInstruction).toBe(false);
      }
    }
  });
});

// ---- actionTask (prompt builders) -----------------------------------------

describe('actionTask prompt builders', () => {
  it('throws on an unknown id (boundary guard)', () => {
    expect(() => actionTask('bogus')).toThrow(/Unknown action: bogus/);
  });

  it('summarize: default vs focused', () => {
    expect(actionTask('summarize')).toContain('Cover the key points');
    const focused = actionTask('summarize', { instruction: 'the financials' });
    expect(focused).toContain('Focus the summary on: the financials.');
    expect(focused).toContain('Return only the summary.');
  });

  it('explain: default vs audience, and code-aware clause', () => {
    const def = actionTask('explain');
    expect(def).toContain('Assume a smart reader new to this topic.');
    expect(def).toContain('If it is code, explain what it does step by step.');
    expect(actionTask('explain', { instruction: 'a 10 year old' })).toContain(
      'Tailor the explanation to: a 10 year old.',
    );
  });

  it('rewrite: default keeps length; instruction is threaded in; forbids new facts', () => {
    const def = actionTask('rewrite');
    expect(def).toContain('same meaning and roughly the same length');
    expect(def).toContain('Do NOT add any fact not present');
    expect(actionTask('rewrite', { instruction: 'make it formal' })).toContain(
      'Rewrite it as follows: make it formal.',
    );
  });

  it('translate: defaults to English; honors a target language; keeps names verbatim', () => {
    expect(actionTask('translate')).toContain('into English');
    const es = actionTask('translate', { language: 'Spanish' });
    expect(es).toContain('into Spanish');
    expect(es).toContain('proper names verbatim');
    // whitespace-only language falls back to the default
    expect(actionTask('translate', { language: '   ' })).toContain('into English');
  });

  it('fixGrammar: corrects mechanics without changing meaning', () => {
    const t = actionTask('fixGrammar');
    expect(t).toContain('grammar, spelling, and punctuation');
    expect(t).toContain('Do NOT');
    expect(t).toContain('change its meaning');
    expect(t).toContain('Return only the corrected text.');
  });

  it('ask: embeds the question and the fallback-to-general-knowledge rule', () => {
    const t = actionTask('ask', { instruction: 'What is a monad?' });
    expect(t).toContain('"What is a monad?"');
    expect(t).toContain('otherwise');
  });
});

// ---- Context assembly -----------------------------------------------------

describe('buildContext', () => {
  it('renders selection with its source, untruncated', () => {
    const r = buildContext({ text: '  hello world  ', source: 'selection' });
    expect(r).toEqual({ text: 'hello world', source: 'selection', truncated: false });
  });

  it('labels clipboard source', () => {
    expect(buildContext({ text: 'x', source: 'clipboard' }).source).toBe('clipboard');
  });

  it('defaults an unspecified source to selection', () => {
    expect(buildContext({ text: 'x' }).source).toBe('selection');
  });

  it('empty/whitespace text yields source none, no truncation', () => {
    expect(buildContext({})).toEqual({ text: '', source: 'none', truncated: false });
    expect(buildContext({ text: '   \n ' })).toEqual({ text: '', source: 'none', truncated: false });
  });

  it('truncates to the budget and marks truncated', () => {
    const long = 'a'.repeat(100);
    const r = buildContext({ text: long, source: 'selection' }, 40);
    expect(r.text).toHaveLength(40);
    expect(r.truncated).toBe(true);
  });

  it('text exactly at the budget is not truncated', () => {
    const exact = 'a'.repeat(40);
    expect(buildContext({ text: exact }, 40).truncated).toBe(false);
  });
});

// ---- Message shaping ------------------------------------------------------

describe('buildMessages', () => {
  it('system turn is the grounded SYSTEM_PROMPT', () => {
    const [system] = buildMessages('do it', { text: 'x', source: 'selection', truncated: false });
    expect(system).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(SYSTEM_PROMPT).toContain('never invent facts');
    expect(SYSTEM_PROMPT).toContain('Return ONLY');
  });

  it('fences the selection as data with a labeled block, task last', () => {
    const [, user] = buildMessages('Summarize it.', {
      text: 'the body',
      source: 'selection',
      truncated: false,
    });
    expect(user.role).toBe('user');
    expect(user.content).toContain('---- selected text ----\nthe body\n---- end selected text ----');
    expect(user.content).toContain('---- task ----\nSummarize it.');
    expect(user.content).not.toContain('truncated to fit');
    // task comes after the fence
    expect(user.content.indexOf('---- task ----')).toBeGreaterThan(
      user.content.indexOf('---- selected text ----'),
    );
  });

  it('labels a clipboard subject as clipboard', () => {
    const [, user] = buildMessages('Explain it.', {
      text: 'copied text',
      source: 'clipboard',
      truncated: false,
    });
    expect(user.content).toContain('---- clipboard ----\ncopied text\n---- end clipboard ----');
  });

  it('rides the honest truncation note inside the user turn when cut', () => {
    const [, user] = buildMessages('Rewrite it.', {
      text: 'partial',
      source: 'selection',
      truncated: true,
    });
    expect(user.content).toContain('truncated to fit — answer only from what is shown');
    // note precedes the fence
    expect(user.content.indexOf('truncated to fit')).toBeLessThan(
      user.content.indexOf('---- selected text ----'),
    );
  });

  it('omits the fence entirely when there is no context (ask with no selection)', () => {
    const [, user] = buildMessages('Answer: what is 2+2?', { text: '', source: 'none', truncated: false });
    expect(user.content).not.toContain('---- selected text ----');
    expect(user.content).not.toContain('---- clipboard ----');
    expect(user.content).toBe('---- task ----\nAnswer: what is 2+2?');
  });
});

// ---- The full request path ------------------------------------------------

describe('buildActionMessages (id + inputs + context → messages)', () => {
  it('summarize over a selection produces the grounded, fenced request', () => {
    const ctx: ActionContext = { text: 'a long article body', source: 'selection' };
    const msgs = buildActionMessages('summarize', {}, ctx);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('---- selected text ----\na long article body');
    expect(msgs[1].content).toContain('Summarize the text above');
  });

  it('translate threads the language into the task', () => {
    const msgs = buildActionMessages('translate', { language: 'German' }, { text: 'hi', source: 'selection' });
    expect(msgs[1].content).toContain('into German');
  });

  it('applies the budget when truncating', () => {
    const long = 'x'.repeat(100);
    const msgs = buildActionMessages('summarize', {}, { text: long, source: 'selection' }, 20);
    expect(msgs[1].content).toContain('truncated to fit');
    // 20 chars of x fenced
    expect(msgs[1].content).toContain('x'.repeat(20));
    expect(msgs[1].content).not.toContain('x'.repeat(21));
  });

  it('propagates an unknown id error from actionTask', () => {
    expect(() => buildActionMessages('nope' as ActionId, {}, { text: 'x' })).toThrow(/Unknown action/);
  });
});

// ---- Response parsing -----------------------------------------------------

describe('parseResult', () => {
  it('returns clean text unchanged (idempotent)', () => {
    expect(parseResult('Just the answer.')).toBe('Just the answer.');
    expect(parseResult(parseResult('Just the answer.'))).toBe('Just the answer.');
  });

  it('trims surrounding whitespace', () => {
    expect(parseResult('  \n hello \n ')).toBe('hello');
  });

  it('strips a single wrapping code fence, keeping inner content', () => {
    expect(parseResult('```\nconst x = 1;\n```')).toBe('const x = 1;');
    expect(parseResult('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('does NOT strip fences in the middle of a reply', () => {
    const md = 'Here:\n```js\ncode\n```\nand more';
    expect(parseResult(md)).toBe(md);
  });

  it('strips matched wrapping quotes (straight and curly)', () => {
    expect(parseResult('"A headline"')).toBe('A headline');
    expect(parseResult("'A headline'")).toBe('A headline');
    expect(parseResult('“A headline”')).toBe('A headline');
  });

  it('leaves quotes that are part of the content', () => {
    expect(parseResult('He said "hi" to her')).toBe('He said "hi" to her');
    expect(parseResult('"unclosed quote')).toBe('"unclosed quote');
    // wrapping quotes but an internal closing quote → left alone
    expect(parseResult('"a" and "b"')).toBe('"a" and "b"');
  });

  it('strips a fence then wrapping quotes together', () => {
    expect(parseResult('```\n"quoted line"\n```')).toBe('quoted line');
  });
});
