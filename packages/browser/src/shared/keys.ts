/**
 * Keys: the one table every key press is built from.
 *
 * A press names a key the way KeyboardEvent.key does ("Enter", "a", ","),
 * optionally chorded ("Control+a"). A page reads more than `key`: Angular,
 * Material and most older handlers switch on the legacy `keyCode` / `which`
 * (MatChipInput commits a chip on keyCode 13 or 188, never on `key`). An event
 * built without them carries 0, and those handlers ignore it.
 *
 * The page engine (snapshot.ts), the scripted press (script.ts) and the CDP
 * press (browser-dispatch.ts) all read this module, so they cannot disagree on
 * what Enter is.
 */

export type Mods = Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>>;

/** Legacy numeric fields of one KeyboardEvent. */
export interface Legacy { keyCode: number; which: number; charCode: number }

const table = <V>(o: Record<string, V>) => new Map(Object.entries(o));

const NAMES = table({
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: ' ',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown',
  left: 'ArrowLeft', right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', comma: ',',
});

const MODS = table<keyof Mods>({
  control: 'ctrlKey', ctrl: 'ctrlKey', shift: 'shiftKey', alt: 'altKey', option: 'altKey',
  meta: 'metaKey', cmd: 'metaKey', command: 'metaKey',
});

/** Windows virtual-key codes: what Chromium reports as keyCode on keydown and keyup (US layout). */
const CODES = table({
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, CapsLock: 20, Escape: 27, ' ': 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46, Meta: 91, ContextMenu: 93,
  ')': 48, '!': 49, '@': 50, '#': 51, '$': 52, '%': 53, '^': 54, '&': 55, '*': 56, '(': 57,
  ';': 186, ':': 186, '=': 187, '+': 187, ',': 188, '<': 188, '-': 189, '_': 189, '.': 190, '>': 190,
  '/': 191, '?': 191, '`': 192, '~': 192, '[': 219, '{': 219, '\\': 220, '|': 220, ']': 221, '}': 221,
  "'": 222, '"': 222,
});

/** KeyboardEvent.code of the unshifted punctuation keys. */
const PHYSICAL = table({
  ' ': 'Space', ',': 'Comma', '.': 'Period', ';': 'Semicolon', '=': 'Equal', '-': 'Minus', '/': 'Slash',
  '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', "'": 'Quote',
});

/**
 * "Control+Shift+a" → key "a" with ctrlKey and shiftKey; "Control++" is the
 * plus key. `modifiers` adds to the chord: CDP's bitmask (Alt 1, Ctrl 2,
 * Meta 4, Shift 8) or {ctrl, shift, alt, meta}.
 */
export function parseKey(combo: string, modifiers?: unknown): { key: string; mods: Mods } {
  const parts = combo.split('+').map((p) => p.trim());
  if (parts[parts.length - 1] === '' && parts.length > 1) { parts.pop(); parts[parts.length - 1] = '+'; }
  const mods: Mods = {};
  for (const p of parts.slice(0, -1)) {
    const m = MODS.get(p.toLowerCase());
    if (!m) throw new Error(`Unknown modifier ${JSON.stringify(p)} in ${JSON.stringify(combo)}: use Control, Shift, Alt or Meta.`);
    mods[m] = true;
  }
  // CDP's bitmask (a number, or its decimal string off the ZAP wire), or {ctrl, shift, alt, meta}.
  const n = typeof modifiers === 'number' || (typeof modifiers === 'string' && /^\d+$/.test(modifiers)) ? Number(modifiers) : 0;
  const extra: any = modifiers && typeof modifiers === 'object' ? modifiers : {};
  if (n & 1 || extra.alt) mods.altKey = true;
  if (n & 2 || extra.ctrl) mods.ctrlKey = true;
  if (n & 4 || extra.meta) mods.metaKey = true;
  if (n & 8 || extra.shift) mods.shiftKey = true;
  const last = parts[parts.length - 1];
  if (!last) throw new Error('key required: Enter, Tab, Escape, ArrowDown, Control+a …');
  const key = NAMES.get(last.toLowerCase()) ?? (last.length === 1 ? last : last[0].toUpperCase() + last.slice(1));
  return { key, mods };
}

/** KeyboardEvent.code for a key. */
export function codeOf(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return PHYSICAL.get(key) ?? key;
}

/** keyCode on keydown/keyup: the virtual-key code, 0 for a key the table does not know. */
export function keyCode(key: string): number {
  const known = CODES.get(key);
  if (known !== undefined) return known;
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const f = /^F([1-9]|1\d|2[0-4])$/.exec(key);
  return f ? 111 + Number(f[1]) : 0;
}

/** CDP's Input modifier bitmask: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function bits(m: Mods): number {
  return (m.altKey ? 1 : 0) | (m.ctrlKey ? 2 : 0) | (m.metaKey ? 4 : 0) | (m.shiftKey ? 8 : 0);
}

/** The text a key types, which is also whether it fires keypress: Enter types "\r"; a chord types nothing. */
export function text(key: string, mods: Mods): string | undefined {
  if (key === 'Enter') return '\r';
  return key.length === 1 && !mods.ctrlKey && !mods.metaKey && !mods.altKey ? key : undefined;
}

/**
 * keyCode / which / charCode as Chromium sets them for a real keystroke:
 * keydown and keyup carry the virtual-key code and no charCode; keypress
 * carries the character's code in all three.
 */
export function legacy(type: string, key: string): Legacy {
  if (type === 'keypress') {
    const c = key === 'Enter' ? 13 : key.length === 1 ? key.charCodeAt(0) : 0;
    return { keyCode: c, which: c, charCode: c };
  }
  const c = keyCode(key);
  return { keyCode: c, which: c, charCode: 0 };
}
