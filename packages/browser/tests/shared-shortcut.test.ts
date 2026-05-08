import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSPECT_SHORTCUT,
  formatShortcut,
  loadInspectShortcut,
  matchesShortcut,
  saveInspectShortcut,
  shortcutFromEvent,
  STORAGE_KEY_INSPECT,
  type Shortcut,
} from '../src/shared/shortcut.js';

describe('DEFAULT_INSPECT_SHORTCUT', () => {
  it('is Ctrl alone (not Alt — Alt collides with macOS character compose)', () => {
    expect(DEFAULT_INSPECT_SHORTCUT.ctrl).toBe(true);
    expect(DEFAULT_INSPECT_SHORTCUT.alt).toBe(false);
    expect(DEFAULT_INSPECT_SHORTCUT.meta).toBe(false);
    expect(DEFAULT_INSPECT_SHORTCUT.shift).toBe(false);
    expect(DEFAULT_INSPECT_SHORTCUT.key).toBe('');
  });
});

describe('matchesShortcut', () => {
  const ctrl: Shortcut = { ctrl: true, alt: false, meta: false, shift: false, key: '' };
  const alt: Shortcut = { ctrl: false, alt: true, meta: false, shift: false, key: '' };
  const ctrlShiftK: Shortcut = { ctrl: true, alt: false, meta: false, shift: true, key: 'k' };

  it('matches Ctrl-only when only ctrlKey is set', () => {
    expect(matchesShortcut({ ctrlKey: true }, ctrl)).toBe(true);
  });

  it('does NOT match Ctrl-only when ctrlKey is unset', () => {
    expect(matchesShortcut({}, ctrl)).toBe(false);
    expect(matchesShortcut({ altKey: true }, ctrl)).toBe(false);
  });

  it('does NOT match Ctrl-only when extra modifiers are also held', () => {
    // Forbidden-modifier check — ctrl-only is exclusive, so Ctrl+Shift
    // should NOT trigger the inspect shortcut.
    expect(matchesShortcut({ ctrlKey: true, shiftKey: true }, ctrl)).toBe(false);
    expect(matchesShortcut({ ctrlKey: true, altKey: true }, ctrl)).toBe(false);
  });

  it('matches Alt-only chord against altKey', () => {
    expect(matchesShortcut({ altKey: true }, alt)).toBe(true);
    expect(matchesShortcut({ ctrlKey: true }, alt)).toBe(false);
  });

  it('matches a chord with key (Ctrl+Shift+K)', () => {
    expect(matchesShortcut({ ctrlKey: true, shiftKey: true, key: 'k' }, ctrlShiftK)).toBe(true);
    expect(matchesShortcut({ ctrlKey: true, shiftKey: true, key: 'K' }, ctrlShiftK)).toBe(true);
    expect(matchesShortcut({ ctrlKey: true, shiftKey: true, key: 'j' }, ctrlShiftK)).toBe(false);
    // Wrong modifier set
    expect(matchesShortcut({ ctrlKey: true, key: 'k' }, ctrlShiftK)).toBe(false);
  });

  it('modifier-only chord ignores subsequent letter keys', () => {
    // When the chord is "Ctrl alone", a click while holding Ctrl+'a' still
    // matches (because the chord doesn't care which letter).
    expect(matchesShortcut({ ctrlKey: true, key: 'a' }, ctrl)).toBe(true);
    expect(matchesShortcut({ ctrlKey: true, key: '' }, ctrl)).toBe(true);
  });
});

describe('shortcutFromEvent', () => {
  it('records a letter chord (Ctrl+K)', () => {
    const out = shortcutFromEvent({ ctrlKey: true, key: 'k' });
    expect(out).toEqual({ ctrl: true, alt: false, meta: false, shift: false, key: 'k' });
  });

  it('records a modifier-only chord when keydown is the modifier itself', () => {
    // Browser dispatches keydown with key='Control' for Ctrl press alone.
    const out = shortcutFromEvent({ ctrlKey: true, key: 'Control' });
    expect(out).toEqual({ ctrl: true, alt: false, meta: false, shift: false, key: '' });
  });

  it('records compound modifiers (Ctrl+Shift)', () => {
    const out = shortcutFromEvent({ ctrlKey: true, shiftKey: true, key: 'Shift' });
    expect(out).toEqual({ ctrl: true, alt: false, meta: false, shift: true, key: '' });
  });

  it('rejects Tab / Escape / Enter (these are navigation, not chords)', () => {
    expect(shortcutFromEvent({ key: 'Tab' })).toBeNull();
    expect(shortcutFromEvent({ key: 'Escape' })).toBeNull();
    expect(shortcutFromEvent({ key: 'Enter' })).toBeNull();
    expect(shortcutFromEvent({ key: '' })).toBeNull();
  });
});

describe('formatShortcut', () => {
  const ctrl: Shortcut = { ctrl: true, alt: false, meta: false, shift: false, key: '' };
  const ctrlShiftK: Shortcut = { ctrl: true, alt: false, meta: false, shift: true, key: 'k' };

  it('renders Ctrl+Click on non-Mac', () => {
    expect(formatShortcut(ctrl, { mac: false, click: true })).toBe('Ctrl+Click');
  });

  it('renders ⌃+Click on Mac', () => {
    expect(formatShortcut(ctrl, { mac: true, click: true })).toBe('⌃+Click');
  });

  it('renders compound chord Ctrl+Shift+K', () => {
    expect(formatShortcut(ctrlShiftK, { mac: false })).toBe('Ctrl+Shift+K');
  });

  it('returns "(unset)" for empty shortcut', () => {
    expect(formatShortcut({ ctrl: false, alt: false, meta: false, shift: false, key: '' }))
      .toBe('(unset)');
  });
});

describe('loadInspectShortcut / saveInspectShortcut', () => {
  function makeStorage() {
    const store: Record<string, any> = {};
    return {
      data: store,
      get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store[k]])),
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
    };
  }

  it('returns the default when nothing is stored', async () => {
    const s = await loadInspectShortcut(makeStorage());
    expect(s).toEqual(DEFAULT_INSPECT_SHORTCUT);
  });

  it('round-trips a saved shortcut', async () => {
    const storage = makeStorage();
    const cust: Shortcut = { ctrl: false, alt: false, meta: true, shift: true, key: 'p' };
    await saveInspectShortcut(storage, cust);
    expect(storage.data[STORAGE_KEY_INSPECT]).toEqual(cust);
    const loaded = await loadInspectShortcut(storage);
    expect(loaded).toEqual(cust);
  });

  it('falls back to default when stored value is malformed', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY_INSPECT] = { ctrl: 'yes' };  // wrong type
    const loaded = await loadInspectShortcut(storage);
    expect(loaded).toEqual(DEFAULT_INSPECT_SHORTCUT);
  });

  it('survives storage.get throwing', async () => {
    const storage = {
      get: async () => { throw new Error('storage offline'); },
      set: async () => {},
    };
    const loaded = await loadInspectShortcut(storage);
    expect(loaded).toEqual(DEFAULT_INSPECT_SHORTCUT);
  });
});
