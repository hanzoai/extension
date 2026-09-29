/**
 * Snapshot → ref engine: the one way an agent sees and drives a page.
 *
 *   snapshot()            - button "Submit" [ref=e2]
 *   act({op:'click', selector:'@e2'})
 *
 * Runs IN the page, in the extension's isolated world (page.js, injected by
 * shared/drive.ts), identically on Chrome, Firefox and Safari. No CDP: the
 * tree is read from the rendered DOM and actions are DOM events, so the same
 * bytes work on every engine and nothing shows a "debugging this browser" bar.
 *
 * Refs are the agent's handles. A ref names one element for as long as that
 * element stays in the document: a later snapshot hands the same element the
 * same ref, and a ref whose element left the DOM, or whose document navigated
 * away (a new document is a new isolated world, so its ref table starts
 * empty), is refused with a "run snapshot again" error rather than guessed at.
 */

export interface SnapshotOptions {
  /** Flat list of interactive elements only. */
  interactive?: boolean;
  /** Drop structural nodes that carry nothing, unwrap single-child wrappers. */
  compact?: boolean;
  /** Maximum tree depth; 0 or absent is unlimited. */
  depth?: number;
  /** Scope to one element: a ref (@e4) or a CSS selector. */
  selector?: string;
  /** Print each link's URL under it. */
  urls?: boolean;
  /** Lowest ref number to hand out: keeps refs unique across a tab's documents. */
  base?: number;
}

export interface ActRequest {
  op: string;
  selector?: string;
  text?: string;
  key?: string;
  value?: string;
  attribute?: string;
  dx?: number;
  dy?: number;
}

interface Item {
  role: string;
  name: string;
  el?: Element;
  props: string[];
  value?: string;
  text?: string;
  closed?: boolean;
  kids: Item[];
}

const INTERACTIVE = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox',
  'listbox', 'option', 'slider', 'spinbutton', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'treeitem', 'clickable',
]);
/** Content roles worth a handle when they have a name. */
const NAMED_REF = new Set([
  'heading', 'img', 'cell', 'gridcell', 'columnheader', 'rowheader', 'dialog', 'alertdialog',
  'article', 'region', 'navigation', 'form', 'iframe',
]);
/** Roles whose accessible name is their text content. */
const NAME_FROM_CONTENT = new Set([
  'button', 'link', 'heading', 'cell', 'gridcell', 'columnheader', 'rowheader', 'option',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'checkbox', 'radio',
  'switch', 'tooltip', 'clickable',
]);
const CELLS = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
const VALUED = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title', 'base',
  'object', 'embed', 'param', 'source', 'track', 'datalist',
]);
export const INLINE = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents']);
/** The extension's own page UI (content-script.ts), never part of the page. */
const OWN = new Set(['hanzo-ai-overlay', 'hanzo-page-overlay-root', 'hanzo-picker-overlay', 'hanzo-console-root']);
const FOCUSABLE = 'a[href],area[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable="true"]';
/** Elements named by a caption child. */
const CAPTION: Record<string, string> = { fieldset: 'legend', table: 'caption', figure: 'figcaption' };
const MAX_NAME = 150;
const MAX_TEXT = 300;
const MAX_OPTIONS = 25;

// ─── ref table ──────────────────────────────────────────────────────────────

// WeakRef is ES2021 and this package's lib is ES2020; every engine it targets has it.
declare class WeakRef<T extends object> {
  constructor(target: T);
  deref(): T | undefined;
}

const refs = new Map<string, WeakRef<Element>>();
const ids = new WeakMap<Element, string>();
let seq = 0;

function refFor(el: Element): string {
  let r = ids.get(el);
  if (!r) {
    r = `e${++seq}`;
    ids.set(el, r);
  }
  refs.set(r, new WeakRef(el));
  return r;
}

/** True when `s` names a ref: `@e3` or `e3`. */
export function isRef(s: string): boolean {
  return /^@?e\d+$/.test(s.trim());
}

function live(el: Element): boolean {
  return el.isConnected && !!el.ownerDocument.defaultView;
}

/** Resolve an agent target — a ref or a CSS selector — to its element. */
export function resolve(target: string | undefined): Element {
  if (!target || !target.trim()) throw new Error('selector required: a snapshot ref (@e2) or a CSS selector');
  const t = target.trim();
  if (isRef(t)) {
    const ref = t.replace(/^@/, '');
    const el = refs.get(ref)?.deref();
    if (!el) {
      throw new Error(`Unknown ref @${ref}: this page has no such ref (it navigated, or the ref came from another tab). Run snapshot again for fresh refs.`);
    }
    if (!live(el)) {
      refs.delete(ref);
      throw new Error(`Stale ref @${ref}: its element is no longer in the page. Run snapshot again for fresh refs.`);
    }
    return el;
  }
  let el: Element | null;
  try {
    el = document.querySelector(t);
  } catch {
    throw new Error(`Invalid selector ${JSON.stringify(t)}: pass a snapshot ref (@e2) or a CSS selector.`);
  }
  if (!el) throw new Error(`No element matches ${JSON.stringify(t)}. Run snapshot to see what is on the page.`);
  return el;
}

// ─── DOM reading ────────────────────────────────────────────────────────────

export function style(el: Element): CSSStyleDeclaration {
  return el.ownerDocument.defaultView!.getComputedStyle(el);
}

function shadowOf(el: Element): ShadowRoot | null {
  const e = el as any;
  try {
    if (typeof e.openOrClosedShadowRoot === 'function') return e.openOrClosedShadowRoot() ?? null; // Firefox
    const dom = (globalThis as any).chrome?.dom;
    if (dom?.openOrClosedShadowRoot && el instanceof el.ownerDocument.defaultView!.HTMLElement) {
      return dom.openOrClosedShadowRoot(el) ?? null; // Chrome
    }
  } catch { /* not a shadow host */ }
  return el.shadowRoot;
}

/** Children in rendered (flat-tree) order: shadow content first, slots filled. */
export function flat(node: ParentNode): ChildNode[] {
  const root = node instanceof Element ? shadowOf(node) : null;
  const out: ChildNode[] = [];
  for (const c of Array.from((root ?? node).childNodes)) {
    if (c.nodeType === 1 && (c as Element).localName === 'slot') {
      const slot = c as HTMLSlotElement;
      const assigned = typeof slot.assignedNodes === 'function' ? slot.assignedNodes({ flatten: true }) : [];
      out.push(...(assigned.length ? (assigned as ChildNode[]) : Array.from(slot.childNodes)));
    } else {
      out.push(c);
    }
  }
  return out;
}

/** The composed parent: crosses shadow boundaries, stops at the document. */
function up(node: Node): Element | null {
  if ((node as Element).assignedSlot) return (node as Element).assignedSlot;
  const p = node.parentNode;
  if (!p) return null;
  if (p.nodeType === 11) return (p as ShadowRoot).host ?? null;
  return p.nodeType === 1 ? (p as Element) : null;
}

function contains(outer: Element, inner: Element | null): boolean {
  for (let n: Element | null = inner; n; n = up(n)) if (n === outer) return true;
  return false;
}

/**
 * Not rendered, or not ours to show: display:none, [hidden], aria-hidden, a
 * closed <details> body (checkVisibility), and the extension's own overlays.
 * display:contents has no box yet its children render, so it is never pruned.
 */
export function pruned(el: Element): boolean {
  if (SKIP.has(el.localName) || OWN.has(el.id)) return true;
  if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return true;
  const display = style(el).display;
  if (display === 'none') return true;
  return display !== 'contents' && typeof (el as any).checkVisibility === 'function' && !(el as any).checkVisibility();
}

export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Rendered text of a subtree, for names computed from content. */
function textOf(root: Element, budget = MAX_NAME * 2): string {
  let out = '';
  const visit = (n: ChildNode) => {
    if (out.length > budget) return;
    if (n.nodeType === 3) { out += n.textContent; return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (pruned(el)) return;
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) { out += ` ${aria} `; return; }
    if (el.localName === 'img') { out += ` ${el.getAttribute('alt') ?? ''} `; return; }
    if (el.localName === 'input') {
      const t = (el as HTMLInputElement).type;
      if (t === 'submit' || t === 'button' || t === 'reset') out += ` ${(el as HTMLInputElement).value} `;
      return;
    }
    if (el.localName === 'select' || el.localName === 'textarea') return;
    const block = !INLINE.has(style(el).display);
    if (block) out += ' ';
    for (const c of flat(el)) visit(c);
    if (block) out += ' ';
  };
  for (const c of flat(root)) visit(c);
  return collapse(out);
}

function byIds(el: Element, attr: string): string {
  const v = el.getAttribute(attr);
  if (!v) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return collapse(v.split(/\s+/).map((id) => {
    const t = root.getElementById?.(id) ?? el.ownerDocument.getElementById(id);
    return t ? textOf(t) : '';
  }).join(' '));
}

function sectioned(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (['article', 'aside', 'main', 'nav', 'section'].includes(p.localName)) return true;
  }
  return false;
}

function implicitRole(el: Element): string {
  const tag = el.localName;
  switch (tag) {
    case 'a': case 'area': return el.hasAttribute('href') ? 'link' : '';
    case 'button': return 'button';
    case 'input': {
      const t = (el as HTMLInputElement).type;
      if (t === 'hidden') return '';
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image' || t === 'file') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'number') return 'spinbutton';
      if (el.hasAttribute('list')) return 'combobox';
      return t === 'search' ? 'searchbox' : 'textbox';
    }
    case 'select': return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox';
    case 'option': return 'option';
    case 'textarea': return 'textbox';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'img': return el.getAttribute('alt') === '' ? '' : 'img';
    case 'svg': return el.getAttribute('aria-label') || el.querySelector('title') ? 'img' : '';
    case 'ul': case 'ol': case 'menu': return 'list';
    case 'li': return 'listitem';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'header': return sectioned(el) ? '' : 'banner';
    case 'footer': return sectioned(el) ? '' : 'contentinfo';
    case 'aside': return 'complementary';
    case 'form': return 'form';
    case 'section': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
    case 'article': return 'article';
    case 'table': return 'table';
    case 'tr': return 'row';
    case 'td': return 'cell';
    case 'th': return el.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader';
    case 'dialog': return 'dialog';
    case 'details': case 'fieldset': return 'group';
    case 'summary': return 'button';
    case 'p': return 'paragraph';
    case 'blockquote': return 'blockquote';
    case 'hr': return 'separator';
    case 'progress': return 'progressbar';
    case 'meter': return 'meter';
    case 'output': return 'status';
    case 'iframe': return 'iframe';
    case 'figure': return 'figure';
  }
  if ((el as HTMLElement).isContentEditable && !(el.parentElement as HTMLElement | null)?.isContentEditable) return 'textbox';
  return '';
}

/** Explicit role, else implicit, else `clickable` for a bare element that takes clicks. */
function roleOf(el: Element, cursor: string, parentCursor: string): string {
  const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
  if (explicit && explicit !== 'presentation' && explicit !== 'none' && explicit !== 'generic') return explicit;
  const role = implicitRole(el);
  if (role) return role;
  const tag = el.localName;
  if (tag === 'label' || tag === 'body' || tag === 'html') return '';
  const tabbable = el.hasAttribute('tabindex') && (el as HTMLElement).tabIndex >= 0;
  if (tabbable || el.hasAttribute('onclick') || (cursor === 'pointer' && parentCursor !== 'pointer')) return 'clickable';
  return '';
}

function formValue(el: Element): string | undefined {
  const tag = el.localName;
  if (tag === 'select') {
    const s = el as HTMLSelectElement;
    return Array.from(s.selectedOptions).map((o) => collapse(o.label || o.text)).join(', ');
  }
  if (tag === 'input' || tag === 'textarea') {
    const i = el as HTMLInputElement;
    if (i.type === 'password') return i.value ? '•'.repeat(Math.min(i.value.length, 8)) : '';
    return i.value;
  }
  if ((el as HTMLElement).isContentEditable) return collapse(el.textContent || '');
  const now = el.getAttribute('aria-valuenow');
  return now ?? undefined;
}

function nameOf(el: Element, role: string): string {
  const labelled = byIds(el, 'aria-labelledby');
  if (labelled) return clip(labelled, MAX_NAME);
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return clip(collapse(aria), MAX_NAME);
  const tag = el.localName;
  if (tag === 'input' || tag === 'select' || tag === 'textarea') {
    const i = el as HTMLInputElement;
    if (tag === 'input' && (i.type === 'submit' || i.type === 'reset' || i.type === 'button')) {
      return clip(i.value || (i.type === 'submit' ? 'Submit' : i.type === 'reset' ? 'Reset' : ''), MAX_NAME);
    }
    if (tag === 'input' && i.type === 'image') return clip(i.alt || i.title || 'Submit', MAX_NAME);
    const labels = Array.from(i.labels ?? []).map((l) => textOf(l)).filter(Boolean).join(' ');
    if (labels) return clip(labels, MAX_NAME);
    return clip(collapse(i.placeholder || el.getAttribute('title') || ''), MAX_NAME);
  }
  if (tag === 'img' || tag === 'area') return clip(collapse(el.getAttribute('alt') || el.getAttribute('title') || ''), MAX_NAME);
  if (tag === 'svg') return clip(collapse(el.querySelector('title')?.textContent || ''), MAX_NAME);
  const caption = CAPTION[tag];
  if (caption) {
    const c = el.querySelector(`:scope > ${caption}`);
    if (c) return clip(textOf(c), MAX_NAME);
  }
  if (tag === 'iframe') return clip(collapse(el.getAttribute('title') || el.getAttribute('name') || ''), MAX_NAME);
  if (NAME_FROM_CONTENT.has(role)) {
    const t = textOf(el);
    if (t) return clip(t, MAX_NAME);
  }
  return clip(collapse(el.getAttribute('title') || ''), MAX_NAME);
}

function disabled(el: Element): boolean {
  try {
    if (el.matches(':disabled')) return true;
  } catch { /* :disabled unsupported on this element */ }
  return !!el.closest('[aria-disabled="true"]');
}

function checkedOf(el: Element): boolean | 'mixed' | undefined {
  if (el.localName === 'input') {
    const i = el as HTMLInputElement;
    if (i.type === 'checkbox' || i.type === 'radio') return i.indeterminate ? 'mixed' : i.checked;
  }
  const a = el.getAttribute('aria-checked');
  if (a === 'mixed') return 'mixed';
  if (a === 'true' || a === 'false') return a === 'true';
  return undefined;
}

function propsOf(el: Element, role: string): string[] {
  const p: string[] = [];
  if (role === 'heading') {
    const m = /^h([1-6])$/.exec(el.localName);
    p.push(`level=${el.getAttribute('aria-level') || (m ? m[1] : '2')}`);
  }
  const c = checkedOf(el);
  if (c === 'mixed') p.push('checked=mixed');
  else if (c === true) p.push('checked');
  if (INTERACTIVE.has(role) && disabled(el)) p.push('disabled');
  const exp = el.getAttribute('aria-expanded');
  if (exp === 'true' || exp === 'false') p.push(`expanded=${exp}`);
  else if (el.localName === 'summary' && el.parentElement?.localName === 'details') {
    p.push(`expanded=${(el.parentElement as HTMLDetailsElement).open}`);
  }
  if (el.getAttribute('aria-selected') === 'true' || (el.localName === 'option' && (el as HTMLOptionElement).selected)) p.push('selected');
  if (el.getAttribute('aria-pressed') === 'true') p.push('pressed');
  if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') p.push('required');
  return p;
}

// ─── tree ───────────────────────────────────────────────────────────────────

function actionable(n: Item): boolean {
  return (n.text === undefined && INTERACTIVE.has(n.role) && !!n.el) || n.kids.some(actionable);
}

function pushText(out: Item[], s: string) {
  const last = out[out.length - 1];
  if (last && last.text !== undefined && !last.closed) last.text += s;
  else out.push({ role: '', name: '', text: s, props: [], kids: [] });
}

function pushBreak(out: Item[]) {
  const last = out[out.length - 1];
  if (last && last.text !== undefined) last.closed = true;
}

function walk(parent: ParentNode, out: Item[], textHidden: boolean, cursor: string) {
  for (const c of flat(parent)) {
    if (c.nodeType === 3) {
      if (!textHidden) pushText(out, c.textContent || '');
    } else if (c.nodeType === 1) {
      visit(c as Element, out, cursor);
    }
  }
}

function visit(el: Element, out: Item[], parentCursor: string) {
  if (pruned(el)) return;
  const cs = style(el);
  const selfHidden = cs.visibility !== 'visible';
  const role = selfHidden ? '' : roleOf(el, cs.cursor, parentCursor);
  const block = !INLINE.has(cs.display);
  if (!role) {
    if (block) pushBreak(out);
    walk(el, out, selfHidden, cs.cursor);
    if (block) pushBreak(out);
    return;
  }
  const n: Item = { role, name: nameOf(el, role), el, props: propsOf(el, role), kids: [] };
  if (VALUED.has(role) || el.localName === 'select') n.value = formValue(el);
  if (el.localName === 'select') {
    const all = Array.from((el as HTMLSelectElement).options);
    for (const o of all.slice(0, MAX_OPTIONS)) {
      n.kids.push({ role: 'option', name: clip(collapse(o.label || o.text), MAX_NAME), props: o.selected ? ['selected'] : [], kids: [] });
    }
    if (all.length > MAX_OPTIONS) n.kids.push({ role: '', name: '', text: `… ${all.length - MAX_OPTIONS} more options`, props: [], kids: [] });
  } else if (el.localName === 'iframe') {
    let doc: Document | null = null;
    try { doc = (el as HTMLIFrameElement).contentDocument; } catch { /* cross-origin */ }
    if (doc?.body) walk(doc.body, n.kids, false, '');
    else n.props.push('cross-origin');
  } else if (!(role === 'img' || el.localName === 'input' || el.localName === 'textarea')) {
    walk(el, n.kids, false, cs.cursor);
    // A cell holding controls is layout, not a label: its text stays as
    // children rather than becoming one long name over them.
    if (CELLS.has(role) && n.kids.some(actionable) && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) n.name = '';
    // A name computed from content already says what the children say; keep
    // only the ones an agent can still act on (a link inside a heading).
    if (NAME_FROM_CONTENT.has(role) && n.name) n.kids = n.kids.filter(actionable);
  }
  if (block) pushBreak(out);
  out.push(n);
  if (block) pushBreak(out);
}

function tidy(nodes: Item[]): Item[] {
  const out: Item[] = [];
  for (const n of nodes) {
    if (n.text !== undefined) {
      const t = collapse(n.text);
      if (t) out.push({ ...n, text: t });
      continue;
    }
    n.kids = tidy(n.kids);
    if (bare(n) && !n.kids.length && n.role !== 'separator') continue; // an empty row or list says nothing
    out.push(n);
  }
  return out;
}

/** A node that carries nothing of its own: no handle, name, value or state. */
function bare(n: Item): boolean {
  return !hasRef(n) && !n.name && n.value === undefined && n.props.length === 0;
}

function hasRef(n: Item): boolean {
  if (!n.el) return false;
  return INTERACTIVE.has(n.role) || (NAMED_REF.has(n.role) && (!!n.name || n.role === 'iframe'));
}

function compactOf(nodes: Item[]): Item[] {
  const out: Item[] = [];
  for (const n of nodes) {
    if (n.text !== undefined) { out.push(n); continue; }
    n.kids = compactOf(n.kids);
    if (bare(n) && n.kids.length <= 1) { out.push(...n.kids); continue; }
    out.push(n);
  }
  return out;
}

function flatInteractive(nodes: Item[], out: Item[] = []): Item[] {
  for (const n of nodes) {
    if (n.text === undefined && INTERACTIVE.has(n.role) && n.el) out.push({ ...n, kids: [] });
    flatInteractive(n.kids, out);
  }
  return out;
}

function line(n: Item, pad: string): string {
  if (n.text !== undefined) return `${pad}- text: ${clip(n.text, MAX_TEXT)}`;
  let s = `${pad}- ${n.role}`;
  if (n.name) s += ` ${JSON.stringify(n.name)}`;
  if (hasRef(n)) s += ` [ref=${refFor(n.el!)}]`;
  for (const p of n.props) s += ` [${p}]`;
  return s;
}

function render(nodes: Item[], level: number, opts: SnapshotOptions, lines: string[]) {
  const pad = '  '.repeat(level);
  const room = !opts.depth || level + 1 < opts.depth;
  for (const n of nodes) {
    let s = line(n, pad);
    let kids = n.kids;
    if (n.text === undefined) {
      // A <select> lists its options (the selected one marked) when there is
      // room for them, and states its value inline when there is not.
      if (n.value && (!kids.length || !room)) s += `: ${clip(collapse(n.value), MAX_TEXT)}`;
      else if (kids.length === 1 && kids[0].text !== undefined) { s += `: ${clip(kids[0].text!, MAX_TEXT)}`; kids = []; }
      const href = opts.urls && n.role === 'link' ? (n.el as HTMLAnchorElement).href : '';
      if (href || (kids.length && room)) s += ':';
      lines.push(s);
      if (href) lines.push(`${pad}  - /url: ${href}`);
      if (room) render(kids, level + 1, opts, lines);
    } else {
      lines.push(s);
    }
  }
}

function build(opts: SnapshotOptions): Item[] {
  let nodes: Item[] = [];
  if (opts.selector) {
    const root = resolve(opts.selector);
    const p = up(root);
    visit(root, nodes, p ? style(p).cursor : '');
  } else {
    const body = document.body ?? document.documentElement;
    walk(body, nodes, false, '');
  }
  nodes = tidy(nodes);
  return opts.compact ? compactOf(nodes) : nodes;
}

function sweep() {
  for (const [r, w] of refs) {
    const el = w.deref();
    if (!el || !live(el)) refs.delete(r);
  }
}

/** The accessibility tree as text, with a ref on every node an agent can act on. */
export function snapshot(opts: SnapshotOptions = {}): { tree: string; refs: number; last: number; url: string; title: string } {
  if (opts.base && opts.base > seq) seq = opts.base;
  sweep();
  let nodes = build(opts);
  if (opts.interactive) nodes = flatInteractive(nodes);
  const lines: string[] = [];
  render(nodes, 0, opts, lines);
  const count = lines.filter((l) => l.includes('[ref=')).length;
  return { tree: lines.join('\n') || '(empty: nothing rendered)', refs: count, last: seq, url: location.href, title: document.title };
}

// ─── acting ─────────────────────────────────────────────────────────────────

function describe(el: Element): string {
  const role = roleOf(el, '', '') || el.localName;
  const name = nameOf(el, role);
  const ref = ids.get(el);
  return `${ref ? `@${ref} ` : ''}(${role}${name ? ` ${JSON.stringify(clip(name, 60))}` : ''})`;
}

function tagOf(el: Element): string {
  let s = el.localName;
  if (el.id) s += `#${el.id}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  if (cls.length) s += `.${cls.join('.')}`;
  const txt = clip(textOf(el, 80), 60);
  return `<${s}>${txt ? ` ${JSON.stringify(txt)}` : ''}`;
}

function viewport(el: Element) {
  const w = el.ownerDocument.defaultView!;
  return { width: w.innerWidth, height: w.innerHeight };
}

function box(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  if (style(el).visibility !== 'visible') return null;
  return r;
}

function deepHit(root: Document | ShadowRoot, x: number, y: number): Element | null {
  let hit = root.elementFromPoint(x, y);
  while (hit) {
    const sr = shadowOf(hit);
    if (!sr) break;
    const inner = sr.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

function coveredError(el: Element, cover: Element | null, x: number, y: number): Error {
  const by = cover ? tagOf(cover) : 'nothing (the point is outside the page)';
  return new Error(
    `${describe(el)} is covered by ${by} at (${Math.round(x)}, ${Math.round(y)}). ` +
    'Dismiss or act on the covering element (a consent banner, modal or overlay), then run snapshot again before reusing refs.',
  );
}

/**
 * The point a click lands on, after proving it lands on `el`: scrolled into
 * view, inside the viewport, and not under another element — in its own
 * document and, for a same-origin frame, in every document above it.
 */
function aim(el: Element): { x: number; y: number; hit: Element } {
  if (!box(el)) throw new Error(`${describe(el)} is not visible (no box on screen). Run snapshot again; it may be collapsed or hidden.`);
  try {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
  } catch { /* scrollIntoView is best-effort; the hit test below decides */ }
  const r = el.getBoundingClientRect();
  const vp = viewport(el);
  const left = Math.max(r.left, 0);
  const right = Math.min(r.right, vp.width);
  const top = Math.max(r.top, 0);
  const bottom = Math.min(r.bottom, vp.height);
  if (right <= left || bottom <= top) throw new Error(`${describe(el)} is outside the viewport and could not be scrolled into it.`);
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  const hit = deepHit(el.ownerDocument, x, y);
  const control = hit?.closest('label') as HTMLLabelElement | null;
  if (!hit || !(contains(el, hit) || control?.control === el)) throw coveredError(el, hit, x, y);
  let doc = el.ownerDocument;
  let fx = x;
  let fy = y;
  while (doc !== document) {
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    if (!frame) break;
    const fr = frame.getBoundingClientRect();
    const fs = style(frame);
    fx += fr.left + frame.clientLeft + parseFloat(fs.paddingLeft || '0');
    fy += fr.top + frame.clientTop + parseFloat(fs.paddingTop || '0');
    const outer = deepHit(frame.ownerDocument, fx, fy);
    if (outer !== frame) throw coveredError(el, outer, fx, fy);
    doc = frame.ownerDocument;
  }
  return { x, y, hit };
}

function fire(target: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}): boolean {
  const win = target.ownerDocument.defaultView as any;
  const Ctor = type.startsWith('pointer') ? (win.PointerEvent ?? win.MouseEvent) : win.MouseEvent;
  const enter = type.endsWith('enter') || type.endsWith('leave');
  return target.dispatchEvent(new Ctor(type, {
    bubbles: !enter, cancelable: !enter, composed: true,
    clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 0, detail: 0,
    pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra,
  }));
}

function focusFrom(hit: Element) {
  for (let n: Element | null = hit; n; n = up(n)) {
    if (n.matches(FOCUSABLE) && !disabled(n)) {
      (n as HTMLElement).focus({ preventScroll: true });
      return;
    }
  }
  (hit.ownerDocument.activeElement as HTMLElement | null)?.blur?.();
}

function press1(hit: Element, x: number, y: number, detail: number) {
  fire(hit, 'pointerdown', x, y, { buttons: 1 });
  if (fire(hit, 'mousedown', x, y, { buttons: 1, detail })) focusFrom(hit);
  fire(hit, 'pointerup', x, y);
  fire(hit, 'mouseup', x, y, { detail });
  fire(hit, 'click', x, y, { detail });
}

function pointer(el: Element, kind: 'click' | 'dblclick' | 'hover') {
  if (kind !== 'hover' && disabled(el)) throw new Error(`${describe(el)} is disabled.`);
  const { x, y, hit } = aim(el);
  for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) fire(hit, t, x, y);
  if (kind === 'hover') return;
  press1(hit, x, y, 1);
  if (kind === 'dblclick') {
    press1(hit, x, y, 2);
    fire(hit, 'dblclick', x, y, { detail: 2 });
  }
}

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'color']);

function editable(el: Element): 'field' | 'rich' {
  const tag = el.localName;
  if (tag === 'textarea') return 'field';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (TEXT_INPUTS.has(t)) return 'field';
    const hint = t === 'checkbox' || t === 'radio' ? 'use check/uncheck' : t === 'file' ? 'use upload' : 'it takes no text';
    throw new Error(`${describe(el)} is an <input type=${t}>: ${hint}.`);
  }
  if (tag === 'select') throw new Error(`${describe(el)} is a <select>: use select with the option's value or label.`);
  if ((el as HTMLElement).isContentEditable) return 'rich';
  throw new Error(`${describe(el)} is not editable. Run snapshot and pick a textbox.`);
}

function writable(el: Element): 'field' | 'rich' {
  const kind = editable(el);
  if (disabled(el)) throw new Error(`${describe(el)} is disabled.`);
  if ((el as HTMLInputElement).readOnly) throw new Error(`${describe(el)} is read-only.`);
  return kind;
}

/** Set a field's value through the element prototype's own setter, so a framework's value tracking sees a change. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (set) set.call(el, v);
  else el.value = v;
}

function input(el: Element, inputType: string, data: string | null) {
  const win = el.ownerDocument.defaultView as any;
  el.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true, composed: true, inputType, data }));
}

function emit(el: Element, type: string) {
  el.dispatchEvent(new (el.ownerDocument.defaultView as any).Event(type, { bubbles: true }));
}

function caret(el: HTMLInputElement | HTMLTextAreaElement): [number, number] {
  try {
    const s = el.selectionStart;
    const e = el.selectionEnd;
    if (s !== null && e !== null) return [s, e];
  } catch { /* email/number inputs have no selection API */ }
  return [el.value.length, el.value.length];
}

function insert(el: Element, text: string) {
  if (editable(el) === 'rich') {
    const doc = el.ownerDocument;
    if (!doc.execCommand?.('insertText', false, text)) el.append(text);
  } else {
    const f = el as HTMLInputElement;
    const [s, e] = caret(f);
    setValue(f, f.value.slice(0, s) + text + f.value.slice(e));
    try { f.setSelectionRange(s + text.length, s + text.length); } catch { /* no selection API */ }
  }
  input(el, 'insertText', text);
}

function erase(el: Element, forward: boolean) {
  if (editable(el) !== 'field') return;
  const f = el as HTMLInputElement;
  let [s, e] = caret(f);
  if (s === e) {
    if (forward) e = Math.min(f.value.length, e + 1);
    else s = Math.max(0, s - 1);
  }
  setValue(f, f.value.slice(0, s) + f.value.slice(e));
  try { f.setSelectionRange(s, s); } catch { /* no selection API */ }
  input(el, forward ? 'deleteContentForward' : 'deleteContentBackward', null);
}

/** Focus a target the way clicking into it at the end of its text would. An already focused field keeps its caret. */
function enter(el: Element) {
  if (el.ownerDocument.activeElement === el) return;
  (el as HTMLElement).focus({ preventScroll: true });
  const f = el as HTMLInputElement;
  if (el.localName === 'input' || el.localName === 'textarea') {
    try { f.setSelectionRange(f.value.length, f.value.length); } catch { /* no selection API */ }
  }
}

function focused(): Element {
  let el: Element | null = document.activeElement;
  for (;;) {
    const inner = el ? (shadowOf(el)?.activeElement ?? null) : null;
    if (inner) { el = inner; continue; }
    if (el?.localName === 'iframe') {
      let doc: Document | null = null;
      try { doc = (el as HTMLIFrameElement).contentDocument; } catch { /* cross-origin */ }
      if (doc?.activeElement) { el = doc.activeElement; continue; }
    }
    break;
  }
  return el ?? document.body;
}

const KEYS: Record<string, string> = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: ' ',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown',
};
const MODS: Record<string, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'> = {
  control: 'ctrlKey', ctrl: 'ctrlKey', shift: 'shiftKey', alt: 'altKey', option: 'altKey',
  meta: 'metaKey', cmd: 'metaKey', command: 'metaKey',
};

function parseKey(combo: string): { key: string; mods: Record<string, boolean> } {
  const parts = combo.split('+').map((p) => p.trim());
  if (parts[parts.length - 1] === '' && parts.length > 1) { parts.pop(); parts[parts.length - 1] = '+'; }
  const mods: Record<string, boolean> = {};
  for (const p of parts.slice(0, -1)) {
    const m = MODS[p.toLowerCase()];
    if (!m) throw new Error(`Unknown modifier ${JSON.stringify(p)} in ${JSON.stringify(combo)}: use Control, Shift, Alt or Meta.`);
    mods[m] = true;
  }
  const last = parts[parts.length - 1];
  const key = KEYS[last.toLowerCase()] ?? (last.length === 1 ? last : last[0].toUpperCase() + last.slice(1));
  return { key, mods };
}

function codeOf(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return key === ' ' ? 'Space' : key;
}

function key(el: Element, type: string, k: string, mods: Record<string, boolean>): boolean {
  const win = el.ownerDocument.defaultView as any;
  return el.dispatchEvent(new win.KeyboardEvent(type, {
    key: k, code: codeOf(k), bubbles: true, cancelable: true, composed: true, ...mods,
  }));
}

function tabbables(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((e) => e.tabIndex >= 0 && !disabled(e) && !!box(e));
}

/** Roles a key activates: Enter follows links, Space toggles; both press buttons. */
const ON_ENTER = new Set(['button', 'link', 'tab', 'menuitem', 'option', 'clickable']);
const ON_SPACE = new Set(['button', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'clickable']);

function activate(el: Element, roles: Set<string>): boolean {
  if (!roles.has(roleOf(el, '', ''))) return false;
  (el as HTMLElement).click();
  return true;
}

/** A key press, with the default action a real keystroke would have taken. */
function press(el: Element, combo: string) {
  const { key: k, mods } = parseKey(combo);
  const chord = mods.ctrlKey || mods.metaKey || mods.altKey;
  const printable = k.length === 1 && !chord;
  if (key(el, 'keydown', k, mods)) {
    if (k === ' ' && el.localName !== 'input' && el.localName !== 'textarea' && activate(el, ON_SPACE)) {
      // Space pressed a button or toggled a checkbox.
    } else if (printable) {
      key(el, 'keypress', k, mods);
      if (el.localName === 'input' || el.localName === 'textarea' || (el as HTMLElement).isContentEditable) insert(el, k);
    } else if (k === 'Enter') {
      key(el, 'keypress', k, mods);
      if (el.localName === 'textarea') insert(el, '\n');
      else if (el.localName === 'input' && (el as HTMLInputElement).form) {
        const form = (el as HTMLInputElement).form!;
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      } else activate(el, ON_ENTER);
    } else if (k === 'Tab') {
      const list = tabbables(el.ownerDocument);
      const i = list.indexOf(el as HTMLElement);
      const next = list[(i + (mods.shiftKey ? -1 : 1) + list.length) % list.length];
      next?.focus();
    } else if (k === 'Backspace' || k === 'Delete') {
      erase(el, k === 'Delete');
    } else if ((mods.ctrlKey || mods.metaKey) && k.toLowerCase() === 'a' && editable(el) === 'field') {
      (el as HTMLInputElement).select();
    }
  }
  key(el, 'keyup', k, mods);
}

function selectOption(el: Element, want: string) {
  if (el.localName !== 'select') {
    throw new Error(`${describe(el)} is not a <select>. For a custom dropdown: click it open, snapshot, then click the option.`);
  }
  if (disabled(el)) throw new Error(`${describe(el)} is disabled.`);
  const s = el as HTMLSelectElement;
  const all = Array.from(s.options);
  const w = want.trim();
  const o = all.find((x) => x.value === want)
    ?? all.find((x) => collapse(x.label || x.text) === w)
    ?? all.find((x) => collapse(x.label || x.text).toLowerCase() === w.toLowerCase());
  if (!o) {
    const names = all.slice(0, MAX_OPTIONS).map((x) => JSON.stringify(collapse(x.label || x.text))).join(', ');
    throw new Error(`${describe(el)} has no option ${JSON.stringify(want)}. Options: ${names}${all.length > MAX_OPTIONS ? ', …' : ''}.`);
  }
  if (o.disabled) throw new Error(`Option ${JSON.stringify(collapse(o.label))} of ${describe(el)} is disabled.`);
  s.focus();
  o.selected = true;
  emit(s, 'input');
  emit(s, 'change');
  return { value: o.value, label: collapse(o.label || o.text) };
}

function check(el: Element, want: boolean) {
  const state = checkedOf(el);
  if (state === undefined) throw new Error(`${describe(el)} is not a checkbox, radio or switch.`);
  if (state === want) return { checked: want, changed: false };
  if (!want && el.localName === 'input' && (el as HTMLInputElement).type === 'radio') {
    throw new Error(`${describe(el)} is a radio: it unchecks when another option in its group is checked.`);
  }
  // A styled checkbox hides the native input behind its label; click what the user would.
  const label = el.localName === 'input' && !box(el) ? Array.from((el as HTMLInputElement).labels ?? []).find((l) => box(l)) : undefined;
  if (disabled(el)) throw new Error(`${describe(el)} is disabled.`);
  pointer(label ?? el, 'click');
  if (checkedOf(el) !== want) throw new Error(`Clicking ${describe(el)} did not ${want ? 'check' : 'uncheck'} it.`);
  return { checked: want, changed: true };
}

function textValue(el: Element): string {
  if (el.localName === 'input' || el.localName === 'textarea') return (el as HTMLInputElement).value;
  if (el.localName === 'select') return formValue(el) ?? '';
  const inner = (el as HTMLElement).innerText;
  return (typeof inner === 'string' ? inner : el.textContent || '').trim();
}

/** Perform one action on a ref or CSS selector. Throws with a message an agent can act on. */
export function act(req: ActRequest): Record<string, unknown> {
  const op = req.op;
  switch (op) {
    case 'click':
    case 'dblclick':
    case 'hover': {
      const el = resolve(req.selector);
      pointer(el, op);
      return { [op === 'hover' ? 'hovered' : 'clicked']: describe(el) };
    }
    case 'fill': {
      const el = resolve(req.selector);
      const kind = writable(el);
      const text = req.text ?? '';
      (el as HTMLElement).focus({ preventScroll: true });
      if (kind === 'rich') {
        el.textContent = text;
        input(el, 'insertText', text);
      } else {
        setValue(el as HTMLInputElement, text);
        input(el, 'insertText', text);
        emit(el, 'change');
      }
      return { filled: describe(el), value: kind === 'rich' ? text : (el as HTMLInputElement).value };
    }
    case 'type': {
      const el = req.selector ? resolve(req.selector) : focused();
      writable(el);
      if (req.selector) enter(el);
      for (const ch of req.text ?? '') {
        key(el, 'keydown', ch, {});
        key(el, 'keypress', ch, {});
        insert(el, ch);
        key(el, 'keyup', ch, {});
      }
      return { typed: describe(el), value: textValue(el) };
    }
    case 'press': {
      if (!req.key) throw new Error('key required: Enter, Tab, Escape, ArrowDown, Control+a …');
      const el = req.selector ? resolve(req.selector) : focused();
      if (req.selector) enter(el);
      press(el, req.key);
      return { pressed: req.key, on: describe(el) };
    }
    case 'focus': {
      const el = resolve(req.selector);
      (el as HTMLElement).focus({ preventScroll: true });
      return { focused: describe(el) };
    }
    case 'select':
      return { selected: selectOption(resolve(req.selector), req.value ?? req.text ?? '') };
    case 'check':
    case 'uncheck':
      return check(resolve(req.selector), op === 'check');
    case 'text':
      return { text: textValue(resolve(req.selector)) };
    case 'attribute': {
      if (!req.attribute) throw new Error('attribute required: the attribute name to read');
      return { value: resolve(req.selector).getAttribute(req.attribute) };
    }
    case 'scrollIntoView': {
      const el = resolve(req.selector);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      return { scrolled: describe(el) };
    }
    case 'scroll': {
      const target = req.selector ? resolve(req.selector) : (document.scrollingElement ?? document.documentElement);
      target.scrollBy({ left: req.dx ?? 0, top: req.dy ?? 0, behavior: 'instant' as ScrollBehavior });
      return { x: target.scrollLeft, y: target.scrollTop };
    }
    case 'count': {
      if (!req.selector) throw new Error('selector required: a CSS selector to count');
      return { count: document.querySelectorAll(req.selector).length };
    }
  }
  throw new Error(`Unknown page action ${JSON.stringify(op)}.`);
}

/** One poll of a wait condition. A missing element counts as hidden. */
export function probe(req: { selector?: string; text?: string; state?: string }): { met: boolean } {
  const hidden = req.state === 'hidden';
  if (req.text) {
    const body = document.body as HTMLElement | null;
    const inner = body?.innerText;
    const seen = (typeof inner === 'string' ? inner : body?.textContent || '').includes(req.text);
    return { met: seen !== hidden };
  }
  let el: Element | null = null;
  try {
    el = resolve(req.selector);
  } catch (e) {
    if (req.selector && isRef(req.selector) && !hidden) throw e;
  }
  const shown = !!el && !!box(el);
  return { met: shown !== hidden };
}

export interface Box { ref: string; label: string; x: number; y: number; w: number; h: number }

/**
 * Interactive refs on screen, in top-viewport CSS pixels, for an annotated
 * screenshot. Hands out refs exactly as snapshot({interactive}) would, so the
 * label [N] on the image is ref @eN everywhere else.
 */
export function boxes(base = 0): { boxes: Box[]; last: number; width: number; height: number } {
  if (base > seq) seq = base;
  sweep();
  const out: Box[] = [];
  for (const n of flatInteractive(build({}))) {
    const el = n.el!;
    const r = box(el);
    if (!r) continue;
    let x = r.left;
    let y = r.top;
    for (let doc = el.ownerDocument; doc !== document;) {
      const frame = doc.defaultView?.frameElement as HTMLElement | null;
      if (!frame) break;
      const fr = frame.getBoundingClientRect();
      x += fr.left + frame.clientLeft;
      y += fr.top + frame.clientTop;
      doc = frame.ownerDocument;
    }
    if (x + r.width <= 0 || y + r.height <= 0 || x >= innerWidth || y >= innerHeight) continue;
    out.push({ ref: refFor(el), label: `${n.role}${n.name ? ` ${JSON.stringify(clip(n.name, 60))}` : ''}`, x, y, w: r.width, h: r.height });
  }
  return { boxes: out, last: seq, width: innerWidth, height: innerHeight };
}
