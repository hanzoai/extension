import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

/**
 * The sidebar composer has ONE implementation, and it is `@hanzo/ui/chat`.
 *
 * A second React implementation (chat-widget.tsx) used to mount over hand-written
 * markup in sidebar.html by clearing `#chat-composer` and `#chat-login-prompt`
 * and re-rendering. Because sidebar.ts cached `#chat-input` / `#send-btn` /
 * `#model-select` in initializeUI() and bound its listeners to those nodes, the
 * re-render left every handle pointing at a detached node: the user typed into
 * the live field and the sidebar read the empty detached one, so Send fired zero
 * times and the model list reverted to five hardcoded ids over the catalog.
 *
 * WHAT THESE ASSERTIONS NOW SAY, AND WHY THEY CHANGED. They used to require the
 * markup to declare exactly one of each control — the best available guarantee
 * while the composer WAS markup. It no longer is: chat is the shared shell,
 * mounted at a single node, and sidebar.html declares no chat control at all.
 * So the same invariant is asserted at its stronger end — there is nothing for
 * a second implementation to render over, because there is no first one in the
 * markup — and the old ids would now pass by being absent, which asserts
 * nothing. Everything the shell owns (the field, Enter, send/stop) is asserted
 * in @hanzo/ui; what stays here is that this page keeps no copy of it.
 */

const SRC = join(__dirname, '..', 'src');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('the sidebar composer is singular', () => {
  const html = readFileSync(join(SRC, 'sidebar.html'), 'utf8');
  const { document } = new JSDOM(html).window;

  it('declares one mount node for chat and nothing else inside the tab', () => {
    expect(document.querySelectorAll('#chat')).toHaveLength(1);
    const tab = document.getElementById('tab-chat')!;
    expect([...tab.children].map((el) => el.id)).toEqual(['chat']);
    expect(document.getElementById('chat')!.children).toHaveLength(0);
  });

  it('writes no composer of its own — no field, no send control, no picker', () => {
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    for (const id of ['chat-composer', 'chat-input', 'send-btn', 'model-select', 'chat-login-prompt']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(0);
    }
  });

  it('gives every element a unique id, so a cached handle stays the live one', () => {
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('is mounted by sidebar.ts alone — no second module can render over it', () => {
    const owners = sources(SRC)
      .filter((path) => /getElementById\('chat'\)/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));
    expect(owners).toEqual(['sidebar.ts']);
  });

  it('offers no model the catalog did not supply — Auto is written in one place', () => {
    // Neither picker is markup: the chat one is ModelSelector, the Settings one
    // is filled by setModels(). A hand-written <option> here would be a model
    // offered without the account having been asked for it.
    expect(document.querySelectorAll('select option')).toHaveLength(0);
    const ts = readFileSync(join(SRC, 'sidebar.ts'), 'utf8');
    expect(ts.match(/id: 'auto'/g)).toHaveLength(1);
  });
});
