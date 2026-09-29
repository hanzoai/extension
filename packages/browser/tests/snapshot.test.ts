// @vitest-environment jsdom
/**
 * The snapshot → ref engine (src/shared/snapshot.ts, src/shared/read.ts).
 *
 * jsdom has no layout, so the pointer tests lay the page out by hand: each
 * element gets a rect, and elementFromPoint answers with the topmost rect under
 * the point. That is exactly what the engine asks the browser, and the e2e
 * suite (e2e/snapshot-ref.spec.ts) runs the same flow against real layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, boxes, probe, snapshot } from '../src/shared/snapshot.js';
import { read } from '../src/shared/read.js';

type Rect = { x: number; y: number; w: number; h: number };

function page(html: string) {
  document.body.innerHTML = html;
}

function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`fixture has no ${sel}`);
  return el as HTMLElement;
}

/** The ref a snapshot line gave to the first node matching `pattern`. */
function ref(tree: string, pattern: RegExp): string {
  const line = tree.split('\n').find((l) => pattern.test(l));
  const m = line && /\[ref=(e\d+)\]/.exec(line);
  if (!m) throw new Error(`no ref for ${pattern} in:\n${tree}`);
  return `@${m[1]}`;
}

/**
 * Lay out `rects` (later entries paint on top) in `doc`, with elementFromPoint
 * answering the topmost element under a point.
 */
function layout(entries: Array<[Element, Rect]>, doc: Document | ShadowRoot = document) {
  for (const [el, r] of entries) {
    el.getBoundingClientRect = () => ({
      x: r.x, y: r.y, left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h, toJSON() {},
    }) as DOMRect;
  }
  (doc as any).elementFromPoint = (x: number, y: number) => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const [el, r] = entries[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return el;
    }
    return null;
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  delete (document as any).elementFromPoint;
  document.body.innerHTML = '';
});

describe('snapshot tree', () => {
  it('prints roles, names, props and refs in the aria-snapshot shape', () => {
    page(`
      <nav aria-label="Main"><ul><li><a href="/home">Home</a></li><li><a href="/docs">Docs</a></li></ul></nav>
      <h1>Example Domain</h1>
      <p>This domain is for use in <b>illustrative</b> examples.</p>
      <label for="email">Email</label><input id="email" value="me@x.com">
      <label><input type="checkbox" checked> Remember me</label>
      <button>Submit</button>
    `);
    const { tree, refs } = snapshot();
    expect(tree).toMatch(/^- navigation "Main" \[ref=e\d+\]:$/m);
    expect(tree).toMatch(/^ {2}- list:$/m);
    expect(tree).toMatch(/^ {4}- listitem:$/m);
    expect(tree).toMatch(/^ {6}- link "Home" \[ref=e\d+\]$/m);
    expect(tree).toMatch(/^- heading "Example Domain" \[ref=e\d+\] \[level=1\]$/m);
    expect(tree).toContain('- paragraph: This domain is for use in illustrative examples.');
    expect(tree).toMatch(/^- textbox "Email" \[ref=e\d+\]: me@x\.com$/m);
    expect(tree).toMatch(/^- checkbox "Remember me" \[ref=e\d+\] \[checked\]$/m);
    expect(tree).toMatch(/^- button "Submit" \[ref=e\d+\]$/m);
    expect(refs).toBe(7);
  });

  it('interactive lists only what can be acted on, flat', () => {
    page(`<h1>Title</h1><p>Words</p><div><div><button>Go</button></div></div><a href="#x">Link</a>`);
    const { tree } = snapshot({ interactive: true });
    expect(tree.split('\n')).toEqual([
      expect.stringMatching(/^- button "Go" \[ref=e\d+\]$/),
      expect.stringMatching(/^- link "Link" \[ref=e\d+\]$/),
    ]);
  });

  it('compact drops empty structure and unwraps single-child wrappers', () => {
    page(`<ul><li></li></ul><section aria-label="S"><ul><li><button>Only</button></li></ul></section>`);
    const full = snapshot().tree;
    const compact = snapshot({ compact: true }).tree;
    expect(full).toContain('- list');
    expect(compact).not.toMatch(/^- list:?$/m);
    expect(compact).toMatch(/^- region "S" \[ref=e\d+\]:\n {2}- button "Only" \[ref=e\d+\]$/m);
  });

  it('depth limits the tree', () => {
    page(`<nav aria-label="N"><ul><li><a href="/a">A</a></li></ul></nav>`);
    const { tree } = snapshot({ depth: 1 });
    expect(tree).toMatch(/^- navigation "N" \[ref=e\d+\]$/);
    expect(tree).not.toContain('link');
  });

  it('scopes to a CSS selector or a ref', () => {
    page(`<form aria-label="Login"><input aria-label="User"></form><button>Outside</button>`);
    expect(snapshot({ selector: 'form' }).tree).not.toContain('Outside');
    const r = ref(snapshot().tree, /form "Login"/);
    const scoped = snapshot({ selector: r }).tree;
    expect(scoped).toContain('textbox "User"');
    expect(scoped).not.toContain('Outside');
  });

  it('prints link urls on request', () => {
    page(`<a href="/docs">Docs</a>`);
    expect(snapshot({ urls: true }).tree).toMatch(/- link "Docs" \[ref=e\d+\]:\n {2}- \/url: http:\/\/localhost(:\d+)?\/docs/);
  });

  it('names from aria-labelledby, aria-label, placeholder and alt', () => {
    page(`
      <span id="l1">Search the site</span><input aria-labelledby="l1">
      <button aria-label="Close dialog">×</button>
      <input placeholder="Your name">
      <a href="/"><img src="/logo.png" alt="Company logo"></a>
    `);
    const { tree } = snapshot();
    expect(tree).toContain('textbox "Search the site"');
    expect(tree).toContain('button "Close dialog"');
    expect(tree).toContain('textbox "Your name"');
    expect(tree).toContain('link "Company logo"');
  });

  it('names an icon-only control by the tooltip inside it', () => {
    page(`<a href="/vote"><div class="arrow" title="upvote"></div></a>`);
    expect(snapshot().tree).toMatch(/^- link "upvote" \[ref=e\d+\]$/m);
  });

  it('shows a select as a combobox with its options, the chosen one marked', () => {
    page(`<label>Color <select><option value="r">Red</option><option value="g" selected>Green</option></select></label>`);
    const { tree } = snapshot();
    expect(tree).toMatch(/- combobox "Color" \[ref=e\d+\]:\n {2}- option "Red"\n {2}- option "Green" \[selected\]/);
    expect(snapshot({ interactive: true }).tree).toMatch(/- combobox "Color" \[ref=e\d+\]: Green/);
  });

  it('marks a bare element that takes clicks as clickable', () => {
    page(`<div style="cursor:pointer"><span>Open card</span></div><div tabindex="0">Focusable</div><div>Plain</div>`);
    const { tree } = snapshot({ interactive: true });
    expect(tree).toMatch(/- clickable "Open card" \[ref=e\d+\]/);
    expect(tree).toMatch(/- clickable "Focusable" \[ref=e\d+\]/);
    expect(tree).not.toContain('Plain');
  });

  it('lets the controls inside a pointer-cursor wrapper stand on their own', () => {
    page(`<div style="cursor:pointer">Repo files <button>Code</button> <a href="/t">Tags</a></div>`);
    const { tree } = snapshot();
    expect(tree).not.toContain('clickable');
    expect(tree).toMatch(/^- text: Repo files\n- button "Code" \[ref=e\d+\]\n- link "Tags" \[ref=e\d+\]$/m);
  });

  it('omits what is not rendered, keeps visible children of visibility:hidden', () => {
    page(`
      <div style="display:none"><button>Gone1</button></div>
      <button hidden>Gone2</button>
      <div aria-hidden="true"><button>Gone3</button></div>
      <div style="visibility:hidden">Ghost<button style="visibility:visible">Shown</button></div>
      <div id="hanzo-page-overlay-root"><button>Ours</button></div>
    `);
    const { tree } = snapshot();
    for (const gone of ['Gone1', 'Gone2', 'Gone3', 'Ghost', 'Ours']) expect(tree).not.toContain(gone);
    expect(tree).toContain('button "Shown"');
  });

  it('names data cells, not layout cells holding controls, and drops empty rows', () => {
    page(`<table><tr><td>Price</td><td>$20</td></tr><tr></tr><tr><td>See <a href="/pro">Pro plan</a> details</td></tr></table>`);
    const { tree } = snapshot();
    expect(tree).toMatch(/- cell "Price" \[ref=e\d+\]\n {4}- cell "\$20" \[ref=e\d+\]/);
    expect(tree).toMatch(/- cell:\n {6}- text: See\n {6}- link "Pro plan" \[ref=e\d+\]\n {6}- text: details/);
    expect(tree.match(/- row/g)).toHaveLength(2);
  });

  it('marks disabled controls', () => {
    page(`<button disabled>Save</button><fieldset disabled><input aria-label="In"></fieldset>`);
    const { tree } = snapshot();
    expect(tree).toMatch(/button "Save" \[ref=e\d+\] \[disabled\]/);
    expect(tree).toMatch(/textbox "In" \[ref=e\d+\] \[disabled\]/);
  });
});

describe('refs', () => {
  it('keep naming the same element across snapshots', () => {
    page(`<button>A</button><button>B</button>`);
    const first = snapshot().tree;
    document.body.insertAdjacentHTML('afterbegin', '<button>New</button>');
    const second = snapshot().tree;
    expect(ref(second, /"A"/)).toBe(ref(first, /"A"/));
    expect(ref(second, /"B"/)).toBe(ref(first, /"B"/));
    expect(ref(second, /"New"/)).not.toBe(ref(first, /"A"/));
  });

  it('refuse an element that left the page', () => {
    page(`<button id="b">Gone soon</button>`);
    const r = ref(snapshot().tree, /Gone soon/);
    $('#b').remove();
    expect(() => act({ op: 'click', selector: r })).toThrow(/Stale ref .*Run snapshot again/);
  });

  it('refuse a ref this document never handed out', () => {
    page(`<button>X</button>`);
    snapshot();
    expect(() => act({ op: 'click', selector: '@e999999' })).toThrow(/Unknown ref @e999999.*Run snapshot again/);
  });

  it('continue past a base, so a new document never reuses an old one\'s refs', () => {
    page(`<button>X</button>`);
    const { tree, last } = snapshot({ base: 5000 });
    expect(ref(tree, /"X"/)).toBe('@e5001');
    expect(last).toBe(5001);
  });

  it('accept a bare e-number and CSS selectors alike', () => {
    page(`<input id="q" aria-label="Q">`);
    const r = ref(snapshot().tree, /"Q"/).slice(1);
    act({ op: 'fill', selector: r, text: 'one' });
    expect(($('#q') as HTMLInputElement).value).toBe('one');
    act({ op: 'fill', selector: '#q', text: 'two' });
    expect(($('#q') as HTMLInputElement).value).toBe('two');
    expect(() => act({ op: 'fill', selector: '#nope', text: 'x' })).toThrow(/No element matches "#nope"/);
    expect(() => act({ op: 'fill', selector: '[[', text: 'x' })).toThrow(/Invalid selector/);
  });
});

describe('click', () => {
  it('lands on the target and fires the pointer sequence', () => {
    page(`<button id="b"><span id="s">Buy</span></button>`);
    layout([[$('body'), { x: 0, y: 0, w: 800, h: 600 }], [$('#b'), { x: 10, y: 10, w: 100, h: 30 }], [$('#s'), { x: 20, y: 15, w: 60, h: 20 }]]);
    const seen: string[] = [];
    for (const t of ['mousedown', 'mouseup', 'click']) $('#b').addEventListener(t, (e) => seen.push(`${t}:${(e.target as Element).id}`));
    const r = ref(snapshot().tree, /"Buy"/);
    expect(act({ op: 'click', selector: r })).toEqual({ clicked: `${r} (button "Buy")` });
    expect(seen).toEqual(['mousedown:s', 'mouseup:s', 'click:s']);
  });

  it('fails early and names the element covering the target', () => {
    page(`<button id="b">Subscribe</button><div id="consent" class="banner modal">We use cookies <button id="ok">Accept</button></div>`);
    const clicked = vi.fn();
    $('#b').addEventListener('click', clicked);
    layout([[$('body'), { x: 0, y: 0, w: 800, h: 600 }], [$('#b'), { x: 10, y: 10, w: 100, h: 30 }], [$('#consent'), { x: 0, y: 0, w: 800, h: 200 }], [$('#ok'), { x: 300, y: 150, w: 80, h: 30 }]]);
    const tree = snapshot().tree;
    expect(() => act({ op: 'click', selector: ref(tree, /"Subscribe"/) }))
      .toThrow(/is covered by <div#consent\.banner\.modal> "We use cookies Accept" at \(60, 25\)\. .*run snapshot again/);
    expect(clicked).not.toHaveBeenCalled();
    $('#ok').addEventListener('click', () => $('#consent').remove());
    act({ op: 'click', selector: ref(tree, /"Accept"/) });
    layout([[$('body'), { x: 0, y: 0, w: 800, h: 600 }], [$('#b'), { x: 10, y: 10, w: 100, h: 30 }]]);
    act({ op: 'click', selector: ref(snapshot().tree, /"Subscribe"/) });
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('refuses disabled and invisible targets', () => {
    page(`<button id="d" disabled>Off</button><button id="z">Zero</button>`);
    layout([[$('#d'), { x: 0, y: 0, w: 50, h: 20 }]]);
    const tree = snapshot().tree;
    expect(() => act({ op: 'click', selector: ref(tree, /"Off"/) })).toThrow(/is disabled/);
    expect(() => act({ op: 'click', selector: ref(tree, /"Zero"/) })).toThrow(/is not visible/);
  });

  it('dblclick and hover fire their events', () => {
    page(`<div id="t" tabindex="0">Target</div>`);
    layout([[$('#t'), { x: 0, y: 0, w: 50, h: 20 }]]);
    const seen: string[] = [];
    for (const t of ['mouseover', 'click', 'dblclick']) $('#t').addEventListener(t, () => seen.push(t));
    act({ op: 'hover', selector: '#t' });
    expect(seen).toEqual(['mouseover']);
    act({ op: 'dblclick', selector: '#t' });
    expect(seen).toEqual(['mouseover', 'mouseover', 'click', 'click', 'dblclick']);
  });
});

describe('forms', () => {
  it('fill sets the value and fires input and change', () => {
    page(`<input id="e" aria-label="Email">`);
    const events: string[] = [];
    for (const t of ['input', 'change']) $('#e').addEventListener(t, () => events.push(t));
    act({ op: 'fill', selector: '#e', text: 'a@b.co' });
    expect(($('#e') as HTMLInputElement).value).toBe('a@b.co');
    expect(events).toEqual(['input', 'change']);
    expect(document.activeElement).toBe($('#e'));
  });

  it('fill refuses what takes no text', () => {
    page(`<input id="c" type="checkbox"><select id="s"><option>a</option></select><p id="p">x</p><input id="r" readonly>`);
    expect(() => act({ op: 'fill', selector: '#c', text: 'x' })).toThrow(/type=checkbox.*use check\/uncheck/);
    expect(() => act({ op: 'fill', selector: '#s', text: 'x' })).toThrow(/is a <select>: use select/);
    expect(() => act({ op: 'fill', selector: '#p', text: 'x' })).toThrow(/is not editable/);
    expect(() => act({ op: 'fill', selector: '#r', text: 'x' })).toThrow(/is read-only/);
  });

  it('type appends key by key into the focused field', () => {
    page(`<textarea id="t">ab</textarea>`);
    const keys: string[] = [];
    $('#t').addEventListener('keydown', (e) => keys.push((e as KeyboardEvent).key));
    $('#t').focus();
    ($('#t') as HTMLTextAreaElement).setSelectionRange(2, 2);
    expect(act({ op: 'type', text: 'cd' })).toMatchObject({ value: 'abcd' });
    expect(keys).toEqual(['c', 'd']);
  });

  it('press Enter submits the form, Tab moves focus, Backspace deletes', () => {
    page(`<form id="f"><input id="a" value="xy"><input id="b"></form>`);
    layout([[$('#a'), { x: 0, y: 0, w: 50, h: 20 }], [$('#b'), { x: 0, y: 30, w: 50, h: 20 }]]);
    const submit = vi.fn((e: Event) => e.preventDefault());
    $('#f').addEventListener('submit', submit);
    act({ op: 'press', selector: '#a', key: 'Backspace' });
    expect(($('#a') as HTMLInputElement).value).toBe('x');
    act({ op: 'press', key: 'Tab' });
    expect(document.activeElement).toBe($('#b'));
    act({ op: 'press', key: 'Enter' });
    expect(submit).toHaveBeenCalledOnce();
    expect(() => act({ op: 'press', key: 'Hyper+x' })).toThrow(/Unknown modifier "Hyper"/);
  });

  it('press lets the page cancel the default action', () => {
    page(`<form id="f"><input id="a"></form>`);
    const submit = vi.fn((e: Event) => e.preventDefault());
    $('#f').addEventListener('submit', submit);
    $('#a').addEventListener('keydown', (e) => e.preventDefault());
    act({ op: 'press', selector: '#a', key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('select picks an option by value or label and names the choices when neither matches', () => {
    page(`<select id="s"><option value="r">Red</option><option value="g">Green</option></select>`);
    const change = vi.fn();
    $('#s').addEventListener('change', change);
    expect(act({ op: 'select', selector: '#s', value: 'g' })).toEqual({ selected: { value: 'g', label: 'Green' } });
    expect(act({ op: 'select', selector: '#s', value: 'red' })).toEqual({ selected: { value: 'r', label: 'Red' } });
    expect(change).toHaveBeenCalledTimes(2);
    expect(() => act({ op: 'select', selector: '#s', value: 'Blue' })).toThrow(/has no option "Blue"\. Options: "Red", "Green"/);
    page(`<div id="d" role="listbox">x</div>`);
    expect(() => act({ op: 'select', selector: '#d', value: 'x' })).toThrow(/not a <select>/);
  });

  it('check and uncheck converge on the asked state', () => {
    page(`<input id="c" type="checkbox"><input id="r" type="radio" name="g" checked>`);
    layout([[$('#c'), { x: 0, y: 0, w: 20, h: 20 }], [$('#r'), { x: 0, y: 30, w: 20, h: 20 }]]);
    expect(act({ op: 'check', selector: '#c' })).toEqual({ checked: true, changed: true });
    expect(act({ op: 'check', selector: '#c' })).toEqual({ checked: true, changed: false });
    expect(act({ op: 'uncheck', selector: '#c' })).toEqual({ checked: false, changed: true });
    expect(() => act({ op: 'uncheck', selector: '#r' })).toThrow(/is a radio/);
  });

  it('check clicks the label of a visually hidden checkbox', () => {
    page(`<input id="c" type="checkbox" style="opacity:0"><label id="l" for="c">Agree</label>`);
    layout([[$('#l'), { x: 0, y: 0, w: 80, h: 20 }]]);
    expect(act({ op: 'check', selector: '#c' })).toEqual({ checked: true, changed: true });
    expect(($('#c') as HTMLInputElement).checked).toBe(true);
  });

  it('reads text, values and attributes', () => {
    page(`<p id="p">  Hello <b>there</b> </p><input id="i" value="v" data-x="1">`);
    expect(act({ op: 'text', selector: '#p' })).toEqual({ text: 'Hello there' });
    expect(act({ op: 'text', selector: '#i' })).toEqual({ text: 'v' });
    expect(act({ op: 'attribute', selector: '#i', attribute: 'data-x' })).toEqual({ value: '1' });
    expect(act({ op: 'count', selector: 'input,p' })).toEqual({ count: 2 });
  });
});

describe('frames and shadow roots', () => {
  it('walks into a same-origin iframe and clicks inside it', () => {
    page(`<iframe id="f" title="Checkout"></iframe>`);
    const frame = $('#f') as HTMLIFrameElement;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = `<button id="pay">Pay now</button>`;
    const tree = snapshot().tree;
    expect(tree).toMatch(/^- iframe "Checkout" \[ref=e\d+\]:\n {2}- button "Pay now" \[ref=e\d+\]$/m);
    const pay = doc.getElementById('pay')!;
    const clicked = vi.fn();
    pay.addEventListener('click', clicked);
    layout([[pay, { x: 5, y: 5, w: 60, h: 20 }]], doc);
    layout([[frame, { x: 100, y: 100, w: 300, h: 200 }]]);
    act({ op: 'click', selector: ref(tree, /"Pay now"/) });
    expect(clicked).toHaveBeenCalledOnce();
    // The frame itself covered in the top document: named, not clicked.
    const cover = document.createElement('div');
    cover.id = 'veil';
    document.body.append(cover);
    layout([[frame, { x: 100, y: 100, w: 300, h: 200 }], [cover, { x: 0, y: 0, w: 800, h: 600 }]]);
    expect(() => act({ op: 'click', selector: ref(tree, /"Pay now"/) })).toThrow(/covered by <div#veil>/);
    delete (doc as any).elementFromPoint;
  });

  it('reads open shadow roots in rendered order, slots filled', () => {
    page(`<x-card id="host"><span slot="title">Plan</span></x-card>`);
    const host = $('#host');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<h2><slot name="title"></slot></h2><button id="inner">Choose</button>`;
    const tree = snapshot().tree;
    expect(tree).toMatch(/- heading "Plan" \[ref=e\d+\] \[level=2\]\n- button "Choose" \[ref=e\d+\]/);
    const inner = root.getElementById('inner')!;
    const clicked = vi.fn();
    inner.addEventListener('click', clicked);
    layout([[host, { x: 0, y: 0, w: 200, h: 100 }], [inner, { x: 10, y: 50, w: 60, h: 20 }]]);
    layout([[inner, { x: 10, y: 50, w: 60, h: 20 }]], root);
    act({ op: 'click', selector: ref(tree, /"Choose"/) });
    expect(clicked).toHaveBeenCalledOnce();
    delete (root as any).elementFromPoint;
  });
});

describe('probe and boxes', () => {
  it('probe answers visible/hidden for selectors, refs and text', () => {
    page(`<div id="spin">Loading…</div>`);
    layout([[$('#spin'), { x: 0, y: 0, w: 50, h: 20 }]]);
    expect(probe({ selector: '#spin' })).toEqual({ met: true });
    expect(probe({ selector: '#spin', state: 'hidden' })).toEqual({ met: false });
    expect(probe({ selector: '#missing', state: 'hidden' })).toEqual({ met: true });
    expect(probe({ text: 'Loading' })).toEqual({ met: true });
    expect(probe({ text: 'Done' })).toEqual({ met: false });
    expect(() => probe({ selector: '@e999999' })).toThrow(/Unknown ref/);
  });

  it('boxes lists on-screen interactive refs with their labels', () => {
    page(`<button id="a">In view</button><button id="b">Below</button><p>text</p>`);
    layout([[$('#a'), { x: 10, y: 10, w: 80, h: 20 }], [$('#b'), { x: 10, y: 5000, w: 80, h: 20 }]]);
    const { boxes: list, width, height } = boxes();
    expect(width).toBe(window.innerWidth);
    expect(height).toBe(window.innerHeight);
    expect(list).toEqual([{ ref: expect.stringMatching(/^e\d+$/), label: 'button "In view"', x: 10, y: 10, w: 80, h: 20 }]);
    expect(snapshot().tree).toContain(`[ref=${list[0].ref}]`);
  });
});

describe('read', () => {
  const html = `
    <header><nav><a href="/">Home</a></nav></header>
    <main>
      <h1>Pricing</h1>
      <p>Plans for   every
         team, billed <strong>monthly</strong>.</p>
      <h2>Pro</h2>
      <ul><li>Unlimited seats<ul><li>SSO included</li></ul></li><li>Priority support</li></ul>
      <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$20</td></tr></table>
      <pre>npm i hanzo
hanzo login</pre>
      <h2>FAQ</h2>
      <p>See <a href="https://hanzo.ai/faq">the FAQ</a> or use <code>hanzo help</code>.</p>
      <div style="display:none">secret</div>
    </main>`;

  it('renders the page as markdown', () => {
    page(html);
    const { markdown, title, url, truncated } = read();
    expect(title).toBe(document.title);
    expect(url).toBe(location.href);
    expect(truncated).toBe(false);
    expect(markdown).toContain('[Home](http://localhost');
    expect(markdown).toContain('# Pricing\n\nPlans for every team, billed **monthly**.');
    expect(markdown).toContain('- Unlimited seats\n  - SSO included\n- Priority support');
    expect(markdown).toContain('| Plan | Price |\n| --- | --- |\n| Pro | $20 |');
    expect(markdown).toContain('```\nnpm i hanzo\nhanzo login\n```');
    expect(markdown).toContain('See [the FAQ](https://hanzo.ai/faq) or use `hanzo help`.');
    expect(markdown).not.toContain('secret');
  });

  it('outline keeps headings; filter keeps matching sections', () => {
    page(html);
    expect(read({ outline: true }).markdown).toBe('# Pricing\n## Pro\n## FAQ');
    const faq = read({ filter: 'faq' }).markdown;
    expect(faq.startsWith('## FAQ')).toBe(true);
    expect(faq).not.toContain('Unlimited');
    expect(read({ filter: 'nothing-here' }).markdown).toBe('(no section mentions "nothing-here")');
    expect(read({ outline: true, filter: 'pro' }).markdown).toBe('## Pro');
  });

  it('outline skips # lines inside code', () => {
    page(`<h1>Install</h1><pre># comment in a shell block\nnpm i</pre><h2>Use</h2>`);
    expect(read({ outline: true }).markdown).toBe('# Install\n## Use');
  });
});
