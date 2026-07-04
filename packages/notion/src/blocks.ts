// Notion blocks ↔ plain text/markdown — PURE, no network, no DOM. Two directions:
//
//   blocksToText:  a list of Notion block objects → a markdown-ish plain-text
//                  rendering, so a page's content can be handed to the model as
//                  context. Rich text is flattened to its plain string; block
//                  types map to their natural markdown lead-ins.
//
//   text builders: plain text → Notion block objects (paragraph, callout), so
//                  the model's output can be written BACK onto a page.
//
// The mapping is deliberately small and total: every block type we read has one
// obvious text form, and unknown/unsupported types degrade to their plain-text
// fallback rather than throwing. This is the single source of truth for the
// block↔text contract (documented in README).

// ── rich_text → plain string ───────────────────────────────────────────────

/**
 * A Notion rich_text item. We only read `plain_text` (Notion always populates
 * it) plus the annotations we render as markdown. The full object has href and
 * more, but the plain rendering needs just these.
 */
export interface RichTextItem {
  plain_text?: string;
  text?: { content?: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
  href?: string | null;
}

/** plainOf reads a single rich_text item's text, preferring Notion's flattened
 * `plain_text`, falling back to `text.content`. Pure. */
function plainOf(rt: RichTextItem): string {
  if (typeof rt.plain_text === 'string') return rt.plain_text;
  if (rt.text && typeof rt.text.content === 'string') return rt.text.content;
  return '';
}

/**
 * richTextToPlain flattens a rich_text array to a bare string (no markdown) —
 * used when the surrounding block already implies the formatting (e.g. a heading
 * lead-in) and we just need the words. Pure.
 */
export function richTextToPlain(rich: RichTextItem[] | undefined): string {
  if (!Array.isArray(rich)) return '';
  return rich.map(plainOf).join('');
}

/**
 * richTextToMarkdown flattens a rich_text array to markdown, applying inline
 * annotations (bold/italic/code/strikethrough) and links. Used for paragraph and
 * list content where inline emphasis carries meaning. Pure and order-stable.
 */
export function richTextToMarkdown(rich: RichTextItem[] | undefined): string {
  if (!Array.isArray(rich)) return '';
  return rich
    .map((rt) => {
      let s = plainOf(rt);
      if (s === '') return '';
      const a = rt.annotations || {};
      if (a.code) s = '`' + s + '`';
      if (a.bold) s = `**${s}**`;
      if (a.italic) s = `*${s}*`;
      if (a.strikethrough) s = `~~${s}~~`;
      if (rt.href) s = `[${s}](${rt.href})`;
      return s;
    })
    .join('');
}

// ── block → one line of text ────────────────────────────────────────────────

/** A Notion block, minimally typed for reading. `type` names the payload key. */
export interface NotionBlock {
  type?: string;
  has_children?: boolean;
  // Every block carries its payload under a key equal to its `type`. We index it
  // dynamically; the per-type shapes we read are rich_text + a few extras.
  [key: string]: any;
}

/** The rich_text array of a block, from its type-named payload. */
function blockRichText(b: NotionBlock): RichTextItem[] | undefined {
  const payload = b.type ? b[b.type] : undefined;
  return payload?.rich_text;
}

/**
 * blockToText renders ONE block to a single line of markdown-ish text (children
 * are handled by the recursive walker, not here). Every type we care about for a
 * doc/wiki page — headings, paragraphs, lists, to-dos, quotes, callouts, code,
 * toggles, dividers — maps to its natural lead-in. Unknown types fall back to
 * their flattened rich_text (or '' if they carry none), so this is total and
 * never throws. Pure.
 */
export function blockToText(b: NotionBlock): string {
  const t = b.type || '';
  const md = () => richTextToMarkdown(blockRichText(b));
  switch (t) {
    case 'heading_1':
      return `# ${md()}`;
    case 'heading_2':
      return `## ${md()}`;
    case 'heading_3':
      return `### ${md()}`;
    case 'paragraph':
      return md();
    case 'bulleted_list_item':
      return `- ${md()}`;
    case 'numbered_list_item':
      return `1. ${md()}`;
    case 'to_do': {
      const checked = b.to_do?.checked === true;
      return `- [${checked ? 'x' : ' '}] ${md()}`;
    }
    case 'toggle':
      return `▸ ${md()}`;
    case 'quote':
      return `> ${md()}`;
    case 'callout': {
      const icon =
        typeof b.callout?.icon?.emoji === 'string' ? `${b.callout.icon.emoji} ` : '';
      return `> ${icon}${md()}`;
    }
    case 'code': {
      const lang = typeof b.code?.language === 'string' ? b.code.language : '';
      return `\`\`\`${lang}\n${richTextToPlain(blockRichText(b))}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'child_page':
      return `[page] ${b.child_page?.title || ''}`.trimEnd();
    case 'child_database':
      return `[database] ${b.child_database?.title || ''}`.trimEnd();
    default: {
      // Unknown/unsupported block — keep any words it carries so nothing is lost.
      const fallback = richTextToMarkdown(blockRichText(b));
      return fallback;
    }
  }
}

/**
 * A block plus its already-fetched children, forming the tree the recursive read
 * produces. `children` is empty when the block has none (or none were fetched).
 */
export interface BlockNode {
  block: NotionBlock;
  children: BlockNode[];
}

/**
 * blocksToText renders a tree of blocks to text, indenting nested children by
 * depth so list/toggle structure survives. Blank blocks collapse (no empty
 * indented lines). This is what feeds a page's content to the model. Pure.
 */
export function blocksToText(nodes: BlockNode[], depth = 0): string {
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const node of nodes) {
    const line = blockToText(node.block);
    if (line !== '') {
      // Multi-line blocks (code) get each line padded.
      for (const l of line.split('\n')) lines.push(pad + l);
    }
    if (node.children.length) {
      const child = blocksToText(node.children, depth + 1);
      if (child) lines.push(child);
    }
  }
  return lines.join('\n');
}

// ── text → Notion block objects (write-back) ────────────────────────────────

/** rich_text array wrapping a single plain string — the minimal valid form
 * Notion accepts on writes. Notion caps a single rich_text content at 2000
 * chars, so long strings are split into multiple items. Pure. */
export function toRichText(text: string): Array<{ type: 'text'; text: { content: string } }> {
  const LIMIT = 2000;
  if (text.length <= LIMIT) return [{ type: 'text', text: { content: text } }];
  const out: Array<{ type: 'text'; text: { content: string } }> = [];
  for (let i = 0; i < text.length; i += LIMIT) {
    out.push({ type: 'text', text: { content: text.slice(i, i + LIMIT) } });
  }
  return out;
}

/** paragraphBlock builds a Notion paragraph block from plain text. Pure. */
export function paragraphBlock(text: string): Record<string, unknown> {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: toRichText(text) },
  };
}

/**
 * calloutBlock builds a Notion callout block — the natural container for an
 * AI-produced summary appended to a page (visually distinct, with an emoji).
 * Default icon is 🤖 (Hanzo output). Notion callout `rich_text` is one field, so
 * multi-paragraph bodies are joined with newlines within the single callout;
 * additional paragraph blocks can carry longer content. Pure.
 */
export function calloutBlock(text: string, emoji = '🤖'): Record<string, unknown> {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: toRichText(text),
      icon: { type: 'emoji', emoji },
    },
  };
}

/** headingBlock builds a heading_2 block — used to title an appended section. */
export function headingBlock(text: string): Record<string, unknown> {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: toRichText(text) },
  };
}

/**
 * textToBlocks turns a plain/markdown-ish string into a paragraph block per
 * non-empty line — the general write-back path for a multi-paragraph draft.
 * Blank lines are dropped (Notion renders an empty paragraph as a gap; we skip
 * them to keep the page tidy). Pure.
 */
export function textToBlocks(text: string): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(paragraphBlock);
}

// ── property value builders (extract → database) ────────────────────────────

/** titleProperty builds a Notion `title` property value. Every database has
 * exactly one title property; this is the row's name. Pure. */
export function titleProperty(text: string): Record<string, unknown> {
  return { title: toRichText(text) };
}

/** richTextProperty builds a `rich_text` property value (a text column). Pure. */
export function richTextProperty(text: string): Record<string, unknown> {
  return { rich_text: toRichText(text) };
}

/** dateProperty builds a `date` property value from an ISO date string, or null
 * when empty (Notion clears the field on null). Pure. */
export function dateProperty(iso: string): Record<string, unknown> {
  return { date: iso ? { start: iso } : null };
}

/** selectProperty builds a `select` property value from an option name, or null
 * when empty. Pure. */
export function selectProperty(name: string): Record<string, unknown> {
  return { select: name ? { name } : null };
}

/** checkboxProperty builds a `checkbox` property value. Pure. */
export function checkboxProperty(checked: boolean): Record<string, unknown> {
  return { checkbox: checked };
}

// ── reading a page's title (pure) ───────────────────────────────────────────

/**
 * pageTitle extracts a page's title text from a retrieved page object. Notion
 * stores the title under whichever property has type `title` (name varies:
 * "Name", "Title", "Task", …); we find it by type, then flatten its rich_text.
 * Falls back to '' when the page has no readable title. Pure.
 */
export function pageTitle(page: any): string {
  const props = page?.properties;
  if (props && typeof props === 'object') {
    for (const key of Object.keys(props)) {
      const prop = props[key];
      if (prop?.type === 'title') return richTextToPlain(prop.title);
    }
  }
  return '';
}
