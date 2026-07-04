import { describe, it, expect } from 'vitest';
import {
  richTextToPlain,
  richTextToMarkdown,
  blockToText,
  blocksToText,
  toRichText,
  paragraphBlock,
  calloutBlock,
  headingBlock,
  textToBlocks,
  titleProperty,
  richTextProperty,
  dateProperty,
  selectProperty,
  checkboxProperty,
  pageTitle,
  type BlockNode,
  type NotionBlock,
} from '../src/blocks';

// Helper: a rich_text array of one plain run with optional annotations.
const rt = (text: string, annotations = {}, href: string | null = null) => [
  { plain_text: text, annotations, href },
];
// Helper: a typed block with a rich_text payload under its type key.
const block = (type: string, rich: any, extra: Record<string, unknown> = {}): NotionBlock => ({
  type,
  [type]: { rich_text: rich, ...extra },
});

describe('rich_text flattening', () => {
  it('richTextToPlain joins runs with no markup', () => {
    expect(richTextToPlain([{ plain_text: 'Hello ' }, { plain_text: 'world' }])).toBe('Hello world');
  });

  it('richTextToPlain falls back to text.content when plain_text is absent', () => {
    expect(richTextToPlain([{ text: { content: 'raw' } }])).toBe('raw');
  });

  it('richTextToMarkdown applies bold/italic/code/strike and links', () => {
    expect(richTextToMarkdown(rt('b', { bold: true }))).toBe('**b**');
    expect(richTextToMarkdown(rt('i', { italic: true }))).toBe('*i*');
    expect(richTextToMarkdown(rt('c', { code: true }))).toBe('`c`');
    expect(richTextToMarkdown(rt('s', { strikethrough: true }))).toBe('~~s~~');
    expect(richTextToMarkdown(rt('link', {}, 'https://x'))).toBe('[link](https://x)');
  });

  it('nests annotations deterministically (code innermost, then bold, italic)', () => {
    expect(richTextToMarkdown(rt('x', { bold: true, italic: true, code: true }))).toBe('***`x`***');
  });

  it('returns empty string for a non-array', () => {
    expect(richTextToMarkdown(undefined)).toBe('');
    expect(richTextToPlain(undefined)).toBe('');
  });
});

describe('blockToText — every doc block type maps to its markdown lead-in', () => {
  it('headings 1/2/3', () => {
    expect(blockToText(block('heading_1', rt('Title')))).toBe('# Title');
    expect(blockToText(block('heading_2', rt('Sub')))).toBe('## Sub');
    expect(blockToText(block('heading_3', rt('Subsub')))).toBe('### Subsub');
  });

  it('paragraph is bare markdown', () => {
    expect(blockToText(block('paragraph', rt('body text')))).toBe('body text');
  });

  it('bulleted and numbered list items', () => {
    expect(blockToText(block('bulleted_list_item', rt('one')))).toBe('- one');
    expect(blockToText(block('numbered_list_item', rt('two')))).toBe('1. two');
  });

  it('to_do reflects checked state', () => {
    expect(blockToText(block('to_do', rt('ship'), { checked: false }))).toBe('- [ ] ship');
    expect(blockToText(block('to_do', rt('done'), { checked: true }))).toBe('- [x] done');
  });

  it('quote and toggle', () => {
    expect(blockToText(block('quote', rt('wisdom')))).toBe('> wisdom');
    expect(blockToText(block('toggle', rt('more')))).toBe('▸ more');
  });

  it('callout prefixes the emoji icon', () => {
    const b = block('callout', rt('note'), { icon: { emoji: '💡' } });
    expect(blockToText(b)).toBe('> 💡 note');
  });

  it('code fences with the language and uses PLAIN text inside (no markdown escaping)', () => {
    const b = block('code', rt('const x = `y`'), { language: 'ts' });
    expect(blockToText(b)).toBe('```ts\nconst x = `y`\n```');
  });

  it('divider, child_page, child_database', () => {
    expect(blockToText({ type: 'divider', divider: {} })).toBe('---');
    expect(blockToText({ type: 'child_page', child_page: { title: 'Sub Page' } })).toBe('[page] Sub Page');
    expect(blockToText({ type: 'child_database', child_database: { title: 'Tasks' } })).toBe('[database] Tasks');
  });

  it('unknown block degrades to its flattened rich_text, never throws', () => {
    expect(blockToText(block('image', rt('caption')))).toBe('caption');
    expect(blockToText({ type: 'unsupported' })).toBe('');
  });
});

describe('blocksToText — tree with indentation', () => {
  it('indents nested children by depth and skips empty blocks', () => {
    const tree: BlockNode[] = [
      { block: block('heading_1', rt('Plan')), children: [] },
      {
        block: block('bulleted_list_item', rt('Parent')),
        children: [{ block: block('bulleted_list_item', rt('Child')), children: [] }],
      },
      { block: { type: 'unsupported' }, children: [] }, // empty → dropped
      { block: block('paragraph', rt('End')), children: [] },
    ];
    expect(blocksToText(tree)).toBe('# Plan\n- Parent\n  - Child\nEnd');
  });

  it('pads every line of a multi-line code block at its depth', () => {
    const tree: BlockNode[] = [
      {
        block: block('toggle', rt('Details')),
        children: [{ block: block('code', rt('a\nb'), { language: '' }), children: [] }],
      },
    ];
    expect(blocksToText(tree)).toBe('▸ Details\n  ```\n  a\n  b\n  ```');
  });
});

describe('text → block builders (write-back)', () => {
  it('toRichText wraps a short string in one run', () => {
    expect(toRichText('hi')).toEqual([{ type: 'text', text: { content: 'hi' } }]);
  });

  it('toRichText splits strings over Notion’s 2000-char cap', () => {
    const runs = toRichText('x'.repeat(4500));
    expect(runs).toHaveLength(3);
    expect(runs[0].text.content).toHaveLength(2000);
    expect(runs[2].text.content).toHaveLength(500);
  });

  it('paragraphBlock / headingBlock produce valid Notion block objects', () => {
    expect(paragraphBlock('p')).toEqual({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: 'p' } }] },
    });
    expect(headingBlock('h')).toMatchObject({ type: 'heading_2', heading_2: { rich_text: expect.any(Array) } });
  });

  it('calloutBlock carries the emoji icon (default 🤖)', () => {
    const b: any = calloutBlock('summary');
    expect(b.type).toBe('callout');
    expect(b.callout.icon).toEqual({ type: 'emoji', emoji: '🤖' });
    const custom: any = calloutBlock('x', '📌');
    expect(custom.callout.icon.emoji).toBe('📌');
  });

  it('textToBlocks makes one paragraph per non-empty line', () => {
    const blocks = textToBlocks('line one\n\n  line two  \n');
    expect(blocks).toHaveLength(2);
    expect((blocks[1] as any).paragraph.rich_text[0].text.content).toBe('line two');
  });
});

describe('property builders (extract → database)', () => {
  it('titleProperty / richTextProperty wrap text', () => {
    expect((titleProperty('Task') as any).title[0].text.content).toBe('Task');
    expect((richTextProperty('note') as any).rich_text[0].text.content).toBe('note');
  });

  it('dateProperty sets start, or null when empty', () => {
    expect(dateProperty('2026-07-01')).toEqual({ date: { start: '2026-07-01' } });
    expect(dateProperty('')).toEqual({ date: null });
  });

  it('selectProperty sets name, or null when empty', () => {
    expect(selectProperty('High')).toEqual({ select: { name: 'High' } });
    expect(selectProperty('')).toEqual({ select: null });
  });

  it('checkboxProperty passes the boolean through', () => {
    expect(checkboxProperty(true)).toEqual({ checkbox: true });
  });
});

describe('pageTitle', () => {
  it('finds the title-typed property regardless of its name', () => {
    const page = {
      properties: {
        Status: { type: 'select', select: { name: 'Open' } },
        Task: { type: 'title', title: [{ plain_text: 'Launch ' }, { plain_text: 'v1' }] },
      },
    };
    expect(pageTitle(page)).toBe('Launch v1');
  });

  it('returns empty string when there is no title property', () => {
    expect(pageTitle({ properties: { X: { type: 'number', number: 3 } } })).toBe('');
    expect(pageTitle({})).toBe('');
  });
});
