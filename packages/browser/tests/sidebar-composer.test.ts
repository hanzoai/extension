import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

/**
 * The sidebar composer has ONE implementation: the markup in sidebar.html,
 * wired by sidebar.ts.
 *
 * A second React implementation (chat-widget.tsx) used to mount over it by
 * clearing `#chat-composer` and `#chat-login-prompt` and re-rendering. Because
 * sidebar.ts caches `#chat-input` / `#send-btn` / `#model-select` in
 * initializeUI() and binds its listeners to those nodes, the re-render left
 * every handle pointing at a detached node: the user typed into the live field
 * and the sidebar read the empty detached one, so Send fired zero times and the
 * model list reverted to five hardcoded ids over the catalog fetched from
 * `chat.listModels`.
 *
 * These are the two conditions that made that possible.
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

  it('declares exactly one composer, one field, one send control, one model select', () => {
    for (const id of ['chat-composer', 'chat-input', 'send-btn', 'model-select', 'chat-login-prompt']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1);
    }
  });

  it('gives every element a unique id, so a cached handle stays the live one', () => {
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('is named by sidebar.ts alone — no second module can render over it', () => {
    const owners = sources(SRC)
      .filter((path) => /chat-composer|chat-login-prompt|chat-input|send-btn/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(SRC.length + 1));
    expect(owners).toEqual(['sidebar.ts']);
  });

  it('offers no model the catalog did not supply — only the Auto router is written by hand', () => {
    for (const id of ['model-select', 'default-model']) {
      const options = [...document.querySelectorAll(`#${id} option`)].map((o) => o.getAttribute('value'));
      expect(options, id).toEqual(['auto']);
    }
  });
});
