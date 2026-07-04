import { describe, it, expect, vi } from 'vitest';
import {
  truncate,
  assemblePageContext,
  buildMessages,
  actionTask,
  runAction,
  parseActionItems,
  actionItemProperties,
  resultBlocks,
  noteHeading,
  DEFAULT_FIELD_MAP,
  MAX_CONTEXT_CHARS,
  SYSTEM_PROMPT,
  type PageContext,
  type ActionItem,
} from '../src/actions';
import type { AiClient } from '../src/client';

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

describe('assemblePageContext', () => {
  it('leads with the title so it survives truncation', () => {
    const ctx: PageContext = { title: 'Launch Plan', text: 'line one\nline two' };
    expect(assemblePageContext(ctx)).toBe('Page: Launch Plan\n\nline one\nline two');
  });
  it('omits the header when there is no title', () => {
    expect(assemblePageContext({ title: '', text: 'body' })).toBe('body');
  });
  it('caps the whole assembly at maxChars', () => {
    const ctx: PageContext = { title: 'T', text: 'x'.repeat(MAX_CONTEXT_CHARS + 100) };
    const out = assemblePageContext(ctx, 50);
    expect(out.length).toBeLessThan(MAX_CONTEXT_CHARS);
    expect(out).toContain('truncated');
  });
});

describe('buildMessages', () => {
  it('fences the page content as data under the system frame', () => {
    const msgs = buildMessages('Summarize.', 'PAGE BODY');
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toContain('---- Notion page ----');
    expect(msgs[1].content).toContain('PAGE BODY');
    expect(msgs[1].content.startsWith('Summarize.')).toBe(true);
  });
  it('sends only the task when context is empty', () => {
    expect(buildMessages('Just ask', '   ')[1].content).toBe('Just ask');
  });
});

describe('actionTask', () => {
  it('summarize + extract are fixed instructions', () => {
    expect(actionTask('summarize')).toMatch(/bullet list/i);
    expect(actionTask('extract')).toMatch(/JSON array/);
    expect(actionTask('extract')).toMatch(/"task".*"owner".*"due"/s);
  });
  it('draft uses the detail, or a sensible default', () => {
    expect(actionTask('draft', 'a risks section')).toContain('a risks section');
    expect(actionTask('draft')).toContain('continuing naturally');
  });
  it('ask returns the question, or a default', () => {
    expect(actionTask('ask', 'What is the deadline?')).toBe('What is the deadline?');
    expect(actionTask('ask')).toMatch(/open questions/);
  });
});

describe('runAction (through a mocked AiClient)', () => {
  it('assembles context, forms the task, returns the model text', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: 'the summary' } }] });
    const client: AiClient = { chat: { completions: { create } }, models: { list: vi.fn() } };
    const out = await runAction({
      id: 'summarize',
      context: { title: 'Doc', text: 'content' },
      hanzoToken: 'hk-1',
      model: 'zen5',
      client,
    });
    expect(out).toBe('the summary');
    const args = create.mock.calls[0][0];
    expect(args.model).toBe('zen5');
    expect(args.messages[1].content).toContain('content');
  });

  it('extract routes the JSON task through the same single path', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: '[]' } }] });
    const client: AiClient = { chat: { completions: { create } }, models: { list: vi.fn() } };
    await runAction({ id: 'extract', context: { title: '', text: 'x' }, hanzoToken: '', client });
    expect(create.mock.calls[0][0].messages[1].content).toContain('JSON array');
  });
});

describe('parseActionItems', () => {
  it('parses a clean JSON array', () => {
    const items = parseActionItems('[{"task":"Ship v1","owner":"Ada","due":"2026-07-01"}]');
    expect(items).toEqual<ActionItem[]>([{ task: 'Ship v1', owner: 'Ada', due: '2026-07-01' }]);
  });
  it('tolerates a ```json fence and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n[{"task":"Do it"}]\n```\nThanks';
    expect(parseActionItems(raw)).toEqual([{ task: 'Do it', owner: '', due: '' }]);
  });
  it('drops elements with no task, keeps the rest', () => {
    const items = parseActionItems('[{"owner":"x"},{"task":"Real","owner":"Bo"}]');
    expect(items).toEqual([{ task: 'Real', owner: 'Bo', due: '' }]);
  });
  it('returns [] for an empty array', () => {
    expect(parseActionItems('[]')).toEqual([]);
  });
  it('throws when no array is present', () => {
    expect(() => parseActionItems('sorry, none found')).toThrow(/No action-item array/);
  });
  it('throws on malformed JSON', () => {
    expect(() => parseActionItems('[{"task": ]')).toThrow(/not valid JSON/);
  });
});

describe('actionItemProperties', () => {
  it('maps task→title, owner→rich_text, due→date with the default field names', () => {
    const props = actionItemProperties({ task: 'Ship', owner: 'Ada', due: '2026-07-01' });
    expect((props.Name as any).title[0].text.content).toBe('Ship');
    expect((props.Owner as any).rich_text[0].text.content).toBe('Ada');
    expect((props.Due as any).date.start).toBe('2026-07-01');
  });
  it('omits owner/due columns when the item lacks them (row still valid)', () => {
    const props = actionItemProperties({ task: 'Solo', owner: '', due: '' });
    expect(Object.keys(props)).toEqual([DEFAULT_FIELD_MAP.title]);
  });
  it('honours a custom field map', () => {
    const props = actionItemProperties(
      { task: 'T', owner: 'O', due: '' },
      { title: 'Task', owner: 'Assignee' },
    );
    expect(props).toHaveProperty('Task');
    expect(props).toHaveProperty('Assignee');
    expect(props).not.toHaveProperty('Due');
  });
});

describe('resultBlocks', () => {
  it('leads with a labelled heading then a callout', () => {
    const blocks = resultBlocks('summarize', 'first paragraph\n\nsecond paragraph');
    expect((blocks[0] as any).type).toBe('heading_2');
    expect((blocks[0] as any).heading_2.rich_text[0].text.content).toBe('Hanzo AI — Summary');
    expect((blocks[1] as any).type).toBe('callout');
    expect((blocks[1] as any).callout.rich_text[0].text.content).toBe('first paragraph');
    // second paragraph spills into a paragraph block
    expect((blocks[2] as any).type).toBe('paragraph');
  });
  it('single-paragraph output is just heading + callout', () => {
    const blocks = resultBlocks('ask', 'one line answer');
    expect(blocks).toHaveLength(2);
  });
});

describe('noteHeading', () => {
  it('labels each action', () => {
    expect(noteHeading('summarize')).toBe('Hanzo AI — Summary');
    expect(noteHeading('draft')).toBe('Hanzo AI — Draft');
    expect(noteHeading('extract')).toBe('Hanzo AI — Action items');
    expect(noteHeading('ask')).toBe('Hanzo AI — Answer');
  });
});
