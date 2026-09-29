/**
 * The active tab as markdown: what the user sees, signed in, after the page's
 * own scripts ran. Runs in the page beside snapshot.ts and walks the same
 * rendered tree (hidden nodes pruned, shadow roots and same-origin frames
 * followed), so `read` and `snapshot` never disagree about what is there.
 *
 *   read()                    the whole page
 *   read({ outline: true })   headings only
 *   read({ filter: 'price' }) only the sections whose heading or body mention it
 */

import { collapse, flat, INLINE, pruned, style } from './snapshot.js';

export interface ReadOptions {
  outline?: boolean;
  filter?: string;
}

/** Past this, a page is summarized by `outline` or narrowed by `filter`, not read whole. */
const MAX = 60_000;
const SKIP = new Set(['input', 'select', 'textarea', 'svg', 'canvas', 'video', 'audio', 'map']);

function kids(el: Element | Document, depth: number): string {
  const root = el.nodeType === 9 ? (el as Document).body : el;
  if (!root) return '';
  return flat(root).map((c) => md(c, depth)).join('');
}

function inline(el: Element, depth: number): string {
  return collapse(kids(el, depth));
}

function block(s: string): string {
  return s.trim() ? `\n\n${s.trim()}\n\n` : '';
}

function list(el: Element, depth: number): string {
  const ordered = el.localName === 'ol';
  let n = Number(el.getAttribute('start')) || 1;
  const pad = '  '.repeat(depth);
  const lines: string[] = [];
  for (const c of flat(el)) {
    if (c.nodeType !== 1 || pruned(c as Element)) continue;
    const body = kids(c as Element, depth + 1).replace(/\n{2,}/g, '\n').trim();
    if (!body) continue;
    const [first, ...rest] = body.split('\n');
    lines.push(`${pad}${ordered ? `${n++}.` : '-'} ${first.trim()}`, ...rest);
  }
  return `\n\n${lines.join('\n')}\n\n`;
}

function table(el: Element, depth: number): string {
  const rows = Array.from(el.querySelectorAll('tr'))
    .filter((r) => r.closest('table') === el && !pruned(r))
    .map((r) => Array.from(r.children)
      .filter((c) => (c.localName === 'td' || c.localName === 'th') && !pruned(c))
      .map((c) => inline(c, depth).replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const row = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
  return block([row(rows[0]), row(Array(width).fill('---')), ...rows.slice(1).map(row)].join('\n'));
}

function md(node: ChildNode, depth: number): string {
  // Source whitespace, newlines included, renders as one space.
  if (node.nodeType === 3) return (node.textContent || '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  if (pruned(el) || SKIP.has(el.localName)) return '';
  const tag = el.localName;
  const h = /^h([1-6])$/.exec(tag);
  if (h) {
    const t = inline(el, depth);
    return t ? block(`${'#'.repeat(Number(h[1]))} ${t}`) : '';
  }
  switch (tag) {
    case 'p': return block(inline(el, depth));
    case 'br': return '\n';
    case 'hr': return block('---');
    case 'ul': case 'ol': return list(el, depth);
    case 'table': return table(el, depth);
    case 'pre': {
      const inner = (el as HTMLElement).innerText;
      const code = typeof inner === 'string' ? inner : el.textContent || '';
      return block(`\`\`\`\n${code.replace(/\n+$/, '')}\n\`\`\``);
    }
    case 'code': {
      const t = collapse(el.textContent || '');
      return t ? `\`${t}\`` : '';
    }
    case 'blockquote': {
      const q = kids(el, depth).trim().replace(/\n{3,}/g, '\n\n');
      return q ? block(q.split('\n').map((l) => `> ${l}`).join('\n')) : '';
    }
    case 'strong': case 'b': {
      const t = inline(el, depth);
      return t ? `**${t}**` : '';
    }
    case 'em': case 'i': {
      const t = inline(el, depth);
      return t ? `_${t}_` : '';
    }
    case 'a': {
      const t = inline(el, depth);
      const href = (el as HTMLAnchorElement).href;
      if (!t) return '';
      return href && !href.startsWith('javascript:') ? `[${t}](${href})` : t;
    }
    case 'img': {
      const alt = collapse(el.getAttribute('alt') || '');
      if (!alt) return '';
      const src = (el as HTMLImageElement).src;
      return src && !src.startsWith('data:') ? `![${alt}](${src})` : `![${alt}]`;
    }
    case 'iframe': {
      let doc: Document | null = null;
      try { doc = (el as HTMLIFrameElement).contentDocument; } catch { /* cross-origin */ }
      return doc ? block(kids(doc, depth)) : '';
    }
  }
  const inner = kids(el, depth);
  return INLINE.has(style(el).display) ? inner : block(inner);
}

/** Collapse runs of spaces and blank lines; keep list indentation and fenced code verbatim. */
function tidy(s: string): string {
  let fenced = false;
  return s
    .split('\n')
    .map((l) => {
      if (l.trimStart().startsWith('```')) { fenced = !fenced; return l.trim(); }
      if (fenced) return l;
      const [, indent, rest] = /^(\s*)(.*)$/.exec(l)!;
      const body = rest.replace(/[ \t]+/g, ' ').trim();
      return /^(-|\d+\.) /.test(body) ? indent + body : body;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split into sections, one per heading; text before the first heading is its own section. */
function sections(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fenced = false;
  for (const l of text.split('\n')) {
    if (l.startsWith('```')) fenced = !fenced;
    if (!fenced && /^#{1,6} /.test(l) && cur.length) { out.push(cur.join('\n').trim()); cur = []; }
    cur.push(l);
  }
  if (cur.length) out.push(cur.join('\n').trim());
  return out.filter(Boolean);
}

export function read(opts: ReadOptions = {}): { title: string; url: string; markdown: string; truncated: boolean } {
  let text = tidy(kids(document.body ?? document.documentElement, 0));
  const want = opts.filter?.trim().toLowerCase();
  if (opts.outline) {
    text = text.split('\n').filter((l) => /^#{1,6} /.test(l) && (!want || l.toLowerCase().includes(want))).join('\n');
  } else if (want) {
    text = sections(text).filter((s) => s.toLowerCase().includes(want)).join('\n\n');
  }
  if (!text) text = want ? `(no section mentions ${JSON.stringify(opts.filter)})` : opts.outline ? '(no headings)' : '(no text)';
  const truncated = text.length > MAX;
  if (truncated) text = `${text.slice(0, MAX)}\n\n… (truncated at ${MAX} characters: narrow with filter, or skim with outline)`;
  return { title: document.title, url: location.href, markdown: text, truncated };
}
