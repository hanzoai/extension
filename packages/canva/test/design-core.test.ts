import { describe, it, expect } from 'vitest';
import {
  SYSTEM_PROMPT,
  collapseWhitespace,
  buildDesignContext,
  buildMessages,
  buildActionMessages,
  DESIGN_ACTIONS,
  designActionList,
  isDesignActionId,
  actionTask,
  parseCopy,
  parseIdeas,
  type ChatMessage,
  type DesignContext,
} from '../src/design-core';

describe('collapseWhitespace', () => {
  it('collapses runs of whitespace and newlines and trims', () => {
    expect(collapseWhitespace('  a\n\n  b\t c  ')).toBe('a b c');
  });
  it('is idempotent on clean text', () => {
    expect(collapseWhitespace('already clean')).toBe('already clean');
  });
});

describe('buildDesignContext', () => {
  it('renders title, selection, then page text as labeled data', () => {
    const ctx: DesignContext = {
      title: 'Spring Launch',
      selection: 'Big  savings\nthis week',
      pageText: ['Shop now', '  Limited  time '],
    };
    const r = buildDesignContext(ctx);
    expect(r.truncated).toBe(false);
    expect(r.text).toContain('Design title: Spring Launch');
    expect(r.text).toContain('Selected text: Big savings this week');
    expect(r.text).toContain('Other text on this page: Shop now | Limited time');
    // Selection comes before page text (it is what the model most needs).
    expect(r.text.indexOf('Selected text')).toBeLessThan(r.text.indexOf('Other text on this page'));
  });

  it('omits absent fields and yields empty text for an empty design', () => {
    expect(buildDesignContext({})).toEqual({ text: '', truncated: false });
    const onlySel = buildDesignContext({ selection: 'x' });
    expect(onlySel.text).toBe('Selected text: x');
  });

  it('drops blank page-text entries', () => {
    const r = buildDesignContext({ pageText: ['', '   ', 'kept'] });
    expect(r.text).toBe('Other text on this page: kept');
  });

  it('truncates to the budget and flags it', () => {
    const r = buildDesignContext({ selection: 'x'.repeat(100) }, 40);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(40);
  });
});

describe('buildMessages', () => {
  it('system grounds, design is fenced as data, task last', () => {
    const msgs = buildMessages('Do the thing.', { text: 'Selected text: hi', truncated: false });
    expect(msgs[0]).toEqual<ChatMessage>({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('---- design ----');
    expect(msgs[1].content).toContain('Selected text: hi');
    expect(msgs[1].content).toContain('---- end design ----');
    expect(msgs[1].content).toContain('---- task ----\nDo the thing.');
  });

  it('omits the fence when there is no context', () => {
    const msgs = buildMessages('Generate.', { text: '', truncated: false });
    expect(msgs[1].content).not.toContain('---- design ----');
    expect(msgs[1].content).toBe('---- task ----\nGenerate.');
  });

  it('prepends an honest truncation note when the context was cut', () => {
    const msgs = buildMessages('Rewrite.', { text: 'partial', truncated: true });
    expect(msgs[1].content).toContain('truncated to fit');
    expect(msgs[1].content.indexOf('truncated to fit')).toBeLessThan(msgs[1].content.indexOf('---- design ----'));
  });
});

describe('action catalog', () => {
  it('exposes the five design actions in order', () => {
    expect(Object.keys(DESIGN_ACTIONS)).toEqual(['generate', 'rewrite', 'translate', 'ideas', 'ask']);
  });

  it('lists are derived from the catalog (labels/flags never drift)', () => {
    const list = designActionList();
    expect(list.map((a) => a.id)).toEqual(Object.keys(DESIGN_ACTIONS));
    expect(list.find((a) => a.id === 'rewrite')?.needsSelection).toBe(true);
    expect(list.find((a) => a.id === 'translate')?.needsSelection).toBe(true);
    expect(list.find((a) => a.id === 'generate')?.needsSelection).toBe(false);
    expect(list.find((a) => a.id === 'generate')?.needsInstruction).toBe(true);
    expect(list.find((a) => a.id === 'rewrite')?.needsInstruction).toBe(false);
    expect(list[0].label).toBe(DESIGN_ACTIONS.generate.label);
  });

  it('narrows known ids and rejects unknown', () => {
    expect(isDesignActionId('generate')).toBe(true);
    expect(isDesignActionId('nope')).toBe(false);
  });
});

describe('actionTask (prompt builders)', () => {
  it('generate embeds the brief', () => {
    const t = actionTask('generate', { instruction: 'Bold spring headline' });
    expect(t).toContain('Bold spring headline');
    expect(t).toContain('Return only the copy');
  });

  it('rewrite with no instruction uses the default improve prompt', () => {
    const t = actionTask('rewrite', {});
    expect(t).toContain('clearer, tighter, and more persuasive');
    expect(t).toContain('Do NOT add any fact');
  });

  it('rewrite with an instruction embeds the tweak', () => {
    expect(actionTask('rewrite', { instruction: 'make it playful' })).toContain('Rewrite it as follows: make it playful');
  });

  it('translate embeds the language and defaults to Spanish', () => {
    expect(actionTask('translate', { language: 'French' })).toContain('into French');
    expect(actionTask('translate', {})).toContain('into Spanish');
  });

  it('ideas clamps the count into [1,10] and defaults to 5', () => {
    expect(actionTask('ideas', { instruction: 'coffee', count: 3 })).toContain('Suggest 3 distinct content ideas');
    expect(actionTask('ideas', { instruction: 'coffee', count: 99 })).toContain('Suggest 10 distinct content ideas');
    expect(actionTask('ideas', { instruction: 'coffee', count: 0 })).toContain('Suggest 5 distinct content ideas');
    expect(actionTask('ideas', { instruction: 'coffee' })).toContain('Suggest 5 distinct content ideas');
  });

  it('ask embeds the question', () => {
    expect(actionTask('ask', { instruction: 'What tone?' })).toContain('What tone?');
  });

  it('throws on an unknown id', () => {
    expect(() => actionTask('bogus')).toThrow(/Unknown design action/);
  });
});

describe('buildActionMessages (id + inputs + design -> messages)', () => {
  it('resolves the task and fences the selection', () => {
    const msgs = buildActionMessages('rewrite', { instruction: 'shorter' }, { selection: 'Buy now, save big' });
    expect(msgs[0].content).toBe(SYSTEM_PROMPT);
    expect(msgs[1].content).toContain('Selected text: Buy now, save big');
    expect(msgs[1].content).toContain('Rewrite it as follows: shorter');
  });

  it('a from-scratch generate has no fence, only the task', () => {
    const msgs = buildActionMessages('generate', { instruction: 'launch headline' }, {});
    expect(msgs[1].content).not.toContain('---- design ----');
    expect(msgs[1].content).toContain('launch headline');
  });

  it('honors the passed budget (truncation note appears)', () => {
    const msgs = buildActionMessages('rewrite', {}, { selection: 'x'.repeat(500) }, 50);
    expect(msgs[1].content).toContain('truncated to fit');
  });

  it('rejects an unknown id', () => {
    expect(() => buildActionMessages('nope', {}, {})).toThrow(/Unknown design action/);
  });
});

describe('parseCopy', () => {
  it('returns clean text unchanged (idempotent)', () => {
    expect(parseCopy('Spring is here.')).toBe('Spring is here.');
    expect(parseCopy(parseCopy('Spring is here.'))).toBe('Spring is here.');
  });

  it('strips a wrapping markdown code fence', () => {
    expect(parseCopy('```\nHeadline copy\n```')).toBe('Headline copy');
    expect(parseCopy('```text\nHeadline copy\n```')).toBe('Headline copy');
  });

  it('strips matched surrounding quotes (straight and curly)', () => {
    expect(parseCopy('"Big sale today"')).toBe('Big sale today');
    expect(parseCopy('“Big sale today”')).toBe('Big sale today');
  });

  it('does not strip an internal or unmatched quote', () => {
    expect(parseCopy('The "best" coffee')).toBe('The "best" coffee');
    expect(parseCopy('"unterminated')).toBe('"unterminated');
  });

  it('trims surrounding whitespace', () => {
    expect(parseCopy('   Hello   ')).toBe('Hello');
  });
});

describe('parseIdeas', () => {
  it('strips numbered and bulleted list markers', () => {
    const out = parseIdeas('1. First idea\n2) Second idea\n- Third idea\n* Fourth\n• Fifth');
    expect(out).toEqual(['First idea', 'Second idea', 'Third idea', 'Fourth', 'Fifth']);
  });

  it('drops blank lines and strips per-line wrapping quotes', () => {
    expect(parseIdeas('\n1. "Quoted idea"\n\n2. Plain\n')).toEqual(['Quoted idea', 'Plain']);
  });

  it('falls back to non-empty lines when there is no list structure', () => {
    expect(parseIdeas('Just one line')).toEqual(['Just one line']);
    expect(parseIdeas('')).toEqual([]);
  });
});
